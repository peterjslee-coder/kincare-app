// Split out of routes/admin.js (v1.92.0, tier-2 #3 — zero behavior change).
// Route bodies are verbatim; registration ORDER across modules is preserved by
// ./index.js. Shared state (passkey challenge store, helpers) lives in ./shared.js.
const { v4: uuid } = require("uuid");
const { getDb } = require("../../models/database");
const { authenticate, requireAdmin } = require("../../middleware/auth");
const { captureException } = require("../../utils/sentry");
const { activeVouchesFor } = require("../../utils/vouches");
const { sendVerificationEmail } = require("../auth");
const {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require("@simplewebauthn/server");
const { isTrustedIp, registerTrustedIp, getTrustedIps, removeTrustedIp } = require("../../utils/trustedIps");
const { getClientIp, writeAuditLog } = require("../../middleware/auditLog");
const {
  RP_ID, ORIGIN,
  setPasskeyChallenge, getPasskeyChallenge, setNukeChallenge, getNukeChallenge,
  NOT_DEMO_SESSION, safeJson, logAdminAction, checkAdmin,
} = require("./shared");

module.exports = function register(router) {

// ═══════════════════════════════════════════════════════════════════════
// ─── AUTHORIZATIONS (Consent & Authorization Verification) ───
// ═══════════════════════════════════════════════════════════════════════

// GET /api/admin/authorizations — list care recipients with consent info
router.get("/authorizations", requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const { status, tier } = req.query;

    let sql = `
      SELECT cr.id, cr.first_name, cr.last_name, cr.authorization_tier, cr.consent_status,
             cr.consent_method, cr.consent_verified_at, cr.consent_reviewed_by, cr.consent_notes,
             cr.email AS recipient_email, cr.sms_phone AS recipient_phone,
             cr.bookings_paused, cr.bookings_paused_reason,
             cr.created_at,
             u.first_name AS family_first_name, u.last_name AS family_last_name, u.email AS family_email,
             (SELECT COUNT(*) FROM care_sessions cs WHERE cs.care_recipient_id = cr.id) AS session_count,
             att.signature_name AS attestation_signer, att.signed_at AS attestation_signed_at,
             att.relationship_to_recipient AS attestation_relationship,
             att.admin_status AS attestation_admin_status, att.admin_notes AS attestation_admin_notes,
             (SELECT va.status FROM verification_attempts va WHERE va.care_recipient_id = cr.id ORDER BY va.created_at DESC LIMIT 1) AS verification_status,
             (SELECT va2.failed_attempts FROM verification_attempts va2 WHERE va2.care_recipient_id = cr.id ORDER BY va2.created_at DESC LIMIT 1) AS verification_failed_attempts,
             (SELECT co.recipient_response FROM consent_outreach co WHERE co.care_recipient_id = cr.id ORDER BY co.created_at DESC LIMIT 1) AS outreach_response,
             (SELECT co2.responded_at FROM consent_outreach co2 WHERE co2.care_recipient_id = cr.id ORDER BY co2.created_at DESC LIMIT 1) AS outreach_responded_at,
             (SELECT co3.sent_to_email FROM consent_outreach co3 WHERE co3.care_recipient_id = cr.id ORDER BY co3.created_at DESC LIMIT 1) AS outreach_sent_to,
             (SELECT co4.recipient_response_notes FROM consent_outreach co4 WHERE co4.care_recipient_id = cr.id ORDER BY co4.created_at DESC LIMIT 1) AS outreach_response_notes,
             (SELECT ad.id FROM authorization_documents ad WHERE ad.care_recipient_id = cr.id ORDER BY ad.created_at DESC LIMIT 1) AS doc_id,
             (SELECT ad2.document_type FROM authorization_documents ad2 WHERE ad2.care_recipient_id = cr.id ORDER BY ad2.created_at DESC LIMIT 1) AS doc_type,
             (SELECT ad3.file_name FROM authorization_documents ad3 WHERE ad3.care_recipient_id = cr.id ORDER BY ad3.created_at DESC LIMIT 1) AS doc_file_name,
             (SELECT ad4.upload_status FROM authorization_documents ad4 WHERE ad4.care_recipient_id = cr.id ORDER BY ad4.created_at DESC LIMIT 1) AS doc_upload_status,
             (SELECT ad5.admin_notes FROM authorization_documents ad5 WHERE ad5.care_recipient_id = cr.id ORDER BY ad5.created_at DESC LIMIT 1) AS doc_admin_notes
      FROM care_recipients cr
      LEFT JOIN users u ON u.id = cr.family_user_id
      LEFT JOIN attestations att ON att.care_recipient_id = cr.id
      WHERE COALESCE(u.is_demo, 0) = 0 /* v1.81.0 — demo recipients out of consent admin */
    `;
    const params = [];
    if (status) { sql += ` AND cr.consent_status = ?`; params.push(status); }
    if (tier) { sql += ` AND cr.authorization_tier = ?`; params.push(tier); }
    sql += ` ORDER BY cr.created_at DESC`;

    const rows = await db.prepare(sql).all(...params);
    res.json({ authorizations: rows });
  } catch (err) {
    console.error("Admin authorizations list error:", err);
    res.status(500).json({ error: "Failed to fetch authorizations" });
  }
});

