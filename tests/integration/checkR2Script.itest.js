/**
 * The R2 check has to be right about R2. (v1.106.44)
 *
 * scripts/check-r2.js exists so that "is the bucket working?" stops being a guess — Pete runs
 * it in the Railway console and it answers in words. A diagnostic that is wrong is worse than
 * none, because it is believed: its first draft sampled a table that does not exist and a
 * column that was never there, caught the error, skipped both, and printed a clean bill of
 * health for tables it had never looked at.
 *
 * So the script is tested the way the app is: against a real schema, with the failure modes
 * simulated, asserting on what it actually says.
 */
const { startHarness, stopHarness } = require("./harness");
const { v4: uuid } = require("uuid");
const path = require("path");
const { execFileSync } = require("child_process");

jest.setTimeout(180000);

const ROOT = path.join(__dirname, "..", "..");
let h;

beforeAll(async () => { h = await startHarness({ routers: {} }); });
afterAll(async () => { await stopHarness(h); });

/** Run the script with a given environment and capture what it printed and returned. */
function run(env) {
  try {
    const stdout = execFileSync(process.execPath, [path.join(ROOT, "scripts", "check-r2.js")], {
      env: { ...process.env, ...env },
      encoding: "utf8",
      timeout: 60000,
    });
    return { code: 0, out: stdout };
  } catch (err) {
    return { code: err.status == null ? -1 : err.status, out: `${err.stdout || ""}${err.stderr || ""}` };
  }
}

const OFF = { R2_ACCOUNT_ID: "", R2_ACCESS_KEY_ID: "", R2_SECRET_ACCESS_KEY: "", R2_UPLOADS_BUCKET: "" };

describe("when R2 is not configured", () => {
  test("it says so and fails, rather than reporting nothing", () => {
    const r = run(OFF);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/R2 is NOT configured here/);
  });

  test("it names what is needed without printing any value", () => {
    const r = run({ ...OFF, R2_ACCOUNT_ID: "super-secret-account" });
    expect(r.out).toMatch(/R2_ACCOUNT_ID/);
    expect(r.out).not.toMatch(/super-secret-account/);
  });

  test("three of four is off, not half-on", () => {
    const r = run({
      R2_ACCOUNT_ID: "a", R2_ACCESS_KEY_ID: "b", R2_SECRET_ACCESS_KEY: "c", R2_UPLOADS_BUCKET: "",
    });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/NOT configured/);
  });
});

describe("it samples the columns the backfill owns", () => {
  const { TARGETS } = require("../../scripts/backfill-blobs-to-r2");

  test("the list is imported, not a second copy that can drift", () => {
    const src = require("../helpers/source").code("scripts/check-r2.js");
    expect(src).toMatch(/require\("\.\/backfill-blobs-to-r2"\)/);
    expect(src).not.toMatch(/\["verified_documents", "file_data"\]/);
  });

  test("every table and column it samples really exists in the schema", async () => {
    // The check that the first draft failed, and could not have caught itself: a table name
    // that is wrong gets skipped, and a skipped table is a silent gap in the report.
    for (const t of TARGETS) {
      const row = await h.db.prepare(`
        SELECT COUNT(*)::int AS n FROM information_schema.columns
         WHERE table_name = ? AND column_name = ?
      `).get(t.table, t.column);
      expect([`${t.table}.${t.column}`, row.n]).toEqual([`${t.table}.${t.column}`, 1]);
    }
  });

  test("and every one of them can be ordered by created_at, which the sampler uses", async () => {
    for (const t of TARGETS.filter((x) => !x.json)) {
      const row = await h.db.prepare(`
        SELECT COUNT(*)::int AS n FROM information_schema.columns
         WHERE table_name = ? AND column_name = 'created_at'
      `).get(t.table);
      expect([t.table, row.n]).toEqual([t.table, 1]);
    }
  });
});

describe("a row pointing at an object that is not there", () => {
  test("is reported as unreadable rather than passed over", async () => {
    // R2 "configured" with credentials that cannot reach anything: the write fails, which is
    // the first thing the script checks, and it must say which half broke.
    const fam = await h.createUser({ firstName: "Pete" });
    const { recipientId } = await h.createCareTeam({ familyUserId: fam.user.id });
    await h.db.prepare(`
      INSERT INTO family_visits (id, care_recipient_id, user_id, visited_at, photo, logged_via, created_at)
      VALUES (?, ?, ?, NOW(), 'r2:family-visit/2026-09-15/nope', 'manual', NOW())
    `).run(uuid(), recipientId, fam.user.id);

    const r = run({
      R2_ACCOUNT_ID: "no-such-account-inplace-test",
      R2_ACCESS_KEY_ID: "x", R2_SECRET_ACCESS_KEY: "y", R2_UPLOADS_BUCKET: "z",
      DATABASE_URL: process.env.DATABASE_URL,
    });
    expect(r.code).toBe(1);
    // Either half may be the one that reports first; what matters is that it fails loudly and
    // names R2 rather than printing a clean report.
    expect(r.out).toMatch(/could not (WRITE|READ)/i);
    expect(r.out).not.toMatch(/R2 is working in both directions/);
  });
});
