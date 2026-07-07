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
      environment: process.env.NODE_ENV || "development",
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

module.exports = { initSentry, setupSentryErrorHandler, captureException };