// GET /api/admin/documents/:docId — get full document for admin preview
// Searches all 3 document tables: verified_documents, authorization_documents, caregiver_documents
router.get("/documents/:docId", requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const docId = req.params.docId;
    // Also accept ?source= query param to hint which table to check first
    const sourceHint = req.query.source;

    let doc = null;

    // Try verified_documents first (the unified table)
    if (!doc || sourceHint === 'verified_documents') {
      doc = await db.prepare(`
        SELECT id, owner_type, owner_id, uploaded_by, document_type, file_data, file_name, file_size, mime_type,
          status, category, ai_classification, admin_notes, expires_at, created_at,
          'verified_documents' AS source_table
        FROM verified_documents WHERE id = ?
      `).get(docId).catch(() => null);
    }

    // Try authorization_documents (legacy POA/guardianship)
    if (!doc) {
      doc = await db.prepare(`
        SELECT id, care_recipient_id, document_type, file_data, file_name, file_size, mime_type,
          upload_status AS status, admin_notes, created_at,
          'authorization_documents' AS source_table
        FROM authorization_documents WHERE id = ?
      `).get(docId).catch(() => null);
    }

    // Try caregiver_documents (legacy onboarding DL/certs)
    if (!doc) {
      doc = await db.prepare(`
        SELECT id, user_id, document_type, file_data, file_name, metadata, created_at,
          'caregiver_documents' AS source_table
        FROM caregiver_documents WHERE id = ?
      `).get(docId).catch(() => null);
    }

    if (!doc) return res.status(404).json({ error: "Document not found" });
    // v1.91.0 — new uploads may hold an "r2:<key>" marker; resolve to a data URI
    // so the admin preview keeps rendering both shapes.
    if (doc.file_data) {
      const storage = require("../utils/storage");
      doc.file_data = await storage.resolveFileData(doc.file_data);
    }
    res.json({ document: doc });
  } catch (err) {
    console.error("Admin document preview error:", err);
    res.status(500).json({ error: "Failed to fetch document" });
  }
});

