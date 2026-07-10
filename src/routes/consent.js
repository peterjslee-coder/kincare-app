const express = require("express");
const crypto = require("crypto");
const multer = require("multer");
const { v4: uuid } = require("uuid");
const { getDb } = require("../models/database");
const { authenticate } = require("../middleware/auth");

// Lazy-loaded to avoid circular dependency (documents.js may require consent patterns)
let _logConsentAudit;
function getLogConsentAudit() {
  if (!_logConsentAudit) {
    _logConsentAudit = require("./documents").logConsentAudit;
  }
  return _logConsentAudit;
}

// Helper: extract client IP (respects Railway/proxy X-Forwarded-For)
function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.connection?.remoteAddress || req.socket?.remoteAddress || null;
}

const router = express.Router();
// NOTE: authenticate is applied per-route (not globally) because
// the /respond/:token endpoints must be PUBLIC (care recipients
// click email links without an account).

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
  return `I confirm that ${recipientName} is aware that I am arranging non-medical companion care services through inPlace on their behalf. I understand that ${recipientName} will be contacted directly by inPlace to verify their awareness and consent before any caregiver visit is scheduled. I understand that misrepresenting this consent may result in immediate account termination, referral to appropriate authorities, and potential legal liability under Virginia law.`;
}

// ─── GET /api/consent/:recipientId/status ───
// Get full consent status for a care recipient
router.get("/:recipientId/status", authenticate, async (req, res) => {
  try {
    const db = await getDb();
    const recipient = await getOwnedRecipient(db, req.params.recipientId, req.user.id);
    if (!recipient) return res.status(404).json({ error: "Care recipient not found" });

    // Get attestation if exists
    const attestation = await db.prepare(
      "SELECT * FROM attestations WHERE care_recipient_id = ? ORDER BY created_at DESC LIMIT 1"
    ).get(req.params.recipientId);

    // Get outreach record if exists
    const outreach = await db.prepare(
      "SELECT * FROM consent_outreach WHERE care_recipient_id = ? ORDER BY created_at DESC LIMIT 1"
    ).get(req.params.recipientId);

    res.json({
      consentStatus: recipient.consent_status,
      authorizationTier: recipient.authorization_tier,
      consentMethod: recipient.consent_method,
      consentVerifiedAt: recipient.consent_verified_at,
      consentNotes: recipient.consent_notes,
      recipientEmail: recipient.email,
      recipientPhone: recipient.sms_phone,
      bookingsPaused: !!recipient.bookings_paused,
      attestation: attestation ? {
        id: attestation.id,
        signatureName: attestation.signature_name,
        relationship: attestation.relationship_to_recipient,
        signedAt: attestation.signed_at,
        adminStatus: attestation.admin_status || 'pending',
        adminNotes: attestation.admin_notes,
      } : null,
      outreach: outreach ? {
        id: outreach.id,
        sentAt: outreach.created_at,
        sentToEmail: outreach.sent_to_email,
        sentToPhone: outreach.sent_to_phone,
        outreachType: outreach.outreach_type,
        recipientResponse: outreach.recipient_response,
        recipientResponseNotes: outreach.recipient_response_notes,
        respondedAt: outreach.responded_at,
        expiresAt: outreach.expires_at,
        isExpired: outreach.expires_at && new Date(outreach.expires_at) < new Date(),
      } : null,
    });
  } catch (err) {
    console.error("Get consent status error:", err);
    res.status(500).json({ error: "Failed to get consent status" });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// Tier 3 — Family Attestation + Direct Outreach + Admin Review
// ═══════════════════════════════════════════════════════════════════════

// ─── POST /api/consent/:recipientId/attest ───
// Submit attestation for a tier3 care recipient
// NOW ALSO collects care recipient contact info for direct outreach
router.post("/:recipientId/attest", authenticate, async (req, res) => {
  try {
    const { signatureName, relationshipToRecipient, recipientEmail, recipientPhone } = req.body;

    if (!signatureName || !signatureName.trim()) {
      return res.status(400).json({ error: "Signature name is required" });
    }

    if (!relationshipToRecipient) {
      return res.status(400).json({ error: "Please select your relationship to the care recipient" });
    }

    // Require at least one contact method for the care recipient
    const hasEmail = recipientEmail && recipientEmail.trim();
    const hasPhone = recipientPhone && recipientPhone.trim();
    if (!hasEmail && !hasPhone) {
      return res.status(400).json({ error: "Please provide an email address or phone number for the care recipient so we can verify their awareness." });
    }

    const db = await getDb();
    const recipient = await getOwnedRecipient(db, req.params.recipientId, req.user.id);
    if (!recipient) return res.status(404).json({ error: "Care recipient not found" });

    if (recipient.authorization_tier !== "tier3") {
      return res.status(400).json({ error: "Attestation is only for tier 3 authorization" });
    }

    if (recipient.consent_status === "verified") {
      return res.status(400).json({ error: "Consent is already verified" });
    }

    // Rate limiting: max 3 care recipients per family account
    const recipientCount = await db.prepare(
      "SELECT COUNT(*) as cnt FROM care_recipients WHERE family_user_id = ? AND authorization_tier = 'tier3'"
    ).get(req.user.id);
    if (recipientCount.cnt > 3) {
      return res.status(400).json({ error: "You've reached the maximum number of care recipients. Please contact support for additional accounts." });
    }

    // Save care recipient contact info
    if (hasEmail) {
      await db.prepare("UPDATE care_recipients SET email = ?, updated_at = NOW() WHERE id = ?")
        .run(recipientEmail.trim(), req.params.recipientId);
    }
    if (hasPhone) {
      await db.prepare("UPDATE care_recipients SET sms_phone = ?, updated_at = NOW() WHERE id = ?")
        .run(recipientPhone.trim(), req.params.recipientId);
    }

    const recipientName = `${recipient.first_name} ${recipient.last_name}`.trim();
    const attestationText = buildAttestationText(recipientName);

    const id = uuid();
    const attesterIp = getClientIp(req);
    await db.prepare(`
      INSERT INTO attestations (id, care_recipient_id, attesting_user_id, relationship_to_recipient, attestation_text, signature_name, admin_status, attester_ip)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
    `).run(id, req.params.recipientId, req.user.id, relationshipToRecipient, attestationText, signatureName.trim(), attesterIp);

    // Update consent status to 'attested'
    await db.prepare(
      "UPDATE care_recipients SET consent_status = 'attested', updated_at = NOW() WHERE id = ?"
    ).run(req.params.recipientId);

    // Audit log
    try {
      const logConsentAudit = getLogConsentAudit();
      const user = await db.prepare("SELECT first_name, last_name FROM users WHERE id = ?").get(req.user.id);
      const uName = user ? `${user.first_name} ${user.last_name}`.trim() : "Unknown";
      await logConsentAudit(db, {
        careRecipientId: req.params.recipientId, actorId: req.user.id, actorRole: "family",
        eventType: "attestation_submitted",
        description: `${uName} submitted attestation for ${recipientName} (relationship: ${relationshipToRecipient})`,
        metadata: { attestationId: id, signatureName: signatureName.trim(), relationship: relationshipToRecipient, recipientContactProvided: { email: !!hasEmail, phone: !!hasPhone } },
      });
    } catch (auditErr) { console.error("Attestation audit log error:", auditErr.message); }

    res.json({
      attestation: {
        id,
        signatureName: signatureName.trim(),
        relationship: relationshipToRecipient,
        attestationText,
        signedAt: new Date().toISOString(),
        adminStatus: "pending",
      },
      consentStatus: "attested",
    });
  } catch (err) {
    console.error("Submit attestation error:", err);
    res.status(500).json({ error: "Failed to submit attestation" });
  }
});

// ─── POST /api/consent/:recipientId/send-outreach ───
// Send a verification email/notification directly to the care recipient
// This replaces the old generate-code endpoint
router.post("/:recipientId/send-outreach", authenticate, async (req, res) => {
  try {
    const db = await getDb();
    const recipient = await getOwnedRecipient(db, req.params.recipientId, req.user.id);
    if (!recipient) return res.status(404).json({ error: "Care recipient not found" });

    if (recipient.consent_status !== "attested") {
      return res.status(400).json({ error: "Attestation must be completed before sending outreach" });
    }

    const recipientEmail = recipient.email;
    if (!recipientEmail) {
      return res.status(400).json({ error: "No email address on file for the care recipient. Please provide one during attestation." });
    }

    // Get the attestation
    const attestation = await db.prepare(
      "SELECT id FROM attestations WHERE care_recipient_id = ? ORDER BY created_at DESC LIMIT 1"
    ).get(req.params.recipientId);

    // Generate a unique outreach token (for the response page)
    const outreachToken = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days

    // Invalidate any existing pending outreach for this recipient
    await db.prepare(
      "UPDATE consent_outreach SET expires_at = NOW() WHERE care_recipient_id = ? AND recipient_response IS NULL AND expires_at > NOW()"
    ).run(req.params.recipientId);

    const id = uuid();
    await db.prepare(`
      INSERT INTO consent_outreach (id, care_recipient_id, attestation_id, sent_to_email, outreach_type, outreach_token, expires_at)
      VALUES (?, ?, ?, ?, 'email', ?, ?)
    `).run(id, req.params.recipientId, attestation?.id || null, recipientEmail, outreachToken, expiresAt);

    // Get family member info for the email
    const familyUser = await db.prepare("SELECT first_name, last_name FROM users WHERE id = ?").get(req.user.id);
    const familyName = familyUser ? `${familyUser.first_name} ${familyUser.last_name}`.trim() : "A family member";
    const recipientFirstName = recipient.first_name || "there";
    const recipientName = `${recipient.first_name} ${recipient.last_name}`.trim();

    // Get relationship from attestation
    const fullAttestation = await db.prepare(
      "SELECT relationship_to_recipient FROM attestations WHERE care_recipient_id = ? ORDER BY created_at DESC LIMIT 1"
    ).get(req.params.recipientId);
    const relationship = fullAttestation?.relationship_to_recipient || "family member";

    // Send branded email to the care recipient
    const { sendEmail, brandedHtml } = require("../utils/email");
    const baseUrl = process.env.APP_URL || "https://yourinplace.com";
    const responseUrl = `${baseUrl}/?consent-response=${outreachToken}`;

    const emailHtml = brandedHtml({
      title: "InPlace — Care Arrangement",
      greeting: `Hi ${recipientFirstName},`,
      body: `Your ${relationship.toLowerCase()}, <strong>${familyName}</strong>, has arranged non-medical companion care for you through InPlace.<br><br>` +
        `<strong>What is InPlace?</strong><br>` +
        `InPlace connects families with trusted, local caregivers who provide companionship, help around the house, and other non-medical assistance. ` +
        `This is <em>not</em> medical care — it's friendly, professional help with daily living.<br><br>` +
        `<strong>What happens next?</strong><br>` +
        `If you're comfortable with this arrangement, please click the button below to let us know. ` +
        `If you have questions or concerns, you can also let us know and someone from our team will reach out to you personally.<br><br>` +
        `You can also simply ignore this email — no caregiver will visit without your knowledge.`,
      ctaUrl: responseUrl,
      ctaText: "Respond to This Arrangement",
      footnote: `This email was sent because ${familyName} indicated you are aware of this care arrangement. ` +
        `If you did not expect this email, please ignore it or <a href="${responseUrl}">let us know</a>. ` +
        `Questions? Reply to this email or contact us at support@yourinplace.com.`,
    });

    const emailResult = await sendEmail({
      to: recipientEmail,
      subject: `${familyName} has arranged care for you through InPlace`,
      html: emailHtml,
    });

    // Audit log
    try {
      const logConsentAudit = getLogConsentAudit();
      await logConsentAudit(db, {
        careRecipientId: req.params.recipientId, actorId: "system", actorRole: "system",
        eventType: "outreach_sent",
        description: `Verification email sent to ${recipientEmail} for ${recipientName}`,
        metadata: { outreachId: id, sentTo: recipientEmail, emailSuccess: emailResult.success },
      });
    } catch (auditErr) { console.error("Outreach audit log error:", auditErr.message); }

    // Notify admin (Pete) that a new tier 3 attestation needs review
    try {
      const adminUsers = await db.prepare("SELECT id FROM users WHERE is_admin = 1").all();
      for (const admin of adminUsers) {
        await db.prepare(`
          INSERT INTO activity_feed (id, family_user_id, event_type, title, message, metadata, created_at)
          VALUES (?, ?, 'consent_review_needed', 'Consent Review Needed', ?, ?, NOW())
        `).run(
          uuid(), admin.id,
          `${familyName} submitted a Tier 3 attestation for ${recipientName}. Outreach email sent to ${recipientEmail}. Please review in the Admin panel.`,
          JSON.stringify({ recipientId: req.params.recipientId, attestationId: attestation?.id, outreachId: id })
        );
      }
    } catch (notifyErr) { console.error("Admin notification error:", notifyErr.message); }

    res.json({
      outreach: {
        id,
        sentToEmail: recipientEmail,
        outreachType: "email",
        expiresAt,
        emailSent: emailResult.success,
      },
      message: emailResult.success
        ? `A verification email has been sent to ${recipientEmail}. Our team will review your attestation and their response.`
        : `We were unable to send the verification email right now, but your attestation has been submitted for admin review.`,
    });
  } catch (err) {
    console.error("Send outreach error:", err);
    res.status(500).json({ error: "Failed to send outreach" });
  }
});

// ─── GET /api/consent/respond/:token ───
// PUBLIC endpoint (no auth) — care recipient responds to outreach
// This is hit from the email link
router.get("/respond/:token", async (req, res) => {
  try {
    const db = await getDb();
    const outreach = await db.prepare(
      "SELECT co.*, cr.first_name, cr.last_name, cr.sms_phone FROM consent_outreach co JOIN care_recipients cr ON cr.id = co.care_recipient_id WHERE co.outreach_token = ?"
    ).get(req.params.token);

    if (!outreach) {
      return res.status(404).json({ error: "This verification link is not valid." });
    }

    if (outreach.expires_at && new Date(outreach.expires_at) < new Date()) {
      return res.json({ expired: true, recipientName: outreach.first_name, message: "This verification link has expired. Please ask your family member to send a new one." });
    }

    if (outreach.recipient_response) {
      return res.json({ alreadyResponded: true, recipientName: outreach.first_name, response: outreach.recipient_response });
    }

    // Capture responder IP and compare with attester IP
    const responderIp = getClientIp(req);
    let ipMatch = false;
    if (responderIp) {
      await db.prepare("UPDATE consent_outreach SET responder_ip = ? WHERE id = ?").run(responderIp, outreach.id);
      // Compare with attester IP
      const attestation = await db.prepare(
        "SELECT attester_ip FROM attestations WHERE id = ?"
      ).get(outreach.attestation_id);
      if (attestation?.attester_ip && attestation.attester_ip === responderIp) {
        ipMatch = true;
        await db.prepare("UPDATE consent_outreach SET ip_match_flag = 1 WHERE id = ?").run(outreach.id);
      }
    }

    // Get family member info
    const attestation = await db.prepare(
      "SELECT a.*, u.first_name as family_first, u.last_name as family_last, a.relationship_to_recipient FROM attestations a JOIN users u ON u.id = a.attesting_user_id WHERE a.id = ?"
    ).get(outreach.attestation_id);

    // Mask phone number for display (e.g., (•••) •••-7472)
    const phone = outreach.sms_phone;
    let maskedPhone = null;
    if (phone) {
      const digits = phone.replace(/\D/g, "");
      const last4 = digits.slice(-4);
      maskedPhone = `(•••) •••-${last4}`;
    }

    res.json({
      valid: true,
      recipientName: outreach.first_name,
      familyMemberName: attestation ? `${attestation.family_first} ${attestation.family_last}`.trim() : "A family member",
      relationship: attestation?.relationship_to_recipient || "family member",
      phoneVerificationRequired: true,
      phoneAvailable: !!phone,
      maskedPhone,
      phoneVerified: !!outreach.phone_verified_at,
      ipMatch,
    });
  } catch (err) {
    console.error("Consent respond (GET) error:", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// ─── POST /api/consent/respond/:token/send-code ───
// PUBLIC — Send phone verification code to care recipient's phone
router.post("/respond/:token/send-code", async (req, res) => {
  try {
    const { method } = req.body; // 'sms' or 'voice'
    const db = await getDb();
    const outreach = await db.prepare(
      "SELECT co.*, cr.sms_phone, cr.first_name FROM consent_outreach co JOIN care_recipients cr ON cr.id = co.care_recipient_id WHERE co.outreach_token = ?"
    ).get(req.params.token);

    if (!outreach) return res.status(404).json({ error: "Invalid verification link." });
    if (outreach.recipient_response) return res.status(400).json({ error: "Already responded." });
    if (!outreach.sms_phone) return res.status(400).json({ error: "No phone number on file for verification." });

    // Rate limit: max 5 codes per outreach per hour
    const recentCodes = await db.prepare(
      "SELECT COUNT(*) as cnt FROM consent_outreach WHERE id = ? AND phone_verification_sent_at > NOW() - INTERVAL '1 hour'"
    ).get(outreach.id);
    // Simple: just check the single record's sent_at
    if (outreach.phone_verification_sent_at) {
      const lastSent = new Date(outreach.phone_verification_sent_at);
      const cooldown = 60 * 1000; // 60 seconds between codes
      if (Date.now() - lastSent.getTime() < cooldown) {
        return res.status(429).json({ error: "Please wait before requesting another code.", retryAfter: Math.ceil((cooldown - (Date.now() - lastSent.getTime())) / 1000) });
      }
    }

    // Generate 6-digit code
    const code = String(Math.floor(100000 + Math.random() * 900000));

    // Store code
    await db.prepare(
      "UPDATE consent_outreach SET phone_verification_code = ?, phone_verification_sent_at = NOW(), phone_verification_required = 1 WHERE id = ?"
    ).run(code, outreach.id);

    // Send via SMS or voice
    const { sendSms } = require("../utils/sms");
    if (method === "voice") {
      // Use Twilio voice call to read the code
      try {
        const twilio = require("twilio");
        const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        const { formatPhoneE164 } = require("../utils/sms");
        const formattedPhone = formatPhoneE164(outreach.sms_phone);
        if (formattedPhone) {
          const twiml = `<Response><Say voice="Polly.Joanna">Hello ${outreach.first_name}. Your InPlace verification code is: ${code.split("").join(", ")}. Again, your code is: ${code.split("").join(", ")}. Thank you.</Say></Response>`;
          await client.calls.create({
            twiml,
            from: process.env.TWILIO_FROM_NUMBER,
            to: formattedPhone,
          });
          console.log(`  [consent] Voice verification code sent to ${formattedPhone}`);
          res.json({ success: true, method: "voice", message: `We're calling your phone now. Listen for your verification code.` });
        } else {
          res.status(400).json({ error: "Invalid phone number on file." });
        }
      } catch (voiceErr) {
        console.error("Voice call error:", voiceErr.message);
        // Fall back to SMS
        const smsResult = await sendSms(outreach.sms_phone, `Your InPlace verification code is: ${code}. Enter this code to confirm your care arrangement.`);
        res.json({ success: smsResult.success, method: "sms", message: smsResult.success ? "Code sent via text message." : "Unable to send code. Please try again." });
      }
    } else {
      // Default: SMS
      const smsResult = await sendSms(outreach.sms_phone, `Your InPlace verification code is: ${code}. Enter this code to confirm your care arrangement.`);
      res.json({ success: smsResult.success, method: "sms", message: smsResult.success ? "Code sent to your phone via text." : "Unable to send code. Please try again." });
    }
  } catch (err) {
    console.error("Send verification code error:", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// ─── POST /api/consent/respond/:token/verify-code ───
// PUBLIC — Verify phone code before allowing response submission
router.post("/respond/:token/verify-code", async (req, res) => {
  try {
    const { code } = req.body;
    if (!code || !code.trim()) return res.status(400).json({ error: "Please enter the verification code." });

    const db = await getDb();
    const outreach = await db.prepare(
      "SELECT * FROM consent_outreach WHERE outreach_token = ?"
    ).get(req.params.token);

    if (!outreach) return res.status(404).json({ error: "Invalid verification link." });
    if (outreach.phone_verified_at) return res.json({ success: true, alreadyVerified: true });

    if (!outreach.phone_verification_code) {
      return res.status(400).json({ error: "No code has been sent yet. Please request a code first." });
    }

    // Code expires after 10 minutes
    const sentAt = new Date(outreach.phone_verification_sent_at);
    if (Date.now() - sentAt.getTime() > 10 * 60 * 1000) {
      return res.status(400).json({ error: "This code has expired. Please request a new one." });
    }

    if (code.trim() !== outreach.phone_verification_code) {
      return res.status(400).json({ error: "Incorrect code. Please try again." });
    }

    // Mark phone as verified
    await db.prepare("UPDATE consent_outreach SET phone_verified_at = NOW() WHERE id = ?").run(outreach.id);

    // Audit log
    try {
      const logConsentAudit = getLogConsentAudit();
      const recipient = await db.prepare("SELECT first_name, last_name FROM care_recipients WHERE id = ?").get(outreach.care_recipient_id);
      const rName = recipient ? `${recipient.first_name} ${recipient.last_name}`.trim() : "Unknown";
      await logConsentAudit(db, {
        careRecipientId: outreach.care_recipient_id, actorId: "care_recipient", actorRole: "care_recipient",
        eventType: "phone_verified",
        description: `${rName} verified their phone number via code entry${outreach.ip_match_flag ? " (IP match flagged — same device as attester)" : ""}`,
        metadata: { outreachId: outreach.id, ipMatchFlag: !!outreach.ip_match_flag },
      });
    } catch (auditErr) { console.error("Phone verify audit error:", auditErr.message); }

    res.json({ success: true });
  } catch (err) {
    console.error("Verify code error:", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// ─── POST /api/consent/respond/:token ───
// PUBLIC endpoint (no auth) — care recipient submits their response
// NOW REQUIRES phone verification first
router.post("/respond/:token", async (req, res) => {
  try {
    const { response, notes } = req.body;

    if (!response || !["yes_aware", "have_questions", "did_not_authorize"].includes(response)) {
      return res.status(400).json({ error: "Please select a response" });
    }

    const db = await getDb();
    const outreach = await db.prepare(
      "SELECT * FROM consent_outreach WHERE outreach_token = ?"
    ).get(req.params.token);

    if (!outreach) {
      return res.status(404).json({ error: "This verification link is not valid." });
    }

    if (outreach.expires_at && new Date(outreach.expires_at) < new Date()) {
      return res.status(400).json({ error: "This verification link has expired." });
    }

    if (outreach.recipient_response) {
      return res.status(400).json({ error: "You've already responded to this verification." });
    }

    // Require phone verification before accepting response
    if (!outreach.phone_verified_at) {
      return res.status(403).json({ error: "Phone verification required. Please verify your phone number first." });
    }

    // Record the response
    await db.prepare(`
      UPDATE consent_outreach SET recipient_response = ?, recipient_response_notes = ?, responded_at = NOW()
      WHERE id = ?
    `).run(response, notes || null, outreach.id);

    // Audit log
    try {
      const logConsentAudit = getLogConsentAudit();
      const recipient = await db.prepare("SELECT first_name, last_name FROM care_recipients WHERE id = ?").get(outreach.care_recipient_id);
      const rName = recipient ? `${recipient.first_name} ${recipient.last_name}`.trim() : "Unknown";
      const responseLabels = { yes_aware: "Yes, I'm aware", have_questions: "I have questions", did_not_authorize: "I did not authorize this" };
      await logConsentAudit(db, {
        careRecipientId: outreach.care_recipient_id, actorId: "care_recipient", actorRole: "care_recipient",
        eventType: "outreach_response",
        description: `${rName} responded to consent outreach: "${responseLabels[response]}"${notes ? ` — "${notes}"` : ""}`,
        metadata: { outreachId: outreach.id, response, notes },
      });
    } catch (auditErr) { console.error("Outreach response audit error:", auditErr.message); }

    // Notify admin of the response
    try {
      const recipient = await db.prepare("SELECT first_name, last_name FROM care_recipients WHERE id = ?").get(outreach.care_recipient_id);
      const rName = recipient ? `${recipient.first_name} ${recipient.last_name}`.trim() : "Unknown";
      const responseLabels = { yes_aware: "Yes, I'm aware", have_questions: "I have questions", did_not_authorize: "I did not authorize this" };
      const adminUsers = await db.prepare("SELECT id FROM users WHERE is_admin = 1").all();
      const urgency = response === "did_not_authorize" ? " ⚠️ URGENT:" : "";
      const ipWarning = outreach.ip_match_flag ? " 🚨 SAME IP as attester — response came from same device/network." : "";
      for (const admin of adminUsers) {
        await db.prepare(`
          INSERT INTO activity_feed (id, family_user_id, event_type, title, message, metadata, created_at)
          VALUES (?, ?, 'consent_response_received', 'Consent Response Received', ?, ?, NOW())
        `).run(
          uuid(), admin.id,
          `${urgency} ${rName} responded to consent outreach: "${responseLabels[response]}"${ipWarning}${notes ? ` — Notes: "${notes}"` : ""}`,
          JSON.stringify({ recipientId: outreach.care_recipient_id, outreachId: outreach.id, response, ipMatch: !!outreach.ip_match_flag })
        );
      }

      // If "did_not_authorize" — immediately pause bookings and alert
      if (response === "did_not_authorize") {
        await db.prepare(`
          UPDATE care_recipients SET bookings_paused = 1, bookings_paused_reason = 'Care recipient reported they did not authorize this arrangement', updated_at = NOW()
          WHERE id = ?
        `).run(outreach.care_recipient_id);
      }

      // ── Notify the FAMILY MEMBER who set up this care recipient ──
      const careRecipient = await db.prepare(
        "SELECT family_user_id, first_name, last_name FROM care_recipients WHERE id = ?"
      ).get(outreach.care_recipient_id);
      if (careRecipient?.family_user_id) {
        const familyUser = await db.prepare(
          "SELECT id, email, first_name FROM users WHERE id = ?"
        ).get(careRecipient.family_user_id);
        const crName = `${careRecipient.first_name} ${careRecipient.last_name}`.trim();

        if (familyUser) {
          // Activity feed notification
          const familyTitles = {
            yes_aware: `${crName} confirmed awareness`,
            have_questions: `${crName} has questions about their care`,
            did_not_authorize: `${crName} did not authorize care`,
          };
          const familyMessages = {
            yes_aware: `${crName} responded to the care verification email and confirmed they are aware of the care arrangement. Verification is progressing.`,
            have_questions: `${crName} has questions about their care arrangement. Our team will follow up, but you may want to talk with ${careRecipient.first_name} directly.${notes ? ` Their message: "${notes}"` : ""}`,
            did_not_authorize: `${crName} responded that they did not authorize this care arrangement. Bookings have been automatically paused. Please contact our team or speak with ${careRecipient.first_name} to resolve this.${notes ? ` Their message: "${notes}"` : ""}`,
          };
          await db.prepare(`
            INSERT INTO activity_feed (id, family_user_id, event_type, title, message, metadata, created_at)
            VALUES (?, ?, 'consent_response_family', ?, ?, ?, NOW())
          `).run(
            uuid(), familyUser.id,
            familyTitles[response] || "Care verification update",
            familyMessages[response] || `${crName} responded to the care verification outreach.`,
            JSON.stringify({ recipientId: outreach.care_recipient_id, response })
          );

          // Email notification to family member
          try {
            const { sendEmail, brandedHtml } = require("../utils/email");
            const emailSubjects = {
              yes_aware: `${crName} confirmed — care verification progressing`,
              have_questions: `${crName} has questions about their care`,
              did_not_authorize: `Action needed: ${crName} did not authorize care`,
            };
            const emailBodies = {
              yes_aware: `
                <p>Good news! <strong>${crName}</strong> responded to the care verification email and confirmed they are aware of the care arrangement you set up through inPlace.</p>
                <p>Our team will complete the review process. You'll be notified when everything is approved and you can begin scheduling care.</p>
              `,
              have_questions: `
                <p><strong>${crName}</strong> received the care verification email and has some questions before confirming.</p>
                ${notes ? `<p>Their message: <em>"${notes}"</em></p>` : ""}
                <p>Our team will reach out to ${careRecipient.first_name}, but it may help if you speak with them directly to explain how inPlace works and answer any concerns.</p>
              `,
              did_not_authorize: `
                <p><strong>${crName}</strong> responded to the care verification email and indicated they <strong>did not authorize</strong> this care arrangement.</p>
                ${notes ? `<p>Their message: <em>"${notes}"</em></p>` : ""}
                <p>As a safety measure, all bookings for ${careRecipient.first_name} have been automatically paused. No caregiver will be sent.</p>
                <p>If this is a misunderstanding, please speak with ${careRecipient.first_name} directly. You can also contact our team for help resolving this.</p>
              `,
            };
            await sendEmail({
              to: familyUser.email,
              subject: emailSubjects[response],
              html: brandedHtml(`
                <h2 style="color: ${response === "did_not_authorize" ? "#c62828" : response === "have_questions" ? "#e65100" : "#1b6b5a"};">
                  Care Verification Update
                </h2>
                ${emailBodies[response]}
                <p style="margin-top: 24px; font-size: 14px; color: #888;">
                  — The inPlace Team
                </p>
              `),
            });
          } catch (emailErr) { console.error("Family consent email error:", emailErr.message); }
        }
      }
    } catch (notifyErr) { console.error("Outreach response notification error:", notifyErr.message); }

    const responseMessages = {
      yes_aware: "Thank you for confirming! Your family member can now proceed with arranging care for you. If you ever have questions, don't hesitate to reach out.",
      have_questions: "Thank you for letting us know. Someone from our team will reach out to you shortly to answer your questions.",
      did_not_authorize: "Thank you for letting us know. We take this seriously and will investigate. No caregiver will be sent without your authorization.",
    };

    res.json({ success: true, message: responseMessages[response] });
  } catch (err) {
    console.error("Consent respond (POST) error:", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// LEGACY: Keep old generate-code and verify-code endpoints for backward
// compatibility but mark them as deprecated
// ═══════════════════════════════════════════════════════════════════════

// ─── POST /api/consent/:recipientId/generate-code ─── (DEPRECATED)
router.post("/:recipientId/generate-code", authenticate, async (req, res) => {
  // Redirect to new outreach flow
  return res.status(410).json({
    error: "The code verification flow has been replaced. Please use the new outreach-based verification.",
    redirect: "send-outreach",
  });
});

// ─── POST /api/consent/:recipientId/verify-code ─── (DEPRECATED)
router.post("/:recipientId/verify-code", authenticate, async (req, res) => {
  return res.status(410).json({
    error: "The code verification flow has been replaced. Consent is now verified via direct outreach to the care recipient and admin review.",
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Tier 2 — Authorization Document Upload (POA / Guardianship)
// ═══════════════════════════════════════════════════════════════════════

const VALID_DOC_TYPES = ["POA", "Legal_Guardianship", "Court_Order", "Other"];

// ─── POST /api/consent/:recipientId/documents ───
// Upload an authorization document (tier2)
router.post("/:recipientId/documents", authenticate, uploadDoc.single("document"), async (req, res) => {
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
      const logConsentAudit = getLogConsentAudit();
      // v1.87.0 (infra #7): reuse the authorization_documents id — the boot-time
      // sync copies old-table rows whose id is NOT already in verified_documents,
      // so a fresh uuid here meant every consent upload got duplicated on the
      // next boot. Same id = boot sync skips it.
      const vDocId = id;

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
router.get("/:recipientId/documents", authenticate, async (req, res) => {
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
router.get("/:recipientId/documents/:docId/download", authenticate, async (req, res) => {
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
router.delete("/:recipientId/documents/:docId", authenticate, async (req, res) => {
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
