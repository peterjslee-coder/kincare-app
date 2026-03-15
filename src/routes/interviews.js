const express = require("express");
const { v4: uuid } = require("uuid");
const { getDb } = require("../models/database");
const { authenticate } = require("../middleware/auth");
const { sendPushToUser } = require("./push");

const router = express.Router();
router.use(authenticate);

// ─── GET /api/interviews/care-history/:caregiverId/:recipientId ───
// Returns visit history between a specific caregiver and care recipient
// Used for the "Cary has cared for Betty 4 times" nudge + expandable care notes
router.get("/care-history/:caregiverId/:recipientId", async (req, res) => {
  try {
    const db = await getDb();
    const { caregiverId, recipientId } = req.params;
    const limit = parseInt(req.query.limit) || 5;

    // Get the caregiver profile ID from user ID
    const cgProfile = await db.prepare(
      "SELECT id FROM caregiver_profiles WHERE user_id = ?"
    ).get(caregiverId);

    if (!cgProfile) return res.json({ visits: [], totalCount: 0 });

    // Get total count of completed sessions between this caregiver and recipient
    const countRow = await db.prepare(`
      SELECT COUNT(*) AS count FROM care_sessions
      WHERE caregiver_id = ? AND care_recipient_id = ?
        AND status IN ('completed', 'reviewed')
    `).get(cgProfile.id, recipientId);
    const totalCount = parseInt(countRow?.count || 0);

    // Get the most recent N visits with details
    const visits = await db.prepare(`
      SELECT cs.id, cs.scheduled_date, cs.scheduled_time, cs.duration_hours,
        cs.service_type, cs.estimated_cost, cs.actual_cost,
        vl.arrival_mood, vl.departure_mood, vl.summary, vl.condition_tags,
        vl.care_feedback, vl.check_in_time, vl.check_out_time,
        cr.first_name AS recipient_first_name
      FROM care_sessions cs
      LEFT JOIN visit_logs vl ON vl.session_id = cs.id
      LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
      WHERE cs.caregiver_id = ? AND cs.care_recipient_id = ?
        AND cs.status IN ('completed', 'reviewed')
      ORDER BY cs.scheduled_date DESC, cs.scheduled_time DESC
      LIMIT ?
    `).all(cgProfile.id, recipientId, limit);

    res.json({ visits, totalCount });
  } catch (err) {
    console.error("Care history error:", err);
    res.status(500).json({ error: "Failed to fetch care history" });
  }
});

// ─── GET /api/interviews/visit-counts ───
// Batch endpoint: returns how many times the current caregiver has cared for each recipient
// Used for caregiver dashboard — "you've cared for Betty 4 times" badges on job cards
router.get("/visit-counts", async (req, res) => {
  try {
    const db = await getDb();
    const cgProfile = await db.prepare(
      "SELECT id FROM caregiver_profiles WHERE user_id = ?"
    ).get(req.user.id);

    if (!cgProfile) return res.json({ counts: {} });

    const rows = await db.prepare(`
      SELECT care_recipient_id, COUNT(*) AS count
      FROM care_sessions
      WHERE caregiver_id = ? AND status IN ('completed', 'reviewed')
      GROUP BY care_recipient_id
    `).all(cgProfile.id);

    const counts = {};
    for (const r of rows) counts[r.care_recipient_id] = parseInt(r.count);
    res.json({ counts });
  } catch (err) {
    console.error("Visit counts error:", err);
    res.status(500).json({ error: "Failed to fetch visit counts" });
  }
});

// ─── GET /api/interviews/family-visit-counts/:recipientId ───
// Returns visit counts per caregiver for a specific care recipient
// Used for family side — "Cary has cared for Betty 4 times" nudge in Request Care modal
router.get("/family-visit-counts/:recipientId", async (req, res) => {
  try {
    const db = await getDb();
    const { recipientId } = req.params;

    const rows = await db.prepare(`
      SELECT cs.caregiver_id, cp.user_id AS caregiver_user_id,
        u.first_name AS caregiver_first_name, u.last_name AS caregiver_last_name,
        COUNT(*) AS count
      FROM care_sessions cs
      JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
      JOIN users u ON cp.user_id = u.id
      WHERE cs.care_recipient_id = ? AND cs.status IN ('completed', 'reviewed')
      GROUP BY cs.caregiver_id, cp.user_id, u.first_name, u.last_name
    `).all(recipientId);

    const counts = {};
    for (const r of rows) {
      counts[r.caregiver_id] = {
        count: parseInt(r.count),
        caregiverUserId: r.caregiver_user_id,
        caregiverName: `${r.caregiver_first_name} ${r.caregiver_last_name}`,
      };
    }
    res.json({ counts });
  } catch (err) {
    console.error("Family visit counts error:", err);
    res.status(500).json({ error: "Failed to fetch visit counts" });
  }
});

