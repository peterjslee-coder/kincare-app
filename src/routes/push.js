const express = require("express");
const { v4: uuid } = require("uuid");
const { getDb } = require("../models/database");
const { authenticate } = require("../middleware/auth");

const router = express.Router();

// VAPID public key — frontend needs this to subscribe
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "BAWbskb8EJhZ6Ue7pShGrgbQUMXQ1TnoJ2zvbVNknuztcNgw0tHgmrXfXiQeXUgtRPGOr9KtFfOrAawxvihL7HA";

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

// ─── Utility: Send push to a user ───
// Used internally by other routes (sessions, messages, etc.)
async function sendPushToUser(userId, payload) {
  // Only attempt if web-push is configured
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!privateKey || !VAPID_PUBLIC_KEY) return;

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
