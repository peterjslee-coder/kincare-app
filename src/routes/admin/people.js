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

// ─── GET /api/admin/care-team-invites — List all care team invites ───
router.get("/care-team-invites", async (req, res) => {
  try {
    const db = await getDb();
    const invites = await db.prepare(`
      SELECT cti.id, cti.invited_email, cti.role, cti.status, cti.token, cti.expires_at, cti.created_at,
             ct.name AS team_name,
             cr.first_name AS recipient_first_name, cr.last_name AS recipient_last_name,
             u.first_name AS inviter_first_name, u.last_name AS inviter_last_name
      FROM care_team_invites cti
      JOIN care_teams ct ON cti.care_team_id = ct.id
      JOIN care_recipients cr ON ct.care_recipient_id = cr.id
      JOIN users u ON cti.invited_by = u.id
      /* v1.81.0 — demo-created invites out of the admin view */
      LEFT JOIN users du_check ON du_check.id = cti.invited_by AND COALESCE(du_check.is_demo, 0) = 1
      WHERE du_check.id IS NULL
      ORDER BY cti.created_at DESC
      LIMIT 100
    `).all();
    res.json({ careTeamInvites: invites, total: invites.length });
  } catch (err) {
    console.error("Admin care-team-invites error:", err);
    res.status(500).json({ error: "Failed to load care team invites" });
  }
});

// ─── POST /api/admin/care-team-add — Manually add a user to a care team by email ───
router.post("/care-team-add", async (req, res) => {
  try {
    const db = await getDb();
    const { email, careTeamId, careRecipientName } = req.body;
    if (!email) return res.status(400).json({ error: "email is required" });

    // Find the user
    const user = await db.prepare("SELECT id, email, first_name, last_name FROM users WHERE LOWER(email) = LOWER(?)").get(email);
    if (!user) return res.status(404).json({ error: `No user found with email ${email}` });

    // Find the care team — by ID or by care recipient name
    let team;
    if (careTeamId) {
      team = await db.prepare("SELECT * FROM care_teams WHERE id = ?").get(careTeamId);
    } else if (careRecipientName) {
      team = await db.prepare(`
        SELECT ct.* FROM care_teams ct
        JOIN care_recipients cr ON ct.care_recipient_id = cr.id
        WHERE LOWER(cr.first_name) = LOWER(?)
        LIMIT 1
      `).get(careRecipientName);
    } else {
      return res.status(400).json({ error: "careTeamId or careRecipientName is required" });
    }
    if (!team) return res.status(404).json({ error: "Care team not found" });

    // Check if already a member
    const existing = await db.prepare(
      "SELECT id FROM care_team_members WHERE care_team_id = ? AND user_id = ?"
    ).get(team.id, user.id);
    if (existing) return res.json({ message: "Already a member", userId: user.id, teamId: team.id });

    // Add as member
    const { v4: uuid } = require("uuid");
    await db.prepare(
      "INSERT INTO care_team_members (id, care_team_id, user_id, role, invited_by) VALUES (?, ?, ?, 'member', ?)"
    ).run(uuid(), team.id, user.id, req.user.id);

    // Also add care_recipient_shares
    const shareExists = await db.prepare(
      "SELECT id FROM care_recipient_shares WHERE care_recipient_id = ? AND shared_with_user_id = ?"
    ).get(team.care_recipient_id, user.id);
    if (!shareExists) {
      await db.prepare(
        "INSERT INTO care_recipient_shares (id, care_recipient_id, shared_with_user_id, permission, shared_by_user_id) VALUES (?, ?, ?, 'edit', ?)"
      ).run(uuid(), team.care_recipient_id, user.id, req.user.id);
    }

    // Auto-connect for messaging
    const members = await db.prepare(
      "SELECT user_id FROM care_team_members WHERE care_team_id = ? AND user_id != ?"
    ).all(team.id, user.id);
    for (const m of members) {
      const conn = await db.prepare(
        "SELECT id FROM connections WHERE (requester_id = ? AND recipient_id = ?) OR (requester_id = ? AND recipient_id = ?)"
      ).get(user.id, m.user_id, m.user_id, user.id);
      if (!conn) {
        await db.prepare(
          "INSERT INTO connections (id, requester_id, recipient_id, status) VALUES (?, ?, ?, 'accepted')"
        ).run(uuid(), user.id, m.user_id);
      }
    }

    // Add to care team conversation
    const conv = await db.prepare(
      "SELECT id FROM conversations WHERE care_team_id = ? AND type = 'care_team'"
    ).get(team.id);
    if (conv) {
      const inConv = await db.prepare(
        "SELECT id FROM conversation_members WHERE conversation_id = ? AND user_id = ?"
      ).get(conv.id, user.id);
      if (!inConv) {
        await db.prepare(
          "INSERT INTO conversation_members (id, conversation_id, user_id, role) VALUES (?, ?, ?, 'member')"
        ).run(uuid(), conv.id, user.id);
      }
    }

    // Mark any pending invites as accepted
    await db.prepare(
      "UPDATE care_team_invites SET status = 'accepted' WHERE care_team_id = ? AND LOWER(invited_email) = LOWER(?) AND status = 'pending'"
    ).run(team.id, email);

    console.log(`[admin] Manually added ${user.email} to care team ${team.name || team.id}`);
    res.json({
      ok: true,
      message: `Added ${user.first_name} ${user.last_name} (${user.email}) to care team`,
      userId: user.id, teamId: team.id,
    });
  } catch (err) {
    console.error("Admin care-team-add error:", err);
    res.status(500).json({ error: "Failed to add user to care team" });
  }
});

