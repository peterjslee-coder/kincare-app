const express = require("express");
const { v4: uuid } = require("uuid");
const { getDb } = require("../models/database");
const { authenticate, requireRole } = require("../middleware/auth");
const { validateSession } = require("../middleware/validate");
const { captureException } = require("../utils/sentry");
const availabilityRouter = require("./availability");
const { sendPushToUser, notifyAdmins, sendSessionReminders } = require("./push");
const { calculateSessionCost, isShortNotice } = require("../utils/rateCalculator");
const { getNowInZone, getTodayStringInZone, buildDateTimeInZone } = require("../utils/timezone");
const { geofenceEvidence, coarsenCoordinate } = require("../utils/geocode");
const { hasActiveVouch } = require("../utils/vouches");
const { decideCancellationCharge, CANCEL_FEE_WINDOW_HOURS } = require("../utils/cancellationFee");
const { MODEL_HAIKU } = require("../utils/aiModels");

const router = express.Router();
router.use(authenticate);

// ─── Auto-assignment: ensure caregiver ↔ care recipient link exists ───
// When a session is confirmed, the caregiver should appear in the family's
// "Request Care" list for that care recipient. This was previously only
// created via POST /api/assignments, leaving caregivers who were matched
// through Kindred or session claiming invisible in the care request modal.
async function ensureAssignment(db, { careRecipientId, familyUserId, caregiverProfileId }) {
  if (!careRecipientId || !familyUserId || !caregiverProfileId) return;
  const existing = await db.prepare(`
    SELECT id, is_active FROM caregiver_assignments
    WHERE care_recipient_id = ? AND family_user_id = ? AND caregiver_profile_id = ?
  `).get(careRecipientId, familyUserId, caregiverProfileId);

  if (existing && existing.is_active) return; // already active

  if (existing && !existing.is_active) {
    // Reactivate a previously deactivated assignment
    await db.prepare("UPDATE caregiver_assignments SET is_active = 1 WHERE id = ?").run(existing.id);
    console.log(`[ensureAssignment] Reactivated assignment ${existing.id} for caregiver ${caregiverProfileId.slice(0,8)}`);
    return;
  }

  // Create new assignment
  const id = uuid();
  await db.prepare(`
    INSERT INTO caregiver_assignments (id, care_recipient_id, family_user_id, caregiver_profile_id, is_active, is_favorite)
    VALUES (?, ?, ?, ?, 1, 0)
  `).run(id, careRecipientId, familyUserId, caregiverProfileId);
  console.log(`[ensureAssignment] Created assignment ${id.slice(0,8)} for caregiver ${caregiverProfileId.slice(0,8)} → recipient ${careRecipientId.slice(0,8)}`);
}

// ─── Payment gates: check for unpaid sessions and saved payment method ───
async function checkPaymentStanding(db, familyUserId) {
  // Only block families whose auto-pay has actually FAILED (card declined, auth required, etc.)
  // Sessions still in the grace period (payment_status IS NULL) or processing should NOT block.
  const unpaid = await db.prepare(`
    SELECT cs.id, cs.scheduled_date, cs.caregiver_id,
      u.first_name || ' ' || u.last_name AS caregiver_name
    FROM care_sessions cs
    LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
    LEFT JOIN users u ON cp.user_id = u.id
    WHERE cs.family_user_id = ?
      AND cs.status = 'completed'
      AND cs.payment_status = 'failed'
      AND NOT EXISTS (
        SELECT 1 FROM payments p WHERE p.session_id = cs.id AND p.status IN ('completed', 'processing')
      )
      AND cs.estimated_cost > 0
    ORDER BY cs.scheduled_date DESC
  `).all(familyUserId);

  // Check if family has a saved payment method (Stripe customer with card on file)
  const user = await db.prepare("SELECT stripe_customer_id FROM users WHERE id = ?").get(familyUserId);
  const hasCustomer = !!user?.stripe_customer_id;

  // We'll verify the card exists with Stripe at booking time (in the route handler)
  return { unpaidSessions: unpaid || [], hasStripeCustomer: hasCustomer, stripeCustomerId: user?.stripe_customer_id || null };
}

// ─── Auto-expire stale time proposals (2-hour window) ───
async function expireStaleProposals(db, emitToUser, sendPushToUserFn) {
  try {
    const expired = await db.prepare(`
      SELECT tp.id, tp.session_id, tp.caregiver_user_id, tp.proposed_date, tp.proposed_time,
        cs.family_user_id, cr.first_name AS recipient_first_name,
        u.first_name AS cg_first_name, u.last_name AS cg_last_name
      FROM time_proposals tp
      JOIN care_sessions cs ON tp.session_id = cs.id
      LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
      LEFT JOIN users u ON tp.caregiver_user_id = u.id
      WHERE tp.status = 'pending' AND tp.expires_at IS NOT NULL AND tp.expires_at < NOW()
      LIMIT 20
    `).all();

    for (const p of expired) {
      await db.prepare("UPDATE time_proposals SET status = 'expired', responded_at = NOW() WHERE id = ?").run(p.id);

      // Notify caregiver that their proposal expired
      const caregiverName = `${p.cg_first_name} ${p.cg_last_name}`;
      if (emitToUser) {
        emitToUser(p.caregiver_user_id, "proposal_expired", { sessionId: p.session_id, proposalId: p.id });
      }
      if (sendPushToUserFn) {
        sendPushToUserFn(p.caregiver_user_id, {
          title: "Time proposal expired",
          body: `Your proposal for ${p.recipient_first_name || 'a care visit'} wasn't responded to in time. The job is back in the open pool.`,
          data: { type: "proposal_expired", sessionId: p.session_id },
        }, "proposal_expired").catch(() => {});
      }
    }
    // Also clean up proposals whose sessions are already confirmed with the proposing caregiver
    // (e.g. family accepted via a different path, or proposal accept partially succeeded)
    const orphaned = await db.prepare(`
      SELECT tp.id, tp.session_id, tp.caregiver_user_id
      FROM time_proposals tp
      JOIN care_sessions cs ON tp.session_id = cs.id
      JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id AND cp.user_id = tp.caregiver_user_id
      WHERE tp.status = 'pending'
        AND cs.status IN ('confirmed', 'in_progress', 'completed')
      LIMIT 20
    `).all();

    for (const p of orphaned) {
      await db.prepare("UPDATE time_proposals SET status = 'accepted', responded_at = NOW() WHERE id = ?").run(p.id);
    }

    return expired.length + orphaned.length;
  } catch (e) {
    console.log("expireStaleProposals skipped:", e.message);
    return 0;
  }
}