// PUT /api/admin/authorizations/:id — admin approve/reject/revoke consent
router.put("/authorizations/:id", requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const { id } = req.params;
    const { action, notes } = req.body; // action: 'approve' | 'reject' | 'revoke'

    const recipient = await db.prepare("SELECT * FROM care_recipients WHERE id = ?").get(id);
    if (!recipient) return res.status(404).json({ error: "Care recipient not found" });

    const validActions = ['approve', 'reject', 'revoke', 'unpause'];
    if (!validActions.includes(action)) {
      return res.status(400).json({ error: "Action must be 'approve', 'reject', 'revoke', or 'unpause'" });
    }

    // ── Unpause bookings (standalone action, doesn't change consent status) ──
    if (action === 'unpause') {
      await db.prepare(`
        UPDATE care_recipients SET bookings_paused = 0, bookings_paused_reason = NULL, updated_at = NOW() WHERE id = ?
      `).run(id);

      await logAdminAction(req, "unpause_bookings", "care_recipient", id, {
        previousReason: recipient.bookings_paused_reason,
        notes,
      });

      // Notify family
      const recipientName = `${recipient.first_name} ${recipient.last_name}`.trim();
      try {
        await db.prepare(`
          INSERT INTO activity_feed (id, family_user_id, care_recipient_id, event_type, title, message)
          VALUES (?, ?, ?, 'bookings_resumed', ?, ?)
        `).run(uuid(), recipient.family_user_id, id,
          `Bookings resumed for ${recipientName}`,
          `Bookings for ${recipientName} have been restored by an administrator.${notes ? ' Note: ' + notes : ''}`
        );
        const emitToUser = req.app.get("emitToUser");
        if (emitToUser) emitToUser(recipient.family_user_id, "activity_update", {
          title: `Bookings resumed for ${recipientName}`,
          message: `Bookings for ${recipientName} have been restored. You can now schedule care sessions.`,
        });
      } catch (e) { console.error("Unpause notification error:", e.message); }

      const updated = await db.prepare("SELECT * FROM care_recipients WHERE id = ?").get(id);
      return res.json({ success: true, careRecipient: updated });
    }

    const statusMap = { approve: 'verified', reject: 'rejected', revoke: 'revoked' };
    const newStatus = statusMap[action];
    const newMethod = action === 'approve' ? 'admin_approved' : recipient.consent_method;
    const verifiedAt = action === 'approve' ? new Date().toISOString() : recipient.consent_verified_at;

    await db.prepare(`
      UPDATE care_recipients
      SET consent_status = ?, consent_method = ?, consent_verified_at = ?,
          consent_reviewed_by = ?, consent_notes = ?, updated_at = NOW()
      WHERE id = ?
    `).run(newStatus, newMethod, verifiedAt, req.user.id, notes || null, id);

    // For tier3: update the attestation admin_status
    if (recipient.authorization_tier === 'tier3' && (action === 'approve' || action === 'reject')) {
      const attAdminStatus = action === 'approve' ? 'approved' : 'rejected';
      await db.prepare(`
        UPDATE attestations SET admin_status = ?, admin_notes = ?, admin_reviewed_by = ?, admin_reviewed_at = NOW()
        WHERE care_recipient_id = ? ORDER BY created_at DESC LIMIT 1
      `).run(attAdminStatus, notes || null, req.user.id, id);

      // If rejecting, also unpause bookings if they were paused
      if (action === 'reject') {
        await db.prepare(
          "UPDATE care_recipients SET bookings_paused = 0, bookings_paused_reason = NULL, updated_at = NOW() WHERE id = ?"
        ).run(id);
      }
    }

    // For tier2: also update the most recent authorization document status
    if (recipient.authorization_tier === 'tier2' && (action === 'approve' || action === 'reject')) {
      const latestDoc = await db.prepare(
        "SELECT id FROM authorization_documents WHERE care_recipient_id = ? ORDER BY created_at DESC LIMIT 1"
      ).get(id);
      if (latestDoc) {
        const docStatus = action === 'approve' ? 'approved' : 'rejected';
        await db.prepare(
          "UPDATE authorization_documents SET upload_status = ?, admin_notes = ?, reviewed_by = ?, reviewed_at = NOW() WHERE id = ?"
        ).run(docStatus, notes || null, req.user.id, latestDoc.id);
      }

      // Also update verified_documents status
      const latestVDoc = await db.prepare(
        "SELECT id FROM verified_documents WHERE owner_type = 'care_recipient' AND owner_id = ? AND category = 'consent' ORDER BY created_at DESC LIMIT 1"
      ).get(id);
      if (latestVDoc) {
        const vDocStatus = action === 'approve' ? 'approved' : 'rejected';
        await db.prepare(
          "UPDATE verified_documents SET status = ?, admin_notes = ?, admin_reviewed_by = ?, admin_reviewed_at = NOW(), updated_at = NOW() WHERE id = ?"
        ).run(vDocStatus, notes || null, req.user.id, latestVDoc.id);
      }

      // POA override: if approving tier2 for a recipient with self-consent (linked_user_id), activate managed mode
      if (action === 'approve' && recipient.linked_user_id) {
        const previousPerm = recipient.permission_tier || 'full';
        if (previousPerm === 'full') {
          await db.prepare(`
            UPDATE care_recipients SET permission_tier = 'collaborative', managed_by_user_id = ?,
              managed_reason = 'POA verified by admin', managed_at = NOW() WHERE id = ?
          `).run(recipient.family_user_id, id);

          // Log managed mode activation
          try {
            const { logConsentAudit } = require("./documents");
            const rName = `${recipient.first_name} ${recipient.last_name}`.trim();
            await logConsentAudit(db, {
              careRecipientId: id, actorId: "system", actorRole: "system",
              eventType: "managed_mode_activated",
              description: `${rName}'s account transitioned to collaborative mode after POA verification. Care team now manages care decisions.`,
              metadata: { previousPermission: previousPerm, newPermission: 'collaborative', triggeredBy: 'poa_approval' },
            });
          } catch (auditErr) { console.error("Managed mode audit error:", auditErr.message); }

          // Notify care recipient
          try {
            const emitToUser = req.app.get("emitToUser");
            const title = "Your account is now in collaborative mode";
            const message = `A Power of Attorney document has been verified for your care. Your care team now helps manage your care sessions. You can still view your schedule and information.`;
            await db.prepare(
              "INSERT INTO activity_feed (id, family_user_id, care_recipient_id, event_type, title, message) VALUES (?, ?, ?, 'managed_mode_activated', ?, ?)"
            ).run(uuid(), recipient.linked_user_id, id, title, message);
            if (emitToUser) emitToUser(recipient.linked_user_id, "activity_update", { title, message });
          } catch (notifErr) { console.error("Managed mode notification error:", notifErr.message); }
        }
      }
    }

    await logAdminAction(req, `authorization_${action}`, "care_recipient", id, {
      previousStatus: recipient.consent_status,
      newStatus,
      tier: recipient.authorization_tier,
      notes,
    });

    // Consent audit log
    try {
      const { logConsentAudit } = require("./documents");
      const eventMap = { approve: "document_approved", reject: "document_rejected", revoke: "consent_revoked" };
      const recipientLabel = `${recipient.first_name} ${recipient.last_name}`.trim();
      const descMap = {
        approve: `Admin approved authorization for ${recipientLabel}${notes ? '. Note: ' + notes : ''}`,
        reject: `Admin rejected authorization for ${recipientLabel}${notes ? '. Reason: ' + notes : ''}`,
        revoke: `Admin revoked consent for ${recipientLabel}${notes ? '. Reason: ' + notes : ''}`,
      };
      await logConsentAudit(db, {
        careRecipientId: id, actorId: req.user.id, actorRole: "admin",
        eventType: eventMap[action] || `authorization_${action}`,
        description: descMap[action],
        metadata: { previousStatus: recipient.consent_status, newStatus, tier: recipient.authorization_tier, notes },
      });
    } catch (auditErr) { console.error("Admin consent audit log error:", auditErr.message); }

    // Send activity feed entry + WebSocket notification to family
    const recipientName = `${recipient.first_name} ${recipient.last_name}`.trim();
    const activityTitle = action === 'approve'
      ? `Authorization approved for ${recipientName}`
      : action === 'reject'
        ? `Authorization requires attention — ${recipientName}`
        : `Authorization revoked for ${recipientName}`;
    const activityMsg = action === 'approve'
      ? `${recipientName}'s care authorization has been verified. You can now schedule care sessions.`
      : action === 'reject'
        ? `Your authorization document for ${recipientName} needs revision.${notes ? ' Note: ' + notes : ''} Please upload a new document.`
        : `Authorization for ${recipientName} has been revoked. Please contact support if you believe this is an error.`;
    try {
      await db.prepare(`
        INSERT INTO activity_feed (id, family_user_id, care_recipient_id, event_type, title, message)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(uuid(), recipient.family_user_id, id, `authorization_${action}`, activityTitle, activityMsg);
      const emitToUser = req.app.get("emitToUser");
      if (emitToUser) emitToUser(recipient.family_user_id, "activity_update", { title: activityTitle, message: activityMsg });
    } catch (notifErr) {
      console.error("Authorization notification error:", notifErr.message);
    }

    const updated = await db.prepare("SELECT * FROM care_recipients WHERE id = ?").get(id);
    res.json({ success: true, careRecipient: updated });
  } catch (err) {
    console.error("Admin authorization update error:", err);
    res.status(500).json({ error: "Failed to update authorization" });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// ─── CONSENT REVIEW — Tier 3 pending attestations quick-view ───
// ═══════════════════════════════════════════════════════════════════════

// GET /api/admin/consent/pending — list consent items needing admin attention
// Catches: (1) pending attestation reviews, (2) unanswered outreach emails, (3) flagged responses
router.get("/consent/pending", requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const rows = await db.prepare(`
      SELECT cr.id, cr.first_name, cr.last_name, cr.consent_status, cr.email AS recipient_email,
             cr.sms_phone AS recipient_phone, cr.bookings_paused, cr.bookings_paused_reason,
             u.first_name AS family_first_name, u.last_name AS family_last_name, u.email AS family_email,
             att.signature_name, att.relationship_to_recipient, att.signed_at, att.admin_status,
             co.sent_to_email AS outreach_sent_to, co.outreach_type, co.recipient_response,
             co.recipient_response_notes, co.responded_at AS outreach_responded_at, co.expires_at AS outreach_expires_at
      FROM care_recipients cr
      JOIN users u ON u.id = cr.family_user_id
      LEFT JOIN attestations att ON att.care_recipient_id = cr.id
      LEFT JOIN consent_outreach co ON co.care_recipient_id = cr.id
        AND co.created_at = (SELECT MAX(co2.created_at) FROM consent_outreach co2 WHERE co2.care_recipient_id = cr.id)
      WHERE NOT EXISTS (SELECT 1 FROM users du WHERE du.id = cr.family_user_id AND COALESCE(du.is_demo, 0) = 1)
      AND (
        -- Pending attestation review (original logic)
        (cr.authorization_tier = 'tier3'
          AND cr.consent_status IN ('attested', 'pending')
          AND COALESCE(att.admin_status, 'pending') = 'pending')
        OR
        -- Outreach sent but no response yet
        (co.id IS NOT NULL AND co.recipient_response IS NULL AND co.responded_at IS NULL)
        OR
        -- Bookings currently paused (needs admin resolution)
        (cr.bookings_paused = 1)
      )
      ORDER BY
        CASE WHEN cr.bookings_paused = 1 THEN 0
             WHEN co.id IS NOT NULL AND co.recipient_response IS NULL THEN 1
             ELSE 2 END,
        att.signed_at DESC NULLS LAST
    `).all();
    res.json({ pending: rows });
  } catch (err) {
    console.error("Admin consent pending error:", err);
    res.status(500).json({ error: "Failed to fetch pending consent reviews" });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// ─── CAREGIVER MANAGEMENT — Manual background check approval ───
// ═══════════════════════════════════════════════════════════════════════

// POST /api/admin/caregivers/:id/approve-bgcheck — RETIRED (v1.64.0)
// This endpoint used to forge checkr_status='clear' + is_background_checked=1,
// making an admin override indistinguishable from a passed Checkr check.
// Use POST /api/admin/vouches instead (per-family, honestly labeled).
router.post("/caregivers/:id/approve-bgcheck", requireAdmin, async (req, res) => {
  res.status(410).json({ error: "Retired: manual approvals are now per-family vouches. Refresh the app and use \u201cVouch for family\u201d in Admin \u2192 Background Checks." });
});

// POST /api/admin/caregivers/:id/approve-consider — approve a REAL Checkr
// 'consider'/'disputed' report after human review (v1.64.0). Unlike the retired
// approve-bgcheck, this requires an actual report to exist.
router.post("/caregivers/:id/approve-consider", requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const profile = await db.prepare(
      "SELECT cp.checkr_status, cp.checkr_report_id, u.first_name, u.last_name FROM caregiver_profiles cp JOIN users u ON u.id = cp.user_id WHERE cp.user_id = ?"
    ).get(req.params.id);
    if (!profile) return res.status(404).json({ error: "Caregiver profile not found" });
    if (!profile.checkr_report_id || !["consider", "disputed"].includes(profile.checkr_status)) {
      return res.status(400).json({ error: "No Checkr 'consider' report to approve. For caregivers without a background check, use a per-family vouch instead." });
    }
    await db.prepare(
      "UPDATE caregiver_profiles SET checkr_status = 'consider_approved', is_background_checked = 1, updated_at = NOW() WHERE user_id = ?"
    ).run(req.params.id);
    await logAdminAction(req, "bgcheck_consider_approved", "caregiver", req.params.id, {
      caregiverName: `${profile.first_name} ${profile.last_name}`.trim(),
      reportId: profile.checkr_report_id,
    });
    res.json({ success: true });
  } catch (err) {
    console.error("Approve-consider error:", err);
    res.status(500).json({ error: "Failed to approve" });
  }
});

// ─── Admin vouches (v1.64.0 honest-override batch) ───
// A vouch approves ONE caregiver for ONE family and is always displayed as
// "approved by admin — no background check", never as a passed check.

// GET /api/admin/vouches — all active vouches (+ names)
router.get("/vouches", requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const vouches = await db.prepare(`
      SELECT v.id, v.caregiver_user_id, v.family_user_id, v.note, v.created_at,
             cu.first_name || ' ' || cu.last_name AS caregiver_name,
             fu.first_name || ' ' || fu.last_name AS family_name
      FROM bg_admin_vouches v
      JOIN users cu ON cu.id = v.caregiver_user_id
      JOIN users fu ON fu.id = v.family_user_id
      WHERE v.revoked_at IS NULL
      ORDER BY v.created_at DESC
    `).all();
    res.json({ vouches });
  } catch (err) {
    console.error("Admin vouches list error:", err);
    res.status(500).json({ error: "Failed to fetch vouches" });
  }
});

// POST /api/admin/vouches — vouch a caregiver for a family
router.post("/vouches", requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const { caregiverUserId, familyUserId, note } = req.body;
    if (!caregiverUserId || !familyUserId) {
      return res.status(400).json({ error: "caregiverUserId and familyUserId are required" });
    }
    const caregiver = await db.prepare(
      "SELECT u.first_name, u.last_name FROM users u JOIN caregiver_profiles cp ON cp.user_id = u.id WHERE u.id = ?"
    ).get(caregiverUserId);
    if (!caregiver) return res.status(404).json({ error: "Caregiver not found" });
    const family = await db.prepare("SELECT first_name, last_name FROM users WHERE id = ?").get(familyUserId);
    if (!family) return res.status(404).json({ error: "Family user not found" });

    const existing = await db.prepare(
      "SELECT id FROM bg_admin_vouches WHERE caregiver_user_id = ? AND family_user_id = ? AND revoked_at IS NULL"
    ).get(caregiverUserId, familyUserId);
    if (existing) return res.status(409).json({ error: "An active vouch for this pair already exists" });

    const id = uuid();
    await db.prepare(
      "INSERT INTO bg_admin_vouches (id, caregiver_user_id, family_user_id, vouched_by, note) VALUES (?, ?, ?, ?, ?)"
    ).run(id, caregiverUserId, familyUserId, req.user.id, note || null);

    await logAdminAction(req, "vouch_created", "caregiver", caregiverUserId, {
      familyUserId,
      caregiverName: `${caregiver.first_name} ${caregiver.last_name}`.trim(),
      familyName: `${family.first_name} ${family.last_name}`.trim(),
      note: note || null,
    });

    // Honest notification — never says "background check approved"
    try {
      await db.prepare(`
        INSERT INTO activity_feed (id, family_user_id, event_type, title, message, created_at)
        VALUES (?, ?, 'admin_vouch', 'Approved to work with a family', ?, NOW())
      `).run(uuid(), caregiverUserId,
        `An admin approved you to provide care for ${family.first_name} ${family.last_name}'s family. A background check is still required before working with other families.`);
      const emitToUser = req.app.get("emitToUser");
      if (emitToUser) emitToUser(caregiverUserId, "activity_update", { title: "Approved to work with a family" });
    } catch (notifErr) { console.error("Vouch notification error:", notifErr.message); }

    res.json({ success: true, vouchId: id });
  } catch (err) {
    console.error("Admin vouch create error:", err);
    res.status(500).json({ error: "Failed to create vouch" });
  }
});

