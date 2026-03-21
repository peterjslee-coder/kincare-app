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

const PLATFORM_FEE_PERCENT = 20; // InPlace takes 20%, caregivers keep 80%
const STRIPE_PUBLISHABLE_KEY = process.env.STRIPE_PUBLISHABLE_KEY || process.env.stripe_publishable_key || "";
const BASE_URL = process.env.BASE_URL || process.env.base_url || "https://yourinplace.com";
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || process.env.stripe_webhook_secret || "";

// ─── Helper: check if payments are enabled by admin ───
async function paymentsEnabled() {
  try {
    const db = await getDb();
    const row = await db.prepare("SELECT value FROM platform_settings WHERE key = 'payments_enabled'").get();
    return row?.value === 'true';
  } catch { return false; }
}

// ─── Middleware: gate Stripe-touching endpoints ───
async function requirePaymentsEnabled(req, res, next) {
  const enabled = await paymentsEnabled();
  if (!enabled) {
    return res.status(503).json({ error: "Payments are not currently enabled. An administrator must enable payments before transactions can be processed.", paymentsDisabled: true });
  }
  next();
}

// ─── GET /api/payments/config ───
// Return publishable key + enabled status to frontend (no auth required for checkout)
router.get("/config", async (req, res) => {
  const enabled = await paymentsEnabled();
  res.json({ publishableKey: STRIPE_PUBLISHABLE_KEY, paymentsEnabled: enabled });
});

// ─── POST /api/payments/webhook ───
// Stripe webhook handler — receives events about payment status changes
// This must be BEFORE authenticate middleware and uses raw body for signature verification
router.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  let event;

  // Verify webhook signature if secret is configured
  if (WEBHOOK_SECRET) {
    const sig = req.headers["stripe-signature"];
    try {
      const stripe = getStripe();
      event = stripe.webhooks.constructEvent(req.body, sig, WEBHOOK_SECRET);
    } catch (err) {
      console.error("Webhook signature verification failed:", err.message);
      return res.status(400).json({ error: "Webhook signature verification failed" });
    }
  } else {
    // No webhook secret — parse body but log warning
    console.warn("⚠️  STRIPE_WEBHOOK_SECRET not configured — webhook signatures are NOT being verified");
    try {
      event = JSON.parse(req.body);
    } catch (err) {
      return res.status(400).json({ error: "Invalid JSON" });
    }
  }

  const db = await getDb();

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const sessionId = session.metadata?.inplace_session_id;
        if (!sessionId) break;

        // Update payment record
        await db.prepare(
          "UPDATE payments SET status = 'completed', stripe_payment_intent = ?, updated_at = NOW() WHERE stripe_checkout_id = ?"
        ).run(session.payment_intent, session.id);

        // Update care session payment status
        await db.prepare(
          "UPDATE care_sessions SET payment_status = 'paid', updated_at = NOW() WHERE id = ?"
        ).run(sessionId);

        console.log(`✅ Payment completed for session ${sessionId}`);
        break;
      }

      case "checkout.session.expired": {
        const session = event.data.object;
        // Mark payment as failed/expired
        await db.prepare(
          "UPDATE payments SET status = 'failed', updated_at = NOW() WHERE stripe_checkout_id = ?"
        ).run(session.id);

        console.log(`❌ Checkout expired for session ${session.metadata?.inplace_session_id}`);
        break;
      }

      case "payment_intent.payment_failed": {
        const intent = event.data.object;
        await db.prepare(
          "UPDATE payments SET status = 'failed', updated_at = NOW() WHERE stripe_payment_intent = ?"
        ).run(intent.id);

        // Also check background check payments
        await db.prepare(
          "UPDATE background_check_payments SET status = 'failed' WHERE stripe_payment_intent = ?"
        ).run(intent.id);

        console.log(`❌ Payment failed: ${intent.id} — ${intent.last_payment_error?.message || 'unknown error'}`);
        break;
      }

      case "payment_intent.succeeded": {
        const intent = event.data.object;

        // Handle background check payments
        if (intent.metadata?.type === "background_check") {
          const userId = intent.metadata.inplace_user_id;
          await db.prepare(
            "UPDATE background_check_payments SET status = 'completed', completed_at = NOW() WHERE stripe_payment_intent = ? AND user_id = ?"
          ).run(intent.id, userId);
          await db.prepare(
            "UPDATE caregiver_profiles SET background_check_paid = 1, updated_at = NOW() WHERE user_id = ?"
          ).run(userId);
          console.log(`✅ Background check payment confirmed for user ${userId}`);
        }
        break;
      }

      case "account.updated": {
        // Caregiver's Connect account was updated (onboarding completed, etc.)
        const account = event.data.object;
        const isComplete = account.charges_enabled && account.payouts_enabled;
        if (isComplete) {
          await db.prepare(
            "UPDATE caregiver_profiles SET stripe_onboard_complete = 1, updated_at = NOW() WHERE stripe_account_id = ?"
          ).run(account.id);
          console.log(`✅ Stripe Connect onboarding complete for account ${account.id}`);
        }
        break;
      }

      case "identity.verification_session.verified": {
        // Caregiver's identity has been successfully verified
        const session = event.data.object;
        const userId = session.metadata?.inplace_user_id;
        if (userId) {
          await db.prepare(
            "UPDATE caregiver_profiles SET identity_verified = 1, identity_verification_status = 'verified', identity_verified_at = NOW(), updated_at = NOW() WHERE user_id = ?"
          ).run(userId);
          console.log(`✅ Identity verified for user ${userId}`);
        }
        break;
      }

      case "identity.verification_session.requires_input": {
        // Verification failed or needs additional input
        const session = event.data.object;
        const userId = session.metadata?.inplace_user_id;
        if (userId) {
          await db.prepare(
            "UPDATE caregiver_profiles SET identity_verification_status = 'requires_input', updated_at = NOW() WHERE user_id = ?"
          ).run(userId);
          console.log(`⚠️ Identity verification requires input for user ${userId} — ${session.last_error?.code || 'unknown'}`);
        }
        break;
      }

      default:
        // Unhandled event type — log but don't error
        console.log(`Stripe webhook: unhandled event type ${event.type}`);
    }
  } catch (err) {
    console.error(`Webhook handler error for ${event.type}:`, err);
    // Still return 200 to prevent Stripe from retrying
  }

  res.json({ received: true });
});

