const express = require("express");
const { v4: uuid } = require("uuid");
const { getDb } = require("../models/database");
const { authenticate } = require("../middleware/auth");

const router = express.Router();

// ─── VAPID Key Management ───
// Keys are set during server startup via initializeVapidKeys()
// Priority: env vars → database → auto-generate
let _vapidPublicKey = null;
let _vapidPrivateKey = null;
let _vapidInitialized = false;

// Called by server.js on startup to set VAPID keys
function setVapidKeys(publicKey, privateKey) {
  _vapidPublicKey = publicKey;
  _vapidPrivateKey = privateKey;
  _vapidInitialized = true;
  console.log("  Push notifications: VAPID keys loaded ✓");
}

// Initialize VAPID keys: env → DB → generate new pair
// Called once during server startup
async function initializeVapidKeys() {
  // 1. Check environment variables first
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    setVapidKeys(process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
    console.log("  Push notifications: using VAPID keys from environment");
    return;
  }

  // 2. Check database for previously generated keys
  try {
    const db = await getDb();
    const pubRow = await db.prepare(
      "SELECT value FROM platform_settings WHERE key = 'vapid_public_key'"
    ).get();
    const privRow = await db.prepare(
      "SELECT value FROM platform_settings WHERE key = 'vapid_private_key'"
    ).get();

    if (pubRow && privRow) {
      setVapidKeys(pubRow.value, privRow.value);
      console.log("  Push notifications: using VAPID keys from database");
      return;
    }
  } catch (err) {
    console.warn("  Push: could not read VAPID keys from DB:", err.message);
  }

  // 3. Auto-generate new VAPID key pair
  try {
    const webpush = require("web-push");
    const keys = webpush.generateVAPIDKeys();
    console.log("  Push notifications: generated new VAPID key pair");
    console.log(`  VAPID_PUBLIC_KEY=${keys.publicKey}`);
    console.log(`  VAPID_PRIVATE_KEY=${keys.privateKey}`);
    console.log("  (Set these as environment variables for persistence across deploys)");

    // Save to database for persistence across restarts
    try {
      const db = await getDb();
      await db.prepare(
        "INSERT INTO platform_settings (key, value) VALUES ('vapid_public_key', ?) ON CONFLICT (key) DO UPDATE SET value = ?, updated_at = NOW()"
      ).run(keys.publicKey, keys.publicKey);
      await db.prepare(
        "INSERT INTO platform_settings (key, value) VALUES ('vapid_private_key', ?) ON CONFLICT (key) DO UPDATE SET value = ?, updated_at = NOW()"
      ).run(keys.privateKey, keys.privateKey);
      console.log("  Push notifications: VAPID keys saved to database");
    } catch (dbErr) {
      console.warn("  Push: could not save VAPID keys to DB:", dbErr.message);
    }

    setVapidKeys(keys.publicKey, keys.privateKey);
  } catch (err) {
    console.error("  ⚠️  Push notifications DISABLED — could not generate VAPID keys:", err.message);
  }
}

// ─── GET /api/push/vapid-key ───
// Return VAPID public key for client subscription (no auth required)
router.get("/vapid-key", (req, res) => {
  if (!_vapidPublicKey) {
    return res.status(503).json({ error: "Push notifications not configured" });
  }
  res.json({ publicKey: _vapidPublicKey });
});

// ─── GET /api/push/status ───
// Debug endpoint: check push notification readiness (auth required)
router.get("/status", authenticate, async (req, res) => {
  const db = await getDb();
  const rows = await db.prepare(
    "SELECT endpoint FROM push_subscriptions WHERE user_id = ?"
  ).all(req.user.id);

  // ─── v1.105.151 — WHICH devices, not how many ───
  //
  // Pete: "why don't i get push notifications when i don't get messages in app… i know the
  // other people get notifications, but I don't."
  //
  // He has three registered devices — two web and an android — and no iOS token at all, while
  // he tests on an iPhone. So every message push he was owed went out successfully, to a
  // laptop and to an Android build he isn't holding.
  //
  // The self-repair in checkPushHealth existed to catch exactly this and could never fire: it
  // asked whether `userSubscriptions === 0`, and his was 3. "Does the server know about ANY
  // device for me" is the wrong question; the one that decides whether a phone buzzes is
  // "does it know about THIS one". The count alone cannot answer that, so the platforms come
  // back too.
  const { deviceKind } = require("../utils/pushDevices");
  const platforms = [...new Set(rows.map((r) => deviceKind(r.endpoint)))];

  res.json({
    vapidConfigured: _vapidInitialized && !!_vapidPublicKey && !!_vapidPrivateKey,
    userSubscriptions: rows.length,
    platforms,
    ready: _vapidInitialized && !!_vapidPrivateKey && rows.length > 0,
  });
});

// ─── POST /api/push/subscribe ───
// Save push subscription for current user
router.post("/subscribe", authenticate, async (req, res) => {
  // v1.97.0 — NEVER register push during admin impersonation. The browser's
  // push endpoint belongs to the ADMIN's device; saving it under the
  // impersonated user leaks their notifications to the admin's browser
  // (July 13 trace: "Sara's web push" was actually Pete's Chrome).
  if (req.user.impersonatedBy) {
    return res.json({ success: true, skipped: "impersonation" });
  }

  const { subscription } = req.body;
  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: "Push subscription object required" });
  }

  const db = await getDb();

  // Reclaim: a push endpoint identifies exactly one browser profile — if it's
  // parked under another user (stale impersonation-era row, account switch on
  // a shared device), it moves to whoever the browser is logged in as now.
  await db.prepare(
    "DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id != ?"
  ).run(subscription.endpoint, req.user.id);

  // Race-proof upsert (unique index on user_id+endpoint since v1.97.0)
  await db.prepare(`
    INSERT INTO push_subscriptions (id, user_id, endpoint, subscription_json) VALUES (?, ?, ?, ?)
    ON CONFLICT (user_id, endpoint) DO UPDATE SET subscription_json = EXCLUDED.subscription_json, updated_at = NOW()
  `).run(uuid(), req.user.id, subscription.endpoint, JSON.stringify(subscription));

  console.log(`  Push: subscription saved for user ${req.user.id}`);
  res.json({ success: true });
});