// ─── GET /api/sessions ───
// List sessions for the current user (family or caregiver)
router.get("/", async (req, res) => {
  try {
  const db = await getDb();
  const { status, from, to, limit = 20 } = req.query;

  let query, params;

  const activeRole = req.user.activeRole || req.user.role;
  if (activeRole === "family") {
    // Include sessions for shared care recipients AND care team recipients
    const sharedRecipients = await db.prepare(`
      SELECT cr.id FROM care_recipient_shares crs
      JOIN care_recipients cr ON crs.care_recipient_id = cr.id
      WHERE crs.shared_with_user_id = ?
    `).all(req.user.id);
    const teamRecipients = await db.prepare(`
      SELECT cr.id FROM care_team_members ctm
      JOIN care_teams ct ON ctm.care_team_id = ct.id
      JOIN care_recipients cr ON ct.care_recipient_id = cr.id
      WHERE ctm.user_id = ?
    `).all(req.user.id);
    const extraIds = [...new Set([...sharedRecipients.map(r => r.id), ...teamRecipients.map(r => r.id)])];
    const allIds = extraIds.length > 0 ? extraIds.map(() => '?').join(',') : "'__none__'";
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
    params = [req.user.id, ...extraIds];
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
  const profile = await db.prepare("SELECT id, background_check_paid, is_background_checked, bg_check_admin_approved, stripe_onboard_complete, is_available, care_stoplight, care_preferences, account_paused FROM caregiver_profiles WHERE user_id = ?").get(req.user.id);
  if (!profile) return res.status(404).json({ error: "Caregiver profile not found" });

  // Gate: account must not be paused
  if (profile.account_paused) {
    return res.status(403).json({ error: "Your account is paused. Contact support for assistance." });
  }

  // Gate: background check — enforced BELOW once the session (and its family) is
  // known, because an admin vouch is scoped to one family, not the whole platform.
  // (v1.64.0: the global bg_check_admin_approved bypass is retired; vouches in
  // bg_admin_vouches are the only non-Checkr path, and only for the vouched family.)

  // Gate: Stripe — skipped for now (not live yet). Admin is_available override also bypasses.
  // if (!profile.stripe_onboard_complete && !profile.is_available) {
  //   return res.status(403).json({ error: "You must set up payment (Stripe) before accepting care requests. Go to Account → Payments." });
  // }

  // Gate: must have set care preferences (stoplight)
  if (!profile.care_stoplight && !profile.care_preferences) {
    return res.status(403).json({ error: "Please set your care preferences before accepting jobs. Go to Account → Care Preferences." });
  }

  const session = await db.prepare("SELECT * FROM care_sessions WHERE id = ?").get(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });
  if (!["requested", "open", "pending"].includes(session.status)) {
    return res.status(400).json({ error: "This session is not available for claiming (status: " + session.status + ")" });
  }

  // Honest background-check gate (v1.64.0):
  //  - a real Checkr result clears the caregiver for any job;
  //  - an admin vouch clears them ONLY for the vouched family's jobs.
  if (!profile.is_background_checked) {
    const vouched = await hasActiveVouch(db, req.user.id, session.family_user_id);
    if (!vouched) {
      return res.status(403).json({ error: "You must complete your background check before accepting care requests. If you have an existing relationship with this family, ask the platform admin to approve you for them." });
    }
  }

  // If interview is required by the family, claim the job but mark as pending interview
  const newStatus = session.interview_required ? 'confirmed' : 'confirmed';
  const interviewStatus = session.interview_required ? 'pending' : null;

  await db.prepare(`
    UPDATE care_sessions SET caregiver_id = ?, status = 'confirmed',
      interview_status = COALESCE(?, interview_status),
      updated_at = NOW()
    WHERE id = ?
  `).run(profile.id, interviewStatus, req.params.id);

  // Auto-create assignment so caregiver appears in future "Request Care" lists
  try {
    await ensureAssignment(db, {
      careRecipientId: session.care_recipient_id,
      familyUserId: session.family_user_id,
      caregiverProfileId: profile.id,
    });
  } catch (assignErr) { console.error('[claim] ensureAssignment error:', assignErr.message); }

  // If interview is required, auto-create the interview record + chat connection
  if (session.interview_required) {
    try {
      const { v4: _uuid } = require('uuid');
      const interviewId = _uuid();
      // Create or find conversation
      let conversationId;
      const existingConv = await db.prepare(`
        SELECT c.id FROM conversations c
        JOIN conversation_members cm1 ON cm1.conversation_id = c.id AND cm1.user_id = ?
        JOIN conversation_members cm2 ON cm2.conversation_id = c.id AND cm2.user_id = ?
        WHERE c.type = 'direct'
      `).get(session.family_user_id, req.user.id);
      if (existingConv) {
        conversationId = existingConv.id;
      } else {
        conversationId = _uuid();
        await db.prepare("INSERT INTO conversations (id, type, created_by) VALUES (?, 'direct', ?)").run(conversationId, session.family_user_id);
        await db.prepare("INSERT INTO conversation_members (id, conversation_id, user_id, role) VALUES (?, ?, ?, 'member')").run(_uuid(), conversationId, session.family_user_id);
        await db.prepare("INSERT INTO conversation_members (id, conversation_id, user_id, role) VALUES (?, ?, ?, 'member')").run(_uuid(), conversationId, req.user.id);
      }
      // Get recipient name for the system message
      const recip = await db.prepare("SELECT first_name FROM care_recipients WHERE id = ?").get(session.care_recipient_id);
      const recipName = recip?.first_name || 'your loved one';
      const iType = session.interview_type || 'video';
      await db.prepare(`
        INSERT INTO interviews (id, session_id, requested_by, requested_of, interview_type, status, conversation_id)
        VALUES (?, ?, ?, ?, ?, 'accepted', ?)
      `).run(interviewId, req.params.id, session.family_user_id, req.user.id, iType, conversationId);
      // System message
      const cgName = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || 'Your caregiver';
      const sysMsg = `📹 Interview scheduled — ${cgName} accepted the care request for ${recipName} on ${session.scheduled_date}. An interview was requested. Use this chat to coordinate a time, then tap the call button when ready. Video calls are limited to 5 minutes.`;
      await db.prepare(`
        INSERT INTO messages (id, sender_id, content, conversation_id, message_type, metadata)
        VALUES (?, ?, ?, ?, 'system', ?)
      `).run(_uuid(), session.family_user_id, sysMsg, conversationId, JSON.stringify({ type: 'interview_request', interviewId, sessionId: req.params.id }));
    } catch (ivErr) { console.error('Auto-create interview on claim error:', ivErr); }
  }

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
  // Use care recipient's timezone for date comparison
  const acceptCrTz = await db.prepare("SELECT timezone FROM care_recipients WHERE id = ?").get(session.care_recipient_id);
  const acceptTz = acceptCrTz?.timezone || 'America/New_York';
  const sessionDateLabel = (() => {
    const today = getTodayStringInZone(acceptTz);
    const tomorrow = new Date(getNowInZone(acceptTz));
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
  // Use care recipient's timezone for timing comparison
  if (session.scheduled_date && session.scheduled_time) {
    const REMINDER_WINDOW = 15;
    // Look up care recipient timezone for this session
    const crTzRow = await db.prepare("SELECT timezone FROM care_recipients WHERE id = ?").get(session.care_recipient_id);
    const claimTz = crTzRow?.timezone || 'America/New_York';
    const claimNow = getNowInZone(claimTz);
    const sessionStartCare = buildDateTimeInZone(session.scheduled_date, session.scheduled_time, claimTz);
    const reminderTime = new Date(sessionStartCare.getTime() - REMINDER_WINDOW * 60000);
    if (claimNow >= reminderTime && claimNow <= sessionStartCare) {
      // Session is within the notification window right now — send immediately
      sendSessionReminders(req.params.id, "pre_check_in").catch(() => {});
    }
    // Otherwise the background poller will pick it up when the time comes
  }

  res.json({ session: updated });
});

// ─── POST /api/sessions ───
// Create a new care request (single or recurring)
router.post("/", requireRole("family", "care_for"), validateSession, async (req, res) => {
  const {
    careRecipientId, serviceType, scheduledDate, scheduledTime,
    durationHours = 2, specialInstructions,
    recurrenceRule, recurrenceWeeks,
    status: requestedStatus,
    proposedRate,
    interviewRequired,
    interviewType,
    flexTiming: rawFlexTiming,
  } = req.body;
  const flexTiming = ['strict', 'flexible', 'open'].includes(rawFlexTiming) ? rawFlexTiming : 'flexible';

  if (!careRecipientId || !serviceType || !scheduledDate || !scheduledTime) {
    return res.status(400).json({
      error: "Required: careRecipientId, serviceType, scheduledDate, scheduledTime",
    });
  }

  // Reject sessions scheduled less than 1 hour from now (timezone-aware)
  // Times are in the care location's timezone (default: America/New_York)
  const sessionStartDt = buildDateTimeInZone(scheduledDate, scheduledTime);
  const nowInZone = getNowInZone();
  const minsUntilSession = (sessionStartDt.getTime() - nowInZone.getTime()) / (1000 * 60);
  if (minsUntilSession < 60) {
    return res.status(400).json({
      error: "Sessions must be scheduled at least 1 hour from now.",
      code: "TOO_SOON",
    });
  }

  const db = await getDb();

  // Verify the care recipient belongs to this user (direct owner, care_for linked, shared, or care team)
  const activeRole = req.user.activeRole || req.user.role;
  let recipient = await db.prepare(
    "SELECT * FROM care_recipients WHERE id = ? AND family_user_id = ?"
  ).get(careRecipientId, req.user.id);

  // care_for users: check linked_user_id instead of family_user_id
  if (!recipient && activeRole === 'care_for') {
    recipient = await db.prepare(
      "SELECT * FROM care_recipients WHERE id = ? AND linked_user_id = ?"
    ).get(careRecipientId, req.user.id);
  }

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
        WHERE cr.id = ? AND ctm.user_id = ?
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

  // ─── Payment gate: block booking if unpaid sessions or no card on file ───
  const standing = await checkPaymentStanding(db, req.user.id);
  if (standing.unpaidSessions.length > 0) {
    return res.status(402).json({
      error: `You have ${standing.unpaidSessions.length} unpaid session${standing.unpaidSessions.length > 1 ? 's' : ''}. Please complete payment before booking new care.`,
      code: 'UNPAID_SESSIONS',
      unpaidCount: standing.unpaidSessions.length,
      unpaidSessions: standing.unpaidSessions.map(s => ({ id: s.id, date: s.scheduled_date, caregiver: s.caregiver_name })),
    });
  }

  // Verify payment method on file — check the booker first, then fall back to care team billing contact
  let payerCustomerId = standing.stripeCustomerId;
  let hasPayer = standing.hasStripeCustomer;

  // If the booker has no Stripe customer, check the care team's billing contact
  if (!hasPayer && careRecipientId) {
    try {
      const billingRow = await db.prepare(`
        SELECT u.stripe_customer_id FROM care_teams ct
        JOIN users u ON ct.billing_user_id = u.id
        WHERE ct.care_recipient_id = ? AND ct.billing_user_id IS NOT NULL
        LIMIT 1
      `).get(careRecipientId);
      if (billingRow?.stripe_customer_id) {
        payerCustomerId = billingRow.stripe_customer_id;
        hasPayer = true;
      }
    } catch (e) { console.warn('[payment-gate] billing contact lookup failed:', e.message); }
  }

  if (!hasPayer) {
    return res.status(402).json({
      error: 'A payment method is required to book care. Please set up your payment method first.',
      code: 'NO_PAYMENT_METHOD',
    });
  }
  try {
    const { getStripe } = require("./payments");
    const stripe = getStripe();
    // Check all accepted payment method types — card, link, and bank account
    let hasMethod = false;
    for (const pmType of ["card", "link", "us_bank_account"]) {
      try {
        const methods = await stripe.paymentMethods.list({ customer: payerCustomerId, type: pmType, limit: 1 });
        if (methods.data.length) { hasMethod = true; break; }
      } catch { /* some types may not be supported */ }
    }
    if (!hasMethod) {
      return res.status(402).json({
        error: 'No saved payment method found. Please add a card or bank account before booking care.',
        code: 'NO_PAYMENT_METHOD',
      });
    }
  } catch (stripeErr) {
    // Non-blocking if Stripe is misconfigured — don't prevent booking
    console.warn('[payment-gate] Stripe check failed (non-blocking):', stripeErr.message);
  }

  // Validate caregiver availability if a caregiver is specified (via matching or direct booking)
  const { caregiverId: bookCaregiverId, directOffer, privateOnly } = req.body;
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

  // Estimate cost — proposed rate (family's offer) ALWAYS wins when set.
  // Caregiver profile rates are only used as defaults when no offer is made.
  let costRates = { base: 28 };
  let overnightMinHours = 6;
  if (proposedRate && parseFloat(proposedRate) > 0) {
    // Family set a rate — use it for ALL tiers (the offer is the offer)
    const rate = parseFloat(proposedRate);
    costRates = { daytime: rate, nighttime: rate, overnight: rate, base: rate };
  } else if (bookCaregiverId) {
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
      // costResult already uses proposedRate when set (see rate logic above)
      const finalCost = estimatedCost;

      const isExclusive = directOffer && bookCaregiverId;
      const isPrivateOnly = isExclusive && privateOnly;
      // Private-only = no timer, stays pending until scheduled date passes
      // Non-private exclusive = 1-hour timer, then opens to all caregivers
      const exclusiveUntilSql = isExclusive && !isPrivateOnly ? "NOW() + INTERVAL '1 hour'" : 'NULL';
      await tx.prepare(`
        INSERT INTO care_sessions
        (id, care_recipient_id, family_user_id, service_type, status,
         scheduled_date, scheduled_time, duration_hours,
         special_instructions, estimated_cost, recurrence_rule, recurrence_group_id,
         short_notice_surcharge, rate_tier, proposed_rate, offered_to_caregiver_id,
         exclusive_until, private_only, interview_required, interview_type, flex_timing)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${exclusiveUntilSql}, ?, ?, ?, ?)
      `).run(
        id, careRecipientId, req.user.id, serviceType, sessionStatus,
        sessionDate, scheduledTime, durationHours,
        specialInstructions || null, finalCost,
        isRecurring ? recurrenceRule : null,
        recurrenceGroupId,
        costResult.surcharge || 0,
        JSON.stringify(costResult.tierBreakdown),
        proposedRate ? parseFloat(proposedRate) : null,
        isExclusive ? bookCaregiverId : null,
        isPrivateOnly ? 1 : 0,
        interviewRequired ? 1 : 0,
        interviewRequired ? (interviewType || 'video') : null,
        flexTiming
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
    VALUES (?, ?, ?, 'session_requested', ?, ?)
  `).run(
    uuid(), req.user.id, careRecipientId,
    `${serviceLabels[serviceType] || serviceType} requested by ${bookerName}${recurrenceLabel}`,
    isRecurring
      ? `${bookerName} requested recurring ${recurrenceRule} sessions starting ${scheduledDate} at ${scheduledTime} (${dates.length} sessions)`
      : `${bookerName} requested a session for ${scheduledDate} at ${scheduledTime}`
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
    WHERE cp.is_available = 1
      AND (cp.is_background_checked = 1 OR EXISTS (
        SELECT 1 FROM bg_admin_vouches v
        WHERE v.caregiver_user_id = cp.user_id AND v.family_user_id = ? AND v.revoked_at IS NULL
      ))
    ORDER BY cp.rating_avg DESC, cp.years_experience DESC
    LIMIT 5
  `).all(req.user.id);

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

  // Auto-create assignment so caregiver appears in future "Request Care" lists
  try {
    await ensureAssignment(db, {
      careRecipientId: session.care_recipient_id,
      familyUserId: req.user.id,
      caregiverProfileId: matched.id,
    });
  } catch (assignErr) { console.error('[match] ensureAssignment error:', assignErr.message); }

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
  const { caregiverId, scheduledDate, scheduledTime, durationHours = 2, proposedRate } = req.query;

  if (!scheduledDate || !scheduledTime) {
    return res.status(400).json({ error: "scheduledDate and scheduledTime are required" });
  }

  const db = await getDb();
  let costRates = { base: 28 };
  let overnightMinHours = 6;

  // Proposed rate (family's offer) ALWAYS wins — same rule everywhere
  const offeredRate = parseFloat(proposedRate) || 0;
  if (offeredRate > 0) {
    costRates = { daytime: offeredRate, nighttime: offeredRate, overnight: offeredRate, base: offeredRate };
  } else if (caregiverId) {
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

  // Check milestones on session completion
  if (status === "completed" && session.caregiver_id) {
    try {
      const { checkSessionMilestones } = require("./referrals");
      await checkSessionMilestones(db, session.caregiver_id);
    } catch (e) { console.error("Milestone check error:", e); }
  }

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
        cr.age, cr.health_conditions, cr.observed_concerns, cr.medications, cr.preferences,
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

    // Gather ALL recent notes (including visit summaries) — iPAi reads everything
    const recentNotes = await db.prepare(`
      SELECT content, created_at, note_type, author_id FROM recipient_notes
      WHERE care_recipient_id = ?
      ORDER BY created_at DESC LIMIT 15
    `).all(session.care_recipient_id);

    // Recent visit moods (last 5 visits by any caregiver) — pattern data
    const recentMoods = await db.prepare(`
      SELECT vl.arrival_mood, vl.departure_mood, vl.summary, cs.scheduled_date,
        cs.scheduled_time, cs.service_type,
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
    let observedConcerns = [];
    try { observedConcerns = JSON.parse(session.observed_concerns || '[]'); } catch { observedConcerns = []; }
    let medications = [];
    try { medications = JSON.parse(session.medications || '[]'); } catch { medications = []; }

    // Service type label
    const serviceLabels = {
      meals: "Meals & Groceries", rides: "Rides & Errands", companion: "Companionship",
      companionship: "Companionship", personal_care: "Personal Care",
      housekeeping: "Housekeeping", full_day: "Full Day Care",
    };
    const serviceLabel = serviceLabels[session.service_type] || session.service_type;

    // ─── iPAi synthesis: condense notes + moods into a short actionable briefing ───
    let notesSynthesis = null;
    const hasContext = recentNotes.length > 0 || recentMoods.length > 0;
    if (hasContext) {
      try {
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (apiKey) {
          const Anthropic = require("@anthropic-ai/sdk");
          const client = new Anthropic({ apiKey });

          // Build context for iPAi
          const notesText = recentNotes.map(n => {
            const dateStr = n.created_at ? new Date(n.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '?';
            const typeLabel = n.note_type === 'visit_summary' ? '[Visit note]' : '[Care team note]';
            return `${dateStr} ${typeLabel}: ${n.content}`;
          }).join('\n');

          const moodText = recentMoods.map(m => {
            const dateStr = m.scheduled_date || '?';
            const arrival = m.arrival_mood || '?';
            const departure = m.departure_mood || '?';
            const who = m.caregiver_first_name || 'Caregiver';
            const summary = m.summary ? ` — "${m.summary}"` : '';
            return `${dateStr}: ${who} visited. Mood: ${arrival} → ${departure}.${summary}`;
          }).join('\n');

          // Determine time-of-day context
          const sessionHour = parseInt((session.scheduled_time || '12:00').split(':')[0]);
          const timeContext = sessionHour < 12 ? 'morning' : sessionHour < 17 ? 'afternoon' : 'evening';

          const prompt = `You are iPAi, the AI care assistant for InPlace. A caregiver is about to check in for a ${timeContext} ${serviceLabel} visit with ${recipientName}${session.age ? ` (age ${session.age})` : ''}.

${isExperienced ? `This caregiver has visited ${recipientName} ${visitCount} times before — keep it brief and focus only on what's new or different.` : `This is a newer caregiver — give a warm, helpful overview.`}

Here is the recent context:

${notesText ? `CARE NOTES:\n${notesText}\n` : ''}${moodText ? `RECENT VISIT MOODS:\n${moodText}\n` : ''}${session.caregiver_briefing ? `FAMILY'S CARE BRIEFING:\n${session.caregiver_briefing}\n` : ''}${healthConditions.length ? `DIAGNOSED CONDITIONS: ${healthConditions.join(', ')}\n` : ''}${observedConcerns.length ? `OBSERVED CONCERNS (family observations, not diagnoses): ${observedConcerns.join(', ')}\n` : ''}${medications.length ? `MEDICATIONS: ${medications.join(', ')}\n` : ''}${session.food_allergies ? `FOOD ALLERGIES: ${session.food_allergies}\n` : ''}${session.pets ? `PETS: ${session.pets}\n` : ''}${session.special_instructions ? `TODAY'S SPECIAL INSTRUCTIONS: ${session.special_instructions}\n` : ''}
Write a SHORT, warm, actionable briefing (3-5 sentences max). Focus on:
- What the caregiver should know RIGHT NOW for this visit
- Any recent mood patterns or behavioral changes worth noting
- Practical tips based on recent observations
- Any special instructions for today

Do NOT list every note. Synthesize. Write in second person ("Betty may be..."). Be warm but concise. No headers, no bullets — just natural sentences.
SAFETY: this goes to the caregiver. Never mention financial or security vulnerabilities — trouble with money, cash or valuables in the home, who pays, entry codes. If such a note is care-relevant, state the behavior neutrally ("may misplace belongings") without exploitable detail. Never state events or facts not present in the context above.`;

          const result = await client.messages.create({
            model: MODEL_HAIKU,
            max_tokens: 300,
            messages: [{ role: "user", content: prompt }],
          });
          notesSynthesis = result.content?.[0]?.text || null;
          if (notesSynthesis) {
            console.log(`[care-briefing] iPAi synthesized briefing for session ${req.params.id.slice(0,8)} (${recentNotes.length} notes, ${recentMoods.length} moods)`);
          }
        }
      } catch (aiErr) {
        console.warn("[care-briefing] iPAi synthesis failed (non-blocking):", aiErr.message);
        // Fallback: no synthesis, raw notes will still be available as fallback
      }
    }

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
      observedConcerns,
      medications,
      foodAllergies: session.food_allergies || null,
      pets: session.pets || null,
      preferences: session.preferences || null,
      // Only send raw notes if iPAi synthesis failed (fallback)
      recentNotes: notesSynthesis ? [] : recentNotes.slice(0, 5).map(n => ({ content: n.content, createdAt: n.created_at, noteType: n.note_type })),
      notesSynthesis,
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
    const { arrivalMood, checkInLatitude, checkInLongitude, briefingAcknowledged, offlineTimestamp, offlineSync } = req.body;

    const session = await db.prepare(`
      SELECT cs.*, cp.user_id AS caregiver_user_id, cp.early_check_in_allowed,
        cr.first_name AS recipient_first_name, cr.last_name AS recipient_last_name,
        cr.timezone AS care_timezone, cr.latitude AS recipient_lat, cr.longitude AS recipient_lng
      FROM care_sessions cs
      LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
      LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
      WHERE cs.id = ?
    `).get(req.params.id);

    if (!session) return res.status(404).json({ error: "Session not found" });
    if (session.caregiver_user_id !== req.user.id) {
      return res.status(403).json({ error: "Only the assigned caregiver can check in" });
    }
    // If this is an offline sync and session already in_progress, treat as success (duplicate)
    if (offlineSync && session.status === "in_progress") {
      return res.json({ duplicate: true, message: "Check-in already recorded" });
    }
    if (session.status !== "confirmed") {
      return res.status(400).json({ error: `Cannot check in — session status is '${session.status}'` });
    }

    // Use offline timestamp if provided (caregiver was offline and recorded locally).
    // Bound it: reject invalid/future/>18h-stale client times and fall back to server time,
    // so a caregiver controlling the client can't claim an arbitrary arrival moment.
    let effectiveCheckInTime = new Date();
    if (offlineTimestamp) {
      const t = new Date(offlineTimestamp);
      const nowMs = Date.now();
      if (!isNaN(t.getTime()) && t.getTime() <= nowMs + 5 * 60000 && t.getTime() >= nowMs - 18 * 3600 * 1000) {
        effectiveCheckInTime = t;
      } else {
        console.warn(`[check-in] Implausible offline timestamp ${offlineTimestamp} — using server time. session ${req.params.id.slice(0, 8)}`);
      }
    }
    const isOfflineSync = !!offlineSync;
    if (isOfflineSync) {
      console.log(`[check-in] Offline sync — original time: ${offlineTimestamp}, session ${req.params.id.slice(0, 8)}`);
    }

    // ─── Payment gate: block check-in if family has unpaid sessions ───
    // Skip when admin is impersonating (test mode) — don't block test check-ins
    if (session.family_user_id && !req.user.impersonatedBy) {
      const standing = await checkPaymentStanding(db, session.family_user_id);
      if (standing.unpaidSessions.length > 0) {
        // Notify the family that their session is blocked
        try {
          sendPushToUser(session.family_user_id, {
            title: 'Session on hold — payment needed',
            body: `Your caregiver tried to check in but you have ${standing.unpaidSessions.length} unpaid session${standing.unpaidSessions.length > 1 ? 's' : ''}. Please pay to resume care.`,
            data: { type: 'payment_hold', page: 'home' },
          }, 'payment_hold').catch(() => {});
        } catch (e) { captureException(e, { where: "sessions: notify family payment_hold on blocked check-in" }); }
        return res.status(402).json({
          error: `This session is on hold. The family has ${standing.unpaidSessions.length} unpaid session${standing.unpaidSessions.length > 1 ? 's' : ''}. They have been notified.`,
          code: 'FAMILY_UNPAID',
          unpaidCount: standing.unpaidSessions.length,
        });
      }
    }

    // ─── Timing gate: 15 min before session start ───
    // Allow check-in after start time (late is fine), but block too-early check-ins
    // All times are care-location times — use care recipient's timezone
    const careTz = session.care_timezone || 'America/New_York';
    const CHECK_IN_WINDOW_MINUTES = 15;
    if (session.scheduled_date && session.scheduled_time) {
      const dateStr = session.scheduled_date.split('T')[0];
      const nowCare = getNowInZone(careTz);
      const sessionStartLocal = buildDateTimeInZone(dateStr, session.scheduled_time, careTz);
      const earliestCheckIn = new Date(sessionStartLocal.getTime() - CHECK_IN_WINDOW_MINUTES * 60000);

      if (nowCare < earliestCheckIn && !session.early_check_in_allowed) {
        return res.status(400).json({
          error: "Check-in window not open yet",
          message: `You can check in starting ${CHECK_IN_WINDOW_MINUTES} minutes before your session at ${session.scheduled_time}`,
          checkInOpensAt: earliestCheckIn.toISOString(),
          sessionStartsAt: sessionStartLocal.toISOString(),
        });
      }
    }

    // ─── Detect late check-in (10+ minutes after scheduled start) ───
    // Use care recipient's timezone — not server or device timezone
    // For offline syncs, use the offline timestamp for late detection
    let lateCheckIn = false;
    let lateMinutes = 0;
    if (session.scheduled_date && session.scheduled_time) {
      try {
        const checkInMoment = isOfflineSync ? effectiveCheckInTime : getNowInZone(careTz);
        const scheduledStart = buildDateTimeInZone(session.scheduled_date.split('T')[0], session.scheduled_time, careTz);
        lateMinutes = Math.floor((checkInMoment - scheduledStart) / 60000);
        if (lateMinutes >= 10) {
          lateCheckIn = true;
          console.log(`[check-in] Late by ${lateMinutes} min (tz: ${careTz}) — session ${req.params.id.slice(0, 8)}`);
        }
      } catch (e) { captureException(e, { where: "sessions: late check-in computation failed (late flag lost)" }); }
    }

    // Transition to in_progress (with late check-in flag if applicable)
    await db.prepare(
      "UPDATE care_sessions SET status = 'in_progress', late_check_in = ?, late_minutes = ?, updated_at = NOW() WHERE id = ?"
    ).run(lateCheckIn ? 1 : 0, lateCheckIn ? lateMinutes : null, req.params.id);

    // Create visit_log with check-in data + location
    // Use effective check-in time (offline timestamp if syncing, NOW() otherwise)
    const visitId = require("uuid").v4();
    const checkInTimeSQL = isOfflineSync ? `'${effectiveCheckInTime.toISOString()}'` : 'NOW()';
    const isTestMode = !!req.user.impersonatedBy;
    if (isTestMode) console.log(`[check-in] TEST MODE — admin ${req.user.impersonatedBy.slice(0,8)} impersonating ${req.user.id.slice(0,8)}`);
    // Proof-of-presence: distance from the caregiver's check-in point to the recipient's home + geofence flag
    const ciGeo = geofenceEvidence(checkInLatitude, checkInLongitude, session.recipient_lat, session.recipient_lng);
    if (ciGeo.flag === 'far') console.warn(`[check-in] Geofence FAR: ${ciGeo.distanceFt} ft from home — session ${req.params.id.slice(0, 8)}`);
    await db.prepare(`
      INSERT INTO visit_logs (id, session_id, caregiver_id, check_in_time, arrival_mood, check_in_latitude, check_in_longitude, check_in_distance_ft, check_in_geo_flag, briefing_acknowledged_at, offline_sync, is_test, created_at)
      VALUES (?, ?, ?, ${checkInTimeSQL}, ?, ?, ?, ?, ?, ${briefingAcknowledged ? 'NOW()' : 'NULL'}, ?, ?, NOW())
    `).run(visitId, req.params.id, session.caregiver_id, arrivalMood ? (Array.isArray(arrivalMood) ? JSON.stringify(arrivalMood) : arrivalMood) : null, coarsenCoordinate(checkInLatitude), coarsenCoordinate(checkInLongitude), ciGeo.distanceFt, ciGeo.flag, isOfflineSync ? 1 : 0, isTestMode ? 1 : 0);

    // Get special instructions and recent notes for the caregiver
    // v1.76.0 — caregivers get family observations via the AI-digested briefing,
    // not raw (Pete's decision: candor for family, care-relevant digest for caregivers)
    const notes = await db.prepare(
      "SELECT content, created_at FROM recipient_notes WHERE care_recipient_id = ? AND note_type != 'observation' ORDER BY created_at DESC LIMIT 5"
    ).all(session.care_recipient_id);

    // Notify family that session has started (skip in test mode — admin impersonation)
    const caregiverUser = await db.prepare("SELECT first_name, last_name FROM users WHERE id = ?").get(req.user.id);
    const caregiverName = caregiverUser ? `${caregiverUser.first_name} ${caregiverUser.last_name}` : "Your caregiver";

    if (!isTestMode) {
      const emitToUser = req.app.get("emitToUser");

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

      // ─── Push notifications to care team: "Session In Progress" ───
      // Uses same tag as pre_check_in reminder → replaces "Caregiver Arriving Soon"
      const famTag = `session-${req.params.id.slice(0,8)}-family`;
      const cgTag = `session-${req.params.id.slice(0,8)}-cg`;

      // Compute remaining time for the notification body (timezone-neutral)
      let remainStr = "";
      try {
        if (session.scheduled_time && session.duration_hours) {
          const [h, m] = session.scheduled_time.split(":").map(Number);
          const durationMin = Math.round(parseFloat(session.duration_hours) * 60);
          // Calculate how many minutes remain from now until scheduled end
          const now = new Date();
          const nowInTz = new Date(now.toLocaleString("en-US", { timeZone: careTz }));
          const startMin = h * 60 + m;
          const endMin = startMin + durationMin;
          const nowMin = nowInTz.getHours() * 60 + nowInTz.getMinutes();
          const leftMin = endMin - nowMin;
          if (leftMin > 0) {
            const hrs = Math.floor(leftMin / 60);
            const mins = leftMin % 60;
            remainStr = hrs > 0 ? ` — ${hrs}h ${mins}m remaining` : ` — ${mins}m remaining`;
          }
        }
      } catch (e) { captureException(e, { where: "sessions: remaining-time display computation" }); }

      // Format check-in time in the care recipient's timezone
      let checkInTimeStr = "";
      try {
        const cit = effectiveCheckInTime || new Date();
        const tzAbbr = cit.toLocaleString("en-US", { timeZone: careTz, timeZoneName: "short" }).split(" ").pop();
        const formatted = cit.toLocaleTimeString("en-US", { timeZone: careTz, hour: "numeric", minute: "2-digit" });
        checkInTimeStr = `${formatted} ${tzAbbr}`;
      } catch (e) { captureException(e, { where: "sessions: check-in time formatting" }); }

      // To entire care team: session is now in progress (supersedes "arriving soon")
      try {
        // Get all care team members (same pattern as sendSessionReminders)
        const careTeamMembers = await db.prepare(`
          SELECT DISTINCT ctm.user_id FROM care_team_members ctm
          JOIN care_teams ct ON ctm.care_team_id = ct.id
          WHERE ct.care_recipient_id = ?
        `).all(session.care_recipient_id);
        const teamUserIds = careTeamMembers.length > 0
          ? careTeamMembers.map(m => m.user_id)
          : (session.family_user_id ? [session.family_user_id] : []);

        for (const userId of teamUserIds) {
          if (userId === req.user.id) continue; // don't notify the caregiver themselves
          await sendPushToUser(userId, {
            title: "Session In Progress",
            body: `${caregiverName} checked in${checkInTimeStr ? ` at ${checkInTimeStr}` : ""}${remainStr}${lateCheckIn ? ` (${lateMinutes} min late)` : ""}`,
            tag: famTag,
            data: { type: "session_in_progress", sessionId: req.params.id, page: "dashboard" },
          }, "session_in_progress");
        }
      } catch (pushErr) {
        console.warn("[check-in] Family push notification failed (non-blocking):", pushErr.message);
      }
    } else {
      console.log(`[check-in] TEST MODE — skipping notifications for session ${req.params.id.slice(0,8)}`);
    }

    res.json({
      visitLog: {
        id: visitId,
        checkInTime: effectiveCheckInTime.toISOString(),
        arrivalMood,
        // Echo what was STORED, not what was received. Returning five decimals for a row
        // that holds two would have the client display a precision the record does not have.
        checkInLatitude: coarsenCoordinate(checkInLatitude),
        checkInLongitude: coarsenCoordinate(checkInLongitude),
        offlineSync: isOfflineSync,
      },
      specialInstructions: session.special_instructions,
      recentNotes: notes,
      lateCheckIn,
      lateMinutes: lateCheckIn ? lateMinutes : undefined,
      offlineSync: isOfflineSync,
      testMode: isTestMode || undefined,
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
    const { departureMood, conditionTags, careFeedback, serviceFeedback, summary, earlyDepartureReason, checkOutLatitude, checkOutLongitude, offlineTimestamp, offlineSync } = req.body;

    const session = await db.prepare(`
      SELECT cs.*, cp.user_id AS caregiver_user_id,
        cr.first_name AS recipient_first_name, cr.last_name AS recipient_last_name,
        cr.timezone AS care_timezone, cr.latitude AS recipient_lat, cr.longitude AS recipient_lng
      FROM care_sessions cs
      LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
      LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
      WHERE cs.id = ?
    `).get(req.params.id);

    if (!session) return res.status(404).json({ error: "Session not found" });
    if (session.caregiver_user_id !== req.user.id) {
      return res.status(403).json({ error: "Only the assigned caregiver can check out" });
    }
    // If this is an offline sync and session already completed, treat as success (duplicate)
    const isOfflineSync = !!offlineSync;
    if (isOfflineSync && session.status === "completed") {
      return res.json({ duplicate: true, message: "Check-out already recorded" });
    }
    if (session.status !== "in_progress") {
      return res.status(400).json({ error: `Cannot check out — session status is '${session.status}'` });
    }

    // Use offline timestamp if provided; bound it the same way as check-in.
    let effectiveCheckOutTime = new Date();
    if (offlineTimestamp) {
      const t = new Date(offlineTimestamp);
      const nowMs = Date.now();
      if (!isNaN(t.getTime()) && t.getTime() <= nowMs + 5 * 60000 && t.getTime() >= nowMs - 18 * 3600 * 1000) {
        effectiveCheckOutTime = t;
      } else {
        console.warn(`[check-out] Implausible offline timestamp ${offlineTimestamp} — using server time. session ${req.params.id.slice(0, 8)}`);
      }
    }
    if (isOfflineSync) {
      console.log(`[check-out] Offline sync — original time: ${offlineTimestamp}, session ${req.params.id.slice(0, 8)}`);
    }

    // All timing uses care recipient's timezone
    const careTz = session.care_timezone || 'America/New_York';

    // Calculate actual duration, overtime, and adjust pay
    const visitLog = await db.prepare(
      "SELECT * FROM visit_logs WHERE session_id = ? ORDER BY created_at DESC LIMIT 1"
    ).get(req.params.id);

    let actualDurationHours = parseFloat(session.duration_hours) || 2;
    let adjustedCost = parseFloat(session.estimated_cost) || 0;
    const scheduledDuration = parseFloat(session.duration_hours) || 2;
    let overtimeMinutes = 0;
    let overtimeCost = 0;

    // Flex timing caps: strict = 0 min, flexible = 30 min, open = 120 min
    const flexPolicy = session.flex_timing || 'strict';
    const flexCapMinutes = flexPolicy === 'open' ? 120 : flexPolicy === 'flexible' ? 30 : 0;

    if (visitLog && visitLog.check_in_time) {
      const checkInTime = new Date(visitLog.check_in_time);
      const checkOutTime = effectiveCheckOutTime; // use offline timestamp if syncing
      const actualMinutes = Math.max(0, (checkOutTime - checkInTime) / 60000);
      const scheduledMinutes = scheduledDuration * 60;

      if (actualMinutes >= (scheduledMinutes - 15) && actualMinutes <= (scheduledMinutes + 15)) {
        // Within 15 min of scheduled end → full scheduled pay, no overtime
        actualDurationHours = scheduledDuration;
        adjustedCost = parseFloat(session.estimated_cost) || 0;
      } else if (actualMinutes > (scheduledMinutes + 15)) {
        // ─── Overtime ───
        // Minutes past scheduled end (subtract the 15-min grace)
        const rawOvertimeMinutes = actualMinutes - scheduledMinutes;
        // Cap overtime at flex policy limit
        const cappedOvertimeMinutes = Math.min(rawOvertimeMinutes, flexCapMinutes);
        // Round overtime UP to nearest 5-min increment
        overtimeMinutes = Math.ceil(cappedOvertimeMinutes / 5) * 5;

        // Calculate overtime cost at the same hourly rate
        const hourlyRate = scheduledDuration > 0
          ? (parseFloat(session.estimated_cost) || 0) / scheduledDuration
          : 0;
        overtimeCost = Math.round((overtimeMinutes / 60) * hourlyRate * 100) / 100;

        // Total = scheduled pay + overtime
        actualDurationHours = scheduledDuration + (overtimeMinutes / 60);
        adjustedCost = (parseFloat(session.estimated_cost) || 0) + overtimeCost;

        if (cappedOvertimeMinutes < rawOvertimeMinutes) {
          console.log(`[check-out] Overtime capped by ${flexPolicy} policy: ${Math.round(rawOvertimeMinutes)} raw → ${overtimeMinutes} billed (cap ${flexCapMinutes} min)`);
        }
      } else {
        // Checked out early — round UP to nearest 5-min increment
        const roundedMinutes = Math.ceil(actualMinutes / 5) * 5;
        actualDurationHours = Math.round(roundedMinutes / 60 * 100) / 100;
        // Pro-rate the pay: (actual hours / scheduled hours) × estimated_cost
        if (scheduledDuration > 0) {
          adjustedCost = Math.round((actualDurationHours / scheduledDuration) * parseFloat(session.estimated_cost || 0) * 100) / 100;
        }
      }
    }

    // Transition to completed with adjusted cost, actual duration, overtime, and mark review required
    // payment_due_at = 1 hour from now — family has that long to review+tip before auto-pay
    await db.prepare(`
      UPDATE care_sessions SET
        status = 'completed',
        estimated_cost = ?,
        duration_hours = ?,
        overtime_minutes = ?,
        overtime_cost = ?,
        review_required = 1,
        completed_at = NOW(),
        payment_due_at = NOW() + INTERVAL '1 hour',
        updated_at = NOW()
      WHERE id = ?
    `).run(adjustedCost, actualDurationHours, overtimeMinutes, overtimeCost, req.params.id);

    // ─── Capture payment (Stripe auth → charge) ───
    // Skip when admin is impersonating (test mode) — don't charge real money
    const isTestCheckout = !!req.user.impersonatedBy;
    if (!isTestCheckout) {
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
    } else {
      console.log(`[checkout] TEST MODE — skipping payment capture for session ${req.params.id.slice(0,8)}`);
      // Waive payment and review for test sessions so they don't trigger lockout banners
      await db.prepare(`
        UPDATE care_sessions SET payment_status = 'waived', review_required = 0, payment_due_at = NULL WHERE id = ?
      `).run(req.params.id);
    }

    // Calculate how many minutes early (for storage and notification)
    // Use care recipient's timezone — not server or device timezone
    let earlyMinutes = 0;
    if (visitLog && visitLog.check_in_time && session.scheduled_time && session.duration_hours) {
      const dateStr = (session.scheduled_date || '').split('T')[0];
      const sessionStart = buildDateTimeInZone(dateStr, session.scheduled_time, careTz);
      const schedEnd = new Date(sessionStart.getTime() + parseFloat(session.duration_hours) * 60 * 60000);
      const nowCare = getNowInZone(careTz);
      earlyMinutes = Math.max(0, (schedEnd - nowCare) / 60000);
    }

    const coGeo = geofenceEvidence(checkOutLatitude, checkOutLongitude, session.recipient_lat, session.recipient_lng);
    if (visitLog) {
      await db.prepare(`
        UPDATE visit_logs SET
          check_out_time = NOW(),
          departure_mood = ?,
          condition_tags = ?,
          care_feedback = ?,
          service_feedback = ?,
          summary = ?,
          mood_rating = ?,
          early_departure_reason = ?,
          early_departure_minutes = ?,
          check_out_lat = ?,
          check_out_lng = ?,
          check_out_distance_ft = ?,
          check_out_geo_flag = ?
        WHERE id = ?
      `).run(
        departureMood ? (Array.isArray(departureMood) ? JSON.stringify(departureMood) : departureMood) : null,
        conditionTags ? JSON.stringify(conditionTags) : null,
        careFeedback || null,
        serviceFeedback || null,
        summary || null,
        departureMood ? (Array.isArray(departureMood) ? JSON.stringify(departureMood) : departureMood) : null,
        earlyMinutes > 15 ? (earlyDepartureReason || null) : null,
        earlyMinutes > 15 ? Math.round(earlyMinutes) : null,
        coarsenCoordinate(checkOutLatitude),
        coarsenCoordinate(checkOutLongitude),
        coGeo.distanceFt,
        coGeo.flag,
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

    const earlyNote = earlyMinutes > 15
      ? ` Left ${Math.round(earlyMinutes)} min early.${earlyDepartureReason ? ` Reason: ${earlyDepartureReason}` : ""}`
      : "";
    const overtimeNote = overtimeMinutes > 0
      ? ` Overtime: ${overtimeMinutes} min (+$${overtimeCost.toFixed(2)}).`
      : "";

    await db.prepare(
      "INSERT INTO activity_feed (id, family_user_id, care_recipient_id, event_type, title, message, metadata) VALUES (?, ?, ?, 'session_checkout', ?, ?, ?)"
    ).run(
      require("uuid").v4(),
      session.family_user_id,
      session.care_recipient_id,
      `${caregiverName} has checked out${earlyMinutes > 15 ? " early" : ""}${overtimeMinutes > 0 ? " (overtime)" : ""}`,
      `Care session with ${session.recipient_first_name} is complete.${earlyNote}${overtimeNote} ${departureMood ? `Mood at departure: ${departureMood}.` : ""}${tagSummary}`,
      JSON.stringify({ sessionId: req.params.id, earlyDeparture: earlyMinutes > 15, earlyMinutes: earlyMinutes > 15 ? Math.round(earlyMinutes) : 0, overtimeMinutes, overtimeCost })
    );

    if (emitToUser) {
      emitToUser(session.family_user_id, "session_update", {
        sessionId: req.params.id,
        status: "completed",
        checkOut: true,
        departureMood,
        conditionTags,
        overtimeMinutes,
        overtimeCost,
      });
      emitToUser(session.family_user_id, "activity_update", {});
    }

    // ─── Push notification to care team: "Session Complete" ───
    // Uses same tag → replaces "In Progress" / "Wrapping Up" notifications
    if (!isTestCheckout) {
      const famTag = `session-${req.params.id.slice(0,8)}-family`;
      const durationStr = actualDurationHours
        ? `${Math.floor(actualDurationHours)}h ${Math.round((actualDurationHours % 1) * 60)}m`
        : "";
      try {
        const careTeamMembers = await db.prepare(`
          SELECT DISTINCT ctm.user_id FROM care_team_members ctm
          JOIN care_teams ct ON ctm.care_team_id = ct.id
          WHERE ct.care_recipient_id = ?
        `).all(session.care_recipient_id);
        const teamUserIds = careTeamMembers.length > 0
          ? careTeamMembers.map(m => m.user_id)
          : (session.family_user_id ? [session.family_user_id] : []);

        for (const userId of teamUserIds) {
          if (userId === req.user.id) continue;
          await sendPushToUser(userId, {
            title: "Session Complete",
            body: `${caregiverName} has checked out from ${session.recipient_first_name}'s session${durationStr ? ` (${durationStr})` : ""}${overtimeNote}`,
            tag: famTag,
            data: { type: "session_complete", sessionId: req.params.id, page: "dashboard" },
          }, "session_complete");
        }
      } catch (pushErr) {
        console.warn("[checkout] Family push notification failed (non-blocking):", pushErr.message);
      }
    }

    // ─── iPAi: Generate AI session summary (non-blocking) ───
    try {
      const { generateSessionSummary } = require("../utils/careIntelligence");
      generateSessionSummary(req.params.id).then(async (aiSummary) => {
        if (aiSummary && aiSummary.summary) {
          // Store the AI summary on the visit log
          try {
            await db.prepare("UPDATE visit_logs SET ai_summary = ? WHERE session_id = ?").run(
              JSON.stringify(aiSummary), req.params.id
            );
            // Send to family via websocket
            if (emitToUser) {
              emitToUser(session.family_user_id, "ipai_session_summary", {
                sessionId: req.params.id,
                recipientName: session.recipient_first_name,
                caregiverName,
                summary: aiSummary.summary,
                suggestions: aiSummary.suggestions,
                moodChange: aiSummary.moodChange,
              });
            }
          } catch (storeErr) {
            console.warn("[iPAi] Failed to store session summary:", storeErr.message);
          }
        }
      }).catch(err => console.warn("[iPAi] Session summary generation failed (non-blocking):", err.message));
    } catch (e) { captureException(e, { where: "sessions: iPAi session summary kickoff" }); }

    // ─── iPAi: Generate caregiver coaching tips (non-blocking) ───
    try {
      const { generateCaregiverCoaching } = require("../utils/careIntelligence");
      generateCaregiverCoaching(req.params.id).then(async (coaching) => {
        if (coaching) {
          try {
            await db.prepare("UPDATE visit_logs SET ai_coaching = ? WHERE session_id = ?").run(
              JSON.stringify(coaching), req.params.id
            );
            if (emitToUser) {
              emitToUser(req.user.id, "ipai_coaching", {
                sessionId: req.params.id,
                recipientName: session.recipient_first_name,
                coaching,
              });
            }
          } catch (storeErr) {
            console.warn("[iPAi] Failed to store coaching:", storeErr.message);
          }
        }
      }).catch(err => console.warn("[iPAi] Coaching generation failed (non-blocking):", err.message));
    } catch (e) { captureException(e, { where: "sessions: iPAi coaching kickoff" }); }

    res.json({
      session: {
        id: req.params.id, status: "completed",
        actualDurationHours, adjustedCost,
        overtimeMinutes, overtimeCost,
        flexPolicy,
      },
      visitLog: visitLog ? { id: visitLog.id } : null,
    });
  } catch (err) {
    console.error("Check-out error:", err);
    res.status(500).json({ error: "Failed to check out" });
  }
});