// ─── GET /api/admin/search-email — Search across users, waitlist, and invites ───
router.get("/search-email", async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) return res.status(400).json({ error: "Email query parameter required" });

    const db = await getDb();
    const normalizedEmail = email.trim().toLowerCase();

    const [user, waitlistEntry, invite, careTeamInvites] = await Promise.all([
      db.prepare(`
        SELECT id, email, role, first_name, last_name, phone, email_verified, is_demo, created_at
        FROM users WHERE LOWER(email) = ?
      `).get(normalizedEmail),
      db.prepare(`
        SELECT id, email, name, role, source, created_at
        FROM waitlist WHERE LOWER(email) = ?
      `).get(normalizedEmail),
      db.prepare(`
        SELECT pi.id, pi.invited_email, pi.role, pi.status, pi.expires_at, pi.created_at,
               u.first_name AS inviter_first_name, u.last_name AS inviter_last_name
        FROM platform_invites pi
        JOIN users u ON pi.invited_by = u.id
        WHERE LOWER(pi.invited_email) = ?
        ORDER BY pi.created_at DESC LIMIT 1
      `).get(normalizedEmail),
      db.prepare(`
        SELECT cti.id, cti.invited_email, cti.role, cti.status, cti.expires_at, cti.created_at,
               ct.name AS care_team_name,
               u.first_name AS inviter_first_name, u.last_name AS inviter_last_name
        FROM care_team_invites cti
        JOIN care_teams ct ON cti.care_team_id = ct.id
        JOIN users u ON cti.invited_by = u.id
        WHERE LOWER(cti.invited_email) = ?
        ORDER BY cti.created_at DESC
      `).all(normalizedEmail),
    ]);

    res.json({
      user: user || null,
      waitlist: waitlistEntry || null,
      invite: invite || null,
      careTeamInvites: careTeamInvites || [],
    });
  } catch (err) {
    console.error("Admin search-email error:", err);
    res.status(500).json({ error: "Failed to search" });
  }
});

// ─── POST /api/admin/reset-password ───
// Admin resets a user's password (sets to a temporary password + must_change_password flag)
router.post("/reset-password", async (req, res) => {
  try {
    const { userId, newPassword } = req.body;
    if (!userId || !newPassword) {
      return res.status(400).json({ error: "userId and newPassword required" });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }
    const db = await getDb();
    const user = await db.prepare("SELECT id, email FROM users WHERE id = ?").get(userId);
    if (!user) return res.status(404).json({ error: "User not found" });

    const bcrypt = require("bcryptjs");
    const hash = await bcrypt.hash(newPassword, 10);
    await db.prepare("UPDATE users SET password_hash = ?, updated_at = NOW() WHERE id = ?").run(hash, userId);

    await logAdminAction(req, "reset_password", "user", userId, { email: user.email });
    res.json({ success: true, message: `Password reset for ${user.email}` });
  } catch (err) {
    console.error("Admin reset-password error:", err);
    res.status(500).json({ error: "Failed to reset password" });
  }
});