// All other routes require auth
router.use(authenticate);

// ─── GET /api/payments/status ───
// Check if payments are enabled (for frontend gating)
router.get("/status", async (req, res) => {
  const enabled = await paymentsEnabled();
  res.json({ paymentsEnabled: enabled });
});

// ─── POST /api/payments/family/setup ───
// Create a Stripe Checkout Session in setup mode so a family user can save a payment method
router.post("/family/setup", requireRole("family"), requirePaymentsEnabled, async (req, res) => {
  const db = await getDb();
  let stripe;
  try { stripe = getStripe(); } catch {
    return res.status(503).json({ error: "Payment system is not configured yet.", notConfigured: true });
  }

  const user = await db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  if (!user) return res.status(404).json({ error: "User not found" });

  let customerId = user.stripe_customer_id;

  // Create a Stripe Customer if one doesn't exist
  if (!customerId) {
    try {
      const customer = await stripe.customers.create({
        email: user.email,
        name: `${user.first_name} ${user.last_name}`,
        metadata: { inplace_user_id: user.id },
      });
      customerId = customer.id;
      await db.prepare("UPDATE users SET stripe_customer_id = ? WHERE id = ?").run(customerId, user.id);
    } catch (err) {
      console.error("Stripe customer creation error:", err);
      return res.status(500).json({ error: "Failed to create Stripe customer" });
    }
  }

  const { returnUrl } = req.body;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "setup",
      customer: customerId,
      payment_method_types: ["card"],
      success_url: `${returnUrl || BASE_URL + '/#my-account'}?stripe_setup=success`,
      cancel_url: `${returnUrl || BASE_URL + '/#my-account'}?stripe_setup=cancel`,
      metadata: {
        inplace_user_id: user.id,
        type: "family_payment_setup",
      },
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("Stripe setup session error:", err);
    res.status(500).json({ error: "Failed to create Stripe setup session" });
  }
});

