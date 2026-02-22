const express = require("express");
const { v4: uuid } = require("uuid");
const { getDb } = require("../models/database");
const { authenticate, requireRole } = require("../middleware/auth");
const { calculateSessionCost, isShortNotice, SURCHARGE_CAREGIVER_SHARE, SURCHARGE_PLATFORM_SHARE } = require("../utils/rateCalculator");

const router = express.Router();

// ─── Stripe initialization ───
// Lazy-loaded so the app doesn't crash if STRIPE_SECRET_KEY isn't set
let _stripe = null;
function getStripe() {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY || process.env.stripe_secret_key;
    if (!key) throw new Error("STRIPE_SECRET_KEY not configured");
    _stripe = require("stripe")(key);
  }
  return _stripe;
}

const PLATFORM_FEE_PERCENT = 15; // InPlace takes 15%
const STRIPE_PUBLISHABLE_KEY = process.env.STRIPE_PUBLISHABLE_KEY || process.env.stripe_publishable_key || "";
const BASE_URL = process.env.BASE_URL || process.env.base_url || "https://yourinplace.com";

// ─── GET /api/payments/config ───
// Return publishable key to frontend (no auth required for checkout)
router.get("/config", (req, res) => {
  res.json({ publishableKey: STRIPE_PUBLISHABLE_KEY });
});

// All other routes require auth
router.use(authenticate);

// ─── POST /api/payments/connect/onboard ───
// Create a Stripe Connect Express account for a caregiver and return the onboarding link
router.post("/connect/onboard", requireRole("caregiver"), async (req, res) => {
  const db = await getDb();
  let stripe;
  try { stripe = getStripe(); } catch {
    return res.status(503).json({ error: "Payment system is not configured yet. Please check back later.", notConfigured: true });
  }

  const user = await db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  const profile = await db.prepare("SELECT * FROM caregiver_profiles WHERE user_id = ?").get(req.user.id);

  if (!profile) return res.status(404).json({ error: "Caregiver profile not found" });

  let stripeAccountId = profile.stripe_account_id;

  // Create a Connect Express account if none exists
  if (!stripeAccountId) {
    try {
      const account = await stripe.accounts.create({
        type: "express",
        country: "US",
        email: user.email,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        business_type: "individual",
        individual: {
          first_name: profile.legal_first_name || user.first_name,
          last_name: profile.legal_last_name || user.last_name,
          email: user.email,
        },
        metadata: {
          inplace_user_id: req.user.id,
          inplace_profile_id: profile.id,
        },
      });

      stripeAccountId = account.id;
      await db.prepare(
        "UPDATE caregiver_profiles SET stripe_account_id = ?, stripe_onboard_complete = 0, updated_at = NOW() WHERE user_id = ?"
      ).run(stripeAccountId, req.user.id);
    } catch (err) {
      console.error("Stripe account creation error:", err);
      return res.status(500).json({ error: "Failed to create Stripe account" });
    }
  }

  // Generate an Account Link for onboarding
  try {
    const accountLink = await stripe.accountLinks.create({
      account: stripeAccountId,
      refresh_url: `${BASE_URL}/#payments-refresh`,
      return_url: `${BASE_URL}/#payments-complete`,
      type: "account_onboarding",
    });

    res.json({ url: accountLink.url, stripeAccountId });
  } catch (err) {
    console.error("Stripe onboarding link error:", err);
    res.status(500).json({ error: "Failed to generate onboarding link" });
  }
});

