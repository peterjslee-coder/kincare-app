const express = require("express");
const { getDb } = require("../models/database");
const { authenticate, requireRole } = require("../middleware/auth");

const router = express.Router();
router.use(authenticate);

// ─── GET /api/dashboard ───
// Aggregated dashboard data for the family view
router.get("/", requireRole("family", "admin"), async (req, res) => {
  const db = await getDb();
  const userId = req.user.id;

  // Care recipients
  const recipients = db.prepare(
    "SELECT * FROM care_recipients WHERE family_user_id = ?"
  ).all(userId);

  // This month's stats
  const monthStart = new Date();
  monthStart.setDate(1);
  const monthStr = monthStart.toISOString().split("T")[0];

  const monthlyStats = db.prepare(`
    SELECT
      COUNT(*) as total_sessions,
      SUM(duration_hours) as total_hours,
      SUM(COALESCE(actual_cost, estimated_cost)) as total_spend,
      AVG(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completion_rate
    FROM care_sessions
    WHERE family_user_id = ? AND scheduled_date >= ?
  `).get(userId, monthStr);

  // Upcoming sessions (next 7 days)
  const today = new Date().toISOString().split("T")[0];
  const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0];

  const upcoming = db.prepare(`
    SELECT cs.*,
      cr.first_name || ' ' || cr.last_name AS recipient_name,
      u.first_name || ' ' || u.last_name AS caregiver_name,
      cp.rating_avg AS caregiver_rating
    FROM care_sessions cs
    LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
    LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
    LEFT JOIN users u ON cp.user_id = u.id
    WHERE cs.family_user_id = ?
      AND cs.scheduled_date >= ?
      AND cs.scheduled_date <= ?
      AND cs.status IN ('pending', 'confirmed')
    ORDER BY cs.scheduled_date ASC, cs.scheduled_time ASC
    LIMIT 5
  `).all(userId, today, nextWeek);

  // Recent activity
  const recentActivity = db.prepare(`
    SELECT * FROM activity_feed
    WHERE family_user_id = ?
    ORDER BY created_at DESC LIMIT 5
  `).all(userId);

  const unreadCount = db.prepare(
    "SELECT COUNT(*) as count FROM activity_feed WHERE family_user_id = ? AND is_read = 0"
  ).get(userId);

  // Average caregiver rating across completed sessions
  const avgRating = db.prepare(`
    SELECT AVG(cp.rating_avg) as avg
    FROM care_sessions cs
    JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
    WHERE cs.family_user_id = ? AND cs.status = 'completed'
  `).get(userId);

  // Build parent object for the frontend (first care recipient)
  const primary = recipients[0];
  const parent = primary
    ? {
        id: primary.id,
        name: `${primary.first_name} ${primary.last_name}`,
        age: primary.age,
        location: `${primary.location_city}, ${primary.location_state}`,
        healthConditions: JSON.parse(primary.health_conditions || "[]"),
        medications: JSON.parse(primary.medications || "[]"),
        preferences: primary.preferences,
        emergencyContact: {
          name: primary.emergency_contact_name,
          phone: primary.emergency_contact_phone,
        },
      }
    : null;

  res.json({
    parent,
    careRecipients: recipients.map((r) => ({
      ...r,
      healthConditions: JSON.parse(r.health_conditions || "[]"),
      medications: JSON.parse(r.medications || "[]"),
    })),
    stats: {
      sessionsThisMonth: monthlyStats.total_sessions || 0,
      hoursThisMonth: Math.round((monthlyStats.total_hours || 0) * 10) / 10,
      spendThisMonth: Math.round((monthlyStats.total_spend || 0) * 100) / 100,
      avgCaregiverRating: Math.round((avgRating.avg || 0) * 10) / 10,
      unreadNotifications: unreadCount.count,
    },
    upcomingSessions: upcoming.map((s) => ({
      id: s.id,
      date: s.scheduled_date,
      time: s.scheduled_time,
      serviceType: s.service_type,
      status: s.status,
      durationHours: s.duration_hours,
      caregiverName: s.caregiver_name,
      caregiverRating: s.caregiver_rating,
      recipientName: s.recipient_name,
      specialInstructions: s.special_instructions,
      estimatedCost: s.estimated_cost,
    })),
    recentActivity: recentActivity.map((a) => ({
      id: a.id,
      eventType: a.event_type,
      title: a.title,
      message: a.message,
      isRead: a.is_read,
      createdAt: a.created_at,
    })),
  });
});

module.exports = router;