// ─── POST /api/push/subscribe-native ───
// Save native push token (FCM/APNS) for current user
router.post("/subscribe-native", authenticate, async (req, res) => {
  // v1.97.0 — same impersonation guard as /subscribe (see comment there)
  if (req.user.impersonatedBy) {
    return res.json({ success: true, skipped: "impersonation" });
  }

  const { token, platform } = req.body;
  if (!token) {
    return res.status(400).json({ error: "Push token required" });
  }

  // Use a synthetic endpoint to distinguish native tokens from Web Push subscriptions
  // Format: native://platform/token (e.g. native://android/abc123...)
  const nativePlatform = platform || "unknown";
  const endpoint = `native://${nativePlatform}/${token}`;

  // Store as a subscription-like object so sendPushToUser can find it
  const subscriptionObj = {
    endpoint,
    type: "native",
    platform: nativePlatform,
    token,
  };

  const db = await getDb();

  // A device token identifies one physical device — reclaim from other users
  // (last login wins on a shared device), and drop this user's rotated tokens
  // for the same platform.
  await db.prepare(
    "DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id != ?"
  ).run(endpoint, req.user.id);
  await db.prepare(
    "DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint LIKE ? AND endpoint != ?"
  ).run(req.user.id, `native://${nativePlatform}/%`, endpoint);

  // Race-proof upsert — v1.96 double-inserted when the register and
  // token-refresh listeners both fired (Sara got duplicate iOS rows)
  await db.prepare(`
    INSERT INTO push_subscriptions (id, user_id, endpoint, subscription_json) VALUES (?, ?, ?, ?)
    ON CONFLICT (user_id, endpoint) DO UPDATE SET subscription_json = EXCLUDED.subscription_json, updated_at = NOW()
  `).run(uuid(), req.user.id, endpoint, JSON.stringify(subscriptionObj));

  console.log(`  Push: native ${nativePlatform} token saved for user ${req.user.id}`);
  res.json({ success: true });
});

// ─── DELETE /api/push/unsubscribe ───
// Remove push subscription for current user
router.delete("/unsubscribe", authenticate, async (req, res) => {
  const { endpoint } = req.body;
  if (!endpoint) {
    return res.status(400).json({ error: "Endpoint required" });
  }

  const db = await getDb();
  await db.prepare(
    "DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?"
  ).run(req.user.id, endpoint);

  res.json({ success: true });
});

// ─── POST /api/push/test ───
// Send a test push notification to the current user (for debugging)
router.post("/test", authenticate, async (req, res) => {
  if (!_vapidPublicKey || !_vapidPrivateKey) {
    return res.status(503).json({ error: "VAPID keys not configured" });
  }

  const db = await getDb();
  const subs = await db.prepare(
    "SELECT id FROM push_subscriptions WHERE user_id = ?"
  ).all(req.user.id);

  if (subs.length === 0) {
    return res.status(400).json({ error: "No push subscriptions found — enable notifications first" });
  }

  try {
    const result = await sendPushToUser(req.user.id, {
      title: "InPlace Test Notification",
      body: "Push notifications are working! 🎉",
      data: { type: "test" },
    });
    const sent = result ? result.sent : 0;
    const removed = result ? result.removed : 0;
    if (sent === 0 && removed > 0) {
      // All subscriptions were stale (VAPID key mismatch) — tell user to re-enable
      res.json({
        success: false,
        error: "Your notification subscriptions were outdated and have been cleared. Please disable and re-enable notifications to receive them.",
        sent: 0, removed,
      });
    } else if (sent === 0) {
      res.json({
        success: false,
        error: "No notifications were delivered. Try disabling and re-enabling notifications.",
        sent: 0,
      });
    } else {
      res.json({ success: true, sent, total: subs.length, removed });
    }
  } catch (err) {
    console.error("Push test error:", err.message); res.status(500).json({ error: "Failed to send test push" });
  }
});

// ─── Utility: Send push to admin users ───
// Fire-and-forget push to all admin accounts for a given event type
async function sendPushToAdmins(eventType, payload) {
  try {
    const db = await getDb();
    const admins = await db.prepare("SELECT id, notification_prefs FROM users WHERE is_admin = 1").all();
    for (const admin of admins) {
      const prefs = admin.notification_prefs ? JSON.parse(admin.notification_prefs) : {};
      if (prefs[`push_${eventType}`] === false) continue; // opt-out check (default on)
      sendPushToUser(admin.id, payload).catch(() => {});
    }
  } catch (err) {
    console.error("Admin push error:", err.message);
  }
}

// ─── Utility: Send email to admin users ───
// Fire-and-forget email to all admin accounts for a given event type
// v1.105.112 — admin events that default to email ON rather than OFF.
//
// Pete: "I haven't gotten a doc review notice on anything yet."
//
// He hadn't, and this is why. Admin email was opt-IN with a default of OFF
// (`prefs[...] !== true`), so unless he had explicitly set `email_identity_submitted` in his
// notification prefs — a screen he had no reason to visit — the only signal was a push, which
// is fire-and-forget and gone the moment it is missed.
//
// That is an acceptable default for "someone posted a job". It is not acceptable for the one
// class of event where a person is BLOCKED until he acts. Since v1.105.112 no caregiver can
// finish onboarding until Pete reviews their ID, so a missed notification is not noise — it
// is somebody sitting still. These few events are opt-OUT instead: he can still turn them
// off, but he has to mean it.
const EMAIL_ON_BY_DEFAULT = new Set(["identity_submitted"]);

