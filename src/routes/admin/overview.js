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

// ─── Alert classes: news vs work (v1.105.113) ───
//
// WORK is anything where a PERSON IS BLOCKED until an admin acts. Those counts are reported
// raw and can never be reduced by the last-seen snapshot — they fall to zero on their own when
// the work is done, so a snapshot has nothing to add and everything to hide. Everything else
// is news, and news stops repeating once you have seen it.
//
// Keep this list short. A badge that never goes quiet gets ignored, and then it protects
// nothing — the same failure arrived at from the other side.
const WORK_ALERTS = ["pendingUsers", "pendingConsent", "safetyFlags", "pendingIdentity", "aiApprovedIdentity"];

module.exports = function register(router) {

// ─── GET /api/admin/alerts — Lightweight count of items needing admin attention ───
// Returns raw counts + a "seen" snapshot so the client only badges NEW items
router.get("/alerts", async (req, res) => {
  try {
    const db = await getDb();
    const [pendingUsers, pausedCaregivers, pendingConsent, newFeedback, safetyFlags, pendingIdentity, aiApprovedIdentity, checkrAlerts, recentReferrals, recentMilestones, userRow] = await Promise.all([
      db.prepare(`SELECT COUNT(*) as count FROM users WHERE COALESCE(is_demo, 0) = 0 AND COALESCE(account_approved, 0) = 0 AND COALESCE(is_active, 1) = 1 AND created_at > '2026-02-20'`).get(),
      db.prepare(`SELECT COUNT(*) as count FROM caregiver_profiles WHERE account_paused = 1 AND COALESCE(checkr_status, 'pending') != 'rejected'`).get(),
      db.prepare(`SELECT COUNT(*) as count FROM care_recipients WHERE consent_status = 'pending' OR consent_status = 'attestation_pending'`).get(),
      db.prepare(`SELECT COUNT(*) as count FROM feedback WHERE status = 'new' AND created_at > NOW() - INTERVAL '30 days'`).get(),
      db.prepare(`SELECT COUNT(*) as count FROM safety_flags WHERE status IN ('pending', 'escalated')`).get().catch(() => ({ count: 0 })),
      // v1.105.68 — identity documents waiting on a human. Submitting a selfie + ID notified
      // NOBODY: not a push, not an email, not this list, not the activity feed. A caregiver
      // could send in their government ID, be told it worked, and sit there indefinitely while
      // the admin had no signal it had happened and no screen that listed it. Onboarding cannot
      // complete without an APPROVED identity document, so this is a hard stop on someone
      // starting work.
      db.prepare(`
        SELECT COUNT(*) as count FROM verified_documents
        WHERE category = 'identity' AND document_type != 'selfie' AND status = 'pending'
      `).get().catch(() => ({ count: 0 })),
      // v1.105.70 — identity documents the AI approved on its own, that no person has since
      // looked at. Counting only 'pending' missed these entirely, and they are the ones that
      // most deserve a human eye: an automated decision about whether someone is who they say
      // they are, made with nobody in the loop. admin_reviewed_by is set whenever an admin
      // grants or rejects, so this empties as they are checked.
      db.prepare(`
        SELECT COUNT(*) as count FROM verified_documents
        WHERE category = 'identity' AND document_type != 'selfie'
          AND status = 'approved' AND admin_reviewed_by IS NULL
      `).get().catch(() => ({ count: 0 })),
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
      pendingIdentity: parseInt(pendingIdentity.count) || 0,
      aiApprovedIdentity: parseInt(aiApprovedIdentity.count) || 0,
      checkrAlerts: parseInt(checkrAlerts.count) || 0,
      recentReferrals: parseInt(recentReferrals.count) || 0,
      recentMilestones: parseInt(recentMilestones.count) || 0,
    };

    // ─── News vs work (v1.105.113) ───
    //
    // Pete, Aug 19: "I log into the Admin page and there's no demand for my attention, I even
    // went into Doc view and BG checks and there's nothing there for me to review."
    //
    // Julia's ID had been sitting unreviewed for days. `aiApprovedIdentity` was added in
    // v1.105.70 precisely to catch that — and it did count her. But every count here was then
    // reduced by a LAST-SEEN SNAPSHOT, and app.js writes that snapshot the moment the admin
    // page is opened. So the first time he opened Admin the number was recorded as "seen", the
    // delta went to zero, and it stayed zero forever while the work stayed undone.
    //
    // **An item was silenced by being LOOKED AT rather than by being FINISHED.**
    //
    // A seen-snapshot is right for news and wrong for work:
    //
    //   NEWS  "5 new pieces of feedback", "3 referrals this week" — once you have seen the
    //         number, repeating it is nagging. Delta is correct.
    //   WORK  "an identity document is waiting on your decision" — this must keep asking until
    //         it is DONE. Its count already falls to zero on its own the moment the work is
    //         done, so there is nothing for a snapshot to add and everything for it to hide.
    //
    // Work items are things where a PERSON IS BLOCKED until an admin acts. Everything else
    // stays news, deliberately: a badge that never goes quiet gets ignored, and then it
    // protects nothing.
    let seen = {};
    try { seen = JSON.parse(userRow?.admin_alerts_snapshot || '{}'); } catch {} // expected: tolerated parse fallback

    const delta = {};
    for (const key of Object.keys(counts)) {
      delta[key] = WORK_ALERTS.includes(key)
        ? counts[key]                                        // never suppressed by looking
        : Math.max(0, counts[key] - (seen[key] || 0));
    }

    const total = delta.pendingUsers + delta.pausedCaregivers + delta.pendingConsent +
      delta.newFeedback + delta.safetyFlags + delta.pendingIdentity + delta.aiApprovedIdentity + delta.checkrAlerts;

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
    // v1.105.113 — a work item cannot be dismissed by opening a page. app.js fires this the
    // moment the admin page is opened, so anything recorded here is silenced from then on.
    // Stripping the work keys means a snapshot can only ever quiet news; an identity document
    // waiting on a decision keeps asking until somebody decides.
    const incoming = req.body.snapshot || {};
    const snapshot = JSON.stringify(
      Object.fromEntries(Object.entries(incoming).filter(([k]) => !WORK_ALERTS.includes(k)))
    );
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
    try { sessions = await db.prepare(`SELECT COUNT(*) as count FROM care_sessions cs WHERE ${NOT_DEMO_SESSION()}`).get() || { count: 0 }; } catch (e) { console.error("Stats: sessions query failed:", e.message); }
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
        WHERE ${NOT_DEMO_SESSION()}
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
    let ratingDist = {};
    try {
      avgRating = await db.prepare("SELECT ROUND(AVG(r.rating), 1) as avg, COUNT(*) as total FROM reviews r JOIN users fu ON r.family_user_id = fu.id WHERE COALESCE(fu.is_demo, 0) = 0").get() || { avg: 0, total: 0 };
      const distRows = await db.prepare("SELECT r.rating, COUNT(*) as cnt FROM reviews r JOIN users fu ON r.family_user_id = fu.id WHERE COALESCE(fu.is_demo, 0) = 0 GROUP BY r.rating").all();
      for (const d of distRows) ratingDist[d.rating] = d.cnt;
    } catch (e) { /* */ }
    try {
      // Use care_sessions.estimated_cost (source of truth), exclude demo users on both sides
      revenueMtd = await db.prepare(`
        SELECT COALESCE(SUM(cs.estimated_cost), 0) as total
        FROM care_sessions cs
        JOIN users u ON cs.family_user_id = u.id
        WHERE cs.status = 'completed' AND cs.estimated_cost > 0
          AND COALESCE(u.is_demo, 0) = 0
          AND NOT EXISTS (SELECT 1 FROM caregiver_profiles _cp JOIN users _cu ON _cp.user_id = _cu.id WHERE _cp.id = cs.caregiver_id AND _cu.is_demo = 1)
          AND COALESCE(cs.completed_at, cs.updated_at, cs.created_at) >= date_trunc('month', NOW())
      `).get() || { total: 0 };
    } catch (e) { /* */ }
    let revenueYtd = { total: 0 };
    try {
      revenueYtd = await db.prepare(`
        SELECT COALESCE(SUM(cs.estimated_cost), 0) as total
        FROM care_sessions cs
        JOIN users u ON cs.family_user_id = u.id
        WHERE cs.status = 'completed' AND cs.estimated_cost > 0
          AND COALESCE(u.is_demo, 0) = 0
          AND NOT EXISTS (SELECT 1 FROM caregiver_profiles _cp JOIN users _cu ON _cp.user_id = _cu.id WHERE _cp.id = cs.caregiver_id AND _cu.is_demo = 1)
          AND COALESCE(cs.completed_at, cs.updated_at, cs.created_at) >= date_trunc('year', NOW())
      `).get() || { total: 0 };
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
      revenueYtd: parseFloat(revenueYtd.total || 0),
      visitsThisWeek: parseInt(visitsThisWeek.count || 0),
      ratingDistribution: ratingDist,
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
      FROM users WHERE COALESCE(is_active, 1) = 1
    `;
    const params = [];

    if (search) {
      params.push(`%${search}%`, `%${search}%`);
      sql += ` AND (email ILIKE ? OR (first_name || ' ' || last_name) ILIKE ?)`;
    }
    if (role) {
      // v1.105.109 — match the `roles` array too, not just the singular `role` column.
      // Someone who signed up as a caregiver and later added a family profile has
      // role='caregiver' and roles=["caregiver","family"]. Filtering on `role` alone made
      // them invisible to `?role=family` — which meant the vouch picker could not offer
      // their family, and nothing said why. Pete himself is both.
      params.push(role, `%"${role}"%`);
      sql += ` AND (role = ? OR roles LIKE ?)`;
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
    let countSql = "SELECT COUNT(*) as count FROM users WHERE COALESCE(is_active, 1) = 1";
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
      // v1.105.48 — every column named here except id/flag_type/status/severity/created_at
      // was invented. safety_flags has `user_id` and `user_message`; there is no
      // reporter_user_id, flagged_user_id, caregiver_user_id or description. The query threw
      // on every call and the empty catch turned that into an empty array — so an admin
      // opening someone's drawer to check whether they had ever been reported saw a clean
      // record. For every user. Including the ones with flags.
      safetyFlags = await db.prepare(`
        SELECT id, flag_type, user_message, status, severity, created_at
        FROM safety_flags
        WHERE user_id = ?
        ORDER BY created_at DESC LIMIT 10
      `).all(userId);
    } catch (e) {
      captureException(e, { where: "admin/overview: safety flags", userId });
    }

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

    // Auth methods (password, passkeys, OAuth providers)
    let authMethods = [];
    try {
      // Check if user has a password set
      const pwRow = await db.prepare("SELECT password_hash FROM users WHERE id = ?").get(userId);
      if (pwRow?.password_hash) authMethods.push({ type: 'password' });

      // Passkeys
      const passkeys = await db.prepare("SELECT id, created_at FROM user_passkeys WHERE user_id = ?").all(userId);
      if (passkeys.length > 0) authMethods.push({ type: 'passkey', count: passkeys.length });

      // OAuth providers (apple, google, etc.)
      const oauthAccounts = await db.prepare("SELECT provider FROM oauth_accounts WHERE user_id = ?").all(userId);
      for (const oa of oauthAccounts) {
        authMethods.push({ type: 'oauth', provider: oa.provider });
      }
    } catch (e) { /* tables may not exist yet */ }

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
      authMethods,
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

// ─── POST /api/admin/users/:id/set-password — Admin sets a user's password ───
router.post("/users/:id/set-password", async (req, res) => {
  try {
    const db = await getDb();
    const { password } = req.body;
    if (!password || password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }

    const user = await db.prepare("SELECT id, email, first_name, last_name FROM users WHERE id = ?").get(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    const bcrypt = require("bcryptjs");
    const passwordHash = await bcrypt.hash(password, 10);
    await db.prepare(
      "UPDATE users SET password_hash = ?, must_change_password = 1, password_changed_at = NOW(), updated_at = NOW() WHERE id = ?"
    ).run(passwordHash, req.params.id);

    // Audit log
    await logAdminAction(req, "set_password", "user", req.params.id, {
      userName: `${user.first_name} ${user.last_name}`,
      email: user.email,
    });

    console.log(`[admin] Password set for ${user.email} by ${req.user.email}`);
    res.json({ ok: true, message: `Password set for ${user.email}. User will be prompted to change it on next login.` });
  } catch (err) {
    console.error("Admin set-password error:", err);
    res.status(500).json({ error: "Failed to set password" });
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
      WHERE ${NOT_DEMO_SESSION()}
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
};
