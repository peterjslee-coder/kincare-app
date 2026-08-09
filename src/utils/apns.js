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
// v1.105.50 — nothing here was time-bounded before; see _post.
const APNS_TIMEOUT_MS = 10000;

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
function _post(deviceToken, body, extraHeaders) {
  return new Promise((resolve, reject) => {
    const host = (process.env.APNS_ENVIRONMENT === "sandbox")
      ? "https://api.sandbox.push.apple.com"
      : "https://api.push.apple.com";

    // v1.105.50 — a deadline on the whole exchange.
    //
    // There was no connect, session or stream timeout here. If TLS established and Apple
    // never sent a response, this promise NEVER settled and client.close() (only called on
    // `end`/`error`) never ran — a leaked http2 session and socket, per attempt. It is
    // reached from every poller and, since v1.105.44, from badgeSync on authenticated
    // requests, so the leak was steady. Combined with the old poller lock, one hung Apple
    // connection could stop a sweeper permanently.
    let settled = false;
    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { client.close(); } catch { /* already gone */ }
      fn(arg);
    };
    const client = http2.connect(host);
    const timer = setTimeout(() => {
      try { client.destroy(); } catch { /* already gone */ }
      finish(reject, new Error("APNs timeout"));
    }, APNS_TIMEOUT_MS);
    client.on("error", (err) => finish(reject, err));

    const headers = {
      ":method": "POST",
      ":path": `/3/device/${deviceToken}`,
      "authorization": `bearer ${_providerToken()}`,
      "apns-topic": BUNDLE_ID,
      "apns-expiration": String(Math.floor(Date.now() / 1000) + 86400), // 24h, matches web push TTL
      "content-type": "application/json",
      ...extraHeaders,
    };

    const req = client.request(headers);
    let status = 0;
    let respBody = "";
    req.setEncoding("utf8");
    req.on("response", (h) => { status = h[":status"]; });
    req.on("data", (chunk) => { respBody += chunk; });
    req.on("end", () => {
      if (status === 200) return finish(resolve, { success: true });
      let reason = "";
      try { reason = JSON.parse(respBody).reason || ""; } catch {}
      // Permanently-dead tokens → 410 so the caller prunes the subscription
      if (status === 410 || reason === "BadDeviceToken" || reason === "Unregistered" || reason === "DeviceTokenNotForTopic") {
        return finish(reject, { statusCode: 410, message: `APNs: ${reason || status}` });
      }
      finish(reject, new Error(`APNs ${status}: ${reason || respBody || "unknown error"}`));
    });
    req.on("error", (err) => finish(reject, err));
    req.end(body);
  });
}

function sendApnsNotification(deviceToken, payload) {
  const body = JSON.stringify({
    aps: {
      alert: { title: payload.title || "InPlace", body: payload.body || "" },
      sound: "default",
      // v1.105.40 — the app-icon badge. iOS SETS the icon to this number, it does not add
      // to it, so the server sending the current total is exactly right: the badge is
      // corrected on every push, including downward. 0 clears it.
      ...(Number.isFinite(payload.badgeCount) ? { badge: payload.badgeCount } : {}),
      ...(payload.tag ? { "thread-id": payload.tag } : {}),
    },
    // Custom keys ride at the top level; the Capacitor plugin surfaces them as notification.data
    ...(payload.data || {}),
  });
  const extra = { "apns-push-type": "alert", "apns-priority": "10" };
  if (payload.tag) extra["apns-collapse-id"] = String(payload.tag).slice(0, 64);
  return _post(deviceToken, body, extra);
}

// ─── Silent badge correction (v1.105.42) ───
//
// Pete, 8/6, with a screenshot of a red 78 on the icon: "I don't know how to clear any of
// them and I don't know what they are."
//
// Two bugs made that number, and both are fixed in utils/attention.js. But a corrected
// count does not by itself correct the ICON: iOS only redraws the badge when a push
// carries a new one, so a stale number sits there until the next notification happens to
// arrive. The proper fix — the app setting its own badge to 0 on open — needs
// @capacitor/badge and a TestFlight build, which is not something the server can do today.
//
// This is the half that ships without one. A badge-only push: an `aps` dictionary
// containing nothing but `badge`. With no alert, no sound and no body, iOS displays
// nothing at all — it just redraws the icon.
//
// ⚠️ v1.105.43 — this was FIRST written as a background push (`content-available: 1`,
// push-type background, priority 5) and it silently did nothing. Pete's badge sat at 78
// through the whole of v1.105.42. Background notifications require the app to declare
// UIBackgroundModes → remote-notification in Info.plist, and InPlace does not (only
// aps-environment is set, in App.entitlements). APNs accepts the request and returns 200;
// iOS then drops it on arrival. A 200 from Apple means "queued", never "shown" — there is
// no delivery receipt to check, which is exactly why this needed a real device to catch.
//
// A badge-only ALERT push has no such requirement: push-type alert covers anything that
// changes what the user sees — alert, sound, OR badge — and priority 10 is the documented
// choice for those. Nothing is displayed because there is nothing to display.
function sendApnsBadge(deviceToken, count) {
  const body = JSON.stringify({
    aps: { badge: Math.max(0, Number(count) || 0) },
  });
  return _post(deviceToken, body, { "apns-push-type": "alert", "apns-priority": "10" });
}

module.exports = { isConfigured, sendApnsNotification, sendApnsBadge, _providerToken, _resetTokenCache };
