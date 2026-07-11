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

// ─── Customer Service: Reviews Management ───

// GET /api/admin/reviews — Fetch reviews with optional filters
router.get("/reviews", requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const { status, maxRating, limit: lim } = req.query;
    const maxR = parseInt(maxRating) || 3;
    const limitN = Math.min(parseInt(lim) || 50, 200);
    let where = "WHERE r.rating < ? AND COALESCE(fu.is_demo, 0) = 0";
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

    // Summary counts (exclude demo users)
    const counts = await db.prepare(`
      SELECT
        COUNT(*) FILTER (WHERE r.rating < 3) AS total_flagged,
        COUNT(*) FILTER (WHERE r.rating < 3 AND COALESCE(r.admin_status, 'pending') = 'pending') AS pending,
        COUNT(*) FILTER (WHERE r.rating < 3 AND r.admin_status = 'reviewed') AS reviewed,
        COUNT(*) FILTER (WHERE r.rating < 3 AND r.admin_status = 'escalated') AS escalated,
        COUNT(*) FILTER (WHERE r.rating < 3 AND r.admin_status = 'resolved') AS resolved
      FROM reviews r
      JOIN users fu ON r.family_user_id = fu.id
      WHERE COALESCE(fu.is_demo, 0) = 0
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

// GET /api/admin/reviews/all — All reviews, sortable, with distribution stats
router.get("/reviews/all", requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const { sort, order, minRating, maxRating, limit: lim, offset: off, caregiverId } = req.query;
    const limitN = Math.min(parseInt(lim) || 50, 200);
    const offsetN = parseInt(off) || 0;

    let where = "WHERE COALESCE(fu.is_demo, 0) = 0";
    const params = [];
    if (minRating) { where += " AND r.rating >= ?"; params.push(parseInt(minRating)); }
    if (maxRating) { where += " AND r.rating <= ?"; params.push(parseInt(maxRating)); }
    if (caregiverId) { where += " AND r.caregiver_id = ?"; params.push(caregiverId); }

    const sortCol = ({ rating: 'r.rating', date: 'r.created_at', caregiver: 'caregiver_name' })[sort] || 'r.created_at';
    const sortDir = order === 'asc' ? 'ASC' : 'DESC';

    params.push(limitN, offsetN);

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
      ORDER BY ${sortCol} ${sortDir}
      LIMIT ? OFFSET ?
    `).all(...params);

    // Total count (reuse same where + join to exclude demos)
    const countRow = await db.prepare(`
      SELECT COUNT(*) AS total FROM reviews r
      JOIN users fu ON r.family_user_id = fu.id
      ${where}
    `).get(...params.slice(0, -2));

    // Distribution: count per rating (exclude demo)
    const dist = await db.prepare(`
      SELECT r.rating, COUNT(*) AS cnt FROM reviews r
      JOIN users fu ON r.family_user_id = fu.id
      WHERE COALESCE(fu.is_demo, 0) = 0
      GROUP BY r.rating ORDER BY r.rating
    `).all();

    // Overall stats (exclude demo)
    const overall = await db.prepare(`
      SELECT COUNT(*) AS total, ROUND(AVG(r.rating), 2) AS avg_rating,
        COUNT(*) FILTER (WHERE r.rating >= 4) AS positive,
        COUNT(*) FILTER (WHERE r.rating <= 2) AS negative,
        COUNT(*) FILTER (WHERE r.comment IS NOT NULL AND r.comment != '') AS with_comments
      FROM reviews r
      JOIN users fu ON r.family_user_id = fu.id
      WHERE COALESCE(fu.is_demo, 0) = 0
    `).get();

    // Flagged count (exclude demo)
    const flagged = await db.prepare(`
      SELECT COUNT(*) AS cnt FROM reviews r
      JOIN users fu ON r.family_user_id = fu.id
      WHERE COALESCE(fu.is_demo, 0) = 0 AND r.rating < 3 AND COALESCE(r.admin_status, 'pending') = 'pending'
    `).get();

    res.json({
      reviews: rows,
      total: countRow?.total || 0,
      distribution: dist,
      stats: { ...overall, flagged_pending: flagged?.cnt || 0 },
    });
  } catch (err) {
    console.error("Admin all reviews fetch error:", err);
    res.status(500).json({ error: "Failed to fetch reviews" });
  }
});

