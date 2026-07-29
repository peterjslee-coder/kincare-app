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

// ─── GET /api/admin/blocked-emails ─── List all blocked emails
router.get("/blocked-emails", authenticate, checkAdmin, requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const rows = await db.prepare(
      "SELECT be.*, u.first_name || ' ' || u.last_name AS blocked_by_name FROM blocked_emails be LEFT JOIN users u ON be.blocked_by = u.id ORDER BY be.created_at DESC"
    ).all();
    res.json({ blockedEmails: rows });
  } catch (err) {
    console.error("Fetch blocked emails error:", err);
    res.status(500).json({ error: "Failed to fetch blocked emails" });
  }
});

// ─── POST /api/admin/blocked-emails ─── Block an email from registering
router.post("/blocked-emails", authenticate, checkAdmin, requireAdmin, async (req, res) => {
  try {
    const { email, reason } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required" });

    const db = await getDb();
    const existing = await db.prepare("SELECT id FROM blocked_emails WHERE LOWER(email) = LOWER(?)").get(email);
    if (existing) return res.status(409).json({ error: "This email is already blocked" });

    const { v4: uuid } = require("uuid");
    await db.prepare(
      "INSERT INTO blocked_emails (id, email, reason, blocked_by) VALUES (?, LOWER(?), ?, ?)"
    ).run(uuid(), email, reason || null, req.user.id);

    await logAdminAction(req, "block_email", "email", email, { reason });
    res.status(201).json({ message: `${email} has been blocked from registering` });
  } catch (err) {
    console.error("Block email error:", err);
    res.status(500).json({ error: "Failed to block email" });
  }
});

// ─── DELETE /api/admin/blocked-emails/:id ─── Unblock an email
router.delete("/blocked-emails/:id", authenticate, checkAdmin, requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const row = await db.prepare("SELECT email FROM blocked_emails WHERE id = ?").get(req.params.id);
    if (!row) return res.status(404).json({ error: "Blocked email not found" });

    await db.prepare("DELETE FROM blocked_emails WHERE id = ?").run(req.params.id);
    await logAdminAction(req, "unblock_email", "email", row.email, {});
    res.json({ message: `${row.email} has been unblocked` });
  } catch (err) {
    console.error("Unblock email error:", err);
    res.status(500).json({ error: "Failed to unblock email" });
  }
});

