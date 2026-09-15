/**
 * Stepping out mid-visit — the routes, and what the bill comes to. (v1.106.41)
 *
 * Pete: "It's possible that Tina will take a job, need to leave for a couple hours, maybe
 * come back... As long as it's inside of the time of the original appointment." And on the
 * money: "if she needs to run somewhere for a personal reason for an hour, she can, but won't
 * be paid...has to be cumulative...so no more than 30 minutes break before we stop pay", with
 * "for sessions longer than 4 hours, they get a 30 min break."
 *
 * The arithmetic is unit-tested in tests/visitBreaks.test.js. What this file asks is whether
 * check-out actually APPLIES it — against a real Postgres, through the real route, reading
 * the row the family is charged from. That is a different question, and it is the one worth
 * money: an off-by-one here is a caregiver underpaid or a family overcharged on a real visit.
 *
 * Stripe is mocked at the module level. Dev Rule #7 — nothing in this repo's tests touches a
 * live key, and the keys in production are live.
 */
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "sk_test_integration_fake";

const mockCaptured = [];
jest.mock("stripe", () => jest.fn(() => ({
  paymentIntents: {
    create: jest.fn(async (args) => ({ id: "pi_x", status: "requires_capture", amount: args.amount })),
    capture: jest.fn(async (id, args) => { mockCaptured.push({ id, args }); return { id, status: "succeeded" }; }),
    cancel: jest.fn(async (id) => ({ id, status: "canceled" })),
  },
  paymentMethods: { list: jest.fn(async () => ({ data: [] })) },
})));

const { startHarness, stopHarness } = require("./harness");
const { v4: uuid } = require("uuid");

jest.setTimeout(180000);

const ROUTERS = { "/api/sessions": "../../src/routes/sessions" };

let h, db, family, tina, tinaProfileId, recipientId;

beforeAll(async () => {
  h = await startHarness({ routers: ROUTERS });
  db = h.db;
  family = await h.createUser({ firstName: "Pete", roles: ["family"] });
  ({ recipientId } = await h.createCareTeam({ familyUserId: family.user.id }));
  tina = await h.createUser({ firstName: "Tina", roles: ["caregiver"] });
  tinaProfileId = uuid();
  await db.prepare(`
    INSERT INTO caregiver_profiles (id, user_id, hourly_rate, is_background_checked, is_available, created_at)
    VALUES (?, ?, 25, 1, 1, NOW())
  `).run(tinaProfileId, tina.user.id);
});

afterAll(async () => { await stopHarness(h); });

/**
 * An in-progress visit whose check-in was `checkedInMinutesAgo` ago — so the elapsed clock is
 * real wall-clock time rather than something the test asserts about itself.
 */
async function activeVisit({ hours = 8, checkedInMinutesAgo = 480, cost = 200 } = {}) {
  const sessionId = uuid();
  await db.prepare(`
    INSERT INTO care_sessions
      (id, care_recipient_id, family_user_id, caregiver_id, service_type, status,
       scheduled_date, scheduled_time, duration_hours, agreed_rate, estimated_cost, flex_timing, created_at)
    VALUES (?, ?, ?, ?, 'companionship', 'in_progress', '2026-09-15', '09:00', ?, 25, ?, 'strict', NOW())
  `).run(sessionId, recipientId, family.user.id, tinaProfileId, hours, cost);
  await db.prepare(`
    INSERT INTO visit_logs (id, session_id, caregiver_id, check_in_time, created_at)
    VALUES (?, ?, ?, NOW() - (? || ' minutes')::interval, NOW())
  `).run(uuid(), sessionId, tinaProfileId, String(checkedInMinutesAgo));
  return sessionId;
}

/** Put a finished break on the record, `agoStart`..`agoEnd` minutes before now. */
async function recordBreak(sessionId, agoStart, agoEnd) {
  await db.prepare(`
    INSERT INTO visit_breaks (id, session_id, caregiver_user_id, started_at, ended_at, created_at)
    VALUES (?, ?, ?, NOW() - (? || ' minutes')::interval, NOW() - (? || ' minutes')::interval, NOW())
  `).run(uuid(), sessionId, tina.user.id, String(agoStart), String(agoEnd));
}

const post = (sessionId, path, who = tina, body = {}) =>
  h.request.post(`/api/sessions/${sessionId}/${path}`).set(h.auth(who.token)).send(body);

