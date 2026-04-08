// ─── Session Accountability System ───
// Handles: payment authorization (24hrs before), late check-in resolution,
// no-show handling, family no-show, review gating, and session disputes.

const express = require("express");
const { v4: uuid } = require("uuid");
const { getDb } = require("../models/database");
const { authenticate, requireRole } = require("../middleware/auth");
const { calculateSessionCost, SURCHARGE_PLATFORM_SHARE } = require("../utils/rateCalculator");
const { getNowInZone, buildDateTimeInZone } = require("../utils/timezone");
const { sendPushToUser } = require("./push");
const ticketRouter = require("./tickets");

// emitToUser injected from server.js at startup
let _emitToUser = null;
function setEmitToUser(fn) { _emitToUser = fn; }

const router = express.Router();
router.use(authenticate);

const PLATFORM_FEE_PERCENT = 20;
const LATE_GRACE_MINUTES = 10;
const FAMILY_NO_SHOW_WAIT_MINUTES = 30;

// ─── Stripe initialization (shared with payments.js) ───
let _stripe = null;
function getStripe() {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY || process.env.stripe_secret_key;
    if (!key) throw new Error("STRIPE_SECRET_KEY not configured");
    _stripe = require("stripe")(key);
  }
  return _stripe;
}

// ═══════════════════════════════════════════════════════════════════
// 1. PAYMENT AUTHORIZATION — Called by server poller 24hrs before session
// ═══════════════════════════════════════════════════════════════════

/**
 * Authorize payment for a session (called internally by the poller, not by API).
 * Creates a Stripe PaymentIntent with capture_method: 'manual' (hold, don't charge).
 * Returns { success, paymentIntentId } or { error }.
 */
async function authorizeSessionPayment(sessionId) {
  try {
    const db = await getDb();
    const stripe = getStripe();

    const session = await db.prepare(`
      SELECT cs.*, cp.stripe_account_id, cp.stripe_onboard_complete,
        cp.hourly_rate, cp.rate_daytime, cp.rate_nighttime, cp.rate_overnight,
        cp.user_id AS caregiver_user_id, cp.identity_verified,
        u2.first_name || ' ' || u2.last_name AS caregiver_name,
        cr.first_name || ' ' || cr.last_name AS recipient_name,
        fam.stripe_customer_id
      FROM care_sessions cs
      LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
      LEFT JOIN users u2 ON cp.user_id = u2.id
      LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
      LEFT JOIN users fam ON cs.family_user_id = fam.id
      WHERE cs.id = ?
    `).get(sessionId);

    if (!session) return { error: "Session not found" };
    if (session.stripe_payment_intent_id) return { error: "Already authorized" };
    if (!session.stripe_customer_id) return { error: "Family has no payment method on file" };
    if (!session.stripe_account_id || !session.stripe_onboard_complete) return { error: "Caregiver Stripe not set up" };
    if (!session.identity_verified) return { error: "Caregiver identity not verified" };

    // Calculate cost
    const durationHours = session.duration_hours || 2;
    let totalCents, baseCostCents, surchargeCents = 0;

    if (session.agreed_rate) {
      baseCostCents = Math.round(session.agreed_rate * durationHours * 100);
      surchargeCents = Math.round((session.short_notice_surcharge || 0) * 100);
      totalCents = baseCostCents + surchargeCents;
    } else {
      const costResult = calculateSessionCost(session.scheduled_time, null, {
        daytime: session.rate_daytime || session.hourly_rate || 28,
        nighttime: session.rate_nighttime || session.hourly_rate || 28,
        overnight: session.rate_overnight || session.hourly_rate || 28,
        base: session.hourly_rate || 28,
      }, {
        scheduledDate: session.scheduled_date,
        durationHours,
        shortNotice: (session.short_notice_surcharge || 0) > 0,
      });
      baseCostCents = Math.round(costResult.subtotal * 100);
      surchargeCents = Math.round(costResult.surcharge * 100);
      totalCents = Math.round(costResult.total * 100);
    }

    // Platform fee
    let platformFeeCents = Math.round(baseCostCents * PLATFORM_FEE_PERCENT / 100);
    if (surchargeCents > 0) {
      platformFeeCents += Math.round(surchargeCents * SURCHARGE_PLATFORM_SHARE);
    }

    // Create PaymentIntent with manual capture (authorize only, don't charge yet)
    const paymentIntent = await stripe.paymentIntents.create({
      amount: totalCents,
      currency: "usd",
      customer: session.stripe_customer_id,
      capture_method: "manual",
      application_fee_amount: platformFeeCents,
      transfer_data: {
        destination: session.stripe_account_id,
      },
      metadata: {
        inplace_session_id: sessionId,
        inplace_family_user_id: session.family_user_id,
        inplace_caregiver_id: session.caregiver_id,
        type: "session_authorization",
      },
      description: `Care session — ${session.recipient_name || "Care Recipient"} on ${session.scheduled_date} (${durationHours}h)`,
      // Attempt to confirm immediately using customer's default payment method
      confirm: true,
      payment_method: undefined, // will use customer's default
      off_session: true,
    });

    // Store authorization on session
    await db.prepare(`
      UPDATE care_sessions SET
        stripe_payment_intent_id = ?,
        payment_authorized_at = NOW(),
        authorized_amount = ?,
        payment_status = 'authorized'
      WHERE id = ?
    `).run(paymentIntent.id, totalCents, sessionId);

    console.log(`[accountability] Authorized $${(totalCents / 100).toFixed(2)} for session ${sessionId.slice(0, 8)} (PI: ${paymentIntent.id})`);
    return { success: true, paymentIntentId: paymentIntent.id, amount: totalCents };

  } catch (err) {
    console.error(`[accountability] Auth failed for session ${sessionId.slice(0, 8)}:`, err.message);
    return { error: err.message };
  }
}