// ─── GET /api/payments/connect/status ───
// Check caregiver's Stripe Connect account status
router.get("/connect/status", requireRole("caregiver"), async (req, res) => {
  const db = await getDb();
  let stripe;
  try { stripe = getStripe(); } catch {
    return res.json({ connected: false, status: "not_configured" });
  }

  const profile = await db.prepare("SELECT * FROM caregiver_profiles WHERE user_id = ?").get(req.user.id);
  if (!profile) return res.status(404).json({ error: "Caregiver profile not found" });

  if (!profile.stripe_account_id) {
    return res.json({ connected: false, status: "not_started" });
  }

  try {
    const account = await stripe.accounts.retrieve(profile.stripe_account_id);

    const isComplete = account.charges_enabled && account.payouts_enabled;

    // Update local status if onboarding just completed
    if (isComplete && !profile.stripe_onboard_complete) {
      await db.prepare(
        "UPDATE caregiver_profiles SET stripe_onboard_complete = 1, updated_at = NOW() WHERE user_id = ?"
      ).run(req.user.id);
    }

    res.json({
      connected: true,
      status: isComplete ? "active" : "pending",
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
      detailsSubmitted: account.details_submitted,
      stripeAccountId: profile.stripe_account_id,
    });
  } catch (err) {
    console.error("Stripe status check error:", err);
    res.status(500).json({ error: "Failed to check Stripe status" });
  }
});

// ─── GET /api/payments/connect/dashboard ───
// Generate a Stripe Express dashboard login link for the caregiver
router.get("/connect/dashboard", requireRole("caregiver"), async (req, res) => {
  const db = await getDb();
  let stripe;
  try { stripe = getStripe(); } catch {
    return res.status(503).json({ error: "Payment system is not configured yet." });
  }

  const profile = await db.prepare("SELECT stripe_account_id FROM caregiver_profiles WHERE user_id = ?").get(req.user.id);
  if (!profile?.stripe_account_id) {
    return res.status(400).json({ error: "No Stripe account connected" });
  }

  try {
    const loginLink = await stripe.accounts.createLoginLink(profile.stripe_account_id);
    res.json({ url: loginLink.url });
  } catch (err) {
    console.error("Stripe dashboard link error:", err);
    res.status(500).json({ error: "Failed to generate dashboard link" });
  }
});