// ─── DELETE /api/admin/users/:id ───
// Admin deletes a user and all associated data (same logic as self-service DELETE /api/auth/me)
// ─── DELETE /api/admin/users/:id — Admin account deletion (soft-delete) ───
// Same anonymization approach as self-service delete. Retains audit trail.
router.delete("/users/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const db = await getDb();
    const user = await db.prepare("SELECT id, email, role, is_demo FROM users WHERE id = ?").get(id);
    if (!user) return res.status(404).json({ error: "User not found" });

    const anonEmail = `deleted_${id.slice(0, 8)}@deleted.inplace`;

    // ── Run everything in a transaction so it's all-or-nothing ──
    await db.transaction(async (tx) => {
      const cgProfile = await tx.prepare("SELECT id FROM caregiver_profiles WHERE user_id = ?").get(id);
      const cgId = cgProfile?.id;

      // 1. Caregiver-specific cleanup
      if (cgId) {
        // Unassign ALL non-completed/cancelled sessions back to 'requested'
        await tx.prepare(`
          UPDATE care_sessions
          SET caregiver_id = NULL, status = 'requested', updated_at = NOW()
          WHERE caregiver_id = ? AND status NOT IN ('completed', 'cancelled')
        `).run(cgId);
        await tx.prepare("UPDATE session_offers SET status = 'expired' WHERE (from_user_id = ? OR to_user_id = ?) AND status = 'pending'").run(id, id);
        await tx.prepare("DELETE FROM caregiver_assignments WHERE caregiver_profile_id = ?").run(cgId);
        await tx.prepare("DELETE FROM availability WHERE caregiver_id = ?").run(cgId);
        await tx.prepare(`
          UPDATE caregiver_profiles SET
            bio = NULL, legal_first_name = NULL, legal_last_name = NULL,
            date_of_birth = NULL, ssn_last4 = NULL, address_line1 = NULL,
            address_line2 = NULL, zip = NULL, dl_number = NULL, dl_state = NULL,
            location_city = NULL, location_state = NULL, latitude = NULL, longitude = NULL,
            work_location_address = NULL, work_latitude = NULL, work_longitude = NULL,
            stripe_account_id = NULL, is_available = 0,
            updated_at = NOW()
          WHERE id = ?
        `).run(cgId);
      }

      // 2. Delete sensitive auth & device data
      await tx.prepare("DELETE FROM password_reset_tokens WHERE user_id = ?").run(id);
      await tx.prepare("DELETE FROM email_verification_tokens WHERE user_id = ?").run(id);
      await tx.prepare("DELETE FROM push_subscriptions WHERE user_id = ?").run(id);
      await tx.prepare("DELETE FROM oauth_accounts WHERE user_id = ?").run(id);
      await tx.prepare("DELETE FROM user_2fa WHERE user_id = ?").run(id);
      await tx.prepare("DELETE FROM trusted_devices WHERE user_id = ?").run(id);

      // 3. RETAIN personal documents — mark as retained for legal/compliance
      // Documents must survive account deletion for fraud/forgery protection
      await tx.prepare("UPDATE caregiver_documents SET retained_from_deleted = 1, deleted_user_email = ? WHERE user_id = ?").run(user.email, id);
      await tx.prepare("UPDATE verified_documents SET retained_from_deleted = 1, deleted_user_email = ? WHERE uploaded_by = ?").run(user.email, id);

      // 4. Remove from active teams & connections
      await tx.prepare("DELETE FROM care_team_members WHERE user_id = ?").run(id);
      await tx.prepare("DELETE FROM connections WHERE requester_id = ? OR recipient_id = ?").run(id, id);
      await tx.prepare("DELETE FROM conversation_members WHERE user_id = ?").run(id);
      await tx.prepare("DELETE FROM care_recipient_shares WHERE shared_with_user_id = ? OR shared_by_user_id = ?").run(id, id);
      await tx.prepare("UPDATE care_recipients SET linked_user_id = NULL WHERE linked_user_id = ?").run(id);

      // 5. RETAIN: messages, activity_feed, feedback, reviews, payments,
      //    care_sessions, background_check_payments, recipient_notes

      // 6. Anonymize the user row
      await tx.prepare(`
        UPDATE users SET
          deleted_email = email,
          email = ?,
          password_hash = 'DELETED',
          first_name = 'Deleted',
          last_name = 'User',
          phone = NULL,
          avatar_url = NULL,
          profile_photo = NULL,
          pets = NULL,
          pet_allergies = NULL,
          food_allergies = NULL,
          medical_conditions = NULL,
          notification_prefs = NULL,
          is_active = 0,
          deleted_at = NOW(),
          updated_at = NOW()
        WHERE id = ?
      `).run(anonEmail, id);
    }); // end transaction

    await logAdminAction(req, "delete_user", "user", id, { email: user.email, role: user.role });
    res.json({ success: true, message: `Soft-deleted user ${user.email} → ${anonEmail}` });
  } catch (err) {
    console.error("Admin delete user error:", err);
    console.error("User deletion error:", err.message); res.status(500).json({ error: "Failed to delete user" });
  }
});

