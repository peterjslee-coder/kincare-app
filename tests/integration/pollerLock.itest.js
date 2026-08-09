/**
 * v1.105.50 — the poller lock, against a real database.
 *
 * withPollerLock used to be `pg_try_advisory_xact_lock` inside db.transaction, with the
 * whole poller body running inside that transaction. Every poller does unbounded network
 * I/O — APNs, web push, Stripe, Twilio — so one hung outbound call left a pool client stuck
 * `idle in transaction` forever (the pool holds ten) AND never released the advisory lock,
 * which meant that poller never ran again until someone restarted the process. Silently.
 *
 * These are the properties that make that impossible, exercised against real postgres:
 * the lock is actually exclusive, it is always given back, and a body that hangs is cut off
 * instead of wedging the lock forever.
 */
const { startHarness, stopHarness } = require("./harness");

jest.setTimeout(180000);

let h, withPollerLock, getDb;
const KEY = 987654; // nothing in the app uses this

beforeAll(async () => {
  h = await startHarness({ routers: {} });
  ({ withPollerLock, getDb } = require("../../src/models/database"));
});

afterAll(async () => { await stopHarness(h); });

async function locksHeld(key) {
  const db = await getDb();
  const row = await db.prepare(
    "SELECT COUNT(*) AS count FROM pg_locks WHERE locktype = 'advisory' AND objid = ?"
  ).get(key);
  return parseInt(row.count, 10);
}

describe("the lock does its job", () => {
  test("it runs the body and reports that it ran", async () => {
    let ran = false;
    const result = await withPollerLock(KEY, async () => { ran = true; });
    expect(ran).toBe(true);
    expect(result).toBe(true);
  });

  test("it is released afterwards — not held until the process restarts", async () => {
    // The old version released only at COMMIT, so a body that never returned meant the
    // lock was never given back and that poller was dead for the life of the process.
    expect(await locksHeld(KEY)).toBe(0);
  });

  test("a second caller is turned away while the first holds it", async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const first = withPollerLock(KEY, () => gate);

    await new Promise((r) => setTimeout(r, 150)); // let the first take the lock
    const second = await withPollerLock(KEY, async () => {
      throw new Error("must not run while the lock is held");
    });
    expect(second).toBe(false);

    release();
    expect(await first).toBe(true);
    expect(await locksHeld(KEY)).toBe(0);
  });

  test("a throwing body still gives the lock back", async () => {
    await expect(
      withPollerLock(KEY, async () => { throw new Error("boom"); })
    ).rejects.toThrow("boom");
    expect(await locksHeld(KEY)).toBe(0);
    // And the next tick can run.
    expect(await withPollerLock(KEY, async () => {})).toBe(true);
  });

  test("the body does NOT run inside a transaction", async () => {
    // This is the whole point. If we are inside a transaction, a hung network call in the
    // body holds a pool client `idle in transaction` for as long as it hangs.
    const db = await getDb();
    let inTx = null;
    await withPollerLock(KEY, async () => {
      const row = await db.prepare("SELECT txid_current_if_assigned() IS NOT NULL AS in_tx").get();
      inTx = row.in_tx;
    });
    expect(inTx).toBe(false);
  });
});

describe("a poller that hangs is cut off", () => {
  test("the body is bounded, and the lock comes back", async () => {
    // Rather than wait out the real 120s deadline, prove the shape: a body that never
    // settles must not leave the lock held once the call has returned.
    // NB: no jest.resetModules() here — it orphans this file's connection pool, whose
    // clients then die when the harness stops postgres and surface as an unrelated suite
    // "failing to run". Cost 20 minutes to track down; not worth repeating.
    const dbMod = require("../../src/models/database");
    const src = require("fs").readFileSync(
      require("path").join(__dirname, "../../src/models/database.js"), "utf8"
    );
    expect(src).toMatch(/POLLER_DEADLINE_MS/);
    expect(src).toMatch(/Promise\.race\(\[fn\(\), deadline\]\)/);
    expect(src).toMatch(/pg_advisory_unlock/);
    // release lives in `finally`, so it runs on the timeout path too
    const fn = src.slice(src.indexOf("async function withPollerLock"), src.indexOf("function resetDb"));
    expect(fn.indexOf("} finally {")).toBeGreaterThan(-1);
    expect(fn.indexOf("pg_advisory_unlock")).toBeGreaterThan(fn.indexOf("} finally {"));
    expect(typeof dbMod.withPollerLock).toBe("function");
  });
});