// ─── POST /api/payments/checkout ───
// Create a Stripe Checkout Session for a care session (family pays)
router.post("/checkout", requireRole("family"), async (req, res) => {
  const db = await getDb();
  const stripe = getStripe();
  const { sessionId } = req.body;

  if (!sessionId) return res.status(400).json({ error: "sessionId is required" });

  // Get the care session
  const session = await db.prepare(`
    SELECT cs.*, cp.stripe_account_id, cp.stripe_onboard_complete,
      cp.hourly_rate, cp.rate_daytime, cp.rate_nighttime, cp.rate_overnight,
      cp.user_id AS caregiver_user_id,
      u.first_name || ' ' || u.last_name AS caregiver_name,
      cr.first_name || ' ' || cr.last_name AS recipient_name
    FROM care_sessions cs
    LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
    LEFT JOIN users u ON cp.user_id = u.id
    LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
    WHERE cs.id = ? AND cs.family_user_id = ?
  `).get(sessionId, req.user.id);

  if (!session) return res.status(404).json({ error: "Session not found" });
  if (!session.caregiver_id) return res.status(400).json({ error: "No caregiver assigned to this session" });
  if (!session.stripe_account_id || !session.stripe_onboard_complete) {
    return res.status(400).json({ error: "Caregiver has not completed Stripe setup" });
  }

  // Check if already paid
  const existingPayment = await db.prepare(
    "SELECT id FROM payments WHERE session_id = ? AND status IN ('completed', 'processing')"
  ).get(sessionId);
  if (existingPayment) return res.status(400).json({ error: "Payment already processed for this session" });

  // Calculate amounts — use agreed_rate if negotiated, else caregiver's tiered rates
  const durationHours = session.duration_hours || 2;
  let totalCents, baseCostCents, surchargeCents = 0;

  if (session.agreed_rate) {
    // Negotiated flat rate — simple calculation
    baseCostCents = Math.round(session.agreed_rate * durationHours * 100);
    surchargeCents = Math.round((session.short_notice_surcharge || 0) * 100);
    totalCents = baseCostCents + surchargeCents;
  } else {
    // Use tiered rate calculation
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

  // Platform fee: 15% of base cost + 25% of short-notice surcharge (platform gets smaller share of surcharge)
  let platformFeeCents = Math.round(baseCostCents * PLATFORM_FEE_PERCENT / 100);
  if (surchargeCents > 0) {
    platformFeeCents += Math.round(surchargeCents * SURCHARGE_PLATFORM_SHARE);
  }

  // Check caregiver payout speed — if instant, add 2% surcharge to platform fee
  const payoutPref = await db.prepare(
    "SELECT speed FROM payout_preferences WHERE user_id = ?"
  ).get(session.caregiver_user_id);
  const payoutSpeed = payoutPref?.speed || "standard";
  let instantSurchargeCents = 0;
  if (payoutSpeed === "instant") {
    instantSurchargeCents = Math.round(totalCents * 2 / 100); // 2% surcharge
    platformFeeCents += instantSurchargeCents;
  }

  try {
    const checkoutSession = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card", "us_bank_account"],
      line_items: [{
        price_data: {
          currency: "usd",
          product_data: {
            name: `Care Session — ${session.recipient_name || "Care Recipient"}`,
            description: `${session.service_type} on ${session.scheduled_date} at ${session.scheduled_time} (${durationHours}h) with ${session.caregiver_name || "Caregiver"}`,
          },
          unit_amount: totalCents,
        },
        quantity: 1,
      }],
      payment_intent_data: {
        application_fee_amount: platformFeeCents,
        transfer_data: {
          destination: session.stripe_account_id,
        },
      },
      success_url: `${BASE_URL}/#payment-success?session=${sessionId}`,
      cancel_url: `${BASE_URL}/#payment-cancel?session=${sessionId}`,
      metadata: {
        inplace_session_id: sessionId,
        inplace_family_user_id: req.user.id,
        inplace_caregiver_id: session.caregiver_id,
        payout_speed: payoutSpeed,
      },
    });

    // Create a pending payment record
    const paymentId = uuid();
    await db.prepare(`
      INSERT INTO payments (id, session_id, family_user_id, caregiver_id, amount, platform_fee, caregiver_payout, status, payment_method, stripe_checkout_id, payout_speed, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'processing', 'stripe', ?, ?, NOW())
    `).run(
      paymentId, sessionId, req.user.id, session.caregiver_id,
      totalCents / 100, platformFeeCents / 100, (totalCents - platformFeeCents) / 100,
      checkoutSession.id, payoutSpeed
    );

    res.json({
      checkoutUrl: checkoutSession.url,
      paymentId,
      amount: totalCents / 100,
      platformFee: platformFeeCents / 100,
      caregiverPayout: (totalCents - platformFeeCents) / 100,
      payoutSpeed,
      achAvailable: true,
    });
  } catch (err) {
    console.error("Stripe checkout error:", err);
    res.status(500).json({ error: "Failed to create checkout session" });
  }
});

// ─── GET /api/payments/session/:sessionId ───
// Get payment status for a care session
router.get("/session/:sessionId", async (req, res) => {
  const db = await getDb();

  const payment = await db.prepare(`
    SELECT p.*, u.first_name || ' ' || u.last_name AS caregiver_name
    FROM payments p
    LEFT JOIN caregiver_profiles cp ON p.caregiver_id = cp.id
    LEFT JOIN users u ON cp.user_id = u.id
    WHERE p.session_id = ?
    ORDER BY p.created_at DESC LIMIT 1
  `).get(req.params.sessionId);

  if (!payment) return res.json({ payment: null });

  res.json({
    payment: {
      id: payment.id,
      amount: payment.amount,
      platformFee: payment.platform_fee,
      caregiverPayout: payment.caregiver_payout,
      status: payment.status,
      paymentMethod: payment.payment_method,
      caregiverName: payment.caregiver_name,
      createdAt: payment.created_at,
    },
  });
});

