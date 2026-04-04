const express = require("express");
const { getDb } = require("../models/database");
const { authenticate, requireRole } = require("../middleware/auth");

const router = express.Router();
router.use(authenticate);

// ─── GET /api/analytics ───
// Returns monthly care data for the past 6 months (family users only)
router.get("/", requireRole("family"), async (req, res) => {
  const t0 = Date.now();
  const db = await getDb();
  const userId = req.user.id;

  // Build month boundaries for the past 6 months
  const now = new Date();
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const sixMonthsAgoStr = `${sixMonthsAgo.getFullYear()}-${String(sixMonthsAgo.getMonth() + 1).padStart(2, "0")}-01`;

  const monthLabels = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    monthLabels.push({
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      label: d.toLocaleString("en-US", { month: "short" }),
    });
  }

  // Single query replaces 12 sequential queries — GROUP BY month
  const [monthlyRaw, serviceBreakdown, caregiverStats, totals] = await Promise.all([
    db.prepare(`
      SELECT
        EXTRACT(YEAR FROM scheduled_date) AS yr,
        EXTRACT(MONTH FROM scheduled_date) AS mo,
        COUNT(*) AS sessions,
        COALESCE(SUM(duration_hours), 0) AS hours,
        COALESCE(SUM(COALESCE(actual_cost, estimated_cost)), 0) AS spend,
        COUNT(*) FILTER (WHERE status = 'completed') AS completed
      FROM care_sessions
      WHERE family_user_id = ?
        AND scheduled_date >= ?
        AND status IN ('confirmed', 'completed')
      GROUP BY yr, mo
      ORDER BY yr, mo
    `).all(userId, sixMonthsAgoStr),

    db.prepare(`
      SELECT service_type, COUNT(*) as count,
        COALESCE(SUM(duration_hours), 0) as total_hours,
        COALESCE(SUM(COALESCE(actual_cost, estimated_cost)), 0) as total_spend
      FROM care_sessions
      WHERE family_user_id = ?
        AND status IN ('confirmed', 'completed')
      GROUP BY service_type
      ORDER BY count DESC
    `).all(userId),

    db.prepare(`
      SELECT
        u.first_name || ' ' || u.last_name AS name,
        COUNT(*) as sessions,
        COALESCE(SUM(cs.duration_hours), 0) as hours,
        cp.rating_avg as rating
      FROM care_sessions cs
      JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
      JOIN users u ON cp.user_id = u.id
      WHERE cs.family_user_id = ?
        AND cs.caregiver_id IS NOT NULL
        AND cs.status IN ('confirmed', 'completed')
      GROUP BY cp.id, u.first_name, u.last_name, cp.rating_avg
      ORDER BY sessions DESC
      LIMIT 5
    `).all(userId),

    db.prepare(`
      SELECT
        COUNT(*) as total_sessions,
        COALESCE(SUM(duration_hours), 0) as total_hours,
        COALESCE(SUM(COALESCE(actual_cost, estimated_cost)), 0) as total_spend
      FROM care_sessions
      WHERE family_user_id = ?
        AND status IN ('confirmed', 'completed')
    `).get(userId),
  ]);

  // Map grouped results back to month labels
  const monthMap = {};
  for (const row of monthlyRaw) {
    monthMap[`${parseInt(row.yr)}-${parseInt(row.mo)}`] = row;
  }

  const monthlyData = monthLabels.map(m => {
    const row = monthMap[`${m.year}-${m.month}`];
    return {
      label: m.label,
      year: m.year,
      month: m.month,
      sessions: row ? parseInt(row.sessions) || 0 : 0,
      hours: row ? Math.round((parseFloat(row.hours) || 0) * 10) / 10 : 0,
      spend: row ? Math.round((parseFloat(row.spend) || 0) * 100) / 100 : 0,
      completed: row ? parseInt(row.completed) || 0 : 0,
    };
  });

  console.log(`[analytics] ${Date.now() - t0}ms (4 parallel queries instead of 15 sequential)`);

  res.json({
    monthly: monthlyData,
    serviceBreakdown: serviceBreakdown.map(s => ({
      serviceType: s.service_type,
      count: parseInt(s.count),
      hours: Math.round((parseFloat(s.total_hours) || 0) * 10) / 10,
      spend: Math.round((parseFloat(s.total_spend) || 0) * 100) / 100,
    })),
    caregiverStats: caregiverStats.map(c => ({
      name: c.name,
      sessions: parseInt(c.sessions),
      hours: Math.round((parseFloat(c.hours) || 0) * 10) / 10,
      rating: c.rating,
    })),
    totals: {
      sessions: parseInt(totals.total_sessions) || 0,
      hours: Math.round((parseFloat(totals.total_hours) || 0) * 10) / 10,
      spend: Math.round((parseFloat(totals.total_spend) || 0) * 100) / 100,
    },
  });
});

module.exports = router;