// ─── POST /api/admin/users/:id/nuke/challenge — Generate passkey challenge for nuke confirmation ───
router.post("/users/:id/nuke/challenge", async (req, res) => {
  try {
    const db = await getDb();
    const target = await db.prepare("SELECT id, email FROM users WHERE id = ?").get(req.params.id);
    if (!target) return res.status(404).json({ error: "User not found" });

    // Get admin's passkeys
    const passkeys = await db.prepare(
      "SELECT credential_id, transports FROM user_passkeys WHERE user_id = ?"
    ).all(req.user.id);
    if (passkeys.length === 0) {
      return res.status(400).json({ error: "You need a registered passkey to use nuke. Set one up in My Account → Security." });
    }

    const allowCredentials = passkeys.map(pk => ({
      id: pk.credential_id,
      transports: pk.transports ? JSON.parse(pk.transports) : [],
    }));

    const options = await generateAuthenticationOptions({
      rpID: RP_ID,
      allowCredentials,
      userVerification: "required", // Must verify identity (biometric/PIN)
    });

    const challengeKey = `nuke_${req.user.id}_${req.params.id}_${Date.now()}`;
    setNukeChallenge(challengeKey, {
      challenge: options.challenge,
      adminId: req.user.id,
      targetUserId: req.params.id,
      targetEmail: target.email,
    });

    res.json({ ...options, _challengeKey: challengeKey });
  } catch (err) {
    console.error("Nuke challenge error:", err);
    res.status(500).json({ error: "Failed to generate passkey challenge" });
  }
});

