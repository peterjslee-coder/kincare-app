const express = require("express");
const { v4: uuid } = require("uuid");
const { getDb } = require("../models/database");
const { authenticate, requireAdmin } = require("../middleware/auth");
const authRouter = require("./auth");
const { sendVerificationEmail } = authRouter;
const {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require("@simplewebauthn/server");

// Passkey config (matches passkeys.js)
const RP_ID = process.env.RP_ID || (process.env.APP_URL ? new URL(process.env.APP_URL).hostname : "yourinplace.com");
const ORIGIN = process.env.APP_URL || "https://yourinplace.com";

// In-memory challenge store for passkey-protected actions (short-lived, 2-min TTL)
const passkeyChallenges = new Map();
function setPasskeyChallenge(key, value) {
  passkeyChallenges.set(key, { value, expires: Date.now() + 2 * 60 * 1000 });
  for (const [k, v] of passkeyChallenges) {
    if (v.expires < Date.now()) passkeyChallenges.delete(k);
  }
}
function getPasskeyChallenge(key) {
  const entry = passkeyChallenges.get(key);
  if (!entry) return null;
  passkeyChallenges.delete(key); // one-time use
  if (entry.expires < Date.now()) return null;
  return entry.value;
}
// Aliases for backward compat
const setNukeChallenge = setPasskeyChallenge;
const getNukeChallenge = getPasskeyChallenge;

const router = express.Router();

// ─── Audit log helper ───
async function logAdminAction(req, action, targetType, targetId, details) {
  try {
    const db = await getDb();
    await db.prepare(
      "INSERT INTO admin_audit_log (id, admin_user_id, action, target_type, target_id, details, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(uuid(), req.user.id, action, targetType || null, targetId || null, details ? JSON.stringify(details) : null, req.ip || req.headers['x-forwarded-for'] || null);
  } catch (err) {
    console.error("Audit log error:", err.message);
  }
}

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

// ─── GET /api/admin/alerts — Lightweight count of items needing admin attention ───
// Returns raw counts + a "seen" snapshot so the client only badges NEW items
router.get("/alerts", async (req, res) => {
  try {
    const db = await getDb();
    const [pendingUsers, pausedCaregivers, pendingConsent, newFeedback, safetyFlags, checkrAlerts, recentReferrals, recentMilestones, userRow] = await Promise.all([
      db.prepare(`SELECT COUNT(*) as count FROM users WHERE COALESCE(is_demo, 0) = 0 AND COALESCE(account_approved, 0) = 0 AND COALESCE(is_active, 1) = 1 AND created_at > '2026-02-20'`).get(),
      db.prepare(`SELECT COUNT(*) as count FROM caregiver_profiles WHERE account_paused = 1 AND COALESCE(checkr_status, 'pending') != 'rejected'`).get(),
      db.prepare(`SELECT COUNT(*) as count FROM care_recipients WHERE consent_status = 'pending' OR consent_status = 'attestation_pending'`).get(),
      db.prepare(`SELECT COUNT(*) as count FROM feedback WHERE status = 'new' AND created_at > NOW() - INTERVAL '30 days'`).get(),
      db.prepare(`SELECT COUNT(*) as count FROM safety_flags WHERE status IN ('pending', 'escalated')`).get().catch(() => ({ count: 0 })),
      // Unread Checkr webhook events in the last 7 days
      db.prepare(`SELECT COUNT(*) as count FROM activity_feed WHERE event_type IN ('checkr_submitted', 'checkr_cleared', 'checkr_flagged', 'checkr_expired', 'checkr_suspended', 'checkr_resumed', 'checkr_disputed') AND is_read = 0 AND created_at > NOW() - INTERVAL '7 days'`).get().catch(() => ({ count: 0 })),
      // Referral stats (last 7 days)
      db.prepare(`SELECT COUNT(*) as count FROM referrals WHERE claimed_at > NOW() - INTERVAL '7 days' AND status = 'claimed'`).get().catch(() => ({ count: 0 })),
      // Recent milestones (last 7 days)
      db.prepare(`SELECT COUNT(*) as count FROM milestones WHERE created_at > NOW() - INTERVAL '7 days'`).get().catch(() => ({ count: 0 })),
      // Fetch admin's last-seen snapshot
      db.prepare(`SELECT admin_alerts_snapshot FROM users WHERE id = ?`).get(req.user.id).catch(() => null),
    ]);

    const counts = {
      pendingUsers: parseInt(pendingUsers.count) || 0,
      pausedCaregivers: parseInt(pausedCaregivers.count) || 0,
      pendingConsent: parseInt(pendingConsent.count) || 0,
      newFeedback: parseInt(newFeedback.count) || 0,
      safetyFlags: parseInt(safetyFlags.count) || 0,
      checkrAlerts: parseInt(checkrAlerts.count) || 0,
      recentReferrals: parseInt(recentReferrals.count) || 0,
      recentMilestones: parseInt(recentMilestones.count) || 0,
    };

    // Calculate delta from last-seen snapshot — only badge genuinely new items
    let seen = {};
    try { seen = JSON.parse(userRow?.admin_alerts_snapshot || '{}'); } catch {}
    const delta = {
      pendingUsers: Math.max(0, counts.pendingUsers - (seen.pendingUsers || 0)),
      pausedCaregivers: Math.max(0, counts.pausedCaregivers - (seen.pausedCaregivers || 0)),
      pendingConsent: Math.max(0, counts.pendingConsent - (seen.pendingConsent || 0)),
      newFeedback: Math.max(0, counts.newFeedback - (seen.newFeedback || 0)),
      safetyFlags: Math.max(0, counts.safetyFlags - (seen.safetyFlags || 0)),
      checkrAlerts: Math.max(0, counts.checkrAlerts - (seen.checkrAlerts || 0)),
    };

    const total = delta.pendingUsers + delta.pausedCaregivers + delta.pendingConsent +
      delta.newFeedback + delta.safetyFlags + delta.checkrAlerts;

    // Fetch caregivers with BG check results needing admin action
    const bgCheckActionItems = await db.prepare(`
      SELECT cp.user_id, cp.checkr_status, cp.is_background_checked, cp.bg_check_admin_approved,
        u.first_name, u.last_name, u.email, cp.updated_at
      FROM caregiver_profiles cp
      JOIN users u ON cp.user_id = u.id
      WHERE cp.checkr_status IN ('consider', 'adverse_action', 'disputed', 'suspended', 'did_not_pass')
        AND COALESCE(cp.is_background_checked, 0) = 0
        AND COALESCE(cp.bg_check_admin_approved, 0) = 0
        AND COALESCE(u.is_demo, 0) = 0
      ORDER BY cp.updated_at DESC
    `).all().catch(() => []);

    res.json({
      total,
      ...delta,
      // Raw counts for the snapshot when dismissing
      _raw: counts,
      // Caregivers with BG check results needing review
      bgCheckActionItems: bgCheckActionItems.map(c => ({
        userId: c.user_id,
        name: `${c.first_name} ${c.last_name}`,
        email: c.email,
        checkrStatus: c.checkr_status,
        updatedAt: c.updated_at,
      })),
    });
  } catch (err) {
    console.error("Admin alerts error:", err);
    res.status(500).json({ error: "Failed to load admin alerts" });
  }
});

// ─── POST /api/admin/alerts/dismiss-checkr — Mark Checkr alerts as read ───
router.post("/alerts/dismiss-checkr", async (req, res) => {
  try {
    const db = await getDb();
    await db.prepare(
      `UPDATE activity_feed SET is_read = 1 WHERE event_type IN ('checkr_submitted', 'checkr_cleared', 'checkr_flagged', 'checkr_expired', 'checkr_suspended', 'checkr_resumed', 'checkr_disputed') AND is_read = 0`
    ).run();
    res.json({ ok: true });
  } catch (err) {
    console.error("Dismiss checkr alerts error:", err);
    res.status(500).json({ error: "Failed to dismiss alerts" });
  }
});

// ─── POST /api/admin/alerts/dismiss-all — Save current counts as "seen" snapshot ───
// After this, only new items (counts that increase) will show in the badge
router.post("/alerts/dismiss-all", async (req, res) => {
  try {
    const db = await getDb();
    // Store snapshot of current counts on the user row
    const snapshot = JSON.stringify(req.body.snapshot || {});
    await db.prepare(
      "UPDATE users SET admin_alerts_snapshot = ?, admin_alerts_seen_at = NOW() WHERE id = ?"
    ).run(snapshot, req.user.id);
    // Also mark Checkr alerts as read
    await db.prepare(
      `UPDATE activity_feed SET is_read = 1 WHERE event_type IN ('checkr_submitted', 'checkr_cleared', 'checkr_flagged', 'checkr_expired', 'checkr_suspended', 'checkr_resumed', 'checkr_disputed') AND is_read = 0`
    ).run();
    res.json({ ok: true });
  } catch (err) {
    console.error("Dismiss all alerts error:", err);
    res.status(500).json({ error: "Failed to dismiss alerts" });
  }
});

// ─── GET /api/admin/stats — Platform overview metrics ───
router.get("/stats", async (req, res) => {
  try {
    const db = await getDb();

    // Wrap each core query individually so one failure doesn't crash the whole endpoint
    let users = { count: 0 }, waitlist = { count: 0 }, sessions = { count: 0 }, caregivers = { count: 0 }, recentSignups = [];
    try { users = await db.prepare("SELECT COUNT(*) as count FROM users WHERE COALESCE(is_demo, 0) = 0").get() || { count: 0 }; } catch (e) { console.error("Stats: users query failed:", e.message); }
    try { waitlist = await db.prepare("SELECT COUNT(*) as count FROM waitlist").get() || { count: 0 }; } catch (e) { console.error("Stats: waitlist query failed:", e.message); }
    try { sessions = await db.prepare("SELECT COUNT(*) as count FROM care_sessions cs WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id IN (cs.family_id, cs.caregiver_id) AND COALESCE(u.is_demo, 0) = 1)").get() || { count: 0 }; } catch (e) { console.error("Stats: sessions query failed:", e.message); }
    try { caregivers = await db.prepare("SELECT COUNT(*) as count FROM caregiver_profiles cp JOIN users u ON cp.user_id = u.id WHERE COALESCE(u.is_demo, 0) = 0").get() || { count: 0 }; } catch (e) { console.error("Stats: caregivers query failed:", e.message); }
    try {
      recentSignups = await db.prepare(`
        SELECT DATE(created_at) as date, COUNT(*) as count
        FROM users WHERE COALESCE(is_demo, 0) = 0
        AND created_at > NOW() - INTERVAL '30 days'
        GROUP BY DATE(created_at)
        ORDER BY date ASC
      `).all() || [];
    } catch (e) { console.error("Stats: recentSignups query failed:", e.message); }

    // Waitlist signups per day for last 30 days
    let waitlistTrend = [];
    try {
      waitlistTrend = await db.prepare(`
        SELECT DATE(created_at) as date, COUNT(*) as count
        FROM waitlist
        WHERE created_at > NOW() - INTERVAL '30 days'
        GROUP BY DATE(created_at)
        ORDER BY date ASC
      `).all() || [];
    } catch (e) { console.error("Stats: waitlistTrend query failed:", e.message); }

    // Sessions by status (excluding demo user sessions)
    let sessionsByStatus = [];
    try {
      sessionsByStatus = await db.prepare(`
        SELECT cs.status, COUNT(*) as count FROM care_sessions cs
        WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id IN (cs.family_id, cs.caregiver_id) AND COALESCE(u.is_demo, 0) = 1)
        GROUP BY cs.status
      `).all() || [];
    } catch (e) { console.error("Stats: sessionsByStatus query failed:", e.message); }

    // v1.53 — Enhanced stats for new admin dashboard
    let openTickets = { count: 0 }, safetyFlags = { count: 0 }, avgRating = { avg: 0, total: 0 }, revenueMtd = { total: 0 };
    try {
      openTickets = await db.prepare("SELECT COUNT(*) as count FROM admin_tickets WHERE status IN ('open', 'in_progress')").get() || { count: 0 };
    } catch (e) { /* table may not exist yet */ }
    try {
      safetyFlags = await db.prepare("SELECT COUNT(*) as count FROM safety_flags WHERE status IN ('pending', 'open', 'investigating', 'escalated')").get() || { count: 0 };
    } catch (e) { /* */ }
    try {
      avgRating = await db.prepare("SELECT ROUND(AVG(rating), 1) as avg, COUNT(*) as total FROM reviews").get() || { avg: 0, total: 0 };
    } catch (e) { /* */ }
    try {
      revenueMtd = await db.prepare("SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE status = 'completed' AND created_at >= date_trunc('month', NOW())").get() || { total: 0 };
    } catch (e) { /* */ }

    // Visits this week
    let visitsThisWeek = { count: 0 };
    try {
      visitsThisWeek = await db.prepare("SELECT COUNT(*) as count FROM care_sessions WHERE scheduled_date >= date_trunc('week', NOW())::date::text AND status NOT IN ('cancelled')").get() || { count: 0 };
    } catch (e) { /* */ }

    res.json({
      totalUsers: parseInt(users.count),
      totalWaitlist: parseInt(waitlist.count),
      totalSessions: parseInt(sessions.count),
      totalCaregivers: parseInt(caregivers.count),
      signupTrend: recentSignups,
      waitlistTrend,
      sessionsByStatus,
      // v1.53 additions
      openTickets: parseInt(openTickets.count || 0),
      safetyFlags: parseInt(safetyFlags.count || 0),
      avgRating: parseFloat(avgRating.avg || 0),
      totalReviews: parseInt(avgRating.total || 0),
      revenueMtd: parseFloat(revenueMtd.total || 0),
      visitsThisWeek: parseInt(visitsThisWeek.count || 0),
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
      SELECT id, email, role, first_name, last_name, phone, email_verified, is_demo, is_admin, admin_role, admin_notes, is_tester, is_active, companion_access, created_at, updated_at
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
    if (req.query.demo === 'demo') {
      sql += ` AND COALESCE(is_demo, 0) = 1`;
    } else if (req.query.demo === 'real' || !req.query.demo) {
      // Default: hide demo accounts unless explicitly requested
      sql += ` AND COALESCE(is_demo, 0) = 0`;
    }
    // demo=all → no filter (shows everything)

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
    if (req.query.demo === 'demo') {
      countSql += ` AND COALESCE(is_demo, 0) = 1`;
    } else if (req.query.demo === 'real' || !req.query.demo) {
      countSql += ` AND COALESCE(is_demo, 0) = 0`;
    }
    const total = await db.prepare(countSql).get(...countParams);

    res.json({ users, total: parseInt(total.count) });
  } catch (err) {
    console.error("Admin users error:", err);
    res.status(500).json({ error: "Failed to load users" });
  }
});

// ─── GET /api/admin/users/:id/detail — Person detail with journey stage ───
router.get("/users/:id/detail", async (req, res) => {
  try {
    const db = await getDb();
    const userId = req.params.id;

    // Core user data
    const user = await db.prepare(`
      SELECT id, email, role, first_name, last_name, phone, avatar_url, email_verified, is_demo,
        is_admin, admin_role, admin_notes, is_tester, is_active, companion_access, created_at, updated_at
      FROM users WHERE id = ?
    `).get(userId);
    if (!user) return res.status(404).json({ error: "User not found" });

    // Caregiver profile (if applicable)
    let caregiverProfile = null;
    try {
      caregiverProfile = await db.prepare(`
        SELECT cp.*, u.email FROM caregiver_profiles cp JOIN users u ON cp.user_id = u.id WHERE cp.user_id = ?
      `).get(userId);
    } catch (e) { /* */ }

    // Session counts
    const sessionStats = await db.prepare(`
      SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
        COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled,
        COUNT(CASE WHEN status IN ('open', 'requested', 'confirmed', 'pending') THEN 1 END) as upcoming
      FROM care_sessions
      WHERE family_user_id = ? OR caregiver_id = (SELECT id FROM caregiver_profiles WHERE user_id = ?)
    `).get(userId, userId);

    // Lifetime revenue (payments involving this user)
    let lifetimeRevenue = { total: 0 };
    try {
      lifetimeRevenue = await db.prepare(`
        SELECT COALESCE(SUM(amount), 0) as total FROM payments
        WHERE (family_user_id = ? OR caregiver_id = (SELECT id FROM caregiver_profiles WHERE user_id = ?))
        AND status = 'completed'
      `).get(userId, userId) || { total: 0 };
    } catch (e) { /* */ }

    // Reviews (given and received)
    let reviewStats = { given: 0, received: 0, avgReceived: 0 };
    try {
      const given = await db.prepare("SELECT COUNT(*) as count FROM reviews WHERE family_user_id = ?").get(userId);
      const received = await db.prepare(`
        SELECT COUNT(*) as count, ROUND(AVG(rating), 1) as avg FROM reviews
        WHERE caregiver_id = (SELECT id FROM caregiver_profiles WHERE user_id = ?)
      `).get(userId);
      reviewStats = { given: parseInt(given?.count || 0), received: parseInt(received?.count || 0), avgReceived: parseFloat(received?.avg || 0) };
    } catch (e) { /* */ }

    // Care team membership
    let careTeams = [];
    try {
      careTeams = await db.prepare(`
        SELECT ct.id, ct.name, ctm.role as team_role,
          cr.first_name || ' ' || cr.last_name as recipient_name
        FROM care_team_members ctm
        JOIN care_teams ct ON ctm.care_team_id = ct.id
        JOIN care_recipients cr ON ct.care_recipient_id = cr.id
        WHERE ctm.user_id = ?
      `).all(userId);
    } catch (e) { /* */ }

    // Related tickets
    let tickets = [];
    try {
      tickets = await db.prepare(`
        SELECT id, subject, status, priority, category, created_at
        FROM admin_tickets
        WHERE reporter_user_id = ? OR related_user_id = ?
        ORDER BY created_at DESC LIMIT 10
      `).all(userId, userId);
    } catch (e) { /* */ }

    // Safety flags involving this user
    let safetyFlags = [];
    try {
      safetyFlags = await db.prepare(`
        SELECT id, flag_type, description, status, severity, created_at
        FROM safety_flags
        WHERE reporter_user_id = ? OR flagged_user_id = ? OR caregiver_user_id = ?
        ORDER BY created_at DESC LIMIT 10
      `).all(userId, userId, userId);
    } catch (e) { /* */ }

    // ─── All uploaded documents (unified across all 3 tables) ───
    let allDocuments = [];
    try {
      // 1. caregiver_documents (legacy onboarding uploads — DL, certs)
      const cgDocs = await db.prepare(`
        SELECT id, 'caregiver_documents' AS source_table, document_type, file_name,
          'uploaded' AS status, NULL AS category, NULL AS ai_classification,
          NULL AS admin_notes, NULL AS expires_at, created_at
        FROM caregiver_documents WHERE user_id = ?
        ORDER BY created_at DESC
      `).all(userId).catch(() => []);

      // 2. verified_documents (unified system — DL, certs, insurance, consent, legal)
      const vDocs = await db.prepare(`
        SELECT id, 'verified_documents' AS source_table, document_type, file_name,
          status, category, ai_classification, admin_notes, expires_at, created_at
        FROM verified_documents WHERE uploaded_by = ? OR owner_id = ?
        ORDER BY created_at DESC
      `).all(userId, userId).catch(() => []);

      // 3. authorization_documents (legacy POA/guardianship — tied to care recipients)
      const authDocs = await db.prepare(`
        SELECT ad.id, 'authorization_documents' AS source_table, ad.document_type, ad.file_name,
          ad.upload_status AS status, 'legal' AS category, NULL AS ai_classification,
          ad.admin_notes, NULL AS expires_at, ad.created_at,
          cr.first_name || ' ' || cr.last_name AS recipient_name
        FROM authorization_documents ad
        LEFT JOIN care_recipients cr ON ad.care_recipient_id = cr.id
        WHERE ad.submitted_by = ?
        ORDER BY ad.created_at DESC
      `).all(userId).catch(() => []);

      allDocuments = [...cgDocs, ...vDocs, ...authDocs]
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    } catch (e) { console.error('Admin doc query error:', e); }

    // Last active (most recent activity_feed, message, or session)
    let lastActive = user.updated_at;
    try {
      const lastMsg = await db.prepare("SELECT MAX(created_at) as ts FROM messages WHERE sender_id = ?").get(userId);
      const lastActivity = await db.prepare("SELECT MAX(created_at) as ts FROM activity_feed WHERE family_user_id = ?").get(userId);
      const candidates = [user.updated_at, lastMsg?.ts, lastActivity?.ts].filter(Boolean);
      lastActive = candidates.sort().pop() || user.created_at;
    } catch (e) { /* */ }

    // ─── Compute Customer Journey Stage ───
    // Signup → Verified → Team Built → First Visit → Active → Churned
    let journeyStage = 'signup';
    let journeySteps = { signup: true, verified: false, team_built: false, first_visit: false, active: false };

    if (user.email_verified) {
      journeySteps.verified = true;
      journeyStage = 'verified';
    }
    if (careTeams.length > 0) {
      journeySteps.team_built = true;
      journeyStage = 'team_built';
    }
    if ((sessionStats?.completed || 0) > 0) {
      journeySteps.first_visit = true;
      journeyStage = 'first_visit';
    }
    if ((sessionStats?.completed || 0) >= 3) {
      journeySteps.active = true;
      journeyStage = 'active';
    }
    // Churn check: no activity in 30 days and had previous sessions
    if (journeySteps.first_visit && lastActive) {
      const daysSinceLast = (Date.now() - new Date(lastActive).getTime()) / (1000 * 86400);
      if (daysSinceLast > 30) journeyStage = 'churned';
    }

    res.json({
      user,
      caregiverProfile,
      sessionStats,
      lifetimeRevenue: parseFloat(lifetimeRevenue?.total || 0),
      reviewStats,
      careTeams,
      tickets,
      safetyFlags,
      allDocuments,
      lastActive,
      journeyStage,
      journeySteps,
    });
  } catch (err) {
    console.error("Admin user detail error:", err);
    res.status(500).json({ error: "Failed to load user detail" });
  }
});

// ─── PUT /api/admin/users/:id/admin-notes — Update admin sticky notes ───
router.put("/users/:id/admin-notes", async (req, res) => {
  try {
    const db = await getDb();
    const { notes } = req.body;
    await db.prepare("UPDATE users SET admin_notes = ?, updated_at = NOW() WHERE id = ?").run(notes || null, req.params.id);

    // Audit
    try {
      await db.prepare(
        "INSERT INTO admin_audit_log (id, admin_user_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?, ?)"
      ).run(uuid(), req.user.id, 'admin_notes_updated', 'user', req.params.id, JSON.stringify({ preview: (notes || '').slice(0, 100) }));
    } catch (e) { /* */ }

    res.json({ ok: true });
  } catch (err) {
    console.error("Admin notes error:", err);
    res.status(500).json({ error: "Failed to update admin notes" });
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
      await tx.prepare("UPDATE caregiver_documents SET retained_from_deleted = 1, deleted_user_email = ? WHERE user_id = ?").run(anonEmail, id);
      await tx.prepare("UPDATE verified_documents SET retained_from_deleted = 1, deleted_user_email = ? WHERE uploaded_by = ?").run(anonEmail, id);

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
    const { _challengeKey, ...authResponse } = req.body;

    // 1. Verify passkey challenge
    const stored = getNukeChallenge(_challengeKey);
    if (!stored) {
      return res.status(401).json({ error: "Passkey challenge expired. Please try again." });
    }
    if (stored.adminId !== req.user.id || stored.targetUserId !== req.params.id) {
      return res.status(401).json({ error: "Challenge mismatch." });
    }

    const db = await getDb();
    const passkey = await db.prepare(
      "SELECT pk.*, u.id as uid FROM user_passkeys pk JOIN users u ON pk.user_id = u.id WHERE pk.credential_id = ?"
    ).get(authResponse.id);
    if (!passkey || passkey.uid !== req.user.id) {
      return res.status(401).json({ error: "Passkey not recognized or doesn't belong to you." });
    }

    const verification = await verifyAuthenticationResponse({
      response: authResponse,
      expectedChallenge: stored.challenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      credential: {
        id: passkey.credential_id,
        publicKey: Buffer.from(passkey.public_key, "base64"),
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

    // 2. Get user info before nuking
    const { id } = req.params;
    const user = await db.prepare("SELECT id, email, role, is_admin FROM users WHERE id = ?").get(id);
    if (!user) return res.status(404).json({ error: "User not found" });

    // Safety: never nuke yourself
    if (id === req.user.id) {
      return res.status(400).json({ error: "You cannot nuke your own account." });
    }

    // 3. HARD DELETE everything in a transaction
    // IMPORTANT: Order matters — delete child rows before parent rows to avoid FK violations.
    await db.transaction(async (tx) => {
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
        await tx.prepare("DELETE FROM first_visit_confirmations WHERE caregiver_id = ?").run(cgId);
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
        // Consent & authorization tables (must delete before care_recipients)
        await tx.prepare("DELETE FROM consent_outreach WHERE care_recipient_id = ?").run(cr.id);
        await tx.prepare("DELETE FROM consent_audit_log WHERE care_recipient_id = ?").run(cr.id);
        await tx.prepare("DELETE FROM attestations WHERE care_recipient_id = ?").run(cr.id);
        await tx.prepare("DELETE FROM verification_attempts WHERE care_recipient_id = ?").run(cr.id);
        await tx.prepare("DELETE FROM first_visit_confirmations WHERE care_recipient_id = ?").run(cr.id);
        // RETAIN authorization documents — mark as retained for legal/compliance
        await tx.prepare("UPDATE authorization_documents SET retained_from_deleted = 1 WHERE care_recipient_id = ?").run(cr.id);
        await tx.prepare("UPDATE verified_documents SET retained_from_deleted = 1 WHERE owner_type = 'care_recipient' AND owner_id = ?").run(cr.id);
        await tx.prepare("DELETE FROM recipient_notes WHERE care_recipient_id = ?").run(cr.id);
        await tx.prepare("DELETE FROM caregiver_assignments WHERE care_recipient_id = ?").run(cr.id);
        await tx.prepare("DELETE FROM care_recipient_shares WHERE care_recipient_id = ?").run(cr.id);
        // Activity feed referencing this care recipient
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
          await tx.prepare("DELETE FROM reviews WHERE session_id = ?").run(cs.id);
          await tx.prepare("DELETE FROM payments WHERE session_id = ?").run(cs.id);
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
      await tx.prepare("DELETE FROM password_reset_tokens WHERE user_id = ?").run(id);
      await tx.prepare("DELETE FROM email_verification_tokens WHERE user_id = ?").run(id);
      await tx.prepare("DELETE FROM push_subscriptions WHERE user_id = ?").run(id);
      await tx.prepare("DELETE FROM oauth_accounts WHERE user_id = ?").run(id);
      await tx.prepare("DELETE FROM user_2fa WHERE user_id = ?").run(id);
      await tx.prepare("DELETE FROM trusted_devices WHERE user_id = ?").run(id);
      await tx.prepare("DELETE FROM user_passkeys WHERE user_id = ?").run(id);

      // RETAIN documents — mark as retained for legal/compliance
      await tx.prepare("UPDATE caregiver_documents SET retained_from_deleted = 1, deleted_user_email = ? WHERE user_id = ?").run(anonEmail, id);
      await tx.prepare("UPDATE verified_documents SET retained_from_deleted = 1, deleted_user_email = ? WHERE uploaded_by = ?").run(anonEmail, id);
      await tx.prepare("DELETE FROM background_check_payments WHERE user_id = ?").run(id);
      await tx.prepare("DELETE FROM payout_preferences WHERE user_id = ?").run(id);

      // Social & messaging — must handle ALL FK references to users(id)
      await tx.prepare("DELETE FROM care_team_members WHERE user_id = ?").run(id);
      await tx.prepare("DELETE FROM care_team_invites WHERE invited_by = ?").run(id);
      await tx.prepare("DELETE FROM platform_invites WHERE invited_by = ?").run(id);
      await tx.prepare("DELETE FROM connections WHERE requester_id = ? OR recipient_id = ?").run(id, id);
      await tx.prepare("DELETE FROM conversation_members WHERE user_id = ?").run(id);
      await tx.prepare("DELETE FROM message_reactions WHERE user_id = ?").run(id);
      // Messages: delete where sender OR recipient (both columns REFERENCE users)
      await tx.prepare("DELETE FROM messages WHERE sender_id = ? OR recipient_id = ?").run(id, id);
      // Session offers: delete any offers FROM or TO this user (both REFERENCE users)
      await tx.prepare("DELETE FROM session_offers WHERE from_user_id = ? OR to_user_id = ?").run(id, id);
      // Conversations: nullify created_by (REFERENCES users, nullable in practice)
      await tx.prepare("UPDATE conversations SET created_by = NULL WHERE created_by = ?").run(id);
      // Blocked emails: nullify blocked_by (REFERENCES users, nullable)
      await tx.prepare("UPDATE blocked_emails SET blocked_by = NULL WHERE blocked_by = ?").run(id);

      // Activity & feedback
      await tx.prepare("DELETE FROM activity_feed WHERE family_user_id = ?").run(id);
      await tx.prepare("DELETE FROM feedback WHERE user_id = ?").run(id);
      await tx.prepare("DELETE FROM onboarding_events WHERE user_id = ?").run(id);

      // Sessions owned by this family user
      await tx.prepare("DELETE FROM reviews WHERE family_user_id = ?").run(id);
      await tx.prepare("DELETE FROM payments WHERE family_user_id = ?").run(id);
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
      await tx.prepare("DELETE FROM recipient_notes WHERE author_id = ?").run(id);
      // Care recipient shares
      await tx.prepare("DELETE FROM care_recipient_shares WHERE shared_with_user_id = ? OR shared_by_user_id = ?").run(id, id);

      // Consent audit log entries by this user
      await tx.prepare("DELETE FROM consent_audit_log WHERE actor_id = ?").run(id);

      // Finally: DELETE the user row
      await tx.prepare("DELETE FROM users WHERE id = ?").run(id);
    }); // end transaction

    await logAdminAction(req, "nuke_user", "user", id, { email: user.email, role: user.role, method: "passkey_verified" });
    console.log(`  [NUKE] Admin ${req.user.id} permanently deleted user ${user.email} (${id})`);
    res.json({ success: true, message: `☢️ Permanently deleted ${user.email} and all associated data.` });
  } catch (err) {
    console.error("Nuke user error:", err);
    console.error("Nuke error:", err.message); res.status(500).json({ error: "Operation failed" });
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

// ─── Customer Service: Reviews Management ───

// GET /api/admin/reviews — Fetch reviews with optional filters
router.get("/reviews", requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const { status, maxRating, limit: lim } = req.query;
    const maxR = parseInt(maxRating) || 3;
    const limitN = Math.min(parseInt(lim) || 50, 200);
    let where = "WHERE r.rating < ?";
    const params = [maxR];

    if (status && status !== 'all') {
      where += " AND COALESCE(r.admin_status, 'pending') = ?";
      params.push(status);
    }

    params.push(limitN);

    const rows = await db.prepare(`
      SELECT r.*,
        fu.first_name || ' ' || fu.last_name AS family_name,
        fu.email AS family_email,
        cu.first_name || ' ' || cu.last_name AS caregiver_name,
        cp.rating_avg AS caregiver_rating_avg,
        cp.rating_count AS caregiver_rating_count,
        cs.scheduled_date, cs.scheduled_time, cs.service_type,
        cr.first_name || ' ' || cr.last_name AS recipient_name,
        au.first_name || ' ' || au.last_name AS reviewed_by_name
      FROM reviews r
      JOIN users fu ON r.family_user_id = fu.id
      JOIN caregiver_profiles cp ON r.caregiver_id = cp.id
      JOIN users cu ON cp.user_id = cu.id
      JOIN care_sessions cs ON r.session_id = cs.id
      LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
      LEFT JOIN users au ON r.admin_reviewed_by = au.id
      ${where}
      ORDER BY r.created_at DESC
      LIMIT ?
    `).all(...params);

    // Summary counts
    const counts = await db.prepare(`
      SELECT
        COUNT(*) FILTER (WHERE rating < 3) AS total_flagged,
        COUNT(*) FILTER (WHERE rating < 3 AND COALESCE(admin_status, 'pending') = 'pending') AS pending,
        COUNT(*) FILTER (WHERE rating < 3 AND admin_status = 'reviewed') AS reviewed,
        COUNT(*) FILTER (WHERE rating < 3 AND admin_status = 'escalated') AS escalated,
        COUNT(*) FILTER (WHERE rating < 3 AND admin_status = 'resolved') AS resolved
      FROM reviews
    `).get();

    res.json({ reviews: rows, counts });
  } catch (err) {
    console.error("Admin reviews fetch error:", err);
    res.status(500).json({ error: "Failed to fetch reviews" });
  }
});

// PUT /api/admin/reviews/:id — Update admin status/notes on a review
router.put("/reviews/:id", requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const { admin_status, admin_notes } = req.body;
    if (!admin_status) return res.status(400).json({ error: "admin_status is required" });

    const review = await db.prepare("SELECT id FROM reviews WHERE id = ?").get(req.params.id);
    if (!review) return res.status(404).json({ error: "Review not found" });

    await db.prepare(`
      UPDATE reviews SET admin_status = ?, admin_notes = ?, admin_reviewed_by = ?, admin_reviewed_at = NOW()
      WHERE id = ?
    `).run(admin_status, admin_notes || null, req.user.id, req.params.id);

    res.json({ ok: true });
  } catch (err) {
    console.error("Admin review update error:", err);
    res.status(500).json({ error: "Failed to update review" });
  }
});

// ─── Security: Audit Log & Anomaly Detection ───

// GET /api/admin/security/audit-log — Paginated audit log with filters
router.get("/security/audit-log", requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const { severity, action, userId, limit: lim, offset: off, startDate, endDate } = req.query;
    const limitN = Math.min(parseInt(lim) || 50, 200);
    const offsetN = parseInt(off) || 0;

    let where = "WHERE 1=1";
    const params = [];
    if (severity && severity !== 'all') { where += " AND severity = ?"; params.push(severity); }
    if (action && action !== 'all') { where += " AND action = ?"; params.push(action); }
    if (userId) { where += " AND user_id = ?"; params.push(userId); }
    if (startDate) { where += " AND created_at >= ?"; params.push(startDate); }
    if (endDate) { where += " AND created_at <= ?"; params.push(endDate); }

    const rows = await db.prepare(`
      SELECT * FROM audit_log ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?
    `).all(...params, limitN, offsetN);

    const countRow = await db.prepare(`SELECT COUNT(*) as total FROM audit_log ${where}`).get(...params);

    res.json({ entries: rows, total: countRow?.total || 0 });
  } catch (err) {
    console.error("Audit log fetch error:", err);
    res.status(500).json({ error: "Failed to fetch audit log" });
  }
});

// GET /api/admin/security/dashboard — Anomaly detection summary
router.get("/security/dashboard", requireAdmin, async (req, res) => {
  try {
    const db = await getDb();

    // Counts by severity in last 24h
    const severityCounts = await db.prepare(`
      SELECT severity, COUNT(*) as count
      FROM audit_log
      WHERE created_at > NOW() - INTERVAL '24 hours'
      GROUP BY severity
      ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'error' THEN 2 WHEN 'warn' THEN 3 ELSE 4 END
    `).all();

    // Top actions in last 24h
    const topActions = await db.prepare(`
      SELECT action, COUNT(*) as count, COUNT(DISTINCT user_id) as unique_users, COUNT(DISTINCT ip_address) as unique_ips
      FROM audit_log
      WHERE created_at > NOW() - INTERVAL '24 hours'
      GROUP BY action ORDER BY count DESC LIMIT 15
    `).all();

    // Failed logins in last 24h
    const failedLogins24h = await db.prepare(`
      SELECT ip_address, COUNT(*) as count, MAX(created_at) as last_attempt,
        MIN(created_at) as first_attempt, user_email
      FROM audit_log
      WHERE action = 'login_attempt' AND severity IN ('warn', 'critical')
        AND created_at > NOW() - INTERVAL '24 hours'
      GROUP BY ip_address, user_email
      HAVING COUNT(*) >= 3
      ORDER BY count DESC
      LIMIT 20
    `).all();

    // Critical/error events in last 7 days
    const criticalEvents = await db.prepare(`
      SELECT * FROM audit_log
      WHERE severity IN ('critical', 'error')
        AND created_at > NOW() - INTERVAL '7 days'
      ORDER BY created_at DESC
      LIMIT 20
    `).all();

    // Admin access in last 24h
    const adminAccess = await db.prepare(`
      SELECT user_email, ip_address, COUNT(*) as count, MAX(created_at) as last_access,
        MIN(created_at) as first_access
      FROM audit_log
      WHERE action = 'admin_access'
        AND created_at > NOW() - INTERVAL '24 hours'
      GROUP BY user_email, ip_address
      ORDER BY count DESC
    `).all();

    // Hourly activity for last 24h (for chart)
    const hourlyActivity = await db.prepare(`
      SELECT date_trunc('hour', created_at) as hour, COUNT(*) as count, severity
      FROM audit_log
      WHERE created_at > NOW() - INTERVAL '24 hours'
      GROUP BY date_trunc('hour', created_at), severity
      ORDER BY hour
    `).all();

    // Anomaly flags from in-memory tracker
    const { failedLogins: failedLoginTracker } = require("../middleware/auditLog");
    const activeThreats = [];
    for (const [ip, data] of failedLoginTracker) {
      if (data.count >= 5) {
        activeThreats.push({ ip, failedCount: data.count, since: new Date(data.firstAt).toISOString() });
      }
    }

    res.json({
      severityCounts,
      topActions,
      failedLogins: failedLogins24h,
      criticalEvents,
      adminAccess,
      hourlyActivity,
      activeThreats,
    });
  } catch (err) {
    console.error("Security dashboard error:", err);
    res.status(500).json({ error: "Failed to load security dashboard" });
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

    const { backgroundCheckCleared, backgroundCheckPaid, stripeOnboardComplete, onboardingComplete, isAvailable } = req.body;
    // Each flag is now independent — no cascading. Admin picks exactly which steps to skip.
    const colMap = new Map(); // column -> { sql, param? }

    if (backgroundCheckCleared !== undefined) {
      colMap.set("is_background_checked", { sql: "is_background_checked = ?", param: backgroundCheckCleared ? 1 : 0 });
      colMap.set("checkr_status", { sql: backgroundCheckCleared ? "checkr_status = 'clear'" : "checkr_status = 'pending'" });
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
      const { sendPushToUser } = require("./push");
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
      const { sendPushToUser } = require("./push");
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
    console.error("Reseed error:", err.message); res.status(500).json({ error: "Reseed failed" });
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
    console.error("Admin API error:", err.message); res.status(500).json({ error: "Internal server error" });
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
    console.error("Admin API error:", err.message); res.status(500).json({ error: "Internal server error" });
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
    console.error("Admin API error:", err.message); res.status(500).json({ error: "Internal server error" });
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
    console.error("Admin API error:", err.message); res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/admin/reseed-demo ───
// Full demo-only reseed: deletes all demo user data (cascading), then re-creates
// everything from seed.js with rich data (sessions, messages, notes, reviews, etc.)
// Real user data is NEVER touched.
router.post("/reseed-demo", authenticate, checkAdmin, requireAdmin, async (req, res) => {
  try {
    console.log("🔄 Admin triggered demo-only reseed...");
    const { seed } = require("../seed");
    await seed({ demoOnly: true });
    console.log("✅ Demo reseed complete");
    res.json({ ok: true, message: "Demo data fully reseeded with all rich data (sessions, messages, notes, reviews, care teams, etc.)" });
  } catch (err) {
    console.error("❌ Demo reseed error:", err);
    console.error("Admin API error:", err.message); res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/admin/audit-log — View admin audit trail ───
router.get("/audit-log", async (req, res) => {
  try {
    const db = await getDb();
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const rows = await db.prepare(`
      SELECT al.*, u.email AS admin_email, u.first_name AS admin_first_name
      FROM admin_audit_log al
      LEFT JOIN users u ON al.admin_user_id = u.id
      ORDER BY al.created_at DESC
      LIMIT ?
    `).all(limit);
    res.json({ auditLog: rows });
  } catch (err) {
    console.error("Audit log fetch error:", err);
    res.status(500).json({ error: "Failed to fetch audit log" });
  }
});

// ─── PUT /api/admin/sessions/:id/status — Admin force-set session status ───
router.put("/sessions/:id/status", async (req, res) => {
  try {
    // Auth handled by router-level authenticate + requireAdmin middleware
    const db = await getDb();
    const { status, offered_to_caregiver_id } = req.body;

    // Allow patching offered_to_caregiver_id without changing status
    if (offered_to_caregiver_id !== undefined) {
      await db.prepare("UPDATE care_sessions SET offered_to_caregiver_id = ?, updated_at = NOW() WHERE id = ?").run(offered_to_caregiver_id || null, req.params.id);
    }

    if (status) {
      const validStatuses = ["requested", "open", "pending", "confirmed", "in_progress", "completed", "cancelled", "matching", "negotiating"];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: `Invalid status '${status}'` });
      }
      await db.prepare("UPDATE care_sessions SET status = ?, updated_at = NOW() WHERE id = ?").run(status, req.params.id);
    }

    const session = await db.prepare("SELECT id, status, scheduled_date, scheduled_time, offered_to_caregiver_id FROM care_sessions WHERE id = ?").get(req.params.id);
    res.json({ session });
  } catch (err) {
    console.error("Admin session status error:", err);
    res.status(500).json({ error: "Failed to update session status" });
  }
});

// ─── PUT /api/admin/caregivers/:userId/early-check-in — Toggle early check-in permission ───
router.put("/caregivers/:userId/early-check-in", async (req, res) => {
  try {
    const db = await getDb();
    const { allowed } = req.body;
    if (allowed === undefined) {
      return res.status(400).json({ error: "Missing 'allowed' field (true/false)" });
    }
    const profile = await db.prepare(
      "SELECT id FROM caregiver_profiles WHERE user_id = ?"
    ).get(req.params.userId);
    if (!profile) {
      return res.status(404).json({ error: "Caregiver profile not found for this user" });
    }
    await db.prepare(
      "UPDATE caregiver_profiles SET early_check_in_allowed = ?, updated_at = NOW() WHERE user_id = ?"
    ).run(allowed ? 1 : 0, req.params.userId);
    const user = await db.prepare("SELECT first_name, last_name, email FROM users WHERE id = ?").get(req.params.userId);
    console.log(`  Admin: early_check_in_allowed=${allowed ? 1 : 0} for ${user?.email || req.params.userId}`);
    res.json({
      userId: req.params.userId,
      earlyCheckInAllowed: !!allowed,
      name: user ? `${user.first_name} ${user.last_name}` : null,
    });
  } catch (err) {
    console.error("Admin early check-in error:", err);
    res.status(500).json({ error: "Failed to update early check-in permission" });
  }
});

// ─── GET /api/admin/sessions/open — List open sessions for admin ───
router.get("/sessions/open", async (req, res) => {
  try {
    const db = await getDb();
    const rows = await db.prepare(`
      SELECT cs.id, cs.status, cs.scheduled_date, cs.scheduled_time, cs.offered_to_caregiver_id,
        cr.first_name || ' ' || cr.last_name AS recipient_name
      FROM care_sessions cs
      LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
      WHERE cs.status IN ('requested','open','pending')
      ORDER BY cs.created_at DESC LIMIT 20
    `).all();
    res.json({ sessions: rows });
  } catch (err) {
    console.error("Admin open sessions error:", err);
    res.status(500).json({ error: "Failed to fetch open sessions" });
  }
});

// ─── GET /api/admin/feedback/triage — One-call feedback summary for fast triage ───
// Returns: counts by status, all new items with full detail, recently reviewed items
router.get("/feedback/triage", async (req, res) => {
  try {
    const db = await getDb();

    // Counts by status
    const statusCounts = await db.prepare(`
      SELECT status, COUNT(*) as count FROM feedback GROUP BY status
    `).all();
    const counts = { new: 0, reviewed: 0, planned: 0, done: 0, dismissed: 0 };
    statusCounts.forEach(r => { counts[r.status] = parseInt(r.count); });

    // All 'new' items with user info (these need triage)
    const newItems = await db.prepare(`
      SELECT f.id, f.category, f.description, f.mood, f.status, f.admin_notes, f.tags, f.page_context,
             f.created_at, u.first_name, u.last_name, u.email, u.role AS user_role
      FROM feedback f
      LEFT JOIN users u ON f.user_id = u.id
      WHERE f.status = 'new'
      ORDER BY f.created_at DESC
    `).all();

    // Recently reviewed items (last 7 days) for cross-reference
    const recentReviewed = await db.prepare(`
      SELECT f.id, f.category, f.description, f.mood, f.status, f.admin_notes, f.tags,
             f.created_at, f.updated_at, u.first_name, u.last_name, u.email
      FROM feedback f
      LEFT JOIN users u ON f.user_id = u.id
      WHERE f.status IN ('reviewed', 'planned')
      AND f.updated_at > NOW() - INTERVAL '7 days'
      ORDER BY f.updated_at DESC
    `).all();

    const formatItem = (f) => ({
      id: f.id,
      category: f.category,
      description: f.description,
      mood: f.mood,
      status: f.status,
      adminNotes: f.admin_notes,
      tags: f.tags ? JSON.parse(f.tags) : [],
      pageContext: f.page_context ? JSON.parse(f.page_context) : null,
      userName: f.first_name ? `${f.first_name} ${f.last_name}` : "Anonymous",
      userEmail: f.email || "—",
      userRole: f.user_role || "—",
      createdAt: f.created_at,
      updatedAt: f.updated_at,
    });

    res.json({
      counts,
      newItems: newItems.map(formatItem),
      recentReviewed: recentReviewed.map(formatItem),
      summary: `${counts.new} new, ${counts.reviewed} reviewed, ${counts.planned} planned, ${counts.done} done, ${counts.dismissed} dismissed`,
    });
  } catch (err) {
    console.error("Admin feedback triage error:", err);
    res.status(500).json({ error: "Failed to load feedback triage" });
  }
});

// ─── POST /api/admin/feedback/bulk-update — Update multiple feedback items at once ───
// Body: { updates: [{ id, status, adminNotes? }] }
router.post("/feedback/bulk-update", async (req, res) => {
  try {
    const db = await getDb();
    const { updates } = req.body;

    if (!Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({ error: "updates array is required" });
    }

    const validStatuses = ['new', 'reviewed', 'planned', 'done', 'dismissed'];
    const results = [];

    for (const item of updates) {
      if (!item.id) { results.push({ id: item.id, error: "missing id" }); continue; }
      if (item.status && !validStatuses.includes(item.status)) {
        results.push({ id: item.id, error: "invalid status" }); continue;
      }

      const setClauses = [];
      const params = [];
      if (item.status) { setClauses.push("status = ?"); params.push(item.status); }
      if (item.adminNotes !== undefined) { setClauses.push("admin_notes = ?"); params.push(item.adminNotes); }
      if (item.tags !== undefined) { setClauses.push("tags = ?"); params.push(JSON.stringify(item.tags)); }
      setClauses.push("updated_at = NOW()");

      if (setClauses.length > 1) {
        params.push(item.id);
        await db.prepare(`UPDATE feedback SET ${setClauses.join(", ")} WHERE id = ?`).run(...params);
        results.push({ id: item.id, status: item.status || "unchanged", ok: true });
      }
    }

    await logAdminAction(req, "bulk_update_feedback", "feedback", null, { count: results.filter(r => r.ok).length });

    res.json({ updated: results.filter(r => r.ok).length, total: updates.length, results });
  } catch (err) {
    console.error("Admin feedback bulk-update error:", err);
    res.status(500).json({ error: "Failed to bulk update feedback" });
  }
});

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
      WHERE 1=1
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
      WHERE (
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

// POST /api/admin/caregivers/:id/approve-bgcheck — manually approve a caregiver's background check
router.post("/caregivers/:id/approve-bgcheck", requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const { id } = req.params;
    const { notes } = req.body;

    const profile = await db.prepare(
      "SELECT cp.*, u.first_name, u.last_name, u.email FROM caregiver_profiles cp JOIN users u ON u.id = cp.user_id WHERE cp.user_id = ?"
    ).get(id);
    if (!profile) return res.status(404).json({ error: "Caregiver profile not found" });

    await db.prepare(`
      UPDATE caregiver_profiles
      SET is_background_checked = 1, bg_check_admin_approved = 1,
          bg_check_admin_approved_by = ?, bg_check_admin_approved_at = NOW(),
          checkr_status = CASE WHEN checkr_status IS NULL OR checkr_status = 'pending' THEN 'clear' ELSE checkr_status END,
          background_check_consent = 1
      WHERE user_id = ?
    `).run(req.user.id, id);

    await logAdminAction(req, "bgcheck_manual_approve", "caregiver", id, {
      caregiverName: `${profile.first_name} ${profile.last_name}`.trim(),
      notes,
    });

    // Notify the caregiver
    try {
      await db.prepare(`
        INSERT INTO activity_feed (id, family_user_id, event_type, title, message, created_at)
        VALUES (?, ?, 'bgcheck_approved', 'Background Check Approved', 'Your background check has been approved. You can now accept care sessions!', NOW())
      `).run(uuid(), id);
      const emitToUser = req.app.get("emitToUser");
      if (emitToUser) emitToUser(id, "activity_update", { title: "Background Check Approved", message: "Your background check has been approved!" });
    } catch (notifErr) { console.error("BG check notification error:", notifErr.message); }

    res.json({ success: true, message: `Background check approved for ${profile.first_name} ${profile.last_name}`.trim() });
  } catch (err) {
    console.error("Admin bgcheck approve error:", err);
    res.status(500).json({ error: "Failed to approve background check" });
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
    } catch {}

    // Activity feed
    try {
      await db.prepare(
        "INSERT INTO activity_feed (id, family_user_id, event_type, title, message, created_at) VALUES (?, ?, 'account_approved', 'Welcome to InPlace!', 'Your account has been approved. Continue setting up your profile to get started.', NOW())"
      ).run(uuid(), req.params.id);
    } catch {}

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
    } catch {}

    // Activity feed entry for admin
    try {
      await db.prepare(
        "INSERT INTO activity_feed (id, family_user_id, event_type, title, message, created_at) VALUES (?, ?, 'checkr_rejected', ?, ?, NOW())"
      ).run(uuid(), req.user.id, `Background check rejected — ${user.first_name} ${user.last_name}`,
        `${user.first_name} ${user.last_name} was rejected due to background check findings. Reason: ${reason || 'Did not meet requirements'}`);
    } catch {}

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

// ─── GET /api/admin/sessions/no-show-cancelled — List sessions cancelled by no-show poller ───
router.get("/sessions/no-show-cancelled", async (req, res) => {
  try {
    const db = await getDb();
    const sessions = await db.prepare(`
      SELECT cs.id, cs.scheduled_date, cs.scheduled_time, cs.status, cs.cancelled_at,
        cs.caregiver_no_show, cs.caregiver_no_show_at,
        cr.first_name || ' ' || cr.last_name AS recipient_name,
        u.first_name || ' ' || u.last_name AS caregiver_name,
        fu.first_name || ' ' || fu.last_name AS family_name
      FROM care_sessions cs
      LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
      LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
      LEFT JOIN users u ON cp.user_id = u.id
      LEFT JOIN users fu ON cs.family_user_id = fu.id
      WHERE cs.cancelled_by = 'system' AND cs.caregiver_no_show = 1
      ORDER BY cs.cancelled_at DESC
      LIMIT 50
    `).all();
    res.json({ sessions });
  } catch (err) {
    console.error("List no-show cancelled error:", err);
    res.status(500).json({ error: "Failed to fetch cancelled sessions" });
  }
});

// ─── POST /api/admin/sessions/:id/restore — Restore a wrongly-cancelled no-show session ───
router.post("/sessions/:id/restore", async (req, res) => {
  try {
    const db = await getDb();
    const session = await db.prepare("SELECT * FROM care_sessions WHERE id = ?").get(req.params.id);
    if (!session) return res.status(404).json({ error: "Session not found" });
    if (session.cancelled_by !== 'system' || !session.caregiver_no_show) {
      return res.status(400).json({ error: "This session was not cancelled by the no-show system" });
    }

    await db.prepare(`
      UPDATE care_sessions SET
        status = 'confirmed',
        caregiver_no_show = 0,
        caregiver_no_show_at = NULL,
        cancelled_at = NULL,
        cancelled_by = NULL,
        review_required = 0,
        notifications_sent = REPLACE(COALESCE(notifications_sent, ''), ',no_show_flagged', ''),
        updated_at = NOW()
      WHERE id = ?
    `).run(req.params.id);

    console.log(`[admin] Restored no-show session ${req.params.id.slice(0, 8)} by ${req.user.email}`);
    res.json({ success: true, message: "Session restored to confirmed status" });
  } catch (err) {
    console.error("Restore session error:", err);
    res.status(500).json({ error: "Failed to restore session" });
  }
});

// ─── Backfill care notes from visit_logs care_feedback ───
// One-time use: creates recipient_notes for completed sessions that had
// care_feedback but no corresponding visit_summary note.
router.post("/backfill-care-notes", authenticate, requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const since = req.body.since || '2026-02-26';

    // Find completed sessions with care_feedback in visit_logs
    // that don't already have a visit_summary note
    const rows = await db.prepare(`
      SELECT cs.id AS session_id, cs.care_recipient_id, cp.user_id AS caregiver_user_id,
             vl.care_feedback, vl.check_out_time
      FROM care_sessions cs
      JOIN visit_logs vl ON vl.session_id = cs.id
      JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
      WHERE cs.status = 'completed'
        AND cs.care_recipient_id IS NOT NULL
        AND vl.care_feedback IS NOT NULL
        AND TRIM(vl.care_feedback) != ''
        AND vl.check_out_time >= ?
        AND NOT EXISTS (
          SELECT 1 FROM recipient_notes rn
          WHERE rn.care_recipient_id = cs.care_recipient_id
            AND rn.author_id = cp.user_id
            AND rn.note_type = 'visit_summary'
            AND rn.created_at >= ?
            AND rn.content = TRIM(vl.care_feedback)
        )
    `).all(since, since);

    let created = 0;
    for (const row of rows) {
      await db.prepare(`
        INSERT INTO recipient_notes (id, care_recipient_id, author_id, content, note_type, created_at)
        VALUES (?, ?, ?, ?, 'visit_summary', ?)
      `).run(uuid(), row.care_recipient_id, row.caregiver_user_id, row.care_feedback.trim(), row.check_out_time);
      created++;
    }

    res.json({ success: true, found: rows.length, created, since });
  } catch (err) {
    console.error("Backfill care notes error:", err);
    res.status(500).json({ error: "Failed to backfill care notes" });
  }
});

// ─── GET /api/admin/caregivers/paused — List all paused caregiver accounts ───
router.get("/caregivers/paused", authenticate, checkAdmin, requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const rows = await db.prepare(`
      SELECT cp.id, cp.user_id, cp.account_paused_reason, cp.account_paused_at,
        cp.rating_avg, cp.rating_count, cp.is_available,
        u.first_name, u.last_name, u.email, u.avatar_url, u.phone,
        (SELECT COUNT(*) FROM care_sessions cs WHERE cs.caregiver_id = cp.id AND cs.caregiver_no_show = 1) AS no_show_count,
        (SELECT COUNT(*) FROM care_sessions cs WHERE cs.caregiver_id = cp.id AND cs.status = 'completed') AS completed_count,
        ns.id AS no_show_session_id, ns.scheduled_date AS no_show_date, ns.scheduled_time AS no_show_time,
        cr_ns.first_name AS no_show_recipient_name
      FROM caregiver_profiles cp
      JOIN users u ON cp.user_id = u.id
      LEFT JOIN care_sessions ns ON ns.id = (
        SELECT cs2.id FROM care_sessions cs2
        WHERE cs2.caregiver_id = cp.id AND cs2.caregiver_no_show = 1 AND cs2.cancelled_by = 'system'
        ORDER BY cs2.scheduled_date DESC LIMIT 1
      )
      LEFT JOIN care_recipients cr_ns ON ns.care_recipient_id = cr_ns.id
      WHERE cp.account_paused = 1
      ORDER BY cp.account_paused_at DESC
    `).all();
    res.json({ paused: rows });
  } catch (err) {
    console.error("Paused caregivers error:", err);
    res.status(500).json({ error: "Failed to fetch paused caregivers" });
  }
});

// ─── POST /api/admin/caregivers/:userId/reinstate — Reinstate a paused caregiver ───
router.post("/caregivers/:userId/reinstate", authenticate, checkAdmin, requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const profile = await db.prepare("SELECT * FROM caregiver_profiles WHERE user_id = ?").get(req.params.userId);
    if (!profile) return res.status(404).json({ error: "Caregiver profile not found" });
    if (!profile.account_paused) return res.status(400).json({ error: "Account is not paused" });

    await db.prepare(`
      UPDATE caregiver_profiles SET
        account_paused = 0,
        account_paused_reason = NULL,
        account_paused_at = NULL,
        account_reinstated_at = NOW(),
        account_reinstated_by = ?,
        is_available = 1
      WHERE user_id = ?
    `).run(req.user.id, req.params.userId);

    await logAdminAction(req, "reinstate_caregiver", "caregiver", req.params.userId, {
      previousReason: profile.account_paused_reason,
      notes: req.body.notes || null,
    });

    console.log(`[admin] Reinstated caregiver ${req.params.userId} by ${req.user.email}`);
    res.json({ success: true, message: "Caregiver account reinstated" });
  } catch (err) {
    console.error("Reinstate caregiver error:", err);
    res.status(500).json({ error: "Failed to reinstate caregiver" });
  }
});

// ─── POST /api/admin/message/:userId — Send message as "InPlace Support" ───
router.post("/message/:userId", authenticate, checkAdmin, requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const { message } = req.body;
    if (!message || !message.trim()) return res.status(400).json({ error: "Message is required" });

    const targetUser = await db.prepare("SELECT id, first_name, last_name FROM users WHERE id = ?").get(req.params.userId);
    if (!targetUser) return res.status(404).json({ error: "User not found" });

    // Find or create a dedicated "InPlace Support" conversation (NOT the personal DM)
    let convId;
    const existing = await db.prepare(`
      SELECT c.id FROM conversations c
      JOIN conversation_members cm1 ON cm1.conversation_id = c.id AND cm1.user_id = ?
      JOIN conversation_members cm2 ON cm2.conversation_id = c.id AND cm2.user_id = ?
      WHERE c.type = 'direct' AND c.name = 'InPlace Support'
    `).get(req.user.id, req.params.userId);

    if (existing) {
      convId = existing.id;
    } else {
      convId = uuid();
      await db.prepare("INSERT INTO conversations (id, type, name, created_by) VALUES (?, ?, ?, ?)").run(convId, "direct", "InPlace Support", req.user.id);
      await db.prepare("INSERT INTO conversation_members (id, conversation_id, user_id, role) VALUES (?, ?, ?, ?)").run(uuid(), convId, req.user.id, "member");
      await db.prepare("INSERT INTO conversation_members (id, conversation_id, user_id, role) VALUES (?, ?, ?, ?)").run(uuid(), convId, req.params.userId, "member");
    }

    // Send the message with sender_label for display
    const msgId = uuid();
    await db.prepare(
      "INSERT INTO messages (id, sender_id, recipient_id, content, conversation_id, sender_label) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(msgId, req.user.id, req.params.userId, message.trim(), convId, "InPlace Support");

    // Update conversation timestamp
    await db.prepare("UPDATE conversations SET updated_at = NOW() WHERE id = ?").run(convId);

    // Push notification + websocket
    const emitToUser = req.app.get("emitToUser");
    if (emitToUser) {
      emitToUser(req.params.userId, "new_message", {
        messageId: msgId,
        conversationId: convId,
        senderId: req.user.id,
        senderName: "InPlace Support",
        content: message.trim(),
      });
    }

    // Send push notification
    try {
      const { sendPushToUser } = require("../utils/push");
      if (sendPushToUser) {
        await sendPushToUser(db, req.params.userId, "InPlace Support", message.trim().substring(0, 100), { conversationId: convId });
      }
    } catch {}

    await logAdminAction(req, "admin_message", "user", req.params.userId, {
      conversationId: convId,
      messagePreview: message.trim().substring(0, 50),
    });

    res.json({ success: true, conversationId: convId, messageId: msgId });
  } catch (err) {
    console.error("Admin message error:", err);
    res.status(500).json({ error: "Failed to send message" });
  }
});

// ─── POST /api/admin/caregivers/:userId/freeze — Manually freeze a caregiver account ───
router.post("/caregivers/:userId/freeze", authenticate, checkAdmin, requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const { reason } = req.body;
    if (!reason || !reason.trim()) return res.status(400).json({ error: "Reason is required" });

    const profile = await db.prepare("SELECT * FROM caregiver_profiles WHERE user_id = ?").get(req.params.userId);
    if (!profile) return res.status(404).json({ error: "Caregiver profile not found" });
    if (profile.account_paused) return res.status(400).json({ error: "Account is already paused" });

    await db.prepare(`
      UPDATE caregiver_profiles SET
        is_available = 0, account_paused = 1,
        account_paused_reason = ?,
        account_paused_at = NOW()
      WHERE user_id = ?
    `).run(reason.trim(), req.params.userId);

    await logAdminAction(req, "freeze_caregiver", "caregiver", req.params.userId, { reason: reason.trim() });

    console.log(`[admin] Froze caregiver ${req.params.userId} by ${req.user.email}: ${reason.trim()}`);
    res.json({ success: true, message: "Caregiver account frozen" });
  } catch (err) {
    console.error("Freeze caregiver error:", err);
    res.status(500).json({ error: "Failed to freeze caregiver" });
  }
});