// ─── GET /api/payments/earnings ───
// Caregiver earnings summary
router.get("/earnings", requireRole("caregiver"), async (req, res) => {
  const db = await getDb();
  const profile = await db.prepare("SELECT id FROM caregiver_profiles WHERE user_id = ?").get(req.user.id);
  if (!profile) return res.status(404).json({ error: "Caregiver profile not found" });

  const { from, to } = req.query;

  let query = `SELECT * FROM payments WHERE caregiver_id = ? AND status = 'completed'`;
  const params = [profile.id];

  if (from) { query += " AND created_at >= ?"; params.push(from); }
  if (to) { query += " AND created_at <= ?"; params.push(to); }

  query += " ORDER BY created_at DESC";

  const payments = await db.prepare(query).all(...params);

  const totalEarned = payments.reduce((sum, p) => sum + (p.caregiver_payout || 0), 0);
  const totalSessions = payments.length;
  const pendingPayments = await db.prepare(
    "SELECT SUM(caregiver_payout) as total FROM payments WHERE caregiver_id = ? AND status = 'processing'"
  ).get(profile.id);

  res.json({
    totalEarned: Math.round(totalEarned * 100) / 100,
    totalSessions,
    pendingAmount: Math.round((pendingPayments?.total || 0) * 100) / 100,
    payments: payments.map(p => ({
      id: p.id,
      sessionId: p.session_id,
      amount: p.amount,
      platformFee: p.platform_fee,
      payout: p.caregiver_payout,
      status: p.status,
      createdAt: p.created_at,
    })),
  });
});

// ─── GET /api/payments/history ───
// Family payment history
router.get("/history", requireRole("family"), async (req, res) => {
  const db = await getDb();

  const payments = await db.prepare(`
    SELECT p.*,
      cs.service_type, cs.scheduled_date, cs.scheduled_time,
      u.first_name || ' ' || u.last_name AS caregiver_name,
      cr.first_name || ' ' || cr.last_name AS recipient_name
    FROM payments p
    LEFT JOIN care_sessions cs ON p.session_id = cs.id
    LEFT JOIN caregiver_profiles cp ON p.caregiver_id = cp.id
    LEFT JOIN users u ON cp.user_id = u.id
    LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
    WHERE p.family_user_id = ?
    ORDER BY p.created_at DESC
    LIMIT 50
  `).all(req.user.id);

  const totalSpent = payments.filter(p => p.status === 'completed').reduce((sum, p) => sum + (p.amount || 0), 0);

  res.json({
    totalSpent: Math.round(totalSpent * 100) / 100,
    payments: payments.map(p => ({
      id: p.id,
      sessionId: p.session_id,
      amount: p.amount,
      status: p.status,
      serviceType: p.service_type,
      scheduledDate: p.scheduled_date,
      caregiverName: p.caregiver_name,
      recipientName: p.recipient_name,
      createdAt: p.created_at,
    })),
  });
});

