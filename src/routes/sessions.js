const express = require("express");
const { v4: uuid } = require("uuid");
const { getDb } = require("../models/database");
const { authenticate, requireRole } = require("../middleware/auth");
const { validateSession } = require("../middleware/validate");
const availabilityRouter = require("./availability");
const { sendPushToUser, notifyAdmins, sendSessionReminders } = require("./push");
const { calculateSessionCost, isShortNotice } = require("../utils/rateCalculator");
const { getNowInZone, getTodayStringInZone, buildDateTimeInZone } = require("../utils/timezone");

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
    // Include sessions for shared care recipients (care team access)
    const sharedRecipients = await db.prepare(`
      SELECT cr.id FROM care_recipient_shares crs
      JOIN care_recipients cr ON crs.care_recipient_id = cr.id
      WHERE crs.shared_with_user_id = ?
    `).all(req.user.id);
    const sharedIds = sharedRecipients.map(r => r.id);
    const allIds = sharedIds.length > 0 ? sharedIds.map(() => '?').join(',') : "'__none__'";
    query = `
      SELECT cs.*,
        cr.first_name || ' ' || cr.last_name AS recipient_name,
        u.first_name || ' ' || u.last_name AS caregiver_name,
        cp.rating_avg AS caregiver_rating
      FROM care_sessions cs
      LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
      LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
      LEFT JOIN users u ON cp.user_id = u.id
      WHERE (cs.family_user_id = ? OR cs.care_recipient_id IN (${allIds}))
    `;
    params = [req.user.id, ...sharedIds];
  } else if (activeRole === "care_for") {
    // Care recipient view — find their care_recipient record via linked_user_id (falls back to name match)
    const recipient = await db.prepare(`
      SELECT cr.id FROM care_recipients cr
      WHERE cr.linked_user_id = ?
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

    // Demo isolation: only show requests from families with matching demo status
    const me = await db.prepare("SELECT is_demo FROM users WHERE id = ?").get(req.user.id);
    const isDemo = me && me.is_demo ? 1 : 0;

    query = `
      SELECT cs.*,
        cr.first_name || ' ' || cr.last_name AS recipient_name,
        cr.preferences AS recipient_preferences,
        cr.location_city AS recipient_city,
        cr.location_state AS recipient_state,
        cr.location_zip AS recipient_zip,
        cr.latitude AS recipient_lat,
        cr.longitude AS recipient_lng
      FROM care_sessions cs
      LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
      LEFT JOIN users fu ON cs.family_user_id = fu.id
      WHERE (
        cs.caregiver_id = ?
        OR (cs.status IN ('requested', 'open', 'pending') AND (
          cs.care_recipient_id IN (
            SELECT care_recipient_id FROM caregiver_assignments
            WHERE caregiver_profile_id = ? AND is_active = 1
          )
          OR cs.caregiver_id IS NULL
        ))
      )
      AND COALESCE(fu.is_demo, 0) = ?
    `;
    params = [profile.id, profile.id, isDemo];
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
    // Demo isolation: match current user's demo status
    const meCheck = await db.prepare("SELECT is_demo FROM users WHERE id = ?").get(req.user.id);
    const isDemoCheck = meCheck && meCheck.is_demo ? 1 : 0;
    const openQuery = `
      SELECT cs.*,
        cr.first_name || ' ' || cr.last_name AS recipient_name,
        cr.preferences AS recipient_preferences,
        cr.location_city AS recipient_city,
        cr.location_state AS recipient_state,
        cr.location_zip AS recipient_zip,
        cr.latitude AS recipient_lat,
        cr.longitude AS recipient_lng
      FROM care_sessions cs
      LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
      LEFT JOIN users fu ON cs.family_user_id = fu.id
      WHERE cs.status IN ('requested', 'open', 'pending') AND cs.caregiver_id IS NULL
        AND COALESCE(fu.is_demo, 0) = ?
    `;
    let openParams = [isDemoCheck];
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

  // Add platform fee info: caregiver gets full rate, platform fee added on top for family
  const feePercent = await getPlatformFeePercent(db);
  sessions = sessions.map(s => {
    const estimatedCost = parseFloat(s.estimated_cost) || 0;
    // estimated_cost = subtotal + surcharge (total from rateCalculator)
    // Platform fee is on the base subtotal, charged on top to family
    const fee = Math.round(estimatedCost * (feePercent / 100) * 100) / 100;
    return {
      ...s,
      platform_fee_percent: feePercent,
      platform_fee: fee,
      caregiver_payout: estimatedCost, // caregiver gets the full amount
      family_total: Math.round((estimatedCost + fee) * 100) / 100,
    };
  });

  res.json({ sessions });
  } catch (err) {
    console.error("GET /api/sessions error:", err.message, err.stack);
    res.status(500).json({ error: "Failed to fetch sessions", detail: err.message });
  }
});

// ─── Helper: generate recurring dates ───
function generateRecurringDates(startDate, rule, weeks) {
  const dates = [];
  // Parse date safely without UTC offset issues
  const [y, mo, d] = startDate.split("-").map(Number);
  const start = new Date(y, mo - 1, d, 12, 0, 0);
  const interval = rule === "biweekly" ? 14 : 7; // weekly or biweekly

  for (let i = 0; i < weeks; i++) {
    const dt = new Date(start);
    dt.setDate(dt.getDate() + i * interval);
    const dateStr = dt.getFullYear() + "-" + String(dt.getMonth() + 1).padStart(2, "0") + "-" + String(dt.getDate()).padStart(2, "0");
    dates.push(dateStr);
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
    WHERE cr.linked_user_id = ?
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
  const profile = await db.prepare("SELECT id, background_check_paid, is_background_checked FROM caregiver_profiles WHERE user_id = ?").get(req.user.id);
  if (!profile) return res.status(404).json({ error: "Caregiver profile not found" });

  // Gate: must have completed background check payment OR been cleared by admin
  if (!profile.background_check_paid && !profile.is_background_checked) {
    return res.status(403).json({ error: "You must complete your background check payment before accepting care requests. Visit your dashboard to pay." });
  }

  const session = await db.prepare("SELECT * FROM care_sessions WHERE id = ?").get(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });
  if (!["requested", "open", "pending"].includes(session.status)) {
    return res.status(400).json({ error: "This session is not available for claiming (status: " + session.status + ")" });
  }

  // Guard exclusive offers: only the targeted caregiver can claim during the exclusivity window
  if (session.offered_to_caregiver_id && session.offer_expires_at) {
    const expiresAt = new Date(session.offer_expires_at);
    if (expiresAt > new Date() && session.offered_to_caregiver_id !== profile.id) {
      return res.status(403).json({ error: "This job is exclusively offered to another caregiver" });
    }
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

  // Notify family, care team, and care recipient via WebSocket + push
  const emitToUser = req.app.get("emitToUser");
  const caregiverFirst = req.user.firstName || '';
  const caregiverName = `${caregiverFirst} ${req.user.lastName || ''}`.trim() || 'A caregiver';
  const recipientName = updated.recipient_name || 'your loved one';

  // Build a friendly push body with "today" / "tomorrow" / date
  const sessionDateLabel = (() => {
    const today = getTodayStringInZone();
    const tomorrow = new Date(getNowInZone());
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomStr = tomorrow.getFullYear() + '-' + String(tomorrow.getMonth() + 1).padStart(2, '0') + '-' + String(tomorrow.getDate()).padStart(2, '0');
    if (session.scheduled_date === today) return 'today';
    if (session.scheduled_date === tomStr) return 'tomorrow';
    return `on ${session.scheduled_date}`;
  })();
  const pushTitle = 'Care Request Accepted!';
  const pushBody = `${caregiverName} has accepted a job for ${recipientName} ${sessionDateLabel}!`;
  const pushData = { type: 'care_request_accepted', sessionId: req.params.id, page: 'schedule' };

  // Notify the requesting family member
  if (session.family_user_id) {
    if (emitToUser) emitToUser(session.family_user_id, "session_update", { sessionId: req.params.id, status: "confirmed" });
    sendPushToUser(session.family_user_id, { title: pushTitle, body: pushBody, data: pushData }, "care_request_accepted").catch(() => {});
  }

  // Notify all care team members for this care recipient (siblings, etc.)
  try {
    const teamMembers = await db.prepare(`
      SELECT DISTINCT ctm.user_id FROM care_team_members ctm
      JOIN care_teams ct ON ctm.care_team_id = ct.id
      JOIN care_recipients cr ON ct.care_recipient_id = cr.id
      WHERE cr.id = ? AND ctm.user_id != ? AND ctm.status = 'active'
    `).all(session.care_recipient_id, session.family_user_id || '');
    for (const member of teamMembers) {
      if (emitToUser) emitToUser(member.user_id, "session_update", { sessionId: req.params.id, status: "confirmed" });
      sendPushToUser(member.user_id, { title: pushTitle, body: pushBody, data: pushData }, "care_request_accepted").catch(() => {});
    }
  } catch (teamErr) { console.error('Error notifying care team:', teamErr); }

  // Check if care recipient has a care address — if not, nudge the family to add one
  try {
    const careRecipient = await db.prepare(
      "SELECT id, first_name, location_address, location_city FROM care_recipients WHERE id = ?"
    ).get(session.care_recipient_id);
    if (careRecipient && !careRecipient.location_address && !careRecipient.location_city) {
      const addrMsg = `Please add a care address for ${careRecipient.first_name} so ${caregiverName} knows where to go for the visit ${sessionDateLabel}.`;
      const addrPush = {
        title: 'Care address needed',
        body: addrMsg,
        data: { type: 'missing_address', sessionId: req.params.id, page: 'recipients' },
      };
      // Notify requesting family member
      if (session.family_user_id) {
        sendPushToUser(session.family_user_id, addrPush, "missing_address").catch(() => {});
        if (emitToUser) emitToUser(session.family_user_id, "activity_update", { title: 'Care address needed', message: addrMsg });
      }
      // Also write to activity feed so it persists
      await db.prepare(`
        INSERT INTO activity_feed (id, family_user_id, care_recipient_id, event_type, title, message, metadata)
        VALUES (?, ?, ?, 'missing_address', 'Care address needed', ?, ?)
      `).run(uuid(), session.family_user_id, session.care_recipient_id, addrMsg, JSON.stringify({ sessionId: req.params.id }));
    }
  } catch (addrErr) { console.error('Error checking care address:', addrErr); }

  // Find care_for user to notify (via linked_user_id)
  const careForUser = await db.prepare(`
    SELECT cr.linked_user_id AS id FROM care_recipients cr
    WHERE cr.id = ? AND cr.linked_user_id IS NOT NULL
    LIMIT 1
  `).get(session.care_recipient_id);
  if (careForUser) {
    if (emitToUser) emitToUser(careForUser.id, "session_update", { sessionId: req.params.id, status: "confirmed" });
  }

  // Schedule pre-check-in reminders if session is today and within the notification window
  // All times are care-location times — compare in care timezone
  if (session.scheduled_date && session.scheduled_time) {
    const REMINDER_WINDOW = 15;
    const etNow = getNowInZone();
    const sessionStartET = buildDateTimeInZone(session.scheduled_date, session.scheduled_time);
    const reminderTime = new Date(sessionStartET.getTime() - REMINDER_WINDOW * 60000);
    if (etNow >= reminderTime && etNow <= sessionStartET) {
      // Session is within the notification window right now — send immediately
      sendSessionReminders(req.params.id, "pre_check_in").catch(() => {});
    }
    // Otherwise the background poller will pick it up when the time comes
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

  // Reject sessions scheduled less than 1 hour from now
  const sessionStartDt = new Date(`${scheduledDate}T${scheduledTime}:00`);
  const minsUntilSession = (sessionStartDt.getTime() - Date.now()) / (1000 * 60);
  if (minsUntilSession < 60) {
    return res.status(400).json({
      error: "Sessions must be scheduled at least 1 hour from now.",
      code: "TOO_SOON",
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
  const { caregiverId: bookCaregiverId, directOffer } = req.body;
  if (bookCaregiverId && !directOffer) {
    // Skip availability validation for direct offers (family knowingly sending to off-schedule caregiver)
    try {
      const [sy, smo, sd] = scheduledDate.split("-").map(Number);
      const schedDate = new Date(sy, smo - 1, sd, 12, 0, 0);
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
  let overnightMinHours = 6;
  if (bookCaregiverId) {
    const cgProfile = await db.prepare(
      "SELECT hourly_rate, rate_daytime, rate_nighttime, rate_overnight, min_overnight_hours FROM caregiver_profiles WHERE id = ?"
    ).get(bookCaregiverId);
    if (cgProfile) {
      costRates = {
        daytime: cgProfile.rate_daytime || cgProfile.hourly_rate || 28,
        nighttime: cgProfile.rate_nighttime || cgProfile.hourly_rate || 28,
        overnight: cgProfile.rate_overnight || cgProfile.hourly_rate || 28,
        base: cgProfile.hourly_rate || 28,
      };
      overnightMinHours = cgProfile.min_overnight_hours || 6;
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
    overnightMinHours,
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

  // Direct offer: assign caregiver + set 1-hour exclusivity window
  const isDirectOffer = directOffer && bookCaregiverId;
  const offerExpiresAt = isDirectOffer
    ? new Date(Date.now() + 60 * 60 * 1000).toISOString()
    : null;

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
       short_notice_surcharge, rate_tier, proposed_rate,
       caregiver_id, offered_to_caregiver_id, offer_expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, careRecipientId, req.user.id, serviceType, sessionStatus,
      sessionDate, scheduledTime, durationHours,
      specialInstructions || null, finalCost,
      isRecurring ? recurrenceRule : null,
      recurrenceGroupId,
      costResult.surcharge || 0,
      JSON.stringify(costResult.tierBreakdown),
      proposedRate ? parseFloat(proposedRate) : null,
      isDirectOffer ? bookCaregiverId : null,
      isDirectOffer ? bookCaregiverId : null,
      offerExpiresAt
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
  const booker = await db.prepare("SELECT first_name, last_name FROM users WHERE id = ?").get(req.user.id);
  const bookerName = booker ? `${booker.first_name} ${booker.last_name}` : "Someone";
  await db.prepare(`
    INSERT INTO activity_feed (id, family_user_id, care_recipient_id, event_type, title, message)
    VALUES (?, ?, ?, 'session_booked', ?, ?)
  `).run(
    uuid(), req.user.id, careRecipientId,
    `${serviceLabels[serviceType] || serviceType} requested by ${bookerName}${recurrenceLabel}`,
    isRecurring
      ? `${bookerName} booked recurring ${recurrenceRule} sessions starting ${scheduledDate} at ${scheduledTime} (${dates.length} sessions)`
      : `${bookerName} booked a session for ${scheduledDate} at ${scheduledTime}`
  );

  // Notify caregivers about new open/available jobs via WebSocket
  // Notify: all assigned caregivers for this care recipient + any nearby caregivers
  const emitToUser = req.app.get("emitToUser");
  if (emitToUser) {
    try {
      // Get all caregivers assigned to this family
      const assignedCgs = await db.prepare(`
        SELECT cp.user_id FROM caregiver_assignments ca
        JOIN caregiver_profiles cp ON ca.caregiver_profile_id = cp.id
        WHERE ca.family_user_id = ? AND ca.is_active = 1
      `).all(req.user.id);

      const rateLabel = proposedRate ? `$${proposedRate}/hr` : '';
      const surchargeLabel = costResult.surcharge > 0 ? ' (includes short-notice bonus)' : '';
      const timeLabel = scheduledTime ? (() => { const [h, m] = scheduledTime.split(':').map(Number); return `${h > 12 ? h - 12 : h || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; })() : '';
      const jobInfo = {
        sessionId: createdSessions[0],
        serviceType,
        scheduledDate,
        scheduledTime,
        durationHours,
        proposedRate: proposedRate ? parseFloat(proposedRate) : null,
        hasBonus: costResult.surcharge > 0,
      };

      if (isDirectOffer) {
        // Direct offer: notify only the targeted caregiver with exclusive_offer event
        const targetCg = await db.prepare(
          "SELECT user_id FROM caregiver_profiles WHERE id = ?"
        ).get(bookCaregiverId);
        if (targetCg) {
          emitToUser(targetCg.user_id, "exclusive_offer", {
            ...jobInfo,
            expiresAt: offerExpiresAt,
            familyName: bookerName,
          });
          sendPushToUser(targetCg.user_id, {
            title: `⭐ Exclusive offer for you — ${rateLabel || 'new job'}${surchargeLabel}`,
            body: `${bookerName} is offering you ${serviceType.replace(/_/g, ' ')} on ${scheduledDate} at ${timeLabel}. You have 1 hour to respond!`,
            data: { url: '/#caretaker', type: 'exclusive_offer' },
          }, 'new_job').catch(err => console.error('Push to caregiver error:', err));
        }
      } else {
        for (const cg of assignedCgs) {
          emitToUser(cg.user_id, "new_job", jobInfo);
        }

        // Push notification to assigned caregivers
        for (const cg of assignedCgs) {
          sendPushToUser(cg.user_id, {
            title: `New care request${rateLabel ? ' — ' + rateLabel + surchargeLabel : ''}`,
            body: `${serviceType.replace(/_/g, ' ')} on ${scheduledDate} at ${timeLabel} (${durationHours}hr)`,
            data: { url: '/#caretaker', type: 'new_job' },
          }, 'new_job').catch(err => console.error('Push to caregiver error:', err));
        }
      }
    } catch (err) {
      console.error("Job notification error (non-blocking):", err);
    }
  }

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
  const today = getTodayStringInZone();

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

