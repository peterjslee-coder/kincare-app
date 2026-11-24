// ─── The last line of defence: nothing dies without saying so (v1.105.130) ───
//
// v1.105.127 filed this as "there is no uncaughtException/unhandledRejection reporter at
// all, so the next unhandled throw from anywhere else is equally silent." Checked before
// building on it, and it is half true — the useful half:
//
//   • Sentry's node SDK registers OnUncaughtException and OnUnhandledRejection among its
//     DEFAULT integrations, which is exactly how INPLACE-C reached us with
//     mechanism=auto.node.onuncaughtexception. Those throws are NOT invisible.
//   • But only when SENTRY_DSN is set. It is a Railway env var, so any environment missing
//     it — a local run, a new service, a rotated key — reports nowhere at all.
//   • And nothing writes the one line you actually want in the Railway log at 2am: that
//     the process is going down, and how long it had been up. On Saturday that fact
//     ("app_start_time 16:47:57Z, crash 17:43:51Z") existed only inside Sentry.
//
// So: log loudly, always, in both cases. Reporting stays with Sentry — capturing here too
// would double every event.
//
// Registering an uncaughtException listener SUPPRESSES Node's default exit, and Sentry's
// own handler deliberately declines to exit when another listener is present. That leaves
// this handler owning the decision, so it makes it explicitly: report, give Sentry a moment
// to flush, then exit and let Railway restart us. A process that keeps serving after an
// unknown throw is in a state nobody can reason about — the pool case in v1.105.127 was
// survivable precisely BECAUSE we knew what it was.
//
// An unhandled rejection is not that. It stays up, which matches Sentry's own 'warn' mode
// and is how this app has behaved since the SDK went in.
// Exported and installed rather than written inline, so the mechanism can be DEMONSTRATED in
// a child process (tests/crashHandlers.test.js) instead of asserted from memory — the same
// reason v1.105.127 tested the pool listener that way.
const DEFAULT_FLUSH_MS = 2000;

function installCrashHandlers({ flushMs = DEFAULT_FLUSH_MS, exit = (code) => process.exit(code) } = {}) {
  process.on("uncaughtException", (err) => {
    const upSec = Math.round(process.uptime());
    console.error(
      `\n  ☠️  UNCAUGHT EXCEPTION after ${upSec}s of uptime — exiting for a restart\n` +
      `  ${err && err.stack ? err.stack : err}\n`
    );
    setTimeout(() => exit(1), flushMs).unref();
  });

  process.on("unhandledRejection", (reason) => {
    const upSec = Math.round(process.uptime());
    console.error(
      `\n  ⚠️  UNHANDLED REJECTION after ${upSec}s of uptime — staying up\n` +
      `  ${reason && reason.stack ? reason.stack : reason}\n`
    );
  });
}

module.exports = { installCrashHandlers };