const sessionRow = (id) =>
  db.prepare("SELECT status, duration_hours, estimated_cost FROM care_sessions WHERE id = ?").get(id);

describe("stepping out and coming back", () => {
  test("she can pause a visit she is checked into", async () => {
    const id = await activeVisit();
    const res = await post(id, "break/start");
    expect(res.status).toBe(200);
    expect(res.body.onBreak).toBe(true);
    const row = await db.prepare("SELECT ended_at FROM visit_breaks WHERE session_id = ?").get(id);
    expect(row).toBeTruthy();
    expect(row.ended_at).toBeNull();
  });

  test("the notice names her remaining budget — Pete: 'you have X minutes left'", async () => {
    const id = await activeVisit({ hours: 8 });
    const res = await post(id, "break/start");
    expect(res.body.notice).toMatch(/30 min left/);
  });

  test("a short visit is told it has no paid break rather than being quietly charged", async () => {
    const id = await activeVisit({ hours: 2, checkedInMinutesAgo: 60, cost: 50 });
    const res = await post(id, "break/start");
    expect(res.body.budgetMinutes).toBe(0);
    expect(res.body.notice).toMatch(/no paid break time/);
  });

  test("the session STAYS in_progress — a break is not a check-out", async () => {
    const id = await activeVisit();
    await post(id, "break/start");
    expect((await sessionRow(id)).status).toBe("in_progress");
  });

  test("tapping Step out twice does not start two clocks", async () => {
    const id = await activeVisit();
    expect((await post(id, "break/start")).status).toBe(200);
    const second = await post(id, "break/start");
    expect(second.status).toBe(409);
    const n = await db.prepare("SELECT COUNT(*)::int AS n FROM visit_breaks WHERE session_id = ?").get(id);
    expect(n.n).toBe(1);
  });

  test("she can come back, and the break closes", async () => {
    const id = await activeVisit();
    await post(id, "break/start");
    const res = await post(id, "break/end");
    expect(res.status).toBe(200);
    expect(res.body.onBreak).toBe(false);
    const row = await db.prepare("SELECT ended_at FROM visit_breaks WHERE session_id = ?").get(id);
    expect(row.ended_at).not.toBeNull();
  });

  test("coming back when she never left is refused, not a second row", async () => {
    const id = await activeVisit();
    const res = await post(id, "break/end");
    expect(res.status).toBe(409);
    const n = await db.prepare("SELECT COUNT(*)::int AS n FROM visit_breaks WHERE session_id = ?").get(id);
    expect(n.n).toBe(0);
  });

  test("she can step out again after coming back — cumulative means more than one", async () => {
    const id = await activeVisit();
    await post(id, "break/start");
    await post(id, "break/end");
    expect((await post(id, "break/start")).status).toBe(200);
    const n = await db.prepare("SELECT COUNT(*)::int AS n FROM visit_breaks WHERE session_id = ?").get(id);
    expect(n.n).toBe(2);
  });
});

describe("who may pause whose visit", () => {
  test("the family cannot pause the caregiver's visit", async () => {
    const id = await activeVisit();
    const res = await post(id, "break/start", family);
    expect(res.status).toBe(403);
    const n = await db.prepare("SELECT COUNT(*)::int AS n FROM visit_breaks WHERE session_id = ?").get(id);
    expect(n.n).toBe(0);
  });

  test("a different caregiver cannot", async () => {
    const other = await h.createUser({ firstName: "Julia", roles: ["caregiver"] });
    const id = await activeVisit();
    const res = await post(id, "break/start", other);
    expect(res.status).toBe(403);
  });

  test("not before check-in — 'inside the time of the original appointment'", async () => {
    const id = uuid();
    await db.prepare(`
      INSERT INTO care_sessions (id, care_recipient_id, family_user_id, caregiver_id, service_type,
                                 status, scheduled_date, scheduled_time, duration_hours, estimated_cost, created_at)
      VALUES (?, ?, ?, ?, 'companionship', 'confirmed', '2026-09-15', '09:00', 8, 200, NOW())
    `).run(id, recipientId, family.user.id, tinaProfileId);
    const res = await post(id, "break/start");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/checked into/i);
  });

  test("a session that does not exist is 404, not 500", async () => {
    expect((await post(uuid(), "break/start")).status).toBe(404);
  });
});