// ─── POST /api/interviews ───
// Create an interview request (family-initiated or caregiver-initiated)
router.post("/", async (req, res) => {
  try {
    const db = await getDb();
    const { sessionId, interviewType = "video" } = req.body;
    if (!sessionId) return res.status(400).json({ error: "sessionId is required" });

    const session = await db.prepare(`
      SELECT cs.*, cp.user_id AS caregiver_user_id,
        cr.first_name AS recipient_first_name, cr.last_name AS recipient_last_name
      FROM care_sessions cs
      LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
      LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
      WHERE cs.id = ?
    `).get(sessionId);
    if (!session) return res.status(404).json({ error: "Session not found" });

    // Determine who is requesting and who is being requested
    const isFamily = req.user.id === session.family_user_id;
    const isCaregiver = req.user.id === session.caregiver_user_id;
    if (!isFamily && !isCaregiver) {
      return res.status(403).json({ error: "Only the family or assigned caregiver can request an interview" });
    }

    const requestedBy = req.user.id;
    const requestedOf = isFamily ? session.caregiver_user_id : session.family_user_id;

    if (!requestedOf) {
      return res.status(400).json({ error: "No counterpart assigned to this session yet" });
    }

    // Check for existing pending interview on this session
    const existing = await db.prepare(
      "SELECT id, status FROM interviews WHERE session_id = ? AND status IN ('pending', 'accepted')"
    ).get(sessionId);
    if (existing) {
      return res.status(400).json({ error: "An interview is already pending or scheduled for this session", interview: existing });
    }

    // Create interview record
    const interviewId = uuid();
    await db.prepare(`
      INSERT INTO interviews (id, session_id, requested_by, requested_of, interview_type, status)
      VALUES (?, ?, ?, ?, ?, 'pending')
    `).run(interviewId, sessionId, requestedBy, requestedOf, interviewType);

    // Update session with interview info
    await db.prepare(`
      UPDATE care_sessions SET interview_required = 1, interview_type = ?, interview_status = 'pending', updated_at = NOW()
      WHERE id = ?
    `).run(interviewType, sessionId);

    // Create or find a direct conversation between the two parties
    let conversationId;
    const existingConv = await db.prepare(`
      SELECT c.id FROM conversations c
      JOIN conversation_members cm1 ON cm1.conversation_id = c.id AND cm1.user_id = ?
      JOIN conversation_members cm2 ON cm2.conversation_id = c.id AND cm2.user_id = ?
      WHERE c.type = 'direct'
    `).get(requestedBy, requestedOf);

    if (existingConv) {
      conversationId = existingConv.id;
    } else {
      conversationId = uuid();
      await db.prepare(
        "INSERT INTO conversations (id, type, created_by) VALUES (?, 'direct', ?)"
      ).run(conversationId, requestedBy);
      await db.prepare(
        "INSERT INTO conversation_members (id, conversation_id, user_id, role) VALUES (?, ?, ?, 'member')"
      ).run(uuid(), conversationId, requestedBy);
      await db.prepare(
        "INSERT INTO conversation_members (id, conversation_id, user_id, role) VALUES (?, ?, ?, 'member')"
      ).run(uuid(), conversationId, requestedOf);
    }

    // Link conversation to interview
    await db.prepare("UPDATE interviews SET conversation_id = ? WHERE id = ?").run(conversationId, interviewId);

    // Send system message in conversation
    const requesterUser = await db.prepare("SELECT first_name, last_name FROM users WHERE id = ?").get(requestedBy);
    const requesterName = requesterUser ? `${requesterUser.first_name} ${requesterUser.last_name}` : "Someone";
    const recipientName = `${session.recipient_first_name || ''} ${session.recipient_last_name || ''}`.trim();
    const sessionDate = session.scheduled_date;

    const systemMsg = `📹 Interview requested — ${requesterName} would like a ${interviewType} interview before ${recipientName}'s appointment on ${sessionDate}. Use this chat to coordinate a time, then tap the call button when ready. Video calls are limited to 5 minutes.`;
    await db.prepare(`
      INSERT INTO messages (id, sender_id, content, conversation_id, message_type, metadata)
      VALUES (?, ?, ?, ?, 'system', ?)
    `).run(uuid(), requestedBy, systemMsg, conversationId, JSON.stringify({
      type: 'interview_request',
      interviewId,
      sessionId,
      interviewType,
    }));

    // Notify the other party
    const emitToUser = req.app.get("emitToUser");
    const pushTitle = isFamily ? "Interview requested" : "Caregiver wants to interview";
    const pushBody = isFamily
      ? `${requesterName} would like a ${interviewType} interview before ${recipientName}'s appointment on ${sessionDate}.`
      : `${requesterName} (caregiver) would like a ${interviewType} interview before your appointment on ${sessionDate}.`;

    if (emitToUser) {
      emitToUser(requestedOf, "interview_request", { interviewId, sessionId, conversationId });
      emitToUser(requestedOf, "new_message", { conversationId });
    }
    sendPushToUser(requestedOf, {
      title: pushTitle,
      body: pushBody,
      data: { type: "interview_request", interviewId, sessionId, page: "messages" },
    }, "interview_request").catch(() => {});

    const interview = await db.prepare("SELECT * FROM interviews WHERE id = ?").get(interviewId);
    res.status(201).json({ interview, conversationId });
  } catch (err) {
    console.error("Create interview error:", err);
    res.status(500).json({ error: "Failed to create interview request" });
  }
});