// ─── DELETE /api/admin/users/:id/nuke — HARD DELETE all user data (requires passkey) ───
router.delete("/users/:id/nuke", async (req, res) => {
  try {
    const { _challengeKey, _passwordAuth, password, ...authResponse } = req.body;
    const db = await getDb();

    // Password-based fallback for admin verification
    if (_passwordAuth && password) {
      const bcrypt = require("bcryptjs");
      const adminUser = await db.prepare("SELECT password_hash, is_admin FROM users WHERE id = ?").get(req.user.id);
      if (!adminUser?.is_admin) return res.status(403).json({ error: "Admin access required." });
      const match = await bcrypt.compare(password, adminUser.password_hash);
      if (!match) return res.status(401).json({ error: "Incorrect password." });
    } else {
      // Passkey-based verification
      const stored = getNukeChallenge(_challengeKey);
      if (!stored) {
        return res.status(401).json({ error: "Passkey challenge expired. Please try again." });
      }
      if (stored.adminId !== req.user.id || stored.targetUserId !== req.params.id) {
        return res.status(401).json({ error: "Challenge mismatch." });
      }

      const passkey = await db.prepare(
        "SELECT pk.*, u.id as uid FROM user_passkeys pk JOIN users u ON pk.user_id = u.id WHERE pk.credential_id = ?"
      ).get(authResponse.id);
      if (!passkey || passkey.uid !== req.user.id) {
        return res.status(401).json({ error: "Passkey not recognized or doesn't belong to you." });
      }

      const EXPECTED_ORIGINS_NUKE = [
        ORIGIN,
        `android:apk-key-hash:${process.env.ANDROID_CERT_HASH || ""}`,
      ].filter(Boolean);

      const verification = await verifyAuthenticationResponse({
        response: authResponse,
        expectedChallenge: stored.challenge,
        expectedOrigin: EXPECTED_ORIGINS_NUKE,
        expectedRPID: RP_ID,
        credential: {
          id: passkey.credential_id,
          publicKey: Buffer.from(passkey.public_key, "base64url"),
          counter: Number(passkey.counter),
        },
        requireUserVerification: true,
      });

      if (!verification.verified) {
        return res.status(401).json({ error: "Passkey verification failed." });
      }

      // Update passkey counter
      await db.prepare("UPDATE user_passkeys SET counter = ?, last_used = NOW() WHERE id = ?")
        .run(verification.authenticationInfo.newCounter, passkey.id);
    }

    // 2. Get user info before nuking
    const { id } = req.params;
    const user = await db.prepare("SELECT id, email, role, is_admin, first_name, last_name FROM users WHERE id = ?").get(id);
    if (!user) return res.status(404).json({ error: "User not found" });

    // Safety: never nuke yourself
    if (id === req.user.id) {
      return res.status(400).json({ error: "You cannot nuke your own account." });
    }

    // 3. HARD DELETE everything in a transaction
    // IMPORTANT: Order matters — delete child rows before parent rows to avoid FK violations.
    // In PostgreSQL, a failed statement poisons the entire transaction (even if caught by JS try/catch).
    // We use SAVEPOINT/ROLLBACK TO for any statement that might fail (table may not exist, column missing, etc.)
    await db.transaction(async (tx) => {
      // Safe-run helper: wraps risky SQL in a savepoint so a failure doesn't poison the whole PG transaction
      const safeRun = async (sql, params = [], label = '') => {
        const sp = 'sp_' + Math.random().toString(36).slice(2, 10);
        try {
          await tx.prepare(`SAVEPOINT ${sp}`).run();
          await tx.prepare(sql).run(...params);
          await tx.prepare(`RELEASE SAVEPOINT ${sp}`).run();
        } catch (e) {
          await tx.prepare(`ROLLBACK TO SAVEPOINT ${sp}`).run();
          if (label) console.log(`  [NUKE] ${label} skip: ${e.message}`);
        }
      };

      const cgProfile = await tx.prepare("SELECT * FROM caregiver_profiles WHERE user_id = ?").get(id);
      const cgId = cgProfile?.id;

      // Archive background check data BEFORE deleting (permanent record)
      if (cgId && (cgProfile.checkr_candidate_id || cgProfile.checkr_report_id || cgProfile.is_background_checked || cgProfile.background_check_paid)) {
        const { v4: archiveUuid } = require("uuid");
        await tx.prepare(`
          INSERT INTO background_check_archive (
            id, user_id, user_email, user_first_name, user_last_name,
            caregiver_profile_id, checkr_candidate_id, checkr_report_id, checkr_invitation_id,
            checkr_status, is_background_checked, background_check_paid,
            bg_check_admin_approved, bg_check_admin_approved_by, bg_check_admin_approved_at,
            legal_first_name, legal_last_name, archived_at, archived_reason, original_created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), 'user_deleted', ?)
        `).run(
          archiveUuid(), id, user.email, user.first_name, user.last_name,
          cgId, cgProfile.checkr_candidate_id, cgProfile.checkr_report_id, cgProfile.checkr_invitation_id,
          cgProfile.checkr_status, cgProfile.is_background_checked ? 1 : 0, cgProfile.background_check_paid ? 1 : 0,
          cgProfile.bg_check_admin_approved ? 1 : 0, cgProfile.bg_check_admin_approved_by || null, cgProfile.bg_check_admin_approved_at || null,
          cgProfile.legal_first_name, cgProfile.legal_last_name, cgProfile.created_at
        );
        console.log(`  [NUKE] Archived background check for ${user.email}: candidate=${cgProfile.checkr_candidate_id}, report=${cgProfile.checkr_report_id}, status=${cgProfile.checkr_status}`);
      }

      // Caregiver-specific tables
      if (cgId) {
        // Visit photos → visit logs (need log IDs first)
        const vlogs = await tx.prepare("SELECT id FROM visit_logs WHERE caregiver_id = ?").all(cgId);
        for (const vl of vlogs) {
          await tx.prepare("DELETE FROM visit_photos WHERE visit_log_id = ?").run(vl.id);
        }
        await tx.prepare("DELETE FROM visit_logs WHERE caregiver_id = ?").run(cgId);
        await tx.prepare("DELETE FROM caregiver_assignments WHERE caregiver_profile_id = ?").run(cgId);
        await tx.prepare("DELETE FROM availability WHERE caregiver_id = ?").run(cgId);
        await tx.prepare("DELETE FROM reviews WHERE caregiver_id = ?").run(cgId);
        await tx.prepare("DELETE FROM payments WHERE caregiver_id = ?").run(cgId);
        await safeRun("DELETE FROM first_visit_confirmations WHERE caregiver_id = ?", [cgId], 'first_visit_confirmations(cg)');
        // Sessions: delete offers first, then sessions
        const cgSessions = await tx.prepare("SELECT id FROM care_sessions WHERE caregiver_id = ?").all(cgId);
        for (const cs of cgSessions) {
          await tx.prepare("DELETE FROM session_offers WHERE session_id = ?").run(cs.id);
        }
        await tx.prepare("DELETE FROM care_sessions WHERE caregiver_id = ? AND status NOT IN ('completed')").run(cgId);
        // Completed sessions: clear caregiver reference but keep for audit
        await tx.prepare("UPDATE care_sessions SET caregiver_id = NULL WHERE caregiver_id = ? AND status = 'completed'").run(cgId);
        await tx.prepare("DELETE FROM caregiver_profiles WHERE id = ?").run(cgId);
      }

      // Family-specific: care recipients + their cascading data
      const crs = await tx.prepare("SELECT id FROM care_recipients WHERE family_user_id = ?").all(id);
      for (const cr of crs) {
        await safeRun("DELETE FROM consent_outreach WHERE care_recipient_id = ?", [cr.id], 'consent_outreach(cr)');
        await safeRun("DELETE FROM consent_audit_log WHERE care_recipient_id = ?", [cr.id], 'consent_audit_log(cr)');
        await safeRun("DELETE FROM attestations WHERE care_recipient_id = ?", [cr.id], 'attestations');
        await safeRun("DELETE FROM verification_attempts WHERE care_recipient_id = ?", [cr.id], 'verification_attempts');
        await safeRun("DELETE FROM first_visit_confirmations WHERE care_recipient_id = ?", [cr.id], 'first_visit_confirmations(cr)');
        // RETAIN authorization documents — mark as retained for legal/compliance
        await safeRun("UPDATE authorization_documents SET retained_from_deleted = 1 WHERE care_recipient_id = ?", [cr.id], 'auth_docs retain');
        await safeRun("UPDATE verified_documents SET retained_from_deleted = 1 WHERE owner_type = 'care_recipient' AND owner_id = ?", [cr.id], 'verified_docs retain');
        await safeRun("DELETE FROM recipient_notes WHERE care_recipient_id = ?", [cr.id], 'recipient_notes(cr)');
        await tx.prepare("DELETE FROM caregiver_assignments WHERE care_recipient_id = ?").run(cr.id);
        await tx.prepare("DELETE FROM care_recipient_shares WHERE care_recipient_id = ?").run(cr.id);
        await tx.prepare("DELETE FROM activity_feed WHERE care_recipient_id = ?").run(cr.id);
        // Sessions under this care recipient
        const crSessions = await tx.prepare("SELECT id FROM care_sessions WHERE care_recipient_id = ?").all(cr.id);
        for (const cs of crSessions) {
          await tx.prepare("DELETE FROM session_offers WHERE session_id = ?").run(cs.id);
          const slogs = await tx.prepare("SELECT id FROM visit_logs WHERE session_id = ?").all(cs.id);
          for (const vl of slogs) {
            await tx.prepare("DELETE FROM visit_photos WHERE visit_log_id = ?").run(vl.id);
          }
          await tx.prepare("DELETE FROM visit_logs WHERE session_id = ?").run(cs.id);
          await safeRun("DELETE FROM reviews WHERE session_id = ?", [cs.id], 'reviews(session)');
          await safeRun("DELETE FROM payments WHERE session_id = ?", [cs.id], 'payments(session)');
        }
        await tx.prepare("DELETE FROM care_sessions WHERE care_recipient_id = ?").run(cr.id);
        // Care teams linked to this care recipient
        const teams = await tx.prepare("SELECT id FROM care_teams WHERE care_recipient_id = ?").all(cr.id);
        for (const t of teams) {
          await tx.prepare("UPDATE conversations SET care_team_id = NULL WHERE care_team_id = ?").run(t.id);
          await tx.prepare("DELETE FROM care_team_invites WHERE care_team_id = ?").run(t.id);
          await tx.prepare("DELETE FROM care_team_members WHERE care_team_id = ?").run(t.id);
        }
        await tx.prepare("DELETE FROM care_teams WHERE care_recipient_id = ?").run(cr.id);
      }
      await tx.prepare("DELETE FROM care_recipients WHERE family_user_id = ?").run(id);

      // Auth & security
      await tx.prepare("DELETE FROM refresh_tokens WHERE user_id = ?").run(id);
      await safeRun("DELETE FROM password_reset_tokens WHERE user_id = ?", [id], 'password_reset_tokens');
      await safeRun("DELETE FROM email_verification_tokens WHERE user_id = ?", [id], 'email_verification_tokens');
      await tx.prepare("DELETE FROM push_subscriptions WHERE user_id = ?").run(id);
      await safeRun("DELETE FROM oauth_accounts WHERE user_id = ?", [id], 'oauth_accounts');
      await safeRun("DELETE FROM user_2fa WHERE user_id = ?", [id], 'user_2fa');
      await safeRun("DELETE FROM trusted_devices WHERE user_id = ?", [id], 'trusted_devices');
      await tx.prepare("DELETE FROM user_passkeys WHERE user_id = ?").run(id);

      // RETAIN documents — mark as retained for legal/compliance
      await safeRun("UPDATE caregiver_documents SET retained_from_deleted = 1, deleted_user_email = ? WHERE user_id = ?", [user.email, id], 'caregiver_documents retain');
      await safeRun("UPDATE verified_documents SET retained_from_deleted = 1, deleted_user_email = ? WHERE uploaded_by = ?", [user.email, id], 'verified_documents retain');
      await safeRun("DELETE FROM background_check_payments WHERE user_id = ?", [id], 'bg_check_payments');
      await safeRun("DELETE FROM payout_preferences WHERE user_id = ?", [id], 'payout_preferences');

      // Social & messaging — must handle ALL FK references to users(id)
      await tx.prepare("DELETE FROM care_team_members WHERE user_id = ?").run(id);
      await safeRun("DELETE FROM care_team_invites WHERE invited_by = ?", [id], 'care_team_invites');
      await safeRun("DELETE FROM platform_invites WHERE invited_by = ?", [id], 'platform_invites');
      await safeRun("DELETE FROM connections WHERE requester_id = ? OR recipient_id = ?", [id, id], 'connections');
      await tx.prepare("DELETE FROM conversation_members WHERE user_id = ?").run(id);
      await safeRun("DELETE FROM message_reactions WHERE user_id = ?", [id], 'message_reactions');
      await tx.prepare("DELETE FROM messages WHERE sender_id = ? OR recipient_id = ?").run(id, id);
      await tx.prepare("DELETE FROM session_offers WHERE from_user_id = ? OR to_user_id = ?").run(id, id);
      await tx.prepare("UPDATE conversations SET created_by = NULL WHERE created_by = ?").run(id);
      await safeRun("UPDATE blocked_emails SET blocked_by = NULL WHERE blocked_by = ?", [id], 'blocked_emails');

      // Activity & feedback
      await tx.prepare("DELETE FROM activity_feed WHERE family_user_id = ?").run(id);
      await tx.prepare("DELETE FROM feedback WHERE user_id = ?").run(id);
      await safeRun("DELETE FROM onboarding_events WHERE user_id = ?", [id], 'onboarding_events');

      // Sessions owned by this family user
      await safeRun("DELETE FROM reviews WHERE family_user_id = ?", [id], 'reviews(family)');
      await safeRun("DELETE FROM payments WHERE family_user_id = ?", [id], 'payments(family)');
      const familySessions = await tx.prepare("SELECT id FROM care_sessions WHERE family_user_id = ?").all(id);
      for (const cs of familySessions) {
        await tx.prepare("DELETE FROM session_offers WHERE session_id = ?").run(cs.id);
        const slogs = await tx.prepare("SELECT id FROM visit_logs WHERE session_id = ?").all(cs.id);
        for (const vl of slogs) {
          await tx.prepare("DELETE FROM visit_photos WHERE visit_log_id = ?").run(vl.id);
        }
        await tx.prepare("DELETE FROM visit_logs WHERE session_id = ?").run(cs.id);
      }
      await tx.prepare("DELETE FROM care_sessions WHERE family_user_id = ?").run(id);

      // Recipient notes authored by this user
      await safeRun("DELETE FROM recipient_notes WHERE author_id = ?", [id], 'recipient_notes(author)');
      // Care recipient shares
      await safeRun("DELETE FROM care_recipient_shares WHERE shared_with_user_id = ? OR shared_by_user_id = ?", [id, id], 'care_recipient_shares');

      // Consent audit log entries by this user
      await safeRun("DELETE FROM consent_audit_log WHERE actor_id = ?", [id], 'consent_audit_log(actor)');

      // Safety flags & related sub-tables
      await safeRun("DELETE FROM safety_flag_threads WHERE participant_user_id = ?", [id], 'safety_flag_threads');
      await safeRun("UPDATE safety_flag_events SET actor_id = NULL WHERE actor_id = ?", [id], 'safety_flag_events');
      await safeRun("DELETE FROM safety_flags WHERE user_id = ?", [id], 'safety_flags');
      await safeRun("UPDATE safety_flags SET reviewed_by = NULL WHERE reviewed_by = ?", [id], 'safety_flags(reviewed_by)');

      // Tickets
      await safeRun("DELETE FROM admin_ticket_comments WHERE author_id = ?", [id], 'admin_ticket_comments');
      await safeRun("UPDATE admin_tickets SET assigned_to = NULL WHERE assigned_to = ?", [id], 'admin_tickets(assigned)');
      await safeRun("DELETE FROM admin_tickets WHERE reporter_user_id = ?", [id], 'admin_tickets(reporter)');
      await safeRun("UPDATE admin_tickets SET related_user_id = NULL WHERE related_user_id = ?", [id], 'admin_tickets(related)');

      // Interviews, disputes, time proposals, tips
      await safeRun("DELETE FROM interviews WHERE requested_by = ? OR requested_of = ?", [id, id], 'interviews');
      await safeRun("DELETE FROM session_disputes WHERE filed_by = ?", [id], 'session_disputes');
      await safeRun("UPDATE session_disputes SET resolved_by = NULL WHERE resolved_by = ?", [id], 'session_disputes(resolved)');
      await safeRun("DELETE FROM time_proposals WHERE caregiver_user_id = ?", [id], 'time_proposals');
      await safeRun("DELETE FROM tips WHERE family_user_id = ?", [id], 'tips');

      // Referrals, milestones, reminders, manual payments
      await safeRun("DELETE FROM referrals WHERE referrer_user_id = ?", [id], 'referrals');
      await safeRun("UPDATE referrals SET referred_user_id = NULL WHERE referred_user_id = ?", [id], 'referrals(referred)');
      await safeRun("DELETE FROM milestones WHERE user_id = ?", [id], 'milestones');
      await safeRun("DELETE FROM manual_payments WHERE from_user_id = ?", [id], 'manual_payments');
      await safeRun("DELETE FROM kindred_reminders WHERE from_user_id = ?", [id], 'kindred_reminders');
      await safeRun("DELETE FROM consent_outreach WHERE initiated_by = ?", [id], 'consent_outreach(initiated)');

      // Nullify nullable FK refs on surviving rows
      await safeRun("UPDATE care_teams SET billing_user_id = NULL WHERE billing_user_id = ?", [id], 'care_teams(billing)');
      await safeRun("UPDATE care_recipients SET linked_user_id = NULL WHERE linked_user_id = ?", [id], 'care_recipients(linked)');
      await safeRun("UPDATE caregiver_assignments SET family_user_id = NULL WHERE family_user_id = ?", [id], 'caregiver_assignments(family)');

      // Catch-all: try to nuke any remaining FK references we might have missed
      // Query PG catalog for all FK constraints pointing to users(id) and clean them
      const fkRefs = await tx.prepare(`
        SELECT tc.table_name, kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
        JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND ccu.table_name = 'users' AND ccu.column_name = 'id'
          AND tc.table_name != 'users'
      `).all();
      for (const fk of fkRefs) {
        // Skip tables we already handled above
        await safeRun(`DELETE FROM "${fk.table_name}" WHERE "${fk.column_name}" = ?`, [id], `catch-all: ${fk.table_name}.${fk.column_name}`);
      }

      // Finally: DELETE the user row
      await tx.prepare("DELETE FROM users WHERE id = ?").run(id);
    }); // end transaction

    await logAdminAction(req, "nuke_user", "user", id, { email: user.email, role: user.role, method: "passkey_verified" });
    console.log(`  [NUKE] Admin ${req.user.id} permanently deleted user ${user.email} (${id})`);
    res.json({ success: true, message: `☢️ Permanently deleted ${user.email} and all associated data.` });
  } catch (err) {
    console.error("Nuke user error:", err);
    console.error("Nuke error stack:", err.stack);
    res.status(500).json({ error: `Operation failed: ${err.message}` });
  }
});

