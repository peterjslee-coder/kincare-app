const express = require("express");
const crypto = require("crypto");
const multer = require("multer");
const { v4: uuid } = require("uuid");
const { getDb } = require("../models/database");
const { authenticate } = require("../middleware/auth");

const router = express.Router();
router.use(authenticate);

// Multer for document uploads (PDF + images, 5MB max)
const uploadDoc = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ["application/pdf", "image/jpeg", "image/png", "image/gif", "image/webp"];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF and image files (JPEG, PNG, GIF, WebP) are allowed"));
    }
  },
});

// ─── Helper: check if user owns this care recipient ───
async function getOwnedRecipient(db, recipientId, userId) {
  return db.prepare(
    "SELECT * FROM care_recipients WHERE id = ? AND family_user_id = ?"
  ).get(recipientId, userId);
}

// ─── Helper: generate the attestation statement text ───
function buildAttestationText(recipientName) {
  return `I confirm that ${recipientName} is aware that I am arranging non-medical companion care services through inPlace on their behalf. I understand that ${recipientName} will be contacted directly to verify their awareness and consent before any caregiver visit is scheduled. I understand that misrepresenting this consent may result in account termination and potential legal liability.`;
}

// ─── GET /api/consent/:recipientId/status ───
// Get full consent status for a care recipient
router.get("/:recipientId/status", async (req, res) => {
  try {
    const db = await getDb();
    const recipient = await getOwnedRecipient(db, req.params.recipientId, req.user.id);
    if (!recipient) return res.status(404).json({ error: "Care recipient not found" });

    // Get attestation if exists
    const attestation = await db.prepare(
      "SELECT * FROM attestations WHERE care_recipient_id = ? ORDER BY created_at DESC LIMIT 1"
    ).get(req.params.recipientId);

    // Get active verification attempt if exists
    const verification = await db.prepare(
      "SELECT * FROM verification_attempts WHERE care_recipient_id = ? AND status = 'pending' AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1"
    ).get(req.params.recipientId);

    // Get most recent completed verification if no active one
    const completedVerification = !verification ? await db.prepare(
      "SELECT * FROM verification_attempts WHERE care_recipient_id = ? AND status = 'verified' ORDER BY verified_at DESC LIMIT 1"
    ).get(req.params.recipientId) : null;

    res.json({
      consentStatus: recipient.consent_status,
      authorizationTier: recipient.authorization_tier,
      consentMethod: recipient.consent_method,
      consentVerifiedAt: recipient.consent_verified_at,
      attestation: attestation ? {
        id: attestation.id,
        signatureName: attestation.signature_name,
        relationship: attestation.relationship_to_recipient,
        signedAt: attestation.signed_at,
      } : null,
      verification: verification ? {
        id: verification.id,
        hasActiveCode: true,
        expiresAt: verification.expires_at,
        method: verification.verification_method,
        failedAttempts: verification.failed_attempts || 0,
      } : completedVerification ? {
        id: completedVerification.id,
        hasActiveCode: false,
        verifiedAt: completedVerification.verified_at,
        method: completedVerification.verification_method,
      } : null,
    });
  } catch (err) {
    console.error("Get consent status error:", err);
    res.status(500).json({ error: "Failed to get consent status" });
  }
});

