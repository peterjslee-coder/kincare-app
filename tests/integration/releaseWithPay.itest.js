/**
 * "Go home, you're paid for the day." (v1.106.47)
 *
 * Pete: "Sara arrives with Betty on Friday. When she gets there, she would like to let Tina
 * take the rest of the day off with pay. Right now there's no ability for Tina to check out
 * without her pay being [cut]. Care team should be able to end session that would send Tina a
 * message, letting her know she can leave with pay."
 *
 * This route spends money on hours nobody worked, so it is tested in both directions
 * throughout: what it pays AND what it refuses. Pete's two decisions are the two things most
 * worth pinning — booking access is the gate, and a release pays the full booking with no
 * deductions of any kind, break time included.
 *
 * Stripe is mocked at the module level. Dev Rule #7 — the keys in production are live.
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

// Today in the care location's zone. These visits used to carry a hard-coded date, and every
// suite that reads "today's" sessions went red at midnight on the day after it was written.
const TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());

jest.setTimeout(180000);

const ROUTERS = { "/api/sessions": "../../src/routes/sessions" };

let h, db, pete, sara, viewer, tina, tinaProfileId, recipientId, teamId;

beforeAll(async () => {
  h = await startHarness({ routers: ROUTERS });
  db = h.db;
  pete = await h.createUser({ roles: ["family"], firstName: "Pete" });
  const t = await h.createCareTeam({ familyUserId: pete.user.id });
  recipientId = t.recipientId;
  teamId = t.teamId;

  tina = await h.createUser({ roles: ["caregiver"], firstName: "Tina" });
  tinaProfileId = uuid();
  await db.prepare(
    "INSERT INTO caregiver_profiles (id, user_id, hourly_rate, created_at) VALUES (?, ?, 25, NOW())"
  ).run(tinaProfileId, tina.user.id);

  // Sara: on the care team AND holding an 'edit' share — Pete's answer, "care-team members
  // with edit rights". `edit` maps to every capability, BOOK_CARE included.
  sara = await h.createUser({ roles: ["family"], firstName: "Sara" });
  await h.addTeamMember(teamId, sara.user.id, "member");
  await db.prepare(`
    INSERT INTO care_recipient_shares (id, care_recipient_id, shared_with_user_id, permission, shared_by_user_id, created_at)
    VALUES (?, ?, ?, 'edit', ?, NOW())
  `).run(uuid(), recipientId, sara.user.id, pete.user.id);

  // A relative who can read the care plan and nothing more.
  viewer = await h.createUser({ roles: ["family"], firstName: "Viewer" });
  await h.addTeamMember(teamId, viewer.user.id, "member");
  await db.prepare(`
    INSERT INTO care_recipient_shares (id, care_recipient_id, shared_with_user_id, permission, shared_by_user_id, created_at)
    VALUES (?, ?, ?, 'view', ?, NOW())
  `).run(uuid(), recipientId, viewer.user.id, pete.user.id);
});

afterAll(async () => { await stopHarness(h); });
beforeEach(() => { mockCaptured.length = 0; });

/** An 8-hour visit at $211.20, checked in `agoMinutes` ago. */
async function activeVisit({ hours = 8, cost = 211.2, agoMinutes = 300, status = "in_progress" } = {}) {
  const id = uuid();
  // Authorized, the way a real confirmed visit is: captureSessionPayment refuses outright
  // without a payment intent, so without this the money assertions below would pass by
  // never reaching Stripe at all.
  await db.prepare(`
    INSERT INTO care_sessions (id, care_recipient_id, family_user_id, caregiver_id, service_type,
                               status, scheduled_date, scheduled_time, duration_hours, estimated_cost, flex_timing,
                               stripe_payment_intent_id, authorized_amount, payment_status, created_at)
    VALUES (?, ?, ?, ?, 'companionship', ?, '${TODAY}', '09:00', ?, ?, 'strict', ?, ?, 'authorized', NOW())
  `).run(id, recipientId, pete.user.id, tinaProfileId, status, hours, cost,
         `pi_${uuid().slice(0, 8)}`, Math.round(cost * 100));
  if (status === "in_progress") {
    await db.prepare(`
      INSERT INTO visit_logs (id, session_id, caregiver_id, check_in_time, created_at)
      VALUES (?, ?, ?, NOW() - (? || ' minutes')::interval, NOW())
    `).run(uuid(), id, tinaProfileId, String(agoMinutes));
  }
  return id;
}