// ─── POST /api/sessions/:id/pending-tip ───
// Family sets a tip during the auto-pay grace period (before payment_due_at)
// Stored on the session; included when auto-pay fires
router.post("/:id/pending-tip", requireRole("family"), async (req, res) => {
  try {
    const db = await getDb();
    const { tipCents, tipReason } = req.body;
    const safeTipCents = Math.max(0, Math.min(50000, Math.round(tipCents || 0)));

    // Allow both the booker and the billing contact to set a tip
    const session = await db.prepare(`
      SELECT cs.id, cs.family_user_id, cs.status, cs.payment_status
      FROM care_sessions cs
      LEFT JOIN care_teams ct ON ct.care_recipient_id = cs.care_recipient_id
      WHERE cs.id = ? AND (cs.family_user_id = ? OR ct.billing_user_id = ?)
    `).get(req.params.id, req.user.id, req.user.id);

    if (!session) return res.status(404).json({ error: "Session not found" });
    if (session.payment_status === 'paid') return res.status(400).json({ error: "Session already paid" });

    await db.prepare(
      "UPDATE care_sessions SET pending_tip_cents = ?, pending_tip_reason = ?, updated_at = NOW() WHERE id = ?"
    ).run(safeTipCents, tipReason || null, req.params.id);

    console.log(`💛 Pending tip set: $${(safeTipCents/100).toFixed(2)} for session ${req.params.id}`);
    res.json({ success: true, tipCents: safeTipCents });
  } catch (err) {
    console.error("Pending tip error:", err);
    res.status(500).json({ error: "Failed to save tip" });
  }
});

