// ─── src/utils/env.js — deployment-shape detection (v1.105.3) ───
//
// WHY THIS EXISTS
// --------------
// `NODE_ENV` is NOT set on the Railway prod service. Verified 2026-07-30 by
// reading the kincare-app service variables: the name isn't there at all.
// Everything gated on `process.env.NODE_ENV === "production"` had therefore been
// silently running its DEVELOPMENT path in production since the day it shipped:
//
//   * middleware/auth.js — `secure: isProduction` on auth_token, refresh_token
//     and csrf_token, so the session cookies shipped WITHOUT the Secure flag.
//   * routes/oauth.js — same for the oauth_state cookie.
//   * server.js — ALLOWED_ORIGINS (used by BOTH express cors() and Socket.io)
//     fell back to the localhost allowlist on production.
//   * utils/sentry.js — every prod event was tagged `environment: development`,
//     which is the only reason we ever noticed.
//
// Nothing broke, because the PWA and the current native build are same-origin
// (capacitor.config.ts points `server.url` at https://yourinplace.com), and
// same-origin requests never consult CORS. That's exactly what made it invisible.
//
// The fix is deliberately NOT "remember to set NODE_ENV". A variable the platform
// doesn't set by default is a variable that silently goes missing again the next
// time the service is recreated. Instead we derive the deployment shape from
// `APP_URL`, which IS set on Railway and which the app already trusts as the
// source of truth for WebAuthn RP_ID and ORIGIN (see routes/passkeys.js:18).
//
// Explicit env vars still win, so there's always an escape hatch.

const DEFAULT_APP_URL = "https://yourinplace.com";

const TRUTHY = /^(1|true|yes|on)$/i;

/**
 * Pure, testable derivation. Takes an env-like object so tests don't have to
 * mutate process.env.
 */
function computeEnv(env = process.env) {
  const rawAppUrl = String(env.APP_URL || "").trim().replace(/\/+$/, "");
  const appUrl = rawAppUrl || DEFAULT_APP_URL;

  let hostname;
  let protocol;
  try {
    const u = new URL(appUrl);
    hostname = u.hostname;
    protocol = u.protocol;
  } catch {
    // A malformed APP_URL must not silently downgrade security — fall back to
    // the production default rather than to "development".
    hostname = new URL(DEFAULT_APP_URL).hostname;
    protocol = "https:";
  }

  const isHttps = protocol === "https:";

  // Cookies get Secure when we're served over TLS. Order: explicit COOKIE_SECURE
  // override → legacy NODE_ENV (still honoured if someone sets it) → APP_URL.
  const cookiesSecure =
    env.COOKIE_SECURE != null
      ? TRUTHY.test(String(env.COOKIE_SECURE))
      : env.NODE_ENV === "production" || isHttps;

  // Distinguish prod from staging so Sentry stops merging them (and stops
  // reporting production traffic as "development").
  const environment =
    env.SENTRY_ENVIRONMENT ||
    (hostname === "yourinplace.com"
      ? "production"
      : /staging/i.test(hostname)
        ? "staging"
        : "development");

  // Origins allowed to make CREDENTIALED cross-origin requests.
  //
  // Both express cors() and Socket.io read this. Note it only matters for
  // cross-origin callers — today there are none, which is why the wrong list
  // went unnoticed. Keep it tight: every entry here can send the user's cookies.
  //
  // ⚠️ APP STORE / BUNDLED-ASSET MIGRATION: once the native app loads local
  // assets instead of `server.url`, its WebView origin becomes
  // `capacitor://localhost` and every API call turns cross-origin. Add
  // "capacitor://localhost" (and the Android equivalent) THEN — deliberately not
  // pre-added, because a bare "http://localhost" entry would let anything
  // running on a user's machine make authenticated requests to prod.
  const allowedOrigins = [appUrl];
  // www.<apex> only makes sense for a two-label apex domain, not for
  // *.up.railway.app or localhost.
  if (hostname.split(".").length === 2) {
    allowedOrigins.push(appUrl.replace("://", "://www."));
  }
  if (!isHttps) {
    allowedOrigins.push(
      "http://localhost:3001",
      "http://localhost:3000",
      "http://127.0.0.1:3001",
    );
  }

  return { appUrl, hostname, isHttps, cookiesSecure, environment, allowedOrigins };
}

module.exports = { computeEnv, DEFAULT_APP_URL, ...computeEnv() };