// ─── GET /api/admin/safety-flags — List all safety flags for review ───
router.get("/safety-flags", authenticate, checkAdmin, requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const flags = await db.prepare(`
      SELECT sf.*, u.first_name, u.last_name, u.email,
        ru.first_name AS reviewer_first, ru.last_name AS reviewer_last
      FROM safety_flags sf
      JOIN users u ON sf.user_id = u.id
      LEFT JOIN users ru ON sf.reviewed_by = ru.id
      ORDER BY sf.created_at DESC
      LIMIT 50
    `).all();

    // Enrich each flag with conversation participants (so admin can message anyone involved)
    for (const flag of flags) {
      if (flag.conversation_id) {
        const participants = await db.prepare(`
          SELECT u.id AS user_id, u.first_name, u.last_name, u.email, u.role
          FROM conversation_members cm
          JOIN users u ON cm.user_id = u.id
          WHERE cm.conversation_id = ?
        `).all(flag.conversation_id);
        flag.participants = participants;
      } else {
        flag.participants = [];
      }
    }

    res.json({ flags });
  } catch (err) {
    console.error("Safety flags error:", err);
    res.status(500).json({ error: "Failed to load safety flags" });
  }
});

// ─── PUT /api/admin/safety-flags/:id — Review a safety flag ───
router.put("/safety-flags/:id", authenticate, checkAdmin, requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const { status, admin_notes } = req.body;
    if (!status) return res.status(400).json({ error: "Status is required" });

    await db.prepare(`
      UPDATE safety_flags SET status = ?, admin_notes = ?, reviewed_by = ?, reviewed_at = NOW()
      WHERE id = ?
    `).run(status, admin_notes || null, req.user.id, req.params.id);

    // Log status change as audit event
    await db.prepare(
      "INSERT INTO safety_flag_events (id, safety_flag_id, event_type, actor_id, actor_label, content, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())"
    ).run(uuid(), req.params.id, `status_${status}`, req.user.id, "Admin",
      admin_notes ? `Status changed to ${status}. Notes: ${admin_notes}` : `Status changed to ${status}`
    ).catch(() => {});

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to update safety flag" });
  }
});