// ─── PUT /api/interviews/:id/accept ───
// Accept an interview request
router.put("/:id/accept", async (req, res) => {
  try {
    const db = await getDb();
    const interview = await db.prepare("SELECT * FROM interviews WHERE id = ?").get(req.params.id);
    if (!interview) return res.status(404).json({ error: "Interview not found" });
    if (interview.requested_of !== req.user.id) {
      return res.status(403).json({ error: "Only the requested party can accept" });
    }
    if (interview.status !== "pending") {
      return res.status(400).json({ error: `Interview is already ${interview.status}` });
    }

    await db.prepare("UPDATE interviews SET status = 'accepted', updated_at = NOW() WHERE id = ?").run(req.params.id);
    await db.prepare("UPDATE care_sessions SET interview_status = 'accepted' WHERE id = ?").run(interview.session_id);

    // Notify requester
    const emitToUser = req.app.get("emitToUser");
    const accepter = await db.prepare("SELECT first_name, last_name FROM users WHERE id = ?").get(req.user.id);
    const accepterName = accepter ? `${accepter.first_name}` : "Someone";

    if (emitToUser) {
      emitToUser(interview.requested_by, "interview_accepted", { interviewId: req.params.id, sessionId: interview.session_id });
    }
    sendPushToUser(interview.requested_by, {
      title: "Interview accepted!",
      body: `${accepterName} accepted your interview request. Open chat to coordinate a time.`,
      data: { type: "interview_accepted", interviewId: req.params.id, sessionId: interview.session_id, page: "messages" },
    }, "interview_accepted").catch(() => {});

    // System message in conversation
    if (interview.conversation_id) {
      await db.prepare(`
        INSERT INTO messages (id, sender_id, content, conversation_id, message_type, metadata)
        VALUES (?, ?, ?, ?, 'system', ?)
      `).run(uuid(), req.user.id, `✅ ${accepterName} accepted the interview request. You can coordinate a time and start the call when ready.`, interview.conversation_id, JSON.stringify({
        type: 'interview_accepted', interviewId: req.params.id,
      }));
      if (emitToUser) {
        emitToUser(interview.requested_by, "new_message", { conversationId: interview.conversation_id });
      }
    }

    res.json({ interview: { ...interview, status: "accepted" } });
  } catch (err) {
    console.error("Accept interview error:", err);
    res.status(500).json({ error: "Failed to accept interview" });
  }
});