async function sendEmailToAdmins(eventType, { subject, body }) {
  try {
    const { sendEmail, brandedHtml } = require("../utils/email");
    const db = await getDb();
    const admins = await db.prepare("SELECT id, email, notification_prefs FROM users WHERE is_admin = 1").all();
    for (const admin of admins) {
      const prefs = admin.notification_prefs ? JSON.parse(admin.notification_prefs) : {};
      const pref = prefs[`email_${eventType}`];
      const wanted = EMAIL_ON_BY_DEFAULT.has(eventType) ? pref !== false : pref === true;
      if (!wanted) continue;
      const html = brandedHtml({
        title: "InPlace Admin",
        greeting: subject,
        body: body,
        ctaUrl: "https://yourinplace.com",
        ctaText: "Open InPlace",
      });
      sendEmail({ to: admin.email, subject: `[InPlace] ${subject}`, html }).catch(() => {});
    }
  } catch (err) {
    console.error("Admin email error:", err.message);
  }
}

// ─── Utility: Notify admins (push + email) ───
// Sends both push and email based on per-event preferences
function notifyAdmins(eventType, { title, body, data }) {
  sendPushToAdmins(eventType, { title, body, data }).catch(() => {});
  sendEmailToAdmins(eventType, { subject: title, body }).catch(() => {});
}

// ─── Firebase Admin SDK (for native push via FCM) ───
// Lazy-loaded — only initializes if GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_SERVICE_ACCOUNT is set
let _firebaseApp = null;
let _firebaseInitAttempted = false;

function _getFirebaseMessaging() {
  if (_firebaseInitAttempted) return _firebaseApp;
  _firebaseInitAttempted = true;
  try {
    const admin = require("firebase-admin");
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.FIREBASE_SERVICE_ACCOUNT) {
      let credential;
      if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        // JSON string in env var (Railway-friendly)
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        credential = admin.credential.cert(serviceAccount);
      } else {
        // File path in GOOGLE_APPLICATION_CREDENTIALS
        credential = admin.credential.applicationDefault();
      }
      _firebaseApp = admin.initializeApp({ credential });
      console.log("  Push: Firebase Admin SDK initialized for native push ✓");
    } else {
      console.log("  Push: Firebase not configured — native push delivery disabled (set FIREBASE_SERVICE_ACCOUNT env var to enable)");
    }
  } catch (err) {
    console.warn("  Push: Firebase Admin SDK not available:", err.message);
  }
  return _firebaseApp;
}

// Send native push: iOS → direct APNs (raw APNs tokens, no Firebase needed);
// Android → Firebase FCM. The Capacitor iOS app registers a raw APNs device
// token, which FCM rejects — so iOS must go straight to Apple (v1.96.0).
async function _sendNativePush(subscriptionObj, notificationPayload) {
  if (subscriptionObj.platform === "ios") {
    const apns = require("../utils/apns");
    if (!apns.isConfigured()) return false; // inert until APNS_KEY/_KEY_ID/_TEAM_ID are set
    const parsed = JSON.parse(notificationPayload);
    await apns.sendApnsNotification(subscriptionObj.token, parsed); // throws {statusCode:410} on dead tokens
    return true;
  }

  const app = _getFirebaseMessaging();
  if (!app) return false;

  try {
    const admin = require("firebase-admin");
    const parsed = JSON.parse(notificationPayload);
    const message = {
      token: subscriptionObj.token,
      notification: {
        title: parsed.title || "InPlace",
        body: parsed.body || "",
      },
      data: parsed.data ? Object.fromEntries(
        Object.entries(parsed.data).map(([k, v]) => [k, String(v)])
      ) : {},
      android: {
        priority: "high", // wake device from doze mode
        notification: {
          icon: "ic_notification",
          color: "#1b6b5a",
          channelId: "inplace_default",
          ...(parsed.tag ? { tag: parsed.tag } : {}), // supersede previous notification with same tag
        },
        collapseKey: parsed.tag || undefined, // collapse queued messages with same key
      },
    };
    await admin.messaging().send(message);
    return true;
  } catch (err) {
    // Permanent token failures → mark for cleanup
    if (err.code === "messaging/registration-token-not-registered" ||
        err.code === "messaging/invalid-registration-token" ||
        err.code === "messaging/mismatched-credential") {
      throw { statusCode: 410, message: err.message };
    }
    // Transient failures → throw for retry
    throw err;
  }
}

// Retry helper: exponential backoff with jitter (max 3 attempts)
async function _sendWithRetry(fn, maxRetries = 2) {
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const code = err.statusCode || err.code;
      // Don't retry permanent failures
      if (code === 403 || code === 404 || code === 410 || code === 401) throw err;
      // Don't retry last attempt
      if (attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 4000) + Math.random() * 500;
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}

// Max consecutive failures before auto-removing a subscription
const MAX_FAIL_COUNT = 5;