// ─── GET /api/payments/family/status ───
// Check if a family user has a saved payment method
router.get("/family/status", requireRole("family"), async (req, res) => {
  const db = await getDb();
  const user = await db.prepare("SELECT stripe_customer_id FROM users WHERE id = ?").get(req.user.id);

  if (!user?.stripe_customer_id) {
    return res.json({ status: "not_setup", hasPaymentMethod: false, methods: [] });
  }

  try {
    const stripe = getStripe();
    const methods = [];

    // Fetch all card payment methods
    const cardMethods = await stripe.paymentMethods.list({
      customer: user.stripe_customer_id,
      type: "card",
      limit: 10,
    });
    for (const pm of cardMethods.data) {
      methods.push({
        id: pm.id,
        type: "card",
        brand: pm.card.brand,
        last4: pm.card.last4,
        expMonth: pm.card.exp_month,
        expYear: pm.card.exp_year,
      });
    }

    // Fetch Stripe Link payment methods
    try {
      const linkMethods = await stripe.paymentMethods.list({
        customer: user.stripe_customer_id,
        type: "link",
        limit: 10,
      });
      for (const pm of linkMethods.data) {
        const linkCard = pm.link || {};
        methods.push({
          id: pm.id,
          type: "link",
          brand: linkCard.brand || "Stripe Link",
          last4: linkCard.last4 || pm.card?.last4 || null,
          expMonth: linkCard.exp_month || pm.card?.exp_month || null,
          expYear: linkCard.exp_year || pm.card?.exp_year || null,
          isLink: true,
          email: pm.link?.email || null,
        });
      }
    } catch { /* Link type may not be supported on all API versions */ }

    // Fetch US bank account (ACH) methods
    try {
      const bankMethods = await stripe.paymentMethods.list({
        customer: user.stripe_customer_id,
        type: "us_bank_account",
        limit: 10,
      });
      for (const pm of bankMethods.data) {
        methods.push({
          id: pm.id,
          type: "bank",
          brand: pm.us_bank_account.bank_name || "Bank Account",
          last4: pm.us_bank_account.last4,
          expMonth: null,
          expYear: null,
          isBank: true,
        });
      }
    } catch { /* bank type may not be available */ }

    // Backwards compat: still return "card" as the first method found
    const first = methods[0] || null;
    return res.json({
      status: methods.length > 0 ? "complete" : "pending",
      hasPaymentMethod: methods.length > 0,
      card: first,
      methods,
    });
  } catch (err) {
    console.error("Family payment status error:", err);
    return res.json({ status: "not_setup", hasPaymentMethod: false, methods: [] });
  }
});

// ─── POST /api/payments/identity/create-session ───
// Create a Stripe Identity VerificationSession for caregiver ID verification
router.post("/identity/create-session", requireRole("caregiver"), requirePaymentsEnabled, async (req, res) => {
  const db = await getDb();
  let stripe;
  try { stripe = getStripe(); } catch {
    return res.status(503).json({ error: "Payment system is not configured yet.", notConfigured: true });
  }

  const user = await db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  const profile = await db.prepare("SELECT * FROM caregiver_profiles WHERE user_id = ?").get(req.user.id);
  if (!profile) return res.status(404).json({ error: "Caregiver profile not found" });

  // If already verified, no need to create a new session
  if (profile.identity_verified) {
    return res.status(400).json({ error: "Identity already verified", alreadyVerified: true });
  }

  // Try to reuse existing session if it's still in a resumable state
  if (profile.stripe_verification_session_id) {
    try {
      const existingSession = await stripe.identity.verificationSessions.retrieve(profile.stripe_verification_session_id);
      if (existingSession.status === "requires_input" || existingSession.status === "created") {
        // Session is still usable — return its client secret
        return res.json({
          clientSecret: existingSession.client_secret,
          sessionId: existingSession.id,
          status: existingSession.status,
          reused: true,
        });
      }
    } catch (e) {
      // Session may have expired or been canceled — create a new one
      console.log(`Previous verification session ${profile.stripe_verification_session_id} not reusable:`, e.message);
    }
  }

  try {
    const verificationSession = await stripe.identity.verificationSessions.create({
      type: "document",
      options: {
        document: {
          require_matching_selfie: true,
        },
      },
      provided_details: {
        email: user.email,
      },
      metadata: {
        inplace_user_id: req.user.id,
        inplace_profile_id: profile.id,
        caregiver_name: `${user.first_name} ${user.last_name}`,
      },
    });

    // Store session ID on caregiver profile
    await db.prepare(
      "UPDATE caregiver_profiles SET stripe_verification_session_id = ?, identity_verification_status = 'pending', updated_at = NOW() WHERE user_id = ?"
    ).run(verificationSession.id, req.user.id);

    res.json({
      clientSecret: verificationSession.client_secret,
      sessionId: verificationSession.id,
      status: verificationSession.status,
    });
  } catch (err) {
    console.error("Stripe Identity session creation error:", err);
    res.status(500).json({ error: "Failed to create identity verification session" });
  }
});