const release = (id, who, body = {}) =>
  h.request.post(`/api/sessions/${id}/release`).set(h.auth(who.token)).send(body);

const row = (id) => db.prepare(
  "SELECT status, duration_hours, estimated_cost, released_by_user_id, released_at, release_reason, overtime_minutes FROM care_sessions WHERE id = ?"
).get(id);

describe("Sara, standing in the kitchen", () => {
  test("she can release Tina", async () => {
    const id = await activeVisit();
    const res = await release(id, sara, { reason: "I'm here for the rest of the day" });
    expect(res.status).toBe(200);
    expect(res.body.released).toBe(true);
    expect(res.body.paid).toBeCloseTo(211.2, 2);
  });

  test("the visit is completed and says who decided it", async () => {
    const id = await activeVisit();
    await release(id, sara, { reason: "Taking over" });
    const r = await row(id);
    expect(r.status).toBe("completed");
    expect(r.released_by_user_id).toBe(sara.user.id);
    expect(r.released_at).not.toBeNull();
    expect(r.release_reason).toBe("Taking over");
  });

  test("the full booking is paid — five hours in on an eight-hour day", async () => {
    const id = await activeVisit({ agoMinutes: 300 });
    await release(id, sara);
    const r = await row(id);
    expect(Number(r.estimated_cost)).toBeCloseTo(211.2, 2);
    expect(Number(r.duration_hours)).toBe(8);
  });

  test("Stripe is asked for the full amount, not the hours worked", async () => {
    const id = await activeVisit();
    await release(id, sara);
    // The one assertion that is about real money leaving a real card. captureSessionPayment
    // omits amount_to_capture when the amount equals the authorization — capturing the whole
    // hold IS the full booking, which is exactly what a release should do.
    expect(mockCaptured).toHaveLength(1);
    const amount = mockCaptured[0].args.amount_to_capture;
    expect(amount === undefined || amount === 21120).toBe(true);
  });

  test("...and a PARTIAL capture is what a released visit must never do", async () => {
    // The failure mode worth naming: if the release computed pay from the clock, this would
    // come through as amount_to_capture well below the authorization.
    const id = await activeVisit({ agoMinutes: 60 });
    await release(id, sara);
    const amount = mockCaptured[0].args.amount_to_capture;
    if (amount !== undefined) expect(amount).toBe(21120);
  });

  test("no early-departure penalty is written to her record", async () => {
    // Writing one would dock her in every report that reads those fields. She did not leave
    // early; she was sent home.
    const id = await activeVisit({ agoMinutes: 120 });
    await release(id, sara);
    const vl = await db.prepare(
      "SELECT check_out_time, early_departure_reason, early_departure_minutes FROM visit_logs WHERE session_id = ?"
    ).get(id);
    expect(vl.check_out_time).not.toBeNull();
    expect(vl.early_departure_reason).toBeNull();
    expect(vl.early_departure_minutes == null || Number(vl.early_departure_minutes) === 0).toBe(true);
  });

  test("a reason is optional", async () => {
    const id = await activeVisit();
    expect((await release(id, sara)).status).toBe(200);
    expect((await row(id)).release_reason).toBeNull();
  });
});