// ─── Utility: Send push to a user ───
// Used internally by other routes (sessions, messages, etc.)
// ─── GET /api/push/attention — the badge number, and what makes it up ───
// v1.105.40. One canonical count (src/utils/attention.js) so the icon, the push payload and
// any future in-app dot can never disagree.
//
// v1.105.61 — `authenticate` was missing here, and ONLY here. push.js authenticates per route
// rather than with a blanket router.use, and this one was added in v1.105.40 without it. So
// `req.user` was undefined on every call, `req.user.id` threw a TypeError, and the old catch
// answered 200 {total: 0}. Which means: **the badge has never worked for anyone, ever.**
//
// Every /api/push/attention call since v1.105.40 returned zeros, and refreshAppBadge dutifully
// called clearAppBadge on them. The badge project built to fix Pete's stuck "78" was dead from
// the day it shipped, and it looked exactly like "you have nothing to attend to" — which is why
// six versions of badge work went by without anyone noticing the endpoint behind it never ran.
// syncBadgeToDevices never ran either, so the icon was corrected only by the res.on("finish")
// hook in middleware/auth.js — which then fought the next foreground refresh that cleared it.
//
// v1.105.60 turned the 200-with-zeros into a 500, which is the only reason this was findable at
// all: the very first staging request after that deploy failed loudly and Railway had the stack.
router.get("/attention", authenticate, async (req, res) => {
  try {
    const db = await getDb();
    const { attentionCountFor } = require("../utils/attention");
    const counts = await attentionCountFor(db, req.user.id);
    res.json(counts);
    // v1.105.42 — and correct the icon. The web layer calls this on launch and on every
    // return to the foreground, so this is the moment we know the app is open and can
    // push the true number to the phone. Answer first, then sync: the caller waits on
    // nothing. See syncBadgeToDevices.
    syncBadgeToDevices(db, req.user.id, counts.total).catch(() => {});
  } catch (err) {
    console.error("Attention count error:", err);
    // v1.105.60 — "a badge is a convenience, never fail the caller over it" was right about the
    // caller and wrong about the number. Answering 200 with zeros does not decline to report a
    // badge; it reports that there is nothing to attend to. AttentionCard renders that as
    // "you're all caught up" and refreshAppBadge CLEARS the icon — so an internal error actively
    // erased a correct badge that was flagging an overdue care task or a reimbursement waiting
    // on approval. Both callers already handle a non-OK response correctly and leave the
    // existing badge alone (utils.js: `if (!res?.ok) return`), which is what we want: on error,
    // change nothing rather than assert zero.
    res.status(500).json({ error: "Could not load your attention count." });
  }
});

// v1.105.44 — syncBadgeToDevices moved to utils/badgeSync.js. It is no longer tied to this
// endpoint: every authenticated request corrects the badge on `finish` (middleware/auth.js).
// Hanging the correction off ONE endpoint is what left Pete's icon stuck at 2 — tap a push,
// land in Messages, read it, and nothing ever asked the server for the new number.
const { syncBadgeToDevices } = require("../utils/badgeSync");
const { hasSent, appendSent } = require("../utils/notificationsSent");
const { captureException } = require("../utils/sentry");

// ─── GET /api/push/attention/items — the same number, itemised ───
// v1.105.129. Pete, 8/24: "if something needs me let's get it clear on what they're needed
// for and make it a one-click event to clear it out or open it up for more."
//
// Same function as the count endpoint above, one field wider: the rows the count is made of,
// each carrying the sentence to show and the ONE request that answers it. The card cannot
// disagree with the icon because there is only one query set behind both (utils/attention.js).
//
// Errors 500 rather than answering an empty list, for the reason written against the count
// endpoint: an empty list on this card does not decline to report, it reports "you're all
// caught up".
router.get("/attention/items", authenticate, async (req, res) => {
  try {
    const db = await getDb();
    const { attentionItemsFor } = require("../utils/attention");
    const payload = await attentionItemsFor(db, req.user.id);
    res.json(payload);
    syncBadgeToDevices(db, req.user.id, payload.total).catch(() => {});
  } catch (err) {
    console.error("Attention items error:", err);
    res.status(500).json({ error: "Could not load what needs you." });
  }
});

