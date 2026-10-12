const express = require("express");
const { v4: uuid } = require("uuid");
const multer = require("multer");
const { getDb } = require("../models/database");
const { authenticate, requireAdmin } = require("../middleware/auth");
const { classifyDocument } = require("../utils/documentAI");
const { validateMagicBytes } = require("../utils/fileValidation");
const storage = require("../utils/storage"); // v1.91.0 — env-gated R2 offload for document blobs
// Documents Center (migration 050) — medical records are decided by ONE helper, never by
// canAccessOwner below (whose team-member and admin shortcuts would leak them).
const { medicalRole, logMedicalAudit } = require("../utils/medicalAccess");
const { recipientDocRole, canViewRecipientDoc, shareableCaregivers } = require("../utils/recipientDocAccess");
const { blockWhileImpersonating } = require("../middleware/noImpersonation");

const router = express.Router();

// Admin check middleware for document routes (mirrors admin.js checkAdmin)
// Required because requireAdmin expects req.isAdmin, which is only set by
// the admin router's own checkAdmin — doesn't run for /api/documents routes.
async function checkDocAdmin(req, res, next) {
  try {
    const db = await getDb();
    const user = await db.prepare("SELECT is_admin FROM users WHERE id = ?").get(req.user.id);
    req.isAdmin = !!(user && user.is_admin);
    next();
  } catch (err) {
    console.error("Doc admin check error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}

// ─── Constants ───
const VALID_OWNER_TYPES = ["care_recipient", "caregiver", "user"];
const VALID_CATEGORIES = ["consent", "identity", "certification", "insurance", "legal", "medical"];
// Medical records (Documents Center Phase 1): stored, not verified. Owner is always a
// care_recipient; no admin queue, no documentAI, no admin read. See utils/medicalAccess.js.
const MEDICAL_DOCUMENT_TYPES = [
  "Visit_Summary", "Medication_List", "Discharge_Summary", "Lab_Result",
  "Imaging_Report", "Care_Plan", "Insurance_Card", "Other_Medical",
];
const VALID_DOCUMENT_TYPES = [
  // Consent / Legal
  "POA", "Healthcare_POA", "Court_Order", "Living_Will", "Other_Legal",
  // Identity — any acceptable government photo ID, not only a driver's licence.
  // ID_Front/ID_Back are the generic pair written by onboarding from v1.109.5;
  // DL_Front/DL_Back stay valid for every row uploaded before that.
  "ID_Front", "ID_Back",
  "DL_Front", "DL_Back", "Passport", "State_ID", "EAD", "Permanent_Resident_Card",
  // Certification
  "CNA", "HHA", "LPN", "RN", "CPR", "BLS", "ACLS", "First_Aid", "Other_Cert",
  // Insurance
  "Liability_Insurance", "Auto_Insurance", "Health_Insurance",
  // Other
  "Other",
  // Medical (category 'medical' only)
  ...MEDICAL_DOCUMENT_TYPES,
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

// ─── Authorization helper: verify user can access documents for an entity ───
async function canAccessOwner(db, userId, userRole, ownerType, ownerId, isAdmin) {
  // Check admin via is_admin DB flag (passed as req.isAdmin from checkDocAdmin middleware)
  if (userRole === "admin" || isAdmin) return true;

  if (ownerType === "care_recipient") {
    // Direct owner?
    const cr = await db.prepare("SELECT family_user_id, linked_user_id FROM care_recipients WHERE id = ?").get(ownerId);
    if (!cr) return false;
    if (cr.family_user_id === userId) return true;
    if (cr.linked_user_id === userId) return true;
    // Shared via care_recipient_shares?
    const share = await db.prepare("SELECT id FROM care_recipient_shares WHERE care_recipient_id = ? AND shared_with_user_id = ?").get(ownerId, userId);
    if (share) return true;
    // Care team member?
    const teamMember = await db.prepare(`
      SELECT ctm.id FROM care_team_members ctm
      JOIN care_teams ct ON ct.id = ctm.care_team_id
      WHERE ct.care_recipient_id = ? AND ctm.user_id = ?
    `).get(ownerId, userId);
    if (teamMember) return true;
    return false;
  }

  if (ownerType === "caregiver") {
    const cp = await db.prepare("SELECT user_id FROM caregiver_profiles WHERE id = ?").get(ownerId);
    if (!cp) return false;
    return cp.user_id === userId;
  }

  if (ownerType === "user") {
    return ownerId === userId;
  }

  return false;
}

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
router.post("/upload", authenticate, checkDocAdmin, uploadDoc.single("document"), async (req, res) => {
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

    // ── Medical records: their own rules, and nothing below this block applies to them ──
    const isMedical = category === "medical";
    if (isMedical !== MEDICAL_DOCUMENT_TYPES.includes(document_type)) {
      return res.status(400).json({ error: "Medical record types go with the medical category only" });
    }
    if (isMedical) {
      if (owner_type !== "care_recipient") {
        return res.status(400).json({ error: "Medical records belong to a care recipient" });
      }
      const role = await medicalRole(db, owner_id, req.user.id);
      if (!role.canView) {
        return res.status(403).json({ error: "You don't have access to this person's medical records." });
      }
      const magic = validateMagicBytes(req.file.buffer, req.file.mimetype);
      if (!magic.valid) {
        return res.status(400).json({
          error: `File content doesn't match its type. Expected ${req.file.mimetype}${magic.detected ? `, detected ${magic.detected}` : ""}`,
        });
      }
      const medId = uuid();
      const medData = await storage.storeFileData("documents", `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`);
      // status 'stored': never 'ai_review'/'pending'/'ai_flagged', so never in the admin queue,
      // and classifyDocument is deliberately NOT called.
      await db.prepare(`
        INSERT INTO verified_documents (id, owner_type, owner_id, uploaded_by, category, document_type,
          file_data, file_name, file_size, mime_type, status, created_at, updated_at)
        VALUES (?, 'care_recipient', ?, ?, 'medical', ?, ?, ?, ?, ?, 'stored', NOW(), NOW())
      `).run(medId, owner_id, req.user.id, document_type, medData, req.file.originalname, req.file.size, req.file.mimetype);
      await logMedicalAudit(db, {
        careRecipientId: owner_id, documentId: medId, actorId: req.user.id, eventType: "uploaded",
        detail: { documentType: document_type, fileName: req.file.originalname },
      });
      return res.status(201).json({
        document: {
          id: medId, owner_type: "care_recipient", owner_id, category: "medical", document_type,
          file_name: req.file.originalname, file_size: req.file.size, mime_type: req.file.mimetype,
          status: "stored", created_at: new Date().toISOString(),
        },
      });
    }

    // Verify ownership: user must have access to the entity they're uploading for
    if (!(await canAccessOwner(db, req.user.id, req.user.role, owner_type, owner_id, req.isAdmin))) {
      return res.status(403).json({ error: "You do not have access to upload documents for this entity" });
    }
    // v1.110.1 — a care recipient's documents are the family's. A caregiver on the team can
    // be shown a document; she cannot file one into the record.
    if (owner_type === "care_recipient" && !req.isAdmin && !(await recipientDocRole(db, owner_id, req.user.id)).family) {
      return res.status(403).json({ error: "Only the family's care team can add documents for this person." });
    }

    // Validate magic bytes match claimed MIME type (prevent disguised uploads)
    const magicCheck = validateMagicBytes(req.file.buffer, req.file.mimetype);
    if (!magicCheck.valid) {
      return res.status(400).json({
        error: `File content doesn't match its type. Expected ${req.file.mimetype}${magicCheck.detected ? `, detected ${magicCheck.detected}` : ""}`,
      });
    }

    // Convert to base64
    const base64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;

    const docId = uuid();

    // Insert document with 'ai_review' status
    // v1.91.0 — blob goes to R2 when configured ("r2:<key>" marker in the column);
    // the in-memory `base64` keeps feeding the AI classification below either way.
    const storedFileData = await storage.storeFileData("documents", base64);
    await db.prepare(`
      INSERT INTO verified_documents (id, owner_type, owner_id, uploaded_by, category, document_type,
        file_data, file_name, file_size, mime_type, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ai_review', NOW(), NOW())
    `).run(docId, owner_type, owner_id, req.user.id, category, document_type,
      storedFileData, req.file.originalname, req.file.size, req.file.mimetype);

    // Log upload audit entry immediately (before AI, so user sees it)
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
        metadata: { documentId: docId, documentType: document_type },
      });
    }

    // Return immediately — document saved, AI runs in background
    res.status(201).json({
      document: {
        id: docId,
        owner_type, owner_id,
        category, document_type,
        file_name: req.file.originalname,
        file_size: req.file.size,
        mime_type: req.file.mimetype,
        status: "ai_review",
        ai_classification: null,
        expires_at: null,
        created_at: new Date().toISOString(),
      },
    });

    // ── Background AI classification (non-blocking) ──
    classifyDocument(base64, req.file.mimetype, document_type).then(async (aiResult) => {
      try {
        const bgDb = await getDb();

        // Determine status based on AI result
        let newStatus = "pending";
        if (aiResult.skipped || aiResult.error) {
          newStatus = "pending";
        } else if (!aiResult.isValid || !aiResult.matchesClaimed || aiResult.confidence < 0.5) {
          newStatus = "ai_flagged";
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
        await bgDb.prepare(`
          UPDATE verified_documents
          SET status = ?, ai_classification = ?, ai_reviewed_at = NOW(),
              expires_at = COALESCE(?, expires_at), updated_at = NOW()
          WHERE id = ?
        `).run(newStatus, JSON.stringify(aiResult), expiresAt, docId);

        // AI classification audit entry
        if ((category === "consent" || category === "legal") && owner_type === "care_recipient") {
          if (aiResult.error) {
            await logConsentAudit(bgDb, {
              careRecipientId: owner_id,
              actorId: "system",
              actorRole: "ai",
              eventType: "document_classified",
              description: `AI classification failed for ${document_type.replace(/_/g, " ")} document`,
              metadata: { documentId: docId, error: true },
            });
          } else if (!aiResult.skipped) {
            await logConsentAudit(bgDb, {
              careRecipientId: owner_id,
              actorId: "system",
              actorRole: "ai",
              eventType: "document_classified",
              description: `AI classified document as "${aiResult.classification}" (${Math.round(aiResult.confidence * 100)}% confidence). ${aiResult.summary}`,
              metadata: { documentId: docId, classification: aiResult.classification, confidence: aiResult.confidence, concerns: aiResult.concerns },
            });
          }
        }

        console.log(`[DocumentAI] Classified ${docId}: ${aiResult.classification} (${Math.round(aiResult.confidence * 100)}%) → ${newStatus}`);
      } catch (bgErr) {
        console.error("[DocumentAI] Background classification update failed:", bgErr.message);
      }
    }).catch(err => {
      console.error("[DocumentAI] Classification failed for", docId, err.message);
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
router.get("/owner/:ownerType/:ownerId", authenticate, checkDocAdmin, async (req, res) => {
  try {
    const { ownerType, ownerId } = req.params;
    const { category, status } = req.query;
    const db = await getDb();

    // Authorization check
    if (!(await canAccessOwner(db, req.user.id, req.user.role, ownerType, ownerId, req.isAdmin))) {
      return res.status(403).json({ error: "You do not have access to these documents" });
    }

    let sql = `
      SELECT id, owner_type, owner_id, uploaded_by, category, document_type,
             file_name, file_size, mime_type, status, ai_classification,
             ai_reviewed_at, admin_reviewed_by, admin_reviewed_at, admin_notes,
             expires_at, replaced_by, metadata, created_at, updated_at
      FROM verified_documents
      WHERE owner_type = ? AND owner_id = ?
        AND category <> 'medical' -- medical records list only through /api/medical-records
    `;
    const params = [ownerType, ownerId];

    // v1.110.1 — caregivers see only the documents the family shared with them by name.
    if (ownerType === "care_recipient" && !req.isAdmin) {
      const r = await recipientDocRole(db, ownerId, req.user.id);
      if (!r.family) {
        sql += ` AND id IN (SELECT document_id FROM recipient_doc_shares WHERE user_id = ?)`;
        params.push(req.user.id);
      }
    }

    if (category) { sql += ` AND category = ?`; params.push(category); }
    if (status) { sql += ` AND status = ?`; params.push(status); }

    sql += ` ORDER BY created_at DESC`;

    const docs = await db.prepare(sql).all(...params);

    // Parse AI classification JSON, flag expired documents
    const now = new Date();
    const expiredIds = [];
    const parsed = docs.map(d => {
      const isExpired = d.expires_at && new Date(d.expires_at) < now && d.status === 'approved';
      if (isExpired) expiredIds.push(d.id);
      return {
        ...d,
        status: isExpired ? 'expired' : d.status,
        ai_classification: d.ai_classification ? JSON.parse(d.ai_classification) : null,
        metadata: d.metadata ? JSON.parse(d.metadata) : null,
      };
    });

    // Lazily update expired docs in background (non-blocking)
    if (expiredIds.length > 0) {
      const placeholders = expiredIds.map(() => '?').join(',');
      db.prepare(`UPDATE verified_documents SET status = 'expired', updated_at = NOW() WHERE id IN (${placeholders})`).run(...expiredIds).catch(e => console.error("Expire update error:", e));
    }

    res.json({ documents: parsed });
  } catch (err) {
    console.error("Document list error:", err);
    res.status(500).json({ error: "Failed to fetch documents" });
  }
});

// ═══════════════════════════════════════════════════════════
// GET /api/documents/admin/pending — List documents needing admin review
// ═══════════════════════════════════════════════════════════
router.get("/admin/pending", authenticate, checkDocAdmin, requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const docs = await db.prepare(`
      SELECT vd.id, vd.owner_type, vd.owner_id, vd.uploaded_by, vd.category, vd.document_type,
             vd.file_name, vd.file_size, vd.mime_type, vd.status, vd.ai_classification,
             vd.extracted_data, vd.ai_confidence, vd.ai_concerns,
             vd.ai_reviewed_at, vd.admin_reviewed_by, vd.admin_reviewed_at, vd.admin_notes,
             vd.expires_at, vd.created_at, vd.updated_at,
             u.first_name AS uploader_first, u.last_name AS uploader_last,
             cr.first_name AS recipient_first, cr.last_name AS recipient_last, cr.called_by AS recipient_called_by
      FROM verified_documents vd
      LEFT JOIN users u ON u.id = vd.uploaded_by
      LEFT JOIN care_recipients cr ON cr.id = vd.owner_id AND vd.owner_type = 'care_recipient'
      WHERE vd.status IN ('ai_review', 'pending', 'ai_flagged')
        AND vd.category <> 'medical' -- medical records are stored, not verified: never queued
      ORDER BY
        CASE vd.status WHEN 'ai_flagged' THEN 1 WHEN 'pending' THEN 2 WHEN 'ai_review' THEN 3 END,
        vd.created_at DESC
    `).all();

    // For identity docs, find linked selfies (stored with ai_classification.linkedIdDocId)
    const identityDocIds = docs.filter(d => d.category === 'identity' && d.document_type !== 'selfie').map(d => d.id);
    let selfieMap = {};
    if (identityDocIds.length > 0) {
      const selfies = await db.prepare(
        // identity-read-ok: fetches the PAIRED selfie for documents already selected; decides nothing
        `SELECT id, ai_classification FROM verified_documents WHERE document_type = 'selfie' AND owner_id IN (${identityDocIds.map(() => '?').join(',')}) AND category = 'identity'`
      ).all(...docs.filter(d => d.category === 'identity' && d.document_type !== 'selfie').map(d => d.owner_id));
      for (const s of selfies) {
        try {
          const sData = JSON.parse(s.ai_classification || '{}');
          if (sData.linkedIdDocId) selfieMap[sData.linkedIdDocId] = s.id;
        } catch (e) { /* ignore */ }
      }
    }

    const parsed = docs.map(d => ({
      ...d,
      ai_classification: d.ai_classification ? JSON.parse(d.ai_classification) : null,
      extracted_data: d.extracted_data ? JSON.parse(d.extracted_data) : null,
      ai_concerns: d.ai_concerns ? JSON.parse(d.ai_concerns) : null,
      uploaderName: [d.uploader_first, d.uploader_last].filter(Boolean).join(' ') || 'Unknown',
      recipientName: d.recipient_called_by || [d.recipient_first, d.recipient_last].filter(Boolean).join(' ') || null,
      linkedSelfieId: selfieMap[d.id] || null,
    }));

    res.json({ documents: parsed, count: parsed.length });
  } catch (err) {
    console.error("Admin pending docs error:", err);
    res.status(500).json({ error: "Failed to load pending documents" });
  }
});

// ═══════════════════════════════════════════════════════════
// POST /api/documents/admin/:docId/review — Admin approve or reject a document
// ═══════════════════════════════════════════════════════════
router.post("/admin/:docId/review", authenticate, checkDocAdmin, requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const { action, notes } = req.body; // action: 'approve' or 'reject'
    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: "Action must be 'approve' or 'reject'" });
    }

    const doc = await db.prepare("SELECT * FROM verified_documents WHERE id = ?").get(req.params.docId);
    // Medical records are never reviewed by an admin — answered as not found.
    if (!doc || doc.category === "medical") return res.status(404).json({ error: "Document not found" });

    const newStatus = action === 'approve' ? 'approved' : 'rejected';

    await db.prepare(`
      UPDATE verified_documents
      SET status = ?, admin_reviewed_by = ?, admin_reviewed_at = NOW(), admin_notes = ?, updated_at = NOW()
      WHERE id = ?
    `).run(newStatus, req.user.id, notes || null, doc.id);

    // Audit log for consent/legal documents
    if ((doc.category === 'consent' || doc.category === 'legal') && doc.owner_type === 'care_recipient') {
      await logConsentAudit(db, {
        // v1.110.1 — was `recipientId`, which the helper does not read: the NOT NULL insert
        // failed inside its catch and every admin approve/reject audit row was lost.
        careRecipientId: doc.owner_id,
        actorId: req.user.id,
        actorRole: 'admin',
        eventType: action === 'approve' ? 'document_approved' : 'document_rejected',
        description: `Admin ${action}d ${doc.document_type.replace(/_/g, ' ')} document${notes ? ': ' + notes : ''}`,
        metadata: { documentId: doc.id, previousStatus: doc.status, newStatus, notes },
      });
    }

    res.json({ document: { id: doc.id, status: newStatus, admin_reviewed_at: new Date().toISOString() } });
  } catch (err) {
    console.error("Admin document review error:", err);
    res.status(500).json({ error: "Failed to review document" });
  }
});