// ─── POST /api/payments/background-check ───
// Create a PaymentIntent for the $30 background check fee (caregiver)
router.post("/background-check", requireRole("caregiver"), async (req, res) => {
  const db = await getDb();
  let stripe;
  try { stripe = getStripe(); } catch {
    return res.status(503).json({ error: "Payment system is not configured yet.", notConfigured: true });
  }

  const profile = await db.prepare("SELECT * FROM caregiver_profiles WHERE user_id = ?").get(req.user.id);
  if (!profile) return res.status(404).json({ error: "Caregiver profile not found" });

  // Check if already paid
  if (profile.background_check_paid) {
    return res.status(400).json({ error: "Background check already paid" });
  }

  // Check for existing pending payment
  const existing = await db.prepare(
    "SELECT * FROM background_check_payments WHERE user_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1"
  ).get(req.user.id);

  if (existing?.stripe_payment_intent) {
    // Return existing client secret if still valid
    try {
      const intent = await stripe.paymentIntents.retrieve(existing.stripe_payment_intent);
      if (intent.status === "requires_payment_method" || intent.status === "requires_confirmation") {
        return res.json({ clientSecret: intent.client_secret, paymentId: existing.id });
      }
    } catch (e) { /* intent may have expired, create new one */ }
  }

  try {
    const user = await db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
    const intent = await stripe.paymentIntents.create({
      amount: 3000, // $30.00
      currency: "usd",
      metadata: {
        type: "background_check",
        inplace_user_id: req.user.id,
        caregiver_name: `${user.first_name} ${user.last_name}`,
      },
    });

    const paymentId = uuid();
    await db.prepare(
      "INSERT INTO background_check_payments (id, user_id, stripe_payment_intent, amount, status, created_at) VALUES (?, ?, ?, 30, 'pending', NOW())"
    ).run(paymentId, req.user.id, intent.id);

    res.json({ clientSecret: intent.client_secret, paymentId });
  } catch (err) {
    console.error("Background check PaymentIntent error:", err);
    res.status(500).json({ error: "Failed to create payment" });
  }
});

// ─── POST /api/payments/background-check/confirm ───
// Confirm background check payment succeeded
router.post("/background-check/confirm", requireRole("caregiver"), async (req, res) => {
  const db = await getDb();
  let stripe;
  try { stripe = getStripe(); } catch {
    return res.status(503).json({ error: "Payment system is not configured yet." });
  }

  const { paymentIntentId } = req.body;
  if (!paymentIntentId) return res.status(400).json({ error: "paymentIntentId is required" });

  try {
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (intent.status !== "succeeded") {
      return res.status(400).json({ error: `Payment not yet succeeded (status: ${intent.status})` });
    }

    // Update background_check_payments
    await db.prepare(
      "UPDATE background_check_payments SET status = 'completed', completed_at = NOW() WHERE stripe_payment_intent = ? AND user_id = ?"
    ).run(paymentIntentId, req.user.id);

    // Mark caregiver profile as paid
    await db.prepare(
      "UPDATE caregiver_profiles SET background_check_paid = 1, updated_at = NOW() WHERE user_id = ?"
    ).run(req.user.id);

    res.json({ success: true });
  } catch (err) {
    console.error("Background check confirm error:", err);
    res.status(500).json({ error: "Failed to confirm payment" });
  }
});

// ─── GET /api/payments/payout-preference ───
// Get caregiver's payout speed preference
router.get("/payout-preference", requireRole("caregiver"), async (req, res) => {
  const db = await getDb();
  const pref = await db.prepare("SELECT * FROM payout_preferences WHERE user_id = ?").get(req.user.id);
  res.json({
    speed: pref?.speed || "standard",
    surchargePercent: 2,
  });
});

// ─── PUT /api/payments/payout-preference ───
// Set caregiver's payout speed preference
router.put("/payout-preference", requireRole("caregiver"), async (req, res) => {
  const db = await getDb();
  const { speed } = req.body;
  if (!speed || !["standard", "instant"].includes(speed)) {
    return res.status(400).json({ error: "speed must be 'standard' or 'instant'" });
  }

  const existing = await db.prepare("SELECT id FROM payout_preferences WHERE user_id = ?").get(req.user.id);
  if (existing) {
    await db.prepare("UPDATE payout_preferences SET speed = ?, updated_at = NOW() WHERE user_id = ?").run(speed, req.user.id);
  } else {
    await db.prepare("INSERT INTO payout_preferences (id, user_id, speed, updated_at) VALUES (?, ?, ?, NOW())").run(uuid(), req.user.id, speed);
  }

  res.json({ speed, surchargePercent: 2 });
});

module.exports = router;
