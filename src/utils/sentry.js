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
      // ─── v1.105.24 — don't page us for other people's port scans ───
      //
      // INPLACE-6 was `URIError: Failed to decode param '/%c0'` — GET /%c0 from a cloud
      // host. %c0 is an invalid UTF-8 lead byte and the front half of the classic %c0%af
      // overlong-encoding path-traversal probe. Express's decode_param calls
      // decodeURIComponent, which throws, and Express answers 400. That is the CORRECT
      // outcome: the request was malformed, the app rejected it, nothing broke. The
      // stacktrace contains zero first-party frames — every one is express or node.
      //
      // Reporting it is worse than useless. A scanner walks thousands of malformed paths,
      // so this is an unbounded source of identical alerts, and an alert channel that cries
      // wolf is one nobody reads when something real happens. Filtered at the SDK, not by
      // resolving it in the UI, because resolving only silences the paths seen so far.
      ignoreErrors: [
        // Express decode_param on a malformed percent-escape. Always a 400, never a bug.
        /Failed to decode param/,
        // Same class, thrown by decodeURIComponent directly elsewhere in the stack.
        /^URIError: URI malformed$/,
      ],
      beforeSend(event) {
        // PHI/PII scrub — belt and suspenders on top of sendDefaultPii:false
        if (event.request) {
          delete event.request.data;
          delete event.request.cookies;
          delete event.request.headers;
          delete event.request.query_string;
        }
        delete event.user;

        // ignoreErrors matches on the message; this catches the same thing by TYPE, for
        // the case where the message wording changes across Express versions. Belt and
        // braces, same as the PHI scrub above.
        const ex = event.exception?.values?.[0];
        if (ex?.type === "URIError" && /decode|malformed|URI/i.test(ex.value || "")) return null;

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