// ─── Helper: get platform fee percent from DB (default 20) ───
async function getPlatformFeePercent(db) {
  try {
    const row = await db.prepare("SELECT value FROM platform_settings WHERE key = 'platform_fee_percent'").get();
    return row ? parseFloat(row.value) : 20;
  } catch { return 20; }
}

// ─── GET /api/sessions/cost-preview ───
// Calculate cost breakdown without creating a session (for live preview in booking UI)
// Returns caregiver payout + family total (with platform markup)
router.get("/cost-preview", async (req, res) => {
  const { caregiverId, scheduledDate, scheduledTime, durationHours = 2 } = req.query;

  if (!scheduledDate || !scheduledTime) {
    return res.status(400).json({ error: "scheduledDate and scheduledTime are required" });
  }

  const db = await getDb();
  let costRates = { base: 28 };
  let overnightMinHours = 6;

  if (caregiverId) {
    const cgProfile = await db.prepare(
      "SELECT hourly_rate, rate_daytime, rate_nighttime, rate_overnight, min_overnight_hours FROM caregiver_profiles WHERE id = ?"
    ).get(caregiverId);
    if (cgProfile) {
      costRates = {
        daytime: cgProfile.rate_daytime || cgProfile.hourly_rate || 28,
        nighttime: cgProfile.rate_nighttime || cgProfile.hourly_rate || 28,
        overnight: cgProfile.rate_overnight || cgProfile.hourly_rate || 28,
        base: cgProfile.hourly_rate || 28,
      };
      overnightMinHours = cgProfile.min_overnight_hours || 6;
    }
  }

  const shortNotice = isShortNotice(`${scheduledDate}T${scheduledTime}`);
  const costResult = calculateSessionCost(scheduledTime, null, costRates, {
    scheduledDate,
    durationHours: parseFloat(durationHours),
    shortNotice,
    overnightMinHours,
  });

  // Rush surcharge split: 75% to caregiver (incentive for short-notice), 25% to platform.
  // Platform fee = base percentage + platform's share of rush surcharge.
  // Family pays: caregiver payout + platform fee.
  const feePercent = await getPlatformFeePercent(db);
  const surchargeToCaregiver = costResult.surchargeBreakdown?.caregiver || 0;
  const surchargeToPlatform = costResult.surchargeBreakdown?.platform || 0;
  const caregiverPayout = Math.round((costResult.subtotal + surchargeToCaregiver) * 100) / 100;
  const platformFee = Math.round((costResult.subtotal * (feePercent / 100) + surchargeToPlatform) * 100) / 100;
  const familyTotal = Math.round((caregiverPayout + platformFee) * 100) / 100;

  res.json({
    ...costResult,
    shortNotice,
    rates: costRates,
    overnightMinHours,
    // Platform fee breakdown
    platformFeePercent: feePercent,
    platformFee,
    caregiverPayout,
    familyTotal,
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

// ─── POST /api/sessions/:id/check-in ───
// Caregiver checks in — creates visit_log, sets session to in_progress
// Timing gate: can only check in within 15 min of session start (or after start if late)
router.post("/:id/check-in", async (req, res) => {
  try {
    const db = await getDb();
    const { arrivalMood, checkInLatitude, checkInLongitude } = req.body;

    const session = await db.prepare(`
      SELECT cs.*, cp.user_id AS caregiver_user_id, cp.early_check_in_allowed,
        cr.first_name AS recipient_first_name, cr.last_name AS recipient_last_name
      FROM care_sessions cs
      LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
      LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
      WHERE cs.id = ?
    `).get(req.params.id);

    if (!session) return res.status(404).json({ error: "Session not found" });
    if (session.caregiver_user_id !== req.user.id) {
      return res.status(403).json({ error: "Only the assigned caregiver can check in" });
    }
    if (session.status !== "confirmed") {
      return res.status(400).json({ error: `Cannot check in — session status is '${session.status}'` });
    }

    // ─── Timing gate: 15 min before session start ───
    // Allow check-in after start time (late is fine), but block too-early check-ins
    // All times are care-location times — use centralized timezone utility
    const CHECK_IN_WINDOW_MINUTES = 15;
    if (session.scheduled_date && session.scheduled_time) {
      const dateStr = session.scheduled_date.split('T')[0];
      const nowET = getNowInZone();
      const sessionStartLocal = buildDateTimeInZone(dateStr, session.scheduled_time);
      const earliestCheckIn = new Date(sessionStartLocal.getTime() - CHECK_IN_WINDOW_MINUTES * 60000);

      if (nowET < earliestCheckIn && !session.early_check_in_allowed) {
        return res.status(400).json({
          error: "Check-in window not open yet",
          message: `You can check in starting ${CHECK_IN_WINDOW_MINUTES} minutes before your session at ${session.scheduled_time}`,
          checkInOpensAt: earliestCheckIn.toISOString(),
          sessionStartsAt: sessionStartLocal.toISOString(),
        });
      }
    }

    // Transition to in_progress
    await db.prepare(
      "UPDATE care_sessions SET status = 'in_progress', updated_at = NOW() WHERE id = ?"
    ).run(req.params.id);

    // Create visit_log with check-in data + location
    const visitId = require("uuid").v4();
    await db.prepare(`
      INSERT INTO visit_logs (id, session_id, caregiver_id, check_in_time, arrival_mood, check_in_latitude, check_in_longitude, created_at)
      VALUES (?, ?, ?, NOW(), ?, ?, ?, NOW())
    `).run(visitId, req.params.id, session.caregiver_id, arrivalMood || null, checkInLatitude || null, checkInLongitude || null);

    // Get special instructions and recent notes for the caregiver
    const notes = await db.prepare(
      "SELECT content, created_at FROM recipient_notes WHERE care_recipient_id = ? ORDER BY created_at DESC LIMIT 5"
    ).all(session.care_recipient_id);

    // Notify family that session has started
    const emitToUser = req.app.get("emitToUser");
    const caregiverUser = await db.prepare("SELECT first_name, last_name FROM users WHERE id = ?").get(req.user.id);
    const caregiverName = caregiverUser ? `${caregiverUser.first_name} ${caregiverUser.last_name}` : "Your caregiver";

    // Activity feed entry
    await db.prepare(
      "INSERT INTO activity_feed (id, family_user_id, care_recipient_id, event_type, title, message, metadata) VALUES (?, ?, ?, 'session_checkin', ?, ?, ?)"
    ).run(
      require("uuid").v4(),
      session.family_user_id,
      session.care_recipient_id,
      `${caregiverName} has checked in`,
      `Care session with ${session.recipient_first_name} has started. ${arrivalMood ? `Mood on arrival: ${arrivalMood}` : ""}`,
      JSON.stringify({ sessionId: req.params.id })
    );

    if (emitToUser) {
      emitToUser(session.family_user_id, "session_update", {
        sessionId: req.params.id,
        status: "in_progress",
        checkIn: true,
        arrivalMood,
      });
      emitToUser(session.family_user_id, "activity_update", {});
    }

    res.json({
      visitLog: {
        id: visitId,
        checkInTime: new Date().toISOString(),
        arrivalMood,
        checkInLatitude: checkInLatitude || null,
        checkInLongitude: checkInLongitude || null,
      },
      specialInstructions: session.special_instructions,
      recentNotes: notes,
    });
  } catch (err) {
    console.error("Check-in error:", err);
    res.status(500).json({ error: "Failed to check in" });
  }
});

// ─── POST /api/sessions/:id/check-out ───
// Caregiver checks out — updates visit_log, sets session to completed
router.post("/:id/check-out", async (req, res) => {
  try {
    const db = await getDb();
    const { departureMood, conditionTags, careFeedback, serviceFeedback, summary } = req.body;

    const session = await db.prepare(`
      SELECT cs.*, cp.user_id AS caregiver_user_id,
        cr.first_name AS recipient_first_name, cr.last_name AS recipient_last_name
      FROM care_sessions cs
      LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
      LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
      WHERE cs.id = ?
    `).get(req.params.id);

    if (!session) return res.status(404).json({ error: "Session not found" });
    if (session.caregiver_user_id !== req.user.id) {
      return res.status(403).json({ error: "Only the assigned caregiver can check out" });
    }
    if (session.status !== "in_progress") {
      return res.status(400).json({ error: `Cannot check out — session status is '${session.status}'` });
    }

    // Calculate actual duration and adjust pay if checked out early
    const visitLog = await db.prepare(
      "SELECT * FROM visit_logs WHERE session_id = ? ORDER BY created_at DESC LIMIT 1"
    ).get(req.params.id);

    let actualDurationHours = parseFloat(session.duration_hours) || 2;
    let adjustedCost = parseFloat(session.estimated_cost) || 0;
    const scheduledDuration = parseFloat(session.duration_hours) || 2;

    if (visitLog && visitLog.check_in_time) {
      const checkInTime = new Date(visitLog.check_in_time);
      const checkOutTime = new Date(); // now
      const actualMinutes = Math.max(0, (checkOutTime - checkInTime) / 60000);
      const scheduledMinutes = scheduledDuration * 60;

      // If within 15 min of scheduled end → full pay
      if (actualMinutes >= (scheduledMinutes - 15)) {
        actualDurationHours = scheduledDuration;
        adjustedCost = parseFloat(session.estimated_cost) || 0;
      } else {
        // Round UP to nearest 15-min increment
        const roundedMinutes = Math.ceil(actualMinutes / 15) * 15;
        actualDurationHours = Math.round(roundedMinutes / 60 * 100) / 100;
        // Pro-rate the pay: (actual hours / scheduled hours) × estimated_cost
        if (scheduledDuration > 0) {
          adjustedCost = Math.round((actualDurationHours / scheduledDuration) * parseFloat(session.estimated_cost || 0) * 100) / 100;
        }
      }
    }

    // Transition to completed with adjusted cost and actual duration
    await db.prepare(
      "UPDATE care_sessions SET status = 'completed', estimated_cost = ?, duration_hours = ?, updated_at = NOW() WHERE id = ?"
    ).run(adjustedCost, actualDurationHours, req.params.id);

    if (visitLog) {
      await db.prepare(`
        UPDATE visit_logs SET
          check_out_time = NOW(),
          departure_mood = ?,
          condition_tags = ?,
          care_feedback = ?,
          service_feedback = ?,
          summary = ?,
          mood_rating = ?
        WHERE id = ?
      `).run(
        departureMood || null,
        conditionTags ? JSON.stringify(conditionTags) : null,
        careFeedback || null,
        serviceFeedback || null,
        summary || null,
        departureMood || null,
        visitLog.id
      );
    }

    // Notify family
    const emitToUser = req.app.get("emitToUser");
    const caregiverUser = await db.prepare("SELECT first_name, last_name FROM users WHERE id = ?").get(req.user.id);
    const caregiverName = caregiverUser ? `${caregiverUser.first_name} ${caregiverUser.last_name}` : "Your caregiver";

    // Build condition summary
    const tagSummary = conditionTags && conditionTags.length > 0
      ? ` Noted: ${conditionTags.join(", ")}.`
      : "";

    await db.prepare(
      "INSERT INTO activity_feed (id, family_user_id, care_recipient_id, event_type, title, message, metadata) VALUES (?, ?, ?, 'session_checkout', ?, ?, ?)"
    ).run(
      require("uuid").v4(),
      session.family_user_id,
      session.care_recipient_id,
      `${caregiverName} has checked out`,
      `Care session with ${session.recipient_first_name} is complete. ${departureMood ? `Mood at departure: ${departureMood}.` : ""}${tagSummary}`,
      JSON.stringify({ sessionId: req.params.id })
    );

    if (emitToUser) {
      emitToUser(session.family_user_id, "session_update", {
        sessionId: req.params.id,
        status: "completed",
        checkOut: true,
        departureMood,
        conditionTags,
      });
      emitToUser(session.family_user_id, "activity_update", {});
    }

    res.json({
      session: { id: req.params.id, status: "completed", actualDurationHours: actualDurationHours, adjustedCost: adjustedCost },
      visitLog: visitLog ? { id: visitLog.id } : null,
    });
  } catch (err) {
    console.error("Check-out error:", err);
    res.status(500).json({ error: "Failed to check out" });
  }
});

// ─── PUT /api/sessions/:id/cancel ───
// Cancel a confirmed/pending session with late-cancel tracking
router.put("/:id/cancel", async (req, res) => {
  try {
    const db = await getDb();
    const { reason } = req.body;
    const userId = req.user.id;
    const activeRole = req.user.activeRole || req.user.role;

    const session = await db.prepare(`
      SELECT cs.*, cp.user_id AS caregiver_user_id
      FROM care_sessions cs
      LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
      WHERE cs.id = ?
    `).get(req.params.id);

    if (!session) return res.status(404).json({ error: "Session not found" });

    // Only confirmed/pending/open/requested sessions can be cancelled
    const cancellableStatuses = ["confirmed", "pending", "open", "requested", "in_progress"];
    if (!cancellableStatuses.includes(session.status)) {
      return res.status(400).json({ error: `Cannot cancel a session with status '${session.status}'` });
    }

    // Determine who is cancelling
    let cancelledBy;
    if (activeRole === "caregiver" || userId === session.caregiver_user_id) {
      cancelledBy = "caregiver";
    } else if (userId === session.family_user_id) {
      cancelledBy = "family";
    } else {
      return res.status(403).json({ error: "You are not authorized to cancel this session" });
    }

    // Check if this is a late cancellation (<24 hours before session)
    // No caregiver assigned = always free cancel (no one to compensate)
    const sessionDateTime = buildDateTimeInZone(session.scheduled_date.split("T")[0], session.scheduled_time || "00:00");
    const hoursUntilSession = (sessionDateTime - getNowInZone()) / (1000 * 60 * 60);
    const hasCaregiver = !!session.caregiver_id;
    const isLateCancel = hasCaregiver && hoursUntilSession < 24;

    if (cancelledBy === "caregiver") {
      // Caregiver drops the job — revert to open so other caregivers can claim it
      // Store cancelled_caregiver_id so family can still review them for late cancel
      await db.prepare(`
        UPDATE care_sessions
        SET status = 'open',
            cancelled_caregiver_id = caregiver_id,
            caregiver_id = NULL,
            cancellation_reason = ?,
            cancelled_by = ?,
            cancelled_at = NOW(),
            late_cancel = ?,
            updated_at = NOW()
        WHERE id = ?
      `).run(reason || null, cancelledBy, isLateCancel ? 1 : 0, req.params.id);
    } else {
      // Family cancels — session is fully cancelled
      await db.prepare(`
        UPDATE care_sessions
        SET status = 'cancelled',
            cancellation_reason = ?,
            cancelled_by = ?,
            cancelled_at = NOW(),
            late_cancel = ?,
            updated_at = NOW()
        WHERE id = ?
      `).run(reason || null, cancelledBy, isLateCancel ? 1 : 0, req.params.id);
    }

    const updated = await db.prepare("SELECT * FROM care_sessions WHERE id = ?").get(req.params.id);

    // Activity feed entry — use the actual person's name
    const canceller = await db.prepare("SELECT first_name, last_name FROM users WHERE id = ?").get(req.user.id);
    const cancellerName = canceller ? `${canceller.first_name} ${canceller.last_name}` : (cancelledBy === "caregiver" ? "Caregiver" : "Family member");
    await db.prepare(
      "INSERT INTO activity_feed (id, family_user_id, event_type, title, message) VALUES (?, ?, 'session_cancelled', ?, ?)"
    ).run(
      uuid(),
      session.family_user_id,
      `Session Cancelled by ${cancellerName}`,
      `${session.service_type} session on ${session.scheduled_date} was cancelled by ${cancellerName}${isLateCancel ? " (late cancellation)" : ""}.${reason ? " Reason: " + reason : ""}`
    );

    // Notify the other party via WebSocket
    const emitToUser = req.app.get("emitToUser");
    if (emitToUser) {
      const notifyUserId = cancelledBy === "caregiver" ? session.family_user_id : session.caregiver_user_id;
      if (notifyUserId) {
        emitToUser(notifyUserId, "session_update", {
          sessionId: req.params.id,
          status: updated.status,
          cancelledBy,
          isLateCancel,
          canReview: cancelledBy === "caregiver" && isLateCancel,
        });
      }
    }

    res.json({
      session: updated,
      cancelledBy,
      isLateCancel,
      hasCaregiver,
      // Family can review caregiver if caregiver late-cancelled
      canReview: cancelledBy === "caregiver" && isLateCancel,
      cancelledCaregiverId: cancelledBy === "caregiver" ? session.caregiver_id : null,
      // Family still owes payment if they late-cancelled (only if caregiver was assigned)
      chargeApplies: cancelledBy === "family" && isLateCancel,
    });
  } catch (err) {
    console.error("Cancel session error:", err);
    res.status(500).json({ error: "Failed to cancel session" });
  }
});

// ─── POST /api/sessions/:id/review ───
// Submit a review for a session (completion or late-cancel)
router.post("/:id/review", async (req, res) => {
  try {
    const db = await getDb();
    const userId = req.user.id;
    const { rating, comment } = req.body;

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: "Rating must be 1-5" });
    }

    const session = await db.prepare("SELECT * FROM care_sessions WHERE id = ?").get(req.params.id);
    if (!session) return res.status(404).json({ error: "Session not found" });

    // Only the family user can review
    if (userId !== session.family_user_id) {
      return res.status(403).json({ error: "Only the family can leave a review" });
    }

    // Determine review type and caregiver to review
    let reviewType = "completion";
    let caregiverId = session.caregiver_id;

    if (session.cancelled_by === "caregiver" && session.late_cancel && session.cancelled_caregiver_id) {
      reviewType = "late_cancellation";
      caregiverId = session.cancelled_caregiver_id;
    } else if (session.status !== "completed") {
      return res.status(400).json({ error: "Can only review completed sessions or late-cancelled sessions" });
    }

    if (!caregiverId) {
      return res.status(400).json({ error: "No caregiver associated with this session" });
    }

    // Check for duplicate review
    const existing = await db.prepare(
      "SELECT id FROM reviews WHERE session_id = ? AND family_user_id = ?"
    ).get(req.params.id, userId);
    if (existing) return res.status(409).json({ error: "You already reviewed this session" });

    const reviewId = uuid();
    await db.prepare(
      "INSERT INTO reviews (id, session_id, family_user_id, caregiver_id, rating, comment, review_type) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(reviewId, req.params.id, userId, caregiverId, rating, comment || null, reviewType);

    // Update caregiver average rating
    const stats = await db.prepare(
      "SELECT AVG(rating) AS avg_rating, COUNT(*) AS count FROM reviews WHERE caregiver_id = ?"
    ).get(caregiverId);
    await db.prepare(
      "UPDATE caregiver_profiles SET rating_avg = ?, rating_count = ? WHERE id = ?"
    ).run(Math.round(stats.avg_rating * 10) / 10, stats.count, caregiverId);

    res.json({ review: { id: reviewId, rating, comment, reviewType } });
  } catch (err) {
    console.error("Review error:", err);
    res.status(500).json({ error: "Failed to submit review" });
  }
});

// ─── GET /api/sessions/:id ───
router.get("/:id", async (req, res) => {
  const db = await getDb();
  const session = await db.prepare(`
    SELECT cs.*,
      cr.first_name || ' ' || cr.last_name AS recipient_name,
      cr.location_address, cr.location_city, cr.location_state,
      u.first_name || ' ' || u.last_name AS caregiver_name,
      cp.rating_avg, cp.specialties AS caregiver_specialties,
      cp.hourly_rate, cp.rate_daytime, cp.rate_nighttime, cp.rate_overnight,
      bu.first_name || ' ' || bu.last_name AS booked_by_name
    FROM care_sessions cs
    LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
    LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
    LEFT JOIN users u ON cp.user_id = u.id
    LEFT JOIN users bu ON cs.family_user_id = bu.id
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

  // Cost breakdown — use stored surcharge (not re-calculated from current time)
  let costBreakdown = null;
  if (session.scheduled_date && session.scheduled_time) {
    const rates = {
      daytime: session.rate_daytime || session.hourly_rate || 28,
      nighttime: session.rate_nighttime || session.hourly_rate || 28,
      overnight: session.rate_overnight || session.hourly_rate || 28,
      base: session.hourly_rate || 28,
    };
    // Use the stored surcharge to determine if session was short-notice at booking time
    const storedSurcharge = parseFloat(session.short_notice_surcharge) || 0;
    const shortNotice = storedSurcharge > 0;
    costBreakdown = calculateSessionCost(session.scheduled_time, null, rates, {
      scheduledDate: session.scheduled_date,
      durationHours: parseFloat(session.duration_hours || 2),
      shortNotice,
    });
    costBreakdown.shortNotice = shortNotice;

    // 75/25 split: caregiver gets subtotal + 75% of surcharge
    const feePercent = await getPlatformFeePercent(db);
    const surchargeToCaregiver = Math.round((costBreakdown.surcharge || 0) * 0.75 * 100) / 100;
    costBreakdown.caregiverPayout = Math.round((costBreakdown.subtotal + surchargeToCaregiver) * 100) / 100;
    costBreakdown.caregiverSurchargeShare = surchargeToCaregiver;
    costBreakdown.platformFeePercent = feePercent;
    // Family sees: InPlace fee = 20% of subtotal (surcharge split is internal)
    costBreakdown.platformFee = Math.round(costBreakdown.subtotal * (feePercent / 100) * 100) / 100;
    costBreakdown.familyTotal = Math.round((costBreakdown.total + costBreakdown.platformFee) * 100) / 100;
  }

  res.json({ session, visitLog, photos, costBreakdown });
});

module.exports = router;