// Optional eventType param — if provided, checks user's notification_prefs before sending
async function sendPushToUser(userId, payload, eventType) {
  // NEVER send push notifications to demo users — prevents demo data from
  // leaking notifications to real devices that tested with demo accounts
  try {
    const db = await getDb();
    const targetUser = await db.prepare("SELECT is_demo, notification_prefs FROM users WHERE id = ?").get(userId);
    if (targetUser?.is_demo) {
      return { sent: 0, failed: 0, removed: 0, reason: "demo_user" }; // silently skip demo users
    }

    // Check user notification preferences if eventType is provided
    if (eventType && targetUser?.notification_prefs) {
      const prefs = JSON.parse(targetUser.notification_prefs);
      if (prefs[`push_${eventType}`] === false) return { sent: 0, failed: 0, removed: 0, reason: "opted_out" };
    }

    // ─── v1.105.185 — and never about something they may not open ───
    //
    // Deliberately BEFORE the in-app record, and deliberately unlike the notification-prefs
    // check above, which returns early for a different reason and which I have filed as a bug
    // for exactly that: "do not buzz my phone" and "never tell me this happened" are different
    // requests. A PERMISSION failure is not. If someone may not read the note, an in-app row
    // pointing at it is the same dead end as the push, just quieter — Julia: "I can't clear
    // notifications that I click on but can't access."
    try {
      const { mayBeNotified } = require("../utils/pushPermission");
      const verdict = await mayBeNotified(db, userId, payload && payload.data);
      if (!verdict.allowed) {
        return { sent: 0, failed: 0, removed: 0, reason: verdict.reason };
      }
    } catch { /* see mayBeNotified: this path fails open on purpose */ }

    // ─── v1.56.0 — Also create an in-app notification record ───
    try {
      await db.prepare(
        "INSERT INTO notifications (id, user_id, title, body, type, data) VALUES (?, ?, ?, ?, ?, ?)"
      ).run(
        uuid(),
        userId,
        payload.title || "InPlace",
        payload.body || "",
        eventType || payload.data?.type || "general",
        payload.data ? JSON.stringify(payload.data) : null
      );
    } catch (inAppErr) {
      // Non-blocking — in-app notification is a bonus, never block push delivery
      console.log("In-app notification insert failed (non-blocking):", inAppErr.message);
    }
  } catch (e) { /* proceed if prefs check fails */ }

  try {
    const db = await getDb();
    const subs = await db.prepare(
      "SELECT id, subscription_json, fail_count FROM push_subscriptions WHERE user_id = ?"
    ).all(userId);

    // v1.105.141 — this used to `return` into the void. For most notifications that is fine.
    // For a CALL it is the difference between "her phone is ringing" and "nothing happened
    // anywhere", and the caller was shown "Ringing…" either way. Say which it was.
    if (subs.length === 0) return { sent: 0, failed: 0, removed: 0, reason: "no_devices" }; // no subscriptions for this user

    // v1.105.40 — every push carries the recipient's CURRENT attention count, because a
    // push always means something changed. `badge` here is the monochrome ICON for the web
    // notification (an existing, unrelated field); `badgeCount` is the number for the app
    // icon. Named apart on purpose — collapsing them is an easy and confusing mistake.
    let badgeCount = 0;
    try {
      const { attentionCountFor } = require("../utils/attention");
      badgeCount = (await attentionCountFor(db, userId)).total;
    } catch { /* a wrong badge must never block a real notification */ }

    const notificationPayload = JSON.stringify({
      title: payload.title || "InPlace",
      body: payload.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-maskable-96.png",
      badgeCount,
      tag: payload.tag || undefined, // same tag → OS replaces previous notification
      data: payload.data || {},
    });

    // Set up web-push only if we have VAPID keys (for Web Push subscriptions)
    let webpush = null;
    if (_vapidPublicKey && _vapidPrivateKey) {
      webpush = require("web-push");
      webpush.setVapidDetails(
        "mailto:noreply@yourinplace.com",
        _vapidPublicKey,
        _vapidPrivateKey
      );
    }

    let sent = 0;
    let removed = 0;
    let failed = 0;
    for (const sub of subs) {
      try {
        const subObj = JSON.parse(sub.subscription_json);

        // Native delivery not configured yet (no APNs key / Firebase credential) —
        // skip silently WITHOUT counting a failure, so tokens survive until setup.
        if (subObj.type === "native") {
          const configured = subObj.platform === "ios"
            ? require("../utils/apns").isConfigured()
            : !!_getFirebaseMessaging();
          if (!configured) continue;
        }

        await _sendWithRetry(async () => {
          if (subObj.type === "native") {
            // Native token — iOS via direct APNs, Android via Firebase FCM
            const delivered = await _sendNativePush(subObj, notificationPayload);
            if (!delivered) throw new Error("Native push not configured");
          } else if (webpush) {
            // Standard Web Push subscription — set TTL for reliability
            // v1.105.50 — web-push supports options.timeout and it was unset, so the underlying
            // https.request had no socket timeout. Inside a retry loop inside a poller, one
            // dead push service could wedge an entire sweep.
            await webpush.sendNotification(subObj, notificationPayload, { TTL: 86400, timeout: 10000 }); // 24h TTL
          } else {
            throw new Error("Web push not configured");
          }
        });

        sent++;
        // Reset fail_count on success. v1.105.42 — also record the badge this push just
        // put on the icon, so the silent corrector (syncBadgeToDevices) knows the device
        // is already showing the right number and stays quiet.
        if (sub.fail_count > 0) {
          await db.prepare("UPDATE push_subscriptions SET fail_count = 0, last_success_at = NOW(), last_badge = ? WHERE id = ?").run(badgeCount, sub.id);
        } else {
          await db.prepare("UPDATE push_subscriptions SET last_success_at = NOW(), last_badge = ? WHERE id = ?").run(badgeCount, sub.id);
        }
      } catch (err) {
        const code = err.statusCode || err.code;
        if (code === 403 || code === 404 || code === 410 || code === 401) {
          // Subscription permanently invalid — remove immediately
          await db.prepare("DELETE FROM push_subscriptions WHERE id = ?").run(sub.id);
          removed++;
          console.log(`  Push: removed dead subscription (${code}) for user ${userId}`);
        } else {
          // Transient failure — increment fail_count
          const newFailCount = (sub.fail_count || 0) + 1;
          if (newFailCount >= MAX_FAIL_COUNT) {
            // Too many consecutive failures — give up on this subscription
            await db.prepare("DELETE FROM push_subscriptions WHERE id = ?").run(sub.id);
            removed++;
            console.log(`  Push: removed subscription after ${MAX_FAIL_COUNT} consecutive failures for user ${userId}`);
          } else {
            await db.prepare("UPDATE push_subscriptions SET fail_count = ?, last_failure_at = NOW() WHERE id = ?").run(newFailCount, sub.id);
            console.warn(`  Push: delivery failed (attempt ${newFailCount}/${MAX_FAIL_COUNT}, user ${userId}):`, code || err.message);
          }
          failed++;
        }
      }
    }

    if (sent > 0 || removed > 0 || failed > 0) {
      console.log(`  Push: sent ${sent}/${subs.length} to user ${userId}${removed ? `, ${removed} removed` : ""}${failed ? `, ${failed} failed` : ""}`);
    }
    return { sent, failed, removed };
  } catch (err) {
    console.error("Push notification error:", err.message);
    return { sent: 0, failed: 0, removed: 0, error: err.message };
  }
}

