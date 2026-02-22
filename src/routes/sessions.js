const express = require("express");
const { v4: uuid } = require("uuid");
const { getDb } = require("../models/database");
const { authenticate, requireRole } = require("../middleware/auth");
const { validateSession } = require("../middleware/validate");
const availabilityRouter = require("./availability");
const { sendPushToUser, notifyAdmins } = require("./push");
const { calculateSessionCost, isShortNotice } = require("../utils/rateCalculator");

const router = express.Router();
router.use(authenticate);

// ─── GET /api/sessions ───
// List sessions for the current user (family or caregiver)
router.get("/", async (req, res) => {
  try {
  const db = await getDb();
  const { status, from, to, limit = 20 } = req.query;

  let query, params;

  const activeRole = req.user.activeRole || req.user.role;
  if (activeRole === "family") {
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
  } else if (activeRole === "care_for") {
    // Care recipient view — find their care_recipient record and show their sessions
    const recipient = await db.prepare(`
      SELECT cr.id FROM care_recipients cr
      JOIN users u ON LOWER(cr.first_name || ' ' || cr.last_name) = LOWER(u.first_name || ' ' || u.last_name)
      WHERE u.id = ?
      LIMIT 1
    `).get(req.user.id);
    if (!recipient) return res.status(404).json({ error: "Care recipient record not found" });

    query = `
      SELECT cs.*,
        cr.first_name || ' ' || cr.last_name AS recipient_name,
        u.first_name || ' ' || u.last_name AS caregiver_name
      FROM care_sessions cs
      LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
      LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
      LEFT JOIN users u ON cp.user_id = u.id
      WHERE cs.care_recipient_id = ?
    `;
    params = [recipient.id];
  } else {
    // Caregiver view — own sessions + ALL open care requests (assigned + nearby)
    const profile = await db.prepare("SELECT * FROM caregiver_profiles WHERE user_id = ?").get(req.user.id);
    if (!profile) return res.status(404).json({ error: "Caregiver profile not found" });

    query = `
      SELECT cs.*,
        cr.first_name || ' ' || cr.last_name AS recipient_name,
        cr.preferences AS recipient_preferences,
        cr.location_city AS recipient_city,
        cr.latitude AS recipient_lat,
        cr.longitude AS recipient_lng
      FROM care_sessions cs
      LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
      WHERE (
        cs.caregiver_id = ?
        OR (cs.status = 'requested' AND (
          cs.care_recipient_id IN (
            SELECT care_recipient_id FROM caregiver_assignments
            WHERE caregiver_profile_id = ? AND is_active = 1
          )
          OR cs.caregiver_id IS NULL
        ))
      )
    `;
    params = [profile.id, profile.id];
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

  let sessions = await db.prepare(query).all(...params);

  // For caregivers: also fetch ALL open care requests separately to ensure none are missed
  if (activeRole !== 'family' && activeRole !== 'care_for') {
    const openQuery = `
      SELECT cs.*,
        cr.first_name || ' ' || cr.last_name AS recipient_name,
        cr.preferences AS recipient_preferences,
        cr.location_city AS recipient_city,
        cr.latitude AS recipient_lat,
        cr.longitude AS recipient_lng
      FROM care_sessions cs
      LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
      WHERE cs.status = 'requested' AND cs.caregiver_id IS NULL
    `;
    let openParams = [];
    let openFilters = '';
    if (from) { openFilters += " AND cs.scheduled_date >= ?"; openParams.push(from); }
    if (to) { openFilters += " AND cs.scheduled_date <= ?"; openParams.push(to); }
    openFilters += " ORDER BY cs.scheduled_date ASC, cs.scheduled_time ASC LIMIT 50";
    const openSessions = await db.prepare(openQuery + openFilters).all(...openParams);
    // Merge: add any open requests not already in the result set
    const existingIds = new Set(sessions.map(s => s.id));
    for (const s of openSessions) {
      if (!existingIds.has(s.id)) sessions.push(s);
    }
  }

  res.json({ sessions });
  } catch (err) {
    console.error("GET /api/sessions error:", err.message, err.stack);
    res.status(500).json({ error: "Failed to fetch sessions", detail: err.message });
  }
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

// ─── POST /api/sessions/request — Care recipient creates a "help wanted" request ───
router.post("/request", async (req, res) => {
  const userRoles = req.user.roles || [req.user.role];
  if (!userRoles.includes("care_for")) {
    return res.status(403).json({ error: "Only care recipients can create care requests" });
  }

  const { serviceType, scheduledDate, scheduledTime, durationHours = 2, note, budgetMax } = req.body;
  if (!serviceType || !scheduledDate || !scheduledTime) {
    return res.status(400).json({ error: "Required: serviceType, scheduledDate, scheduledTime" });
  }

  const db = await getDb();

  // Find the care_recipient record linked to this user
  const recipient = await db.prepare(`
    SELECT cr.id, cr.family_user_id FROM care_recipients cr
    JOIN users u ON LOWER(cr.first_name || ' ' || cr.last_name) = LOWER(u.first_name || ' ' || u.last_name)
    WHERE u.id = ?
    LIMIT 1
  `).get(req.user.id);

  if (!recipient) return res.status(404).json({ error: "Care recipient record not found" });

  // Estimate cost using default service-type rates (no specific caregiver yet)
  const defaultRates = { meals: 30, rides: 28, companion: 25, full_day: 22 };
  const baseRate = defaultRates[serviceType] || 28;
  const shortNotice = isShortNotice(`${scheduledDate}T${scheduledTime}`);
  const costResult = calculateSessionCost(scheduledTime, null, { base: baseRate }, {
    scheduledDate,
    durationHours,
    shortNotice,
  });
  const estimatedCost = costResult.total;

  const id = uuid();
  await db.prepare(`
    INSERT INTO care_sessions
    (id, care_recipient_id, family_user_id, service_type, status,
     scheduled_date, scheduled_time, duration_hours,
     special_instructions, estimated_cost, short_notice_surcharge, rate_tier, budget_max)
    VALUES (?, ?, ?, ?, 'requested', ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, recipient.id, recipient.family_user_id, serviceType,
    scheduledDate, scheduledTime, durationHours,
    note || null, estimatedCost,
    costResult.surcharge || 0,
    JSON.stringify(costResult.tierBreakdown),
    budgetMax || null
  );

  const session = await db.prepare("SELECT * FROM care_sessions WHERE id = ?").get(id);

  // Notify assigned caregivers via WebSocket + push
  const emitToUser = req.app.get("emitToUser");
  const assignments = await db.prepare(
    "SELECT ca.caregiver_profile_id, cp.user_id FROM caregiver_assignments ca JOIN caregiver_profiles cp ON ca.caregiver_profile_id = cp.id WHERE ca.care_recipient_id = ? AND ca.is_active = 1"
  ).all(recipient.id);
  for (const a of assignments) {
    if (emitToUser) {
      emitToUser(a.user_id, "session_update", { sessionId: id, status: "requested", session });
    }
    sendPushToUser(a.user_id, {
      title: "New Care Request",
      body: `${serviceType} on ${scheduledDate} — tap to view`,
      data: { type: "care_request", sessionId: id },
    }, "care_request").catch(() => {});
  }

  // Admin notification for new care requests
  notifyAdmins("care_request_created", {
    title: "New Care Request",
    body: `${serviceType} for ${recipient.name || "a care recipient"} on ${scheduledDate}`,
    data: { type: "care_request_created", sessionId: id },
  });

  res.status(201).json({ session });
});

// ─── PUT /api/sessions/:id/claim — Caregiver claims a care request ───
router.put("/:id/claim", async (req, res) => {
  const claimRoles = req.user.roles || [req.user.role];
  if (!claimRoles.includes("caregiver")) {
    return res.status(403).json({ error: "Only caregivers can claim care requests" });
  }

  const db = await getDb();
  const profile = await db.prepare("SELECT id FROM caregiver_profiles WHERE user_id = ?").get(req.user.id);
  if (!profile) return res.status(404).json({ error: "Caregiver profile not found" });

  const session = await db.prepare("SELECT * FROM care_sessions WHERE id = ?").get(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });
  if (session.status !== "requested") {
    return res.status(400).json({ error: "This session is not available for claiming (status: " + session.status + ")" });
  }

  await db.prepare(`
    UPDATE care_sessions SET caregiver_id = ?, status = 'confirmed', updated_at = NOW() WHERE id = ?
  `).run(profile.id, req.params.id);

  const updated = await db.prepare(`
    SELECT cs.*, cr.first_name || ' ' || cr.last_name AS recipient_name
    FROM care_sessions cs
    LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
    WHERE cs.id = ?
  `).get(req.params.id);

  // Notify the family and care recipient via WebSocket + push
  const emitToUser = req.app.get("emitToUser");
  const caregiverName = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || 'A caregiver';

  if (session.family_user_id) {
    if (emitToUser) emitToUser(session.family_user_id, "session_update", { sessionId: req.params.id, status: "confirmed" });
    sendPushToUser(session.family_user_id, {
      title: "Care Request Accepted",
      body: `${caregiverName} accepted the ${session.service_type} session on ${session.scheduled_date}`,
      data: { type: "care_request_accepted", sessionId: req.params.id },
    }, "care_request_accepted").catch(() => {});
  }
  // Find care_for user to notify
  const careForUser = await db.prepare(`
    SELECT u.id FROM users u
    JOIN care_recipients cr ON LOWER(cr.first_name || ' ' || cr.last_name) = LOWER(u.first_name || ' ' || u.last_name)
    WHERE cr.id = ? AND u.role = 'care_for'
    LIMIT 1
  `).get(session.care_recipient_id);
  if (careForUser) {
    if (emitToUser) emitToUser(careForUser.id, "session_update", { sessionId: req.params.id, status: "confirmed" });
  }

  res.json({ session: updated });
});

// ─── POST /api/sessions ───
// Create a new care request (single or recurring)
router.post("/", requireRole("family"), validateSession, async (req, res) => {
  const {
    careRecipientId, serviceType, scheduledDate, scheduledTime,
    durationHours = 2, specialInstructions,
    recurrenceRule, recurrenceWeeks,
    status: requestedStatus,
    proposedRate,
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

  // Estimate cost using caregiver's tiered rates (or service-type defaults)
  let costRates = { base: 28 };
  if (bookCaregiverId) {
    const cgProfile = await db.prepare(
      "SELECT hourly_rate, rate_daytime, rate_nighttime, rate_overnight FROM caregiver_profiles WHERE id = ?"
    ).get(bookCaregiverId);
    if (cgProfile) {
      costRates = {
        daytime: cgProfile.rate_daytime || cgProfile.hourly_rate || 28,
        nighttime: cgProfile.rate_nighttime || cgProfile.hourly_rate || 28,
        overnight: cgProfile.rate_overnight || cgProfile.hourly_rate || 28,
        base: cgProfile.hourly_rate || 28,
      };
    }
  } else {
    const defaultRates = { meals: 30, rides: 28, companion: 25, full_day: 22 };
    costRates.base = defaultRates[serviceType] || 28;
  }
  const shortNotice = isShortNotice(`${scheduledDate}T${scheduledTime}`);
  const costResult = calculateSessionCost(scheduledTime, null, costRates, {
    scheduledDate,
    durationHours,
    shortNotice,
  });
  const estimatedCost = costResult.total;

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
    // If family proposed a rate, use it for estimated cost instead of caregiver's rate
    const finalCost = proposedRate && parseFloat(proposedRate) > 0
      ? parseFloat(proposedRate) * durationHours
      : estimatedCost;

    await db.prepare(`
      INSERT INTO care_sessions
      (id, care_recipient_id, family_user_id, service_type, status,
       scheduled_date, scheduled_time, duration_hours,
       special_instructions, estimated_cost, recurrence_rule, recurrence_group_id,
       short_notice_surcharge, rate_tier, proposed_rate)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, careRecipientId, req.user.id, serviceType, sessionStatus,
      sessionDate, scheduledTime, durationHours,
      specialInstructions || null, finalCost,
      isRecurring ? recurrenceRule : null,
      recurrenceGroupId,
      costResult.surcharge || 0,
      JSON.stringify(costResult.tierBreakdown),
      proposedRate ? parseFloat(proposedRate) : null
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

// ─── GET /api/sessions/cost-preview ───
// Calculate cost breakdown without creating a session (for live preview in booking UI)
router.get("/cost-preview", async (req, res) => {
  const { caregiverId, scheduledDate, scheduledTime, durationHours = 2 } = req.query;

  if (!scheduledDate || !scheduledTime) {
    return res.status(400).json({ error: "scheduledDate and scheduledTime are required" });
  }

  const db = await getDb();
  let costRates = { base: 28 };

  if (caregiverId) {
    const cgProfile = await db.prepare(
      "SELECT hourly_rate, rate_daytime, rate_nighttime, rate_overnight FROM caregiver_profiles WHERE id = ?"
    ).get(caregiverId);
    if (cgProfile) {
      costRates = {
        daytime: cgProfile.rate_daytime || cgProfile.hourly_rate || 28,
        nighttime: cgProfile.rate_nighttime || cgProfile.hourly_rate || 28,
        overnight: cgProfile.rate_overnight || cgProfile.hourly_rate || 28,
        base: cgProfile.hourly_rate || 28,
      };
    }
  }

  const shortNotice = isShortNotice(`${scheduledDate}T${scheduledTime}`);
  const costResult = calculateSessionCost(scheduledTime, null, costRates, {
    scheduledDate,
    durationHours: parseFloat(durationHours),
    shortNotice,
  });

  res.json({
    ...costResult,
    shortNotice,
    rates: costRates,
  });
});

// ─── PUT /api/sessions/:id/status ───
// Update session status (caregiver check-in, complete, cancel)
router.put("/:id/status", async (req, res) => {
  const { status } = req.body;
  const validTransitions = {
    open: ["pending", "confirmed", "cancelled", "negotiating"],
    requested: ["confirmed", "cancelled", "negotiating"],
    confirmed: ["in_progress", "cancelled"],
    in_progress: ["completed", "cancelled"],
    pending: ["confirmed", "cancelled", "negotiating"],
    matching: ["confirmed", "cancelled"],
    negotiating: ["confirmed", "cancelled", "open", "requested", "pending"],
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