// ─── POST /api/sessions/:id/propose-time-change ───
// Caregiver or family proposes new start/end time for a confirmed session
router.post("/:id/propose-time-change", async (req, res) => {
  try {
    const db = await getDb();
    const { proposedTime, proposedDuration, reason } = req.body;
    const userId = req.user.id;
    const activeRole = req.user.activeRole || req.user.role;

    if (!proposedTime || !proposedDuration) {
      return res.status(400).json({ error: "proposedTime and proposedDuration are required" });
    }

    const session = await db.prepare(`
      SELECT cs.*, cp.user_id AS caregiver_user_id,
        cr.timezone AS care_timezone,
        cu.first_name || ' ' || cu.last_name AS caregiver_name,
        fu.first_name || ' ' || fu.last_name AS family_name,
        cr.first_name || ' ' || cr.last_name AS recipient_name
      FROM care_sessions cs
      LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
      LEFT JOIN users cu ON cp.user_id = cu.id
      LEFT JOIN users fu ON cs.family_user_id = fu.id
      LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
      WHERE cs.id = ?
    `).get(req.params.id);

    if (!session) return res.status(404).json({ error: "Session not found" });
    if (session.status !== "confirmed") {
      return res.status(400).json({ error: "Can only change time on confirmed sessions" });
    }
    if (session.pending_time_change_id) {
      return res.status(400).json({ error: "A time change is already pending for this session" });
    }

    // Determine who is proposing
    let proposedBy;
    if (activeRole === "caregiver" || userId === session.caregiver_user_id) {
      proposedBy = "caregiver";
    } else if (userId === session.family_user_id) {
      proposedBy = "family";
    } else {
      return res.status(403).json({ error: "You are not part of this session" });
    }

    // Check if within 24 hours
    const careTz = session.care_timezone || "America/New_York";
    const sessionDateTime = buildDateTimeInZone(
      session.scheduled_date.split("T")[0],
      session.scheduled_time || "00:00",
      careTz
    );
    const hoursUntil = (sessionDateTime - getNowInZone(careTz)) / (1000 * 60 * 60);
    const isWithin24h = hoursUntil < 24;

    // Calculate overlap for cancellation fee reference
    const origStartMin = parseTimeToMinutes(session.scheduled_time);
    const origEndMin = origStartMin + session.duration_hours * 60;
    const propStartMin = parseTimeToMinutes(proposedTime);
    const propEndMin = propStartMin + proposedDuration * 60;
    const overlapStart = Math.max(origStartMin, propStartMin);
    const overlapEnd = Math.min(origEndMin, propEndMin);
    const overlapMinutes = Math.max(0, overlapEnd - overlapStart);
    const feeHours = session.duration_hours - (overlapMinutes / 60);

    const proposalId = uuid();
    await db.prepare(`
      INSERT INTO time_change_proposals (id, session_id, proposed_by, proposed_by_user_id,
        original_time, original_duration, proposed_time, proposed_duration,
        status, is_within_24h, cancel_fee_hours, reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, NOW())
    `).run(
      proposalId, req.params.id, proposedBy, userId,
      session.scheduled_time, session.duration_hours,
      proposedTime, proposedDuration,
      isWithin24h ? 1 : 0, feeHours > 0 ? feeHours : 0, reason || null
    );

    // Mark session as having a pending time change
    await db.prepare(
      "UPDATE care_sessions SET pending_time_change_id = ?, updated_at = NOW() WHERE id = ?"
    ).run(proposalId, req.params.id);

    // Notify the other party
    const emitToUser = req.app.get("emitToUser");
    const notifyUserId = proposedBy === "caregiver" ? session.family_user_id : session.caregiver_user_id;
    const proposerName = proposedBy === "caregiver" ? session.caregiver_name : session.family_name;
    const friendlyTime = formatTime12h(proposedTime);
    const origFriendlyTime = formatTime12h(session.scheduled_time);

    if (emitToUser) {
      emitToUser(notifyUserId, "time_change_proposed", {
        sessionId: req.params.id,
        proposalId,
        proposedBy,
        proposerName,
        proposedTime,
        proposedDuration,
        originalTime: session.scheduled_time,
        originalDuration: session.duration_hours,
        isWithin24h,
        feeHours,
        recipientName: session.recipient_name,
      });
    }

    // Push notification
    if (sendPushToUser) {
      await sendPushToUser(notifyUserId, {
        title: "⏰ Time Change Request",
        body: `${proposerName} wants to change ${session.recipient_name}'s session from ${origFriendlyTime} to ${friendlyTime}. Tap to review.`,
        data: { type: "time_change", sessionId: req.params.id, proposalId },
      }, "time_change");
    }

    res.json({
      proposal: { id: proposalId, proposedBy, proposedTime, proposedDuration, isWithin24h, feeHours, status: "pending" },
    });
  } catch (err) {
    console.error("Time change proposal error:", err);
    res.status(500).json({ error: "Failed to propose time change" });
  }
});

