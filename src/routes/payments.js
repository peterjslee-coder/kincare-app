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
      console.error("⚠️  Webhook signature verification failed:", err.message);
      // Log the sig header prefix so we can identify which Stripe source sent this
      console.error(`  → stripe-signature header starts with: ${(sig || '').substring(0, 30)}...`);
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

  // ─── Detailed webhook logging ───
  console.log(`📨 Webhook received: ${event.type} (id: ${event.id})`);
  if (event.type === 'checkout.session.completed') {
    const obj = event.data?.object;
    console.log(`  → session.id: ${obj?.id}`);
    console.log(`  → metadata: ${JSON.stringify(obj?.metadata || {})}`);
    console.log(`  → amount_total: ${obj?.amount_total}`);
    console.log(`  → payment_intent: ${obj?.payment_intent}`);
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const paymentType = session.metadata?.type;

        // Handle manual payment (no care session attached)
        if (paymentType === "manual_payment") {
          const fromUserId = session.metadata?.from_user_id;
          const caregiverId = session.metadata?.caregiver_id;
          const note = session.metadata?.note;

          try {
            // Create manual_payments record
            const manualPaymentId = uuid();
            // Use caregiver_amount_cents from metadata (what caregiver actually receives)
            // Falls back to amount_total for payments created before fee grossing was added
            const amountCents = parseInt(session.metadata?.caregiver_amount_cents) || session.amount_total;

            // Try to get payout expected date from Stripe transfer/balance
            let payoutExpectedDate = null;
            try {
              if (session.payment_intent) {
                const pi = await stripe.paymentIntents.retrieve(session.payment_intent);
                // Get the latest charge's balance transaction for available_on date
                if (pi.latest_charge) {
                  const charge = await stripe.charges.retrieve(pi.latest_charge);
                  if (charge.transfer) {
                    // Get the transfer on the connected account to find payout timing
                    const cgProfile = await db.prepare("SELECT stripe_account_id FROM caregiver_profiles WHERE id = ?").get(caregiverId);
                    if (cgProfile?.stripe_account_id) {
                      const transfer = await stripe.transfers.retrieve(charge.transfer);
                      // Get the destination payment (charge on connected account)
                      if (transfer.destination_payment) {
                        const destCharge = await stripe.charges.retrieve(
                          transfer.destination_payment,
                          { stripeAccount: cgProfile.stripe_account_id }
                        );
                        if (destCharge.balance_transaction) {
                          const bt = await stripe.balanceTransactions.retrieve(
                            destCharge.balance_transaction,
                            { stripeAccount: cgProfile.stripe_account_id }
                          );
                          if (bt.available_on) {
                            payoutExpectedDate = new Date(bt.available_on * 1000).toISOString().split('T')[0];
                          }
                        }
                      }
                    }
                  }
                }
              }
            } catch (payoutErr) {
              console.log("Could not determine payout date (non-blocking):", payoutErr.message);
            }

            await db.prepare(`
              INSERT INTO manual_payments (id, from_user_id, to_caregiver_id, amount_cents, note, stripe_session_id, stripe_payment_intent_id, status, payout_expected_date, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', ?, NOW())
            `).run(
              manualPaymentId, fromUserId, caregiverId, amountCents, note || null, session.id, session.payment_intent, payoutExpectedDate
            );

            // Get caregiver and family user info for notification
            const caregiver = await db.prepare("SELECT cp.user_id, u.first_name, u.last_name FROM caregiver_profiles cp JOIN users u ON cp.user_id = u.id WHERE cp.id = ?").get(caregiverId);
            const familyUser = await db.prepare("SELECT first_name FROM users WHERE id = ?").get(fromUserId);

            // Send push notification to caregiver
            if (caregiver?.user_id) {
              const { sendPushToUser } = require("./push");
              const payoutMsg = payoutExpectedDate ? ` Expected in your bank by ${new Date(payoutExpectedDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}.` : '';
              sendPushToUser(caregiver.user_id, {
                title: `You received a payment`,
                body: `You received $${(amountCents / 100).toFixed(2)} from ${familyUser?.first_name || 'a family'}${note ? `: "${note}"` : ''}${payoutMsg}`,
                data: { type: 'manual_payment_received', caregiverId, page: 'earnings' },
              }, 'manual_payment_received').catch(() => {});
            }

            console.log(`💳 Manual payment of $${(amountCents / 100).toFixed(2)} completed from user ${fromUserId} to caregiver ${caregiverId}${payoutExpectedDate ? ` (payout expected ${payoutExpectedDate})` : ''}`);
          } catch (err) {
            console.error("Manual payment webhook error:", err.message);
          }
          break;
        }

        // Handle regular care session payment
        let sessionId = session.metadata?.inplace_session_id;
        if (!sessionId && session.id) {
          // Metadata missing — likely thin event or Event Destination format
          // Fetch the full checkout session from Stripe to get metadata
          console.warn(`⚠️  No inplace_session_id in event metadata — fetching full session from Stripe (id: ${session.id})`);
          try {
            const fullSession = await getStripe().checkout.sessions.retrieve(session.id);
            sessionId = fullSession.metadata?.inplace_session_id;
            if (sessionId) {
              // Backfill the session object with full data so tip/payment processing works
              Object.assign(session, fullSession);
              console.log(`  → Fetched full session — found inplace_session_id: ${sessionId}`);
            }
          } catch (fetchErr) {
            console.error(`  → Failed to fetch full session: ${fetchErr.message}`);
          }
        }
        if (!sessionId) {
          // Also try lookup by stripe_checkout_id in our payments table as last resort
          if (session.id) {
            try {
              const paymentRow = await db.prepare("SELECT session_id FROM payments WHERE stripe_checkout_id = ?").get(session.id);
              if (paymentRow?.session_id) {
                sessionId = paymentRow.session_id;
                console.log(`  → Found session_id via payments table lookup: ${sessionId}`);
              }
            } catch (lookupErr) {
              console.error(`  → Payments table lookup failed: ${lookupErr.message}`);
            }
          }
        }
        if (!sessionId) {
          console.warn(`⚠️  checkout.session.completed has NO inplace_session_id — all lookups failed. event metadata keys: ${Object.keys(session.metadata || {}).join(', ')}, session.id: ${session.id || 'missing'}`);
          break;
        }
        console.log(`  → Processing care session payment for ${sessionId}`);

        // Update payment record
        await db.prepare(
          "UPDATE payments SET status = 'completed', stripe_payment_intent = ? WHERE stripe_checkout_id = ?"
        ).run(session.payment_intent, session.id);

        // Update care session payment status
        await db.prepare(
          "UPDATE care_sessions SET payment_status = 'paid', updated_at = NOW() WHERE id = ?"
        ).run(sessionId);

        // If tip was included, create the tip record so it appears in caregiver dashboard
        const tipCents = parseInt(session.metadata?.inplace_tip_cents || "0");
        if (tipCents > 0) {
          const tipReason = session.metadata?.inplace_tip_reason || null;
          const familyUserId = session.metadata?.inplace_family_user_id || session.metadata?.inplace_paid_by_user_id;
          const caregiverId = session.metadata?.inplace_caregiver_id;
          try {
            const { v4: tipUuid } = require("uuid");
            const existingTip = await db.prepare("SELECT id FROM tips WHERE session_id = ? AND family_user_id = ?").get(sessionId, familyUserId);
            if (!existingTip) {
              await db.prepare(
                "INSERT INTO tips (id, session_id, family_user_id, caregiver_id, amount_cents, reason_text) VALUES (?, ?, ?, ?, ?, ?)"
              ).run(tipUuid(), sessionId, familyUserId, caregiverId, tipCents, tipReason);
              console.log(`💛 Tip of $${(tipCents / 100).toFixed(2)} recorded for session ${sessionId}`);
            }
          } catch (tipErr) {
            console.error("Tip record creation error (non-blocking):", tipErr.message);
          }
        }

        console.log(`✅ Payment completed for session ${sessionId}${tipCents > 0 ? ` (includes $${(tipCents/100).toFixed(2)} tip)` : ''}`);

        // Restore held sessions if family's balance is now clear
        const webhookFamilyUserId = session.metadata?.inplace_family_user_id || session.metadata?.inplace_paid_by_user_id;
        if (webhookFamilyUserId) {
          try { await restoreHeldSessions(webhookFamilyUserId, null); } catch (e) { console.error('[webhook] Restore held sessions error:', e.message); }
        }
        break;
      }

      case "checkout.session.expired": {
        const session = event.data.object;
        // Mark payment as failed/expired
        await db.prepare(
          "UPDATE payments SET status = 'failed' WHERE stripe_checkout_id = ?"
        ).run(session.id);

        console.log(`❌ Checkout expired for session ${session.metadata?.inplace_session_id}`);
        break;
      }

      case "payment_intent.payment_failed": {
        const intent = event.data.object;
        await db.prepare(
          "UPDATE payments SET status = 'failed' WHERE stripe_payment_intent = ?"
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
        // Link methods often have dummy card values (0000, 12/2040) — prefer real link details
        const linkObj = pm.link || {};
        const cardFallback = pm.card || {};
        // Only use card last4 if it's not a placeholder
        const realLast4 = linkObj.last4 || (cardFallback.last4 && cardFallback.last4 !== "0000" ? cardFallback.last4 : null);
        const realExpMonth = linkObj.exp_month || (cardFallback.exp_year && cardFallback.exp_year < 2040 ? cardFallback.exp_month : null);
        const realExpYear = linkObj.exp_year || (cardFallback.exp_year && cardFallback.exp_year < 2040 ? cardFallback.exp_year : null);
        methods.push({
          id: pm.id,
          type: "link",
          brand: "Stripe Link",
          last4: realLast4,
          expMonth: realExpMonth,
          expYear: realExpYear,
          isLink: true,
          email: linkObj.email || pm.billing_details?.email || null,
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
      connected: isComplete,
      status: isComplete ? "active" : "pending",
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
      detailsSubmitted: account.details_submitted,
      stripeAccountId: profile.stripe_account_id,
      onboardingStarted: true,
    });
  } catch (err) {
    console.error("Stripe status check error:", err);
    // If Stripe can't find the account (e.g. test/fake account), return graceful fallback
    if (err.type === 'StripeInvalidRequestError' || err.statusCode === 404) {
      return res.json({
        connected: false,
        status: "invalid",
        onboardingStarted: true,
        stripeAccountId: profile.stripe_account_id,
        error: "Stripe account not found or invalid",
      });
    }
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
// Accepts optional tipCents + tipReason — tip is bundled into the same charge, 100% to caregiver
router.post("/checkout", requireRole("family"), requirePaymentsEnabled, async (req, res) => {
  const db = await getDb();
  const stripe = getStripe();
  const { sessionId, tipCents: rawTipCents, tipReason } = req.body;

  if (!sessionId) return res.status(400).json({ error: "sessionId is required" });

  // Validate tip
  const tipCents = Math.max(0, Math.min(50000, Math.round(rawTipCents || 0))); // $0-$500

  // Get the care session — allow both the booker and the billing contact to check out
  const session = await db.prepare(`
    SELECT cs.*, cp.stripe_account_id, cp.stripe_onboard_complete,
      cp.hourly_rate, cp.rate_daytime, cp.rate_nighttime, cp.rate_overnight,
      cp.user_id AS caregiver_user_id,
      u.first_name || ' ' || u.last_name AS caregiver_name,
      cr.first_name || ' ' || cr.last_name AS recipient_name,
      ct.billing_user_id,
      bu.stripe_customer_id AS billing_stripe_customer_id,
      bu.first_name || ' ' || bu.last_name AS billing_contact_name
    FROM care_sessions cs
    LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
    LEFT JOIN users u ON cp.user_id = u.id
    LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
    LEFT JOIN care_teams ct ON ct.care_recipient_id = cs.care_recipient_id
    LEFT JOIN users bu ON ct.billing_user_id = bu.id
    WHERE cs.id = ? AND (cs.family_user_id = ? OR ct.billing_user_id = ?)
  `).get(sessionId, req.user.id, req.user.id);

  if (!session) return res.status(404).json({ error: "Session not found" });
  if (!session.caregiver_id) return res.status(400).json({ error: "No caregiver assigned to this session" });
  if (!session.stripe_account_id || !session.stripe_onboard_complete) {
    return res.status(400).json({ error: "Caregiver has not completed Stripe setup" });
  }

  // Note: Caregiver identity is verified through Stripe Connect onboarding + Checkr background check.
  // No separate Stripe Identity verification step required for caregivers.

  // Check if already paid — only block on completed payments
  const completedPayment = await db.prepare(
    "SELECT id FROM payments WHERE session_id = ? AND status = 'completed'"
  ).get(sessionId);
  if (completedPayment) return res.status(400).json({ error: "Payment already processed for this session" });

  // Clear any stuck 'processing' records from failed checkout attempts so we can retry
  await db.prepare(
    "UPDATE payments SET status = 'failed' WHERE session_id = ? AND status = 'processing'"
  ).run(sessionId);

  // ─── Calculate amounts ───
  // CORE PRINCIPLE: Caregiver gets EXACTLY rate × time. All fees go on top, paid by family.
  // Duration rounds UP to 15-minute increments.
  const rawDurationHours = session.duration_hours || 2;
  const durationHours = Math.ceil(rawDurationHours * 4) / 4; // round up to nearest 0.25h (15 min)

  let caregiverPayCents, surchargeCents = 0;
  const effectiveRate = (session.proposed_rate && parseFloat(session.proposed_rate) > 0)
    ? parseFloat(session.proposed_rate)
    : session.agreed_rate || null;

  if (effectiveRate) {
    // Family offered a specific rate (or negotiated) — caregiver gets exactly this × time
    caregiverPayCents = Math.round(effectiveRate * durationHours * 100);
    surchargeCents = Math.round((session.short_notice_surcharge || 0) * 100);
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
    caregiverPayCents = Math.round(costResult.subtotal * 100);
    surchargeCents = Math.round(costResult.surcharge * 100);
  }

  // Platform fee: 20% of all caregiver compensation (pay + tip) + 25% of short-notice surcharge
  // Tips are compensation — without this, families could game the system with low rates + big tips.
  // Caregiver still gets exact amounts; the 20% on tips is added ON TOP for the family.
  let platformFeeCents = Math.round((caregiverPayCents + tipCents) * PLATFORM_FEE_PERCENT / 100);
  if (surchargeCents > 0) {
    platformFeeCents += Math.round(surchargeCents * SURCHARGE_PLATFORM_SHARE);
  }

  // Subtotal before Stripe = caregiver pay + surcharge + platform fee + tip
  // Caregiver receives: caregiverPayCents + surchargeCents + tipCents (all of it, no deductions)
  const caregiverTotalCents = caregiverPayCents + surchargeCents + tipCents;
  const subtotalBeforeStripeCents = caregiverTotalCents + platformFeeCents;

  // Gross up for Stripe processing fees (2.9% + $0.30) so platform balance stays neutral
  // Formula: grossAmount = (subtotal + 30) / (1 - 0.029), rounded up
  const grossedTotalCents = Math.ceil((subtotalBeforeStripeCents + 30) / (1 - 0.029));
  const processingFeeCents = grossedTotalCents - subtotalBeforeStripeCents;

  // Family pays grossedTotalCents. Caregiver gets caregiverTotalCents. Platform gets platformFeeCents.
  // Stripe gets ~processingFeeCents (taken from application_fee_amount in destination charges).
  const grandTotalCents = grossedTotalCents;

  try {
    // If a billing contact is set for this care recipient's team, use their Stripe customer
    // so their saved payment methods appear at checkout
    const billingCustomerId = session.billing_stripe_customer_id || null;
    const paidByUserId = session.billing_user_id || req.user.id;

    // Build line items — transparent breakdown: caregiver pay, platform fee, processing fee, tip
    const caregiverDesc = `${session.service_type} on ${session.scheduled_date} at ${session.scheduled_time} (${durationHours}h) with ${session.caregiver_name || "Caregiver"}`;
    const lineItems = [{
      price_data: {
        currency: "usd",
        product_data: {
          name: `Care Session — ${session.recipient_name || "Care Recipient"}`,
          description: caregiverDesc,
        },
        unit_amount: caregiverPayCents + surchargeCents,
      },
      quantity: 1,
    }];
    if (tipCents > 0) {
      lineItems.push({
        price_data: {
          currency: "usd",
          product_data: {
            name: `Tip for ${session.caregiver_name || "Caregiver"}`,
            description: tipReason || "Thank you tip",
          },
          unit_amount: tipCents,
        },
        quantity: 1,
      });
    }
    // Platform fee + processing fee — both paid by family, on top of caregiver's pay
    lineItems.push({
      price_data: {
        currency: "usd",
        product_data: {
          name: "InPlace fee + payment processing",
          description: `20% platform fee ($${(platformFeeCents / 100).toFixed(2)}) + Stripe processing ($${(processingFeeCents / 100).toFixed(2)})`,
        },
        unit_amount: platformFeeCents + processingFeeCents,
      },
      quantity: 1,
    });

    // application_fee_amount = platform fee + processing fee (Stripe takes their cut from this)
    // Caregiver receives: grandTotalCents - application_fee_amount = caregiverTotalCents
    const applicationFeeCents = platformFeeCents + processingFeeCents;

    const checkoutParams = {
      mode: "payment",
      payment_method_types: ["card", "us_bank_account"],
      line_items: lineItems,
      payment_intent_data: {
        application_fee_amount: applicationFeeCents,
        transfer_data: {
          destination: session.stripe_account_id,
        },
      },
      success_url: `${BASE_URL}/#payment-success?session=${sessionId}`,
      cancel_url: `${BASE_URL}/#payment-cancel?session=${sessionId}`,
      metadata: {
        inplace_session_id: sessionId,
        inplace_family_user_id: req.user.id,
        inplace_paid_by_user_id: paidByUserId,
        inplace_caregiver_id: session.caregiver_id,
        inplace_tip_cents: String(tipCents),
        inplace_tip_reason: tipReason || "",
      },
    };

    // Attach billing contact's Stripe customer for saved payment methods
    if (billingCustomerId) {
      checkoutParams.customer = billingCustomerId;
    }

    const checkoutSession = await stripe.checkout.sessions.create(checkoutParams);

    // Create a pending payment record — family_user_id is the billing contact if set
    const paymentId = uuid();
    await db.prepare(`
      INSERT INTO payments (id, session_id, family_user_id, caregiver_id, amount, platform_fee, caregiver_payout, status, payment_method, stripe_checkout_id, tip_cents, tip_reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'processing', 'stripe', ?, ?, ?, NOW())
    `).run(
      paymentId, sessionId, paidByUserId, session.caregiver_id,
      grandTotalCents / 100, platformFeeCents / 100, caregiverTotalCents / 100,
      checkoutSession.id, tipCents, tipReason || null
    );

    console.log(`💳 Checkout created: session=${sessionId} caregiver=$${(caregiverTotalCents/100).toFixed(2)} platform=$${(platformFeeCents/100).toFixed(2)} processing=$${(processingFeeCents/100).toFixed(2)} total=$${(grandTotalCents/100).toFixed(2)}`);

    res.json({
      checkoutUrl: checkoutSession.url,
      paymentId,
      amount: grandTotalCents / 100,
      sessionCost: (caregiverPayCents + surchargeCents) / 100,
      tipAmount: tipCents / 100,
      platformFee: platformFeeCents / 100,
      processingFee: processingFeeCents / 100,
      caregiverPayout: caregiverTotalCents / 100,
      achAvailable: true,
      billingContact: session.billing_user_id ? session.billing_contact_name : null,
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
// Caregiver earnings summary (session payments + manual payments)
router.get("/earnings", requireRole("caregiver"), async (req, res) => {
  const db = await getDb();
  let stripe;
  try { stripe = getStripe(); } catch { stripe = null; }
  const profile = await db.prepare("SELECT id, stripe_account_id FROM caregiver_profiles WHERE user_id = ?").get(req.user.id);
  if (!profile) return res.status(404).json({ error: "Caregiver profile not found" });

  const { from, to } = req.query;

  // Session-based payments
  let query = `SELECT * FROM payments WHERE caregiver_id = ? AND status = 'completed'`;
  const params = [profile.id];

  if (from) { query += " AND created_at >= ?"; params.push(from); }
  if (to) { query += " AND created_at <= ?"; params.push(to); }

  query += " ORDER BY created_at DESC";

  const payments = await db.prepare(query).all(...params);

  // Manual payments (tips, bonuses, direct sends)
  let manualPayments = [];
  try {
    let mpQuery = `
      SELECT mp.*, u.first_name || ' ' || u.last_name AS from_name
      FROM manual_payments mp
      LEFT JOIN users u ON mp.from_user_id = u.id
      WHERE mp.to_caregiver_id = ? AND mp.status = 'completed'
    `;
    const mpParams = [profile.id];
    if (from) { mpQuery += " AND mp.created_at >= ?"; mpParams.push(from); }
    if (to) { mpQuery += " AND mp.created_at <= ?"; mpParams.push(to); }
    mpQuery += " ORDER BY mp.created_at DESC";
    manualPayments = await db.prepare(mpQuery).all(...mpParams);
  } catch (err) {
    // manual_payments table may not exist yet
  }

  const totalEarned = payments.reduce((sum, p) => sum + (p.caregiver_payout || 0), 0);
  const manualTotal = manualPayments.reduce((sum, p) => sum + ((p.amount_cents || 0) / 100), 0);
  const totalSessions = payments.length;
  const pendingPayments = await db.prepare(
    "SELECT SUM(caregiver_payout) as total FROM payments WHERE caregiver_id = ? AND status = 'processing'"
  ).get(profile.id);

  // Lazy backfill: look up payout dates from Stripe for manual payments missing them
  for (const mp of manualPayments) {
    if (stripe && profile.stripe_account_id && !mp.payout_expected_date && mp.stripe_payment_intent_id) {
      try {
        const pi = await stripe.paymentIntents.retrieve(mp.stripe_payment_intent_id);
        if (pi.latest_charge) {
          const charge = await stripe.charges.retrieve(pi.latest_charge);
          if (charge.transfer) {
            const transfer = await stripe.transfers.retrieve(charge.transfer);
            if (transfer.destination_payment) {
              const destCharge = await stripe.charges.retrieve(
                transfer.destination_payment,
                { stripeAccount: profile.stripe_account_id || undefined }
              );
              if (destCharge.balance_transaction) {
                const bt = await stripe.balanceTransactions.retrieve(
                  destCharge.balance_transaction,
                  { stripeAccount: profile.stripe_account_id || undefined }
                );
                if (bt.available_on) {
                  mp.payout_expected_date = new Date(bt.available_on * 1000).toISOString().split('T')[0];
                  // Persist so we don't look it up again
                  try { await db.prepare("UPDATE manual_payments SET payout_expected_date = ? WHERE id = ?").run(mp.payout_expected_date, mp.id); } catch(e) {}
                }
              }
            }
          }
        }
      } catch (lookupErr) {
        // Non-blocking — payout date just won't show
      }
    }
  }

  res.json({
    totalEarned: Math.round((totalEarned + manualTotal) * 100) / 100,
    totalSessions,
    manualPaymentTotal: Math.round(manualTotal * 100) / 100,
    pendingAmount: Math.round((pendingPayments?.total || 0) * 100) / 100,
    payments: payments.map(p => ({
      id: p.id,
      sessionId: p.session_id,
      amount: p.amount,
      platformFee: p.platform_fee,
      payout: p.caregiver_payout,
      status: p.status,
      createdAt: p.created_at,
      type: 'session',
    })),
    manualPayments: manualPayments.map(p => ({
      id: p.id,
      amount: (p.amount_cents || 0) / 100,
      note: p.note,
      fromName: p.from_name,
      status: p.status,
      payoutExpectedDate: p.payout_expected_date,
      stripePaymentIntentId: p.stripe_payment_intent_id,
      createdAt: p.created_at,
      type: 'manual',
    })),
  });
});

// ─── GET /api/payments/history ───
// Family payment history
router.get("/history", requireRole("family"), async (req, res) => {
  const db = await getDb();

  // Care session payments
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

  // Manual payments (tips, bonuses, etc.)
  let manualPayments = [];
  try {
    manualPayments = await db.prepare(`
      SELECT mp.id, mp.amount_cents, mp.note, mp.status, mp.created_at,
        u.first_name || ' ' || u.last_name AS caregiver_name
      FROM manual_payments mp
      LEFT JOIN caregiver_profiles cp ON mp.to_caregiver_id = cp.id
      LEFT JOIN users u ON cp.user_id = u.id
      WHERE mp.from_user_id = ?
      ORDER BY mp.created_at DESC
      LIMIT 50
    `).all(req.user.id);
  } catch (err) {
    // manual_payments table may not exist yet
  }

  // Combine both into a unified list
  const sessionTotal = payments.filter(p => p.status === 'completed').reduce((sum, p) => sum + (p.amount || 0), 0);
  const manualTotal = manualPayments.filter(p => p.status === 'completed').reduce((sum, p) => sum + ((p.amount_cents || 0) / 100), 0);
  const totalSpent = sessionTotal + manualTotal;

  const combined = [
    ...payments.map(p => ({
      id: p.id,
      sessionId: p.session_id,
      amount: p.amount,
      status: p.status,
      serviceType: p.service_type,
      scheduledDate: p.scheduled_date,
      caregiverName: p.caregiver_name,
      recipientName: p.recipient_name,
      createdAt: p.created_at,
      type: 'session',
    })),
    ...manualPayments.map(p => ({
      id: p.id,
      amount: (p.amount_cents || 0) / 100,
      status: p.status,
      serviceType: 'Manual Payment',
      note: p.note,
      caregiverName: p.caregiver_name,
      createdAt: p.created_at,
      type: 'manual',
    })),
  ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 50);

  res.json({
    totalSpent: Math.round(totalSpent * 100) / 100,
    payments: combined,
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

// ─── Auto-pay: charge saved payment method for overdue sessions ───
// Called by the server cron. Finds completed sessions past payment_due_at with no payment,
// and charges the family's saved payment method. No tip (they missed the window).
async function processOverduePayments(pushFn) {
  const db = await getDb();
  let stripe;
  try { stripe = getStripe(); } catch { return; }
  const enabled = await paymentsEnabled();
  if (!enabled) return;

  try {
    // Find sessions that are completed, past payment_due_at, unpaid, and have a caregiver with Stripe
    const overdue = await db.prepare(`
      SELECT cs.id, cs.family_user_id, cs.caregiver_id, cs.estimated_cost, cs.duration_hours,
        cs.short_notice_surcharge, cs.scheduled_date, cs.scheduled_time, cs.service_type,
        cs.care_recipient_id, cs.pending_tip_cents, cs.pending_tip_reason,
        cp.stripe_account_id, cp.stripe_onboard_complete, cp.user_id AS caregiver_user_id,
        cp.hourly_rate,
        u.first_name || ' ' || u.last_name AS caregiver_name,
        cr.first_name AS recipient_name,
        fu.stripe_customer_id AS family_stripe_customer_id,
        fu.first_name AS family_first_name,
        ct.billing_user_id,
        bu.stripe_customer_id AS billing_stripe_customer_id
      FROM care_sessions cs
      LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
      LEFT JOIN users u ON cp.user_id = u.id
      LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
      LEFT JOIN users fu ON cs.family_user_id = fu.id
      LEFT JOIN care_teams ct ON ct.care_recipient_id = cs.care_recipient_id
      LEFT JOIN users bu ON ct.billing_user_id = bu.id
      WHERE cs.status = 'completed'
        AND cs.payment_due_at IS NOT NULL
        AND cs.payment_due_at < NOW()
        AND (cs.payment_status IS NULL OR cs.payment_status = 'pending')
        AND cp.stripe_account_id IS NOT NULL
        AND cp.stripe_onboard_complete = 1
        AND NOT EXISTS (
          SELECT 1 FROM payments p WHERE p.session_id = cs.id AND p.status IN ('completed', 'processing')
        )
    `).all();

    for (const s of overdue) {
      try {
        // Determine which Stripe customer to charge (billing contact or family)
        const customerId = s.billing_stripe_customer_id || s.family_stripe_customer_id;
        if (!customerId) {
          console.warn(`[auto-pay] Session ${s.id}: no saved payment method — skipping`);
          // Send push notification asking family to pay manually
          if (pushFn && s.family_user_id) {
            pushFn(s.family_user_id, {
              title: 'Payment needed',
              body: `Please complete payment for your care session on ${s.scheduled_date}. Open the app to pay.`,
              data: { type: 'payment_needed', sessionId: s.id, page: 'home' },
            }, 'payment_needed').catch(() => {});
          }
          continue;
        }

        // Get default payment method for this customer
        const paymentMethods = await stripe.paymentMethods.list({ customer: customerId, type: "card", limit: 1 });
        if (!paymentMethods.data.length) {
          console.warn(`[auto-pay] Session ${s.id}: customer ${customerId} has no saved cards — skipping`);
          if (pushFn && s.family_user_id) {
            pushFn(s.family_user_id, {
              title: 'Payment needed',
              body: `Please complete payment for your care session on ${s.scheduled_date}. Open the app to pay.`,
              data: { type: 'payment_needed', sessionId: s.id, page: 'home' },
            }, 'payment_needed').catch(() => {});
          }
          continue;
        }

        // Calculate cost — include pending tip if family set one during grace period
        // CORE PRINCIPLE: Caregiver gets EXACTLY their pay + tip. Fees go on top, charged to family.
        const tipCents = Math.max(0, parseInt(s.pending_tip_cents) || 0);
        const rawDuration = s.duration_hours || 2;
        const roundedDuration = Math.ceil(rawDuration * 4) / 4; // 15-min increments
        const effectiveRate = (s.proposed_rate && parseFloat(s.proposed_rate) > 0)
          ? parseFloat(s.proposed_rate) : s.agreed_rate || null;
        const caregiverPayCents = effectiveRate
          ? Math.round(effectiveRate * roundedDuration * 100)
          : Math.round((s.estimated_cost || 0) * 100); // fallback to estimated_cost for tiered rates
        const surchargeCents = Math.round((s.short_notice_surcharge || 0) * 100);
        const caregiverTotalCents = caregiverPayCents + surchargeCents + tipCents;

        // Platform fee: 20% of caregiver pay + tip (tips are compensation), plus surcharge share
        let platformFeeCents = Math.round((caregiverPayCents + tipCents) * PLATFORM_FEE_PERCENT / 100);
        if (surchargeCents > 0) {
          platformFeeCents += Math.round(surchargeCents * SURCHARGE_PLATFORM_SHARE);
        }

        // Gross up for Stripe fees so platform balance stays neutral
        const subtotalCents = caregiverTotalCents + platformFeeCents;
        const grossedTotalCents = Math.ceil((subtotalCents + 30) / (1 - 0.029));
        const processingFeeCents = grossedTotalCents - subtotalCents;
        const totalCents = grossedTotalCents;
        const applicationFeeCents = platformFeeCents + processingFeeCents;

        if (totalCents < 50) continue; // Stripe minimum is $0.50

        // Create PaymentIntent directly (no checkout session — family isn't present)
        const intent = await stripe.paymentIntents.create({
          amount: totalCents,
          currency: "usd",
          customer: customerId,
          payment_method: paymentMethods.data[0].id,
          off_session: true,
          confirm: true,
          application_fee_amount: applicationFeeCents,
          transfer_data: { destination: s.stripe_account_id },
          metadata: {
            inplace_session_id: s.id,
            inplace_family_user_id: s.family_user_id,
            inplace_caregiver_id: s.caregiver_id,
            inplace_auto_charged: "true",
            inplace_tip_cents: String(tipCents),
            inplace_tip_reason: s.pending_tip_reason || "",
          },
          description: `Auto-pay: ${s.service_type} on ${s.scheduled_date} with ${s.caregiver_name || 'Caregiver'}${tipCents > 0 ? ` (includes $${(tipCents/100).toFixed(2)} tip)` : ''}`,
        });

        // Record payment
        const paymentId = uuid();
        await db.prepare(`
          INSERT INTO payments (id, session_id, family_user_id, caregiver_id, amount, platform_fee, caregiver_payout, status, payment_method, stripe_payment_intent, tip_cents, tip_reason, auto_charged, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', 'stripe', ?, ?, ?, 1, NOW())
        `).run(
          paymentId, s.id, s.billing_user_id || s.family_user_id, s.caregiver_id,
          totalCents / 100, platformFeeCents / 100, caregiverTotalCents / 100,
          intent.id, tipCents, s.pending_tip_reason || null
        );

        // Create tip record if tip was included (so it shows in caregiver dashboard)
        if (tipCents > 0) {
          try {
            const existingTip = await db.prepare("SELECT id FROM tips WHERE session_id = ?").get(s.id);
            if (!existingTip) {
              await db.prepare(
                "INSERT INTO tips (id, session_id, family_user_id, caregiver_id, amount_cents, reason_text) VALUES (?, ?, ?, ?, ?, ?)"
              ).run(uuid(), s.id, s.billing_user_id || s.family_user_id, s.caregiver_id, tipCents, s.pending_tip_reason || null);
            }
          } catch (tipErr) { console.error("[auto-pay] Tip record error (non-blocking):", tipErr.message); }
        }

        // Mark session as paid
        await db.prepare("UPDATE care_sessions SET payment_status = 'paid', updated_at = NOW() WHERE id = ?").run(s.id);

        console.log(`💳 Auto-pay: session ${s.id} — caregiver=$${(caregiverTotalCents/100).toFixed(2)}${tipCents > 0 ? ` (includes $${(tipCents/100).toFixed(2)} tip)` : ''} platform=$${(platformFeeCents/100).toFixed(2)} processing=$${(processingFeeCents/100).toFixed(2)} total=$${(totalCents/100).toFixed(2)}`);

        // Notify family
        if (pushFn && s.family_user_id) {
          pushFn(s.family_user_id, {
            title: 'Payment processed',
            body: `$${(totalCents / 100).toFixed(2)} charged for ${s.service_type} on ${s.scheduled_date} with ${s.caregiver_name || 'your caregiver'}.`,
            data: { type: 'payment_auto_charged', sessionId: s.id, page: 'home' },
          }, 'payment_auto_charged').catch(() => {});
        }

        // Check if family's held sessions can be restored
        await restoreHeldSessions(s.family_user_id || s.billing_user_id, pushFn);
      } catch (err) {
        // Mark the session payment as failed so lockout logic can distinguish
        // "hasn't been charged yet" from "charge was attempted and failed"
        await db.prepare("UPDATE care_sessions SET payment_status = 'failed', updated_at = NOW() WHERE id = ?").run(s.id);

        // STP "authentication_required" = card needs 3DS, can't auto-charge
        if (err.code === 'authentication_required') {
          console.warn(`[auto-pay] Session ${s.id}: card requires authentication — sending manual pay notification`);
          if (pushFn && s.family_user_id) {
            pushFn(s.family_user_id, {
              title: 'Payment action needed',
              body: `Your card requires verification for the $${((s.estimated_cost || 0)).toFixed(2)} care session payment. Please open the app to complete payment.`,
              data: { type: 'payment_auth_required', sessionId: s.id, page: 'home' },
            }, 'payment_auth_required').catch(() => {});
          }
        } else {
          console.error(`[auto-pay] Session ${s.id} failed:`, err.message);
          if (pushFn && s.family_user_id) {
            pushFn(s.family_user_id, {
              title: 'Payment failed',
              body: `We couldn't charge your card for the ${s.service_type} session on ${s.scheduled_date}. Please update your payment method.`,
              data: { type: 'payment_failed', sessionId: s.id, page: 'home' },
            }, 'payment_failed').catch(() => {});
          }
        }
      }
    }
  } catch (err) {
    console.error("[auto-pay] Overdue payment processing error:", err.message);
  }
}

// ─── Restore held sessions when family clears their balance ───
async function restoreHeldSessions(familyUserId, pushFn) {
  const db = await getDb();
  try {
    // Check if this family still has failed payments (not just pending/grace period)
    const remaining = await db.prepare(`
      SELECT cs.id FROM care_sessions cs
      WHERE cs.family_user_id = ? AND cs.status = 'completed'
        AND cs.payment_status = 'failed'
        AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.session_id = cs.id AND p.status IN ('completed', 'processing'))
        AND cs.estimated_cost > 0
      LIMIT 1
    `).get(familyUserId);

    if (remaining) return; // Still has failed payments — keep holds

    // All clear — restore payment_hold sessions back to confirmed
    const held = await db.prepare(`
      SELECT cs.id, cs.scheduled_date, cs.caregiver_id,
        u.first_name AS cg_first_name,
        fu.first_name AS family_first_name
      FROM care_sessions cs
      LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
      LEFT JOIN users u ON cp.user_id = u.id
      LEFT JOIN users fu ON cs.family_user_id = fu.id
      WHERE cs.family_user_id = ? AND cs.status = 'payment_hold'
    `).all(familyUserId);

    for (const s of held) {
      await db.prepare("UPDATE care_sessions SET status = 'confirmed', updated_at = NOW() WHERE id = ?").run(s.id);
      console.log(`✅ Restored session ${s.id} from payment_hold → confirmed`);

      // Notify caregiver
      if (pushFn && s.caregiver_id) {
        try {
          const cgUser = await db.prepare("SELECT user_id FROM caregiver_profiles WHERE id = ?").get(s.caregiver_id);
          if (cgUser) {
            pushFn(cgUser.user_id, {
              title: 'Session restored',
              body: `Your ${s.scheduled_date} session with ${s.family_first_name || 'a family'} is back on! Payment issue resolved.`,
              data: { type: 'session_restored', sessionId: s.id, page: 'home' },
            }, 'session_restored').catch(() => {});
          }
        } catch {}
      }

      // Notify family
      if (pushFn) {
        pushFn(familyUserId, {
          title: 'Session restored',
          body: `Your ${s.scheduled_date} session with ${s.cg_first_name || 'your caregiver'} is confirmed again. Thank you for paying!`,
          data: { type: 'session_restored', sessionId: s.id, page: 'home' },
        }, 'session_restored').catch(() => {});
      }
    }

    if (held.length > 0) {
      console.log(`✅ Restored ${held.length} held session(s) for family user ${familyUserId}`);
    }
  } catch (err) {
    console.error(`[restore-holds] Error for family ${familyUserId}:`, err.message);
  }
}

// ─── Hold future sessions for families with unpaid balance ───
// After auto-pay fails, any upcoming confirmed sessions are put on hold
// Both family and caregiver are notified
async function holdSessionsForUnpaidFamilies(pushFn) {
  const db = await getDb();
  try {
    // Find families whose auto-pay has FAILED — only block after a real failure,
    // not while payment is still pending or in the grace period
    const deadbeats = await db.prepare(`
      SELECT DISTINCT cs.family_user_id
      FROM care_sessions cs
      WHERE cs.status = 'completed'
        AND cs.estimated_cost > 0
        AND cs.payment_status = 'failed'
        AND NOT EXISTS (
          SELECT 1 FROM payments p WHERE p.session_id = cs.id AND p.status IN ('completed', 'processing')
        )
    `).all();

    for (const { family_user_id } of deadbeats) {
      // Find their upcoming confirmed sessions that aren't already on hold
      const upcoming = await db.prepare(`
        SELECT cs.id, cs.caregiver_id, cs.scheduled_date, cs.scheduled_time,
          cp.user_id AS caregiver_user_id,
          u.first_name AS cg_first_name,
          fu.first_name AS family_first_name
        FROM care_sessions cs
        LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
        LEFT JOIN users u ON cp.user_id = u.id
        LEFT JOIN users fu ON cs.family_user_id = fu.id
        WHERE cs.family_user_id = ?
          AND cs.status IN ('confirmed', 'pending')
          AND cs.scheduled_date >= CURRENT_DATE
      `).all(family_user_id);

      for (const s of upcoming) {
        // Put on hold
        await db.prepare(
          "UPDATE care_sessions SET status = 'payment_hold', updated_at = NOW() WHERE id = ? AND status IN ('confirmed', 'pending')"
        ).run(s.id);

        console.log(`🚫 Session ${s.id} on hold — family ${family_user_id} has unpaid sessions`);

        // Notify caregiver
        if (pushFn && s.caregiver_user_id) {
          pushFn(s.caregiver_user_id, {
            title: 'Session on hold',
            body: `Your ${s.scheduled_date} session with ${s.family_first_name || 'a family'} is on hold due to a payment issue. We'll notify you when it's resolved.`,
            data: { type: 'session_payment_hold', sessionId: s.id, page: 'home' },
          }, 'session_payment_hold').catch(() => {});
        }

        // Notify family
        if (pushFn) {
          pushFn(family_user_id, {
            title: 'Sessions on hold — payment needed',
            body: `Your upcoming session on ${s.scheduled_date} with ${s.cg_first_name || 'your caregiver'} is on hold. Please complete your outstanding payment to resume.`,
            data: { type: 'session_payment_hold', sessionId: s.id, page: 'home' },
          }, 'session_payment_hold').catch(() => {});
        }
      }
    }
  } catch (err) {
    console.error("[hold-sessions] Error:", err.message);
  }
}

router.processOverduePayments = processOverduePayments;
router.holdSessionsForUnpaidFamilies = holdSessionsForUnpaidFamilies;

// ─── DELETE /api/payments/family/methods/:pmId ───
// Remove a saved payment method from a family user's Stripe customer
router.delete("/family/methods/:pmId", requireRole("family"), async (req, res) => {
  const db = await getDb();
  let stripe;
  try { stripe = getStripe(); } catch {
    return res.status(503).json({ error: "Payment system is not configured." });
  }

  const user = await db.prepare("SELECT stripe_customer_id FROM users WHERE id = ?").get(req.user.id);
  if (!user?.stripe_customer_id) {
    return res.status(404).json({ error: "No Stripe customer found" });
  }

  try {
    // Verify the payment method belongs to this customer
    const pm = await stripe.paymentMethods.retrieve(req.params.pmId);
    if (pm.customer !== user.stripe_customer_id) {
      return res.status(403).json({ error: "This payment method does not belong to you" });
    }

    // Detach the payment method
    await stripe.paymentMethods.detach(req.params.pmId);
    res.json({ success: true, message: "Payment method removed" });
  } catch (err) {
    console.error("Payment method deletion error:", err);
    if (err.type === 'StripeInvalidRequestError') {
      return res.status(404).json({ error: "Payment method not found" });
    }
    res.status(500).json({ error: "Failed to remove payment method" });
  }
});

// ─── POST /api/payments/manual ───
// Create a checkout session for a manual payment to a caregiver (no session attached)
router.post("/manual", requireRole("family"), requirePaymentsEnabled, async (req, res) => {
  const db = await getDb();
  let stripe;
  try { stripe = getStripe(); } catch {
    return res.status(503).json({ error: "Payment system is not configured yet.", notConfigured: true });
  }

  const { caregiverId, amount, note } = req.body;
  if (!caregiverId || !amount) {
    return res.status(400).json({ error: "caregiverId and amount are required" });
  }

  if (amount <= 0) {
    return res.status(400).json({ error: "Amount must be greater than 0" });
  }

  try {
    // Get caregiver profile with Stripe account
    const caregiver = await db.prepare(
      "SELECT cp.*, u.first_name, u.last_name FROM caregiver_profiles cp JOIN users u ON cp.user_id = u.id WHERE cp.id = ?"
    ).get(caregiverId);

    if (!caregiver) {
      return res.status(404).json({ error: "Caregiver not found" });
    }

    if (!caregiver.stripe_account_id) {
      return res.status(400).json({ error: "Caregiver has not set up payment account yet" });
    }

    // Get family user info + Stripe customer ID
    const familyUser = await db.prepare("SELECT first_name, last_name, stripe_customer_id FROM users WHERE id = ?").get(req.user.id);
    const caregiverAmountCents = Math.round(amount * 100);

    // Gross up to cover Stripe processing fees (card rate: 2.9% + $0.30)
    // Formula: grossAmount = (caregiverAmount + 30) / (1 - 0.029), rounded up
    // This way: Stripe fee ≈ 2.9% * grossAmount + $0.30 ≈ the difference
    // Caregiver gets exactly what the family intended
    const grossAmountCents = Math.ceil((caregiverAmountCents + 30) / (1 - 0.029));
    const processingFeeCents = grossAmountCents - caregiverAmountCents;

    // Create checkout session — attach customer so Stripe shows their saved payment methods
    const checkoutParams = {
      mode: "payment",
      payment_method_types: ["card", "us_bank_account"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `Payment to ${caregiver.first_name} ${caregiver.last_name}`,
              description: note || "Direct payment",
            },
            unit_amount: caregiverAmountCents,
          },
          quantity: 1,
        },
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: "Processing fee",
              description: "Stripe payment processing — InPlace takes no platform fee",
            },
            unit_amount: processingFeeCents,
          },
          quantity: 1,
        },
      ],
      payment_intent_data: {
        application_fee_amount: processingFeeCents, // Covers Stripe fee, InPlace nets ~$0
        transfer_data: {
          destination: caregiver.stripe_account_id,
        },
      },
      success_url: `${BASE_URL}/#payment-success?type=manual`,
      cancel_url: `${BASE_URL}/#payment-cancel?type=manual`,
      metadata: {
        type: "manual_payment",
        caregiver_id: caregiverId,
        from_user_id: req.user.id,
        note: note || "",
        caregiver_amount_cents: String(caregiverAmountCents),
        processing_fee_cents: String(processingFeeCents),
      },
    };

    // Pin to family's Stripe customer so checkout shows their saved payment methods
    // (without this, Stripe Link matches by email/phone and may show unrelated accounts)
    if (familyUser?.stripe_customer_id) {
      checkoutParams.customer = familyUser.stripe_customer_id;
    }

    const checkoutSession = await stripe.checkout.sessions.create(checkoutParams);

    res.json({ checkoutUrl: checkoutSession.url, sessionId: checkoutSession.id });
  } catch (err) {
    console.error("Manual payment checkout error:", err);
    res.status(500).json({ error: "Failed to create checkout session" });
  }
});

router.getStripe = getStripe;
module.exports = router;