// GET /api/admin/reviews/insights — AI-generated review insights
router.get("/reviews/insights", requireAdmin, async (req, res) => {
  try {
    const db = await getDb();

    // Get recent reviews with comments (last 90 days, exclude demo)
    const recentReviews = await db.prepare(`
      SELECT r.rating, r.comment, r.review_type, r.created_at,
        cu.first_name || ' ' || cu.last_name AS caregiver_name,
        cs.service_type
      FROM reviews r
      JOIN users fu ON r.family_user_id = fu.id
      JOIN caregiver_profiles cp ON r.caregiver_id = cp.id
      JOIN users cu ON cp.user_id = cu.id
      JOIN care_sessions cs ON r.session_id = cs.id
      WHERE r.created_at > NOW() - INTERVAL '90 days' AND COALESCE(fu.is_demo, 0) = 0
      ORDER BY r.created_at DESC
      LIMIT 100
    `).all();

    // Compute insights from the data
    const insights = [];
    const totalRecent = recentReviews.length;
    if (totalRecent === 0) {
      return res.json({ insights: [{ type: 'info', icon: '📭', title: 'No Recent Reviews', detail: 'No reviews in the last 90 days to analyze.' }] });
    }

    const withComments = recentReviews.filter(r => r.comment && r.comment.trim());
    const avgRating = recentReviews.reduce((s, r) => s + r.rating, 0) / totalRecent;
    const positive = recentReviews.filter(r => r.rating >= 4);
    const negative = recentReviews.filter(r => r.rating <= 2);

    // 1. Overall sentiment
    insights.push({
      type: avgRating >= 4 ? 'positive' : avgRating >= 3 ? 'neutral' : 'warning',
      icon: avgRating >= 4 ? '😊' : avgRating >= 3 ? '😐' : '😟',
      title: 'Overall Sentiment',
      detail: `Average rating of ${avgRating.toFixed(1)}/5 across ${totalRecent} reviews in the last 90 days. ${positive.length} positive (4-5★), ${negative.length} negative (1-2★).`,
    });

    // 2. Comment analysis — keyword themes
    const allComments = withComments.map(r => r.comment.toLowerCase()).join(' ');
    const themes = [
      { keywords: ['patient', 'patience', 'calm', 'gentle'], label: 'Patience & gentleness', icon: '🕊️' },
      { keywords: ['kind', 'caring', 'compassion', 'warm', 'sweet'], label: 'Kindness & compassion', icon: '💛' },
      { keywords: ['punctual', 'on time', 'reliable', 'dependable'], label: 'Punctuality & reliability', icon: '⏰' },
      { keywords: ['professional', 'thorough', 'detail', 'organized'], label: 'Professionalism', icon: '👔' },
      { keywords: ['communicate', 'communication', 'update', 'informed'], label: 'Good communication', icon: '💬' },
      { keywords: ['late', 'no show', 'no-show', 'absent', 'missed'], label: 'Attendance issues', icon: '⚠️', negative: true },
      { keywords: ['rude', 'unprofessional', 'disrespect', 'careless'], label: 'Unprofessional behavior', icon: '🚩', negative: true },
      { keywords: ['dirty', 'clean', 'mess', 'hygiene'], label: 'Cleanliness/hygiene mentions', icon: '🧹' },
      { keywords: ['safe', 'safety', 'secure', 'trust'], label: 'Safety & trust', icon: '🛡️' },
      { keywords: ['happy', 'enjoy', 'love', 'wonderful', 'amazing', 'great', 'excellent', 'fantastic'], label: 'Strongly positive language', icon: '🌟' },
    ];

    const detectedThemes = [];
    for (const t of themes) {
      const count = t.keywords.reduce((sum, kw) => sum + (allComments.split(kw).length - 1), 0);
      if (count > 0) detectedThemes.push({ ...t, count });
    }
    detectedThemes.sort((a, b) => b.count - a.count);

    if (detectedThemes.length > 0) {
      const positiveThemes = detectedThemes.filter(t => !t.negative).slice(0, 3);
      const negativeThemes = detectedThemes.filter(t => t.negative);

      if (positiveThemes.length > 0) {
        insights.push({
          type: 'positive',
          icon: '🌟',
          title: 'What Families Appreciate',
          detail: positiveThemes.map(t => `${t.icon} ${t.label} (mentioned ${t.count}x)`).join(' • '),
        });
      }
      if (negativeThemes.length > 0) {
        insights.push({
          type: 'warning',
          icon: '⚠️',
          title: 'Areas of Concern',
          detail: negativeThemes.map(t => `${t.icon} ${t.label} (mentioned ${t.count}x)`).join(' • '),
        });
      }
    }

    // 3. Per-caregiver breakdown
    const caregiverMap = {};
    for (const r of recentReviews) {
      if (!caregiverMap[r.caregiver_name]) caregiverMap[r.caregiver_name] = { ratings: [], comments: [] };
      caregiverMap[r.caregiver_name].ratings.push(r.rating);
      if (r.comment) caregiverMap[r.caregiver_name].comments.push(r.comment);
    }

    // Top performer
    const caregiverAvgs = Object.entries(caregiverMap)
      .filter(([, v]) => v.ratings.length >= 2)
      .map(([name, v]) => ({ name, avg: v.ratings.reduce((s, r) => s + r, 0) / v.ratings.length, count: v.ratings.length }))
      .sort((a, b) => b.avg - a.avg);

    if (caregiverAvgs.length > 0 && caregiverAvgs[0].avg >= 4) {
      insights.push({
        type: 'positive',
        icon: '🏆',
        title: 'Top Rated Caregiver',
        detail: `${caregiverAvgs[0].name} — ${caregiverAvgs[0].avg.toFixed(1)}★ avg across ${caregiverAvgs[0].count} recent reviews.`,
      });
    }

    // Struggling caregiver
    const struggling = caregiverAvgs.filter(c => c.avg < 3);
    if (struggling.length > 0) {
      insights.push({
        type: 'warning',
        icon: '📉',
        title: 'Needs Attention',
        detail: struggling.map(c => `${c.name} (${c.avg.toFixed(1)}★ across ${c.count} reviews)`).join(', ') + ' — consider follow-up coaching.',
      });
    }

    // 4. Trend: last 30 vs prior 30
    const now = new Date();
    const thirtyAgo = new Date(now - 30 * 86400000);
    const sixtyAgo = new Date(now - 60 * 86400000);
    const recent30 = recentReviews.filter(r => new Date(r.created_at) >= thirtyAgo);
    const prior30 = recentReviews.filter(r => { const d = new Date(r.created_at); return d >= sixtyAgo && d < thirtyAgo; });

    if (recent30.length >= 3 && prior30.length >= 3) {
      const recentAvg = recent30.reduce((s, r) => s + r.rating, 0) / recent30.length;
      const priorAvg = prior30.reduce((s, r) => s + r.rating, 0) / prior30.length;
      const delta = recentAvg - priorAvg;
      if (Math.abs(delta) > 0.3) {
        insights.push({
          type: delta > 0 ? 'positive' : 'warning',
          icon: delta > 0 ? '📈' : '📉',
          title: 'Rating Trend',
          detail: `Average rating ${delta > 0 ? 'improved' : 'declined'} from ${priorAvg.toFixed(1)} to ${recentAvg.toFixed(1)} (${delta > 0 ? '+' : ''}${delta.toFixed(1)}) over the last 30 days vs prior 30.`,
        });
      }
    }

    // 5. Comment rate
    const commentRate = withComments.length / totalRecent;
    insights.push({
      type: 'info',
      icon: '💬',
      title: 'Comment Rate',
      detail: `${Math.round(commentRate * 100)}% of reviews include written feedback (${withComments.length}/${totalRecent}).`,
    });

    res.json({ insights });
  } catch (err) {
    console.error("Review insights error:", err);
    res.status(500).json({ error: "Failed to generate insights" });
  }
});