// ─── GET /api/payments/identity/status ───
// Check caregiver's identity verification status
router.get("/identity/status", requireRole("caregiver"), async (req, res) => {
  const db = await getDb();
  const profile = await db.prepare("SELECT * FROM caregiver_profiles WHERE user_id = ?").get(req.user.id);
  if (!profile) return res.status(404).json({ error: "Caregiver profile not found" });

  // If we have a session but it's not verified, check Stripe for latest status
  if (profile.stripe_verification_session_id && !profile.identity_verified) {
    try {
      const stripe = getStripe();
      const session = await stripe.identity.verificationSessions.retrieve(profile.stripe_verification_session_id);

      // Update local status if changed
      let newStatus = session.status; // processing, verified, requires_input, canceled
      if (session.status === "verified" && !profile.identity_verified) {
        await db.prepare(
          "UPDATE caregiver_profiles SET identity_verified = 1, identity_verification_status = 'verified', identity_verified_at = NOW(), updated_at = NOW() WHERE user_id = ?"
        ).run(req.user.id);
        newStatus = "verified";
      } else if (session.status !== profile.identity_verification_status) {
        await db.prepare(
          "UPDATE caregiver_profiles SET identity_verification_status = ?, updated_at = NOW() WHERE user_id = ?"
        ).run(session.status, req.user.id);
      }

      return res.json({
        verified: session.status === "verified",
        status: newStatus,
        lastError: session.last_error?.code || null,
        lastErrorReason: session.last_error?.reason || null,
        verifiedAt: profile.identity_verified_at,
      });
    } catch (err) {
      console.error("Stripe Identity status check error:", err);
      // Fall through to local status
    }
  }

  res.json({
    verified: !!profile.identity_verified,
    status: profile.identity_verification_status || "none",
    verifiedAt: profile.identity_verified_at,
  });
});

// ─── POST /api/payments/connect/onboard ───
// Create a Stripe Connect Express account for a caregiver (or reuse existing)
// Returns the stripeAccountId — embedded onboarding handles the rest in-browser
router.post("/connect/onboard", requireRole("caregiver"), requirePaymentsEnabled, async (req, res) => {
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
        business_profile: {
          mcc: "8099",
          url: "https://inplace.care",
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
      console.error("Stripe account creation error:", err.message, err.type, err.code);
      return res.status(500).json({ error: "Failed to create Stripe account", detail: err.message });
    }
  }

  res.json({ stripeAccountId });
});

// ─── POST /api/payments/connect/account-session ───
// Create an AccountSession for embedded Connect onboarding component
router.post("/connect/account-session", requireRole("caregiver"), requirePaymentsEnabled, async (req, res) => {
  const db = await getDb();
  let stripe;
  try { stripe = getStripe(); } catch {
    return res.status(503).json({ error: "Payment system is not configured yet.", notConfigured: true });
  }

  const profile = await db.prepare("SELECT stripe_account_id FROM caregiver_profiles WHERE user_id = ?").get(req.user.id);
  if (!profile?.stripe_account_id) {
    return res.status(400).json({ error: "No Stripe account yet. Call /connect/onboard first." });
  }

  try {
    const accountSession = await stripe.accountSessions.create({
      account: profile.stripe_account_id,
      components: {
        account_onboarding: {
          enabled: true,
        },
      },
    });

    res.json({ clientSecret: accountSession.client_secret });
  } catch (err) {
    console.error("Stripe AccountSession creation error:", err);
    res.status(500).json({ error: "Failed to create onboarding session" });
  }
});