// DELETE /api/admin/vouches/:id — revoke a vouch
router.delete("/vouches/:id", requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const vouch = await db.prepare("SELECT * FROM bg_admin_vouches WHERE id = ? AND revoked_at IS NULL").get(req.params.id);
    if (!vouch) return res.status(404).json({ error: "Active vouch not found" });
    await db.prepare("UPDATE bg_admin_vouches SET revoked_at = NOW(), revoked_by = ? WHERE id = ?").run(req.user.id, req.params.id);
    await logAdminAction(req, "vouch_revoked", "caregiver", vouch.caregiver_user_id, { vouchId: req.params.id, familyUserId: vouch.family_user_id });
    res.json({ success: true });
  } catch (err) {
    console.error("Admin vouch revoke error:", err);
    res.status(500).json({ error: "Failed to revoke vouch" });
  }
});

// POST /api/admin/caregivers/:id/convert-to-vouch — unforge a hand-set
// "background cleared" flag into an honest per-family vouch (v1.64.0).
// Refuses when real Checkr evidence exists (nothing to unforge).
router.post("/caregivers/:id/convert-to-vouch", requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const { id } = req.params;
    const { familyUserId, note } = req.body;
    if (!familyUserId) return res.status(400).json({ error: "familyUserId is required" });

    const profile = await db.prepare(
      "SELECT cp.*, u.first_name, u.last_name FROM caregiver_profiles cp JOIN users u ON u.id = cp.user_id WHERE cp.user_id = ?"
    ).get(id);
    if (!profile) return res.status(404).json({ error: "Caregiver profile not found" });
    if (profile.checkr_report_id) {
      return res.status(400).json({ error: "This caregiver has a real Checkr report — nothing to convert" });
    }
    const family = await db.prepare("SELECT first_name, last_name FROM users WHERE id = ?").get(familyUserId);
    if (!family) return res.status(404).json({ error: "Family user not found" });

    await db.transaction(async (tx) => {
      await tx.prepare(`
        UPDATE caregiver_profiles
        SET is_background_checked = 0,
            bg_check_admin_approved = 0,
            checkr_status = CASE WHEN checkr_status IN ('clear','consider_approved') THEN 'pending' ELSE checkr_status END,
            updated_at = NOW()
        WHERE user_id = ?
      `).run(id);
      const existing = await tx.prepare(
        "SELECT id FROM bg_admin_vouches WHERE caregiver_user_id = ? AND family_user_id = ? AND revoked_at IS NULL"
      ).get(id, familyUserId);
      if (!existing) {
        await tx.prepare(
          "INSERT INTO bg_admin_vouches (id, caregiver_user_id, family_user_id, vouched_by, note) VALUES (?, ?, ?, ?, ?)"
        ).run(uuid(), id, familyUserId, req.user.id, note || "Converted from manually-set background check flag");
      }
    });

    await logAdminAction(req, "bgcheck_converted_to_vouch", "caregiver", id, {
      caregiverName: `${profile.first_name} ${profile.last_name}`.trim(),
      familyUserId,
      familyName: `${family.first_name} ${family.last_name}`.trim(),
    });

    res.json({ success: true, message: `${profile.first_name} is now honestly labeled: vouched for ${family.first_name}'s family, no background check on file.` });
  } catch (err) {
    console.error("Convert-to-vouch error:", err);
    res.status(500).json({ error: "Failed to convert" });
  }
});

