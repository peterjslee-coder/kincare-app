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
  const subCount = await db.prepare(
    "SELECT COUNT(*) as count FROM push_subscriptions WHERE user_id = ?"
  ).get(req.user.id);

  res.json({
    vapidConfigured: _vapidInitialized && !!_vapidPublicKey && !!_vapidPrivateKey,
    userSubscriptions: parseInt(subCount.count),
    ready: _vapidInitialized && !!_vapidPrivateKey && parseInt(subCount.count) > 0,
  });
});

// ─── POST /api/push/subscribe ───
// Save push subscription for current user
router.post("/subscribe", authenticate, async (req, res) => {
  const { subscription } = req.body;
  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: "Push subscription object required" });
  }

  const db = await getDb();
  const existing = await db.prepare(
    "SELECT id FROM push_subscriptions WHERE user_id = ? AND endpoint = ?"
  ).get(req.user.id, subscription.endpoint);

  if (existing) {
    // Update existing subscription
    await db.prepare(
      "UPDATE push_subscriptions SET subscription_json = ?, updated_at = NOW() WHERE id = ?"
    ).run(JSON.stringify(subscription), existing.id);
  } else {
    await db.prepare(
      "INSERT INTO push_subscriptions (id, user_id, endpoint, subscription_json) VALUES (?, ?, ?, ?)"
    ).run(uuid(), req.user.id, subscription.endpoint, JSON.stringify(subscription));
  }

  console.log(`  Push: subscription saved for user ${req.user.id}`);
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
    res.status(500).json({ error: "Failed to send test push: " + err.message });
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
async function sendEmailToAdmins(eventType, { subject, body }) {
  try {
    const { sendEmail, brandedHtml } = require("../utils/email");
    const db = await getDb();
    const admins = await db.prepare("SELECT id, email, notification_prefs FROM users WHERE is_admin = 1").all();
    for (const admin of admins) {
      const prefs = admin.notification_prefs ? JSON.parse(admin.notification_prefs) : {};
      if (prefs[`email_${eventType}`] !== true) continue; // email is opt-IN (default off)
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

// ─── Utility: Send push to a user ───
// Used internally by other routes (sessions, messages, etc.)
// Optional eventType param — if provided, checks user's notification_prefs before sending
async function sendPushToUser(userId, payload, eventType) {
  // Only attempt if VAPID keys are configured
  if (!_vapidPublicKey || !_vapidPrivateKey) {
    console.warn("Push: skipping — VAPID keys not initialized (run initializeVapidKeys on startup)");
    return;
  }

  // Check user notification preferences if eventType is provided
  if (eventType) {
    try {
      const db = await getDb();
      const user = await db.prepare("SELECT notification_prefs FROM users WHERE id = ?").get(userId);
      if (user && user.notification_prefs) {
        const prefs = JSON.parse(user.notification_prefs);
        if (prefs[`push_${eventType}`] === false) return; // user opted out
      }
    } catch (e) { /* proceed if prefs check fails */ }
  }

  try {
    const webpush = require("web-push");
    webpush.setVapidDetails(
      "mailto:noreply@yourinplace.com",
      _vapidPublicKey,
      _vapidPrivateKey
    );

    const db = await getDb();
    const subs = await db.prepare(
      "SELECT id, subscription_json FROM push_subscriptions WHERE user_id = ?"
    ).all(userId);

    if (subs.length === 0) return; // no subscriptions for this user

    const notificationPayload = JSON.stringify({
      title: payload.title || "InPlace",
      body: payload.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: payload.data || {},
    });

    let sent = 0;
    let removed = 0;
    for (const sub of subs) {
      try {
        await webpush.sendNotification(JSON.parse(sub.subscription_json), notificationPayload);
        sent++;
      } catch (err) {
        if (err.statusCode === 403 || err.statusCode === 404 || err.statusCode === 410) {
          // 403 = VAPID key mismatch (subscription created with different key)
          // 404/410 = subscription expired or invalid
          await db.prepare("DELETE FROM push_subscriptions WHERE id = ?").run(sub.id);
          removed++;
          console.log(`  Push: removed stale subscription (${err.statusCode}) for user ${userId}`);
        } else {
          console.error(`Push delivery error (user ${userId}):`, err.statusCode, err.message);
        }
      }
    }

    if (sent > 0 || removed > 0) {
      console.log(`  Push: sent ${sent}/${subs.length} to user ${userId}${removed ? ` (${removed} stale removed)` : ""}`);
    }
    return { sent, failed: subs.length - sent, removed };
  } catch (err) {
    console.error("Push notification error:", err.message);
    return { sent: 0, failed: 0, removed: 0, error: err.message };
  }
}

module.exports = router;
module.exports.sendPushToUser = sendPushToUser;
module.exports.sendPushToAdmins = sendPushToAdmins;
module.exports.sendEmailToAdmins = sendEmailToAdmins;
module.exports.notifyAdmins = notifyAdmins;
module.exports.initializeVapidKeys = initializeVapidKeys;
module.exports.setVapidKeys = setVapidKeys;