// ─── PUT /api/sessions/:id/time-change/:proposalId/respond ───
// Accept, reject, or cancel-with-fee a time change proposal
router.put("/:id/time-change/:proposalId/respond", async (req, res) => {
  try {
    const db = await getDb();
    const { action, cancelReason } = req.body; // action: 'accept', 'reject', 'cancel_with_review'
    const userId = req.user.id;
    const activeRole = req.user.activeRole || req.user.role;

    if (!["accept", "reject", "cancel_with_review"].includes(action)) {
      return res.status(400).json({ error: "Invalid action. Use accept, reject, or cancel_with_review." });
    }

    const proposal = await db.prepare("SELECT * FROM time_change_proposals WHERE id = ? AND session_id = ?")
      .get(req.params.proposalId, req.params.id);
    if (!proposal) return res.status(404).json({ error: "Proposal not found" });
    if (proposal.status !== "pending") return res.status(400).json({ error: "Proposal already responded to" });

    const session = await db.prepare(`
      SELECT cs.*, cp.user_id AS caregiver_user_id, cp.hourly_rate,
        cr.timezone AS care_timezone,
        cu.first_name || ' ' || cu.last_name AS caregiver_name,
        fu.first_name || ' ' || fu.last_name AS family_name,
        cr.first_name || ' ' || cr.last_name AS recipient_name
      FROM care_sessions cs
      LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
      LEFT JOIN users cu ON cp.user_id = cu.id
      LEFT JOIN users fu ON cs.family_user_id = fu.id
      LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
      WHERE cs.id = ?
    `).get(req.params.id);

    if (!session) return res.status(404).json({ error: "Session not found" });

    const emitToUser = req.app.get("emitToUser");
    const isResponderCaregiver = activeRole === "caregiver" || userId === session.caregiver_user_id;
    const isResponderFamily = userId === session.family_user_id;
    const notifyUserId = isResponderCaregiver ? session.family_user_id : session.caregiver_user_id;
    const responderName = isResponderCaregiver ? session.caregiver_name : session.family_name;

    if (action === "accept") {
      // Update proposal status
      await db.prepare(
        "UPDATE time_change_proposals SET status = 'accepted', acknowledged_by_user_id = ?, acknowledged_at = NOW() WHERE id = ?"
      ).run(userId, proposal.id);

      // Apply the time change to the session
      await db.prepare(
        "UPDATE care_sessions SET scheduled_time = ?, duration_hours = ?, pending_time_change_id = NULL, updated_at = NOW() WHERE id = ?"
      ).run(proposal.proposed_time, proposal.proposed_duration, req.params.id);

      // Notify proposer
      if (emitToUser) {
        emitToUser(proposal.proposed_by_user_id === session.caregiver_user_id ? session.caregiver_user_id : session.family_user_id, "time_change_accepted", {
          sessionId: req.params.id, proposalId: proposal.id, acceptedBy: responderName,
          newTime: proposal.proposed_time, newDuration: proposal.proposed_duration,
        });
      }
      if (sendPushToUser) {
        const pushTarget = proposal.proposed_by === "caregiver" ? session.caregiver_user_id : session.family_user_id;
        await sendPushToUser(pushTarget, {
          title: "✅ Time Change Accepted",
          body: `${responderName} accepted the new time: ${formatTime12h(proposal.proposed_time)} for ${proposal.proposed_duration}hr.`,
          data: { type: "time_change_accepted", sessionId: req.params.id },
        }, "time_change");
      }

      res.json({ ok: true, action: "accepted", newTime: proposal.proposed_time, newDuration: proposal.proposed_duration });

    } else if (action === "reject") {
      // Simply reject — keep original time
      await db.prepare(
        "UPDATE time_change_proposals SET status = 'rejected', acknowledged_by_user_id = ?, acknowledged_at = NOW() WHERE id = ?"
      ).run(userId, proposal.id);
      await db.prepare(
        "UPDATE care_sessions SET pending_time_change_id = NULL, updated_at = NOW() WHERE id = ?"
      ).run(req.params.id);

      if (emitToUser) {
        emitToUser(proposal.proposed_by_user_id === session.caregiver_user_id ? session.caregiver_user_id : session.family_user_id, "time_change_rejected", {
          sessionId: req.params.id, proposalId: proposal.id, rejectedBy: responderName,
        });
      }

      res.json({ ok: true, action: "rejected" });

    } else if (action === "cancel_with_review") {
      // Cancel the session due to time change + fee logic
      const isWithin24h = proposal.is_within_24h === 1;

      if (proposal.proposed_by === "caregiver" && isResponderFamily) {
        // Caregiver proposed, family cancels → no charge + can review caregiver
        await db.prepare(
          "UPDATE time_change_proposals SET status = 'cancelled_no_fee', acknowledged_by_user_id = ?, acknowledged_at = NOW() WHERE id = ?"
        ).run(userId, proposal.id);
        await db.prepare(`
          UPDATE care_sessions SET status = 'cancelled', pending_time_change_id = NULL,
            cancellation_reason = ?, cancelled_by = 'family', cancelled_at = NOW(),
            late_cancel = ?, cancelled_caregiver_id = caregiver_id,
            updated_at = NOW()
          WHERE id = ?
        `).run(cancelReason || "Cancelled due to caregiver time change", isWithin24h ? 1 : 0, req.params.id);

        if (emitToUser) {
          emitToUser(session.caregiver_user_id, "session_update", {
            sessionId: req.params.id, status: "cancelled", cancelledBy: "family",
            reason: "Family cancelled after your time change proposal",
          });
        }

        res.json({
          ok: true, action: "cancelled", cancelledBy: "family",
          chargeApplies: false, canReview: true,
          cancelledCaregiverId: session.caregiver_id,
        });

      } else if (proposal.proposed_by === "family" && isResponderCaregiver) {
        // ─── v1.105.19 — one cancellation policy, not two ───
        //
        // This branch used to compute its OWN fee — cancel_fee_hours x hourly_rate — show it
        // to the caregiver as "you'll be compensated $X", label the button "Cancel + Collect
        // Fee", and then never call Stripe. Not once, on any path. Since v1.57.11 (March)
        // caregivers have been shown a dollar figure and paid nothing.
        //
        // Pete's intent (7/31): there is no separate cancellation fee. A family moving a
        // visit inside 24 hours, which the caregiver then declines, IS a late client
        // cancellation. So it goes through the same decision and the same 24-hour reconcile
        // window as every other one, and the money actually moves.
        const feeHours = proposal.cancel_fee_hours || 0;

        await db.prepare(
          "UPDATE time_change_proposals SET status = 'cancelled_with_fee', acknowledged_by_user_id = ?, acknowledged_at = NOW() WHERE id = ?"
        ).run(userId, proposal.id);
        await db.prepare(`
          UPDATE care_sessions SET status = 'open', pending_time_change_id = NULL,
            cancellation_reason = ?, cancelled_by = 'caregiver', cancelled_at = NOW(),
            cancelled_caregiver_id = caregiver_id, caregiver_id = NULL,
            late_cancel = ?, updated_at = NOW()
          WHERE id = ?
        `).run(cancelReason || "Cancelled due to family time change", isWithin24h ? 1 : 0, req.params.id);

        // Record the standard fee under the standard rules. isLateCancel is the family's
        // late time-change, and cancelledBy is 'family' because the family is the party
        // that moved it — the caregiver only declined a change they did not ask for.
        let tcCharge = { action: "none", feePercent: 0 };
        try {
          tcCharge = await decideCancellationCharge(db, {
            cancelledBy: "family",
            isLateCancel: !!isWithin24h,
            paymentIntentId: session.stripe_payment_intent_id,
            paymentStatus: session.payment_status,
            authorizedAmountCents: session.authorized_amount,
          });
          if (tcCharge.action === "capture") {
            await db.prepare(`
              UPDATE care_sessions SET cancel_fee_status = 'pending', cancel_fee_cents = ?,
                cancel_fee_deadline = NOW() + INTERVAL '${CANCEL_FEE_WINDOW_HOURS} hours'
              WHERE id = ?
            `).run(tcCharge.amountCents, req.params.id);
          } else if (tcCharge.action === "void") {
            const { voidSessionPayment } = require("./accountability");
            await voidSessionPayment(req.params.id);
          }
        } catch (e) {
          console.error("[sessions] time-change cancellation charge failed:", e.message);
          captureException(e, { where: "sessions: time-change cancel fee", sessionId: req.params.id });
        }

        if (emitToUser) {
          emitToUser(session.family_user_id, "session_update", {
            sessionId: req.params.id, status: "open", cancelledBy: "caregiver",
            reason: "Caregiver declined your time change",
            feeHours, feeCents: tcCharge.action === 'capture' ? tcCharge.amountCents : 0,
          });
        }

        res.json({
          ok: true, action: "cancelled", cancelledBy: "caregiver",
          feeHours, feeCents: tcCharge.action === 'capture' ? tcCharge.amountCents : 0, hourlyRate,
          chargeApplies: feeHours > 0,
        });

      } else {
        return res.status(400).json({ error: "Invalid cancel scenario" });
      }
    }
  } catch (err) {
    console.error("Time change response error:", err);
    res.status(500).json({ error: "Failed to respond to time change" });
  }
});