// ─── POST /api/admin/safety-flags/:id/challenge — Generate passkey challenge for resolve/dismiss ───
router.post("/safety-flags/:id/challenge", authenticate, checkAdmin, requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const flag = await db.prepare("SELECT id FROM safety_flags WHERE id = ?").get(req.params.id);
    if (!flag) return res.status(404).json({ error: "Safety flag not found" });

    const passkeys = await db.prepare(
      "SELECT credential_id, transports FROM user_passkeys WHERE user_id = ?"
    ).all(req.user.id);
    if (passkeys.length === 0) {
      return res.status(400).json({ error: "You need a registered passkey. Set one up in My Account → Security." });
    }

    const allowCredentials = passkeys.map(pk => ({
      id: pk.credential_id,
      transports: pk.transports ? JSON.parse(pk.transports) : [],
    }));

    const options = await generateAuthenticationOptions({
      rpID: RP_ID,
      allowCredentials,
      userVerification: "required",
    });

    const challengeKey = `safetyflag_${req.user.id}_${req.params.id}_${Date.now()}`;
    setPasskeyChallenge(challengeKey, {
      challenge: options.challenge,
      adminId: req.user.id,
      flagId: req.params.id,
    });

    res.json({ ...options, _challengeKey: challengeKey });
  } catch (err) {
    console.error("Safety flag challenge error:", err);
    res.status(500).json({ error: "Failed to generate passkey challenge" });
  }
});

