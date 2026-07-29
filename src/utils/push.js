// ─── src/utils/push.js — compatibility adapter (v1.103.5, Sentry INPLACE-3) ───
// Twelve lazy call sites (routes/checkr.js ×8, routes/ipaiChat.js ×2,
// routes/photos.js, routes/admin/safety.js) require "../utils/push" with a
// legacy (db, userId, title, body, data) signature — but this module never
// existed. Every one of those pushes threw "Cannot find module '../utils/push'"
// straight into its catch block and silently dropped: Checkr admin alerts,
// iPAi safety alerts, visit-photo notifications, and admin support messages
// all sent no push. Sentry surfaced it the first time an admin support
// message fired after error monitoring went live.
//
// The real implementation is sendPushToUser(userId, payload, eventType) in
// src/routes/push.js. This adapter keeps the legacy call shape working from
// one place instead of touching twelve call sites. The db argument is
// accepted and ignored — the real sender opens its own handle.
async function sendPushToUser(db, userId, title, body, data) {
  const { sendPushToUser: realSend } = require("../routes/push");
  return realSend(userId, {
    title: title || "InPlace",
    body: body || "",
    ...(data ? { data } : {}),
  });
}

module.exports = { sendPushToUser };