// ─── GET /api/sessions/:id/time-change ───
// Get pending time change proposal for a session
router.get("/:id/time-change", async (req, res) => {
  try {
    const db = await getDb();
    const proposal = await db.prepare(`
      SELECT tcp.*, u.first_name || ' ' || u.last_name AS proposer_name
      FROM time_change_proposals tcp
      JOIN users u ON tcp.proposed_by_user_id = u.id
      WHERE tcp.session_id = ? AND tcp.status = 'pending'
      ORDER BY tcp.created_at DESC LIMIT 1
    `).get(req.params.id);
    res.json({ proposal: proposal || null });
  } catch (err) {
    console.error("Time change fetch error:", err);
    res.status(500).json({ error: "Failed to fetch time change" });
  }
});

// Helper: parse "HH:MM" to minutes since midnight
function parseTimeToMinutes(timeStr) {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + (m || 0);
}

// Helper: format "14:00" → "2:00 PM"
function formatTime12h(timeStr) {
  if (!timeStr) return "";
  const [h, m] = timeStr.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m || 0).padStart(2, "0")} ${ampm}`;
}

// ─── PUT /api/sessions/:id/instructions ───
// Update special_instructions on a session (family/care_for only, before completion)
router.put("/:id/instructions", async (req, res) => {
  try {
    const db = await getDb();
    const userId = req.user.id;
    const activeRole = req.user.activeRole || req.user.role;
    const { specialInstructions } = req.body;

    if (typeof specialInstructions !== "string") {
      return res.status(400).json({ error: "specialInstructions must be a string" });
    }

    // Sanitize input
    const sanitize = (str) => str.replace(/<[^>]*>/g, "").trim();
    const cleaned = sanitize(specialInstructions).slice(0, 2000);

    const session = await db.prepare(`
      SELECT cs.*, cr.family_user_id AS owner_id
      FROM care_sessions cs
      LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
      WHERE cs.id = ?
    `).get(req.params.id);

    if (!session) return res.status(404).json({ error: "Session not found" });

    // Only family owner, session booker, or care_for can edit instructions
    const isOwner = userId === session.owner_id || userId === session.family_user_id;
    const isCareFor = activeRole === "care_for";
    const isAdmin = activeRole === "admin";
    if (!isOwner && !isCareFor && !isAdmin) {
      return res.status(403).json({ error: "Not authorized to edit instructions" });
    }

    // Cannot edit completed or cancelled sessions
    if (["completed", "cancelled"].includes(session.status)) {
      return res.status(400).json({ error: "Cannot edit instructions on a completed or cancelled session" });
    }

    // Append to existing instructions instead of overwriting
    const existing = (session.special_instructions || "").trim();
    const merged = existing
      ? existing + "\n\n" + cleaned
      : cleaned;
    const finalInstructions = merged.slice(0, 2000) || null;

    await db.prepare(`
      UPDATE care_sessions SET special_instructions = ?, updated_at = NOW()
      WHERE id = ?
    `).run(finalInstructions, req.params.id);

    res.json({ ok: true, special_instructions: finalInstructions });
  } catch (err) {
    console.error("PUT /sessions/:id/instructions error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ─── PUT /api/sessions/:id/on-my-way ───
// Caregiver signals they're en route — notifies care team + care recipient
router.put("/:id/on-my-way", async (req, res) => {
  try {
    const db = await getDb();
    const userId = req.user.id;
    const activeRole = req.user.activeRole || req.user.role;
    const { estimatedMinutes, lat, lng } = req.body || {}; // optional ETA or caregiver coords

    const session = await db.prepare(`
      SELECT cs.*, cp.user_id AS caregiver_user_id,
        cr.first_name AS recipient_first_name, cr.last_name AS recipient_last_name,
        cr.linked_user_id AS care_for_user_id,
        cr.notification_channel, cr.sms_phone,
        cr.location_address, cr.location_city, cr.location_state,
        cr.latitude AS recipient_lat, cr.longitude AS recipient_lng
      FROM care_sessions cs
      LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
      LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
      WHERE cs.id = ?
    `).get(req.params.id);

    if (!session) return res.status(404).json({ error: "Session not found" });

    // Only the assigned caregiver (or admin) can signal on-my-way
    if (activeRole !== "admin" && userId !== session.caregiver_user_id) {
      return res.status(403).json({ error: "Only the assigned caregiver can signal en route" });
    }

    if (["completed", "cancelled"].includes(session.status)) {
      return res.status(400).json({ error: "Session is already completed or cancelled" });
    }

    // Mark the on_my_way timestamp
    await db.prepare(`
      UPDATE care_sessions SET on_my_way_at = NOW(), updated_at = NOW()
      WHERE id = ?
    `).run(req.params.id);

    // Build notification content
    const caregiver = await db.prepare("SELECT first_name, last_name FROM users WHERE id = ?").get(session.caregiver_user_id);
    const cgName = caregiver ? `${caregiver.first_name}` : "Your caregiver";
    const recipientName = `${session.recipient_first_name || ""} ${session.recipient_last_name || ""}`.trim() || "your loved one";
    const etaStr = estimatedMinutes ? ` (about ${estimatedMinutes} min away)` : "";
    const locationParts = [session.location_address, session.location_city, session.location_state].filter(Boolean);
    const mapsUrl = locationParts.length ? `https://maps.google.com/?q=${encodeURIComponent(locationParts.join(", "))}` : null;

    const { sendPushToUser } = require("./push");

    // Notification tags
    const famTag = `session-${req.params.id.slice(0,8)}-family`;
    const recipTag = `session-${req.params.id.slice(0,8)}-recip`;

    // Notify care team
    const careTeamMembers = await db.prepare(`
      SELECT DISTINCT ctm.user_id FROM care_team_members ctm
      JOIN care_teams ct ON ctm.care_team_id = ct.id
      WHERE ct.care_recipient_id = ?
    `).all(session.care_recipient_id);
    const teamUserIds = careTeamMembers.length > 0
      ? careTeamMembers.map(m => m.user_id)
      : (session.family_user_id ? [session.family_user_id] : []);

    for (const uid of teamUserIds) {
      if (uid === session.caregiver_user_id) continue;
      await sendPushToUser(uid, {
        title: `${cgName} is On the Way!`,
        body: `Heading to ${recipientName}'s now${etaStr}`,
        tag: famTag,
        data: { type: "on_my_way", sessionId: req.params.id, page: "dashboard", mapsUrl },
      }, "on_my_way");
    }

    // Notify care recipient
    const channel = session.notification_channel || "push";
    const recipFirstName = session.recipient_first_name || "there";

    if (["push", "both"].includes(channel) && session.care_for_user_id && !teamUserIds.includes(session.care_for_user_id)) {
      await sendPushToUser(session.care_for_user_id, {
        title: `${cgName} is On the Way!`,
        body: `Hi ${recipFirstName}, ${cgName} is heading to you now${etaStr}`,
        tag: recipTag,
        data: { type: "on_my_way_recipient", sessionId: req.params.id },
      }, "on_my_way_recipient");
    }

    if (["sms", "both"].includes(channel) && session.sms_phone) {
      const { sendSms } = require("../utils/sms");
      await sendSms(session.sms_phone, `Hi ${recipFirstName}, ${cgName} is on the way to you now${etaStr}!`);
    }

    // ─── Schedule "5 minutes away" notification if we can estimate ETA ───
    let etaMinutes = estimatedMinutes || null;
    if (!etaMinutes && lat && lng && session.recipient_lat && session.recipient_lng) {
      // Haversine distance → rough driving ETA at ~30 mph average
      const toRad = (d) => d * Math.PI / 180;
      const R = 3959; // Earth radius in miles
      const dLat = toRad(session.recipient_lat - lat);
      const dLng = toRad(session.recipient_lng - lng);
      const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat)) * Math.cos(toRad(session.recipient_lat)) * Math.sin(dLng/2)**2;
      const miles = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      etaMinutes = Math.round((miles / 30) * 60); // 30 mph average
    }

    if (etaMinutes && etaMinutes > 5) {
      const delayMs = (etaMinutes - 5) * 60 * 1000;
      const sessionId = req.params.id;
      setTimeout(async () => {
        try {
          // Send "5 minutes away" notification to care team + care recipient
          const { sendPushToUser: pushToUser } = require("./push");
          for (const uid of teamUserIds) {
            if (uid === session.caregiver_user_id) continue;
            await pushToUser(uid, {
              title: `${cgName} is 5 Minutes Away`,
              body: `Almost there! ${cgName} will arrive at ${recipientName}'s shortly.`,
              tag: famTag,
              data: { type: "five_min_away", sessionId, page: "dashboard" },
            }, "five_min_away");
          }
          const ch = session.notification_channel || "push";
          const rName = session.recipient_first_name || "there";
          if (["push", "both"].includes(ch) && session.care_for_user_id && !teamUserIds.includes(session.care_for_user_id)) {
            await pushToUser(session.care_for_user_id, {
              title: `${cgName} is Almost Here!`,
              body: `Hi ${rName}, ${cgName} will be at your door in about 5 minutes!`,
              tag: recipTag,
              data: { type: "five_min_away_recipient", sessionId },
            }, "five_min_away_recipient");
          }
          if (["sms", "both"].includes(ch) && session.sms_phone) {
            const { sendSms } = require("../utils/sms");
            await sendSms(session.sms_phone, `Hi ${rName}, ${cgName} will be at your door in about 5 minutes!`);
          }
          console.log(`  5-min-away notification sent for session ${sessionId}`);
        } catch (err) {
          console.error("5-min-away notification error:", err.message);
        }
      }, delayMs);
      console.log(`  On-my-way signal sent for session ${req.params.id}${etaStr}. 5-min-away scheduled in ${Math.round(delayMs/60000)} min`);
    } else {
      console.log(`  On-my-way signal sent for session ${req.params.id}${etaStr}. ETA <= 5 min or unknown — no delayed notification.`);
    }

    res.json({ ok: true, on_my_way_at: new Date().toISOString(), etaMinutes });
  } catch (err) {
    console.error("PUT /sessions/:id/on-my-way error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ─── PUT /api/sessions/:id/cancel ───
// Cancel a confirmed/pending session with late-cancel tracking
// ─── GET /api/sessions/:id/cancel-preview ───
//
// v1.105.15 — what cancelling right now would cost, BEFORE confirming.
//
// The Client Services Agreement charges the fee "posted on IPC's platform at the time of
// cancellation". A charge the person was never shown is not posted to them in any
// meaningful sense, and is a chargeback with extra steps.
//
// This deliberately calls the SAME decideCancellationCharge the cancel handler calls,
// rather than reimplementing the rule for display. A preview that computes the number a
// second way is a preview that will eventually disagree with the charge — and the failure
// mode is quoting someone $0 and taking $120.
router.get("/:id/cancel-preview", async (req, res) => {
  try {
    const db = await getDb();
    const userId = req.user.id;
    const activeRole = req.user.activeRole || req.user.role;

    const session = await db.prepare(`
      SELECT cs.*, cp.user_id AS caregiver_user_id, cr.timezone AS care_timezone
      FROM care_sessions cs
      LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
      LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
      WHERE cs.id = ?
    `).get(req.params.id);
    if (!session) return res.status(404).json({ error: "Session not found" });

    const isCaregiver = activeRole === "caregiver" || userId === session.caregiver_user_id;
    const isFamily = userId === session.family_user_id;
    if (!isCaregiver && !isFamily) return res.status(403).json({ error: "Not your session" });
    const cancelledBy = isCaregiver ? "caregiver" : "family";

    const tz = session.care_timezone || "America/New_York";
    const startsAt = buildDateTimeInZone(
      session.scheduled_date.split("T")[0], session.scheduled_time || "00:00", tz
    );
    const hoursUntil = (startsAt - getNowInZone(tz)) / 3600000;
    const isLateCancel = !!session.caregiver_id && hoursUntil < 24;

    const charge = await decideCancellationCharge(db, {
      cancelledBy,
      isLateCancel,
      paymentIntentId: session.stripe_payment_intent_id,
      paymentStatus: session.payment_status,
      authorizedAmountCents: session.authorized_amount,
    });

    res.json({
      cancelledBy,
      isLateCancel,
      hoursUntilSession: Math.round(hoursUntil * 10) / 10,
      willCharge: charge.action === "capture",
      chargeCents: charge.action === "capture" ? charge.amountCents : 0,
      feePercent: charge.feePercent,
      // One sentence the client can show verbatim. Built here so every cancel surface —
      // Dashboard, VisitDetailModal, CaretakerHub, FindWork — says the same thing rather
      // than four components each inventing their own wording for a contractual charge.
      message: charge.action === "capture"
        ? `This is a late cancellation (under 24 hours). You will be charged a ${charge.feePercent}% cancellation fee of $${(charge.amountCents / 100).toFixed(2)}.`
        : cancelledBy === "caregiver"
          ? "The job will go back to the open pool. The family will not be charged."
          : isLateCancel
            ? "This is a late cancellation (under 24 hours). You will not be charged."
            : "You will not be charged.",
    });
  } catch (err) {
    console.error("Cancel preview error:", err);
    res.status(500).json({ error: "Failed to preview cancellation" });
  }
});

// ─── The 24-hour reconcile window on a cancellation fee (v1.105.19) ───
//
// Two actions, deliberately asymmetric, because the parties are not symmetric.
//
// The CAREGIVER can waive. The fee is their lost wage — that is the whole reason it is a
// pass-through and not a liquidated damage — so they are the only party with standing to
// forgive it. This is also what makes "the Client shall be charged" true in the contract
// while still letting a real human say no harm, no foul: the discretion belongs to the
// caregiver, not to InPlace.
//
// The FAMILY can dispute. That does not cancel the charge; it pauses it and puts it in
// front of a person. "I shouldn't have to pay this" and "that was a software problem" are
// exactly the cases Pete wanted to leave room for, and they need a human, not a button
// that silently zeroes the caregiver's money.

// ─── GET /api/sessions/:id/cancel-fee ───
router.get("/:id/cancel-fee", async (req, res) => {
  try {
    const db = await getDb();
    const row = await db.prepare(`
      SELECT cs.id, cs.cancel_fee_status, cs.cancel_fee_cents, cs.cancel_fee_deadline,
             cs.cancel_fee_note, cs.family_user_id, cp.user_id AS caregiver_user_id
      FROM care_sessions cs
      LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
      WHERE cs.id = ?
    `).get(req.params.id);
    if (!row) return res.status(404).json({ error: "Session not found" });
    const isCaregiver = req.user.id === row.caregiver_user_id;
    const isFamily = req.user.id === row.family_user_id;
    if (!isCaregiver && !isFamily) return res.status(403).json({ error: "Not your session" });
    res.json({
      status: row.cancel_fee_status || "none",
      amountCents: row.cancel_fee_cents || 0,
      deadline: row.cancel_fee_deadline,
      note: row.cancel_fee_note,
      canWaive: isCaregiver && row.cancel_fee_status === "pending",
      canDispute: isFamily && row.cancel_fee_status === "pending",
    });
  } catch (err) {
    console.error("Cancel fee read error:", err);
    res.status(500).json({ error: "Failed to load the cancellation fee" });
  }
});

// ─── POST /api/sessions/:id/cancel-fee/waive ─── caregiver only
router.post("/:id/cancel-fee/waive", async (req, res) => {
  try {
    const db = await getDb();
    const row = await db.prepare(`
      SELECT cs.id, cs.cancel_fee_status, cs.cancel_fee_cents, cs.family_user_id,
             cp.user_id AS caregiver_user_id
      FROM care_sessions cs LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
      WHERE cs.id = ?
    `).get(req.params.id);
    if (!row) return res.status(404).json({ error: "Session not found" });
    // Only the caregiver. An admin waiving on their behalf would be InPlace giving away
    // someone else's wage, which is precisely the discretion the contract does not grant.
    if (req.user.id !== row.caregiver_user_id) {
      return res.status(403).json({ error: "Only the caregiver can waive their own cancellation fee." });
    }
    if (row.cancel_fee_status !== "pending") {
      return res.status(400).json({ error: `This fee is already ${row.cancel_fee_status || "settled"}.` });
    }

    const { voidSessionPayment } = require("./accountability");
    const voided = await voidSessionPayment(req.params.id);
    if (voided?.error) {
      // Do NOT mark it waived if the money did not actually get released — that would tell
      // a caregiver they had forgiven a charge the family is still about to pay.
      console.error("[sessions] waive failed to void:", voided.error);
      captureException(new Error(`cancel-fee waive void failed: ${voided.error}`), { sessionId: req.params.id });
      return res.status(502).json({ error: "We couldn't release the charge just now. Try again in a moment." });
    }
    await db.prepare(`
      UPDATE care_sessions SET cancel_fee_status = 'waived', cancel_fee_decided_at = NOW(),
        cancel_fee_decided_by = ?, cancel_fee_note = ? WHERE id = ?
    `).run(req.user.id, (req.body?.note || "").slice(0, 500), req.params.id);

    sendPushToUser(row.family_user_id, {
      title: "Cancellation fee waived",
      body: "Your caregiver waived the late cancellation fee. You haven't been charged.",
      data: { type: "cancel_fee_waived", sessionId: req.params.id },
    }, "cancel_fee_waived").catch(() => {});
    res.json({ status: "waived" });
  } catch (err) {
    console.error("Cancel fee waive error:", err);
    res.status(500).json({ error: "Failed to waive the fee" });
  }
});

// ─── POST /api/sessions/:id/cancel-fee/dispute ─── family only
router.post("/:id/cancel-fee/dispute", async (req, res) => {
  try {
    const db = await getDb();
    const row = await db.prepare(
      "SELECT id, cancel_fee_status, cancel_fee_cents, family_user_id FROM care_sessions WHERE id = ?"
    ).get(req.params.id);
    if (!row) return res.status(404).json({ error: "Session not found" });
    if (req.user.id !== row.family_user_id) return res.status(403).json({ error: "Not your session" });
    if (row.cancel_fee_status !== "pending") {
      return res.status(400).json({ error: `This fee is already ${row.cancel_fee_status || "settled"}.` });
    }
    const reason = (req.body?.reason || "").trim();
    if (reason.length < 5) return res.status(400).json({ error: "Tell us briefly what's wrong." });

    await db.prepare(`
      UPDATE care_sessions SET cancel_fee_status = 'disputed', cancel_fee_decided_at = NOW(),
        cancel_fee_decided_by = ?, cancel_fee_note = ? WHERE id = ?
    `).run(req.user.id, reason.slice(0, 2000), req.params.id);

    notifyAdmins("cancel_fee_disputed", {
      title: "Cancellation fee disputed",
      body: `A family disputed a $${((row.cancel_fee_cents || 0) / 100).toFixed(2)} cancellation fee.`,
      data: { type: "cancel_fee_disputed", sessionId: req.params.id },
    }).catch(() => {});

    res.json({
      status: "disputed",
      // Say the backstop out loud. A dispute that quietly expires into "no charge" is a
      // fine outcome, but only if the person was told it might happen.
      message: "Thanks — we've paused the charge and a person will look at this. If we haven't resolved it within five days, the charge is dropped automatically.",
    });
  } catch (err) {
    console.error("Cancel fee dispute error:", err);
    res.status(500).json({ error: "Failed to raise the dispute" });
  }
});

router.put("/:id/cancel", async (req, res) => {
  try {
    const db = await getDb();
    const { reason } = req.body;
    const userId = req.user.id;
    const activeRole = req.user.activeRole || req.user.role;

    const session = await db.prepare(`
      SELECT cs.*, cp.user_id AS caregiver_user_id,
        cr.timezone AS care_timezone
      FROM care_sessions cs
      LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
      LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
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
    // Use care recipient's timezone for timing
    const cancelTz = session.care_timezone || 'America/New_York';
    const sessionDateTime = buildDateTimeInZone(session.scheduled_date.split("T")[0], session.scheduled_time || "00:00", cancelTz);
    const hoursUntilSession = (sessionDateTime - getNowInZone(cancelTz)) / (1000 * 60 * 60);
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

    // ─── v1.105.19 — settle the payment hold ───
    //
    // Nobody pre-pays. authorizeSessionPayment uses capture_method:'manual' and a poller
    // places the hold 23-25 hours before the visit; capture happens at check-out. So a
    // session cancelled more than a day out has no money attached at all, and one cancelled
    // inside that window has an uncaptured authorization on the family's card.
    //
    // Before v1.105.14 nothing released it: voidSessionPayment existed but was called from
    // exactly one place, the caregiver-no-show poller. A family cancelling the evening
    // before was left with a pending charge for ~7 days until Stripe expired it.
    //
    // What happens to that hold is decided by the published agreements, not by this handler.
    // See src/utils/cancellationFee.js for the clauses, for why only a CLIENT cancelling
    // late is ever charged, and for the 24-hour reconcile window that a capture now waits
    // out before it fires.
    let charge = { action: "none", feePercent: 0, reason: "not_evaluated" };
    try {
      charge = await decideCancellationCharge(db, {
        cancelledBy,
        isLateCancel,
        paymentIntentId: session.stripe_payment_intent_id,
        paymentStatus: session.payment_status,
        authorizedAmountCents: session.authorized_amount,
      });
    } catch (e) {
      console.error("[sessions] cancellation charge decision failed:", e.message);
      captureException(e, { where: "sessions: cancellation charge decision", sessionId: req.params.id });
      // Fall through with action 'none': leave the hold alone rather than guess. An
      // untouched hold expires on its own in about a week. A guessed capture takes money.
    }

    // ─── v1.105.19 — a fee is RECORDED, not charged on the spot ───
    //
    // "24 hours to reconcile or escalate, otherwise handled by the rules. Silence is
    // consent." The caregiver may waive (it is their lost wage), the family may dispute,
    // and if neither acts the poller captures. Capturing here instead would take the money
    // before the only person entitled to forgive it had been asked.
    //
    // Voids are NOT deferred. Releasing a hold has no downside to anybody and no one needs
    // a window to think about it — deferring it would leave a pending charge sitting on a
    // family's card for a day for no reason at all.
    if (charge.action === "capture") {
      try {
        await db.prepare(`
          UPDATE care_sessions SET
            cancel_fee_status = 'pending',
            cancel_fee_cents = ?,
            cancel_fee_deadline = NOW() + INTERVAL '${CANCEL_FEE_WINDOW_HOURS} hours'
          WHERE id = ?
        `).run(charge.amountCents, req.params.id);

        const amt = `$${(charge.amountCents / 100).toFixed(2)}`;
        if (session.caregiver_user_id) {
          sendPushToUser(session.caregiver_user_id, {
            title: "Late cancellation — you're owed " + amt,
            body: `The family cancelled inside 24 hours. You'll be paid ${amt} automatically tomorrow. Tap if you'd rather waive it.`,
            data: { type: "cancel_fee_pending", sessionId: req.params.id, amountCents: charge.amountCents },
          }, "cancel_fee_pending").catch(() => {});
        }
        sendPushToUser(session.family_user_id, {
          title: "Cancellation fee — " + amt,
          body: `Cancelling inside 24 hours means the caregiver still gets paid. ${amt} will be charged tomorrow unless something's wrong — tap to tell us.`,
          data: { type: "cancel_fee_notice", sessionId: req.params.id, amountCents: charge.amountCents },
        }, "cancel_fee_notice").catch(() => {});
      } catch (e) {
        console.error("[sessions] could not record the cancellation fee:", e.message);
        captureException(e, { where: "sessions: record cancel fee", sessionId: req.params.id });
      }
    } else if (charge.action !== "none") {
      try {
        // Lazy require: accountability.js pulls in this router's siblings, and a top-level
        // require here creates a cycle. Same pattern as the capture call at check-out.
        const { voidSessionPayment } = require("./accountability");
        const result = await voidSessionPayment(req.params.id);
        if (result?.error) {
          // Don't fail the cancellation over this. The session IS cancelled; an untouched
          // hold expires by itself. Losing the cancel because Stripe hiccuped would be
          // worse — the caregiver would still be expected at the door.
          console.warn(`[sessions] ${charge.action} failed for ${req.params.id.slice(0, 8)}: ${result.error}`);
          captureException(new Error(`cancel-${charge.action} failed: ${result.error}`), { sessionId: req.params.id });
        }
      } catch (e) {
        console.error(`[sessions] ${charge.action} threw on cancel:`, e.message);
        captureException(e, { where: "sessions: hold settlement on cancel", sessionId: req.params.id });
      }
    }

    // ─── v1.105.14 — actually TELL the other person ───
    //
    // This handler wrote an activity-feed row and emitted a websocket event, and that was
    // all. The websocket only reaches someone with the app open. So a caregiver with their
    // phone in their pocket, already driving, got nothing — and arrived at the home of a
    // vulnerable person who was not expecting them. That is the failure this fixes; it
    // matters more than the money above.
    //
    // Deliberately NOT wrapped in the emitToUser check: the whole point is that push is
    // the channel that works when the socket isn't connected.
    const pushUserId = cancelledBy === "caregiver" ? session.family_user_id : session.caregiver_user_id;
    if (pushUserId) {
      const when = (() => {
        try {
          const d = new Date(session.scheduled_date.split("T")[0] + "T12:00:00");
          const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
          const t = session.scheduled_time ? ` at ${session.scheduled_time}` : "";
          return `${months[d.getMonth()]} ${d.getDate()}${t}`;
        } catch { return "your upcoming visit"; }
      })();

      // The caregiver-facing copy says "do not travel" explicitly. A cancellation notice
      // that only states a fact leaves the reader to work out the action; when the action
      // is "turn the car around", say it.
      const isForCaregiver = cancelledBy !== "caregiver";
      sendPushToUser(pushUserId, {
        title: isForCaregiver ? "Visit cancelled" : "Caregiver cancelled",
        body: isForCaregiver
          ? `The family cancelled the ${when} visit. Please do not travel to the home.`
          : `Your caregiver cancelled the ${when} visit.${isLateCancel ? " We're finding a replacement." : ""}`,
        data: { type: "session_cancelled", sessionId: req.params.id, cancelledBy },
      }, "session_cancelled").catch(() => {});
    }

    res.json({
      session: updated,
      cancelledBy,
      isLateCancel,
      hasCaregiver,
      // Family can review caregiver if caregiver late-cancelled
      canReview: cancelledBy === "caregiver" && isLateCancel,
      cancelledCaregiverId: cancelledBy === "caregiver" ? session.caregiver_id : null,
      // ⚠️ ADVISORY ONLY — nothing charges on this, and the hold is voided above. Kept in
      // the response so the client can warn "this is a late cancellation", NOT so it can
      // claim money is owed. Do not wire a charge to this without a stated policy.
      chargeApplies: cancelledBy === "family" && isLateCancel,
      // What actually happened to the hold, so the client can tell the truth in the
      // confirmation screen instead of guessing from chargeApplies.
      holdAction: charge.action,
      cancellationFeePercent: charge.feePercent,
      cancellationFeeCents: charge.action === "capture" ? charge.amountCents : 0,
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

    // Any care team member can review (v1.58.29)
    if (userId !== session.family_user_id) {
      const isCareTeam = await db.prepare(`
        SELECT 1 FROM care_team_members ctm
        JOIN care_teams ct ON ctm.care_team_id = ct.id
        WHERE ct.care_recipient_id = ? AND ctm.user_id = ?
        LIMIT 1
      `).get(session.care_recipient_id, userId);
      if (!isCareTeam) {
        return res.status(403).json({ error: "Only care team members can leave a review" });
      }
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

// ─── POST /api/sessions/:id/tip ───
// Family leaves a tip + gratitude reason for the caregiver after a session
router.post("/:id/tip", async (req, res) => {
  try {
    const db = await getDb();
    const userId = req.user.id;
    const { amount_cents, reason_text } = req.body;

    if (!amount_cents || amount_cents < 100) {
      return res.status(400).json({ error: "Minimum tip is $1.00" });
    }
    if (amount_cents > 50000) {
      return res.status(400).json({ error: "Maximum tip is $500" });
    }

    const session = await db.prepare("SELECT * FROM care_sessions WHERE id = ?").get(req.params.id);
    if (!session) return res.status(404).json({ error: "Session not found" });
    if (session.status !== "completed") return res.status(400).json({ error: "Can only tip on completed sessions" });
    if (userId !== session.family_user_id) return res.status(403).json({ error: "Only the family can leave a tip" });
    if (!session.caregiver_id) return res.status(400).json({ error: "No caregiver on this session" });

    // Prevent duplicate tips
    const existing = await db.prepare("SELECT id FROM tips WHERE session_id = ? AND family_user_id = ?").get(req.params.id, userId);
    if (existing) return res.status(409).json({ error: "You already tipped for this session" });

    const tipId = uuid();
    await db.prepare(
      "INSERT INTO tips (id, session_id, family_user_id, caregiver_id, amount_cents, reason_text) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(tipId, req.params.id, userId, session.caregiver_id, amount_cents, reason_text || null);

    // Update gratitude_keywords on caregiver_profiles if reason provided
    if (reason_text && reason_text.trim()) {
      try {
        const profile = await db.prepare("SELECT gratitude_keywords FROM caregiver_profiles WHERE id = ?").get(session.caregiver_id);
        const keywords = profile?.gratitude_keywords ? JSON.parse(profile.gratitude_keywords) : [];
        keywords.push({ text: reason_text.trim(), date: new Date().toISOString().slice(0, 10), session_id: req.params.id });
        // Keep last 50 entries
        const trimmed = keywords.slice(-50);
        await db.prepare("UPDATE caregiver_profiles SET gratitude_keywords = ? WHERE id = ?").run(JSON.stringify(trimmed), session.caregiver_id);
      } catch (e) { console.error("Gratitude keywords update error:", e); }
    }

    res.json({ tip: { id: tipId, amount_cents, reason_text } });
  } catch (err) {
    console.error("Tip error:", err);
    res.status(500).json({ error: "Failed to save tip" });
  }
});

// ─── GET /api/sessions/tips/caregiver ───
// Caregiver views their tips
router.get("/tips/caregiver", async (req, res) => {
  try {
    const db = await getDb();
    const userId = req.user.id;
    const profile = await db.prepare("SELECT id FROM caregiver_profiles WHERE user_id = ?").get(userId);
    if (!profile) return res.status(404).json({ error: "Caregiver profile not found" });

    const tips = await db.prepare(`
      SELECT t.*, cs.scheduled_date, cs.service_type,
        u.first_name || ' ' || u.last_name AS family_name
      FROM tips t
      JOIN care_sessions cs ON t.session_id = cs.id
      JOIN users u ON t.family_user_id = u.id
      WHERE t.caregiver_id = ?
      ORDER BY t.created_at DESC
      LIMIT 100
    `).all(profile.id);

    const totalCents = tips.reduce((sum, t) => sum + (t.amount_cents || 0), 0);
    res.json({ tips, totalCents });
  } catch (err) {
    console.error("Fetch tips error:", err);
    res.status(500).json({ error: "Failed to fetch tips" });
  }
});

// ─── GET /api/sessions/:id/tip ───
// Check if a tip already exists for this session
router.get("/:id/tip", async (req, res) => {
  try {
    const db = await getDb();
    const tip = await db.prepare("SELECT * FROM tips WHERE session_id = ? AND family_user_id = ?").get(req.params.id, req.user.id);
    res.json({ tip: tip || null });
  } catch (err) {
    res.status(500).json({ error: "Failed to check tip" });
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

  // Cost breakdown — proposed_rate (family's offer) ALWAYS wins when stored on session.
  // Caregiver profile rates are only used when no proposed rate was set.
  let costBreakdown = null;
  if (session.scheduled_date && session.scheduled_time) {
    const proposedRate = parseFloat(session.proposed_rate) || 0;
    const rates = proposedRate > 0
      ? { daytime: proposedRate, nighttime: proposedRate, overnight: proposedRate, base: proposedRate }
      : {
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

    // Overtime info (from completed sessions)
    const otMinutes = parseInt(session.overtime_minutes) || 0;
    const otCost = parseFloat(session.overtime_cost) || 0;
    if (otMinutes > 0) {
      costBreakdown.overtimeMinutes = otMinutes;
      costBreakdown.overtimeCost = otCost;
      // Add overtime platform fee
      const otPlatformFee = Math.round(otCost * (feePercent / 100) * 100) / 100;
      costBreakdown.overtimePlatformFee = otPlatformFee;
      costBreakdown.familyTotal = Math.round((costBreakdown.familyTotal + otCost + otPlatformFee) * 100) / 100;
      costBreakdown.caregiverPayout = Math.round((costBreakdown.caregiverPayout + otCost) * 100) / 100;
    }
    costBreakdown.flexPolicy = session.flex_timing || 'strict';
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
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(); // 2-hour response window
    await db.prepare(`
      INSERT INTO time_proposals (id, session_id, caregiver_profile_id, caregiver_user_id, proposed_date, proposed_time, message, status, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `).run(proposalId, req.params.id, profile.id, userId, proposedDate, proposedTime, message || null, expiresAt);

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
    const body = `${caregiverName} would like to care for ${session.recipient_first_name} on ${proposedDate} at ${timeStr} instead. You have 2 hours to respond.`;

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

    // Email notification to family
    try {
      const { sendEmail, brandedHtml } = require("../utils/email");
      const familyUser = await db.prepare("SELECT email, first_name FROM users WHERE id = ?").get(session.family_user_id);
      if (familyUser?.email) {
        const origTime = (() => { const [h2, m2] = (session.scheduled_time || '').split(':'); const hr = parseInt(h2); return `${hr === 0 ? 12 : hr > 12 ? hr - 12 : hr}:${m2} ${hr >= 12 ? 'PM' : 'AM'}`; })();
        const appUrl = process.env.APP_URL || 'https://inplace.care';
        await sendEmail({
          to: familyUser.email,
          subject: `${caregiverName} proposed a different time for ${session.recipient_first_name}'s care`,
          html: brandedHtml({
            heading: 'New Time Proposal',
            body: `<p>Hi ${familyUser.first_name},</p>
              <p><strong>${caregiverName}</strong> would like to care for <strong>${session.recipient_first_name}</strong> but proposed a different time:</p>
              <table style="margin: 16px 0; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 16px 8px 0; color: #888; font-size: 14px;">Original:</td>
                  <td style="padding: 8px 0; text-decoration: line-through; color: #999;">${proposedDate === (session.scheduled_date || '').split('T')[0] ? '' : session.scheduled_date + ' at '}${origTime}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 16px 8px 0; color: #7b61ff; font-weight: 600; font-size: 14px;">Proposed:</td>
                  <td style="padding: 8px 0; color: #7b61ff; font-weight: 600; font-size: 16px;">${proposedDate} at ${timeStr}</td>
                </tr>
              </table>
              ${message ? `<p style="background: #f5f0ff; padding: 10px 14px; border-radius: 8px; font-style: italic; color: #555;">"${message}"</p>` : ''}
              <p style="background: #fff3e0; padding: 10px 14px; border-radius: 8px; color: #e65100; font-weight: 600;">\u23F1 You have 2 hours to accept or decline this proposal.</p>`,
            ctaText: 'Review Proposal',
            ctaUrl: `${appUrl}/dashboard`,
          }),
        }).catch(err => console.error('Proposal email error:', err));
      }
    } catch (emailErr) {
      console.error('Proposal email notification error:', emailErr);
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
    // Check if proposal has expired
    if (proposal.expires_at && new Date(proposal.expires_at) < new Date()) {
      await db.prepare("UPDATE time_proposals SET status = 'expired', responded_at = NOW() WHERE id = ?").run(req.params.proposalId);
      return res.status(400).json({ error: "This proposal has expired. The 2-hour response window has passed." });
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

    // Auto-create assignment so caregiver appears in future "Request Care" lists
    try {
      await ensureAssignment(db, {
        careRecipientId: proposal.care_recipient_id,
        familyUserId: proposal.family_user_id,
        caregiverProfileId: proposal.caregiver_profile_id,
      });
    } catch (assignErr) { console.error('[proposal-accept] ensureAssignment error:', assignErr.message); }

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
module.exports.expireStaleProposals = expireStaleProposals;
