/**
 * Batch 6 — the two proposal subsystems (v1.106.13).
 *
 * These are NOT duplicates and the batch plan was wrong to call them one:
 *
 *   time_proposals         a caregiver bidding a time on an OPEN request. Caregiver-only,
 *                          2-hour window, becomes a confirmed booking if the family accepts.
 *   time_change_proposals  moving an ALREADY-CONFIRMED visit. Either side proposes, the other
 *                          answers, and the visit's time and duration change in place.
 *
 * Their status guards are mutually exclusive, so a session is only ever eligible for one.
 * What was genuinely wrong was the mechanics: one had a deadline and a sweeper and the other
 * had neither, and every multi-row mutation in both was a sequence of independent writes.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || "batch6-test-secret";

const { code, raw } = require("./helpers/source");

const sess = code("src/routes/sessions.js");
const db = code("src/models/database.js");
const tz = code("src/utils/timezone.js");

/** Slice from `from` to the matching close of the transaction opened at/after it. */
function txBlock(src, fromIdx) {
  const t = src.indexOf("await db.transaction(async (tx) =>", fromIdx);
  expect(t).toBeGreaterThan(-1);
  return src.slice(t, t + 1800);
}

describe("D1 — the two subsystems are distinct, and stay distinct", () => {
  test("they guard on mutually exclusive session states", () => {
    // A: moving a booked visit — confirmed only.
    const a = sess.indexOf('router.post("/:id/propose-time-change"');
    expect(a).toBeGreaterThan(-1);
    expect(sess.slice(a, a + 2200)).toMatch(/session\.status !== "confirmed"/);

    // B: bidding on an open request — never a confirmed one.
    const b = sess.indexOf('router.post("/:id/propose-time"');
    expect(b).toBeGreaterThan(-1);
    expect(sess.slice(b, b + 2400)).toMatch(/\["open", "requested", "pending"\]\.includes\(session\.status\)/);
  });

  test("both are still routed — neither was deleted as a supposed duplicate", () => {
    for (const r of [
      'router.post("/:id/propose-time-change"',
      'router.put("/:id/time-change/:proposalId/respond"',
      'router.post("/:id/propose-time"',
      'router.put("/:id/proposals/:proposalId/accept"',
    ]) {
      expect(sess.indexOf(r)).toBeGreaterThan(-1);
    }
  });
});

