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

// ─── POST /api/push/subscribe-native ───
// Save native push token (FCM/APNS) for current user
router.post("/subscribe-native", authenticate, async (req, res) => {
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
  const existing = await db.prepare(
    "SELECT id FROM push_subscriptions WHERE user_id = ? AND endpoint = ?"
  ).get(req.user.id, endpoint);

  if (existing) {
    await db.prepare(
      "UPDATE push_subscriptions SET subscription_json = ?, updated_at = NOW() WHERE id = ?"
    ).run(JSON.stringify(subscriptionObj), existing.id);
  } else {
    // Also clean up any old native tokens for this user+platform (device may have rotated tokens)
    await db.prepare(
      "DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint LIKE ?"
    ).run(req.user.id, `native://${nativePlatform}/%`);

    await db.prepare(
      "INSERT INTO push_subscriptions (id, user_id, endpoint, subscription_json) VALUES (?, ?, ?, ?)"
    ).run(uuid(), req.user.id, endpoint, JSON.stringify(subscriptionObj));
  }

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

// Send native push via FCM
async function _sendNativePush(subscriptionObj, notificationPayload) {
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
        notification: {
          icon: "ic_launcher",
          color: "#1b6b5a",
        },
      },
    };
    await admin.messaging().send(message);
    return true;
  } catch (err) {
    if (err.code === "messaging/registration-token-not-registered" ||
        err.code === "messaging/invalid-registration-token") {
      throw { statusCode: 410, message: err.message }; // token expired — trigger cleanup
    }
    throw err;
  }
}

// ─── Utility: Send push to a user ───
// Used internally by other routes (sessions, messages, etc.)
// Optional eventType param — if provided, checks user's notification_prefs before sending
async function sendPushToUser(userId, payload, eventType) {
  // NEVER send push notifications to demo users — prevents demo data from
  // leaking notifications to real devices that tested with demo accounts
  try {
    const db = await getDb();
    const targetUser = await db.prepare("SELECT is_demo, notification_prefs FROM users WHERE id = ?").get(userId);
    if (targetUser?.is_demo) {
      return; // silently skip demo users
    }

    // Check user notification preferences if eventType is provided
    if (eventType && targetUser?.notification_prefs) {
      const prefs = JSON.parse(targetUser.notification_prefs);
      if (prefs[`push_${eventType}`] === false) return; // user opted out
    }
  } catch (e) { /* proceed if prefs check fails */ }

  try {
    const db = await getDb();
    const subs = await db.prepare(
      "SELECT id, subscription_json FROM push_subscriptions WHERE user_id = ?"
    ).all(userId);

    if (subs.length === 0) return; // no subscriptions for this user

    const notificationPayload = JSON.stringify({
      title: payload.title || "InPlace",
      body: payload.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-maskable-96.png",
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
    for (const sub of subs) {
      try {
        const subObj = JSON.parse(sub.subscription_json);

        if (subObj.type === "native") {
          // Native FCM/APNS token — send via Firebase Admin SDK
          const delivered = await _sendNativePush(subObj, notificationPayload);
          if (delivered) sent++;
        } else if (webpush) {
          // Standard Web Push subscription
          await webpush.sendNotification(subObj, notificationPayload);
          sent++;
        }
      } catch (err) {
        const code = err.statusCode || err.code;
        if (code === 403 || code === 404 || code === 410) {
          // Subscription expired or invalid — clean up
          await db.prepare("DELETE FROM push_subscriptions WHERE id = ?").run(sub.id);
          removed++;
          console.log(`  Push: removed stale subscription (${code}) for user ${userId}`);
        } else {
          console.error(`Push delivery error (user ${userId}):`, err.statusCode || err.code, err.message);
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
        cr.notification_channel, cr.sms_phone
      FROM care_sessions cs
      LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
      LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
      WHERE cs.id = ?
    `).get(sessionId);

    if (!session) return;

    const caregiver = await db.prepare("SELECT first_name, last_name FROM users WHERE id = ?").get(session.caregiver_user_id);
    const caregiverName = caregiver ? `${caregiver.first_name} ${caregiver.last_name}` : "Your caregiver";
    const recipientName = `${session.recipient_first_name || ""} ${session.recipient_last_name || ""}`.trim() || "your loved one";

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

    if (reminderType === "pre_check_in") {
      // 1. To caregiver: push + SMS "Get ready to check in"
      if (session.caregiver_user_id) {
        await sendPushToUser(session.caregiver_user_id, {
          title: "Get Ready to Check In",
          body: `Time to check in with ${recipientName} (session at ${session.scheduled_time})`,
          data: { type: "check_in_reminder", sessionId, page: "schedule" },
        }, "check_in_reminder");

        // Also SMS the caregiver (push may not be enabled)
        const cgUser = await db.prepare("SELECT phone FROM users WHERE id = ?").get(session.caregiver_user_id);
        if (cgUser?.phone) {
          const { sendSms } = require("../utils/sms");
          const timeStr = session.scheduled_time ? session.scheduled_time.replace(/^0/, "") : "soon";
          await sendSms(cgUser.phone, `InPlace: Heads up — your session with ${recipientName} starts at ${timeStr}. Don't forget to check in!`);
        }
      }

      // 2. To entire care team: "Caregiver arriving soon"
      for (const userId of teamUserIds) {
        if (userId === session.caregiver_user_id) continue; // don't double-notify caregiver
        await sendPushToUser(userId, {
          title: "Caregiver Arriving Soon",
          body: `${caregiverName} is about to check in with ${recipientName}`,
          data: { type: "caregiver_arriving", sessionId, page: "dashboard" },
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
          data: { type: "overdue_check_out_family", sessionId, page: "dashboard" },
        }, "overdue_check_out_family");
      }

      console.log(`  Session reminders (overdue_check_out) sent for session ${sessionId} → caregiver + ${teamUserIds.length} team members`);
    }

    // Mark this reminder as sent on the session (prevents duplicates)
    const existing = session.notifications_sent ? JSON.parse(session.notifications_sent) : [];
    if (!existing.includes(reminderType)) {
      existing.push(reminderType);
      await db.prepare("UPDATE care_sessions SET notifications_sent = ? WHERE id = ?")
        .run(JSON.stringify(existing), sessionId);
    }
  } catch (err) {
    console.error(`Session reminder error (${reminderType}, session ${sessionId}):`, err.message);
  }
}

module.exports = router;
module.exports.sendPushToUser = sendPushToUser;
module.exports.sendPushToAdmins = sendPushToAdmins;
module.exports.sendEmailToAdmins = sendEmailToAdmins;
module.exports.notifyAdmins = notifyAdmins;
module.exports.initializeVapidKeys = initializeVapidKeys;
module.exports.setVapidKeys = setVapidKeys;
module.exports.sendSessionReminders = sendSessionReminders;