describe("what it costs — the part that is money", () => {
  const checkOut = (id) =>
    h.request.post(`/api/sessions/${id}/check-out`).set(h.auth(tina.token)).send({ summary: "" });

  test("no break: the full scheduled block, exactly as before this feature", async () => {
    const id = await activeVisit({ hours: 8, checkedInMinutesAgo: 480, cost: 200 });
    expect((await checkOut(id)).status).toBe(200);
    const row = await sessionRow(id);
    expect(Number(row.duration_hours)).toBe(8);
    expect(Number(row.estimated_cost)).toBe(200);
  });

  test("a 20-minute break on an 8-hour day costs nothing — it is inside the budget", async () => {
    const id = await activeVisit({ hours: 8, checkedInMinutesAgo: 480, cost: 200 });
    await recordBreak(id, 300, 280);
    expect((await checkOut(id)).status).toBe(200);
    const row = await sessionRow(id);
    expect(Number(row.duration_hours)).toBe(8);
    expect(Number(row.estimated_cost)).toBe(200);
  });

  test("Pete's example: away two hours on an 8-hour day → 90 unpaid minutes", async () => {
    const id = await activeVisit({ hours: 8, checkedInMinutesAgo: 480, cost: 200 });
    await recordBreak(id, 360, 240);                       // out 11:00–13:00
    expect((await checkOut(id)).status).toBe(200);
    const row = await sessionRow(id);
    // 480 present − 90 unpaid = 390 min = 6.5h of an 8h block, pro-rated on $200.
    expect(Number(row.duration_hours)).toBeCloseTo(6.5, 2);
    expect(Number(row.estimated_cost)).toBeCloseTo(162.5, 2);
  });

  test("cumulative: four 10-minute breaks cost the fourth, not each", async () => {
    const id = await activeVisit({ hours: 8, checkedInMinutesAgo: 480, cost: 200 });
    for (const [a, b] of [[400, 390], [350, 340], [300, 290], [250, 240]]) await recordBreak(id, a, b);
    expect((await checkOut(id)).status).toBe(200);
    const row = await sessionRow(id);
    // 40 away, 30 free, 10 unpaid. 480 elapsed is inside the ±15 grace so the visit is worth
    // its full 8h/$200 first; the 10 unpaid minutes then come off at $200/480 per minute.
    expect(Number(row.duration_hours)).toBeCloseTo(7.83, 2);
    expect(Number(row.estimated_cost)).toBeCloseTo(195.83, 1);
  });

  test("a SHORT visit gets no free minutes — a 40-minute break costs all forty", async () => {
    const id = await activeVisit({ hours: 2, checkedInMinutesAgo: 120, cost: 50 });
    await recordBreak(id, 100, 60);
    expect((await checkOut(id)).status).toBe(200);
    const row = await sessionRow(id);
    // No budget at all on a 2h visit, so all 40 come off: 120 − 40 = 80 min at $50/120.
    expect(Number(row.duration_hours)).toBeCloseTo(1.33, 2);
    expect(Number(row.estimated_cost)).toBeCloseTo(33.33, 1);
  });

  test("she never came back: the open break is closed at check-out and counted to then", async () => {
    const id = await activeVisit({ hours: 8, checkedInMinutesAgo: 480, cost: 200 });
    await post(id, "break/start");                          // open, starting now
    await db.prepare(
      "UPDATE visit_breaks SET started_at = NOW() - INTERVAL '90 minutes' WHERE session_id = ?"
    ).run(id);
    expect((await checkOut(id)).status).toBe(200);
    const row = await db.prepare("SELECT ended_at, ended_by FROM visit_breaks WHERE session_id = ?").get(id);
    expect(row.ended_at).not.toBeNull();
    expect(row.ended_by).toBe("checkout");
    // 90 away, 30 free, 60 unpaid → 420 min = 7h.
    expect(Number((await sessionRow(id)).duration_hours)).toBeCloseTo(7, 1);
  });

  test("a break can never make the billed time negative", async () => {
    const id = await activeVisit({ hours: 8, checkedInMinutesAgo: 60, cost: 200 });
    await recordBreak(id, 59, 1);                           // away for nearly the whole time
    expect((await checkOut(id)).status).toBe(200);
    const row = await sessionRow(id);
    expect(Number(row.duration_hours)).toBeGreaterThanOrEqual(0);
    expect(Number(row.estimated_cost)).toBeGreaterThanOrEqual(0);
  });

  test("the visit still closes properly — status, and a closed visit log", async () => {
    const id = await activeVisit({ hours: 8, checkedInMinutesAgo: 480, cost: 200 });
    await recordBreak(id, 360, 240);
    expect((await checkOut(id)).status).toBe(200);
    expect((await sessionRow(id)).status).toBe("completed");
    const vl = await db.prepare("SELECT check_out_time FROM visit_logs WHERE session_id = ?").get(id);
    expect(vl.check_out_time).not.toBeNull();
  });
});