// ─── PUT /api/admin/safety-flags/:id/verified — Resolve/dismiss safety flag (requires passkey) ───
router.put("/safety-flags/:id/verified", authenticate, checkAdmin, requireAdmin, async (req, res) => {
  try {
    const { _challengeKey, status, admin_notes, ...authResponse } = req.body;
    if (!status) return res.status(400).json({ error: "Status is required" });

    // 1. Verify passkey challenge
    const stored = getPasskeyChallenge(_challengeKey);
    if (!stored) {
      return res.status(401).json({ error: "Passkey challenge expired. Please try again." });
    }
    if (stored.adminId !== req.user.id || stored.flagId !== req.params.id) {
      return res.status(401).json({ error: "Challenge mismatch." });
    }

    const db = await getDb();
    const passkey = await db.prepare(
      "SELECT pk.*, u.id as uid FROM user_passkeys pk JOIN users u ON pk.user_id = u.id WHERE pk.credential_id = ?"
    ).get(authResponse.id);
    if (!passkey || passkey.uid !== req.user.id) {
      return res.status(401).json({ error: "Passkey not found or doesn't belong to you." });
    }

    const verification = await verifyAuthenticationResponse({
      response: authResponse,
      expectedChallenge: stored.challenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      credential: { id: passkey.credential_id, publicKey: Buffer.from(passkey.public_key, "base64"), counter: passkey.counter || 0 },
    });

    if (!verification.verified) {
      return res.status(401).json({ error: "Passkey verification failed." });
    }

    // Update counter
    await db.prepare("UPDATE user_passkeys SET counter = ? WHERE credential_id = ?")
      .run(verification.authenticationInfo.newCounter, passkey.credential_id).catch(() => {});

    // 2. Perform the actual flag update
    await db.prepare(`
      UPDATE safety_flags SET status = ?, admin_notes = ?, reviewed_by = ?, reviewed_at = NOW()
      WHERE id = ?
    `).run(status, admin_notes || null, req.user.id, req.params.id);

    await db.prepare(
      "INSERT INTO safety_flag_events (id, safety_flag_id, event_type, actor_id, actor_label, content, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())"
    ).run(uuid(), req.params.id, `status_${status}`, req.user.id, "Admin (passkey verified)",
      admin_notes ? `Status changed to ${status} (passkey verified). Notes: ${admin_notes}` : `Status changed to ${status} (passkey verified)`
    ).catch(() => {});

    res.json({ success: true });
  } catch (err) {
    console.error("Safety flag verified review error:", err);
    res.status(500).json({ error: "Failed to update safety flag" });
  }
});

