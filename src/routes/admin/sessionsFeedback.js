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
      WHERE cs.status IN ('requested','open','pending') AND ${NOT_DEMO_SESSION()}
      ORDER BY cs.created_at DESC LIMIT 20
    `).all();
    res.json({ sessions: rows });
  } catch (err) {
    console.error("Admin open sessions error:", err);
    res.status(500).json({ error: "Failed to fetch open sessions" });
  }
});

// ─── GET /api/admin/sessions/all ───
// List all sessions (any status) for admin drill-down. Supports ?status= and ?days= filters.
router.get("/sessions/all", authenticate, requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const statusFilter = req.query.status;
    const days = parseInt(req.query.days) || 30;

    let where = `cs.scheduled_date::date >= CURRENT_DATE - INTERVAL '${days} days' AND ${NOT_DEMO_SESSION()}`;
    const params = [];
    if (statusFilter && statusFilter !== 'all') {
      where += ` AND cs.status = ?`;
      params.push(statusFilter);
    }

    const rows = await db.prepare(`
      SELECT cs.id, cs.status, cs.scheduled_date, cs.scheduled_time, cs.service_type,
        cs.duration_hours, cs.payment_status, cs.caregiver_no_show,
        cs.cancelled_by, cs.review_required,
        cr.first_name || ' ' || cr.last_name AS recipient_name,
        cu.first_name || ' ' || cu.last_name AS caregiver_name,
        fu.first_name || ' ' || fu.last_name AS family_name
      FROM care_sessions cs
      LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
      LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
      LEFT JOIN users cu ON cp.user_id = cu.id
      LEFT JOIN users fu ON cs.family_user_id = fu.id
      WHERE ${where}
      ORDER BY cs.scheduled_date DESC, cs.scheduled_time DESC
      LIMIT 100
    `).all(...params);

    // Quick counts by status
    const counts = {};
    for (const r of rows) {
      counts[r.status] = (counts[r.status] || 0) + 1;
    }

    res.json({ sessions: rows, counts, days });
  } catch (err) {
    console.error("Admin all sessions error:", err);
    res.status(500).json({ error: "Failed to fetch sessions" });
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
      tags: safeJson(f.tags, []), // defensive — see feedback.js v1.74.2
      pageContext: safeJson(f.page_context, null),
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
};