describe("the break rule is not applied — Pete: full day, no deductions at all", () => {
  test("a 45-minute lunch does not come off a released visit", async () => {
    const id = await activeVisit({ agoMinutes: 300 });
    await db.prepare(`
      INSERT INTO visit_breaks (id, session_id, caregiver_user_id, started_at, ended_at, created_at)
      VALUES (?, ?, ?, NOW() - INTERVAL '200 minutes', NOW() - INTERVAL '155 minutes', NOW())
    `).run(uuid(), id, tina.user.id);
    await release(id, sara);
    const r = await row(id);
    // 45 away, 30 free, 15 unpaid — which a check-out would have deducted. Not here.
    expect(Number(r.estimated_cost)).toBeCloseTo(211.2, 2);
    expect(Number(r.duration_hours)).toBe(8);
  });

  test("the break is still on the record — the family can see she stepped out", async () => {
    const id = await activeVisit();
    await db.prepare(`
      INSERT INTO visit_breaks (id, session_id, caregiver_user_id, started_at, ended_at, created_at)
      VALUES (?, ?, ?, NOW() - INTERVAL '90 minutes', NOW() - INTERVAL '60 minutes', NOW())
    `).run(uuid(), id, tina.user.id);
    await release(id, sara);
    const n = await db.prepare("SELECT COUNT(*)::int AS n FROM visit_breaks WHERE session_id = ?").get(id);
    expect(n.n).toBe(1);
  });

  test("an open break is closed so nothing is left running", async () => {
    const id = await activeVisit();
    await db.prepare(`
      INSERT INTO visit_breaks (id, session_id, caregiver_user_id, started_at, created_at)
      VALUES (?, ?, ?, NOW() - INTERVAL '20 minutes', NOW())
    `).run(uuid(), id, tina.user.id);
    await release(id, sara);
    const b = await db.prepare("SELECT ended_at, ended_by FROM visit_breaks WHERE session_id = ?").get(id);
    expect(b.ended_at).not.toBeNull();
    expect(b.ended_by).toBe("released");
  });
});

describe("who cannot do it", () => {
  test("a view-only relative is refused, and told what to ask for", async () => {
    const id = await activeVisit();
    const res = await release(id, viewer);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/booking access/i);
    expect((await row(id)).status).toBe("in_progress");
    expect(mockCaptured).toHaveLength(0);
  });

  test("an ordinary caregiver is refused, and told something TRUE about why", async () => {
    // Which is what the check order buys. Refused by the capability gate instead, Tina would
    // read "ask the care team leader to give you booking access" — advice that could never
    // help her, because no amount of booking access lets a caregiver release herself.
    const id = await activeVisit({ agoMinutes: 60 });
    const res = await release(id, tina);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/can't release herself/i);
    expect(res.body.error).not.toMatch(/booking access/i);
    expect((await row(id)).status).toBe("in_progress");
    expect(mockCaptured).toHaveLength(0);
  });

  test("a caregiver who DOES have booking access still cannot release herself", async () => {
    // The Julia shape: on Betty's care team and a caregiver on the same record. With an 'edit'
    // share she holds BOOK_CARE, so the capability gate lets her through and only the
    // self-release guard stops her sending herself home on full pay from the kitchen.
    //
    // The first version of this test used Tina, who has no booking access — so she was refused
    // by the wrong gate and the test proved nothing about this guard at all.
    const julia = await h.createUser({ roles: ["caregiver", "family"], firstName: "Julia" });
    const juliaProfile = uuid();
    await db.prepare(
      "INSERT INTO caregiver_profiles (id, user_id, hourly_rate, created_at) VALUES (?, ?, 30, NOW())"
    ).run(juliaProfile, julia.user.id);
    await h.addTeamMember(teamId, julia.user.id, "member");
    await db.prepare(`
      INSERT INTO care_recipient_shares (id, care_recipient_id, shared_with_user_id, permission, shared_by_user_id, created_at)
      VALUES (?, ?, ?, 'edit', ?, NOW())
    `).run(uuid(), recipientId, julia.user.id, pete.user.id);

    // Confirm the premise rather than assume it: she really does hold booking access.
    const { recipientCapabilities } = require("../../src/utils/access");
    const { can, CAP } = require("../../src/utils/capabilities");
    const caps = await recipientCapabilities(db, recipientId, julia.user.id);
    expect(can(caps, CAP.BOOK_CARE)).toBe(true);

    const id = uuid();
    await db.prepare(`
      INSERT INTO care_sessions (id, care_recipient_id, family_user_id, caregiver_id, service_type,
                                 status, scheduled_date, scheduled_time, duration_hours, estimated_cost,
                                 stripe_payment_intent_id, authorized_amount, payment_status, created_at)
      VALUES (?, ?, ?, ?, 'companionship', 'in_progress', '${TODAY}', '09:00', 8, 240, ?, 24000, 'authorized', NOW())
    `).run(id, recipientId, pete.user.id, juliaProfile, `pi_${uuid().slice(0, 8)}`);
    await db.prepare(`
      INSERT INTO visit_logs (id, session_id, caregiver_id, check_in_time, created_at)
      VALUES (?, ?, ?, NOW() - INTERVAL '60 minutes', NOW())
    `).run(uuid(), id, juliaProfile);

    const res = await release(id, julia);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/can't release herself/i);
    expect((await row(id)).status).toBe("in_progress");
    expect(mockCaptured).toHaveLength(0);
  });

  test("a stranger with no access at all gets 403, not 500", async () => {
    const outsider = await h.createUser({ roles: ["family"], firstName: "Nobody" });
    const id = await activeVisit();
    expect((await release(id, outsider)).status).toBe(403);
  });

  test("the owner can, of course", async () => {
    const id = await activeVisit();
    expect((await release(id, pete)).status).toBe(200);
  });
});