// ─── GET /api/admin/safety-flags/:id/thread — Full evidence thread for a safety flag ───
// Returns: original conversation messages, admin outreach threads, audit events — all in chronological order
router.get("/safety-flags/:id/thread", authenticate, checkAdmin, requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const flagId = req.params.id;

    // Get the safety flag itself
    const flag = await db.prepare(`
      SELECT sf.*, u.first_name, u.last_name, u.email
      FROM safety_flags sf JOIN users u ON sf.user_id = u.id
      WHERE sf.id = ?
    `).get(flagId);
    if (!flag) return res.status(404).json({ error: "Safety flag not found" });

    // Mark as read by admin
    if (!flag.admin_read_at) {
      await db.prepare("UPDATE safety_flags SET admin_read_at = NOW() WHERE id = ?").run(flagId);
      // Log read event
      await db.prepare(
        "INSERT INTO safety_flag_events (id, safety_flag_id, event_type, actor_id, actor_label, created_at) VALUES (?, ?, 'admin_viewed', ?, 'Admin', NOW())"
      ).run(uuid(), flagId, req.user.id);
    }

    // 1. Original conversation messages (evidence)
    let evidenceMessages = [];
    if (flag.conversation_id) {
      evidenceMessages = await db.prepare(`
        SELECT m.id, m.sender_id, m.content, m.created_at, m.sender_label,
          u.first_name, u.last_name, u.email, u.role
        FROM messages m
        LEFT JOIN users u ON m.sender_id = u.id
        WHERE m.conversation_id = ?
        ORDER BY m.created_at ASC
      `).all(flag.conversation_id);
    }

    // 2. Admin outreach threads (conversations linked to this safety flag)
    const linkedThreads = await db.prepare(`
      SELECT sft.*, c.name AS conv_name,
        u.first_name AS participant_first, u.last_name AS participant_last, u.email AS participant_email
      FROM safety_flag_threads sft
      JOIN conversations c ON sft.conversation_id = c.id
      JOIN users u ON sft.participant_user_id = u.id
      WHERE sft.safety_flag_id = ?
    `).all(flagId);

    // Get messages for each linked thread
    const outreachMessages = [];
    for (const thread of linkedThreads) {
      const msgs = await db.prepare(`
        SELECT m.id, m.sender_id, m.content, m.created_at, m.sender_label,
          u.first_name, u.last_name, u.email, u.role
        FROM messages m
        LEFT JOIN users u ON m.sender_id = u.id
        WHERE m.conversation_id = ?
        ORDER BY m.created_at ASC
      `).all(thread.conversation_id);
      outreachMessages.push({
        threadId: thread.id,
        conversationId: thread.conversation_id,
        participant: {
          userId: thread.participant_user_id,
          firstName: thread.participant_first,
          lastName: thread.participant_last,
          email: thread.participant_email,
        },
        messages: msgs,
      });
    }

    // 3. Audit events (status changes, notes, admin views)
    const events = await db.prepare(`
      SELECT e.*, u.first_name AS actor_first, u.last_name AS actor_last
      FROM safety_flag_events e
      LEFT JOIN users u ON e.actor_id = u.id
      WHERE e.safety_flag_id = ?
      ORDER BY e.created_at ASC
    `).all(flagId);

    // 4. Conversation participants
    let participants = [];
    if (flag.conversation_id) {
      participants = await db.prepare(`
        SELECT u.id AS user_id, u.first_name, u.last_name, u.email, u.role
        FROM conversation_members cm
        JOIN users u ON cm.user_id = u.id
        WHERE cm.conversation_id = ?
      `).all(flag.conversation_id);
    }

    res.json({
      flag,
      evidenceMessages,
      outreachMessages,
      events,
      participants,
    });
  } catch (err) {
    console.error("Safety flag thread error:", err);
    res.status(500).json({ error: "Failed to load thread" });
  }
});