describe("the family is told, both ways", () => {
  test("stepping out writes an activity entry naming no health detail", async () => {
    const id = await activeVisit();
    await post(id, "break/start");
    const row = await db.prepare(
      "SELECT event_type, title, message FROM activity_feed WHERE event_type = 'visit_break_start' ORDER BY created_at DESC LIMIT 1"
    ).get();
    expect(row).toBeTruthy();
    expect(row.title).toMatch(/Tina stepped out/);
    expect(`${row.title} ${row.message}`).not.toMatch(/mood|medication|diagnos/i);
  });

  test("coming back writes its own entry with how long she was away", async () => {
    const id = await activeVisit();
    await post(id, "break/start");
    await post(id, "break/end");
    const row = await db.prepare(
      "SELECT title, metadata FROM activity_feed WHERE event_type = 'visit_break_end' ORDER BY created_at DESC LIMIT 1"
    ).get();
    expect(row).toBeTruthy();
    expect(row.title).toMatch(/Tina is back/);
    const meta = typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata;
    expect(meta.sessionId).toBe(id);
    expect(typeof meta.awayMinutes).toBe("number");
  });
});

describe("the opt-out key is one that can actually be set", () => {
  // sendPushToUser builds its preference key as `push_${eventType}`. The first cut passed
  // "push_session_status", which looks up `push_push_session_status` — a key no settings
  // screen can ever write, so the family's opt-out could never be honoured and nothing would
  // have said so. Asserted against the real row, not the source.
  test("a family who muted visit-status pushes gets no break push", async () => {
    const quiet = await h.createUser({ firstName: "Quiet", roles: ["family"] });
    await db.prepare("UPDATE users SET notification_prefs = ? WHERE id = ?")
      .run(JSON.stringify({ push_session_in_progress: false }), quiet.user.id);
    const { recipientId: rid } = await h.createCareTeam({ familyUserId: quiet.user.id });

    const sessionId = uuid();
    await db.prepare(`
      INSERT INTO care_sessions (id, care_recipient_id, family_user_id, caregiver_id, service_type,
                                 status, scheduled_date, scheduled_time, duration_hours, estimated_cost, created_at)
      VALUES (?, ?, ?, ?, 'companionship', 'in_progress', '2026-09-15', '09:00', 8, 200, NOW())
    `).run(sessionId, rid, quiet.user.id, tinaProfileId);
    await db.prepare(`
      INSERT INTO visit_logs (id, session_id, caregiver_id, check_in_time, created_at)
      VALUES (?, ?, ?, NOW() - INTERVAL '60 minutes', NOW())
    `).run(uuid(), sessionId, tinaProfileId);

    const { sendPushToUser } = require("../../src/routes/push");
    const res = await sendPushToUser(quiet.user.id, {
      title: "Tina stepped out", body: "x",
      data: { type: "visit_break_start", sessionId, page: "home" },
    }, "session_in_progress");
    expect(res.reason).toBe("opted_out");
    expect(res.sent).toBe(0);
  });

  test("...and a family who has not muted it is not blocked by that key", async () => {
    const { sendPushToUser } = require("../../src/routes/push");
    const res = await sendPushToUser(family.user.id, {
      title: "Tina stepped out", body: "x",
      data: { type: "visit_break_start", page: "home" },
    }, "session_in_progress");
    expect(res.reason).not.toBe("opted_out");
  });

  test("the route passes an eventType without its own push_ prefix", () => {
    const src = require("../helpers/source").code("src/routes/sessions.js");
    const fn = src.slice(src.indexOf("async function notifyFamilyOfBreak"), src.indexOf("router.post(\"/:id/break/start\""));
    expect(fn).toMatch(/\},\s*"session_in_progress"\)/);
    expect(fn).not.toMatch(/"push_[a-z_]+"\)/);
  });
});