describe("when there is nothing to release", () => {
  test("a visit that has not started yet", async () => {
    const id = await activeVisit({ status: "confirmed" });
    const res = await release(id, sara);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/isn't in progress/i);
    expect(mockCaptured).toHaveLength(0);
  });

  test("a visit that already ended says so plainly", async () => {
    const id = await activeVisit({ status: "completed" });
    const res = await release(id, sara);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already ended/i);
  });

  test("releasing twice pays once", async () => {
    // The UPDATE is conditional on status = 'in_progress', so the second attempt finds nothing
    // to change — and must not reach Stripe again.
    const id = await activeVisit();
    expect((await release(id, sara)).status).toBe(200);
    expect(mockCaptured).toHaveLength(1);
    mockCaptured.length = 0;
    expect((await release(id, sara)).status).toBe(400);
    expect(mockCaptured).toHaveLength(0);
  });

  test("a session that does not exist is 404", async () => {
    expect((await release(uuid(), sara)).status).toBe(404);
  });
});

describe("what Tina is told, and what the family sees", () => {
  test("the push says she is paid, and carries no health detail", async () => {
    const id = await activeVisit();
    await release(id, sara, { reason: "Betty had a rough night and I want quiet" });
    // The reason is the family's note to itself and may say anything at all; it must not ride
    // to a lock screen. tests/pushPhi.test.js is the standing gate on this class.
    const feed = await db.prepare(
      "SELECT title, message, metadata FROM activity_feed WHERE event_type = 'session_released' ORDER BY created_at DESC LIMIT 1"
    ).get();
    expect(feed).toBeTruthy();
    expect(`${feed.title} ${feed.message}`).not.toMatch(/rough night/i);
    expect(feed.message).toMatch(/full booking is still being paid/i);
    const meta = typeof feed.metadata === "string" ? JSON.parse(feed.metadata) : feed.metadata;
    expect(meta.releasedBy).toBe(sara.user.id);
  });

  test("the reply tells the caller what was paid", async () => {
    const id = await activeVisit();
    const res = await release(id, sara);
    expect(res.body.paid).toBeCloseTo(211.2, 2);
    expect(res.body.caregiverNotified).toBe(true);
  });
});
