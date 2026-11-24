// ─── Devices that can ring like a phone (calls-native, 1.3) ───
//
// A device lands here only when the 1.3 app says it can ring natively:
//   ios      — `token` is the PushKit VoIP token (NOT the APNs token: a different token, bound
//              to the `.voip` topic). `push_token` is the same phone's ordinary APNs token.
//   android  — `token` is the FCM token, which IS the same token the ordinary push uses;
//              what makes it a call device is that the 1.3 app handles a data-only ring.
//
// Kept apart from push_subscriptions on purpose. Six places read that table (sendPushToUser,
// badgeSync, /status, /test, the admin reachability view, account deletion…) and every one of
// them would have had to learn to skip a VoIP token. A separate table means the 1.2 store build
// — and every one of those readers — cannot tell this exists.
//
// `push_token` is how call_invite tells the ordinary push NOT to also put a "Call from…" banner
// on a phone that is already ringing full-screen: native://<platform>/<push_token> is skipped.

const { v4: uuid } = require("uuid");
const { getDb } = require("../models/database");

const PLATFORMS = new Set(["ios", "android"]);
const TOKEN_RE = /^[A-Za-z0-9:_\-.]{16,4096}$/;

async function registerCallDevice(userId, { platform, token, pushToken }) {
  if (!PLATFORMS.has(platform)) throw Object.assign(new Error("platform must be ios or android"), { status: 400 });
  if (typeof token !== "string" || !TOKEN_RE.test(token)) throw Object.assign(new Error("token required"), { status: 400 });
  const push = (typeof pushToken === "string" && TOKEN_RE.test(pushToken)) ? pushToken : null;
  const db = await getDb();
  // One physical device: last login wins (same rule as subscribe-native), and a rotated token
  // replaces this user's old one for the same push token.
  await db.prepare("DELETE FROM call_devices WHERE platform = ? AND token = ? AND user_id != ?").run(platform, token, userId);
  if (push) {
    await db.prepare("DELETE FROM call_devices WHERE user_id = ? AND platform = ? AND push_token = ? AND token != ?")
      .run(userId, platform, push, token);
  }
  await db.prepare(`
    INSERT INTO call_devices (id, user_id, platform, token, push_token) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (platform, token) DO UPDATE SET user_id = EXCLUDED.user_id, push_token = EXCLUDED.push_token, updated_at = NOW()
  `).run(uuid(), userId, platform, token, push);
}

async function removeCallDevice(userId, { platform, token }) {
  const db = await getDb();
  await db.prepare("DELETE FROM call_devices WHERE user_id = ? AND platform = ? AND token = ?").run(userId, platform, token);
}

async function callDevicesFor(userId) {
  const db = await getDb();
  return db.prepare("SELECT id, platform, token, push_token FROM call_devices WHERE user_id = ?").all(userId);
}

// What the native side needs to ring and to answer. Strings only (FCM data must be strings).
function ringPayload(call, callToken) {
  return {
    type: "call_ring",
    roomName: call.roomName,
    callUuid: call.callUuid,
    callType: call.callType,
    callerId: String(call.callerId),
    callerName: call.callerName,
    callToken,
    expiresAt: String(call.startedAt + require("./callRegistry").RING_MS),
  };
}

async function _ringOne(dev, data) {
  if (dev.platform === "ios") {
    const apns = require("./apns");
    if (!apns.isConfigured()) return false;
    await apns.sendApnsVoip(dev.token, data); // throws {statusCode:410} on a dead token
    return true;
  }
  const { _getFirebaseMessaging } = require("../routes/push");
  if (!_getFirebaseMessaging()) return false;
  const admin = require("firebase-admin");
  try {
    // Data-only and high priority: the 1.3 app's messaging service draws the full-screen call
    // itself. A `notification` block here would be shown by the system INSTEAD of the call.
    await admin.messaging().send({
      token: dev.token,
      data,
      android: { priority: "high", ttl: require("./callRegistry").RING_MS },
    });
    return true;
  } catch (err) {
    if (err.code === "messaging/registration-token-not-registered" || err.code === "messaging/invalid-registration-token") {
      throw { statusCode: 410, message: err.message };
    }
    throw err;
  }
}

// Rings every call device the person has. Returns how many rang and which ordinary-push
// endpoints to leave alone because their phone is already ringing.
async function ringCallDevices(targetUserId, call, callToken) {
  const db0 = await getDb();
  // Same rule as sendPushToUser: a demo account never reaches a real device.
  const target = await db0.prepare("SELECT is_demo FROM users WHERE id = ?").get(targetUserId);
  if (!target || target.is_demo) return { rang: 0, skipEndpoints: new Set() };
  const devices = await callDevicesFor(targetUserId);
  const data = ringPayload(call, callToken);
  let rang = 0;
  const skipEndpoints = new Set();
  const db = await getDb();
  for (const dev of devices) {
    try {
      if (await _ringOne(dev, data)) {
        rang++;
        const pushToken = dev.platform === "android" ? dev.token : dev.push_token;
        if (pushToken) skipEndpoints.add(`native://${dev.platform}/${pushToken}`);
      }
    } catch (err) {
      if (err && err.statusCode === 410) {
        await db.prepare("DELETE FROM call_devices WHERE id = ?").run(dev.id);
      } else {
        console.error(`call ring failed (${dev.platform}):`, err && err.message);
        try { require("./sentry").captureException(err, { where: "callDevices: ring", platform: dev.platform }); } catch {}
      }
    }
  }
  return { rang, skipEndpoints };
}

module.exports = { registerCallDevice, removeCallDevice, callDevicesFor, ringCallDevices, ringPayload };
