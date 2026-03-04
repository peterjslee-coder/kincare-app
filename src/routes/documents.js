const express = require("express");
const { v4: uuid } = require("uuid");
const multer = require("multer");
const { getDb } = require("../models/database");
const { authenticate, requireAdmin } = require("../middleware/auth");
const { classifyDocument } = require("../utils/documentAI");

const router = express.Router();

// ─── Constants ───
const VALID_OWNER_TYPES = ["care_recipient", "caregiver", "user"];
const VALID_CATEGORIES = ["consent", "identity", "certification", "insurance", "legal"];
const VALID_DOCUMENT_TYPES = [
  // Consent / Legal
  "POA", "Healthcare_POA", "Court_Order", "Living_Will", "Other_Legal",
  // Identity
  "DL_Front", "DL_Back", "Passport", "State_ID",
  // Certification
  "CNA", "HHA", "LPN", "RN", "CPR", "BLS", "ACLS", "First_Aid", "Other_Cert",
  // Insurance
  "Liability_Insurance", "Auto_Insurance", "Health_Insurance",
  // Other
  "Other",
];

// ─── Multer config (PDF + images, 10MB) ───
const uploadDoc = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [
      "application/pdf",
      "image/jpeg", "image/png", "image/gif", "image/webp",
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF and image files (JPEG, PNG, GIF, WebP) are allowed"));
    }
  },
});

