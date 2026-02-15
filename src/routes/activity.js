const express = require("express");
const { v4: uuid } = require("uuid");
const { getDb } = require("../models/database");
const { authenticate, requireRole } = require("../middleware/auth");

const router = express.Router();
router.use(authenticate);

// ─── GET /api/activity ───
// Activity feed for the logged-in family user
router.get("/", requireRole("family", "admin"), async (req, res) => {
  const db = await getDb();
  const { unreadOnly, limit = 30 } = req.query;

  let query = `
    SELECT af.*,
      cr.first_name || ' ' || cr.last_name AS recipient_name
    FROM activity_feed af
    LEFT JOIN care_recipients cr ON af.care_recipient_id = cr.id
    WHERE af.family_user_id = ?
  `;
  const params = [req.user.id];

  if (unreadOnly === "true") {
    query += " AND af.is_read = 0";
  }

  query += " ORDER BY af.created_at DESC LIMIT ?";
  params.push(parseInt(limit));

  const activities = db.prepare(query).all(...params);

  // Unread count
  const unreadCount = db.prepare(
    "SELECT COUNT(*) as count FROM activity_feed WHERE family_user_id = ? AND is_read = 0"
  ).get(req.user.id);

  res.json({ activities, unreadCount: unreadCount.count });
});

// ─── PUT /api/activity/:id/read ───
router.put("/:id/read", requireRole("family"), async (req, res) => {
  const db = await getDb();
  db.prepare(
    "UPDATE activity_feed SET is_read = 1 WHERE id = ? AND family_user_id = ?"
  ).run(req.params.id, req.user.id);
  res.json({ success: true });
});

// ─── PUT /api/activity/read-all ───
router.put("/read-all", requireRole("family"), async (req, res) => {
  const db = await getDb();
  db.prepare(
    "UPDATE activity_feed SET is_read = 1 WHERE family_user_id = ? AND is_read = 0"
  ).run(req.user.id);
  res.json({ success: true });
});

// ─── POST /api/activity/visit-log ───
// Caregiver submits a visit log
router.post("/visit-log", requireRole("caregiver"), async (req, res) => {
  const db = await getDb();
  const { sessionId, summary, moodRating, tasksCompleted, notes } = req.body;

  if (!sessionId || !summary) {
    return res.status(400).json({ error: "sessionId and summary required" });
  }

  const profile = db.prepare(
    "SELECT id FROM caregiver_profiles WHERE user_id = ?"
  ).get(req.user.id);

  if (!profile) return res.status(404).json({ error: "Caregiver profile not found" });

  const session = db.prepare(
    "SELECT * FROM care_sessions WHERE id = ? AND caregiver_id = ?"
  ).get(sessionId, profile.id);

  if (!session) return res.status(404).json({ error: "Session not found" });

  const logId = uuid();

  db.prepare(`
    INSERT INTO visit_logs
    (id, session_id, caregiver_id, check_in_time, check_out_time,
     summary, mood_rating, tasks_completed, notes)
    VALUES (?, ?, ?, datetime('now', '-2 hours'), datetime('now'), ?, ?, ?, ?)
  `).run(
    logId, sessionId, profile.id,
    summary, moodRating || null,
    JSON.stringify(tasksCompleted || []),
    notes || null
  );

  // Notify the family
  db.prepare(`
    INSERT INTO activity_feed
    (id, family_user_id, care_recipient_id, event_type, title, message, metadata)
    VALUES (?, ?, ?, 'visit_complete', ?, ?, ?)
  `).run(
    uuid(), session.family_user_id, session.care_recipient_id,
    "Visit completed",
    summary,
    JSON.stringify({ moodRating, sessionId, visitLogId: logId })
  );

  // Update session status
  db.prepare(
    "UPDATE care_sessions SET status = 'completed', updated_at = datetime('now') WHERE id = ?"
  ).run(sessionId);

  const log = db.prepare("SELECT * FROM visit_logs WHERE id = ?").get(logId);
  res.status(201).json({ visitLog: log });
});

module.exports = router;