// ─── POST /api/admin/safety-flags/:id/message/:userId — Send outreach message linked to safety flag ───
router.post("/safety-flags/:id/message/:userId", authenticate, checkAdmin, requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const flagId = req.params.id;
    const targetUserId = req.params.userId;
    const { message } = req.body;
    if (!message || !message.trim()) return res.status(400).json({ error: "Message is required" });

    const flag = await db.prepare("SELECT id, conversation_id FROM safety_flags WHERE id = ?").get(flagId);
    if (!flag) return res.status(404).json({ error: "Safety flag not found" });

    const targetUser = await db.prepare("SELECT id, first_name, last_name FROM users WHERE id = ?").get(targetUserId);
    if (!targetUser) return res.status(404).json({ error: "User not found" });

    // Check if we already have a linked thread for this participant
    let thread = await db.prepare(
      "SELECT * FROM safety_flag_threads WHERE safety_flag_id = ? AND participant_user_id = ?"
    ).get(flagId, targetUserId);

    let convId;
    if (thread) {
      convId = thread.conversation_id;
    } else {
      // Find existing InPlace Support conversation with this user, or create one
      const existing = await db.prepare(`
        SELECT c.id FROM conversations c
        JOIN conversation_members cm1 ON cm1.conversation_id = c.id AND cm1.user_id = ?
        JOIN conversation_members cm2 ON cm2.conversation_id = c.id AND cm2.user_id = ?
        WHERE c.type = 'direct' AND c.name = 'InPlace Support'
      `).get(req.user.id, targetUserId);

      if (existing) {
        convId = existing.id;
      } else {
        convId = uuid();
        await db.prepare("INSERT INTO conversations (id, type, name, created_by) VALUES (?, 'direct', 'InPlace Support', ?)").run(convId, req.user.id);
        await db.prepare("INSERT INTO conversation_members (id, conversation_id, user_id, role) VALUES (?, ?, ?, 'member')").run(uuid(), convId, req.user.id);
        await db.prepare("INSERT INTO conversation_members (id, conversation_id, user_id, role) VALUES (?, ?, ?, 'member')").run(uuid(), convId, targetUserId);
      }

      // Link this conversation to the safety flag
      await db.prepare(
        "INSERT INTO safety_flag_threads (id, safety_flag_id, conversation_id, participant_user_id, created_at) VALUES (?, ?, ?, ?, NOW())"
      ).run(uuid(), flagId, convId, targetUserId);
    }

    // Send the message
    const msgId = uuid();
    await db.prepare(
      "INSERT INTO messages (id, sender_id, recipient_id, content, conversation_id, sender_label, created_at) VALUES (?, ?, ?, ?, ?, 'InPlace Support', NOW())"
    ).run(msgId, req.user.id, targetUserId, message.trim(), convId);
    await db.prepare("UPDATE conversations SET updated_at = NOW() WHERE id = ?").run(convId);

    // Log as audit event
    await db.prepare(
      "INSERT INTO safety_flag_events (id, safety_flag_id, event_type, actor_id, actor_label, content, metadata, created_at) VALUES (?, ?, 'admin_message', ?, 'InPlace Support', ?, ?::jsonb, NOW())"
    ).run(uuid(), flagId, req.user.id, message.trim().substring(0, 500),
      JSON.stringify({ recipientId: targetUserId, recipientName: `${targetUser.first_name} ${targetUser.last_name}`, conversationId: convId })
    );

    // Push + WebSocket to recipient
    const emitToUser = req.app.get("emitToUser");
    if (emitToUser) {
      emitToUser(targetUserId, "new_message", {
        messageId: msgId, conversationId: convId,
        senderId: req.user.id, senderName: "InPlace Support",
        content: message.trim(),
      });
    }
    try {
      const { sendPushToUser } = require("./push");
      sendPushToUser(targetUserId, {
        title: "InPlace Support",
        body: message.trim().substring(0, 100),
        data: { type: "message", conversationId: convId },
      }).catch(() => {});
    } catch {}

    await logAdminAction(req, "safety_flag_message", "safety_flag", flagId, {
      recipientId: targetUserId, conversationId: convId,
    });

    res.json({ success: true, messageId: msgId, conversationId: convId });
  } catch (err) {
    console.error("Safety flag message error:", err);
    res.status(500).json({ error: "Failed to send message" });
  }
});

// ─── POST /api/admin/safety-flags/:id/note — Add internal admin note (not sent to anyone) ───
router.post("/safety-flags/:id/note", authenticate, checkAdmin, requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const { note } = req.body;
    if (!note || !note.trim()) return res.status(400).json({ error: "Note is required" });

    await db.prepare(
      "INSERT INTO safety_flag_events (id, safety_flag_id, event_type, actor_id, actor_label, content, created_at) VALUES (?, ?, 'admin_note', ?, 'Admin', ?, NOW())"
    ).run(uuid(), req.params.id, req.user.id, note.trim());

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to add note" });
  }
});

module.exports = router;
