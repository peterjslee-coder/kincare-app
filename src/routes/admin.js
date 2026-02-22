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

// ─── POST /api/admin/reseed — Re-run demo seed (wipes all data!) ───
// SAFEGUARDS: Requires explicit confirmation body, backs up real users first
router.post("/reseed", async (req, res) => {
  try {
    const { confirm, iUnderstandThisWipesAllData } = req.body || {};

    // Gate 1: Require explicit confirmation strings in the request body
    if (confirm !== "WIPE_ALL_DATA" || iUnderstandThisWipesAllData !== true) {
      return res.status(400).json({
        error: "RESEED BLOCKED — This will permanently destroy ALL data.",
        required: {
          confirm: "WIPE_ALL_DATA",
          iUnderstandThisWipesAllData: true,
        },
        hint: "Send POST with JSON body containing both fields to proceed.",
      });
    }

    const db = await getDb();

    // Gate 2: Count real (non-demo) users — warn if any exist
    const realUsers = await db.prepare(
      "SELECT id, email, first_name, last_name, role FROM users WHERE is_demo = 0 OR is_demo IS NULL"
    ).all();
    if (realUsers.length > 0) {
      console.warn(`⚠️  RESEED: ${realUsers.length} real (non-demo) user(s) will be destroyed:`);
      for (const u of realUsers) {
        console.warn(`   - ${u.email} (${u.first_name} ${u.last_name}, role: ${u.role})`);
      }
    }

    // Gate 3: Create a backup snapshot of critical tables before wiping
    const backupTimestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backup = {
      timestamp: backupTimestamp,
      users: await db.prepare("SELECT * FROM users").all(),
      care_recipients: await db.prepare("SELECT * FROM care_recipients").all(),
      care_sessions: await db.prepare("SELECT * FROM care_sessions").all(),
      caregiver_profiles: await db.prepare("SELECT * FROM caregiver_profiles").all(),
      messages: await db.prepare("SELECT id, sender_id, recipient_id, content, is_read, created_at FROM messages").all(),
      care_teams: await db.prepare("SELECT * FROM care_teams").all(),
      care_team_members: await db.prepare("SELECT * FROM care_team_members").all(),
      caregiver_assignments: await db.prepare("SELECT * FROM caregiver_assignments").all(),
      activity_feed: await db.prepare("SELECT * FROM activity_feed LIMIT 500").all(),
    };

    // Store backup in a dedicated table (survives because we create it before truncation)
    await db.exec(`CREATE TABLE IF NOT EXISTS _reseed_backups (
      id TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      data TEXT NOT NULL
    )`);
    await db.prepare(
      "INSERT INTO _reseed_backups (id, data) VALUES (?, ?)"
    ).run(backupTimestamp, JSON.stringify(backup));

    console.log(`📦 Pre-reseed backup saved as _reseed_backups.${backupTimestamp} (${backup.users.length} users, ${backup.care_sessions.length} sessions, ${backup.messages.length} messages)`);

    // Now proceed with actual reseed
    const { seed } = require("../seed");
    console.log("🔄 Admin-triggered reseed starting...");
    await seed({ force: true }); // force=true because the endpoint's own gates already confirmed
    console.log("✅ Admin-triggered reseed complete");
    res.json({
      success: true,
      message: "Database reseeded with fresh demo data",
      backup_id: backupTimestamp,
      real_users_wiped: realUsers.length,
      note: `Backup saved to _reseed_backups table with id '${backupTimestamp}'. Use GET /api/admin/reseed-backups to list.`,
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

module.exports = router;