// ─── Account Approval Gate ───

// GET /api/admin/pending-approvals — list users awaiting approval
router.get("/pending-approvals", requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const pending = await db.prepare(`
      SELECT id, email, first_name, last_name, role, roles, phone, created_at
      FROM users
      WHERE account_approved = 0
        AND (is_demo IS NULL OR is_demo = 0)
        AND is_active = 1
      ORDER BY created_at DESC
    `).all();
    res.json({ pending: pending || [] });
  } catch (err) {
    console.error("Pending approvals error:", err);
    res.status(500).json({ error: "Failed to fetch pending approvals" });
  }
});

// PUT /api/admin/users/:id/approve — approve a user's account
router.put("/users/:id/approve", requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const user = await db.prepare("SELECT id, first_name, last_name, email, role FROM users WHERE id = ?").get(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    await db.prepare(
      "UPDATE users SET account_approved = 1, approved_by = ?, approved_at = NOW() WHERE id = ?"
    ).run(req.user.id, req.params.id);

    // If this caregiver had a flagged BG check (consider/disputed), mark it as reviewed-and-approved
    const cgProfile = await db.prepare(
      "SELECT checkr_status FROM caregiver_profiles WHERE user_id = ?"
    ).get(req.params.id);
    if (cgProfile && (cgProfile.checkr_status === "consider" || cgProfile.checkr_status === "disputed")) {
      await db.prepare(
        "UPDATE caregiver_profiles SET checkr_status = 'consider_approved', is_background_checked = 1, updated_at = NOW() WHERE user_id = ?"
      ).run(req.params.id);
    } else if (cgProfile && cgProfile.checkr_status === "rejected") {
      // Un-reject: reset back to consider so admin can re-review
      await db.prepare(
        "UPDATE caregiver_profiles SET checkr_status = 'consider', bg_check_rejection_reason = NULL, updated_at = NOW() WHERE user_id = ?"
      ).run(req.params.id);
    }

    await logAdminAction(req, "account_approved", "user", req.params.id, {
      userName: `${user.first_name} ${user.last_name}`.trim(),
      email: user.email,
    });

    // Send verification email now that account is approved
    // (verification email is NOT sent at signup — only after admin approval)
    try {
      const userFull = await db.prepare("SELECT id, email, first_name, email_verified FROM users WHERE id = ?").get(req.params.id);
      if (userFull && !userFull.email_verified) {
        await sendVerificationEmail(db, userFull.id, userFull.email, userFull.first_name);
        console.log(`  [admin] Sent verification email to ${userFull.email} after account approval`);
      }
    } catch (emailErr) {
      console.error("  [admin] Failed to send verification email after approval:", emailErr.message);
      // Don't fail the approval — email is best-effort
    }

    // Notify the user their account is approved
    const emitToUser = req.app.get("emitToUser");
    if (emitToUser) {
      emitToUser(req.params.id, "account_approved", {
        message: "Your account has been approved! You can now continue setting up your profile.",
      });
    }

    // Push notification
    try {
      const sendPush = req.app.get("sendPush");
      if (sendPush) {
        await sendPush(req.params.id, {
          title: "Account Approved!",
          body: "Welcome to InPlace! Your account has been approved. You can now continue setting up your profile.",
          data: { type: "account_approved" },
        });
      }
    } catch (e) { captureException(e, { where: "admin: push (account approved)" }); }

    // Activity feed
    try {
      await db.prepare(
        "INSERT INTO activity_feed (id, family_user_id, event_type, title, message, created_at) VALUES (?, ?, 'account_approved', 'Welcome to InPlace!', 'Your account has been approved. Continue setting up your profile to get started.', NOW())"
      ).run(uuid(), req.params.id);
    } catch (e) { captureException(e, { where: "admin: activity feed (account approved)" }); }

    res.json({ success: true, message: `Approved ${user.first_name} ${user.last_name}` });
  } catch (err) {
    console.error("Account approve error:", err);
    res.status(500).json({ error: "Failed to approve account" });
  }
});

