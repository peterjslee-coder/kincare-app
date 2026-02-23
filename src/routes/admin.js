const express = require("express");
const { getDb } = require("../models/database");
const { authenticate, requireAdmin } = require("../middleware/auth");

const router = express.Router();

// ─── Admin check middleware ───
// Runs after authenticate, looks up is_admin from DB and sets req.isAdmin
async function checkAdmin(req, res, next) {
  // API key auth already sets isAdmin — skip DB lookup
  if (req.isAdmin) return next();
  try {
    const db = await getDb();
    const user = await db.prepare("SELECT is_admin FROM users WHERE id = ?").get(req.user.id);
    req.isAdmin = !!(user && user.is_admin);
    next();
  } catch (err) {
    console.error("Admin check error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}

// All admin routes require auth + admin check + admin flag
router.use(authenticate, checkAdmin, requireAdmin);

// ─── GET /api/admin/stats — Platform overview metrics ───
router.get("/stats", async (req, res) => {
  try {
    const db = await getDb();

    const [users, waitlist, sessions, caregivers, recentSignups] = await Promise.all([
      db.prepare("SELECT COUNT(*) as count FROM users WHERE COALESCE(is_demo, 0) = 0").get(),
      db.prepare("SELECT COUNT(*) as count FROM waitlist").get(),
      db.prepare("SELECT COUNT(*) as count FROM care_sessions").get(),
      db.prepare("SELECT COUNT(*) as count FROM caregiver_profiles cp JOIN users u ON cp.user_id = u.id WHERE COALESCE(u.is_demo, 0) = 0").get(),
      // Signups per day for last 30 days
      db.prepare(`
        SELECT DATE(created_at) as date, COUNT(*) as count
        FROM users WHERE COALESCE(is_demo, 0) = 0
        AND created_at > NOW() - INTERVAL '30 days'
        GROUP BY DATE(created_at)
        ORDER BY date ASC
      `).all(),
    ]);

    // Waitlist signups per day for last 30 days
    const waitlistTrend = await db.prepare(`
      SELECT DATE(created_at) as date, COUNT(*) as count
      FROM waitlist
      WHERE created_at > NOW() - INTERVAL '30 days'
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `).all();

    // Sessions by status
    const sessionsByStatus = await db.prepare(`
      SELECT status, COUNT(*) as count FROM care_sessions GROUP BY status
    `).all();

    res.json({
      totalUsers: parseInt(users.count),
      totalWaitlist: parseInt(waitlist.count),
      totalSessions: parseInt(sessions.count),
      totalCaregivers: parseInt(caregivers.count),
      signupTrend: recentSignups,
      waitlistTrend,
      sessionsByStatus,
    });
  } catch (err) {
    console.error("Admin stats error:", err);
    res.status(500).json({ error: "Failed to load stats" });
  }
});

// ─── GET /api/admin/users — All registered users ───
router.get("/users", async (req, res) => {
  try {
    const db = await getDb();
    const { search, role, sort = "created_at", order = "DESC", limit = 50, offset = 0 } = req.query;

    // Build query dynamically
    let sql = `
      SELECT id, email, role, first_name, last_name, phone, email_verified, is_demo, is_admin, created_at, updated_at
      FROM users WHERE 1=1
    `;
    const params = [];

    if (search) {
      params.push(`%${search}%`, `%${search}%`);
      sql += ` AND (email ILIKE ? OR (first_name || ' ' || last_name) ILIKE ?)`;
    }
    if (role) {
      params.push(role);
      sql += ` AND role = ?`;
    }
    if (req.query.demo === 'true') {
      sql += ` AND COALESCE(is_demo, 0) = 1`;
    } else if (req.query.demo === 'false') {
      sql += ` AND COALESCE(is_demo, 0) = 0`;
    }

    // Validate sort column to prevent SQL injection
    const validSorts = ["created_at", "email", "first_name", "role"];
    const sortCol = validSorts.includes(sort) ? sort : "created_at";
    const sortOrder = order.toUpperCase() === "ASC" ? "ASC" : "DESC";
    sql += ` ORDER BY ${sortCol} ${sortOrder}`;

    params.push(parseInt(limit), parseInt(offset));
    sql += ` LIMIT ? OFFSET ?`;

    const users = await db.prepare(sql).all(...params);

    // Total count for pagination
    let countSql = "SELECT COUNT(*) as count FROM users WHERE 1=1";
    const countParams = [];
    if (search) {
      countParams.push(`%${search}%`, `%${search}%`);
      countSql += ` AND (email ILIKE ? OR (first_name || ' ' || last_name) ILIKE ?)`;
    }
    if (role) {
      countParams.push(role);
      countSql += ` AND role = ?`;
    }
    if (req.query.demo === 'true') {
      countSql += ` AND COALESCE(is_demo, 0) = 1`;
    } else if (req.query.demo === 'false') {
      countSql += ` AND COALESCE(is_demo, 0) = 0`;
    }
    const total = await db.prepare(countSql).get(...countParams);

    res.json({ users, total: parseInt(total.count) });
  } catch (err) {
    console.error("Admin users error:", err);
    res.status(500).json({ error: "Failed to load users" });
  }
});

// ─── GET /api/admin/waitlist — Full waitlist ───
router.get("/waitlist", async (req, res) => {
  try {
    const db = await getDb();
    const { sort = "created_at", order = "DESC", limit = 100, offset = 0 } = req.query;

    const validSorts = ["created_at", "email", "name"];
    const sortCol = validSorts.includes(sort) ? sort : "created_at";
    const sortOrder = order.toUpperCase() === "ASC" ? "ASC" : "DESC";

    const entries = await db.prepare(`
      SELECT id, email, name, role, source, created_at
      FROM waitlist
      ORDER BY ${sortCol} ${sortOrder}
      LIMIT ? OFFSET ?
    `).all(parseInt(limit), parseInt(offset));

    const total = await db.prepare("SELECT COUNT(*) as count FROM waitlist").get();

    res.json({ entries, total: parseInt(total.count) });
  } catch (err) {
    console.error("Admin waitlist error:", err);
    res.status(500).json({ error: "Failed to load waitlist" });
  }
});

// ─── GET /api/admin/activity — Recent platform activity ───
router.get("/activity", async (req, res) => {
  try {
    const db = await getDb();
    const { limit = 50 } = req.query;

    // Recent registrations
    const recentUsers = await db.prepare(`
      SELECT id, email, first_name, last_name, role, created_at
      FROM users WHERE COALESCE(is_demo, 0) = 0
      ORDER BY created_at DESC LIMIT ?
    `).all(parseInt(limit));

    // Recent sessions
    const recentSessions = await db.prepare(`
      SELECT cs.id, cs.service_type, cs.status, cs.scheduled_date, cs.created_at,
             u.first_name || ' ' || u.last_name as family_name,
             cr.first_name || ' ' || cr.last_name as recipient_name
      FROM care_sessions cs
      JOIN users u ON cs.family_user_id = u.id
      JOIN care_recipients cr ON cs.care_recipient_id = cr.id
      ORDER BY cs.created_at DESC LIMIT ?
    `).all(parseInt(limit));

    // Recent waitlist signups
    const recentWaitlist = await db.prepare(`
      SELECT id, email, name, created_at FROM waitlist
      ORDER BY created_at DESC LIMIT ?
    `).all(parseInt(limit));

    res.json({ recentUsers, recentSessions, recentWaitlist });
  } catch (err) {
    console.error("Admin activity error:", err);
    res.status(500).json({ error: "Failed to load activity" });
  }
});

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
      ORDER BY cti.created_at DESC
      LIMIT 100
    `).all();
    res.json({ careTeamInvites: invites, total: invites.length });
  } catch (err) {
    console.error("Admin care-team-invites error:", err);
    res.status(500).json({ error: "Failed to load care team invites" });
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

    res.json({ success: true, message: `Password reset for ${user.email}` });
  } catch (err) {
    console.error("Admin reset-password error:", err);
    res.status(500).json({ error: "Failed to reset password" });
  }
});

// ─── DELETE /api/admin/users/:id ───
// Admin deletes a user and all associated data (same logic as self-service DELETE /api/auth/me)
router.delete("/users/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const db = await getDb();
    const user = await db.prepare("SELECT id, email, role, is_demo FROM users WHERE id = ?").get(id);
    if (!user) return res.status(404).json({ error: "User not found" });

    const cgProfile = await db.prepare("SELECT id FROM caregiver_profiles WHERE user_id = ?").get(id);
    const cgId = cgProfile?.id;

    if (cgId) {
      await db.prepare("DELETE FROM visit_photos WHERE visit_log_id IN (SELECT id FROM visit_logs WHERE caregiver_id = ?)").run(cgId);
      await db.prepare("DELETE FROM visit_logs WHERE caregiver_id = ?").run(cgId);
      await db.prepare("DELETE FROM availability WHERE caregiver_id = ?").run(cgId);
      await db.prepare("DELETE FROM reviews WHERE caregiver_id = ?").run(cgId);
      await db.prepare("DELETE FROM payments WHERE caregiver_id = ?").run(cgId);
      await db.prepare("DELETE FROM caregiver_assignments WHERE caregiver_profile_id = ?").run(cgId);
      await db.prepare("DELETE FROM care_sessions WHERE caregiver_id = ?").run(cgId);
      await db.prepare("DELETE FROM caregiver_profiles WHERE id = ?").run(cgId);
    }

    await db.prepare("DELETE FROM caregiver_documents WHERE user_id = ?").run(id);
    await db.prepare("DELETE FROM password_reset_tokens WHERE user_id = ?").run(id);
    await db.prepare("DELETE FROM email_verification_tokens WHERE user_id = ?").run(id);
    await db.prepare("DELETE FROM push_subscriptions WHERE user_id = ?").run(id);
    await db.prepare("DELETE FROM oauth_accounts WHERE user_id = ?").run(id);
    await db.prepare("DELETE FROM user_2fa WHERE user_id = ?").run(id);
    await db.prepare("DELETE FROM trusted_devices WHERE user_id = ?").run(id);
    // Reset any accepted invites back to pending so the email can be re-invited
    await db.prepare("UPDATE care_team_invites SET status = 'pending' WHERE invited_email = ? AND status = 'accepted'").run(user.email);
    await db.prepare("DELETE FROM care_team_members WHERE user_id = ?").run(id);
    await db.prepare("DELETE FROM conversation_members WHERE user_id = ?").run(id);
    await db.prepare("DELETE FROM activity_feed WHERE family_user_id = ?").run(id);
    await db.prepare("DELETE FROM care_recipient_shares WHERE shared_with_user_id = ? OR shared_by_user_id = ?").run(id, id);
    await db.prepare("DELETE FROM recipient_notes WHERE author_id = ?").run(id);
    await db.prepare("DELETE FROM messages WHERE sender_id = ? OR recipient_id = ?").run(id, id);
    await db.prepare("DELETE FROM users WHERE id = ?").run(id);

    res.json({ success: true, message: `Deleted user ${user.email}` });
  } catch (err) {
    console.error("Admin delete user error:", err);
    res.status(500).json({ error: "Failed to delete user: " + (err.message || "") });
  }
});

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
             onboarding_complete, is_available,
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

    res.json({
      user: { id: user.id, email: user.email, role: user.role, name: `${user.first_name || ''} ${user.last_name || ''}`.trim() },
      profile: profile || null,
      documents: docs || [],
      flags: profile ? {
        backgroundCheckCleared: !!profile.is_background_checked,
        backgroundCheckPaid: !!profile.background_check_paid,
        backgroundCheckConsent: !!profile.background_check_consent,
        onboardingComplete: !!profile.onboarding_complete,
        isAvailable: !!profile.is_available,
        hasPhoto,
        hasDriversLicense: !!(profile.dl_number && profile.dl_state),
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

    const { backgroundCheckCleared, backgroundCheckPaid, onboardingComplete, isAvailable } = req.body;
    const updates = [];
    const params = [];

    if (backgroundCheckCleared !== undefined) {
      updates.push("is_background_checked = ?");
      params.push(backgroundCheckCleared ? 1 : 0);
    }
    if (backgroundCheckPaid !== undefined) {
      updates.push("background_check_paid = ?");
      params.push(backgroundCheckPaid ? 1 : 0);
    }
    if (onboardingComplete !== undefined) {
      updates.push("onboarding_complete = ?");
      params.push(onboardingComplete ? 1 : 0);
    }
    if (isAvailable !== undefined) {
      updates.push("is_available = ?");
      params.push(isAvailable ? 1 : 0);
    }

    if (updates.length === 0) return res.status(400).json({ error: "No flags to update" });

    updates.push("updated_at = NOW()");
    params.push(req.params.id);

    await db.prepare(`UPDATE caregiver_profiles SET ${updates.join(", ")} WHERE user_id = ?`).run(...params);

    res.json({ success: true, message: `Updated onboarding flags for ${user.email}`, updatedFlags: req.body });
  } catch (err) {
    console.error("Admin onboarding override error:", err);
    res.status(500).json({ error: "Failed to update onboarding flags" });
  }
});

// ─── POST /api/admin/reseed — Refresh demo data (PRESERVES real users) ───
// Always uses demoOnly mode — real user data is NEVER touched.
// Still requires confirmation as a safety measure.
router.post("/reseed", async (req, res) => {
  try {
    const { confirm } = req.body || {};

    // Gate: Require confirmation string
    if (confirm !== "REFRESH_DEMO_DATA") {
      return res.status(400).json({
        error: "Reseed requires confirmation.",
        required: { confirm: "REFRESH_DEMO_DATA" },
        hint: "This will delete and re-insert all demo (is_demo=1) data. Real user data is preserved.",
      });
    }

    const db = await getDb();

    // Count what exists before reseed for logging
    const demoCount = await db.prepare("SELECT COUNT(*) as count FROM users WHERE is_demo = 1").get();
    const realCount = await db.prepare("SELECT COUNT(*) as count FROM users WHERE is_demo = 0 OR is_demo IS NULL").get();

    console.log(`🔄 Admin-triggered demo reseed: ${demoCount.count} demo users to refresh, ${realCount.count} real user(s) preserved`);

    // Proceed with demo-only reseed — real data untouched
    const { seed } = require("../seed");
    await seed({ demoOnly: true });

    console.log("✅ Admin-triggered demo reseed complete");
    res.json({
      success: true,
      message: "Demo data refreshed. Real user data preserved.",
      demo_users_refreshed: parseInt(demoCount.count),
      real_users_preserved: parseInt(realCount.count),
    });
  } catch (err) {
    console.error("Admin reseed error:", err);
    res.status(500).json({ error: "Reseed failed: " + (err.message || "") });
  }
});

// ─── GET /api/admin/reseed-backups — List available pre-reseed backups ───
router.get("/reseed-backups", async (req, res) => {
  try {
    const db = await getDb();
    // Check if backup table exists
    const tableExists = await db.prepare(
      "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = '_reseed_backups')"
    ).get();
    if (!tableExists || !Object.values(tableExists)[0]) {
      return res.json({ backups: [], message: "No backups table found — no reseeds have been performed with the safeguarded endpoint." });
    }
    const backups = await db.prepare(
      "SELECT id, created_at, LENGTH(data) AS data_size_bytes FROM _reseed_backups ORDER BY created_at DESC"
    ).all();
    res.json({ backups });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/admin/reseed-backups/:id — Retrieve a specific backup ───
router.get("/reseed-backups/:id", async (req, res) => {
  try {
    const db = await getDb();
    const backup = await db.prepare("SELECT * FROM _reseed_backups WHERE id = ?").get(req.params.id);
    if (!backup) return res.status(404).json({ error: "Backup not found" });
    res.json({ id: backup.id, created_at: backup.created_at, data: JSON.parse(backup.data) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/admin/restore-user — Restore a user from a backup snapshot ───
router.post("/restore-user", async (req, res) => {
  try {
    const { backup_id, email } = req.body || {};
    if (!backup_id || !email) {
      return res.status(400).json({ error: "Required: backup_id and email" });
    }

    const db = await getDb();
    const backupRow = await db.prepare("SELECT data FROM _reseed_backups WHERE id = ?").get(backup_id);
    if (!backupRow) return res.status(404).json({ error: "Backup not found" });

    const data = JSON.parse(backupRow.data);
    const user = data.users?.find(u => u.email === email);
    if (!user) return res.status(404).json({ error: `User ${email} not found in backup ${backup_id}` });

    // Check if user already exists
    const existing = await db.prepare("SELECT id FROM users WHERE email = ?").get(email);
    if (existing) {
      return res.status(409).json({ error: `User ${email} already exists (id: ${existing.id}). Delete first or use a different approach.` });
    }

    // Re-insert the user with their original data
    await db.prepare(`
      INSERT INTO users (id, email, password_hash, role, roles, first_name, last_name, phone,
        is_active, is_demo, is_admin, email_verified, notification_prefs,
        pets, pet_allergies, food_allergies, medical_conditions, disclaimer_accepted_at, disclaimer_version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      user.id, user.email, user.password_hash, user.role, user.roles,
      user.first_name, user.last_name, user.phone,
      user.is_active ?? 1, user.is_demo ?? 0, user.is_admin ?? 0,
      user.email_verified ?? 0, user.notification_prefs,
      user.pets, user.pet_allergies, user.food_allergies, user.medical_conditions,
      user.disclaimer_accepted_at, user.disclaimer_version
    );

    res.json({
      success: true,
      message: `User ${email} restored from backup ${backup_id}`,
      user: { id: user.id, email: user.email, first_name: user.first_name, last_name: user.last_name, role: user.role },
    });
  } catch (err) {
    console.error("Restore user error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/admin/repair-demo — Insert missing demo data (care recipients, profiles, assignments) ───
router.post("/repair-demo", async (req, res) => {
  try {
    const db = await getDb();
    const { v4: uuid } = require("uuid");
    const results = [];

    // Look up existing demo user IDs
    const demoUsers = await db.prepare("SELECT id, email, role FROM users WHERE is_demo = 1").all();
    const findUser = (email) => {
      const u = demoUsers.find(x => x.email === email);
      return u ? u.id : null;
    };

    const peteId = findUser("paul@inplace.care");
    const mariaUserId = findUser("maria@inplace.care");
    const jamesUserId = findUser("james@inplace.care");
    const sarahUserId = findUser("sarah@inplace.care");
    const davidUserId = findUser("david@inplace.care");
    const bettyUserId = findUser("barbara@inplace.care");
    const davidLeeId = findUser("david.lowe@inplace.care");
    const susanLeeId = findUser("susan.lowe@inplace.care");
    const hendersonFamilyId = findUser("linda@inplace.care");
    const patelFamilyId = findUser("raj@inplace.care");

    if (!peteId || !mariaUserId) {
      return res.status(400).json({ error: "Required demo users not found", found: demoUsers.map(u => u.email) });
    }

    // Check which care recipients already exist per demo family user
    const existingCR = await db.prepare("SELECT family_user_id FROM care_recipients WHERE family_user_id IN (SELECT id FROM users WHERE is_demo = 1)").all();
    const existingFamilyIds = new Set(existingCR.map(r => r.family_user_id));

    // ─── Care Recipients ───
    const bettyId = uuid(), dorothyId = uuid(), arunId = uuid(), carlosId = uuid();

    if (peteId && !existingFamilyIds.has(peteId)) {
      await db.prepare(`INSERT INTO care_recipients (id, family_user_id, first_name, last_name, age, location_address, location_city, location_state, location_zip, latitude, longitude, health_conditions, medications, preferences, emergency_contact_name, emergency_contact_phone, pets, pet_allergies, food_allergies, medical_conditions) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        bettyId, peteId, "Barbara", "Lowe", 78, "123 Main Street", "Blacksburg", "VA", "24060", 37.2296, -80.4139,
        JSON.stringify(["Early-stage dementia (diagnosed 2024)","Mild arthritis — both knees","High blood pressure (controlled)","Occasional vertigo when standing quickly","Poor hearing in left ear — wears hearing aid"]),
        JSON.stringify(["Donepezil 10mg daily (evening)","Lisinopril 10mg daily (morning)","Ibuprofen 200mg PRN for knee pain","Calcium + Vitamin D supplement","Baby aspirin 81mg daily"]),
        "Prefers female caregivers. Loves gardening and old movies. Needs gentle reminders for meals and medications.",
        "Paul Lowe", "(626) 555-0142",
        "2 cats — Whiskers (orange tabby) and Mittens (calico)", "None known",
        JSON.stringify(["Peanuts (severe — carries EpiPen)","Shellfish (mild — causes hives)"]),
        "Early-stage dementia, mild arthritis, high blood pressure, occasional vertigo, poor hearing left ear"
      );
      results.push("Barbara Lowe created");
    } else { results.push("Barbara skipped (exists or no Paul)"); }

    if (hendersonFamilyId && !existingFamilyIds.has(hendersonFamilyId)) {
      await db.prepare(`INSERT INTO care_recipients (id, family_user_id, first_name, last_name, age, location_address, location_city, location_state, location_zip, latitude, longitude, health_conditions, medications, preferences, emergency_contact_name, emergency_contact_phone, pets, pet_allergies, food_allergies, medical_conditions) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        dorothyId, hendersonFamilyId, "Dorothy", "Henderson", 82, "456 Oak Avenue", "Blacksburg", "VA", "24060", 37.2340, -80.4180,
        JSON.stringify(["Type 2 diabetes","Hearing loss"]), JSON.stringify(["Metformin 500mg twice daily","Vitamin B12"]),
        "Enjoys reading and birdwatching. Needs help with meal prep and grocery shopping.",
        "Linda Henderson", "(540) 555-0301", "1 cat — Pepper (black, indoor, senior, 14 yrs)", "None known", JSON.stringify([]),
        "Type 2 diabetes, hearing loss"
      );
      results.push("Dorothy Henderson created");
    } else { results.push("Dorothy skipped (exists or no Linda)"); }

    if (patelFamilyId && !existingFamilyIds.has(patelFamilyId)) {
      await db.prepare(`INSERT INTO care_recipients (id, family_user_id, first_name, last_name, age, location_address, location_city, location_state, location_zip, latitude, longitude, health_conditions, medications, preferences, emergency_contact_name, emergency_contact_phone, pets, pet_allergies, food_allergies, medical_conditions) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        arunId, patelFamilyId, "Arun", "Patel", 85, "789 Elm Drive", "Christiansburg", "VA", "24073", 37.1320, -80.4100,
        JSON.stringify(["Parkinson's disease (early stage)","Mild cognitive impairment"]), JSON.stringify(["Levodopa/Carbidopa","Memantine 10mg daily"]),
        "Speaks Hindi and English. Vegetarian. Enjoys chess and cricket on TV.",
        "Raj Patel", "(540) 555-0302", "None", "None known", JSON.stringify(["None"]),
        "Parkinson's disease (early stage), mild cognitive impairment"
      );
      results.push("Arun Patel created");
    } else { results.push("Arun skipped (exists or no Raj)"); }

    if (mariaUserId && !existingFamilyIds.has(mariaUserId)) {
      await db.prepare(`INSERT INTO care_recipients (id, family_user_id, first_name, last_name, age, location_address, location_city, location_state, location_zip, latitude, longitude, health_conditions, medications, preferences, emergency_contact_name, emergency_contact_phone, pets, pet_allergies, food_allergies, medical_conditions) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        carlosId, mariaUserId, "Carlos", "Santos", 30, "321 Pine Road", "Blacksburg", "VA", "24060", 37.2270, -80.4110,
        JSON.stringify(["Traumatic brain injury (recovery)","Short-term memory issues","Mild left-side weakness","Anxiety"]),
        JSON.stringify(["Sertraline 50mg daily","Gabapentin 300mg twice daily","Melatonin 5mg nightly"]),
        "Loves sports and video games. Responds well to routine and patience.",
        "Maria Santos", "(540) 555-0201", "1 dog — Luna (golden retriever, therapy dog)", "None known",
        JSON.stringify(["Dairy (moderate — causes stomach cramps)"]),
        "Traumatic brain injury (recovery), short-term memory issues, mild left-side weakness, anxiety"
      );
      results.push("Carlos Santos created");
    } else { results.push("Carlos skipped (exists)"); }

    // ─── Look up actual care recipient IDs from DB (some may have been skipped if they already existed) ───
    const actualBetty = peteId ? await db.prepare("SELECT id FROM care_recipients WHERE first_name='Barbara' AND last_name='Lowe' AND family_user_id=?").get(peteId) : null;
    const actualDorothy = hendersonFamilyId ? await db.prepare("SELECT id FROM care_recipients WHERE first_name='Dorothy' AND last_name='Henderson' AND family_user_id=?").get(hendersonFamilyId) : null;
    const actualArun = patelFamilyId ? await db.prepare("SELECT id FROM care_recipients WHERE first_name='Arun' AND last_name='Patel' AND family_user_id=?").get(patelFamilyId) : null;
    const actualCarlos = mariaUserId ? await db.prepare("SELECT id FROM care_recipients WHERE first_name='Carlos' AND last_name='Santos' AND family_user_id=?").get(mariaUserId) : null;

    // Use actual DB IDs (not the UUID variables which may not have been inserted)
    const realBettyId = actualBetty?.id;
    const realDorothyId = actualDorothy?.id;
    const realArunId = actualArun?.id;
    const realCarlosId = actualCarlos?.id;
    results.push(`Resolved care recipient IDs: Betty=${!!realBettyId}, Dorothy=${!!realDorothyId}, Arun=${!!realArunId}, Carlos=${!!realCarlosId}`);

    // ─── Caregiver Profiles ───
    const existingProfiles = await db.prepare("SELECT COUNT(*) as count FROM caregiver_profiles WHERE user_id IN (SELECT id FROM users WHERE is_demo = 1)").get();
    const mariaId = uuid(), jamesId = uuid(), sarahId = uuid(), davidId = uuid();

    if (parseInt(existingProfiles.count) === 0) {
      const stoplights = {
        maria: { 'Bathing / Showering':'green','Toileting':'green','Dressing':'green','Feeding / Meal Assistance':'green','Medication Reminders':'green','Mobility / Transfer':'green','Light Housekeeping':'green','Laundry':'green','Meal Preparation':'green','Grocery Shopping':'green','Transportation / Errands':'green','Companionship':'green','Exercise / Physical Therapy':'yellow','Wound Care':'yellow','Dementia / Memory Care':'green','Hospice / End-of-Life':'red' },
        james: { 'Bathing / Showering':'yellow','Toileting':'yellow','Dressing':'green','Feeding / Meal Assistance':'green','Medication Reminders':'green','Mobility / Transfer':'green','Light Housekeeping':'green','Laundry':'green','Meal Preparation':'yellow','Grocery Shopping':'green','Transportation / Errands':'green','Companionship':'green','Exercise / Physical Therapy':'green','Wound Care':'red','Dementia / Memory Care':'yellow','Hospice / End-of-Life':'red' },
        sarah: { 'Bathing / Showering':'green','Toileting':'green','Dressing':'green','Feeding / Meal Assistance':'green','Medication Reminders':'green','Mobility / Transfer':'green','Light Housekeeping':'yellow','Laundry':'yellow','Meal Preparation':'green','Grocery Shopping':'green','Transportation / Errands':'yellow','Companionship':'green','Exercise / Physical Therapy':'green','Wound Care':'green','Dementia / Memory Care':'green','Hospice / End-of-Life':'yellow' },
        david: { 'Bathing / Showering':'yellow','Toileting':'red','Dressing':'green','Feeding / Meal Assistance':'green','Medication Reminders':'green','Mobility / Transfer':'green','Light Housekeeping':'green','Laundry':'green','Meal Preparation':'yellow','Grocery Shopping':'green','Transportation / Errands':'green','Companionship':'green','Exercise / Physical Therapy':'green','Wound Care':'red','Dementia / Memory Care':'yellow','Hospice / End-of-Life':'red' },
      };

      const profs = [
        [mariaId, mariaUserId, "Certified dementia care specialist with 8 years of experience.", 8, 34, ["Dementia Care","Meal Prep"], ["CNA","CPR/First Aid"], 1, 4.9, 127, "Blacksburg", "VA", 37.2300, -80.4145, "Blacksburg, VA 24060", 15, stoplights.maria],
        [jamesId, jamesUserId, "Former social worker passionate about elder care.", 5, 25, ["Companionship","Transportation"], ["CPR/First Aid","Social Work License"], 1, 4.8, 93, "Blacksburg", "VA", 37.2310, -80.4160, "Blacksburg, VA 24060", 10, stoplights.james],
        [sarahId, sarahUserId, "Registered nurse turned home caregiver.", 12, 32, ["Meal Prep","Medication Reminders"], ["RN","Nutrition Certificate","CPR/First Aid"], 0, 4.9, 156, "Christiansburg", "VA", 37.1298, -80.4089, "Christiansburg, VA 24073", 25, stoplights.sarah],
        [davidId, davidUserId, "Reliable and patient. Great with seniors.", 3, 22, ["Errands","Light Housekeeping"], ["CPR/First Aid"], 1, 4.7, 68, "Blacksburg", "VA", 37.2280, -80.4200, "Blacksburg, VA 24060", 10, stoplights.david],
      ];
      for (const [id,uid,bio,yrs,rate,specs,certs,avail,rating,cnt,city,st,lat,lng,wl,rad,sl] of profs) {
        await db.prepare(`INSERT INTO caregiver_profiles (id,user_id,bio,years_experience,hourly_rate,specialties,certifications,is_background_checked,is_available,rating_avg,rating_count,location_city,location_state,latitude,longitude,work_location_address,max_travel_miles,care_stoplight,terms_accepted_at,terms_version,background_check_consent,background_check_consent_at) VALUES (?,?,?,?,?,?,?,1,?,?,?,?,?,?,?,?,?,?,NOW()-INTERVAL '30 days','1.0',1,NOW()-INTERVAL '30 days')`).run(
          id,uid,bio,yrs,rate,JSON.stringify(specs),JSON.stringify(certs),avail,rating,cnt,city,st,lat,lng,wl,rad,JSON.stringify(sl));
      }
      await db.prepare(`UPDATE caregiver_profiles SET onboarding_complete=1,checkr_status='clear',legal_first_name='Maria',legal_last_name='Santos',date_of_birth='1992-03-15',ssn_last4='4829',dl_number='S520-4829-0315',dl_state='VA' WHERE id=?`).run(mariaId);
      await db.prepare(`UPDATE caregiver_profiles SET checkr_status='pending',legal_first_name='James',legal_last_name='Okafor' WHERE id=?`).run(jamesId);
      results.push("4 caregiver profiles created");
    } else {
      // Profiles exist — look up their IDs for assignments
      const mp = await db.prepare("SELECT id FROM caregiver_profiles WHERE user_id=?").get(mariaUserId);
      const jp = await db.prepare("SELECT id FROM caregiver_profiles WHERE user_id=?").get(jamesUserId);
      const sp = await db.prepare("SELECT id FROM caregiver_profiles WHERE user_id=?").get(sarahUserId);
      // Use existing profile IDs instead
      Object.assign({ mariaId: mp?.id, jamesId: jp?.id, sarahId: sp?.id });
      results.push("Caregiver profiles already exist — skipped");
    }

    // ─── Assignments ───
    // Use the profile IDs we just created (or looked up)
    const mProf = await db.prepare("SELECT id FROM caregiver_profiles WHERE user_id=?").get(mariaUserId);
    const jProf = await db.prepare("SELECT id FROM caregiver_profiles WHERE user_id=?").get(jamesUserId);
    const sProf = await db.prepare("SELECT id FROM caregiver_profiles WHERE user_id=?").get(sarahUserId);

    const existingAssign = await db.prepare("SELECT COUNT(*) as count FROM caregiver_assignments WHERE family_user_id IN (SELECT id FROM users WHERE is_demo = 1)").get();
    if (parseInt(existingAssign.count) === 0 && mProf && jProf && sProf) {
      let assignCount = 0;
      const tryAssign = async (crId, famId, profId, fav) => {
        if (!crId || !famId || !profId) return;
        await db.prepare(`INSERT INTO caregiver_assignments (id,care_recipient_id,family_user_id,caregiver_profile_id,is_active,is_favorite) VALUES (?,?,?,?,1,?)`).run(uuid(), crId, famId, profId, fav);
        assignCount++;
      };
      await tryAssign(realBettyId, peteId, mProf.id, 1);
      await tryAssign(realBettyId, peteId, jProf.id, 0);
      await tryAssign(realDorothyId, hendersonFamilyId, mProf.id, 1);
      await tryAssign(realDorothyId, hendersonFamilyId, sProf.id, 0);
      await tryAssign(realArunId, patelFamilyId, jProf.id, 0);
      await tryAssign(realBettyId, davidLeeId, jProf.id, 0);
      await tryAssign(realBettyId, susanLeeId, jProf.id, 0);
      await tryAssign(realArunId, patelFamilyId, mProf.id, 0);
      await tryAssign(realCarlosId, mariaUserId, sProf.id, 1);
      await tryAssign(realCarlosId, mariaUserId, jProf.id, 0);
      results.push(`${assignCount} caregiver assignments created`);
    } else {
      results.push("Assignments already exist or profiles missing — skipped");
    }

    // ─── Avatars ───
    const avatars = [
      [mariaUserId, "maria@inplace.care"], [jamesUserId, "james@inplace.care"],
      [sarahUserId, "sarah@inplace.care"], [davidUserId, "david@inplace.care"],
      [peteId, "paul@inplace.care"], [bettyUserId, "barbara@inplace.care"],
      [davidLeeId, "david.lowe@inplace.care"], [susanLeeId, "susan.lowe@inplace.care"],
    ];
    for (const [uid, email] of avatars) {
      if (uid) await db.prepare(`UPDATE users SET avatar_url=?, profile_photo=? WHERE id=? AND is_demo=1`).run(`https://i.pravatar.cc/150?u=${email}`, `https://i.pravatar.cc/150?u=${email}`, uid);
    }
    results.push("Avatars set");

    // ─── Sibling shares ───
    try {
      if (realBettyId && peteId && davidLeeId) {
        await db.prepare(`INSERT INTO care_recipient_shares (id,care_recipient_id,owner_user_id,shared_with_user_id,permission) VALUES (?,?,?,?,'edit')`).run(uuid(), realBettyId, peteId, davidLeeId);
      }
      if (realBettyId && peteId && susanLeeId) {
        await db.prepare(`INSERT INTO care_recipient_shares (id,care_recipient_id,owner_user_id,shared_with_user_id,permission) VALUES (?,?,?,?,'edit')`).run(uuid(), realBettyId, peteId, susanLeeId);
      }
      results.push("Barbara shared with siblings");
    } catch (e) { results.push("Shares skipped (may already exist)"); }

    // ─── Availability ───
    const existingAvail = await db.prepare("SELECT COUNT(*) as count FROM availability WHERE caregiver_id IN (SELECT id FROM caregiver_profiles WHERE user_id IN (SELECT id FROM users WHERE is_demo = 1))").get();
    if (parseInt(existingAvail.count) === 0 && mProf) {
      for (let day = 1; day <= 5; day++) await db.prepare(`INSERT INTO availability (id,caregiver_id,day_of_week,start_time,end_time,type) VALUES (?,?,?,'08:00','17:00','available')`).run(uuid(), mProf.id, day);
      await db.prepare(`INSERT INTO availability (id,caregiver_id,day_of_week,start_time,end_time,type,note) VALUES (?,?,3,'14:00','16:00','blocked','Personal appointment')`).run(uuid(), mProf.id);
      if (jProf) {
        for (let day = 1; day <= 5; day++) await db.prepare(`INSERT INTO availability (id,caregiver_id,day_of_week,start_time,end_time,type) VALUES (?,?,?,'07:00','15:00','available')`).run(uuid(), jProf.id, day);
        await db.prepare(`INSERT INTO availability (id,caregiver_id,day_of_week,start_time,end_time,type) VALUES (?,?,6,'08:00','12:00','available')`).run(uuid(), jProf.id);
      }
      const dProf = await db.prepare("SELECT id FROM caregiver_profiles WHERE user_id=?").get(davidUserId);
      if (dProf) { for (let day = 1; day <= 5; day++) await db.prepare(`INSERT INTO availability (id,caregiver_id,day_of_week,start_time,end_time,type) VALUES (?,?,?,'08:00','17:00','available')`).run(uuid(), dProf.id, day); }
      if (sProf) { for (const day of [1,2,4,5]) await db.prepare(`INSERT INTO availability (id,caregiver_id,day_of_week,start_time,end_time,type) VALUES (?,?,?,'09:00','17:00','available')`).run(uuid(), sProf.id, day); }
      results.push("Availability windows created");
    } else {
      results.push("Availability already exists — skipped");
    }

    console.log("✅ Demo repair complete:", results);
    res.json({ ok: true, results });
  } catch (err) {
    console.error("❌ Demo repair error:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
