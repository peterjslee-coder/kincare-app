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
        OR (cs.status IN ('requested', 'open', 'pending') AND cs.care_recipient_id IN (
          SELECT care_recipient_id FROM caregiver_assignments
          WHERE caregiver_profile_id = ? AND is_active = 1
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

  // Open care requests are shown in Find Work view, not in the calendar sessions list

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
    console.error("Sessions fetch error:", err.message); res.status(500).json({ error: "Failed to fetch sessions" });
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

  // ─── Consent gate: block booking if consent not verified ───
  const crFull = await db.prepare("SELECT consent_status, authorization_tier, permission_tier FROM care_recipients WHERE id = ?").get(recipient.id);
  if (crFull && crFull.consent_status && crFull.consent_status !== 'verified') {
    return res.status(403).json({
      error: 'Care authorization must be verified before booking',
      consentStatus: crFull.consent_status,
      authorizationTier: crFull.authorization_tier,
    });
  }

  // ─── Permission tier gate: block managed users, flag collaborative ───
  const permTier = crFull?.permission_tier || 'full';
  if (permTier === 'managed') {
    return res.status(403).json({
      error: 'Your account is managed by your care team. Contact them to request care.',
      permissionTier: 'managed',
    });
  }

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
  const profile = await db.prepare("SELECT id, background_check_paid, is_background_checked, care_stoplight, care_preferences FROM caregiver_profiles WHERE user_id = ?").get(req.user.id);
  if (!profile) return res.status(404).json({ error: "Caregiver profile not found" });

  // Gate: must have completed background check payment OR been cleared by admin
  if (!profile.background_check_paid && !profile.is_background_checked) {
    return res.status(403).json({ error: "You must complete your background check payment before accepting care requests. Visit your dashboard to pay." });
  }

  // Gate: must have set care preferences (stoplight)
  if (!profile.care_stoplight && !profile.care_preferences) {
    return res.status(403).json({ error: "Please set your care preferences before accepting jobs. Go to Account → Care Preferences." });
  }

  const session = await db.prepare("SELECT * FROM care_sessions WHERE id = ?").get(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });
  if (!["requested", "open", "pending"].includes(session.status)) {
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

  // Verify the care recipient belongs to this family (direct owner, shared, or care team)
  let recipient = await db.prepare(
    "SELECT * FROM care_recipients WHERE id = ? AND family_user_id = ?"
  ).get(careRecipientId, req.user.id);

  if (!recipient) {
    // Check care_recipient_shares
    const shared = await db.prepare(
      "SELECT care_recipient_id FROM care_recipient_shares WHERE care_recipient_id = ? AND shared_with_user_id = ?"
    ).get(careRecipientId, req.user.id);
    if (shared) {
      recipient = await db.prepare("SELECT * FROM care_recipients WHERE id = ?").get(careRecipientId);
    }
    // Check care team membership
    if (!recipient) {
      const teamMember = await db.prepare(`
        SELECT cr.* FROM care_recipients cr
        JOIN care_teams ct ON ct.care_recipient_id = cr.id
        JOIN care_team_members ctm ON ctm.care_team_id = ct.id
        WHERE cr.id = ? AND ctm.user_id = ? AND ctm.status = 'active'
      `).get(careRecipientId, req.user.id);
      if (teamMember) recipient = teamMember;
    }
  }

  if (!recipient) {
    return res.status(404).json({ error: "Care recipient not found" });
  }

  // ─── Consent gate: block booking if consent not verified ───
  // NOTE: This is a pre-check for immediate UI feedback. The actual enforcement
  // happens inside the transaction below (SELECT ... FOR UPDATE) to prevent
  // race conditions where consent is revoked between check and insert.
  if (recipient.consent_status && recipient.consent_status !== 'verified') {
    return res.status(403).json({
      error: 'Care authorization must be verified before booking',
      consentStatus: recipient.consent_status,
      authorizationTier: recipient.authorization_tier,
      message: recipient.authorization_tier === 'tier2'
        ? 'Please upload your POA or guardianship documents for review.'
        : 'Please complete the consent verification process.',
    });
  }

  // Validate caregiver availability if a caregiver is specified (via matching or direct booking)
  const { caregiverId: bookCaregiverId, directOffer } = req.body;
  if (bookCaregiverId && !directOffer) {
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

  const recurrenceGroupId = isRecurring ? uuid() : null;
  const createdSessions = [];

  // ─── Transaction: re-check consent under row lock, then insert sessions ───
  try { await db.transaction(async (tx) => {
    // Lock the care_recipients row to prevent concurrent consent changes
    const lockedRecipient = await tx.prepare(
      "SELECT consent_status, authorization_tier FROM care_recipients WHERE id = ? FOR UPDATE"
    ).get(careRecipientId);

    if (lockedRecipient?.consent_status && lockedRecipient.consent_status !== 'verified') {
      throw Object.assign(new Error('Consent revoked during booking'), { status: 403, userMessage: 'Care authorization is no longer verified. Please re-verify consent.' });
    }

    for (const sessionDate of dates) {
      const id = uuid();
      const finalCost = proposedRate && parseFloat(proposedRate) > 0
        ? parseFloat(proposedRate) * durationHours
        : estimatedCost;

      const isExclusive = directOffer && bookCaregiverId;
      await tx.prepare(`
        INSERT INTO care_sessions
        (id, care_recipient_id, family_user_id, service_type, status,
         scheduled_date, scheduled_time, duration_hours,
         special_instructions, estimated_cost, recurrence_rule, recurrence_group_id,
         short_notice_surcharge, rate_tier, proposed_rate, offered_to_caregiver_id,
         exclusive_until)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${isExclusive ? "NOW() + INTERVAL '1 hour'" : 'NULL'})
      `).run(
        id, careRecipientId, req.user.id, serviceType, sessionStatus,
        sessionDate, scheduledTime, durationHours,
        specialInstructions || null, finalCost,
        isRecurring ? recurrenceRule : null,
        recurrenceGroupId,
        costResult.surcharge || 0,
        JSON.stringify(costResult.tierBreakdown),
        proposedRate ? parseFloat(proposedRate) : null,
        isExclusive ? bookCaregiverId : null
      );
      createdSessions.push(id);
    }
  }); } catch (txErr) {
    if (txErr.status === 403) {
      return res.status(403).json({ error: txErr.userMessage || txErr.message });
    }
    throw txErr; // re-throw unexpected errors
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
      const jobInfo = {
        sessionId: createdSessions[0],
        serviceType,
        scheduledDate,
        scheduledTime,
        durationHours,
        proposedRate: proposedRate ? parseFloat(proposedRate) : null,
        hasBonus: costResult.surcharge > 0,
      };

      for (const cg of assignedCgs) {
        emitToUser(cg.user_id, "new_job", jobInfo);
      }

      // Push notification to assigned caregivers
      const timeLabel = scheduledTime ? (() => { const [h, m] = scheduledTime.split(':').map(Number); return `${h > 12 ? h - 12 : h || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; })() : '';
      for (const cg of assignedCgs) {
        sendPushToUser(cg.user_id, {
          title: `New care request${rateLabel ? ' — ' + rateLabel + surchargeLabel : ''}`,
          body: `${serviceType.replace(/_/g, ' ')} on ${scheduledDate} at ${timeLabel} (${durationHours}hr)`,
          data: { url: '/#caretaker', type: 'new_job' },
        }, 'new_job').catch(err => console.error('Push to caregiver error:', err));
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

// ─── GET /api/sessions/:id/care-briefing ───
// Returns a care briefing for the caregiver, tailored by experience level.
// Experienced caregivers get a short, focused reminder. New caregivers get the full briefing.
router.get("/:id/care-briefing", async (req, res) => {
  try {
    const db = await getDb();
    const session = await db.prepare(`
      SELECT cs.*, cp.user_id AS caregiver_user_id,
        cr.first_name AS recipient_first_name, cr.last_name AS recipient_last_name,
        cr.age, cr.health_conditions, cr.medications, cr.preferences,
        cr.caregiver_briefing, cr.food_allergies, cr.pets,
        cr.care_preferences, cr.care_preference_details
      FROM care_sessions cs
      LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
      LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
      WHERE cs.id = ?
    `).get(req.params.id);

    if (!session) return res.status(404).json({ error: "Session not found" });
    // Only the assigned caregiver can see the briefing
    if (session.caregiver_user_id !== req.user.id) {
      return res.status(403).json({ error: "Not authorized" });
    }

    const recipientName = session.recipient_first_name || "the care recipient";

    // Count completed visits this caregiver has done with this care recipient
    const visitHistory = await db.prepare(`
      SELECT COUNT(*) as visit_count,
        MAX(cs.scheduled_date) as last_visit_date
      FROM care_sessions cs
      JOIN visit_logs vl ON vl.session_id = cs.id
      WHERE cs.caregiver_id = ? AND cs.care_recipient_id = ? AND cs.status = 'completed'
    `).get(session.caregiver_id, session.care_recipient_id);

    const visitCount = visitHistory?.visit_count || 0;
    const isExperienced = visitCount >= 3;

    // Recent care notes (last 5)
    const recentNotes = await db.prepare(`
      SELECT content, created_at FROM recipient_notes
      WHERE care_recipient_id = ?
      ORDER BY created_at DESC LIMIT 5
    `).all(session.care_recipient_id);

    // Recent visit moods (last 5 visits by any caregiver) — pattern data
    const recentMoods = await db.prepare(`
      SELECT vl.arrival_mood, vl.departure_mood, cs.scheduled_time, cs.service_type,
        u.first_name AS caregiver_first_name
      FROM visit_logs vl
      JOIN care_sessions cs ON vl.session_id = cs.id
      LEFT JOIN caregiver_profiles cp2 ON cs.caregiver_id = cp2.id
      LEFT JOIN users u ON cp2.user_id = u.id
      WHERE cs.care_recipient_id = ? AND cs.status = 'completed'
      ORDER BY cs.scheduled_date DESC LIMIT 5
    `).all(session.care_recipient_id);

    // Parse health conditions
    let healthConditions = [];
    try { healthConditions = JSON.parse(session.health_conditions || '[]'); } catch { healthConditions = []; }
    let medications = [];
    try { medications = JSON.parse(session.medications || '[]'); } catch { medications = []; }

    // Service type label
    const serviceLabels = {
      meals: "Meals & Groceries", rides: "Rides & Errands", companion: "Companionship",
      companionship: "Companionship", personal_care: "Personal Care",
      housekeeping: "Housekeeping", full_day: "Full Day Care",
    };
    const serviceLabel = serviceLabels[session.service_type] || session.service_type;

    // Build the briefing
    const briefing = {
      recipientName,
      recipientAge: session.age,
      sessionServiceType: serviceLabel,
      sessionTime: session.scheduled_time,
      sessionDate: session.scheduled_date,
      specialInstructions: session.special_instructions,
      isExperienced,
      visitCount,
      lastVisitDate: visitHistory?.last_visit_date,
      caregiverBriefing: session.caregiver_briefing || null,
      healthConditions,
      medications,
      foodAllergies: session.food_allergies || null,
      pets: session.pets || null,
      preferences: session.preferences || null,
      recentNotes: recentNotes.map(n => ({ content: n.content, createdAt: n.created_at })),
      recentMoods: recentMoods.map(m => ({
        arrivalMood: m.arrival_mood,
        departureMood: m.departure_mood,
        time: m.scheduled_time,
        serviceType: m.service_type,
        caregiverName: m.caregiver_first_name,
      })),
    };

    res.json(briefing);
  } catch (err) {
    console.error("Care briefing error:", err);
    res.status(500).json({ error: "Failed to load care briefing" });
  }
});

// ─── POST /api/sessions/:id/check-in ───
// Caregiver checks in — creates visit_log, sets session to in_progress
// Timing gate: can only check in within 15 min of session start (or after start if late)
router.post("/:id/check-in", async (req, res) => {
  try {
    const db = await getDb();
    const { arrivalMood, checkInLatitude, checkInLongitude, briefingAcknowledged } = req.body;

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

    // ─── Detect late check-in (10+ minutes after scheduled start) ───
    let lateCheckIn = false;
    let lateMinutes = 0;
    if (session.scheduled_date && session.scheduled_time) {
      try {
        const scheduledStart = new Date(`${session.scheduled_date}T${session.scheduled_time.padStart(5, "0")}:00`);
        lateMinutes = Math.floor((new Date() - scheduledStart) / 60000);
        if (lateMinutes >= 10) {
          lateCheckIn = true;
          console.log(`[check-in] Late by ${lateMinutes} min — session ${req.params.id.slice(0, 8)}`);
        }
      } catch {}
    }

    // Transition to in_progress (with late check-in flag if applicable)
    await db.prepare(
      "UPDATE care_sessions SET status = 'in_progress', late_check_in = ?, late_minutes = ?, updated_at = NOW() WHERE id = ?"
    ).run(lateCheckIn ? 1 : 0, lateCheckIn ? lateMinutes : null, req.params.id);

    // Create visit_log with check-in data + location
    const visitId = require("uuid").v4();
    await db.prepare(`
      INSERT INTO visit_logs (id, session_id, caregiver_id, check_in_time, arrival_mood, check_in_latitude, check_in_longitude, briefing_acknowledged_at, created_at)
      VALUES (?, ?, ?, NOW(), ?, ?, ?, ${briefingAcknowledged ? 'NOW()' : 'NULL'}, NOW())
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
        lateCheckIn,
        lateMinutes: lateCheckIn ? lateMinutes : undefined,
      });
      emitToUser(session.family_user_id, "activity_update", {});

      // If late, send a separate event so the family can choose extend/truncate
      if (lateCheckIn) {
        emitToUser(session.family_user_id, "late_check_in", {
          sessionId: req.params.id,
          lateMinutes,
          caregiverName,
          message: `${caregiverName} checked in ${lateMinutes} minutes late. Would you like to extend the session or keep the original end time?`,
        });
      }
    }

    // Push notification to family if late
    if (lateCheckIn) {
      try {
        const sendPush = req.app.get("sendPush");
        if (sendPush) {
          await sendPush(session.family_user_id, {
            title: `${caregiverName} Checked In Late`,
            body: `${lateMinutes} minutes late. Open InPlace to choose: extend session or keep original end time.`,
            data: { type: "late_check_in", sessionId: req.params.id },
          });
        }
      } catch {}
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
      lateCheckIn,
      lateMinutes: lateCheckIn ? lateMinutes : undefined,
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

    // Transition to completed with adjusted cost, actual duration, and mark review required
    await db.prepare(
      "UPDATE care_sessions SET status = 'completed', estimated_cost = ?, duration_hours = ?, review_required = 1, updated_at = NOW() WHERE id = ?"
    ).run(adjustedCost, actualDurationHours, req.params.id);

    // ─── Capture payment (Stripe auth → charge) ───
    // If payment was pre-authorized, capture the appropriate amount now
    try {
      const { captureSessionPayment } = require("./accountability");
      const captureAmountCents = Math.round(adjustedCost * 100);
      if (captureAmountCents > 0) {
        const captureResult = await captureSessionPayment(req.params.id, captureAmountCents);
        if (captureResult.error) {
          console.warn(`[checkout] Payment capture skipped: ${captureResult.error}`);
        }
      }
    } catch (captureErr) {
      // Non-blocking — don't fail checkout if capture fails
      console.error("[checkout] Payment capture error (non-blocking):", captureErr.message);
    }

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

    // ─── Auto-create care note from checkout summary ───
    // Bridge visit_logs → recipient_notes so checkout observations appear in Care Profile
    if (summary && summary.trim() && session.care_recipient_id) {
      try {
        await db.prepare(`
          INSERT INTO recipient_notes (id, care_recipient_id, author_id, content, note_type)
          VALUES (?, ?, ?, ?, 'visit_summary')
        `).run(require("uuid").v4(), session.care_recipient_id, req.user.id, summary.trim());
      } catch (noteErr) {
        console.warn("[checkout] Auto-note creation failed (non-blocking):", noteErr.message);
      }
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
      (() => {
        const d = new Date(session.scheduled_date + 'T12:00:00');
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const friendlyDate = `${months[d.getMonth()]} ${d.getDate()}`;
        const svcLabel = (session.service_type || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        return `${svcLabel} session on ${friendlyDate} was cancelled by ${cancellerName}${isLateCancel ? " (late cancellation)" : ""}`;
      })()
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

    if (session.caregiver_no_show) {
      reviewType = "no_show";
      caregiverId = session.caregiver_id;
    } else if (session.cancelled_by === "caregiver" && session.late_cancel && session.cancelled_caregiver_id) {
      reviewType = "late_cancellation";
      caregiverId = session.cancelled_caregiver_id;
    } else if (session.status !== "completed") {
      return res.status(400).json({ error: "Can only review completed sessions, no-shows, or late-cancelled sessions" });
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
    const adminStatus = rating < 3 ? 'flagged' : 'ok';
    await db.prepare(
      "INSERT INTO reviews (id, session_id, family_user_id, caregiver_id, rating, comment, review_type, admin_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(reviewId, req.params.id, userId, caregiverId, rating, comment || null, reviewType, adminStatus);

    // Update caregiver average rating
    const stats = await db.prepare(
      "SELECT AVG(rating) AS avg_rating, COUNT(*) AS count FROM reviews WHERE caregiver_id = ?"
    ).get(caregiverId);
    await db.prepare(
      "UPDATE caregiver_profiles SET rating_avg = ?, rating_count = ? WHERE id = ?"
    ).run(Math.round(stats.avg_rating * 10) / 10, stats.count, caregiverId);

    // Mark review as completed on the session (clears review gating)
    await db.prepare(
      "UPDATE care_sessions SET review_completed = 1 WHERE id = ?"
    ).run(req.params.id);

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

// ═══════════════════════════════════════════════════════════════════════
// First-Visit Confirmation — caregiver confirms care recipient awareness
// ═══════════════════════════════════════════════════════════════════════

// ─── GET /api/sessions/:sessionId/first-visit-check ───
// Returns whether this caregiver needs to complete a first-visit confirmation
router.get("/:sessionId/first-visit-check", async (req, res) => {
  try {
    const db = await getDb();
    const session = await db.prepare(`
      SELECT cs.*, cp.id AS caregiver_profile_id, cp.user_id AS caregiver_user_id
      FROM care_sessions cs
      LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
      WHERE cs.id = ?
    `).get(req.params.sessionId);

    if (!session) return res.status(404).json({ error: "Session not found" });
    if (session.caregiver_user_id !== req.user.id) {
      return res.status(403).json({ error: "Only the assigned caregiver can access this" });
    }

    // Check if there's already a first_visit_confirmations row for this caregiver + care_recipient pair
    const existing = await db.prepare(
      "SELECT id FROM first_visit_confirmations WHERE caregiver_id = ? AND care_recipient_id = ?"
    ).get(session.caregiver_profile_id, session.care_recipient_id);

    // Get care recipient name for the UI
    const recipient = await db.prepare(
      "SELECT first_name, last_name FROM care_recipients WHERE id = ?"
    ).get(session.care_recipient_id);

    res.json({
      needsConfirmation: !existing,
      recipientName: recipient ? `${recipient.first_name} ${recipient.last_name}`.trim() : 'the care recipient',
    });
  } catch (err) {
    console.error("First-visit check error:", err);
    res.status(500).json({ error: "Failed to check first-visit status" });
  }
});

// ─── POST /api/sessions/:sessionId/first-visit-confirm ───
// Submit first-visit confirmation (does NOT block check-in)
router.post("/:sessionId/first-visit-confirm", async (req, res) => {
  try {
    const { confirmation, notes } = req.body;

    const validConfirmations = ['yes', 'no', 'unable'];
    if (!confirmation || !validConfirmations.includes(confirmation)) {
      return res.status(400).json({ error: "Confirmation must be 'yes', 'no', or 'unable'" });
    }

    const db = await getDb();
    const session = await db.prepare(`
      SELECT cs.*, cp.id AS caregiver_profile_id, cp.user_id AS caregiver_user_id
      FROM care_sessions cs
      LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
      WHERE cs.id = ?
    `).get(req.params.sessionId);

    if (!session) return res.status(404).json({ error: "Session not found" });
    if (session.caregiver_user_id !== req.user.id) {
      return res.status(403).json({ error: "Only the assigned caregiver can submit this" });
    }

    // Check if already submitted (idempotent on retry / network glitch)
    const existing = await db.prepare(
      "SELECT id, confirmation FROM first_visit_confirmations WHERE session_id = ?"
    ).get(req.params.sessionId);

    if (existing) {
      return res.json({ success: true, confirmation: existing.confirmation, alreadySubmitted: true });
    }

    const id = require("uuid").v4();
    await db.prepare(`
      INSERT INTO first_visit_confirmations (id, care_recipient_id, caregiver_id, session_id, confirmation, notes)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (session_id) DO NOTHING
    `).run(id, session.care_recipient_id, session.caregiver_profile_id, req.params.sessionId, confirmation, notes || null);

    // If 'no' or 'unable', notify the family AND admin, pause future bookings
    if (confirmation !== 'yes') {
      const caregiverUser = await db.prepare("SELECT first_name, last_name FROM users WHERE id = ?").get(req.user.id);
      const caregiverName = caregiverUser ? `${caregiverUser.first_name} ${caregiverUser.last_name}` : "Caregiver";
      const recipient = await db.prepare("SELECT first_name, last_name FROM care_recipients WHERE id = ?").get(session.care_recipient_id);
      const recipientName = recipient ? `${recipient.first_name} ${recipient.last_name}`.trim() : "Care recipient";

      const title = confirmation === 'no'
        ? `${recipientName} may not be aware of care visit`
        : `${caregiverName} unable to assess ${recipientName}'s awareness`;
      const message = confirmation === 'no'
        ? `${caregiverName} reported that ${recipientName} seems unaware of today's care visit.${notes ? ' Note: ' + notes : ''}`
        : `${caregiverName} was unable to assess whether ${recipientName} is aware of today's care visit.${notes ? ' Note: ' + notes : ''}`;

      // BLOCKING: Pause future bookings for this care recipient until resolved
      try {
        const pauseReason = confirmation === 'no'
          ? `Caregiver reported care recipient seems unaware of visit (${new Date().toLocaleDateString()})`
          : `Caregiver unable to assess care recipient awareness (${new Date().toLocaleDateString()})`;
        await db.prepare(`
          UPDATE care_recipients SET bookings_paused = 1, bookings_paused_reason = ?, updated_at = NOW()
          WHERE id = ? AND COALESCE(bookings_paused, 0) = 0
        `).run(pauseReason, session.care_recipient_id);
      } catch (pauseErr) {
        console.error("Bookings pause error:", pauseErr.message);
      }

      // Notify family
      try {
        await db.prepare(`
          INSERT INTO activity_feed (id, family_user_id, care_recipient_id, event_type, title, message, metadata)
          VALUES (?, ?, ?, 'first_visit_concern', ?, ?, ?)
        `).run(require("uuid").v4(), session.family_user_id, session.care_recipient_id, title, message, JSON.stringify({ sessionId: req.params.sessionId, confirmation }));

        const emitToUser = req.app.get("emitToUser");
        if (emitToUser) emitToUser(session.family_user_id, "activity_update", { title, message });
      } catch (notifErr) {
        console.error("First-visit notification error:", notifErr.message);
      }

      // Notify admin (Pete) — urgent
      try {
        const adminUsers = await db.prepare("SELECT id FROM users WHERE is_admin = 1").all();
        const adminTitle = `First-visit concern: ${recipientName}`;
        const adminMsg = `${caregiverName} reported a concern during first visit with ${recipientName}: ${confirmation === 'no' ? 'recipient seems unaware' : 'unable to assess awareness'}. Future bookings have been paused.${notes ? ' Caregiver notes: ' + notes : ''}`;
        for (const admin of adminUsers) {
          await db.prepare(`
            INSERT INTO activity_feed (id, family_user_id, event_type, title, message, metadata, created_at)
            VALUES (?, ?, 'first_visit_concern_admin', ?, ?, ?, NOW())
          `).run(require("uuid").v4(), admin.id, adminTitle, adminMsg,
            JSON.stringify({ sessionId: req.params.sessionId, recipientId: session.care_recipient_id, confirmation, caregiverNotes: notes }));
        }
      } catch (adminErr) {
        console.error("First-visit admin notification error:", adminErr.message);
      }
    }

    res.json({ success: true, confirmation });
  } catch (err) {
    console.error("First-visit confirm error:", err);
    res.status(500).json({ error: "Failed to submit first-visit confirmation" });
  }
});

// ─── POST /api/sessions/:id/propose-time ───
// Caregiver proposes a different time for an open session (counter-offer)
router.post("/:id/propose-time", async (req, res) => {
  try {
    const db = await getDb();
    const { proposedDate, proposedTime, message } = req.body;
    const userId = req.user.id;
    const activeRole = req.user.activeRole || req.user.role;
    const rawRoles = req.user.roles || activeRole || "";
    const roles = Array.isArray(rawRoles) ? rawRoles : String(rawRoles).split(",").map(r => r.trim());

    if (!roles.includes("caregiver")) {
      return res.status(403).json({ error: "Only caregivers can propose times" });
    }
    if (!proposedDate || !proposedTime) {
      return res.status(400).json({ error: "Proposed date and time are required" });
    }

    const profile = await db.prepare("SELECT * FROM caregiver_profiles WHERE user_id = ?").get(userId);
    if (!profile) return res.status(404).json({ error: "Caregiver profile not found" });

    const session = await db.prepare(`
      SELECT cs.*, cr.first_name AS recipient_first_name
      FROM care_sessions cs
      LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
      WHERE cs.id = ?
    `).get(req.params.id);

    if (!session) return res.status(404).json({ error: "Session not found" });
    if (!["open", "requested", "pending"].includes(session.status)) {
      return res.status(400).json({ error: "This session is no longer available for proposals" });
    }

    // Check if this caregiver already has a pending proposal for this session
    const existing = await db.prepare(
      "SELECT id FROM time_proposals WHERE session_id = ? AND caregiver_user_id = ? AND status = 'pending'"
    ).get(req.params.id, userId);
    if (existing) {
      return res.status(400).json({ error: "You already have a pending proposal for this session" });
    }

    const proposalId = require("uuid").v4();
    await db.prepare(`
      INSERT INTO time_proposals (id, session_id, caregiver_profile_id, caregiver_user_id, proposed_date, proposed_time, message, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
    `).run(proposalId, req.params.id, profile.id, userId, proposedDate, proposedTime, message || null);

    // Notify family
    const emitToUser = req.app.get("emitToUser");
    const sendPushToUser = req.app.get("sendPushToUser");
    const caregiverUser = await db.prepare("SELECT first_name, last_name FROM users WHERE id = ?").get(userId);
    const caregiverName = caregiverUser ? `${caregiverUser.first_name} ${caregiverUser.last_name}` : "A caregiver";

    // Format the proposed time for display
    const [h, m] = proposedTime.split(":");
    const hour = parseInt(h);
    const ampm = hour >= 12 ? "PM" : "AM";
    const hour12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
    const timeStr = `${hour12}:${m} ${ampm}`;

    const title = `${caregiverName} proposed a different time`;
    const body = `${caregiverName} would like to care for ${session.recipient_first_name} on ${proposedDate} at ${timeStr} instead. Tap to review.`;

    await db.prepare(
      "INSERT INTO activity_feed (id, family_user_id, care_recipient_id, event_type, title, message, metadata) VALUES (?, ?, ?, 'time_proposal', ?, ?, ?)"
    ).run(require("uuid").v4(), session.family_user_id, session.care_recipient_id, title, body,
      JSON.stringify({ proposalId, sessionId: req.params.id, caregiverName, proposedDate, proposedTime: timeStr }));

    if (emitToUser) {
      emitToUser(session.family_user_id, "time_proposal", { proposalId, sessionId: req.params.id, caregiverName, proposedDate, proposedTime: timeStr });
      emitToUser(session.family_user_id, "activity_update", {});
    }
    if (sendPushToUser) {
      sendPushToUser(session.family_user_id, { title, body, data: { type: "time_proposal", sessionId: req.params.id } }, "time_proposal").catch(() => {});
    }

    res.json({ proposal: { id: proposalId, status: "pending" } });
  } catch (err) {
    console.error("Propose-time error:", err);
    res.status(500).json({ error: "Failed to submit time proposal" });
  }
});

// ─── PUT /api/sessions/:id/proposals/:proposalId/accept ───
// Family accepts a caregiver's time proposal → confirms session with new time + that caregiver
router.put("/:id/proposals/:proposalId/accept", async (req, res) => {
  try {
    const db = await getDb();
    const userId = req.user.id;

    const proposal = await db.prepare(`
      SELECT tp.*, cs.family_user_id, cs.status AS session_status, cs.care_recipient_id,
        cr.first_name AS recipient_first_name,
        u.first_name AS cg_first_name, u.last_name AS cg_last_name
      FROM time_proposals tp
      JOIN care_sessions cs ON tp.session_id = cs.id
      LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
      LEFT JOIN users u ON tp.caregiver_user_id = u.id
      WHERE tp.id = ? AND tp.session_id = ?
    `).get(req.params.proposalId, req.params.id);

    if (!proposal) return res.status(404).json({ error: "Proposal not found" });
    if (proposal.family_user_id !== userId) {
      return res.status(403).json({ error: "Only the requesting family can accept proposals" });
    }
    if (proposal.status !== "pending") {
      return res.status(400).json({ error: `Proposal is already ${proposal.status}` });
    }
    if (!["open", "requested", "pending"].includes(proposal.session_status)) {
      return res.status(400).json({ error: "This session is no longer available" });
    }

    // Update the session with the new time and assign the caregiver
    await db.prepare(`
      UPDATE care_sessions SET
        scheduled_date = ?, scheduled_time = ?,
        caregiver_id = ?, status = 'confirmed', updated_at = NOW()
      WHERE id = ?
    `).run(proposal.proposed_date, proposal.proposed_time, proposal.caregiver_profile_id, req.params.id);

    // Mark this proposal as accepted, decline any other pending proposals for same session
    await db.prepare("UPDATE time_proposals SET status = 'accepted', responded_at = NOW() WHERE id = ?").run(req.params.proposalId);
    await db.prepare("UPDATE time_proposals SET status = 'declined', responded_at = NOW() WHERE session_id = ? AND id != ? AND status = 'pending'").run(req.params.id, req.params.proposalId);

    // Notify the caregiver
    const emitToUser = req.app.get("emitToUser");
    const sendPushToUser = req.app.get("sendPushToUser");
    const caregiverName = `${proposal.cg_first_name} ${proposal.cg_last_name}`;

    const title = "Your proposed time was accepted!";
    const body = `Your time proposal for ${proposal.recipient_first_name} has been accepted. The session is confirmed.`;

    if (emitToUser) {
      emitToUser(proposal.caregiver_user_id, "session_update", { sessionId: req.params.id, status: "confirmed" });
      emitToUser(userId, "session_update", { sessionId: req.params.id, status: "confirmed" });
    }
    if (sendPushToUser) {
      sendPushToUser(proposal.caregiver_user_id, { title, body, data: { type: "proposal_accepted", sessionId: req.params.id } }, "proposal_accepted").catch(() => {});
    }

    res.json({ session: { id: req.params.id, status: "confirmed", date: proposal.proposed_date, time: proposal.proposed_time } });
  } catch (err) {
    console.error("Accept-proposal error:", err);
    res.status(500).json({ error: "Failed to accept proposal" });
  }
});

// ─── PUT /api/sessions/:id/proposals/:proposalId/decline ───
// Family declines a caregiver's time proposal
router.put("/:id/proposals/:proposalId/decline", async (req, res) => {
  try {
    const db = await getDb();
    const userId = req.user.id;

    const proposal = await db.prepare(`
      SELECT tp.*, cs.family_user_id, cr.first_name AS recipient_first_name,
        u.first_name AS cg_first_name, u.last_name AS cg_last_name
      FROM time_proposals tp
      JOIN care_sessions cs ON tp.session_id = cs.id
      LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
      LEFT JOIN users u ON tp.caregiver_user_id = u.id
      WHERE tp.id = ? AND tp.session_id = ?
    `).get(req.params.proposalId, req.params.id);

    if (!proposal) return res.status(404).json({ error: "Proposal not found" });
    if (proposal.family_user_id !== userId) {
      return res.status(403).json({ error: "Only the requesting family can decline proposals" });
    }
    if (proposal.status !== "pending") {
      return res.status(400).json({ error: `Proposal is already ${proposal.status}` });
    }

    await db.prepare("UPDATE time_proposals SET status = 'declined', responded_at = NOW() WHERE id = ?").run(req.params.proposalId);

    // Notify the caregiver
    const emitToUser = req.app.get("emitToUser");
    const sendPushToUser = req.app.get("sendPushToUser");

    const title = "Time proposal declined";
    const body = `Your proposed time for ${proposal.recipient_first_name} was not accepted. The request is still open if you'd like to accept at the original time.`;

    if (emitToUser) {
      emitToUser(proposal.caregiver_user_id, "session_update", { sessionId: req.params.id });
    }
    if (sendPushToUser) {
      sendPushToUser(proposal.caregiver_user_id, { title, body, data: { type: "proposal_declined", sessionId: req.params.id } }, "proposal_declined").catch(() => {});
    }

    res.json({ proposal: { id: req.params.proposalId, status: "declined" } });
  } catch (err) {
    console.error("Decline-proposal error:", err);
    res.status(500).json({ error: "Failed to decline proposal" });
  }
});

module.exports = router;