// PUT /api/admin/users/:id/unapprove — reset approval status (for re-review)
router.put("/users/:id/unapprove", requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    await db.prepare("UPDATE users SET account_approved = 0, approved_by = NULL, approved_at = NULL WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error("Unapprove error:", err);
    res.status(500).json({ error: "Failed to unapprove" });
  }
});

// PUT /api/admin/users/:id/reject-bgcheck — Reject caregiver due to background check (soft lock with appeal)
router.put("/users/:id/reject-bgcheck", requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const { reason } = req.body;
    const user = await db.prepare("SELECT id, first_name, last_name, email FROM users WHERE id = ?").get(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    // Update checkr status to rejected and store reason
    await db.prepare(
      "UPDATE caregiver_profiles SET checkr_status = 'rejected', bg_check_rejection_reason = ?, account_paused = 0, updated_at = NOW() WHERE user_id = ?"
    ).run(reason || 'Background check did not meet requirements', req.params.id);

    // Log the action
    await logAdminAction(req, "bgcheck_rejected", "user", req.params.id, {
      userName: `${user.first_name} ${user.last_name}`.trim(),
      email: user.email,
      reason: reason || 'Background check did not meet requirements',
    });

    // Send them an in-app message from admin explaining the decision
    const sendAdminMsg = async (msg) => {
      try {
        // Find or create a conversation
        let convo = await db.prepare(
          "SELECT id FROM conversations WHERE type = 'admin_support' AND JSON_EXTRACT(participants, '$') LIKE ?"
        ).get(`%${req.params.id}%`);
        if (!convo) {
          const convoId = uuid();
          await db.prepare(
            "INSERT INTO conversations (id, type, participants, created_at, updated_at) VALUES (?, 'admin_support', ?, NOW(), NOW())"
          ).run(convoId, JSON.stringify([req.params.id, req.user.id]));
          convo = { id: convoId };
        }
        await db.prepare(
          "INSERT INTO messages (id, sender_id, recipient_id, conversation_id, content, created_at) VALUES (?, ?, ?, ?, ?, NOW())"
        ).run(uuid(), req.user.id, req.params.id, convo.id, msg);
      } catch (msgErr) { console.warn("[reject-bgcheck] Message send failed:", msgErr.message); }
    };
    await sendAdminMsg(
      `Hi ${user.first_name}, we've reviewed your background check results and unfortunately we're unable to approve your account for caregiving at this time.\n\n` +
      `Reason: ${reason || 'Background check did not meet our requirements.'}\n\n` +
      `If you believe this is an error or would like to provide additional context, please reply to this message and we'll review your case.`
    );

    // Push notification
    try {
      const sendPush = req.app.get("sendPush");
      if (sendPush) {
        await sendPush(req.params.id, {
          title: "Background Check Update",
          body: "We've sent you a message regarding your background check. Please check your Messages.",
          data: { type: "bgcheck_rejected" },
        });
      }
    } catch (e) { captureException(e, { where: "admin: push (bgcheck rejected)" }); }

    // Activity feed entry for admin
    try {
      await db.prepare(
        "INSERT INTO activity_feed (id, family_user_id, event_type, title, message, created_at) VALUES (?, ?, 'checkr_rejected', ?, ?, NOW())"
      ).run(uuid(), req.user.id, `Background check rejected — ${user.first_name} ${user.last_name}`,
        `${user.first_name} ${user.last_name} was rejected due to background check findings. Reason: ${reason || 'Did not meet requirements'}`);
    } catch (e) { captureException(e, { where: "admin: activity feed (checkr rejected)" }); }

    res.json({ success: true, message: `Rejected ${user.first_name} ${user.last_name} — they've been notified via message` });
  } catch (err) {
    console.error("BG check reject error:", err);
    res.status(500).json({ error: "Failed to reject" });
  }
});

// PUT /api/admin/users/:id/reject — reject (deactivate) a user's account
router.put("/users/:id/reject", requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const { reason } = req.body;
    const user = await db.prepare("SELECT id, first_name, last_name, email FROM users WHERE id = ?").get(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    await db.prepare("UPDATE users SET is_active = 0 WHERE id = ?").run(req.params.id);

    await logAdminAction(req, "account_rejected", "user", req.params.id, {
      userName: `${user.first_name} ${user.last_name}`.trim(),
      email: user.email,
      reason: reason || "Not approved",
    });

    res.json({ success: true, message: `Rejected ${user.first_name} ${user.last_name}` });
  } catch (err) {
    console.error("Account reject error:", err);
    res.status(500).json({ error: "Failed to reject account" });
  }
});
};
