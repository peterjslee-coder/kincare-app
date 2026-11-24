// An idle client's error must not be able to kill the API. (v1.105.127)
//
// Sentry INPLACE-C, 2026-08-22T17:43:51Z, release 17e3b016 (v1.105.126):
//   Error: Connection terminated unexpectedly   (pg/lib/client.js)
//   mechanism: auto.node.onuncaughtexception · handled: no · level: fatal
//   app_start_time 16:47:57Z — so the process ran 56 minutes and then died.
//
// node-postgres emits 'error' on a client sitting IDLE in the pool when the connection
// drops beneath it. EventEmitter re-throws an 'error' event that has no listener, and
// this codebase has no process-level uncaughtException handler, so the throw ended the
// process. The pool itself recovers from a dropped idle client without help — the only
// thing that made it fatal was that nobody was listening.
//
// These tests assert the listener exists and behaves: swallow, report, never rethrow.

const fs = require("fs");
const path = require("path");
const { EventEmitter } = require("events");

const SRC = fs.readFileSync(path.join(__dirname, "..", "src", "models", "database.js"), "utf8");

describe("the pool has an error listener at all", () => {
  test("database.js attaches one", () => {
    expect(SRC).toMatch(/pool\.on\(\s*["']error["']/);
  });

  test("it is attached where the pool is built, not somewhere a caller might skip", () => {
    const made = SRC.indexOf("pool = new Pool(");
    const listener = SRC.search(/pool\.on\(\s*["']error["']/);
    expect(made).toBeGreaterThan(-1);
    expect(listener).toBeGreaterThan(made);
    // and before getPool() hands the pool out
    const ret = SRC.indexOf("return pool;", made);
    expect(listener).toBeLessThan(ret);
  });

  test("it reports to Sentry", () => {
    const listener = SRC.search(/pool\.on\(\s*["']error["']/);
    const block = SRC.slice(listener, listener + 900);
    expect(block).toMatch(/captureException/);
  });

  test("it does NOT rethrow, exit, or reconnect", () => {
    const listener = SRC.search(/pool\.on\(\s*["']error["']/);
    const block = SRC.slice(listener, listener + 900);
    expect(block).not.toMatch(/\bthrow\b/);
    expect(block).not.toMatch(/process\.exit/);
    // pg already replaces the dropped client; a hand-rolled reconnect here would fight it
    expect(block).not.toMatch(/\.connect\(/);
  });
});

describe("what an unlistened 'error' event actually does", () => {
  // The mechanism, demonstrated rather than asserted from memory — this is why the
  // two-line fix is worth a test at all.
  test("EventEmitter rethrows when nothing is listening", () => {
    const bare = new EventEmitter();
    expect(() => bare.emit("error", new Error("Connection terminated unexpectedly"))).toThrow(
      /Connection terminated unexpectedly/
    );
  });

  test("and is silent the moment something is", () => {
    const guarded = new EventEmitter();
    const seen = [];
    guarded.on("error", (e) => seen.push(e.message));
    expect(() => guarded.emit("error", new Error("Connection terminated unexpectedly"))).not.toThrow();
    expect(seen).toEqual(["Connection terminated unexpectedly"]);
  });

  test("a listener that throws puts us right back where we started", () => {
    // Guards the shape of the handler: the reporting call is wrapped in try/catch in
    // database.js precisely so a Sentry failure cannot become the fatal error itself.
    const bad = new EventEmitter();
    bad.on("error", () => { throw new Error("sentry exploded"); });
    expect(() => bad.emit("error", new Error("original"))).toThrow(/sentry exploded/);

    const good = new EventEmitter();
    good.on("error", () => {
      try { throw new Error("sentry exploded"); } catch { /* swallowed, as in database.js */ }
    });
    expect(() => good.emit("error", new Error("original"))).not.toThrow();
  });

  test("database.js wraps its reporting call so it cannot become the fatal error", () => {
    const listener = SRC.search(/pool\.on\(\s*["']error["']/);
    const block = SRC.slice(listener, listener + 900);
    const capture = block.indexOf("captureException");
    const tryBefore = block.lastIndexOf("try {", capture);
    expect(tryBefore).toBeGreaterThan(-1);
    expect(tryBefore).toBeLessThan(capture);
  });
});
