const express = require("express");
const { v4: uuid } = require("uuid");
const { getDb } = require("../models/database");
const { authenticate, requireRole } = require("../middleware/auth");
const { validateSession } = require("../middleware/validate");
const availabilityRouter = require("./availability");

const router = express.Router();
router.use(authenticate);

// ─── GET /api/sessions ───
// List sessions for the current user (family or caregiver)
router.get("/", async (req, res) => {
  const db = await getDb();
  const { status, from, to, limit = 20 } = req.query;

  let query, params;

  if (req.user.role === "family") {
    query = `
      SELECT cs.*,
        cr.first_name || ' ' || cr.last_name AS recipient_name,
        u.first_name || ' ' || u.last_name AS caregiver_name,
        cp.rating_avg AS caregiver_rating
      FROM care_sessions cs
      LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
      LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
      LEFT JOIN users u ON cp.user_id = u.id
      WHERE cs.family_user_id = ?
    `;
    params = [req.user.id];
  } else {
    // Caregiver view
    const profile = await db.prepare("SELECT id FROM caregiver_profiles WHERE user_id = ?").get(req.user.id);
    if (!profile) return res.status(404).json({ error: "Caregiver profile not found" });

    query = `
      SELECT cs.*,
        cr.first_name || ' ' || cr.last_name AS recipient_name,
        cr.preferences AS recipient_preferences
      FROM care_sessions cs
      LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
      WHERE cs.caregiver_id = ?
    `;
    params = [profile.id];
  }

  if (status) {
    query += " AND cs.status = ?";
    params.push(status);
  }
  if (from) {
    query += " AND cs.scheduled_date >= ?";
    params.push(from);
  }
  if (to) {
    query += " AND cs.scheduled_date <= ?";
    params.push(to);
  }

  query += " ORDER BY cs.scheduled_date ASC, cs.scheduled_time ASC LIMIT ?";
  params.push(parseInt(limit));

  const sessions = await db.prepare(query).all(...params);
  res.json({ sessions });
});

// ─── Helper: generate recurring dates ───
function generateRecurringDates(startDate, rule, weeks) {
  const dates = [];
  const start = new Date(startDate + "T12:00:00");
  const interval = rule === "biweekly" ? 14 : 7; // weekly or biweekly

  for (let i = 0; i < weeks; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i * interval);
    dates.push(d.toISOString().split("T")[0]);
  }
  return dates;
}