// ═══════════════════════════════════════════════════════════
// GET /api/documents/admin/count — Count of docs needing review (for badge)
// ═══════════════════════════════════════════════════════════
router.get("/admin/count", authenticate, checkDocAdmin, requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const row = await db.prepare(`
      SELECT COUNT(*) AS cnt FROM verified_documents WHERE status IN ('ai_review', 'pending', 'ai_flagged')
        AND category <> 'medical'
    `).get();
    res.json({ count: parseInt(row.cnt) || 0 });
  } catch (err) {
    res.status(500).json({ error: "Failed to count pending documents" });
  }
});

// ═══════════════════════════════════════════════════════════
// GET /api/documents/:docId — Get document metadata + AI classification
// ═══════════════════════════════════════════════════════════
router.get("/:docId", authenticate, checkDocAdmin, async (req, res) => {
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

    // Authorization check — medical records answer to medicalAccess, never canAccessOwner
    if (doc.category === "medical") {
      const role = await medicalRole(db, doc.owner_id, req.user.id);
      if (!role.canView) return res.status(403).json({ error: "You do not have access to this document" });
    } else if (doc.owner_type === "care_recipient") {
      if (!(await canViewRecipientDoc(db, doc, req.user.id, req.isAdmin))) {
        return res.status(403).json({ error: "You do not have access to this document" });
      }
    } else if (!(await canAccessOwner(db, req.user.id, req.user.role, doc.owner_type, doc.owner_id, req.isAdmin))) {
      return res.status(403).json({ error: "You do not have access to this document" });
    }

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
router.get("/:docId/download", authenticate, checkDocAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const doc = await db.prepare("SELECT id, file_data, file_name, mime_type, owner_type, owner_id, category FROM verified_documents WHERE id = ?").get(req.params.docId);
    if (!doc) return res.status(404).json({ error: "Document not found" });
    // Medical records open only through the passkey-gated, audited Documents Center route.
    if (doc.category === "medical") {
      return res.status(403).json({ error: "Open medical records from the Documents Center.", code: "MEDICAL_RECORD" });
    }

    // Authorization check — a care recipient's documents answer to recipientDocAccess (v1.110.1)
    if (doc.owner_type === "care_recipient") {
      if (!(await canViewRecipientDoc(db, doc, req.user.id, req.isAdmin))) {
        return res.status(403).json({ error: "You do not have access to this document" });
      }
    } else if (!(await canAccessOwner(db, req.user.id, req.user.role, doc.owner_type, doc.owner_id, req.isAdmin))) {
      return res.status(403).json({ error: "You do not have access to this document" });
    }

    const fileData = await storage.resolveFileData(doc.file_data); // v1.91.0 — fetches from R2 when marker
    const base64Data = fileData.replace(/^data:[^;]+;base64,/, "");
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
router.delete("/:docId", authenticate, checkDocAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const doc = await db.prepare("SELECT * FROM verified_documents WHERE id = ?").get(req.params.docId);
    if (!doc) return res.status(404).json({ error: "Document not found" });

    // Medical records: anyone who can see them and uploaded it, or the leader/owner/member.
    if (doc.category === "medical") {
      const role = await medicalRole(db, doc.owner_id, req.user.id);
      if (!role.canView || !(doc.uploaded_by === req.user.id || role.isLeader || role.isMember)) {
        return res.status(403).json({ error: "You can't delete this record." });
      }
      await db.prepare("DELETE FROM verified_documents WHERE id = ?").run(doc.id);
      await db.prepare("DELETE FROM medical_doc_suggestions WHERE document_id = ? AND status = 'pending'").run(doc.id);
      await logMedicalAudit(db, {
        careRecipientId: doc.owner_id, documentId: doc.id, actorId: req.user.id, eventType: "deleted",
        detail: { documentType: doc.document_type, fileName: doc.file_name },
      });
      return res.json({ success: true });
    }

    if (doc.status === "approved") {
      return res.status(403).json({ error: "Cannot delete an approved document. Contact admin to revoke." });
    }

    // Verify ownership. v1.110.1 — and for a care recipient's documents, the person must still
    // be on the family side of the team: uploading something once is not a standing key.
    // The owner, leader and member may remove any of them.
    if (doc.owner_type === "care_recipient" && !req.isAdmin) {
      const r = await recipientDocRole(db, doc.owner_id, req.user.id);
      if (!r.family || !(doc.uploaded_by === req.user.id || r.canManage)) {
        return res.status(403).json({ error: "You can't delete this document." });
      }
    } else if (doc.uploaded_by !== req.user.id && !req.isAdmin) {
      return res.status(403).json({ error: "You can only delete your own documents" });
    }

    await db.prepare("DELETE FROM verified_documents WHERE id = ?").run(req.params.docId);
    await db.prepare("DELETE FROM recipient_doc_shares WHERE document_id = ?").run(req.params.docId);
    // v1.91.0 — deliberately NOT deleting the R2 object here: consent uploads
    // dual-write the same blob marker into authorization_documents under the
    // same id, so the object may still be referenced. Orphaned objects are
    // harmless; cleanup happens in the future backfill/GC migration.

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
router.post("/:docId/re-verify", authenticate, checkDocAdmin, requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const doc = await db.prepare("SELECT * FROM verified_documents WHERE id = ?").get(req.params.docId);
    // Medical records never go to documentAI.
    if (!doc || doc.category === "medical") return res.status(404).json({ error: "Document not found" });

    const aiResult = await classifyDocument(await storage.resolveFileData(doc.file_data), doc.mime_type, doc.document_type);

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
router.get("/audit/:recipientId", authenticate, checkDocAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const { event_type } = req.query;
    const recipientId = req.params.recipientId;

    // Authorization check — must have access to this care recipient
    if (!req.isAdmin && !(await recipientDocRole(db, recipientId, req.user.id)).family) {
      return res.status(403).json({ error: "You do not have access to this care recipient's audit trail" });
    }

    // Fetch consent status from care_recipients.
    // v1.105.48 — attestation_signer / attestation_relationship / attestation_signed_at are
    // NOT columns on care_recipients; they are aliases admin/verification.js builds from the
    // `attestations` table. Selecting them off cr threw, so GET /api/documents/audit/:id has
    // always answered 500 and the consent audit trail on the Documents page has never loaded
    // for anyone. Join the table the aliases came from.
    const recipient = await db.prepare(`
      SELECT cr.authorization_tier, cr.consent_status, cr.consent_method,
        cr.consent_verified_at, cr.permission_tier, cr.managed_by_user_id,
        cr.managed_reason, cr.managed_at,
        att.signature_name AS attestation_signer,
        att.relationship_to_recipient AS attestation_relationship,
        att.signed_at AS attestation_signed_at
      FROM care_recipients cr
      LEFT JOIN LATERAL (
        SELECT signature_name, relationship_to_recipient, signed_at
        FROM attestations WHERE care_recipient_id = cr.id
        ORDER BY signed_at DESC LIMIT 1
      ) att ON TRUE
      WHERE cr.id = ?
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

// ═══════════════════════════════════════════════════════════
// v1.110.1 — sharing ONE document with ONE caregiver
// Pete, 10/12: "Caregivers should not be able to open any legal documents unless the careteam
// explicitly allows it." The owner, the leader or the member decides, document by document.
// ═══════════════════════════════════════════════════════════
async function loadShareableDoc(db, docId) {
  const doc = await db.prepare(
    "SELECT id, owner_type, owner_id, category, document_type FROM verified_documents WHERE id = ?"
  ).get(docId);
  if (!doc || doc.owner_type !== "care_recipient" || doc.category === "medical") return null;
  return doc;
}

router.get("/:docId/shares", authenticate, async (req, res) => {
  try {
    const db = await getDb();
    const doc = await loadShareableDoc(db, req.params.docId);
    if (!doc) return res.status(404).json({ error: "Document not found" });
    const r = await recipientDocRole(db, doc.owner_id, req.user.id);
    if (!r.canManage) return res.status(403).json({ error: "Only the care team leader can share documents with a caregiver." });
    const caregivers = await shareableCaregivers(db, doc.owner_id);
    const shared = await db.prepare("SELECT user_id, granted_at FROM recipient_doc_shares WHERE document_id = ?").all(doc.id);
    const byId = new Map(shared.map((s) => [s.user_id, s.granted_at]));
    res.json({
      caregivers: caregivers.map((c) => ({
        userId: c.id,
        name: [c.first_name, c.last_name].filter(Boolean).join(" ") || "Caregiver",
        allowed: byId.has(c.id),
        allowedAt: byId.get(c.id) || null,
      })),
    });
  } catch (err) {
    console.error("Document shares read error:", err);
    res.status(500).json({ error: "Failed to load who can see this document" });
  }
});

router.put("/:docId/shares/:userId", authenticate, blockWhileImpersonating("share a document"), async (req, res) => {
  try {
    const db = await getDb();
    const allow = req.body?.allow === true;
    if (typeof req.body?.allow !== "boolean") return res.status(400).json({ error: "allow must be true or false" });
    const doc = await loadShareableDoc(db, req.params.docId);
    if (!doc) return res.status(404).json({ error: "Document not found" });
    const r = await recipientDocRole(db, doc.owner_id, req.user.id);
    if (!r.canManage) return res.status(403).json({ error: "Only the care team leader can share documents with a caregiver." });
    const target = req.params.userId;
    const eligible = (await shareableCaregivers(db, doc.owner_id)).some((c) => c.id === target);
    if (!eligible) return res.status(400).json({ error: "You can share with caregivers on this care team, or who have visited." });

    const existing = await db.prepare(
      "SELECT 1 FROM recipient_doc_shares WHERE document_id = ? AND user_id = ?"
    ).get(doc.id, target);
    if (allow && existing) return res.status(409).json({ error: "Already shared with this caregiver.", allowed: true });
    if (!allow && !existing) return res.status(409).json({ error: "Not shared with this caregiver.", allowed: false });

    if (allow) {
      await db.prepare(`
        INSERT INTO recipient_doc_shares (document_id, user_id, care_recipient_id, granted_by)
        VALUES (?, ?, ?, ?) ON CONFLICT (document_id, user_id) DO NOTHING
      `).run(doc.id, target, doc.owner_id, req.user.id);
    } else {
      await db.prepare("DELETE FROM recipient_doc_shares WHERE document_id = ? AND user_id = ?").run(doc.id, target);
    }
    const who = await db.prepare("SELECT first_name, last_name FROM users WHERE id = ?").get(target);
    await logConsentAudit(db, {
      careRecipientId: doc.owner_id,
      actorId: req.user.id,
      actorRole: "family",
      eventType: allow ? "document_shared_caregiver" : "document_unshared_caregiver",
      description: `${String(doc.document_type).replace(/_/g, " ")} ${allow ? "shared with" : "no longer shared with"} ${[who?.first_name, who?.last_name].filter(Boolean).join(" ") || "a caregiver"}`,
      metadata: { documentId: doc.id, caregiverUserId: target },
    });
    res.json({ allowed: allow });
  } catch (err) {
    console.error("Document share error:", err);
    res.status(500).json({ error: "Failed to change who can see this document" });
  }
});

module.exports = router;
