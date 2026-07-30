// ─── Sentry error monitoring (Batch 5, v1.63.0) ───
// No-ops entirely unless SENTRY_DSN is set (Railway env var — Pete's action).
// PHI safety: request bodies, headers, cookies, and user identity are stripped
// from every event before it leaves the server. Only the error, stack trace,
// URL path, and method are sent.

let Sentry = null;

function initSentry() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    console.log("Sentry: SENTRY_DSN not set — error monitoring disabled");
    return null;
  }
  try {
    Sentry = require("@sentry/node");
    Sentry.init({
      dsn,
      // v1.105.3 — was `process.env.NODE_ENV || "development"`, so every PRODUCTION
      // event arrived tagged `development` (which is how we caught the whole class
      // of NODE_ENV bugs). Now derived from APP_URL, and it tells prod from staging
      // instead of merging them. See utils/env.js.
      environment: require("./env").environment,
      sendDefaultPii: false,
      tracesSampleRate: 0, // errors only, no performance tracing
      beforeSend(event) {
        // PHI/PII scrub — belt and suspenders on top of sendDefaultPii:false
        if (event.request) {
          delete event.request.data;
          delete event.request.cookies;
          delete event.request.headers;
          delete event.request.query_string;
        }
        delete event.user;
        return event;
      },
    });
    console.log("✅ Sentry error monitoring enabled");
  } catch (err) {
    console.error("Sentry init failed — continuing without monitoring:", err.message);
    Sentry = null;
  }
  return Sentry;
}

// Attach Sentry's Express error handler (must run after all routes are registered).
function setupSentryErrorHandler(app) {
  if (Sentry && typeof Sentry.setupExpressErrorHandler === "function") {
    Sentry.setupExpressErrorHandler(app);
  }
}

// Safe capture from anywhere in the codebase; silently no-ops when disabled.
function captureException(err, extra) {
  try {
    if (Sentry) Sentry.captureException(err, extra ? { extra } : undefined);
  } catch (_) { /* never let monitoring break the app */ }
}

// v1.104.1 — pseudonymous attribution. Tag the current request's events with
// the authenticated user's UUID + role so support can identify the affected
// ACCOUNT (look the UUID up in the admin panel). PHI posture is unchanged:
// beforeSend still strips event.user, bodies, headers, and cookies — the bare
// UUID is only meaningful inside our own database.
// v1.105.2 — `impersonatedBy` is the admin's UUID when this request is running under
// an admin "Test Mode" token. Without it, impersonated traffic is indistinguishable
// from the real user's own traffic, and "whose account failed?" gets answered wrong.
function tagRequestUser(userId, role, impersonatedBy) {
  try {
    if (!Sentry) return;
    const scope = typeof Sentry.getIsolationScope === "function"
      ? Sentry.getIsolationScope()
      : Sentry.getCurrentScope();
    if (userId) scope.setTag("user_id", userId);
    if (role) scope.setTag("user_role", role);
    if (impersonatedBy) {
      scope.setTag("impersonated", "yes");
      scope.setTag("impersonated_by", impersonatedBy);
    }
  } catch (_) { /* never let monitoring break the app */ }
}

module.exports = { initSentry, setupSentryErrorHandler, captureException, tagRequestUser };