// ─── PUT /api/interviews/:id/decline ───
// Decline an interview — for caregivers, this means declining the whole job
router.put("/:id/decline", async (req, res) => {
  try {
    const db = await getDb();
    const interview = await db.prepare("SELECT * FROM interviews WHERE id = ?").get(req.params.id);
    if (!interview) return res.status(404).json({ error: "Interview not found" });
    if (interview.requested_of !== req.user.id) {
      return res.status(403).json({ error: "Only the requested party can decline" });
    }
    if (interview.status !== "pending") {
      return res.status(400).json({ error: `Interview is already ${interview.status}` });
    }

    const { reason } = req.body;
    await db.prepare("UPDATE interviews SET status = 'declined', cancel_reason = ?, updated_at = NOW() WHERE id = ?").run(reason || null, req.params.id);
    await db.prepare("UPDATE care_sessions SET interview_status = 'declined' WHERE id = ?").run(interview.session_id);

    // If the family requested the interview and the caregiver declines, the caregiver loses the job
    const session = await db.prepare("SELECT * FROM care_sessions WHERE id = ?").get(interview.session_id);
    if (session && interview.requested_by === session.family_user_id) {
      // Caregiver is declining the family-requested interview → drop from job
      await db.prepare(`
        UPDATE care_sessions SET caregiver_id = NULL, status = 'open',
          interview_required = 0, interview_type = NULL, interview_status = NULL,
          updated_at = NOW()
        WHERE id = ?
      `).run(interview.session_id);
    }

    // Notify requester
    const emitToUser = req.app.get("emitToUser");
    const decliner = await db.prepare("SELECT first_name FROM users WHERE id = ?").get(req.user.id);
    const declinerName = decliner?.first_name || "Someone";

    if (emitToUser) {
      emitToUser(interview.requested_by, "interview_declined", { interviewId: req.params.id, sessionId: interview.session_id });
    }
    sendPushToUser(interview.requested_by, {
      title: "Interview declined",
      body: `${declinerName} declined the interview request.`,
      data: { type: "interview_declined", interviewId: req.params.id, sessionId: interview.session_id },
    }, "interview_declined").catch(() => {});

    // System message
    if (interview.conversation_id) {
      await db.prepare(`
        INSERT INTO messages (id, sender_id, content, conversation_id, message_type, metadata)
        VALUES (?, ?, ?, ?, 'system', ?)
      `).run(uuid(), req.user.id, `❌ ${declinerName} declined the interview request.`, interview.conversation_id, JSON.stringify({
        type: 'interview_declined', interviewId: req.params.id,
      }));
    }

    res.json({ interview: { ...interview, status: "declined" } });
  } catch (err) {
    console.error("Decline interview error:", err);
    res.status(500).json({ error: "Failed to decline interview" });
  }
});

// ─── PUT /api/interviews/:id/complete ───
// Mark interview as completed (called after a video/audio call)
router.put("/:id/complete", async (req, res) => {
  try {
    const db = await getDb();
    const interview = await db.prepare("SELECT * FROM interviews WHERE id = ?").get(req.params.id);
    if (!interview) return res.status(404).json({ error: "Interview not found" });
    if (interview.requested_by !== req.user.id && interview.requested_of !== req.user.id) {
      return res.status(403).json({ error: "Only interview participants can mark it complete" });
    }

    const { callDurationSeconds } = req.body;
    await db.prepare(`
      UPDATE interviews SET status = 'completed', call_ended_at = NOW(),
        call_duration_seconds = ?, updated_at = NOW()
      WHERE id = ?
    `).run(callDurationSeconds || null, req.params.id);
    await db.prepare("UPDATE care_sessions SET interview_status = 'completed' WHERE id = ?").run(interview.session_id);

    // System message
    if (interview.conversation_id) {
      await db.prepare(`
        INSERT INTO messages (id, sender_id, content, conversation_id, message_type, metadata)
        VALUES (?, ?, ?, ?, 'system', ?)
      `).run(uuid(), req.user.id, `✅ Interview completed! The appointment is all set.`, interview.conversation_id, JSON.stringify({
        type: 'interview_completed', interviewId: req.params.id,
      }));
    }

    // Notify both parties
    const emitToUser = req.app.get("emitToUser");
    const otherParty = req.user.id === interview.requested_by ? interview.requested_of : interview.requested_by;
    if (emitToUser) {
      emitToUser(otherParty, "interview_completed", { interviewId: req.params.id, sessionId: interview.session_id });
    }

    res.json({ interview: { ...interview, status: "completed" } });
  } catch (err) {
    console.error("Complete interview error:", err);
    res.status(500).json({ error: "Failed to complete interview" });
  }
});

