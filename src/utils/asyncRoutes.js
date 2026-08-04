// ─── Async route safety net (v1.105.37) ───
//
// Express 4 does not catch a rejected promise from an `async (req, res) => {}` handler. It
// does not 500, it does not log, it does not reach the error handler at the bottom of
// server.js — the request simply HANGS. The client sits on a spinner until its own timeout,
// and nothing appears in Sentry, so the failure is invisible from our side as well as
// unhelpful from theirs.
//
// The Aug 4 audit counted **87 handlers** with at least one `await` outside a try/catch,
// across payments, sessions, messages, photos, careRecipients, caregivers, activity, notes
// and more. `photos.js` (all five handlers) and `messages.js` (eight) are the worst, and
// they are also the two screens people use most.
//
// Wrapping 87 handlers by hand would fix 87 handlers and none of the ones written next
// month. This wraps the router methods once instead, so a rejection becomes `next(err)` and
// lands in the existing handler at server.js — which already answers 500 JSON and reports to
// Sentry. Individual try/catch blocks still work exactly as before and are still worth
// writing where a handler wants a specific message; this is the floor, not a replacement.
//
// What is deliberately NOT wrapped:
//   • 4-argument functions — Express identifies error handlers by arity, and wrapping one
//     would silently demote it to ordinary middleware.
//   • Routers and anything else carrying a `.stack` or `.handle` — mounting relies on those
//     properties, and a wrapper would lose them.
//   • Anything already wrapped, so calling install() twice is harmless.

const HANDLER_METHODS = [
  "get", "post", "put", "patch", "delete", "head", "options", "all", "use",
];

function isMountable(fn) {
  // An express Router (or an app) is a function with a routing stack hanging off it.
  return typeof fn === "function" && (Array.isArray(fn.stack) || typeof fn.handle === "function");
}

function wrapHandler(fn) {
  if (typeof fn !== "function") return fn;      // paths, arrays, option objects
  if (fn.length >= 4) return fn;                // (err, req, res, next) — Express reads arity
  if (fn.__asyncSafe) return fn;                // idempotent
  if (isMountable(fn)) return fn;               // sub-router / mounted app

  const wrapped = function (req, res, next) {
    let out;
    try {
      out = fn.apply(this, arguments);
    } catch (err) {
      // A synchronous throw before the first await. Express handles this itself for sync
      // handlers, but not once the function is async — so route it explicitly.
      if (typeof next === "function") return next(err);
      throw err;
    }
    if (out && typeof out.then === "function" && typeof next === "function") {
      // Only forward if nobody has answered yet. A handler that already sent a response and
      // then threw would otherwise trigger "Cannot set headers after they are sent", which
      // buries the real error under a second one.
      out.catch((err) => (res && res.headersSent ? undefined : next(err)));
    }
    return out;
  };
  wrapped.__asyncSafe = true;
  // Keep the original name — it shows up in stack traces and in Express's own debug output.
  Object.defineProperty(wrapped, "name", { value: fn.name || "asyncSafeHandler", configurable: true });
  return wrapped;
}

function patchProto(proto, label, installed) {
  for (const method of HANDLER_METHODS) {
    const original = proto[method];
    if (typeof original !== "function" || original.__asyncSafePatched) continue;
    const patched = function (...args) {
      return original.apply(this, args.map(wrapHandler));
    };
    patched.__asyncSafePatched = true;
    proto[method] = patched;
    installed.push(`${label}.${method}`);
  }
}

/**
 * Install the net. Call ONCE, before any route module is require()d — route files call
 * router.get(...) at require time, so anything loaded earlier keeps the unwrapped handlers.
 */
function installAsyncRouteSafety(express) {
  const installed = [];
  const routerProto = Object.getPrototypeOf(express.Router());
  patchProto(routerProto, "router", installed);
  if (express.application) patchProto(express.application, "app", installed);
  return installed;
}

module.exports = { installAsyncRouteSafety, wrapHandler, isMountable };
