const express = require("express");
const { v4: uuid } = require("uuid");
const { getDb } = require("../models/database");
const { authenticate, requireRole } = require("../middleware/auth");

const router = express.Router();
router.use(authenticate);

// ─── GET /api/activity ───
// Activity feed for the logged-in family user (includes shared care recipient activities)
router.get("/", async (req, res) => {
  const db = await getDb();
  const userId = req.user.id;
  const { unreadOnly, limit = 30 } = req.query;

  // Get owned + shared recipient IDs (same scope as dashboard)
  const ownedRecipients = await db.prepare(
    "SELECT id FROM care_recipients WHERE family_user_id = ?"
  ).all(userId);
  const sharedRecipients = await db.prepare(
    "SELECT care_recipient_id AS id FROM care_recipient_shares WHERE shared_with_user_id = ?"
  ).all(userId);
  const ownedIds = new Set(ownedRecipients.map(r => r.id));
  const allRecipientIds = [...ownedRecipients, ...sharedRecipients.filter(r => !ownedIds.has(r.id))].map(r => r.id);
  const recipientPlaceholders = allRecipientIds.length > 0 ? allRecipientIds.map(() => '?').join(',') : "'__none__'";

  let query = `
    SELECT af.*,
      cr.first_name || ' ' || cr.last_name AS recipient_name
    FROM activity_feed af
    LEFT JOIN care_recipients cr ON af.care_recipient_id = cr.id
    WHERE (af.family_user_id = ? OR af.care_recipient_id IN (${recipientPlaceholders}))
  `;
  const params = [userId, ...allRecipientIds];

  if (unreadOnly === "true") {
    query += " AND af.is_read = 0";
  }

  query += " ORDER BY af.created_at DESC LIMIT ?";
  params.push(parseInt(limit));

  const activities = await db.prepare(query).all(...params);

  // Unread count (same scope)
  const unreadCount = await db.prepare(
    `SELECT COUNT(*) as count FROM activity_feed WHERE (family_user_id = ? OR care_recipient_id IN (${recipientPlaceholders})) AND is_read = 0`
  ).get(userId, ...allRecipientIds);

  res.json({ activities, unreadCount: unreadCount.count });
});

// ─── PUT /api/activity/:id/read ───
router.put("/:id/read", requireRole("family"), async (req, res) => {
  const db = await getDb();
  const userId = req.user.id;

  // Allow marking read if user owns the activity OR shares the care recipient
  const ownedRecipients = await db.prepare(
    "SELECT id FROM care_recipients WHERE family_user_id = ?"
  ).all(userId);
  const sharedRecipients = await db.prepare(
    "SELECT care_recipient_id AS id FROM care_recipient_shares WHERE shared_with_user_id = ?"
  ).all(userId);
  const ownedIds = new Set(ownedRecipients.map(r => r.id));
  const allRecipientIds = [...ownedRecipients, ...sharedRecipients.filter(r => !ownedIds.has(r.id))].map(r => r.id);
  const recipientPlaceholders = allRecipientIds.length > 0 ? allRecipientIds.map(() => '?').join(',') : "'__none__'";

  await db.prepare(
    `UPDATE activity_feed SET is_read = 1 WHERE id = ? AND (family_user_id = ? OR care_recipient_id IN (${recipientPlaceholders}))`
  ).run(req.params.id, userId, ...allRecipientIds);
  res.json({ success: true });
});

// ─── PUT /api/activity/read-all ───
router.put("/read-all", requireRole("family"), async (req, res) => {
  const db = await getDb();
  const userId = req.user.id;

  // Mark all read for owned + shared care recipient activities
  const ownedRecipients = await db.prepare(
    "SELECT id FROM care_recipients WHERE family_user_id = ?"
  ).all(userId);
  const sharedRecipients = await db.prepare(
    "SELECT care_recipient_id AS id FROM care_recipient_shares WHERE shared_with_user_id = ?"
  ).all(userId);
  const ownedIds = new Set(ownedRecipients.map(r => r.id));
  const allRecipientIds = [...ownedRecipients, ...sharedRecipients.filter(r => !ownedIds.has(r.id))].map(r => r.id);
  const recipientPlaceholders = allRecipientIds.length > 0 ? allRecipientIds.map(() => '?').join(',') : "'__none__'";

  await db.prepare(
    `UPDATE activity_feed SET is_read = 1 WHERE (family_user_id = ? OR care_recipient_id IN (${recipientPlaceholders})) AND is_read = 0`
  ).run(userId, ...allRecipientIds);
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

  const profile = await db.prepare(
    "SELECT id FROM caregiver_profiles WHERE user_id = ?"
  ).get(req.user.id);

  if (!profile) return res.status(404).json({ error: "Caregiver profile not found" });

  const session = await db.prepare(
    "SELECT * FROM care_sessions WHERE id = ? AND caregiver_id = ?"
  ).get(sessionId, profile.id);

  if (!session) return res.status(404).json({ error: "Session not found" });

  const logId = uuid();

  await db.prepare(`
    INSERT INTO visit_logs
    (id, session_id, caregiver_id, check_in_time, check_out_time,
     summary, mood_rating, tasks_completed, notes)
    VALUES (?, ?, ?, NOW() - INTERVAL '2 hours', NOW(), ?, ?, ?, ?)
  `).run(
    logId, sessionId, profile.id,
    summary, moodRating || null,
    JSON.stringify(tasksCompleted || []),
    notes || null
  );

  // Notify the family
  await db.prepare(`
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
  await db.prepare(
    "UPDATE care_sessions SET status = 'completed', updated_at = NOW() WHERE id = ?"
  ).run(sessionId);

  // Real-time: notify family that visit is complete
  const emitToUser = req.app.get("emitToUser");
  if (emitToUser) {
    emitToUser(session.family_user_id, "activity_update", {
      type: "visit_complete",
      title: "Visit completed",
      message: summary,
      sessionId,
      visitLogId: logId,
      moodRating,
    });
    emitToUser(session.family_user_id, "session_update", {
      sessionId,
      status: "completed",
    });
  }

  const log = await db.prepare("SELECT * FROM visit_logs WHERE id = ?").get(logId);
  res.status(201).json({ visitLog: log });
});

module.exports = router;