// ─── Arrival SMS reminders for care recipients ───
// Sends friendly countdown texts: "[Caregiver] is arriving in X! 😊"
// Called from the notification poller in server.js with the session row + interval in minutes
async function sendArrivalSms(session, minutesBefore) {
  try {
    const db = await getDb();

    // Get caregiver's first name
    let caregiverFirstName = "Your caregiver";
    if (session.caregiver_user_id) {
      const cg = await db.prepare("SELECT first_name FROM users WHERE id = ?").get(session.caregiver_user_id);
      if (cg?.first_name) caregiverFirstName = cg.first_name;
    }

    // Human-friendly time label
    let timeLabel;
    if (minutesBefore >= 120) timeLabel = "2 hours";
    else if (minutesBefore >= 60) timeLabel = "1 hour";
    else timeLabel = "30 minutes";

    const recipName = session.recipient_first_name || "there";
    const message = `Hi ${recipName}, ${caregiverFirstName} is arriving in ${timeLabel}! 😊`;

    const { sendSms } = require("../utils/sms");
    const result = await sendSms(session.sms_phone, message);

    // Track that we sent this tier so it doesn't re-fire
    // v1.105.126 — was `|| ' ' || ?`, which joined with spaces while sendSessionReminders
    // wrote a JSON array and read it back with JSON.parse. This line is what poisoned the
    // column for every reminder that followed it on the same session.
    const tag = `arrival_sms_${minutesBefore}`;
    const sentRow = await db.prepare("SELECT notifications_sent FROM care_sessions WHERE id = ?").get(session.id);
    await db.prepare("UPDATE care_sessions SET notifications_sent = ? WHERE id = ?")
      .run(appendSent(sentRow && sentRow.notifications_sent, tag), session.id);

    console.log(`  [arrival-sms] ${result.success ? '✅' : '❌'} ${recipName}: "${caregiverFirstName} arriving in ${timeLabel}" (session ${session.id.slice(0,8)})`);
    return result;
  } catch (err) {
    console.error("  [arrival-sms] Error:", err.message);
    return { success: false, error: err.message };
  }
}