// GET /api/admin/briefing — Admin iPAi briefing: platform health snapshot
router.get("/briefing", requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const briefing = {};

    // 1. Session activity (last 7 days vs prior 7)
    try {
      briefing.sessions = await db.prepare(`
        SELECT
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') AS sessions_7d,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '14 days' AND created_at <= NOW() - INTERVAL '7 days') AS sessions_prior_7d,
          COUNT(*) FILTER (WHERE status = 'completed' AND created_at > NOW() - INTERVAL '7 days') AS completed_7d,
          COUNT(*) FILTER (WHERE status = 'cancelled' AND created_at > NOW() - INTERVAL '7 days') AS cancelled_7d,
          COUNT(*) FILTER (WHERE status = 'pending' OR status = 'confirmed') AS upcoming
        FROM care_sessions cs
        WHERE ${NOT_DEMO_SESSION()}
      `).get();
    } catch (e) { console.error("Briefing sessions:", e.message); briefing.sessions = {}; }

    // 2. Caregiver engagement: offer acceptance rate
    try {
      briefing.offers = await db.prepare(`
        SELECT
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') AS offers_7d,
          COUNT(*) FILTER (WHERE status = 'accepted' AND created_at > NOW() - INTERVAL '7 days') AS accepted_7d,
          COUNT(*) FILTER (WHERE status = 'declined' AND created_at > NOW() - INTERVAL '7 days') AS declined_7d,
          COUNT(*) FILTER (WHERE status = 'expired' AND created_at > NOW() - INTERVAL '7 days') AS expired_7d,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '14 days' AND created_at <= NOW() - INTERVAL '7 days') AS offers_prior_7d,
          COUNT(*) FILTER (WHERE status = 'accepted' AND created_at > NOW() - INTERVAL '14 days' AND created_at <= NOW() - INTERVAL '7 days') AS accepted_prior_7d
        FROM session_offers so
        WHERE NOT EXISTS (SELECT 1 FROM users du WHERE COALESCE(du.is_demo, 0) = 1 AND du.id IN (so.from_user_id, so.to_user_id))
      `).get();
    } catch (e) { console.error("Briefing offers:", e.message); briefing.offers = {}; }

    // 3. Revenue snapshot — use care_sessions estimated_cost (source of truth)
    try {
      briefing.revenue = await db.prepare(`
        SELECT
          COALESCE(SUM(cs.estimated_cost * 100) FILTER (WHERE cs.completed_at > NOW() - INTERVAL '7 days' OR (cs.completed_at IS NULL AND cs.updated_at > NOW() - INTERVAL '7 days')), 0) AS revenue_7d,
          COALESCE(SUM(cs.estimated_cost * 100) FILTER (WHERE COALESCE(cs.completed_at, cs.updated_at) > NOW() - INTERVAL '14 days' AND COALESCE(cs.completed_at, cs.updated_at) <= NOW() - INTERVAL '7 days'), 0) AS revenue_prior_7d,
          COUNT(*) FILTER (WHERE COALESCE(cs.completed_at, cs.updated_at) > NOW() - INTERVAL '7 days') AS payments_7d,
          0 AS failed_7d
        FROM care_sessions cs
        JOIN users u ON cs.family_user_id = u.id
        WHERE cs.status = 'completed' AND cs.estimated_cost > 0
          AND COALESCE(u.is_demo, 0) = 0
          AND NOT EXISTS (SELECT 1 FROM caregiver_profiles _cp JOIN users _cu ON _cp.user_id = _cu.id WHERE _cp.id = cs.caregiver_id AND _cu.is_demo = 1)
      `).get();
    } catch (e) { console.error("Briefing revenue:", e.message); briefing.revenue = {}; }

    // 4. User growth
    try {
      briefing.users = await db.prepare(`
        SELECT
          COUNT(*) AS total_users,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') AS new_7d,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '14 days' AND created_at <= NOW() - INTERVAL '7 days') AS new_prior_7d,
          0 AS active_7d
        FROM users WHERE COALESCE(is_demo, 0) = 0
      `).get();
    } catch (e) { console.error("Briefing users:", e.message); briefing.users = {}; }

    // 5. Review summary
    try {
      briefing.reviews = await db.prepare(`
        SELECT
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') AS reviews_7d,
          ROUND(AVG(rating) FILTER (WHERE created_at > NOW() - INTERVAL '7 days'), 2) AS avg_rating_7d,
          ROUND(AVG(rating) FILTER (WHERE created_at > NOW() - INTERVAL '14 days' AND created_at <= NOW() - INTERVAL '7 days'), 2) AS avg_rating_prior_7d,
          0 AS flagged_pending
        FROM reviews
      `).get();
    } catch (e) { console.error("Briefing reviews:", e.message); briefing.reviews = {}; }

    // 6. Support tickets
    try {
      briefing.tickets = await db.prepare(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'open' OR status = 'in_progress') AS open_tickets,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') AS new_7d,
          COUNT(*) FILTER (WHERE status = 'resolved' AND updated_at > NOW() - INTERVAL '7 days') AS resolved_7d
        FROM admin_tickets
      `).get();
    } catch (e) { console.error("Briefing tickets:", e.message); briefing.tickets = {}; }

    // 7. Security: recent failed logins
    try {
      briefing.security = await db.prepare(`
        SELECT
          COUNT(*) FILTER (WHERE action = 'login_failed' AND created_at > NOW() - INTERVAL '24 hours') AS failed_logins_24h,
          COUNT(*) FILTER (WHERE severity IN ('critical', 'error') AND created_at > NOW() - INTERVAL '24 hours') AS critical_events_24h
        FROM audit_log
      `).get();
    } catch (e) { console.error("Briefing security:", e.message); briefing.security = {}; }

    // 8. Generate natural-language briefing items
    const items = [];
    const s = briefing.sessions || {};
    const o = briefing.offers || {};
    const r = briefing.revenue || {};
    const u = briefing.users || {};
    const rv = briefing.reviews || {};
    const t = briefing.tickets || {};
    const sec = briefing.security || {};

    // Session activity
    const sessionDelta = s.sessions_prior_7d > 0 ? ((s.sessions_7d - s.sessions_prior_7d) / s.sessions_prior_7d * 100) : null;
    items.push({
      category: 'activity',
      icon: '📅',
      title: 'Session Activity',
      detail: `${s.sessions_7d || 0} sessions this week${sessionDelta !== null ? ` (${sessionDelta > 0 ? '+' : ''}${Math.round(sessionDelta)}% vs last week)` : ''}. ${s.completed_7d || 0} completed, ${s.cancelled_7d || 0} cancelled, ${s.upcoming || 0} upcoming.`,
      sentiment: sessionDelta > 10 ? 'up' : sessionDelta < -10 ? 'down' : 'neutral',
    });

    // Offer acceptance
    const acceptRate = o.offers_7d > 0 ? Math.round(o.accepted_7d / o.offers_7d * 100) : null;
    const priorAcceptRate = o.offers_prior_7d > 0 ? Math.round(o.accepted_prior_7d / o.offers_prior_7d * 100) : null;
    if (o.offers_7d > 0) {
      let offerDetail = `Caregiver offer acceptance rate: ${acceptRate}% (${o.accepted_7d}/${o.offers_7d}).`;
      if (o.expired_7d > 0) offerDetail += ` ${o.expired_7d} offers expired.`;
      if (priorAcceptRate !== null && acceptRate < priorAcceptRate - 10) {
        offerDetail += ` ⚠️ Down from ${priorAcceptRate}% last week — caregivers may be less responsive.`;
      }
      items.push({
        category: 'engagement',
        icon: '🤝',
        title: 'Caregiver Engagement',
        detail: offerDetail,
        sentiment: acceptRate >= 70 ? 'up' : acceptRate >= 40 ? 'neutral' : 'down',
      });
    }

    // Revenue
    const revDollars7d = ((r.revenue_7d || 0) / 100).toFixed(0);
    const revDollarsPrior = ((r.revenue_prior_7d || 0) / 100).toFixed(0);
    const revDelta = r.revenue_prior_7d > 0 ? ((r.revenue_7d - r.revenue_prior_7d) / r.revenue_prior_7d * 100) : null;
    items.push({
      category: 'revenue',
      icon: '💰',
      title: 'Revenue',
      detail: `$${revDollars7d} gross this week (${r.payments_7d || 0} payments)${revDelta !== null ? ` ${revDelta > 0 ? '↑' : '↓'}${Math.abs(Math.round(revDelta))}% vs last week` : ''}.${r.failed_7d > 0 ? ` ⚠️ ${r.failed_7d} failed payments.` : ''}`,
      sentiment: revDelta > 5 ? 'up' : revDelta < -10 ? 'down' : 'neutral',
    });

    // Users
    items.push({
      category: 'growth',
      icon: '👥',
      title: 'User Growth',
      detail: `${u.new_7d || 0} new users this week${u.new_prior_7d > 0 ? ` (was ${u.new_prior_7d} last week)` : ''}. ${u.active_7d || 0} active users. ${u.total_users || 0} total.`,
      sentiment: (u.new_7d || 0) > (u.new_prior_7d || 0) ? 'up' : 'neutral',
    });

    // Reviews
    if (rv.reviews_7d > 0) {
      const ratingDelta = rv.avg_rating_prior_7d ? (rv.avg_rating_7d - rv.avg_rating_prior_7d) : null;
      items.push({
        category: 'satisfaction',
        icon: '⭐',
        title: 'Satisfaction',
        detail: `${rv.reviews_7d} reviews this week, avg ${rv.avg_rating_7d}★${ratingDelta ? ` (${ratingDelta > 0 ? '+' : ''}${ratingDelta.toFixed(1)} vs last week)` : ''}.${rv.flagged_pending > 0 ? ` ⚠️ ${rv.flagged_pending} flagged reviews need attention.` : ''}`,
        sentiment: rv.avg_rating_7d >= 4 ? 'up' : rv.avg_rating_7d >= 3 ? 'neutral' : 'down',
      });
    }

    // Support
    if ((t.open_tickets || 0) > 0 || (t.new_7d || 0) > 0) {
      items.push({
        category: 'support',
        icon: '🎫',
        title: 'Support',
        detail: `${t.open_tickets || 0} open tickets. ${t.new_7d || 0} new this week, ${t.resolved_7d || 0} resolved.`,
        sentiment: (t.open_tickets || 0) > 5 ? 'down' : 'neutral',
      });
    }

    // Security
    if ((sec.failed_logins_24h || 0) > 10 || (sec.critical_events_24h || 0) > 0) {
      items.push({
        category: 'security',
        icon: '🛡️',
        title: 'Security',
        detail: `${sec.failed_logins_24h || 0} failed logins in 24h${sec.critical_events_24h > 0 ? `, ${sec.critical_events_24h} critical events` : ''}. ${sec.failed_logins_24h > 20 ? '⚠️ Elevated — possible brute force.' : 'Normal levels.'}`,
        sentiment: sec.critical_events_24h > 0 ? 'down' : 'neutral',
      });
    }

    briefing.items = items;
    briefing.generatedAt = new Date().toISOString();
    res.json(briefing);
  } catch (err) {
    console.error("Admin briefing error:", err);
    res.status(500).json({ error: "Failed to generate briefing" });
  }
});
};