// ─── GET /api/admin/users/:id/onboarding — Get caregiver onboarding status ───
router.get("/users/:id/onboarding", async (req, res) => {
  try {
    const db = await getDb();
    const user = await db.prepare("SELECT id, email, role, first_name, last_name, profile_photo, avatar_url FROM users WHERE id = ?").get(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    const profile = await db.prepare(`
      SELECT id, is_background_checked, background_check_consent, background_check_paid,
             onboarding_complete, is_available, stripe_onboard_complete,
             dl_number, dl_state,
             academic_program, academic_program_year, needs_hour_reports
      FROM caregiver_profiles WHERE user_id = ?
    `).get(req.params.id);

    // Check for uploaded documents
    const docs = await db.prepare(
      "SELECT document_type, created_at FROM caregiver_documents WHERE user_id = ? ORDER BY created_at DESC"
    ).all(req.params.id).catch(() => []);

    // Check photo from users table (profile_photo or avatar_url)
    const hasPhoto = !!(user.profile_photo || user.avatar_url);

    // Check identity verification status (selfie + ID)
    let identityVerified = false;
    let identityStatus = null;
    if (profile) {
      const idDoc = await db.prepare(
        `SELECT status, is_verified FROM verified_documents
         WHERE owner_id = ? AND owner_type = 'caregiver' AND category = 'identity' AND document_type != 'selfie'
         ORDER BY created_at DESC LIMIT 1`
      ).get(profile.id);
      if (idDoc) {
        identityVerified = idDoc.status === 'approved';
        identityStatus = idDoc.status; // 'pending', 'approved', 'rejected'
      }
    }

    res.json({
      user: { id: user.id, email: user.email, role: user.role, name: `${user.first_name || ''} ${user.last_name || ''}`.trim() },
      profile: profile || null,
      documents: docs || [],
      flags: profile ? {
        backgroundCheckCleared: !!profile.is_background_checked,
        backgroundCheckPaid: !!profile.background_check_paid,
        backgroundCheckConsent: !!profile.background_check_consent,
        stripeOnboardComplete: !!profile.stripe_onboard_complete,
        onboardingComplete: !!profile.onboarding_complete,
        isAvailable: !!profile.is_available,
        hasPhoto,
        hasDriversLicense: !!(profile.dl_number && profile.dl_state),
        identityVerified,
        identityStatus,
        needsHourReports: !!profile.needs_hour_reports,
        academicProgram: profile.academic_program || null,
        academicProgramYear: profile.academic_program_year || null,
      } : null,
    });
  } catch (err) {
    console.error("Admin onboarding status error:", err);
    res.status(500).json({ error: "Failed to load onboarding status" });
  }
});

// ─── PUT /api/admin/users/:id/onboarding — Admin override caregiver flags ───
router.put("/users/:id/onboarding", async (req, res) => {
  try {
    const db = await getDb();
    const user = await db.prepare("SELECT id, email, role FROM users WHERE id = ?").get(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    const profile = await db.prepare("SELECT id FROM caregiver_profiles WHERE user_id = ?").get(req.params.id);
    if (!profile) return res.status(404).json({ error: "No caregiver profile found for this user" });

    const { backgroundCheckCleared, backgroundCheckPaid, stripeOnboardComplete, onboardingComplete, isAvailable, identityVerified } = req.body;
    // Each flag is now independent — no cascading. Admin picks exactly which steps to skip.
    const colMap = new Map(); // column -> { sql, param? }

    // Identity verification is stored in verified_documents, not caregiver_profiles
    if (identityVerified !== undefined) {
      const idDoc = await db.prepare(
        `SELECT id FROM verified_documents WHERE owner_id = ? AND owner_type = 'caregiver' AND category = 'identity' AND document_type != 'selfie' ORDER BY created_at DESC LIMIT 1`
      ).get(profile.id);
      if (idDoc) {
        await db.prepare(
          "UPDATE verified_documents SET status = ?, is_verified = ?, admin_reviewed_by = ?, admin_reviewed_at = NOW() WHERE id = ?"
        ).run(identityVerified ? 'approved' : 'rejected', identityVerified ? 1 : 0, req.user.id, idDoc.id);
      } else if (identityVerified) {
        // Admin manually approving without a submitted doc — create a placeholder
        await db.prepare(
          `INSERT INTO verified_documents (id, owner_id, owner_type, uploaded_by, category, document_type, file_data, status, is_verified, admin_reviewed_by, admin_reviewed_at, created_at)
           VALUES (?, ?, 'caregiver', ?, 'identity', 'admin_override', '', 'approved', 1, ?, NOW(), NOW())`
        ).run(uuid(), profile.id, req.user.id, req.user.id);
      }
      // If this is the only flag being toggled and no caregiver_profiles columns to update, return early
      if (Object.keys(req.body).length === 1) return res.json({ updated: true, identityVerified });
    }

    if (backgroundCheckCleared !== undefined) {
      // v1.64.0: hand-setting "cleared" is retired — it forged a passed Checkr
      // check (this is exactly how a vouched caregiver got mislabeled). Only a
      // real Checkr result may set this flag. Un-clearing remains allowed.
      if (backgroundCheckCleared) {
        return res.status(400).json({ error: "Background checks can no longer be set by hand. Use a per-family vouch (Admin \u2192 Background Checks \u2192 Vouch for family) instead." });
      }
      colMap.set("is_background_checked", { sql: "is_background_checked = ?", param: 0 });
      colMap.set("checkr_status", { sql: "checkr_status = 'pending'" });
    }
    if (backgroundCheckPaid !== undefined) {
      colMap.set("background_check_paid", { sql: "background_check_paid = ?", param: backgroundCheckPaid ? 1 : 0 });
    }
    if (stripeOnboardComplete !== undefined) {
      colMap.set("stripe_onboard_complete", { sql: "stripe_onboard_complete = ?", param: stripeOnboardComplete ? 1 : 0 });
    }
    if (onboardingComplete !== undefined) {
      colMap.set("onboarding_complete", { sql: "onboarding_complete = ?", param: onboardingComplete ? 1 : 0 });
    }
    if (isAvailable !== undefined) {
      colMap.set("is_available", { sql: "is_available = ?", param: isAvailable ? 1 : 0 });
    }

    if (colMap.size === 0) return res.status(400).json({ error: "No flags to update" });

    const updates = [];
    const params = [];
    for (const entry of colMap.values()) {
      updates.push(entry.sql);
      if (entry.param !== undefined) params.push(entry.param);
    }
    updates.push("updated_at = NOW()");
    params.push(req.params.id);

    await db.prepare(`UPDATE caregiver_profiles SET ${updates.join(", ")} WHERE user_id = ?`).run(...params);

    res.json({ success: true, message: `Updated onboarding flags for ${user.email}`, updatedFlags: req.body });
  } catch (err) {
    console.error("Admin onboarding override error:", err);
    res.status(500).json({ error: "Failed to update onboarding flags" });
  }
});

// ─── PUT /api/admin/users/:id/photo — Admin set profile photo (base64) ───
router.put("/users/:id/photo", async (req, res) => {
  try {
    const db = await getDb();
    const { photo } = req.body;
    if (!photo) return res.status(400).json({ error: "photo is required" });
    const user = await db.prepare("SELECT id, email FROM users WHERE id = ?").get(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });
    await db.prepare("UPDATE users SET profile_photo = ?, avatar_url = ?, updated_at = NOW() WHERE id = ?").run(photo, photo, req.params.id);
    res.json({ success: true, email: user.email });
  } catch (err) {
    console.error("Admin photo update error:", err);
    res.status(500).json({ error: "Failed to update photo" });
  }
});

// ─── PUT /api/admin/users/:id/tester — Toggle is_tester flag ───
router.put("/users/:id/tester", async (req, res) => {
  try {
    const db = await getDb();
    const user = await db.prepare("SELECT id, email, first_name, is_tester FROM users WHERE id = ?").get(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    const newValue = user.is_tester ? 0 : 1;
    await db.prepare("UPDATE users SET is_tester = ? WHERE id = ?").run(newValue, req.params.id);

    // Notify the user
    try {
      const { sendPushToUser } = require("../push");
      const statusText = newValue ? "enabled" : "removed";
      await sendPushToUser(req.params.id, {
        title: "Account Updated",
        body: `An admin has ${statusText} Feedback Tester access for your account.`,
        data: { type: "admin_setting_change", setting: "is_tester", value: !!newValue },
      }, "admin_update");
    } catch (pushErr) { console.log("Push notify skipped:", pushErr.message); }

    res.json({ success: true, is_tester: !!newValue, email: user.email });
  } catch (err) {
    console.error("Admin tester toggle error:", err);
    res.status(500).json({ error: "Failed to toggle tester status" });
  }
});

// ─── PUT /api/admin/users/:id/companion-access — Toggle Kindred access flag ───
router.put("/users/:id/companion-access", async (req, res) => {
  try {
    const db = await getDb();
    const user = await db.prepare("SELECT id, email, first_name, companion_access FROM users WHERE id = ?").get(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    const newValue = user.companion_access ? 0 : 1;
    await db.prepare("UPDATE users SET companion_access = ? WHERE id = ?").run(newValue, req.params.id);

    // Notify the user
    try {
      const { sendPushToUser } = require("../push");
      const statusText = newValue ? "enabled" : "removed";
      await sendPushToUser(req.params.id, {
        title: "Account Updated",
        body: `An admin has ${statusText} Kindred access for your account.`,
        data: { type: "admin_setting_change", setting: "companion_access", value: !!newValue },
      }, "admin_update");
    } catch (pushErr) { console.log("Push notify skipped:", pushErr.message); }

    res.json({ success: true, companion_access: !!newValue, email: user.email });
  } catch (err) {
    console.error("Admin companion-access toggle error:", err);
    res.status(500).json({ error: "Failed to toggle companion access" });
  }
});

// ─── PUT /api/admin/users/:id/verify-email — Admin override: toggle email verification ───
router.put("/users/:id/verify-email", async (req, res) => {
  try {
    const db = await getDb();
    const user = await db.prepare("SELECT id, email, email_verified FROM users WHERE id = ?").get(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    const newValue = user.email_verified ? 0 : 1;
    await db.prepare("UPDATE users SET email_verified = ?, email_verified_at = NOW(), updated_at = NOW() WHERE id = ?").run(newValue, req.params.id);

    // Clean up any lingering verification tokens
    if (newValue === 1) {
      await db.prepare("DELETE FROM email_verification_tokens WHERE user_id = ?").run(req.params.id);
    }

    console.log(`  [admin] Email verification ${newValue ? 'granted' : 'revoked'} for ${user.email} by admin`);
    res.json({ success: true, email_verified: !!newValue, email: user.email });
  } catch (err) {
    console.error("Admin verify-email toggle error:", err);
    res.status(500).json({ error: "Failed to toggle email verification" });
  }
});
};
