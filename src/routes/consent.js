const express = require("express");
const crypto = require("crypto");
const { v4: uuid } = require("uuid");
const { getDb } = require("../models/database");
const { authenticate } = require("../middleware/auth");

const router = express.Router();
router.use(authenticate);

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

    res.json({ verified: true, consentStatus: "verified" });
  } catch (err) {
    console.error("Verify code error:", err);
    res.status(500).json({ error: "Failed to verify code" });
  }
});

module.exports = router;