// ─── POST /api/admin/users/:id/reset-password — Admin force-resets a user's password ───
// Invalidates old password immediately (user cannot log in with it) and sends reset email.
router.post("/users/:id/reset-password", async (req, res) => {
  try {
    const db = await getDb();
    const { id } = req.params;
    const user = await db.prepare("SELECT id, email, first_name FROM users WHERE id = ?").get(id);
    if (!user) return res.status(404).json({ error: "User not found" });

    const crypto = require("crypto");
    const bcrypt = require("bcryptjs");
    const { sendEmail, brandedHtml } = require("../utils/email");

    // 1. Invalidate old password — set to random hash so old password stops working immediately
    const randomPw = crypto.randomBytes(32).toString("hex");
    const invalidHash = await bcrypt.hash(randomPw, 10);
    await db.prepare("UPDATE users SET password_hash = ?, must_change_password = 1, updated_at = NOW() WHERE id = ?").run(invalidHash, user.id);

    // 2. Create reset token
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours for admin resets

    await db.prepare("DELETE FROM password_reset_tokens WHERE user_id = ?").run(user.id);
    await db.prepare(
      "INSERT INTO password_reset_tokens (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)"
    ).run(uuid(), user.id, token, expiresAt);

    // 3. Send reset email
    const baseUrl = (process.env.APP_URL || "https://yourinplace.com").replace(/\/$/, "");
    const resetUrl = `${baseUrl}/?reset=${token}`;
    await sendEmail({
      to: user.email,
      subject: "Reset your InPlace password",
      html: brandedHtml({
        title: "InPlace",
        greeting: `Hi ${user.first_name},`,
        body: "Your password has been reset by an administrator. Click below to create a new password:",
        ctaUrl: resetUrl,
        ctaText: "Create New Password",
        footnote: "This link expires in 24 hours. You'll need to set a new password before you can sign in.",
      }),
    });

    await logAdminAction(req, "force_password_reset", "user", id, { email: user.email });
    res.json({ success: true, message: `Password invalidated & reset email sent to ${user.email}` });
  } catch (err) {
    console.error("Admin force password reset error:", err);
    res.status(500).json({ error: "Failed to reset password" });
  }
});
};