// ─── POST /api/consent/:recipientId/attest ───
// Submit attestation for a tier3 care recipient
router.post("/:recipientId/attest", async (req, res) => {
  try {
    const { signatureName, relationshipToRecipient } = req.body;

    if (!signatureName || !signatureName.trim()) {
      return res.status(400).json({ error: "Signature name is required" });
    }

    const db = await getDb();
    const recipient = await getOwnedRecipient(db, req.params.recipientId, req.user.id);
    if (!recipient) return res.status(404).json({ error: "Care recipient not found" });

    if (recipient.authorization_tier !== "tier3") {
      return res.status(400).json({ error: "Attestation is only for tier 3 authorization" });
    }

    if (recipient.consent_status !== "pending") {
      return res.status(400).json({ error: `Attestation cannot be submitted — current status is '${recipient.consent_status}'` });
    }

    const recipientName = `${recipient.first_name} ${recipient.last_name}`.trim();
    const attestationText = buildAttestationText(recipientName);

    const id = uuid();
    await db.prepare(`
      INSERT INTO attestations (id, care_recipient_id, attesting_user_id, relationship_to_recipient, attestation_text, signature_name)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, req.params.recipientId, req.user.id, relationshipToRecipient || null, attestationText, signatureName.trim());

    // Update consent status to 'attested'
    await db.prepare(
      "UPDATE care_recipients SET consent_status = 'attested', updated_at = NOW() WHERE id = ?"
    ).run(req.params.recipientId);

    // Audit log
    try {
      const { logConsentAudit } = require("./documents");
      const user = await db.prepare("SELECT first_name, last_name FROM users WHERE id = ?").get(req.user.id);
      const uName = user ? `${user.first_name} ${user.last_name}`.trim() : "Unknown";
      await logConsentAudit(db, {
        careRecipientId: req.params.recipientId, actorId: req.user.id, actorRole: "family",
        eventType: "attestation_submitted",
        description: `${uName} submitted attestation for ${recipientName} (relationship: ${relationshipToRecipient || 'not specified'})`,
        metadata: { attestationId: id, signatureName: signatureName.trim(), relationship: relationshipToRecipient },
      });
    } catch (auditErr) { console.error("Attestation audit log error:", auditErr.message); }

    res.json({
      attestation: {
        id,
        signatureName: signatureName.trim(),
        relationship: relationshipToRecipient,
        attestationText,
        signedAt: new Date().toISOString(),
      },
      consentStatus: "attested",
    });
  } catch (err) {
    console.error("Submit attestation error:", err);
    res.status(500).json({ error: "Failed to submit attestation" });
  }
});

// ─── POST /api/consent/:recipientId/generate-code ───
// Generate a 6-digit verification code
router.post("/:recipientId/generate-code", async (req, res) => {
  try {
    const db = await getDb();
    const recipient = await getOwnedRecipient(db, req.params.recipientId, req.user.id);
    if (!recipient) return res.status(404).json({ error: "Care recipient not found" });

    if (recipient.consent_status !== "attested") {
      return res.status(400).json({ error: "Attestation must be completed before generating a verification code" });
    }

    // Invalidate any existing pending codes for this recipient
    await db.prepare(
      "UPDATE verification_attempts SET status = 'expired' WHERE care_recipient_id = ? AND status = 'pending'"
    ).run(req.params.recipientId);

    // Generate cryptographically random 6-digit code
    const code = String(crypto.randomInt(100000, 999999));

    // Get the attestation ID
    const attestation = await db.prepare(
      "SELECT id FROM attestations WHERE care_recipient_id = ? ORDER BY created_at DESC LIMIT 1"
    ).get(req.params.recipientId);

    // Store in verification_attempts (72-hour expiry)
    const id = uuid();
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
    await db.prepare(`
      INSERT INTO verification_attempts (id, attestation_id, care_recipient_id, verification_code, verification_method, status, expires_at)
      VALUES (?, ?, ?, ?, 'code_entry', 'pending', ?)
    `).run(id, attestation?.id || null, req.params.recipientId, code, expiresAt);

    res.json({ code, expiresAt, verificationId: id });
  } catch (err) {
    console.error("Generate verification code error:", err);
    res.status(500).json({ error: "Failed to generate verification code" });
  }
});

// ─── POST /api/consent/:recipientId/verify-code ───
// Verify a submitted code
router.post("/:recipientId/verify-code", async (req, res) => {
  try {
    const { code } = req.body;

    if (!code || !String(code).trim()) {
      return res.status(400).json({ error: "Verification code is required" });
    }

    const db = await getDb();
    const recipient = await getOwnedRecipient(db, req.params.recipientId, req.user.id);
    if (!recipient) return res.status(404).json({ error: "Care recipient not found" });

    // Find the active (pending, unexpired) verification attempt
    const attempt = await db.prepare(
      "SELECT * FROM verification_attempts WHERE care_recipient_id = ? AND status = 'pending' AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1"
    ).get(req.params.recipientId);

    if (!attempt) {
      return res.status(400).json({ error: "No active verification code. Please generate a new one." });
    }

    // Check failed attempts (max 5)
    const failedAttempts = attempt.failed_attempts || 0;
    if (failedAttempts >= 5) {
      // Auto-expire this code
      await db.prepare(
        "UPDATE verification_attempts SET status = 'expired' WHERE id = ?"
      ).run(attempt.id);
      return res.status(400).json({ error: "Too many failed attempts. Please generate a new code.", attemptsRemaining: 0 });
    }

    // Check code match
    if (String(code).trim() !== attempt.verification_code) {
      // Increment failed attempts
      const newFailed = failedAttempts + 1;
      await db.prepare(
        "UPDATE verification_attempts SET failed_attempts = ?, attempted_at = NOW() WHERE id = ?"
      ).run(newFailed, attempt.id);

      const remaining = 5 - newFailed;
      if (remaining <= 0) {
        await db.prepare(
          "UPDATE verification_attempts SET status = 'expired' WHERE id = ?"
        ).run(attempt.id);
      }

      return res.status(400).json({
        error: "Incorrect verification code",
        attemptsRemaining: Math.max(0, remaining),
      });
    }

    // Code matches — mark verified
    await db.prepare(
      "UPDATE verification_attempts SET status = 'verified', verified_at = NOW(), attempted_at = NOW() WHERE id = ?"
    ).run(attempt.id);

    // Update care recipient consent
    await db.prepare(`
      UPDATE care_recipients SET
        consent_status = 'verified',
        consent_method = 'attestation_code',
        consent_verified_at = NOW(),
        updated_at = NOW()
      WHERE id = ?
    `).run(req.params.recipientId);

    // Audit log
    try {
      const { logConsentAudit } = require("./documents");
      const recipientName = `${recipient.first_name} ${recipient.last_name}`.trim();
      await logConsentAudit(db, {
        careRecipientId: req.params.recipientId, actorId: req.user.id, actorRole: "family",
        eventType: "code_verified",
        description: `Verification code confirmed for ${recipientName}. Consent verified via attestation + code.`,
        metadata: { verificationAttemptId: attempt.id },
      });
      await logConsentAudit(db, {
        careRecipientId: req.params.recipientId, actorId: "system", actorRole: "system",
        eventType: "consent_granted",
        description: `Consent granted for ${recipientName} via attestation + code verification`,
        metadata: { method: "attestation_code", tier: recipient.authorization_tier },
      });
    } catch (auditErr) { console.error("Verify-code audit log error:", auditErr.message); }

    res.json({ verified: true, consentStatus: "verified" });
  } catch (err) {
    console.error("Verify code error:", err);
    res.status(500).json({ error: "Failed to verify code" });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// Tier 2 — Authorization Document Upload (POA / Guardianship)
// ═══════════════════════════════════════════════════════════════════════

const VALID_DOC_TYPES = ["POA", "Legal_Guardianship", "Court_Order", "Other"];

// ─── POST /api/consent/:recipientId/documents ───
// Upload an authorization document (tier2)
router.post("/:recipientId/documents", uploadDoc.single("document"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded. Please select a PDF or image file." });
    }

    const documentType = req.body.document_type || req.body.documentType;
    if (!documentType || !VALID_DOC_TYPES.includes(documentType)) {
      return res.status(400).json({ error: `Invalid document type. Must be one of: ${VALID_DOC_TYPES.join(", ")}` });
    }

    const db = await getDb();
    const recipient = await getOwnedRecipient(db, req.params.recipientId, req.user.id);
    if (!recipient) return res.status(404).json({ error: "Care recipient not found" });

    if (recipient.authorization_tier !== "tier2") {
      return res.status(400).json({ error: "Document upload is only for tier 2 (POA/Guardian) authorization" });
    }

    // Convert to base64 data URI
    const base64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;

    const id = uuid();
    await db.prepare(`
      INSERT INTO authorization_documents (id, care_recipient_id, submitted_by, document_type, file_data, file_name, file_size, mime_type, upload_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'uploaded')
    `).run(id, req.params.recipientId, req.user.id, documentType, base64, req.file.originalname, req.file.size, req.file.mimetype);

    // ─── Dual-write to verified_documents + AI classification ───
    let aiResult = null;
    try {
      const { classifyDocument } = require("../utils/documentAI");
      const { logConsentAudit } = require("./documents");
      const vDocId = uuid();

      await db.prepare(`
        INSERT INTO verified_documents (id, owner_type, owner_id, uploaded_by, category, document_type,
          file_data, file_name, file_size, mime_type, status, created_at, updated_at)
        VALUES (?, 'care_recipient', ?, ?, 'consent', ?, ?, ?, ?, ?, 'ai_review', NOW(), NOW())
      `).run(vDocId, req.params.recipientId, req.user.id, documentType, base64, req.file.originalname, req.file.size, req.file.mimetype);

      aiResult = await classifyDocument(base64, req.file.mimetype, documentType);
      const aiStatus = (!aiResult.skipped && !aiResult.error && (!aiResult.isValid || !aiResult.matchesClaimed || aiResult.confidence < 0.5))
        ? "ai_flagged" : "pending";

      await db.prepare(`
        UPDATE verified_documents SET status = ?, ai_classification = ?, ai_reviewed_at = NOW(), updated_at = NOW() WHERE id = ?
      `).run(aiStatus, JSON.stringify(aiResult), vDocId);

      // Audit log entries
      const uploaderName = await db.prepare("SELECT first_name, last_name FROM users WHERE id = ?").get(req.user.id);
      const uName = uploaderName ? `${uploaderName.first_name} ${uploaderName.last_name}`.trim() : "Unknown";
      const rName = `${recipient.first_name} ${recipient.last_name}`.trim();
      await logConsentAudit(db, {
        careRecipientId: req.params.recipientId, actorId: req.user.id, actorRole: "family",
        eventType: "document_uploaded",
        description: `${uName} uploaded ${documentType.replace(/_/g, " ")} document for ${rName}`,
        metadata: { documentId: vDocId, documentType, aiConfidence: aiResult.confidence, aiStatus },
      });
      if (!aiResult.skipped && !aiResult.error) {
        await logConsentAudit(db, {
          careRecipientId: req.params.recipientId, actorId: "system", actorRole: "ai",
          eventType: "document_classified",
          description: `AI classified as "${aiResult.classification}" (${Math.round(aiResult.confidence * 100)}% confidence). ${aiResult.summary}`,
          metadata: { documentId: vDocId, classification: aiResult.classification, confidence: aiResult.confidence, concerns: aiResult.concerns },
        });
      }
    } catch (dualWriteErr) {
      console.error("Dual-write to verified_documents failed (non-fatal):", dualWriteErr.message);
    }

    res.json({
      document: {
        id,
        documentType,
        fileName: req.file.originalname,
        fileSize: req.file.size,
        mimeType: req.file.mimetype,
        uploadStatus: "uploaded",
        uploadedAt: new Date().toISOString(),
        aiClassification: aiResult,
      },
    });
  } catch (err) {
    console.error("Document upload error:", err);
    if (err.message && err.message.includes("Only PDF")) {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: "Failed to upload document" });
  }
});

// ─── GET /api/consent/:recipientId/documents ───
// List documents for a care recipient (metadata only, no file_data)
router.get("/:recipientId/documents", async (req, res) => {
  try {
    const db = await getDb();
    const recipient = await getOwnedRecipient(db, req.params.recipientId, req.user.id);
    if (!recipient) return res.status(404).json({ error: "Care recipient not found" });

    const docs = await db.prepare(`
      SELECT id, document_type, file_name, file_size, mime_type, upload_status, admin_notes, reviewed_at, created_at
      FROM authorization_documents
      WHERE care_recipient_id = ?
      ORDER BY created_at DESC
    `).all(req.params.recipientId);

    res.json({ documents: docs });
  } catch (err) {
    console.error("List documents error:", err);
    res.status(500).json({ error: "Failed to list documents" });
  }
});

// ─── GET /api/consent/:recipientId/documents/:docId/download ───
// Download a document (binary response)
router.get("/:recipientId/documents/:docId/download", async (req, res) => {
  try {
    const db = await getDb();

    // Allow both family owner and admin to download
    const isAdmin = req.user.role === "admin";
    if (!isAdmin) {
      const recipient = await getOwnedRecipient(db, req.params.recipientId, req.user.id);
      if (!recipient) return res.status(404).json({ error: "Care recipient not found" });
    }

    const doc = await db.prepare(
      "SELECT file_data, mime_type, file_name FROM authorization_documents WHERE id = ? AND care_recipient_id = ?"
    ).get(req.params.docId, req.params.recipientId);

    if (!doc) return res.status(404).json({ error: "Document not found" });

    // Strip data URI prefix and decode base64
    const base64Data = doc.file_data.replace(/^data:[^;]+;base64,/, "");
    const buffer = Buffer.from(base64Data, "base64");

    res.set({
      "Content-Type": doc.mime_type,
      "Content-Disposition": `attachment; filename="${doc.file_name}"`,
      "Content-Length": buffer.length,
    });
    res.send(buffer);
  } catch (err) {
    console.error("Document download error:", err);
    res.status(500).json({ error: "Failed to download document" });
  }
});

// ─── DELETE /api/consent/:recipientId/documents/:docId ───
// Delete a document (only if not yet approved)
router.delete("/:recipientId/documents/:docId", async (req, res) => {
  try {
    const db = await getDb();
    const recipient = await getOwnedRecipient(db, req.params.recipientId, req.user.id);
    if (!recipient) return res.status(404).json({ error: "Care recipient not found" });

    const doc = await db.prepare(
      "SELECT id, upload_status FROM authorization_documents WHERE id = ? AND care_recipient_id = ?"
    ).get(req.params.docId, req.params.recipientId);

    if (!doc) return res.status(404).json({ error: "Document not found" });

    if (doc.upload_status === "approved") {
      return res.status(403).json({ error: "Cannot delete an approved document" });
    }

    await db.prepare("DELETE FROM authorization_documents WHERE id = ?").run(req.params.docId);

    res.json({ success: true });
  } catch (err) {
    console.error("Document delete error:", err);
    res.status(500).json({ error: "Failed to delete document" });
  }
});

module.exports = router;
