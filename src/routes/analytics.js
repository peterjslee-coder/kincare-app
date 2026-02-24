const express = require("express");
const { getDb } = require("../models/database");
const { authenticate, requireRole } = require("../middleware/auth");

const router = express.Router();
router.use(authenticate);

// ─── GET /api/analytics ───
// Returns monthly care data for the past 6 months (family users only)
router.get("/", requireRole("family"), async (req, res) => {
  const db = await getDb();
  const userId = req.user.id;

  // Get data for the past 6 months
  const months = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      label: d.toLocaleString("en-US", { month: "short" }),
      start: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`,
      end: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()}`,
    });
  }

  const monthlyData = [];
  for (const m of months) {
    const stats = await db.prepare(`
      SELECT
        COUNT(*) as sessions,
        COALESCE(SUM(duration_hours), 0) as hours,
        COALESCE(SUM(COALESCE(actual_cost, estimated_cost)), 0) as spend
      FROM care_sessions
      WHERE family_user_id = ?
        AND scheduled_date >= ?
        AND scheduled_date <= ?
        AND status IN ('confirmed', 'completed')
    `).get(userId, m.start, m.end);

    const completed = await db.prepare(`
      SELECT COUNT(*) as count
      FROM care_sessions
      WHERE family_user_id = ?
        AND scheduled_date >= ?
        AND scheduled_date <= ?
        AND status = 'completed'
    `).get(userId, m.start, m.end);

    monthlyData.push({
      label: m.label,
      year: m.year,
      month: m.month,
      sessions: parseInt(stats.sessions) || 0,
      hours: Math.round((parseFloat(stats.hours) || 0) * 10) / 10,
      spend: Math.round((parseFloat(stats.spend) || 0) * 100) / 100,
      completed: parseInt(completed.count) || 0,
    });
  }

  // Service type breakdown (all time)
  const serviceBreakdown = await db.prepare(`
    SELECT service_type, COUNT(*) as count,
      COALESCE(SUM(duration_hours), 0) as total_hours,
      COALESCE(SUM(COALESCE(actual_cost, estimated_cost)), 0) as total_spend
    FROM care_sessions
    WHERE family_user_id = ?
      AND status IN ('confirmed', 'completed')
    GROUP BY service_type
    ORDER BY count DESC
  `).all(userId);

  // Caregiver utilization (who's been booked most)
  const caregiverStats = await db.prepare(`
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
  `).all(userId);

  // Overall totals
  const totals = await db.prepare(`
    SELECT
      COUNT(*) as total_sessions,
      COALESCE(SUM(duration_hours), 0) as total_hours,
      COALESCE(SUM(COALESCE(actual_cost, estimated_cost)), 0) as total_spend
    FROM care_sessions
    WHERE family_user_id = ?
      AND status IN ('confirmed', 'completed')
  `).get(userId);

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