// ─── PUT /api/interviews/:id/cancel ───
// Cancel an interview (either party can cancel up to 24h before session)
router.put("/:id/cancel", async (req, res) => {
  try {
    const db = await getDb();
    const interview = await db.prepare("SELECT * FROM interviews WHERE id = ?").get(req.params.id);
    if (!interview) return res.status(404).json({ error: "Interview not found" });
    if (interview.requested_by !== req.user.id && interview.requested_of !== req.user.id) {
      return res.status(403).json({ error: "Only interview participants can cancel" });
    }
    if (interview.status === "completed" || interview.status === "cancelled") {
      return res.status(400).json({ error: `Interview is already ${interview.status}` });
    }

    const { reason } = req.body;
    await db.prepare(`
      UPDATE interviews SET status = 'cancelled', cancelled_by = ?, cancel_reason = ?, updated_at = NOW()
      WHERE id = ?
    `).run(req.user.id, reason || null, req.params.id);
    await db.prepare(`
      UPDATE care_sessions SET interview_required = 0, interview_type = NULL, interview_status = NULL, updated_at = NOW()
      WHERE id = ?
    `).run(interview.session_id);

    // Notify the other party
    const emitToUser = req.app.get("emitToUser");
    const otherParty = req.user.id === interview.requested_by ? interview.requested_of : interview.requested_by;
    const canceller = await db.prepare("SELECT first_name FROM users WHERE id = ?").get(req.user.id);
    const cancellerName = canceller?.first_name || "Someone";

    if (emitToUser) {
      emitToUser(otherParty, "interview_cancelled", { interviewId: req.params.id, sessionId: interview.session_id });
    }
    sendPushToUser(otherParty, {
      title: "Interview cancelled",
      body: `${cancellerName} cancelled the interview. The appointment will continue without it.`,
      data: { type: "interview_cancelled", interviewId: req.params.id, sessionId: interview.session_id },
    }, "interview_cancelled").catch(() => {});

    if (interview.conversation_id) {
      await db.prepare(`
        INSERT INTO messages (id, sender_id, content, conversation_id, message_type, metadata)
        VALUES (?, ?, ?, ?, 'system', ?)
      `).run(uuid(), req.user.id, `🚫 ${cancellerName} cancelled the interview. The appointment will proceed without one.`, interview.conversation_id, JSON.stringify({
        type: 'interview_cancelled', interviewId: req.params.id,
      }));
    }

    res.json({ interview: { ...interview, status: "cancelled" } });
  } catch (err) {
    console.error("Cancel interview error:", err);
    res.status(500).json({ error: "Failed to cancel interview" });
  }
});

// ─── GET /api/interviews/session/:sessionId ───
// Get interview(s) for a specific session
router.get("/session/:sessionId", async (req, res) => {
  try {
    const db = await getDb();
    const interviews = await db.prepare(
      "SELECT * FROM interviews WHERE session_id = ? ORDER BY created_at DESC"
    ).all(req.params.sessionId);
    res.json({ interviews });
  } catch (err) {
    console.error("Get session interviews error:", err);
    res.status(500).json({ error: "Failed to fetch interviews" });
  }
});

// ─── GET /api/interviews/pending ───
// Get all pending interviews for the current user
router.get("/pending", async (req, res) => {
  try {
    const db = await getDb();
    const interviews = await db.prepare(`
      SELECT i.*, cs.scheduled_date, cs.scheduled_time, cs.service_type, cs.duration_hours,
        cr.first_name AS recipient_first_name, cr.last_name AS recipient_last_name,
        req_by.first_name AS requester_first_name, req_by.last_name AS requester_last_name,
        req_of.first_name AS requested_first_name, req_of.last_name AS requested_last_name
      FROM interviews i
      JOIN care_sessions cs ON i.session_id = cs.id
      LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
      LEFT JOIN users req_by ON i.requested_by = req_by.id
      LEFT JOIN users req_of ON i.requested_of = req_of.id
      WHERE (i.requested_by = ? OR i.requested_of = ?)
        AND i.status IN ('pending', 'accepted')
      ORDER BY cs.scheduled_date ASC
    `).all(req.user.id, req.user.id);
    res.json({ interviews });
  } catch (err) {
    console.error("Get pending interviews error:", err);
    res.status(500).json({ error: "Failed to fetch pending interviews" });
  }
});

module.exports = router;