// ─── POST /api/payments/connect/link ───
// Create a Stripe Account Link for redirect-based onboarding (used by MyAccount Payments tab)
router.post("/connect/link", requireRole("caregiver"), requirePaymentsEnabled, async (req, res) => {
  const db = await getDb();
  let stripe;
  try { stripe = getStripe(); } catch {
    return res.status(503).json({ error: "Payment system is not configured yet.", notConfigured: true });
  }

  const profile = await db.prepare("SELECT stripe_account_id FROM caregiver_profiles WHERE user_id = ?").get(req.user.id);

  let stripeAccountId = profile?.stripe_account_id;

  // Create account first if needed
  if (!stripeAccountId) {
    try {
      const user = await db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
      const account = await stripe.accounts.create({
        type: "express",
        country: "US",
        email: user.email,
        capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
        business_type: "individual",
        individual: {
          first_name: profile?.legal_first_name || user.first_name,
          last_name: profile?.legal_last_name || user.last_name,
          email: user.email,
        },
        business_profile: {
          mcc: "8099",
          url: "https://inplace.care",
        },
        metadata: { inplace_user_id: req.user.id },
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

  try {
    const origin = `${req.protocol}://${req.get("host")}`;
    const accountLink = await stripe.accountLinks.create({
      account: stripeAccountId,
      refresh_url: `${origin}/account#payments-refresh`,
      return_url: `${origin}/account#payments-complete`,
      type: "account_onboarding",
    });
    res.json({ url: accountLink.url });
  } catch (err) {
    console.error("Stripe Account Link error:", err);
    res.status(500).json({ error: "Failed to create onboarding link" });
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
router.post("/checkout", requireRole("family"), requirePaymentsEnabled, async (req, res) => {
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

  // Note: Caregiver identity is verified through Stripe Connect onboarding + Checkr background check.
  // No separate Stripe Identity verification step required for caregivers.

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

  // Platform fee: 20% of base cost + 25% of short-notice surcharge (platform gets smaller share of surcharge)
  let platformFeeCents = Math.round(baseCostCents * PLATFORM_FEE_PERCENT / 100);
  if (surchargeCents > 0) {
    platformFeeCents += Math.round(surchargeCents * SURCHARGE_PLATFORM_SHARE);
  }

  // Payout speed is the caregiver's choice — Stripe handles instant payout fees directly,
  // we don't add any surcharge. Caregivers set their payout preference in their Stripe dashboard.

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
      },
    });

    // Create a pending payment record
    const paymentId = uuid();
    await db.prepare(`
      INSERT INTO payments (id, session_id, family_user_id, caregiver_id, amount, platform_fee, caregiver_payout, status, payment_method, stripe_checkout_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'processing', 'stripe', ?, NOW())
    `).run(
      paymentId, sessionId, req.user.id, session.caregiver_id,
      totalCents / 100, platformFeeCents / 100, (totalCents - platformFeeCents) / 100,
      checkoutSession.id
    );

    res.json({
      checkoutUrl: checkoutSession.url,
      paymentId,
      amount: totalCents / 100,
      platformFee: platformFeeCents / 100,
      caregiverPayout: (totalCents - platformFeeCents) / 100,
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
router.post("/background-check", requireRole("caregiver"), requirePaymentsEnabled, async (req, res) => {
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
router.post("/background-check/confirm", requireRole("caregiver"), requirePaymentsEnabled, async (req, res) => {
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

    // Auto-initiate Checkr background check if configured (non-blocking)
    let checkrInitiated = false;
    if (process.env.CHECKR_API_KEY) {
      try {
        const checkrUrl = `${req.protocol}://${req.get("host")}/api/checkr/initiate`;
        const token = req.headers.authorization;
        const checkrRes = await fetch(checkrUrl, {
          method: "POST",
          headers: { "Authorization": token, "Content-Type": "application/json" },
        });
        const checkrData = await checkrRes.json();
        checkrInitiated = checkrRes.ok;
        console.log(`[bg-check] Auto-initiate Checkr: ${checkrRes.ok ? "success" : "failed"}`, checkrData);
      } catch (err) {
        console.error("[bg-check] Auto-initiate Checkr error (non-blocking):", err.message);
      }
    }

    res.json({ success: true, checkrInitiated });
  } catch (err) {
    console.error("Background check confirm error:", err);
    res.status(500).json({ error: "Failed to confirm payment" });
  }
});

// Payout preferences removed — caregivers manage payout speed directly through their
// Stripe Express dashboard. Stripe handles instant payout fees (1%, min 50¢) themselves.
// We don't add surcharges or get involved in how fast caregivers receive their money.

module.exports = router;
