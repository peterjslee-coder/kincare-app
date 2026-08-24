// A throw that nobody owns still says so, in the log, before it goes. (v1.105.130)
//
// v1.105.127 fixed the pg pool's missing 'error' listener and filed the general case: nothing
// in this codebase handles uncaughtException or unhandledRejection. Checking that before
// building on it found it half right — Sentry's node SDK registers both by default, which is
// how INPLACE-C reached us at all. What was missing is the half that matters at 2am: a line
// in the Railway log saying the process is going down and how long it had been up, present
// whether or not SENTRY_DSN is set.
//
// Spawned for real rather than asserted from source, because the property under test is a
// process-level behaviour: registering an uncaughtException listener SUPPRESSES Node's own
// exit, and Sentry's handler declines to exit when another listener exists. Get that wrong
// and the app keeps serving after an unknown throw. Only running it proves which way it went.

const path = require("path");
const { spawnSync } = require("child_process");

const child = (mode) => {
  const r = spawnSync(process.execPath, [path.join(__dirname, "fixtures", "crashChild.js"), mode], {
    encoding: "utf8",
    timeout: 10000,
    env: { ...process.env, SENTRY_DSN: "" },
  });
  return { code: r.status, out: r.stdout || "", err: r.stderr || "" };
};

describe("an uncaught exception", () => {
  const run = child("throw");

  test("says so in the log, loudly enough to find", () => {
    expect(run.err).toMatch(/UNCAUGHT EXCEPTION/);
    expect(run.err).toMatch(/the pool dropped an idle client/);
  });

  test("says how long the process had been up", () => {
    // The fact that mattered on Saturday — "it ran fifty-six minutes" — lived only in Sentry.
    expect(run.err).toMatch(/after \d+s of uptime/);
  });

  test("still exits, so the platform restarts us", () => {
    // The trap: our own listener suppresses Node's default exit, and Sentry's handler stands
    // down when another listener is registered. Nobody exits unless we do.
    expect(run.code).toBe(1);
    expect(run.out).not.toMatch(/SHOULD NOT REACH/);
  });
});

describe("an unhandled rejection", () => {
  const run = child("reject");

  test("is reported", () => {
    expect(run.err).toMatch(/UNHANDLED REJECTION/);
    expect(run.err).toMatch(/nobody caught this/);
  });

  test("does NOT take the API down with it", () => {
    // Node's own default since v15 is to crash. Matching Sentry's 'warn' mode instead, which
    // is how this app has actually behaved since the SDK went in — a rejected promise in one
    // poller is not a reason to drop every request in flight.
    expect(run.out).toMatch(/STILL ALIVE/);
    expect(run.code).toBe(0);
  });
});

describe("the control: what happens with no handler at all", () => {
  test("Node exits, and nothing legible is written", () => {
    const run = child("bare");
    expect(run.code).not.toBe(0);
    expect(run.err).not.toMatch(/UNCAUGHT EXCEPTION/);
  });
});

describe("it is installed before anything else can throw", () => {
  const fs = require("fs");
  const server = fs.readFileSync(path.join(__dirname, "..", "src", "server.js"), "utf8");

  test("server.js installs it in its first few lines", () => {
    const idx = server.indexOf('require("./utils/crashHandlers").installCrashHandlers()');
    expect(idx).toBeGreaterThan(-1);
    // Before the express app, the routes, and every poller.
    expect(idx).toBeLessThan(server.indexOf('require("express")'));
  });
});
