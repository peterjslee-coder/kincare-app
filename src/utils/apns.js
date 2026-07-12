// ─── Direct APNs delivery (v1.96.0) ───
// Sends push notifications straight to Apple's APNs over HTTP/2 using a
// .p8 Auth Key — no Firebase needed for iOS. The Capacitor app registers a
// raw APNs device token (see AppDelegate.swift), which FCM would reject;
// this module speaks to Apple directly instead.
//
// Env (all three required, otherwise disabled):
//   APNS_KEY       contents of the .p8 AuthKey file (BEGIN/END PRIVATE KEY lines included).
//                  Railway single-line paste with literal "\n" sequences is handled.
//   APNS_KEY_ID    10-char Key ID from developer.apple.com → Keys
//   APNS_TEAM_ID   10-char Team ID from the Membership page
// Optional:
//   APNS_BUNDLE_ID    defaults to com.yourinplace.app
//   APNS_ENVIRONMENT  'production' (default) or 'sandbox' (Xcode debug builds)
//
// TestFlight and App Store builds use the PRODUCTION APNs environment.

const crypto = require("crypto");
const http2 = require("http2");

const BUNDLE_ID = process.env.APNS_BUNDLE_ID || "com.yourinplace.app";

function isConfigured() {
  return !!(process.env.APNS_KEY && process.env.APNS_KEY_ID && process.env.APNS_TEAM_ID);
}

function _privateKey() {
  // Railway single-line values often carry literal backslash-n sequences
  return process.env.APNS_KEY.replace(/\\n/g, "\n");
}

// ─── Provider token (JWT, ES256) — cached ~50 min (Apple allows 20–60) ───
let _cachedJwt = null;
let _cachedJwtAt = 0;

function _b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function _providerToken() {
  const now = Math.floor(Date.now() / 1000);
  if (_cachedJwt && now - _cachedJwtAt < 50 * 60) return _cachedJwt;

  const header = _b64url(JSON.stringify({ alg: "ES256", kid: process.env.APNS_KEY_ID }));
  const payload = _b64url(JSON.stringify({ iss: process.env.APNS_TEAM_ID, iat: now }));
  const signingInput = `${header}.${payload}`;
  // ES256 needs the raw (r||s) signature, not DER — ieee-p1363 gives us that
  const signature = crypto.sign("sha256", Buffer.from(signingInput), {
    key: _privateKey(),
    dsaEncoding: "ieee-p1363",
  });
  _cachedJwt = `${signingInput}.${_b64url(signature)}`;
  _cachedJwtAt = now;
  return _cachedJwt;
}

// For tests
function _resetTokenCache() { _cachedJwt = null; _cachedJwtAt = 0; }

// ─── Send one notification ───
// payload: { title, body, tag, data } (same shape push.js builds for web push)
// Throws { statusCode: 410 } for permanently-dead tokens so push.js prunes them;
// other failures throw normal errors (push.js retries transient ones).
function sendApnsNotification(deviceToken, payload) {
  return new Promise((resolve, reject) => {
    const host = (process.env.APNS_ENVIRONMENT === "sandbox")
      ? "https://api.sandbox.push.apple.com"
      : "https://api.push.apple.com";

    const body = JSON.stringify({
      aps: {
        alert: { title: payload.title || "InPlace", body: payload.body || "" },
        sound: "default",
        ...(payload.tag ? { "thread-id": payload.tag } : {}),
      },
      // Custom keys ride at the top level; the Capacitor plugin surfaces them as notification.data
      ...(payload.data || {}),
    });

    const client = http2.connect(host);
    client.on("error", (err) => { client.close(); reject(err); });

    const headers = {
      ":method": "POST",
      ":path": `/3/device/${deviceToken}`,
      "authorization": `bearer ${_providerToken()}`,
      "apns-topic": BUNDLE_ID,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "apns-expiration": String(Math.floor(Date.now() / 1000) + 86400), // 24h, matches web push TTL
      "content-type": "application/json",
    };
    if (payload.tag) headers["apns-collapse-id"] = String(payload.tag).slice(0, 64);

    const req = client.request(headers);
    let status = 0;
    let respBody = "";
    req.setEncoding("utf8");
    req.on("response", (h) => { status = h[":status"]; });
    req.on("data", (chunk) => { respBody += chunk; });
    req.on("end", () => {
      client.close();
      if (status === 200) return resolve({ success: true });
      let reason = "";
      try { reason = JSON.parse(respBody).reason || ""; } catch {}
      // Permanently-dead tokens → 410 so the caller prunes the subscription
      if (status === 410 || reason === "BadDeviceToken" || reason === "Unregistered" || reason === "DeviceTokenNotForTopic") {
        return reject({ statusCode: 410, message: `APNs: ${reason || status}` });
      }
      reject(new Error(`APNs ${status}: ${reason || respBody || "unknown error"}`));
    });
    req.on("error", (err) => { client.close(); reject(err); });
    req.end(body);
  });
}

module.exports = { isConfigured, sendApnsNotification, _providerToken, _resetTokenCache };