// ─── Audit log helper ───
async function logConsentAudit(db, { careRecipientId, actorId, actorRole, eventType, description, metadata }) {
  try {
    await db.prepare(`
      INSERT INTO consent_audit_log (id, care_recipient_id, actor_id, actor_role, event_type, description, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(uuid(), careRecipientId, actorId, actorRole, eventType, description, metadata ? JSON.stringify(metadata) : null);
  } catch (err) {
    console.error("Consent audit log error:", err.message);
  }
}

// ═══════════════════════════════════════════════════════════
// POST /api/documents/upload — Upload a document with AI classification
// ═══════════════════════════════════════════════════════════
router.post("/upload", authenticate, uploadDoc.single("document"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const { category, document_type, owner_type, owner_id } = req.body;

    // Validate inputs
    if (!VALID_OWNER_TYPES.includes(owner_type)) {
      return res.status(400).json({ error: `owner_type must be one of: ${VALID_OWNER_TYPES.join(", ")}` });
    }
    if (!VALID_CATEGORIES.includes(category)) {
      return res.status(400).json({ error: `category must be one of: ${VALID_CATEGORIES.join(", ")}` });
    }
    if (!VALID_DOCUMENT_TYPES.includes(document_type)) {
      return res.status(400).json({ error: `document_type must be one of: ${VALID_DOCUMENT_TYPES.join(", ")}` });
    }

    const db = await getDb();

    // Verify ownership: user must own the entity they're uploading for
    if (owner_type === "care_recipient") {
      const cr = await db.prepare("SELECT id, family_user_id, first_name, last_name FROM care_recipients WHERE id = ?").get(owner_id);
      if (!cr) return res.status(404).json({ error: "Care recipient not found" });
      if (cr.family_user_id !== req.user.id && req.user.role !== "admin") {
        return res.status(403).json({ error: "You can only upload documents for your own care recipients" });
      }
    } else if (owner_type === "caregiver") {
      const cp = await db.prepare("SELECT id, user_id FROM caregiver_profiles WHERE id = ?").get(owner_id);
      if (!cp) return res.status(404).json({ error: "Caregiver profile not found" });
      if (cp.user_id !== req.user.id && req.user.role !== "admin") {
        return res.status(403).json({ error: "You can only upload documents for your own profile" });
      }
    } else if (owner_type === "user") {
      if (owner_id !== req.user.id && req.user.role !== "admin") {
        return res.status(403).json({ error: "You can only upload documents for yourself" });
      }
    }

    // Convert to base64
    const base64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;

    const docId = uuid();

    // Insert document with 'ai_review' status
    await db.prepare(`
      INSERT INTO verified_documents (id, owner_type, owner_id, uploaded_by, category, document_type,
        file_data, file_name, file_size, mime_type, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ai_review', NOW(), NOW())
    `).run(docId, owner_type, owner_id, req.user.id, category, document_type,
      base64, req.file.originalname, req.file.size, req.file.mimetype);

    // Run AI classification asynchronously (don't block the response)
    // But for now, run it synchronously so the user sees immediate results
    const aiResult = await classifyDocument(base64, req.file.mimetype, document_type);

    // Determine status based on AI result
    let newStatus = "pending"; // default: needs admin review
    if (aiResult.skipped || aiResult.error) {
      newStatus = "pending";
    } else if (!aiResult.isValid || !aiResult.matchesClaimed || aiResult.confidence < 0.5) {
      newStatus = "ai_flagged";
    } else if (aiResult.confidence >= 0.85 && aiResult.isValid && aiResult.matchesClaimed) {
      // High confidence + valid + matches claim → pending admin review (not auto-approved for consent)
      newStatus = category === "consent" || category === "legal" ? "pending" : "pending";
      // Identity/cert docs with very high confidence could be auto-approved in future
    }

    // Extract expiration from AI if found
    let expiresAt = null;
    if (aiResult.extractedFields?.expirationDate) {
      try {
        const parsed = new Date(aiResult.extractedFields.expirationDate);
        if (!isNaN(parsed.getTime())) expiresAt = parsed.toISOString();
      } catch (e) { /* ignore parse errors */ }
    }

    // Update document with AI results
    await db.prepare(`
      UPDATE verified_documents
      SET status = ?, ai_classification = ?, ai_reviewed_at = NOW(),
          expires_at = COALESCE(?, expires_at), updated_at = NOW()
      WHERE id = ?
    `).run(newStatus, JSON.stringify(aiResult), expiresAt, docId);

    // Log to consent audit trail if this is a consent/legal document
    if ((category === "consent" || category === "legal") && owner_type === "care_recipient") {
      const uploaderName = await db.prepare("SELECT first_name, last_name FROM users WHERE id = ?").get(req.user.id);
      const recipientName = await db.prepare("SELECT first_name, last_name FROM care_recipients WHERE id = ?").get(owner_id);
      const uName = uploaderName ? `${uploaderName.first_name} ${uploaderName.last_name}`.trim() : "Unknown";
      const rName = recipientName ? `${recipientName.first_name} ${recipientName.last_name}`.trim() : "Unknown";

      await logConsentAudit(db, {
        careRecipientId: owner_id,
        actorId: req.user.id,
        actorRole: "family",
        eventType: "document_uploaded",
        description: `${uName} uploaded ${document_type.replace(/_/g, " ")} document for ${rName}`,
        metadata: { documentId: docId, documentType: document_type, aiConfidence: aiResult.confidence, aiStatus: newStatus },
      });

      // AI classification audit entry
      if (!aiResult.skipped && !aiResult.error) {
        await logConsentAudit(db, {
          careRecipientId: owner_id,
          actorId: "system",
          actorRole: "ai",
          eventType: "document_classified",
          description: `AI classified document as "${aiResult.classification}" (${Math.round(aiResult.confidence * 100)}% confidence). ${aiResult.summary}`,
          metadata: { documentId: docId, classification: aiResult.classification, confidence: aiResult.confidence, concerns: aiResult.concerns },
        });
      }
    }

    // Return document metadata (no file_data)
    res.status(201).json({
      document: {
        id: docId,
        owner_type, owner_id,
        category, document_type,
        file_name: req.file.originalname,
        file_size: req.file.size,
        mime_type: req.file.mimetype,
        status: newStatus,
        ai_classification: aiResult,
        expires_at: expiresAt,
        created_at: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error("Document upload error:", err);
    if (err.message?.includes("Only PDF and image")) {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: "Failed to upload document" });
  }
});

// ═══════════════════════════════════════════════════════════
// GET /api/documents/owner/:ownerType/:ownerId — List documents for an entity
// ═══════════════════════════════════════════════════════════
router.get("/owner/:ownerType/:ownerId", authenticate, async (req, res) => {
  try {
    const { ownerType, ownerId } = req.params;
    const { category, status } = req.query;
    const db = await getDb();

    let sql = `
      SELECT id, owner_type, owner_id, uploaded_by, category, document_type,
             file_name, file_size, mime_type, status, ai_classification,
             ai_reviewed_at, admin_reviewed_by, admin_reviewed_at, admin_notes,
             expires_at, replaced_by, metadata, created_at, updated_at
      FROM verified_documents
      WHERE owner_type = ? AND owner_id = ?
    `;
    const params = [ownerType, ownerId];

    if (category) { sql += ` AND category = ?`; params.push(category); }
    if (status) { sql += ` AND status = ?`; params.push(status); }

    sql += ` ORDER BY created_at DESC`;

    const docs = await db.prepare(sql).all(...params);

    // Parse AI classification JSON for each doc
    const parsed = docs.map(d => ({
      ...d,
      ai_classification: d.ai_classification ? JSON.parse(d.ai_classification) : null,
      metadata: d.metadata ? JSON.parse(d.metadata) : null,
    }));

    res.json({ documents: parsed });
  } catch (err) {
    console.error("Document list error:", err);
    res.status(500).json({ error: "Failed to fetch documents" });
  }
});

// ═══════════════════════════════════════════════════════════
// GET /api/documents/:docId — Get document metadata + AI classification
// ═══════════════════════════════════════════════════════════
router.get("/:docId", authenticate, async (req, res) => {
  try {
    const db = await getDb();
    const doc = await db.prepare(`
      SELECT id, owner_type, owner_id, uploaded_by, category, document_type,
             file_name, file_size, mime_type, status, ai_classification,
             ai_reviewed_at, admin_reviewed_by, admin_reviewed_at, admin_notes,
             expires_at, replaced_by, metadata, created_at, updated_at
      FROM verified_documents WHERE id = ?
    `).get(req.params.docId);

    if (!doc) return res.status(404).json({ error: "Document not found" });

    res.json({
      document: {
        ...doc,
        ai_classification: doc.ai_classification ? JSON.parse(doc.ai_classification) : null,
        metadata: doc.metadata ? JSON.parse(doc.metadata) : null,
      },
    });
  } catch (err) {
    console.error("Document get error:", err);
    res.status(500).json({ error: "Failed to fetch document" });
  }
});

// ═══════════════════════════════════════════════════════════
// GET /api/documents/:docId/download — Binary download
// ═══════════════════════════════════════════════════════════
router.get("/:docId/download", authenticate, async (req, res) => {
  try {
    const db = await getDb();
    const doc = await db.prepare("SELECT file_data, file_name, mime_type FROM verified_documents WHERE id = ?").get(req.params.docId);
    if (!doc) return res.status(404).json({ error: "Document not found" });

    const base64Data = doc.file_data.replace(/^data:[^;]+;base64,/, "");
    const buffer = Buffer.from(base64Data, "base64");

    res.set({
      "Content-Type": doc.mime_type || "application/octet-stream",
      "Content-Disposition": `inline; filename="${doc.file_name || "document"}"`,
      "Content-Length": buffer.length,
    });
    res.send(buffer);
  } catch (err) {
    console.error("Document download error:", err);
    res.status(500).json({ error: "Failed to download document" });
  }
});

// ═══════════════════════════════════════════════════════════
// DELETE /api/documents/:docId — Delete document (only if not approved)
// ═══════════════════════════════════════════════════════════
router.delete("/:docId", authenticate, async (req, res) => {
  try {
    const db = await getDb();
    const doc = await db.prepare("SELECT * FROM verified_documents WHERE id = ?").get(req.params.docId);
    if (!doc) return res.status(404).json({ error: "Document not found" });

    if (doc.status === "approved") {
      return res.status(403).json({ error: "Cannot delete an approved document. Contact admin to revoke." });
    }

    // Verify ownership
    if (doc.uploaded_by !== req.user.id && req.user.role !== "admin") {
      return res.status(403).json({ error: "You can only delete your own documents" });
    }

    await db.prepare("DELETE FROM verified_documents WHERE id = ?").run(req.params.docId);

    // Audit log for consent docs
    if ((doc.category === "consent" || doc.category === "legal") && doc.owner_type === "care_recipient") {
      await logConsentAudit(db, {
        careRecipientId: doc.owner_id,
        actorId: req.user.id,
        actorRole: req.user.role === "admin" ? "admin" : "family",
        eventType: "document_deleted",
        description: `${doc.document_type.replace(/_/g, " ")} document deleted`,
        metadata: { documentId: doc.id, documentType: doc.document_type },
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Document delete error:", err);
    res.status(500).json({ error: "Failed to delete document" });
  }
});

// ═══════════════════════════════════════════════════════════
// POST /api/documents/:docId/re-verify — Re-run AI classification (admin only)
// ═══════════════════════════════════════════════════════════
router.post("/:docId/re-verify", authenticate, requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const doc = await db.prepare("SELECT * FROM verified_documents WHERE id = ?").get(req.params.docId);
    if (!doc) return res.status(404).json({ error: "Document not found" });

    const aiResult = await classifyDocument(doc.file_data, doc.mime_type, doc.document_type);

    let newStatus = doc.status;
    if (!aiResult.skipped && !aiResult.error) {
      if (!aiResult.isValid || !aiResult.matchesClaimed || aiResult.confidence < 0.5) {
        newStatus = "ai_flagged";
      } else {
        newStatus = "pending";
      }
    }

    await db.prepare(`
      UPDATE verified_documents SET status = ?, ai_classification = ?, ai_reviewed_at = NOW(), updated_at = NOW() WHERE id = ?
    `).run(newStatus, JSON.stringify(aiResult), doc.id);

    res.json({
      document: {
        id: doc.id, status: newStatus,
        ai_classification: aiResult,
      },
    });
  } catch (err) {
    console.error("Document re-verify error:", err);
    res.status(500).json({ error: "Failed to re-verify document" });
  }
});

// ═══════════════════════════════════════════════════════════
// GET /api/documents/audit/:recipientId — Get consent audit trail
// ═══════════════════════════════════════════════════════════
router.get("/audit/:recipientId", authenticate, async (req, res) => {
  try {
    const db = await getDb();
    const { event_type } = req.query;
    const recipientId = req.params.recipientId;

    // Fetch consent status from care_recipients
    const recipient = await db.prepare(`
      SELECT cr.authorization_tier, cr.consent_status, cr.consent_method,
        cr.consent_verified_at, cr.permission_tier, cr.managed_by_user_id,
        cr.managed_reason, cr.managed_at, cr.attestation_signer,
        cr.attestation_relationship, cr.attestation_signed_at
      FROM care_recipients cr WHERE cr.id = ?
    `).get(recipientId);

    // Resolve managed_by user name if present
    let managedByName = null;
    if (recipient && recipient.managed_by_user_id) {
      const mgr = await db.prepare("SELECT first_name, last_name FROM users WHERE id = ?").get(recipient.managed_by_user_id);
      if (mgr) managedByName = `${mgr.first_name} ${mgr.last_name}`;
    }

    // Audit trail entries
    let sql = `
      SELECT cal.*, u.first_name AS actor_first_name, u.last_name AS actor_last_name
      FROM consent_audit_log cal
      LEFT JOIN users u ON u.id = cal.actor_id
      WHERE cal.care_recipient_id = ?
    `;
    const params = [recipientId];

    if (event_type) { sql += ` AND cal.event_type = ?`; params.push(event_type); }
    sql += ` ORDER BY cal.created_at DESC`;

    const entries = await db.prepare(sql).all(...params);

    const auditTrail = entries.map(e => ({
      ...e,
      metadata: e.metadata ? JSON.parse(e.metadata) : null,
    }));

    const consentStatus = recipient ? {
      authorization_tier: recipient.authorization_tier,
      consent_status: recipient.consent_status,
      consent_method: recipient.consent_method,
      consent_verified_at: recipient.consent_verified_at,
      permission_tier: recipient.permission_tier || 'full',
      managed_by: managedByName,
      managed_by_user_id: recipient.managed_by_user_id,
      managed_reason: recipient.managed_reason,
      managed_at: recipient.managed_at,
      attestation_signer: recipient.attestation_signer,
      attestation_relationship: recipient.attestation_relationship,
      attestation_signed_at: recipient.attestation_signed_at,
    } : {};

    res.json({ consentStatus, auditTrail, auditLog: auditTrail });
  } catch (err) {
    console.error("Audit log fetch error:", err);
    res.status(500).json({ error: "Failed to fetch audit log" });
  }
});

// Export audit logger for use in other routes
router.logConsentAudit = logConsentAudit;

module.exports = router;