// ─── Session reminder notifications ───
// Sends pre-check-in or pre-check-out push notifications for a session
// reminderType: 'pre_check_in' or 'pre_check_out'
async function sendSessionReminders(sessionId, reminderType) {
  try {
    const db = await getDb();
    const session = await db.prepare(`
      SELECT cs.*, cp.user_id AS caregiver_user_id,
        cr.first_name AS recipient_first_name, cr.last_name AS recipient_last_name,
        cr.linked_user_id AS care_for_user_id,
        cr.notification_channel, cr.sms_phone,
        cr.location_address, cr.location_city, cr.location_state
      FROM care_sessions cs
      LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
      LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
      WHERE cs.id = ?
    `).get(sessionId);

    if (!session) return;

    const caregiver = await db.prepare("SELECT first_name, last_name FROM users WHERE id = ?").get(session.caregiver_user_id);
    const caregiverName = caregiver ? `${caregiver.first_name} ${caregiver.last_name}` : "Your caregiver";
    const recipientName = `${session.recipient_first_name || ""} ${session.recipient_last_name || ""}`.trim() || "your loved one";
    const locationParts = [session.location_address, session.location_city, session.location_state].filter(Boolean);
    const locationStr = locationParts.join(", ");
    const mapsUrl = locationStr ? `https://maps.google.com/?q=${encodeURIComponent(locationStr)}` : null;

    // Get ALL care team members for this care recipient (not just the session creator)
    const careTeamMembers = await db.prepare(`
      SELECT DISTINCT ctm.user_id FROM care_team_members ctm
      JOIN care_teams ct ON ctm.care_team_id = ct.id
      WHERE ct.care_recipient_id = ?
    `).all(session.care_recipient_id);
    // Fallback to session creator if no care team exists
    const teamUserIds = careTeamMembers.length > 0
      ? careTeamMembers.map(m => m.user_id)
      : (session.family_user_id ? [session.family_user_id] : []);

    // Notification tags — same tag replaces the previous notification instead of stacking
    // This creates a lifecycle: arriving → in progress → wrapping up → complete
    const cgTag = `session-${sessionId.slice(0,8)}-cg`;       // caregiver's notification slot
    const famTag = `session-${sessionId.slice(0,8)}-family`;   // family/care team slot
    const recipTag = `session-${sessionId.slice(0,8)}-recip`;  // care recipient slot

    if (reminderType === "pre_check_in") {
      // 1. To caregiver: push + SMS "Get ready to check in"
      if (session.caregiver_user_id) {
        const addrSnippet = locationStr ? `\n📍 ${locationStr}` : "";
        await sendPushToUser(session.caregiver_user_id, {
          title: "Get Ready to Check In",
          body: `Time to check in with ${recipientName} (session at ${session.scheduled_time})${addrSnippet}`,
          tag: cgTag,
          data: { type: "check_in_reminder", sessionId, page: "schedule", mapsUrl },
        }, "check_in_reminder");

        // Also SMS the caregiver (push may not be enabled)
        const cgUser = await db.prepare("SELECT phone FROM users WHERE id = ?").get(session.caregiver_user_id);
        if (cgUser?.phone) {
          const { sendSms } = require("../utils/sms");
          const timeStr = session.scheduled_time ? session.scheduled_time.replace(/^0/, "") : "soon";
          const smsAddr = mapsUrl ? `\nDirections: ${mapsUrl}` : "";
          await sendSms(cgUser.phone, `InPlace: Heads up — your session with ${recipientName} starts at ${timeStr}. Don't forget to check in!${smsAddr}`);
        }
      }

      // 2. To entire care team: "Caregiver arriving soon"
      for (const userId of teamUserIds) {
        if (userId === session.caregiver_user_id) continue; // don't double-notify caregiver
        await sendPushToUser(userId, {
          title: "Caregiver Arriving Soon",
          body: `${caregiverName} is about to check in with ${recipientName}${locationStr ? ` at ${locationStr}` : ""}`,
          tag: famTag,
          data: { type: "caregiver_arriving", sessionId, page: "dashboard", mapsUrl },
        }, "caregiver_arriving");
      }

      // 3. To care recipient — push and/or SMS based on notification_channel
      const channel = session.notification_channel || "push";
      const recipFirstName = session.recipient_first_name || "there";

      // Push notification (if channel allows and linked user exists)
      if (["push", "both"].includes(channel) && session.care_for_user_id && !teamUserIds.includes(session.care_for_user_id)) {
        await sendPushToUser(session.care_for_user_id, {
          title: "Your Caregiver is Almost Here!",
          body: `${caregiverName} will be at your door soon!`,
          tag: recipTag,
          data: { type: "caregiver_arriving_recipient", sessionId },
        }, "caregiver_arriving_recipient");
      }

      // SMS (if channel allows and phone exists)
      if (["sms", "both"].includes(channel) && session.sms_phone) {
        const { sendSms } = require("../utils/sms");
        const timeStr = session.scheduled_time ? session.scheduled_time.replace(/^0/, "") : "soon";
        await sendSms(session.sms_phone, `Hi ${recipFirstName}, ${caregiverName} will be arriving at ${timeStr} today.`);
      }

      console.log(`  Session reminders (pre_check_in) sent for session ${sessionId} → ${teamUserIds.length} team members, channel: ${channel}`);
    } else if (reminderType === "pre_check_out") {
      // 1. To caregiver: push + SMS "Time to wrap up"
      if (session.caregiver_user_id) {
        await sendPushToUser(session.caregiver_user_id, {
          title: "Time to Wrap Up",
          body: `Get ready to check out with ${recipientName}`,
          tag: cgTag,
          data: { type: "check_out_reminder", sessionId, page: "schedule" },
        }, "check_out_reminder");

        // Also SMS the caregiver
        const cgUserCo = await db.prepare("SELECT phone FROM users WHERE id = ?").get(session.caregiver_user_id);
        if (cgUserCo?.phone) {
          const { sendSms } = require("../utils/sms");
          await sendSms(cgUserCo.phone, `InPlace: Time to wrap up your session with ${recipientName}. Don't forget to check out!`);
        }
      }

      // 2. To entire care team: "Session wrapping up"
      for (const userId of teamUserIds) {
        if (userId === session.caregiver_user_id) continue;
        await sendPushToUser(userId, {
          title: "Session Wrapping Up",
          body: `${caregiverName} is nearly done at ${recipientName}'s`,
          tag: famTag,
          data: { type: "check_out_imminent", sessionId, page: "dashboard" },
        }, "check_out_imminent");
      }

      // 3. To care recipient — push and/or SMS based on notification_channel
      const coChannel = session.notification_channel || "push";
      const coRecipName = session.recipient_first_name || "there";

      if (["push", "both"].includes(coChannel) && session.care_for_user_id && !teamUserIds.includes(session.care_for_user_id)) {
        await sendPushToUser(session.care_for_user_id, {
          title: "Your Caregiver is About to Leave",
          body: `${caregiverName} will be heading out soon.`,
          tag: recipTag,
          data: { type: "caregiver_leaving_recipient", sessionId },
        }, "caregiver_leaving_recipient");
      }

      if (["sms", "both"].includes(coChannel) && session.sms_phone) {
        const { sendSms } = require("../utils/sms");
        const endTime = session.scheduled_time && session.duration_hours
          ? (() => {
              const [h, m] = session.scheduled_time.split(":").map(Number);
              const endH = h + Math.floor(session.duration_hours);
              const endM = m + Math.round((session.duration_hours % 1) * 60);
              const finalH = endH + Math.floor(endM / 60);
              const finalM = endM % 60;
              return `${finalH > 12 ? finalH - 12 : finalH}:${String(finalM).padStart(2, "0")} ${finalH >= 12 ? "PM" : "AM"}`;
            })()
          : "soon";
        await sendSms(session.sms_phone, `Hi ${coRecipName}, ${caregiverName} will be heading out around ${endTime}.`);
      }

      console.log(`  Session reminders (pre_check_out) sent for session ${sessionId} → ${teamUserIds.length} team members, channel: ${coChannel}`);
    } else if (reminderType === "overdue_check_in") {
      // ─── Caregiver is late — hasn't checked in after session start + grace period ───

      // 1. To caregiver: urgent push + SMS
      if (session.caregiver_user_id) {
        await sendPushToUser(session.caregiver_user_id, {
          title: "Check In Now!",
          body: `Your session with ${recipientName} has started — please check in ASAP`,
          tag: cgTag,
          data: { type: "overdue_check_in", sessionId, page: "schedule" },
        }, "overdue_check_in");

        // SMS the caregiver too (push may not be enabled)
        const cgUser = await db.prepare("SELECT phone FROM users WHERE id = ?").get(session.caregiver_user_id);
        if (cgUser?.phone) {
          const { sendSms } = require("../utils/sms");
          await sendSms(cgUser.phone, `InPlace: Your session with ${recipientName} has started. Please check in now!`);
        }
      }

      // 2. To entire care team: caregiver hasn't checked in
      for (const userId of teamUserIds) {
        if (userId === session.caregiver_user_id) continue;
        await sendPushToUser(userId, {
          title: "Caregiver Late",
          body: `${caregiverName} hasn't checked in yet for ${recipientName}'s session`,
          tag: famTag,
          data: { type: "overdue_check_in_family", sessionId, page: "dashboard" },
        }, "overdue_check_in_family");
      }

      // 3. SMS the family/session creator if they have a phone
      if (session.family_user_id) {
        const familyUser = await db.prepare("SELECT phone FROM users WHERE id = ?").get(session.family_user_id);
        if (familyUser?.phone) {
          const { sendSms } = require("../utils/sms");
          await sendSms(familyUser.phone, `InPlace: ${caregiverName} hasn't checked in yet for ${recipientName}'s session. You may want to follow up.`);
        }
      }

      console.log(`  Session reminders (overdue_check_in) sent for session ${sessionId} → caregiver + ${teamUserIds.length} team members`);
    } else if (reminderType === "overdue_check_out") {
      // ─── Session is past scheduled end but caregiver hasn't checked out ───

      // 1. To caregiver: urgent push
      if (session.caregiver_user_id) {
        await sendPushToUser(session.caregiver_user_id, {
          title: "Don't Forget to Check Out",
          body: `Your session with ${recipientName} has passed its scheduled end time — please check out when you're done`,
          tag: cgTag,
          data: { type: "overdue_check_out", sessionId, page: "schedule" },
        }, "overdue_check_out");

        // SMS the caregiver too
        const cgUser = await db.prepare("SELECT phone FROM users WHERE id = ?").get(session.caregiver_user_id);
        if (cgUser?.phone) {
          const { sendSms } = require("../utils/sms");
          await sendSms(cgUser.phone, `InPlace: Don't forget to check out from your session with ${recipientName}. Open the app to complete checkout.`);
        }
      }

      // 2. Notify family that session is running over
      for (const userId of teamUserIds) {
        if (userId === session.caregiver_user_id) continue;
        await sendPushToUser(userId, {
          title: "Session Running Over",
          body: `${caregiverName}'s session with ${recipientName} has passed its scheduled end time`,
          tag: famTag,
          data: { type: "overdue_check_out_family", sessionId, page: "dashboard" },
        }, "overdue_check_out_family");
      }

      console.log(`  Session reminders (overdue_check_out) sent for session ${sessionId} → caregiver + ${teamUserIds.length} team members`);
    }

  } catch (err) {
    console.error(`Session reminder error (${reminderType}, session ${sessionId}):`, err.message);
    captureException(err, { where: "push: sendSessionReminders", sessionId, reminderType });
  }

  // ─── Mark this reminder as sent — OUTSIDE the try above, deliberately ───
  //
  // v1.105.126. This line used to live at the end of that try block, and it used
  // JSON.parse. Both were wrong, and together they cost Pete 28 notifications for one
  // 90-minute visit.
  //
  // The parse threw on any row a non-JSON writer had touched (sendArrivalSms joins with
  // spaces, accountability.js joins with commas). The throw landed in the catch above —
  // after the pushes had gone out, before they were recorded — so the next poll, one
  // minute later, sent them all again. Twenty-three times, until Julia checked out.
  //
  // So: parse defensively, and record OUTSIDE the send. A failure to notify must never
  // become a failure to remember that we tried. The worst case here is one missed
  // reminder; the worst case the other way round is a phone that buzzes every minute.
  try {
    const db = await getDb();
    const row = await db.prepare("SELECT notifications_sent FROM care_sessions WHERE id = ?").get(sessionId);
    if (row && !hasSent(row.notifications_sent, reminderType)) {
      await db.prepare("UPDATE care_sessions SET notifications_sent = ? WHERE id = ?")
        .run(appendSent(row.notifications_sent, reminderType), sessionId);
    }
  } catch (markErr) {
    // If we cannot record it, say so loudly — this is the state that repeats forever.
    console.error(`[push] COULD NOT RECORD ${reminderType} for ${sessionId} — it may repeat:`, markErr.message);
    captureException(markErr, { where: "push: reminder dedupe write failed", sessionId, reminderType });
  }
}

