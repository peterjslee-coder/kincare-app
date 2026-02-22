const express = require("express");
const { v4: uuid } = require("uuid");
const { getDb } = require("../models/database");
const { authenticate } = require("../middleware/auth");

const router = express.Router();

// VAPID public key — frontend needs this to subscribe
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "BPuicFkWJ1W4c4HyisIhpmuEoD20hoedAoFYlWFGiWPZ2PTVeD479AJL_l03e7BEmGEqLnb1K1r60S2URj2JciU";

// ─── GET /api/push/vapid-key ───
// Return VAPID public key for client subscription (no auth required)
router.get("/vapid-key", (req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY });
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
  // Only attempt if web-push is configured
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!privateKey || !VAPID_PUBLIC_KEY) return;

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
      VAPID_PUBLIC_KEY,
      privateKey
    );

    const db = await getDb();
    const subs = await db.prepare(
      "SELECT id, subscription_json FROM push_subscriptions WHERE user_id = ?"
    ).all(userId);

    const notificationPayload = JSON.stringify({
      title: payload.title || "InPlace",
      body: payload.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: payload.data || {},
    });

    for (const sub of subs) {
      try {
        await webpush.sendNotification(JSON.parse(sub.subscription_json), notificationPayload);
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          // Subscription expired or invalid — remove it
          await db.prepare("DELETE FROM push_subscriptions WHERE id = ?").run(sub.id);
        }
      }
    }
  } catch (err) {
    console.error("Push notification error:", err.message);
  }
}

module.exports = router;
module.exports.sendPushToUser = sendPushToUser;
module.exports.sendPushToAdmins = sendPushToAdmins;
module.exports.sendEmailToAdmins = sendEmailToAdmins;
module.exports.notifyAdmins = notifyAdmins;