// ─── POST /api/sessions ───
// Create a new care request (single or recurring)
router.post("/", requireRole("family"), validateSession, async (req, res) => {
  const {
    careRecipientId, serviceType, scheduledDate, scheduledTime,
    durationHours = 2, specialInstructions,
    recurrenceRule, recurrenceWeeks,
    status: requestedStatus,
  } = req.body;

  if (!careRecipientId || !serviceType || !scheduledDate || !scheduledTime) {
    return res.status(400).json({
      error: "Required: careRecipientId, serviceType, scheduledDate, scheduledTime",
    });
  }

  const db = await getDb();

  // Verify the care recipient belongs to this family
  const recipient = await db.prepare(
    "SELECT * FROM care_recipients WHERE id = ? AND family_user_id = ?"
  ).get(careRecipientId, req.user.id);

  if (!recipient) {
    return res.status(404).json({ error: "Care recipient not found" });
  }

  // Validate caregiver availability if a caregiver is specified (via matching or direct booking)
  const { caregiverId: bookCaregiverId } = req.body;
  if (bookCaregiverId) {
    try {
      const schedDate = new Date(scheduledDate + "T12:00:00");
      const dayOfWeek = schedDate.getDay();
      const slots = await availabilityRouter.computeAvailableSlots(db, bookCaregiverId, scheduledDate, dayOfWeek);

      if (slots.length > 0) {
        // Parse scheduled time to minutes for comparison
        const [sh, sm] = scheduledTime.split(":").map(Number);
        const requestedStart = sh * 60 + (sm || 0);
        const requestedEnd = requestedStart + (durationHours * 60);

        // Check if the entire requested window fits within available slots
        const coversRequest = (() => {
          for (let m = requestedStart; m < requestedEnd; m++) {
            const minuteCovered = slots.some(s => s.startMinutes <= m && (s.startMinutes + 60) > m);
            if (!minuteCovered) return false;
          }
          return true;
        })();

        if (!coversRequest) {
          return res.status(400).json({
            error: "Caregiver is not available for the full requested time window",
            availableSlots: slots.map(s => ({ start: s.start, end: s.end })),
          });
        }
      }
      // If no slots at all and availability rules exist, caregiver is not working that day
      // But if NO availability rules exist at all, we skip validation (new/unconfigured caregiver)
      const hasRules = await db.prepare(
        "SELECT COUNT(*) as count FROM availability WHERE caregiver_id = ?"
      ).get(bookCaregiverId);
      if (parseInt(hasRules.count) > 0 && slots.length === 0) {
        return res.status(400).json({
          error: "Caregiver is not available on this date",
        });
      }
    } catch (err) {
      console.error("Availability validation error (non-blocking):", err);
      // Non-blocking: if validation fails, allow the booking to proceed
    }
  }

  // Estimate cost based on service type and duration
  const rates = { meals: 30, rides: 28, companion: 25, full_day: 22 };
  const baseRate = rates[serviceType] || 28;
  const estimatedCost = baseRate * durationHours;

  // Determine dates to create
  const validRules = ["weekly", "biweekly"];
  const isRecurring = recurrenceRule && validRules.includes(recurrenceRule);
  const weeks = Math.min(Math.max(parseInt(recurrenceWeeks) || 4, 2), 12);
  const dates = isRecurring
    ? generateRecurringDates(scheduledDate, recurrenceRule, weeks)
    : [scheduledDate];

  // Allow 'open' status for care requests without caregiver
  const sessionStatus = requestedStatus === "open" ? "open" : "pending";

  const recurrenceGroupId = isRecurring ? uuid() : null;
  const createdSessions = [];

  for (const sessionDate of dates) {
    const id = uuid();
    await db.prepare(`
      INSERT INTO care_sessions
      (id, care_recipient_id, family_user_id, service_type, status,
       scheduled_date, scheduled_time, duration_hours,
       special_instructions, estimated_cost, recurrence_rule, recurrence_group_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, careRecipientId, req.user.id, serviceType, sessionStatus,
      sessionDate, scheduledTime, durationHours,
      specialInstructions || null, estimatedCost,
      isRecurring ? recurrenceRule : null,
      recurrenceGroupId
    );
    createdSessions.push(id);
  }

  // Create activity feed entry
  const serviceLabels = {
    meals: "Meals & Groceries",
    rides: "Rides & Errands",
    companion: "Companionship",
    companionship: "Companionship",
    personal_care: "Personal Care",
    housekeeping: "Light Housekeeping",
    meal_prep: "Meal Preparation",
    transportation: "Transportation",
    health_wellness: "Health & Wellness",
    full_day: "Full Day Care",
  };

  const recurrenceLabel = isRecurring ? ` (${recurrenceRule}, ${dates.length} sessions)` : "";
  await db.prepare(`
    INSERT INTO activity_feed (id, family_user_id, care_recipient_id, event_type, title, message)
    VALUES (?, ?, ?, 'session_booked', ?, ?)
  `).run(
    uuid(), req.user.id, careRecipientId,
    `${serviceLabels[serviceType] || serviceType} requested${recurrenceLabel}`,
    isRecurring
      ? `Recurring ${recurrenceRule} sessions booked starting ${scheduledDate} at ${scheduledTime} (${dates.length} sessions)`
      : `Session booked for ${scheduledDate} at ${scheduledTime}`
  );

  // Return first session for single bookings, all for recurring
  if (isRecurring) {
    const sessions = [];
    for (const sid of createdSessions) {
      const s = await db.prepare("SELECT * FROM care_sessions WHERE id = ?").get(sid);
      sessions.push(s);
    }
    res.status(201).json({ sessions, recurrenceGroupId, count: sessions.length });
  } else {
    const session = await db.prepare("SELECT * FROM care_sessions WHERE id = ?").get(createdSessions[0]);
    res.status(201).json({ session });
  }
});

// ─── DELETE /api/sessions/recurring/:groupId ───
// Cancel all future sessions in a recurring group
router.delete("/recurring/:groupId", requireRole("family"), async (req, res) => {
  const db = await getDb();
  const today = new Date().toISOString().split("T")[0];

  // Only cancel future pending/confirmed sessions in this group belonging to this user
  const result = await db.prepare(`
    UPDATE care_sessions
    SET status = 'cancelled', cancellation_reason = 'Recurring series cancelled', updated_at = NOW()
    WHERE recurrence_group_id = ?
      AND family_user_id = ?
      AND scheduled_date >= ?
      AND status IN ('pending', 'confirmed')
  `).run(req.params.groupId, req.user.id, today);

  res.json({ cancelled: result.changes, recurrenceGroupId: req.params.groupId });
});

// ─── POST /api/sessions/:id/match ───
// Match a caregiver to a pending session
router.post("/:id/match", requireRole("family", "admin"), async (req, res) => {
  const db = await getDb();
  const session = await db.prepare(
    "SELECT * FROM care_sessions WHERE id = ? AND family_user_id = ?"
  ).get(req.params.id, req.user.id);

  if (!session) return res.status(404).json({ error: "Session not found" });
  if (session.status !== "pending") {
    return res.status(400).json({ error: "Session is not in pending status" });
  }

  // Find available caregivers
  // In production: use location, specialties, ratings, availability windows
  const recipient = await db.prepare("SELECT * FROM care_recipients WHERE id = ?").get(session.care_recipient_id);

  const caregivers = await db.prepare(`
    SELECT cp.*, u.first_name, u.last_name
    FROM caregiver_profiles cp
    JOIN users u ON cp.user_id = u.id
    WHERE cp.is_available = 1 AND cp.is_background_checked = 1
    ORDER BY cp.rating_avg DESC, cp.years_experience DESC
    LIMIT 5
  `).all();

  if (caregivers.length === 0) {
    return res.status(404).json({ error: "No available caregivers found" });
  }

  // Auto-match to top caregiver (in production: smarter matching algorithm)
  const { caregiverId } = req.body;
  const matched = caregiverId
    ? caregivers.find((c) => c.id === caregiverId) || caregivers[0]
    : caregivers[0];

  await db.prepare(`
    UPDATE care_sessions
    SET caregiver_id = ?, status = 'confirmed', updated_at = NOW()
    WHERE id = ?
  `).run(matched.id, req.params.id);

  // Activity feed
  await db.prepare(`
    INSERT INTO activity_feed (id, family_user_id, care_recipient_id, event_type, title, message)
    VALUES (?, ?, ?, 'session_confirmed', ?, ?)
  `).run(
    uuid(), req.user.id, session.care_recipient_id,
    `Caregiver matched: ${matched.first_name} ${matched.last_name}`,
    `${matched.first_name} will arrive on ${session.scheduled_date} at ${session.scheduled_time}`
  );

  const updatedSession = await db.prepare("SELECT * FROM care_sessions WHERE id = ?").get(req.params.id);
  res.json({
    session: updatedSession,
    caregiver: {
      id: matched.id,
      name: `${matched.first_name} ${matched.last_name}`,
      rating: matched.rating_avg,
      specialties: JSON.parse(matched.specialties || "[]"),
      hourlyRate: matched.hourly_rate,
    },
    availableCaregivers: caregivers.map((c) => ({
      id: c.id,
      name: `${c.first_name} ${c.last_name}`,
      rating: c.rating_avg,
      specialties: JSON.parse(c.specialties || "[]"),
      hourlyRate: c.hourly_rate,
    })),
  });
});

// ─── PUT /api/sessions/:id/status ───
// Update session status (caregiver check-in, complete, cancel)
router.put("/:id/status", async (req, res) => {
  const { status } = req.body;
  const validTransitions = {
    open: ["pending", "confirmed", "cancelled"],
    confirmed: ["in_progress", "cancelled"],
    in_progress: ["completed", "cancelled"],
    pending: ["confirmed", "cancelled"],
    matching: ["confirmed", "cancelled"],
  };

  const db = await getDb();
  const session = await db.prepare("SELECT * FROM care_sessions WHERE id = ?").get(req.params.id);

  if (!session) return res.status(404).json({ error: "Session not found" });

  const allowed = validTransitions[session.status];
  if (!allowed || !allowed.includes(status)) {
    return res.status(400).json({
      error: `Cannot transition from '${session.status}' to '${status}'`,
    });
  }

  await db.prepare(
    "UPDATE care_sessions SET status = ?, updated_at = NOW() WHERE id = ?"
  ).run(status, req.params.id);

  const updated = await db.prepare("SELECT * FROM care_sessions WHERE id = ?").get(req.params.id);

  // Real-time: notify family user of session status change
  const emitToUser = req.app.get("emitToUser");
  if (emitToUser) {
    emitToUser(session.family_user_id, "session_update", {
      sessionId: req.params.id,
      status,
    });
  }

  res.json({ session: updated });
});

// ─── GET /api/sessions/:id ───
router.get("/:id", async (req, res) => {
  const db = await getDb();
  const session = await db.prepare(`
    SELECT cs.*,
      cr.first_name || ' ' || cr.last_name AS recipient_name,
      u.first_name || ' ' || u.last_name AS caregiver_name,
      cp.rating_avg, cp.specialties AS caregiver_specialties
    FROM care_sessions cs
    LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
    LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
    LEFT JOIN users u ON cp.user_id = u.id
    WHERE cs.id = ?
  `).get(req.params.id);

  if (!session) return res.status(404).json({ error: "Session not found" });

  // Get visit log if exists
  const visitLog = await db.prepare(
    "SELECT * FROM visit_logs WHERE session_id = ?"
  ).get(req.params.id);

  const photos = visitLog
    ? await db.prepare("SELECT * FROM visit_photos WHERE visit_log_id = ?").all(visitLog.id)
    : [];

  res.json({ session, visitLog, photos });
});

module.exports = router;