// ─── v1.56.0 — In-app notifications API ───

// GET /api/push/notifications — recent notifications for current user
// See utils/notificationGroups.js for why messages group and nothing else does.
const { groupNotifications } = require("../utils/notificationGroups");

router.get("/notifications", authenticate, async (req, res) => {
  try {
    const db = await getDb();
    const limit = parseInt(req.query.limit) || 30;
    // Read wider than we return, because grouping only shrinks the list. Bounded so a busy
    // account cannot turn one dashboard load into an unbounded scan.
    const scan = Math.min(limit * 8, 200);
    const rows = await db.prepare(
      "SELECT id, title, body, type, data, read, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?"
    ).all(req.user.id, scan);
    const unreadCount = await db.prepare(
      "SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND read = 0"
    ).get(req.user.id);
    res.json({
      notifications: groupNotifications(rows, limit),
      unreadCount: parseInt(unreadCount?.count || 0),
    });
  } catch (err) {
    console.error("Notifications fetch error:", err.message);
    res.json({ notifications: [], unreadCount: 0 });
  }
});

// POST /api/push/notifications/mark-read — mark notifications as read
router.post("/notifications/mark-read", authenticate, async (req, res) => {
  try {
    const db = await getDb();
    const { ids } = req.body; // optional array of notification IDs; if empty, mark all read
    if (ids && ids.length > 0) {
      const placeholders = ids.map(() => "?").join(",");
      await db.prepare(
        `UPDATE notifications SET read = 1 WHERE user_id = ? AND id IN (${placeholders})`
      ).run(req.user.id, ...ids);
    } else {
      await db.prepare(
        "UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0"
      ).run(req.user.id);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("Mark-read error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.sendPushToUser = sendPushToUser;
module.exports.sendPushToAdmins = sendPushToAdmins;
module.exports.sendEmailToAdmins = sendEmailToAdmins;
module.exports.notifyAdmins = notifyAdmins;
module.exports.initializeVapidKeys = initializeVapidKeys;
module.exports.setVapidKeys = setVapidKeys;
module.exports.sendSessionReminders = sendSessionReminders;
module.exports.sendArrivalSms = sendArrivalSms;