/**
 * Capture (charge) an authorized payment — called after caregiver checks out.
 * Can capture a partial amount if session was shortened.
 */
async function captureSessionPayment(sessionId, captureAmountCents = null) {
  try {
    const db = await getDb();
    const stripe = getStripe();

    const session = await db.prepare(
      "SELECT stripe_payment_intent_id, authorized_amount FROM care_sessions WHERE id = ?"
    ).get(sessionId);

    if (!session?.stripe_payment_intent_id) return { error: "No payment authorization found" };

    const captureParams = {};
    if (captureAmountCents !== null && captureAmountCents < session.authorized_amount) {
      captureParams.amount_to_capture = captureAmountCents;
    }

    const captured = await stripe.paymentIntents.capture(
      session.stripe_payment_intent_id,
      captureParams
    );

    await db.prepare(`
      UPDATE care_sessions SET
        payment_captured_at = NOW(),
        payment_status = 'paid'
      WHERE id = ?
    `).run(sessionId);

    console.log(`[accountability] Captured $${((captureAmountCents || session.authorized_amount) / 100).toFixed(2)} for session ${sessionId.slice(0, 8)}`);
    return { success: true, captured: captured.amount_received };

  } catch (err) {
    console.error(`[accountability] Capture failed for session ${sessionId.slice(0, 8)}:`, err.message);
    return { error: err.message };
  }
}

/**
 * Void (cancel) an authorized payment — called for no-shows, cancellations.
 */
async function voidSessionPayment(sessionId) {
  try {
    const db = await getDb();
    const stripe = getStripe();

    const session = await db.prepare(
      "SELECT stripe_payment_intent_id FROM care_sessions WHERE id = ?"
    ).get(sessionId);

    if (!session?.stripe_payment_intent_id) return { error: "No payment authorization found" };

    await stripe.paymentIntents.cancel(session.stripe_payment_intent_id);

    await db.prepare(`
      UPDATE care_sessions SET
        payment_voided_at = NOW(),
        payment_status = 'voided'
      WHERE id = ?
    `).run(sessionId);

    console.log(`[accountability] Voided payment for session ${sessionId.slice(0, 8)}`);
    return { success: true };

  } catch (err) {
    console.error(`[accountability] Void failed for session ${sessionId.slice(0, 8)}:`, err.message);
    return { error: err.message };
  }
}


// ═══════════════════════════════════════════════════════════════════
// 2. LATE CHECK-IN RESOLUTION
// ═══════════════════════════════════════════════════════════════════

