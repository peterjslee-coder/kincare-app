/**
 * v1.105.77 — the predicates, against a real database.
 *
 * Source-matching tests prove the text changed. These prove the BEHAVIOUR changed, which is
 * the only thing that matters for a filter: does the row come back or not.
 *
 * Every column in these queries was always real, so lint:sql-columns could never see the bug.
 * Only the values were wrong, and Postgres is perfectly happy to run a query that matches
 * nothing forever.
 */
const { startHarness, stopHarness } = require("./harness");
const { v4: uuid } = require("uuid");
const { ELEVATED_SQL } = require("../../src/utils/auditSeverity");

jest.setTimeout(180000);

let h, getDb;

beforeAll(async () => {
  h = await startHarness({ routers: {} });
  ({ getDb } = require("../../src/models/database"));
});
afterAll(async () => { await stopHarness(h); });

describe("the no-show poller sees a session that was never notified", () => {
  test("NULL notifications_sent is included, not silently excluded", async () => {
    const db = await getDb();

    // A confirmed session whose notifications_sent is NULL — the exact row the old predicate
    // dropped, and the exact case the poller exists for (confirmed inside the reminder window,
    // after start time, or while the poller was down).
    const fam = uuid(), cr = uuid(), sess = uuid();
    await db.prepare("INSERT INTO users (id, email, password_hash, first_name, last_name, role) VALUES (?, ?, 'x', 'Fam', 'Ily', 'family')").run(fam, `f-${fam}@t.test`);
    await db.prepare("INSERT INTO care_recipients (id, family_user_id, first_name, last_name) VALUES (?, ?, 'Betty', 'T')").run(cr, fam);
    await db.prepare(
      `INSERT INTO care_sessions (id, care_recipient_id, family_user_id, service_type, status, scheduled_date, scheduled_time, caregiver_no_show)
       VALUES (?, ?, ?, 'companionship', 'confirmed', '2026-08-18', '09:00', 0)`
    ).run(sess, cr, fam);

    const nulls = await db.prepare(
      "SELECT notifications_sent FROM care_sessions WHERE id = ?"
    ).get(sess);
    expect(nulls.notifications_sent).toBeNull(); // the precondition the bug depended on

    // OLD predicate — what shipped until v1.105.77
    const oldWay = await db.prepare(
      "SELECT COUNT(*) AS c FROM care_sessions WHERE id = ? AND notifications_sent NOT LIKE '%no_show_flagged%'"
    ).get(sess);
    expect(parseInt(oldWay.c, 10)).toBe(0);   // ← the bug, reproduced

    // NEW predicate
    const newWay = await db.prepare(
      "SELECT COUNT(*) AS c FROM care_sessions WHERE id = ? AND (notifications_sent IS NULL OR notifications_sent NOT LIKE '%no_show_flagged%')"
    ).get(sess);
    expect(parseInt(newWay.c, 10)).toBe(1);

    // And it must still exclude one that HAS been flagged.
    await db.prepare("UPDATE care_sessions SET notifications_sent = ',no_show_flagged' WHERE id = ?").run(sess);
    const flagged = await db.prepare(
      "SELECT COUNT(*) AS c FROM care_sessions WHERE id = ? AND (notifications_sent IS NULL OR notifications_sent NOT LIKE '%no_show_flagged%')"
    ).get(sess);
    expect(parseInt(flagged.c, 10)).toBe(0);
  });
});

describe("the security briefing can report a failed login", () => {
  test("it counts what the middleware actually writes", async () => {
    const db = await getDb();
    // What middleware/auditLog.js writes on a failed login: action 'login_attempt',
    // severity escalated. NOT 'login_failed', which nothing has ever written.
    await db.prepare(
      "INSERT INTO audit_log (action, endpoint, method, severity, created_at) VALUES ('login_attempt', '/api/auth/login', 'POST', 'warning', NOW())"
    ).run();

    const oldWay = await db.prepare(
      "SELECT COUNT(*) AS c FROM audit_log WHERE action = 'login_failed' AND created_at > NOW() - INTERVAL '24 hours'"
    ).get();
    expect(parseInt(oldWay.c, 10)).toBe(0);   // hard zero, forever

    const newWay = await db.prepare(
      `SELECT COUNT(*) AS c FROM audit_log WHERE action = 'login_attempt' AND severity IN (${ELEVATED_SQL}) AND created_at > NOW() - INTERVAL '24 hours'`
    ).get();
    expect(parseInt(newWay.c, 10)).toBeGreaterThan(0);
  });

  test("the elevated set catches BOTH spellings that exist in the table", async () => {
    const db = await getDb();
    await db.prepare("INSERT INTO audit_log (action, endpoint, method, severity, created_at) VALUES ('admin_write', '/api/admin/x', 'POST', 'warn', NOW())").run();
    await db.prepare("INSERT INTO audit_log (action, endpoint, method, severity, created_at) VALUES ('checkr_suspended', '/api/checkr/webhook', 'POST', 'warning', NOW())").run();

    // The old filter asked for a word nobody wrote.
    const oldWay = await db.prepare(
      "SELECT COUNT(*) AS c FROM audit_log WHERE severity IN ('critical', 'error') AND created_at > NOW() - INTERVAL '1 hour'"
    ).get();
    expect(parseInt(oldWay.c, 10)).toBe(0);

    const newWay = await db.prepare(
      `SELECT COUNT(*) AS c FROM audit_log WHERE severity IN (${ELEVATED_SQL}) AND created_at > NOW() - INTERVAL '1 hour'`
    ).get();
    expect(parseInt(newWay.c, 10)).toBeGreaterThanOrEqual(2);
  });
});