describe("D2 — a time change now has an end", () => {
  test("migration 036 adds expires_at and backfills the rows that were already immortal", () => {
    const m = db.indexOf('id: "036_time_change_proposal_expiry"');
    expect(m).toBeGreaterThan(-1);
    const block = db.slice(m, m + 1800);
    expect(block).toMatch(/ALTER TABLE time_change_proposals ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ/);
    // The backfill must bound existing pending rows, not just new ones.
    expect(block).toMatch(/UPDATE time_change_proposals[\s\S]{0,400}SET expires_at = LEAST\(/);
    expect(block).toMatch(/WHERE tcp\.status = 'pending' AND tcp\.expires_at IS NULL/);
  });

  test("propose sets a deadline that cannot outlive the visit", () => {
    const i = sess.indexOf("const expiresAtMs = Math.min(");
    expect(i).toBeGreaterThan(-1);
    const line = sess.slice(i, i + 200);
    expect(line).toMatch(/24 \* 60 \* 60 \* 1000/);          // 24h ceiling
    expect(line).toMatch(/sessionDateTime\.getTime\(\)/);     // …or the visit's start, whichever first
  });

  test("the sweeper expires them AND clears the pointer, in one transaction", () => {
    const i = sess.indexOf("const staleChanges = await db.prepare(");
    expect(i).toBeGreaterThan(-1);
    const query = sess.slice(i, i + 1200);
    expect(query).toMatch(/tcp\.expires_at IS NOT NULL AND tcp\.expires_at < NOW\(\)/);
    // A dead session's proposal goes too, deadline or not.
    expect(query).toMatch(/cs\.status IN \('cancelled', 'completed'\)/);

    const block = txBlock(sess, i);
    expect(block).toMatch(/UPDATE time_change_proposals SET status = 'expired'/);
    expect(block).toMatch(/UPDATE care_sessions SET pending_time_change_id = NULL/);
  });

  test("the sweep is counted, so a silent no-op is visible", () => {
    expect(sess).toMatch(/return expired\.length \+ orphaned\.length \+ staleChanges\.length;/);
  });
});

describe("D3 — every proposal mutation is all-or-nothing", () => {
  test("proposing writes the row and the pointer together", () => {
    const block = txBlock(sess, sess.indexOf("const proposalId = uuid();"));
    expect(block).toMatch(/INSERT INTO time_change_proposals/);
    expect(block).toMatch(/UPDATE care_sessions SET pending_time_change_id = \?/);
  });

  test("accepting a time change moves the visit and closes the proposal together", () => {
    const block = txBlock(sess, sess.indexOf('if (action === "accept") {'));
    expect(block).toMatch(/UPDATE time_change_proposals SET status = 'accepted'/);
    expect(block).toMatch(/UPDATE care_sessions SET scheduled_time = \?, duration_hours = \?, pending_time_change_id = NULL/);
  });

  test("rejecting releases the pointer in the same transaction", () => {
    const block = txBlock(sess, sess.indexOf('} else if (action === "reject") {'));
    expect(block).toMatch(/UPDATE time_change_proposals SET status = 'rejected'/);
    expect(block).toMatch(/UPDATE care_sessions SET pending_time_change_id = NULL/);
  });

  test("both cancel-with-review branches are transactional", () => {
    for (const status of ["cancelled_no_fee", "cancelled_with_fee"]) {
      const at = sess.indexOf(`status = '${status}'`);
      expect(at).toBeGreaterThan(-1);
      // the transaction must OPEN before the write, not after it
      const opened = sess.lastIndexOf("await db.transaction(async (tx) =>", at);
      expect(opened).toBeGreaterThan(-1);
      expect(at - opened).toBeLessThan(600);
      expect(sess.slice(opened, at + 900)).toMatch(/UPDATE care_sessions SET status = '(cancelled|open)', pending_time_change_id = NULL/);
    }
  });

  test("accepting a caregiver's bid confirms, accepts and declines rivals as one act", () => {
    const block = txBlock(sess, sess.indexOf('router.put("/:id/proposals/:proposalId/accept"'));
    expect(block).toMatch(/UPDATE care_sessions SET[\s\S]{0,200}status = 'confirmed'/);
    expect(block).toMatch(/UPDATE time_proposals SET status = 'accepted'/);
    expect(block).toMatch(/UPDATE time_proposals SET status = 'declined'[\s\S]{0,140}id != \?/);
  });

  test("…and the confirm is conditional, so a second concurrent accept loses instead of overwriting", () => {
    const block = txBlock(sess, sess.indexOf('router.put("/:id/proposals/:proposalId/accept"'));
    expect(block).toMatch(/WHERE id = \? AND status IN \('open', 'requested', 'pending'\)/);
    expect(block).toMatch(/applied\.changes === 0/);
    // and the caller is told, rather than being handed a success for work it did not get
    const after = sess.slice(sess.indexOf('router.put("/:id/proposals/:proposalId/accept"'));
    expect(after).toMatch(/status\(409\)[\s\S]{0,120}just booked by someone else/);
  });
});

describe("D4 — one 12-hour clock", () => {
  const { formatTimeForDisplay } = require("../src/utils/timezone");

  test.each([
    ["14:00", "2:00 PM"],
    ["00:00", "12:00 AM"],
    ["12:00", "12:00 PM"],
    ["09:05", "9:05 AM"],
    ["1:0", "1:00 AM"],
    ["14", "2:00 PM"],   // the ragged case the six copies disagreed on
    ["", ""],
    [null, ""],
  ])("%s → %s", (input, expected) => {
    expect(formatTimeForDisplay(input)).toBe(expected);
  });

  test("a visit ending after midnight is AM, not PM", () => {
    // push.js computes an end hour that can exceed 24 (21:00 + 4h = 25) and used to format it
    // raw: 25 > 12 → 13, 25 >= 12 → "PM", so a 1am finish was texted as "1:00 PM".
    expect(formatTimeForDisplay(`${25 % 24}:0`)).toBe("1:00 AM");
    expect(formatTimeForDisplay(`${24 % 24}:0`)).toBe("12:00 AM");
  });

  test("push.js hands the wrapped hour to the shared formatter", () => {
    const push = code("src/routes/push.js");
    expect(push).toMatch(/return formatTimeForDisplay\(`\$\{finalH % 24\}:\$\{finalM\}`\)/);
    // …and actually imports it. node --check does not catch a missing require.
    expect(push).toMatch(/require\("\.\.\/utils\/timezone"\)/);
  });

  test("no module rolls its own AM/PM any more", () => {
    const offenders = [];
    for (const f of [
      "src/routes/sessions.js", "src/routes/push.js",
      "src/utils/jobMatching.js", "src/utils/attention.js",
    ]) {
      if (/\bampm\b/.test(raw(f))) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });
});