// GET /api/accountability/late-check-in/:sessionId
// Returns late check-in info for a session (used by family dashboard)
router.get("/late-check-in/:sessionId", async (req, res) => {
  try {
    const db = await getDb();
    const session = await db.prepare(`
      SELECT cs.id, cs.late_check_in, cs.late_minutes, cs.late_resolution,
        cs.scheduled_date, cs.scheduled_time, cs.duration_hours,
        cs.family_user_id, cs.caregiver_id,
        u.first_name || ' ' || u.last_name AS caregiver_name
      FROM care_sessions cs
      LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
      LEFT JOIN users u ON cp.user_id = u.id
      WHERE cs.id = ? AND (cs.family_user_id = ? OR cp.user_id = ?)
    `).get(req.params.sessionId, req.user.id, req.user.id);

    if (!session) return res.status(404).json({ error: "Session not found" });
    res.json(session);
  } catch (err) {
    console.error("Late check-in info error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/accountability/late-resolution/:sessionId
// Family chooses: extend session or keep original end time (truncate)
router.post("/late-resolution/:sessionId", requireRole("family"), async (req, res) => {
  try {
    const db = await getDb();
    const { resolution } = req.body; // 'extend' or 'truncate'

    if (!["extend", "truncate"].includes(resolution)) {
      return res.status(400).json({ error: "Resolution must be 'extend' or 'truncate'" });
    }

    const session = await db.prepare(`
      SELECT cs.*, cp.user_id AS caregiver_user_id,
        u.first_name AS cg_first
      FROM care_sessions cs
      LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
      LEFT JOIN users u ON cp.user_id = u.id
      WHERE cs.id = ? AND cs.family_user_id = ?
    `).get(req.params.sessionId, req.user.id);

    if (!session) return res.status(404).json({ error: "Session not found" });
    if (!session.late_check_in) return res.status(400).json({ error: "Session is not flagged as late check-in" });
    if (session.late_resolution) return res.status(400).json({ error: "Resolution already chosen" });

    await db.prepare(`
      UPDATE care_sessions SET late_resolution = ?, late_resolution_at = NOW() WHERE id = ?
    `).run(resolution, req.params.sessionId);

    // Notify caregiver of the decision
    const emitToUser = req.app.get("emitToUser");
    if (emitToUser && session.caregiver_user_id) {
      const msg = resolution === "extend"
        ? `The family has agreed to extend your session by ${session.late_minutes} minutes.`
        : `The family chose to keep the original end time. Your session will end as originally scheduled.`;
      emitToUser(session.caregiver_user_id, "late_resolution", {
        sessionId: req.params.sessionId,
        resolution,
        lateMinutes: session.late_minutes,
        message: msg,
      });
    }

    // Push notification to caregiver
    try {
      const sendPush = req.app.get("sendPush");
      if (sendPush) {
        await sendPush(session.caregiver_user_id, {
          title: resolution === "extend" ? "Session Extended" : "Keep Original End Time",
          body: resolution === "extend"
            ? `Session extended by ${session.late_minutes} minutes.`
            : "The family chose to keep the original end time.",
          data: { type: "late_resolution", sessionId: req.params.sessionId },
        });
      }
    } catch {}

    res.json({ success: true, resolution });
  } catch (err) {
    console.error("Late resolution error:", err);
    res.status(500).json({ error: "Server error" });
  }
});


// ═══════════════════════════════════════════════════════════════════
// 3. NO-SHOW HANDLING
// ═══════════════════════════════════════════════════════════════════

// POST /api/accountability/family-no-show/:sessionId
// Caregiver flags "nobody home" — starts 30-min wait timer
router.post("/family-no-show/:sessionId", async (req, res) => {
  try {
    const db = await getDb();
    const session = await db.prepare(`
      SELECT cs.*, cp.user_id AS caregiver_user_id
      FROM care_sessions cs
      LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
      WHERE cs.id = ? AND cp.user_id = ?
    `).get(req.params.sessionId, req.user.id);

    if (!session) return res.status(404).json({ error: "Session not found or not your session" });
    if (session.status !== "in_progress") {
      return res.status(400).json({ error: "Must be checked in to flag family no-show" });
    }

    await db.prepare(`
      UPDATE care_sessions SET family_no_show = 1, family_no_show_flagged_at = NOW() WHERE id = ?
    `).run(req.params.sessionId);

    // Notify family
    const emitToUser = req.app.get("emitToUser");
    if (emitToUser) {
      emitToUser(session.family_user_id, "family_no_show", {
        sessionId: req.params.sessionId,
        message: "Your caregiver has arrived but nobody is home. They will wait 30 minutes.",
      });
    }

    // Push to family
    try {
      const sendPush = req.app.get("sendPush");
      if (sendPush) {
        await sendPush(session.family_user_id, {
          title: "Caregiver Arrived — Nobody Home",
          body: "Your caregiver has arrived but nobody is available. They will wait 30 minutes. Full charges may apply.",
          data: { type: "family_no_show", sessionId: req.params.sessionId },
        });
      }
    } catch {}

    res.json({
      success: true,
      waitUntil: new Date(Date.now() + FAMILY_NO_SHOW_WAIT_MINUTES * 60000).toISOString(),
      message: `Wait 30 minutes, then you may check out for full pay.`,
    });
  } catch (err) {
    console.error("Family no-show error:", err);
    res.status(500).json({ error: "Server error" });
  }
});


// ═══════════════════════════════════════════════════════════════════
// 4. REVIEW GATING
// ═══════════════════════════════════════════════════════════════════

// GET /api/accountability/pending-reviews
// Returns sessions that need review OR need payment (reviewed but unpaid)
router.get("/pending-reviews", requireRole("family"), async (req, res) => {
  try {
    const db = await getDb();
    // Sessions needing review (not yet reviewed)
    const needsReview = await db.prepare(`
      SELECT cs.id, cs.scheduled_date, cs.scheduled_time, cs.duration_hours,
        cs.caregiver_id, cs.status, cs.caregiver_no_show,
        cs.payment_due_at, cs.payment_status, cs.estimated_cost, cs.short_notice_surcharge,
        cs.service_type, cs.proposed_rate, cs.review_completed,
        cs.pending_tip_cents, cs.pending_tip_reason,
        u.first_name || ' ' || u.last_name AS caregiver_name,
        cr.first_name AS recipient_first_name,
        cs.review_reminded_at
      FROM care_sessions cs
      LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
      LEFT JOIN users u ON cp.user_id = u.id
      LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
      WHERE cs.family_user_id = ?
        AND cs.review_required = 1
        AND cs.review_completed = 0
        AND (cs.status = 'completed' OR (cs.status = 'cancelled' AND cs.caregiver_no_show = 1))
      ORDER BY cs.scheduled_date DESC
    `).all(req.user.id);

    // v1.56.3 — Sessions reviewed but NOT paid (payment fell through)
    const reviewedUnpaid = await db.prepare(`
      SELECT cs.id, cs.scheduled_date, cs.scheduled_time, cs.duration_hours,
        cs.caregiver_id, cs.status, cs.caregiver_no_show,
        cs.payment_due_at, cs.payment_status, cs.estimated_cost, cs.short_notice_surcharge,
        cs.service_type, cs.proposed_rate, cs.review_completed,
        cs.pending_tip_cents, cs.pending_tip_reason,
        u.first_name || ' ' || u.last_name AS caregiver_name,
        cr.first_name AS recipient_first_name,
        cs.review_reminded_at
      FROM care_sessions cs
      LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
      LEFT JOIN users u ON cp.user_id = u.id
      LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
      WHERE cs.family_user_id = ?
        AND cs.review_completed = 1
        AND cs.status = 'completed'
        AND cs.estimated_cost > 0
        AND (cs.payment_status IS NULL OR cs.payment_status = 'pending')
        AND NOT EXISTS (
          SELECT 1 FROM payments p WHERE p.session_id = cs.id AND p.status = 'completed'
        )
      ORDER BY cs.scheduled_date DESC
    `).all(req.user.id);

    res.json({ pendingReviews: [...(needsReview || []), ...(reviewedUnpaid || [])] });
  } catch (err) {
    console.error("Pending reviews error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/accountability/can-book/:caregiverId
// Check if family can book this caregiver (no outstanding reviews for them)
router.get("/can-book/:caregiverId", requireRole("family", "care_for"), async (req, res) => {
  try {
    const db = await getDb();
    // Only block rebooking for completed sessions — no-show reviews are optional (shown on dashboard but don't gate booking)
    const unreviewed = await db.prepare(`
      SELECT id FROM care_sessions
      WHERE family_user_id = ?
        AND caregiver_id = ?
        AND review_required = 1
        AND review_completed = 0
        AND status = 'completed'
      LIMIT 1
    `).get(req.user.id, req.params.caregiverId);

    res.json({
      canBook: !unreviewed,
      blockedByReview: !!unreviewed,
      sessionId: unreviewed?.id || null,
    });
  } catch (err) {
    console.error("Can-book check error:", err);
    res.status(500).json({ error: "Server error" });
  }
});


// ═══════════════════════════════════════════════════════════════════
// 5. SESSION DISPUTES
// ═══════════════════════════════════════════════════════════════════

// POST /api/accountability/dispute
// File a dispute for a session (available to both family and caregiver)
router.post("/dispute", async (req, res) => {
  try {
    const db = await getDb();
    const { sessionId, reason, description } = req.body;

    if (!sessionId || !reason) {
      return res.status(400).json({ error: "sessionId and reason are required" });
    }

    // Verify user is part of this session
    const session = await db.prepare(`
      SELECT cs.*, cp.user_id AS caregiver_user_id
      FROM care_sessions cs
      LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
      WHERE cs.id = ?
    `).get(sessionId);

    if (!session) return res.status(404).json({ error: "Session not found" });

    const isFamily = session.family_user_id === req.user.id;
    const isCaregiver = session.caregiver_user_id === req.user.id;
    if (!isFamily && !isCaregiver) {
      return res.status(403).json({ error: "You are not part of this session" });
    }

    // Check for existing open dispute
    const existing = await db.prepare(
      "SELECT id FROM session_disputes WHERE session_id = ? AND filed_by = ? AND status = 'open'"
    ).get(sessionId, req.user.id);
    if (existing) return res.status(400).json({ error: "You already have an open dispute for this session" });

    const disputeId = uuid();
    await db.prepare(`
      INSERT INTO session_disputes (id, session_id, filed_by, filed_by_role, reason, description, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'open', NOW())
    `).run(disputeId, sessionId, req.user.id, isFamily ? "family" : "caregiver", reason, description || null);

    // Notify admins
    try {
      const notifyAdmins = req.app.get("notifyAdmins");
      if (notifyAdmins) {
        await notifyAdmins("dispute_filed", {
          title: "New Session Dispute",
          body: `${isFamily ? "Family" : "Caregiver"} filed a dispute: ${reason}`,
          data: { type: "dispute", disputeId, sessionId },
        });
      }
    } catch {}

    res.json({ success: true, disputeId });
  } catch (err) {
    console.error("Dispute error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/accountability/disputes
// Get user's disputes
router.get("/disputes", async (req, res) => {
  try {
    const db = await getDb();
    const disputes = await db.prepare(`
      SELECT sd.*, cs.scheduled_date, cs.scheduled_time,
        CASE WHEN sd.filed_by_role = 'family'
          THEN (SELECT u.first_name || ' ' || u.last_name FROM caregiver_profiles cp2 JOIN users u ON cp2.user_id = u.id WHERE cp2.id = cs.caregiver_id)
          ELSE (SELECT u.first_name || ' ' || u.last_name FROM users u WHERE u.id = cs.family_user_id)
        END AS other_party_name
      FROM session_disputes sd
      JOIN care_sessions cs ON sd.session_id = cs.id
      WHERE sd.filed_by = ?
      ORDER BY sd.created_at DESC
    `).all(req.user.id);

    res.json({ disputes: disputes || [] });
  } catch (err) {
    console.error("Disputes list error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/accountability/disputes/admin
// Admin: view all open disputes
router.get("/disputes/admin", requireRole("family"), async (req, res) => {
  try {
    if (!req.user.isAdmin) return res.status(403).json({ error: "Admin only" });
    const db = await getDb();
    const disputes = await db.prepare(`
      SELECT sd.*,
        cs.scheduled_date, cs.scheduled_time, cs.duration_hours,
        cs.family_user_id, cs.caregiver_id,
        fu.first_name || ' ' || fu.last_name AS family_name,
        cu.first_name || ' ' || cu.last_name AS caregiver_name
      FROM session_disputes sd
      JOIN care_sessions cs ON sd.session_id = cs.id
      LEFT JOIN users fu ON cs.family_user_id = fu.id
      LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
      LEFT JOIN users cu ON cp.user_id = cu.id
      ORDER BY
        CASE sd.status WHEN 'open' THEN 0 WHEN 'investigating' THEN 1 ELSE 2 END,
        sd.created_at DESC
    `).all();

    res.json({ disputes: disputes || [] });
  } catch (err) {
    console.error("Admin disputes error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// PUT /api/accountability/disputes/:id/resolve
// Admin resolves a dispute
router.put("/disputes/:id/resolve", requireRole("family"), async (req, res) => {
  try {
    if (!req.user.isAdmin) return res.status(403).json({ error: "Admin only" });
    const db = await getDb();
    const { status, adminNotes } = req.body; // 'resolved', 'dismissed', 'investigating'

    if (!["resolved", "dismissed", "investigating"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    await db.prepare(`
      UPDATE session_disputes SET
        status = ?, admin_notes = ?, resolved_by = ?,
        resolved_at = CASE WHEN ? IN ('resolved', 'dismissed') THEN NOW() ELSE resolved_at END
      WHERE id = ?
    `).run(status, adminNotes || null, req.user.id, status, req.params.id);

    res.json({ success: true });
  } catch (err) {
    console.error("Resolve dispute error:", err);
    res.status(500).json({ error: "Server error" });
  }
});


// ═══════════════════════════════════════════════════════════════════
// 6. POLLER FUNCTIONS — called from server.js setInterval
// ═══════════════════════════════════════════════════════════════════

/**
 * Check for sessions 24 hours out that need payment authorization.
 * Called every poll cycle from server.js.
 */
async function pollPaymentAuthorizations() {
  try {
    const db = await getDb();

    // Find confirmed sessions ~24 hours from now that haven't been authorized yet
    // Window: 23h to 25h from now (so we don't miss any)
    // Include care recipient timezone for accurate timing
    const sessions = await db.prepare(`
      SELECT cs.id, cs.scheduled_date, cs.scheduled_time, cs.family_user_id,
        cr.timezone AS care_timezone
      FROM care_sessions cs
      JOIN users u ON cs.family_user_id = u.id
      LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
      LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
      LEFT JOIN users cu ON cp.user_id = cu.id
      WHERE cs.status = 'confirmed'
        AND cs.stripe_payment_intent_id IS NULL
        AND cs.payment_status IS NULL
        AND (u.is_demo IS NULL OR u.is_demo = 0)
        AND (cu.is_demo IS NULL OR cu.is_demo = 0)
        AND cs.scheduled_date IS NOT NULL
        AND cs.scheduled_time IS NOT NULL
    `).all();

    if (!sessions || sessions.length === 0) return;

    for (const s of sessions) {
      try {
        const tz = s.care_timezone || 'America/New_York';
        const now = getNowInZone(tz);
        const dateStr = s.scheduled_date.split('T')[0];
        const sessionStart = buildDateTimeInZone(dateStr, s.scheduled_time, tz);
        const hoursUntil = (sessionStart - now) / 3600000;

        // Authorize if within 23-25 hour window (or if session is <24hrs out and not yet authorized)
        if (hoursUntil > 0 && hoursUntil <= 25) {
          console.log(`[accountability] Authorizing payment for session ${s.id.slice(0, 8)} (${hoursUntil.toFixed(1)}h away)`);
          const result = await authorizeSessionPayment(s.id);
          if (result.error) {
            console.warn(`[accountability] Auth skipped for ${s.id.slice(0, 8)}: ${result.error}`);
          }
        }
      } catch (err) {
        console.error(`[accountability] Auth poll error for ${s.id.slice(0, 8)}:`, err.message);
      }
    }
  } catch (err) {
    console.error("[accountability] pollPaymentAuthorizations error:", err.message);
  }
}

/**
 * Detect late check-ins and flag sessions.
 * Called every poll cycle from server.js.
 */
async function pollLateCheckIns() {
  try {
    const db = await getDb();

    // Find in_progress sessions where check-in was late
    // (checked in 10+ minutes after scheduled start, not yet flagged)
    // Include care recipient timezone for accurate timing
    const sessions = await db.prepare(`
      SELECT cs.id, cs.scheduled_date, cs.scheduled_time, cs.family_user_id,
        cs.caregiver_id, cs.late_check_in,
        vl.check_in_time,
        cp.user_id AS caregiver_user_id,
        u.first_name AS cg_first,
        cr.timezone AS care_timezone
      FROM care_sessions cs
      JOIN visit_logs vl ON cs.id = vl.session_id
      JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
      JOIN users u ON cp.user_id = u.id
      JOIN users fu ON cs.family_user_id = fu.id
      LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
      WHERE cs.status = 'in_progress'
        AND cs.late_check_in = 0
        AND vl.check_in_time IS NOT NULL
        AND (fu.is_demo IS NULL OR fu.is_demo = 0)
        AND (u.is_demo IS NULL OR u.is_demo = 0)
    `).all();

    if (!sessions || sessions.length === 0) return;

    for (const s of sessions) {
      try {
        const tz = s.care_timezone || 'America/New_York';
        const dateStr = s.scheduled_date.split('T')[0];
        const scheduledStart = buildDateTimeInZone(dateStr, s.scheduled_time, tz);
        const checkInTime = new Date(s.check_in_time);
        const lateMinutes = Math.floor((checkInTime - scheduledStart) / 60000);

        if (lateMinutes >= LATE_GRACE_MINUTES) {
          await db.prepare(`
            UPDATE care_sessions SET late_check_in = 1, late_minutes = ? WHERE id = ?
          `).run(lateMinutes, s.id);

          console.log(`[accountability] Flagged late check-in: session ${s.id.slice(0, 8)}, ${lateMinutes} min late`);

          // Notify family — push notification with choice
          // The family will see this on their dashboard and can choose extend/truncate
        }
      } catch (err) {
        console.error(`[accountability] Late check-in poll error for ${s.id.slice(0, 8)}:`, err.message);
      }
    }
  } catch (err) {
    console.error("[accountability] pollLateCheckIns error:", err.message);
  }
}

/**
 * Detect caregiver no-shows (session start + grace period passed, no check-in).
 * Called every poll cycle from server.js.
 */
async function pollCaregiverNoShows() {
  try {
    const db = await getDb();

    // Find confirmed sessions past start + grace with no check-in
    // Include care recipient timezone for accurate timing
    const sessions = await db.prepare(`
      SELECT cs.id, cs.scheduled_date, cs.scheduled_time, cs.family_user_id,
        cs.caregiver_id, cs.caregiver_no_show,
        cp.user_id AS caregiver_user_id,
        cr.first_name || ' ' || cr.last_name AS recipient_name,
        cr.timezone AS care_timezone,
        cu.first_name AS caregiver_first_name
      FROM care_sessions cs
      LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
      LEFT JOIN users cu ON cp.user_id = cu.id
      LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
      JOIN users u ON cs.family_user_id = u.id
      WHERE cs.status = 'confirmed'
        AND cs.caregiver_no_show = 0
        AND cs.caregiver_id IS NOT NULL
        AND (u.is_demo IS NULL OR u.is_demo = 0)
        AND (cu.is_demo IS NULL OR cu.is_demo = 0)
        AND cs.scheduled_date IS NOT NULL
        AND cs.scheduled_time IS NOT NULL
        AND cs.notifications_sent NOT LIKE '%no_show_flagged%'
        AND NOT EXISTS (
          SELECT 1 FROM admin_audit_log
          WHERE target_id = cs.id::text AND action = 'restore_session'
        )
    `).all();

    if (!sessions || sessions.length === 0) return;

    for (const s of sessions) {
      try {
        const tz = s.care_timezone || 'America/New_York';
        const now = getNowInZone(tz);
        const dateStr = s.scheduled_date.split('T')[0];
        const scheduledStart = buildDateTimeInZone(dateStr, s.scheduled_time, tz);
        const minutesPastStart = (now - scheduledStart) / 60000;

        // After the session's FULL duration has passed (not just 10 min) — caregiver never showed
        // We use 10 min grace after SCHEDULED END as the no-show window
        // Actually per Pete: "the time passes, then there's no payment" — so after scheduled end + grace
        // But for immediate flagging, we can flag as potential no-show earlier and let admin/family act
        // ── 20-min warning: push nudge to caregiver to finish check-in ──
        if (minutesPastStart >= 20 && minutesPastStart < 30
            && !(s.notifications_sent || '').includes('checkin_nudge')
            && s.caregiver_user_id) {
          const nudgeRecipName = s.recipient_name || 'your client';
          sendPushToUser(s.caregiver_user_id, {
            title: "Finish Checking In",
            body: `You started checking in for ${nudgeRecipName} but didn't finish. Tap to complete — you'll be marked as a no-show in 10 minutes.`,
            data: { type: "checkin_nudge", sessionId: s.id },
          }, "checkin_nudge").catch(() => {});
          if (_emitToUser) {
            _emitToUser(s.caregiver_user_id, "checkin_nudge", {
              sessionId: s.id,
              message: `Complete your check-in for ${nudgeRecipName} — no-show in 10 minutes.`,
            });
          }
          await db.prepare(`
            UPDATE care_sessions SET notifications_sent = COALESCE(notifications_sent, '') || ',checkin_nudge'
            WHERE id = ?
          `).run(s.id);
          console.log(`[accountability] Check-in nudge sent to caregiver for session ${s.id.slice(0, 8)}`);
        }

        // Flag after session start + 30 min if still not checked in
        if (minutesPastStart >= 30) {
          await db.prepare(`
            UPDATE care_sessions SET
              caregiver_no_show = 1,
              caregiver_no_show_at = NOW(),
              status = 'cancelled',
              cancelled_at = NOW(),
              cancelled_by = 'system',
              notifications_sent = COALESCE(notifications_sent, '') || ',no_show_flagged',
              review_required = 1
            WHERE id = ?
          `).run(s.id);

          // Void the payment authorization if it exists
          await voidSessionPayment(s.id);

          // ─── Notify caregiver that session was marked no-show ───
          const recipientName = s.recipient_name || 'your client';
          if (s.caregiver_user_id) {
            // Push notification
            sendPushToUser(s.caregiver_user_id, {
              title: "Session Cancelled — No Check-In",
              body: `Your session for ${recipientName} on ${s.scheduled_date} was cancelled because no check-in was recorded within 30 minutes of the start time.`,
              data: { type: "no_show_cancelled", sessionId: s.id },
            }, "no_show_cancelled").catch(() => {});
            // WebSocket
            if (_emitToUser) {
              _emitToUser(s.caregiver_user_id, "session_update", {
                sessionId: s.id, status: "cancelled", reason: "no_show",
                message: `Session for ${recipientName} cancelled — no check-in recorded.`,
              });
            }
          }

          // ─── Notify family that caregiver didn't show ───
          if (s.family_user_id) {
            const caregiverName = s.caregiver_first_name || 'Your caregiver';
            sendPushToUser(s.family_user_id, {
              title: "Caregiver No-Show",
              body: `${caregiverName} did not check in for ${recipientName}'s session. The session has been cancelled and no payment will be charged.`,
              data: { type: "caregiver_no_show", sessionId: s.id },
            }, "caregiver_no_show").catch(() => {});
            if (_emitToUser) {
              _emitToUser(s.family_user_id, "session_update", {
                sessionId: s.id, status: "cancelled", reason: "caregiver_no_show",
                message: `${caregiverName} did not check in. Session cancelled — no charge.`,
              });
            }
          }

          // ─── Pause caregiver's account pending admin review (only if not already paused) ───
          try {
            const cgProfile = await db.prepare("SELECT id, account_paused FROM caregiver_profiles WHERE user_id = ?").get(s.caregiver_user_id);
            if (cgProfile && !cgProfile.account_paused) {
              await db.prepare(`
                UPDATE caregiver_profiles SET
                  is_available = 0,
                  account_paused = 1,
                  account_paused_reason = 'No-show: missed session on ' || ?,
                  account_paused_at = NOW()
                WHERE id = ?
              `).run(s.scheduled_date, cgProfile.id);
              console.log(`[accountability] Paused caregiver ${s.caregiver_user_id} for no-show`);
            } else if (cgProfile?.account_paused) {
              console.log(`[accountability] Caregiver ${s.caregiver_user_id} already paused — skipping`);
            }
          } catch (pauseErr) {
            console.error(`[accountability] Failed to pause caregiver account:`, pauseErr.message);
          }

          console.log(`[accountability] Caregiver no-show: session ${s.id.slice(0, 8)} — notified caregiver + family, account paused`);

          // Auto-create system ticket for no-show
          try {
            if (ticketRouter.createSystemTicket) {
              await ticketRouter.createSystemTicket({
                subject: `No-show: ${s.caregiver_first || 'Caregiver'} missed session ${s.id.slice(0, 8)}`,
                description: `Caregiver did not check in for scheduled session on ${s.scheduled_date} at ${s.scheduled_time}. Account has been paused.`,
                category: 'visit_issue',
                priority: 'high',
                relatedUserId: s.caregiver_user_id,
                relatedSessionId: s.id,
              });
            }
          } catch (ticketErr) { console.error('[accountability] Failed to create no-show ticket:', ticketErr.message); }
        }
      } catch (err) {
        console.error(`[accountability] No-show poll error for ${s.id.slice(0, 8)}:`, err.message);
      }
    }
  } catch (err) {
    console.error("[accountability] pollCaregiverNoShows error:", err.message);
  }
}

/**
 * Auto-default late resolution to 'truncate' if family hasn't responded within 15 minutes.
 */
async function pollLateResolutionDefaults() {
  try {
    const db = await getDb();
    const unresolved = await db.prepare(`
      SELECT id, late_minutes FROM care_sessions
      WHERE late_check_in = 1
        AND late_resolution IS NULL
        AND status = 'in_progress'
    `).all();

    if (!unresolved || unresolved.length === 0) return;

    // Default to truncate after 15 minutes of no response from family
    // We check if the session has been in_progress for at least 15 min since being flagged late
    for (const s of unresolved) {
      // Simple approach: if flagged and no resolution after some time, default truncate
      await db.prepare(`
        UPDATE care_sessions SET
          late_resolution = 'truncate',
          late_resolution_at = NOW()
        WHERE id = ?
          AND late_check_in = 1
          AND late_resolution IS NULL
          AND updated_at < NOW() - INTERVAL '15 minutes'
      `).run(s.id);
    }
  } catch (err) {
    console.error("[accountability] pollLateResolutionDefaults error:", err.message);
  }
}


// ─── POST /api/accountability/incident — Report a safety incident ───
router.post("/incident", async (req, res) => {
  try {
    const db = getDb();
    const userId = req.user.id;
    const { incidentType, sessionId, involvedPersonName, description, severity } = req.body;

    if (!incidentType || !description || description.trim().length < 10) {
      return res.status(400).json({ error: "Incident type and description (min 10 chars) are required" });
    }

    const flagId = uuid();
    const severityLevel = severity || (
      ['abuse', 'neglect', 'theft', 'threat'].some(t => incidentType.includes(t)) ? 'high' : 'medium'
    );

    // Build the message that admin will see
    const sessionInfo = sessionId ? await db.prepare(
      `SELECT cs.scheduled_date, cs.scheduled_time, cs.service_type,
              cr.first_name || ' ' || cr.last_name AS recipient_name,
              u2.first_name || ' ' || u2.last_name AS caregiver_name
       FROM care_sessions cs
       LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
       LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
       LEFT JOIN users u2 ON cp.user_id = u2.id
       WHERE cs.id = ?`
    ).get(sessionId) : null;

    let fullMessage = `[INCIDENT REPORT — ${incidentType.replace(/_/g, ' ').toUpperCase()}]\n`;
    if (involvedPersonName) fullMessage += `Person involved: ${involvedPersonName}\n`;
    if (sessionInfo) fullMessage += `Session: ${sessionInfo.scheduled_date} ${sessionInfo.scheduled_time} — ${sessionInfo.recipient_name} w/ ${sessionInfo.caregiver_name || 'unassigned'}\n`;
    fullMessage += `\n${description.trim()}`;

    await db.prepare(`
      INSERT INTO safety_flags (id, user_id, flag_type, user_message, status, severity, created_at)
      VALUES (?, ?, ?, ?, 'pending', ?, NOW())
    `).run(flagId, userId, 'incident_report', fullMessage.substring(0, 2000), severityLevel);

    // Log the event
    await db.prepare(`
      INSERT INTO safety_flag_events (id, safety_flag_id, event_type, actor_id, actor_label, content, created_at)
      VALUES (?, ?, 'created', ?, ?, ?, NOW())
    `).run(uuid(), flagId, userId, req.user.first_name || 'User', `Incident reported: ${incidentType}`);

    // Notify all admins via push
    const admins = await db.prepare("SELECT id FROM users WHERE is_admin = 1 AND COALESCE(is_demo, 0) = 0").all();
    const reporter = await db.prepare("SELECT first_name, last_name FROM users WHERE id = ?").get(userId);
    const reporterName = reporter ? `${reporter.first_name} ${reporter.last_name}` : 'A user';
    for (const admin of admins) {
      try {
        await sendPushToUser(admin.id, {
          title: '🚨 Incident Report Filed',
          body: `${reporterName} reported: ${incidentType.replace(/_/g, ' ')}`,
          data: { url: '/admin?tab=safety' },
        });
      } catch (e) { /* best-effort push */ }
      // Also create in-app notification
      try {
        await db.prepare(
          "INSERT INTO notifications (id, user_id, type, title, body, data, created_at) VALUES (?, ?, 'safety_flag', ?, ?, ?::jsonb, NOW())"
        ).run(uuid(), admin.id, 'Incident Report Filed',
          `${reporterName} reported: ${incidentType.replace(/_/g, ' ')}`,
          JSON.stringify({ flagId, incidentType }));
      } catch (e) { /* best-effort */ }
    }

    res.json({ success: true, flagId });
  } catch (err) {
    console.error("Incident report error:", err);
    res.status(500).json({ error: "Failed to submit incident report" });
  }
});

// ─── GET /api/accountability/incident-context — Get sessions & people for incident form ───
router.get("/incident-context", async (req, res) => {
  try {
    const db = getDb();
    const userId = req.user.id;

    // Get recent sessions (last 30 days) where this user is involved
    const sessions = await db.prepare(`
      SELECT cs.id, cs.scheduled_date, cs.scheduled_time, cs.service_type, cs.status,
             cr.first_name || ' ' || cr.last_name AS recipient_name,
             u2.first_name || ' ' || u2.last_name AS caregiver_name
      FROM care_sessions cs
      LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
      LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
      LEFT JOIN users u2 ON cp.user_id = u2.id
      WHERE (cs.family_user_id = ? OR cp.user_id = ?)
        AND cs.scheduled_date >= (CURRENT_DATE - INTERVAL '30 days')::text
      ORDER BY cs.scheduled_date DESC, cs.scheduled_time DESC
      LIMIT 20
    `).all(userId, userId);

    // Get people the user works with (care team + assigned caregivers)
    const people = await db.prepare(`
      SELECT DISTINCT u.first_name || ' ' || u.last_name AS name, u.id AS user_id
      FROM care_team_members ctm
      JOIN care_teams ct ON ctm.care_team_id = ct.id
      JOIN care_team_members ctm2 ON ctm2.care_team_id = ct.id
      JOIN users u ON ctm2.user_id = u.id
      WHERE ctm.user_id = ? AND ctm2.user_id != ?
      UNION
      SELECT DISTINCT u.first_name || ' ' || u.last_name AS name, u.id AS user_id
      FROM caregiver_assignments ca
      JOIN caregiver_profiles cp ON ca.caregiver_profile_id = cp.id
      JOIN users u ON cp.user_id = u.id
      WHERE ca.family_user_id = ? AND ca.is_active = 1
      UNION
      SELECT DISTINCT cr.first_name || ' ' || cr.last_name AS name, NULL AS user_id
      FROM care_recipients cr
      JOIN care_sessions cs ON cs.care_recipient_id = cr.id
      LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
      WHERE cp.user_id = ? OR cs.family_user_id = ?
      ORDER BY name
    `).all(userId, userId, userId, userId, userId);

    res.json({ sessions, people });
  } catch (err) {
    console.error("Incident context error:", err);
    res.status(500).json({ error: "Failed to load context" });
  }
});

// ─── Acknowledge (dismiss) a no-show alert ───
router.post("/no-show/:sessionId/acknowledge", async (req, res) => {
  try {
    const db = await getDb();
    const userId = req.user.id;
    const { sessionId } = req.params;

    // Look up the caregiver profile ID (care_sessions.caregiver_id = caregiver_profiles.id, not users.id)
    const profile = await db.prepare(
      `SELECT id FROM caregiver_profiles WHERE user_id = ?`
    ).get(userId);
    if (!profile) return res.status(404).json({ error: "Caregiver profile not found" });

    // Verify this session belongs to the requesting caregiver
    const session = await db.prepare(
      `SELECT id FROM care_sessions WHERE id = ? AND caregiver_id = ? AND caregiver_no_show = 1`
    ).get(sessionId, profile.id);
    if (!session) return res.status(404).json({ error: "Session not found" });

    await db.prepare(
      `UPDATE care_sessions SET no_show_acknowledged = 1 WHERE id = ?`
    ).run(sessionId);

    res.json({ ok: true });
  } catch (err) {
    console.error("Acknowledge no-show error:", err);
    res.status(500).json({ error: "Failed to acknowledge" });
  }
});

module.exports = router;
module.exports.authorizeSessionPayment = authorizeSessionPayment;
module.exports.captureSessionPayment = captureSessionPayment;
module.exports.voidSessionPayment = voidSessionPayment;
module.exports.pollPaymentAuthorizations = pollPaymentAuthorizations;
module.exports.pollLateCheckIns = pollLateCheckIns;
module.exports.pollCaregiverNoShows = pollCaregiverNoShows;
module.exports.pollLateResolutionDefaults = pollLateResolutionDefaults;
module.exports.setEmitToUser = setEmitToUser;
