/**
 * v1.128.0 — a late check-in asks the family; it no longer cancels the visit on its own.
 *
 * Nov 14, Tina and Betty. Tina had accepted 8:00 by mistake. At ~8:15 Pete asked to move it to
 * 9:00 and Tina accepted, but the request had been born expired (its deadline was the ORIGINAL
 * start, already past), the sweeper cleared it, the visit stayed at 8:00, and the no-show
 * poller cancelled it at 8:30 and voided the hold while she was on her way.
 *
 * Pete, 11/15: a flexible visit is "plus or minus 30 minutes"; after that, ask — extend,
 * message, or cancel — and if nobody answers, "keep waiting, cancel at end".
 */
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "sk_test_integration_fake";

jest.mock("stripe", () => jest.fn(() => ({
  paymentIntents: {
    create: jest.fn(async (args) => ({ id: `pi_lc_${Math.random().toString(36).slice(2, 8)}`, status: "requires_capture", amount: args.amount })),
    retrieve: jest.fn(async (id) => ({ id, status: "requires_capture" })),
    capture: jest.fn(), cancel: jest.fn(async (id) => ({ id, status: "canceled" })),
  },
  paymentMethods: { list: jest.fn(async () => ({ data: [] })) },
})));

const { v4: uuid } = require("uuid");
const { startHarness, stopHarness } = require("./harness");
const { getNowInZone } = require("../../src/utils/timezone");

jest.setTimeout(180000);

const TZ = "America/New_York";
let h, db, acct, attention, proposals;
const pushes = [];

beforeAll(async () => {
  const push = require("../../src/routes/push");
  push.sendPushToUser = async (userId, payload) => { pushes.push({ userId, type: payload?.data?.type, body: payload?.body }); return { sent: 1 }; };
  h = await startHarness({
    routers: {
      "/api/sessions": "../../src/routes/sessions",
      "/api/push": "../../src/routes/push",
    },
  });
  db = h.db;
  acct = require("../../src/routes/accountability");
  attention = require("../../src/utils/attention");
  proposals = require("../../src/utils/proposals");
});
afterAll(async () => { await stopHarness(h); });
beforeEach(() => { pushes.length = 0; });

/** Care-location wall clock `offsetMin` from now, as { date, time }. */
function wallClock(offsetMin) {
  const d = new Date(getNowInZone(TZ).getTime() + offsetMin * 60000);
  const p = (n) => String(n).padStart(2, "0");
  return { date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, time: `${p(d.getHours())}:${p(d.getMinutes())}` };
}

/** A confirmed visit that started `minutesAgo` minutes ago. Pete booked it; Tina is the caregiver. */
async function startedVisit({ minutesAgo, flex = "flexible", hours = 8 }) {
  const pete = await h.createUser({ firstName: "Pete", lastName: "Fam" });
  const { recipientId } = await h.createCareTeam({ familyUserId: pete.user.id });
  await db.prepare("UPDATE care_recipients SET timezone = ?, first_name = 'Betty' WHERE id = ?").run(TZ, recipientId);
  const cg = await h.createUser({ roles: ["caregiver"], firstName: "Tina" });
  const profileId = uuid();
  await db.prepare(`
    INSERT INTO caregiver_profiles (id, user_id, hourly_rate, rate_daytime, is_background_checked, identity_verified, created_at)
    VALUES (?, ?, 22, 22, 1, 1, NOW())
  `).run(profileId, cg.user.id);
  const at = wallClock(-minutesAgo);
  const sid = uuid();
  await db.prepare(`
    INSERT INTO care_sessions (id, care_recipient_id, family_user_id, caregiver_id, service_type, status,
      scheduled_date, scheduled_time, duration_hours, proposed_rate, estimated_cost, flex_timing, created_at)
    VALUES (?, ?, ?, ?, 'companionship', 'confirmed', ?, ?, ?, 22, ?, ?, NOW())
  `).run(sid, recipientId, pete.user.id, profileId, at.date, at.time, hours, 22 * hours, flex);
  return { sid, pete, cg };
}

const row = (sid) => db.prepare("SELECT * FROM care_sessions WHERE id = ?").get(sid);
const overdueItems = async (userId) => (await attention.attentionItemsFor(db, userId)).items.filter((i) => i.kind === "checkinOverdue");

describe("inside a flexible visit's ±30 minutes, nobody is bothered", () => {
  test("20 minutes past start: not cancelled, not asked", async () => {
    const v = await startedVisit({ minutesAgo: 20 });
    await acct.pollCaregiverNoShows();
    expect((await row(v.sid)).status).toBe("confirmed");
    expect(await overdueItems(v.pete.user.id)).toHaveLength(0);
    const r = await h.request.get(`/api/sessions/${v.sid}/checkin-overdue`).set(h.auth(v.pete.token));
    expect(r.status).toBe(200);
    expect(r.body.state).toBe("within_window");
  });

  test("the family cannot no-show-cancel inside the window", async () => {
    const v = await startedVisit({ minutesAgo: 20 });
    const r = await h.request.post(`/api/sessions/${v.sid}/cancel-no-show`).set(h.auth(v.pete.token)).send({});
    expect(r.status).toBe(400);
    expect((await row(v.sid)).status).toBe("confirmed");
  });
});

describe("after the window, the family is asked and nothing is cancelled", () => {
  test("35 minutes past a flexible start: still confirmed, and Needs-you asks Pete", async () => {
    const v = await startedVisit({ minutesAgo: 35 });
    await acct.pollCaregiverNoShows();
    const s = await row(v.sid);
    expect(s.status).toBe("confirmed");
    expect(Number(s.caregiver_no_show)).toBe(0);
    expect(pushes.find((p) => p.type === "no_show_cancelled")).toBeUndefined();

    const items = await overdueItems(v.pete.user.id);
    expect(items).toHaveLength(1);
    expect(items[0].title).toMatch(/Tina hasn't checked in/);
    expect(items[0].focus).toBe(`checkinOverdue:${v.sid}`);

    const r = await h.request.get(`/api/sessions/${v.sid}/checkin-overdue`).set(h.auth(v.pete.token));
    expect(r.body.state).toBe("waiting");
    expect(r.body.extendChoices).toEqual([15, 30, 60]);
    expect(r.body.caregiverUserId).toBe(v.cg.user.id);
  });

  test("a strict visit is asked about after 10 minutes", async () => {
    const v = await startedVisit({ minutesAgo: 12, flex: "strict" });
    expect(await overdueItems(v.pete.user.id)).toHaveLength(1);
  });

  test("someone outside the visit cannot see or act on it", async () => {
    const v = await startedVisit({ minutesAgo: 35 });
    const stranger = await h.createUser({ firstName: "Nosy" });
    expect((await h.request.get(`/api/sessions/${v.sid}/checkin-overdue`).set(h.auth(stranger.token))).status).toBe(403);
    expect((await h.request.post(`/api/sessions/${v.sid}/extend-checkin`).set(h.auth(stranger.token)).send({ minutes: 15 })).status).toBe(403);
    expect((await h.request.post(`/api/sessions/${v.sid}/cancel-no-show`).set(h.auth(stranger.token)).send({})).status).toBe(403);
  });
});

describe("give her more time", () => {
  test("+30 moves the deadline, tells Tina, and takes the item off Needs-you", async () => {
    const v = await startedVisit({ minutesAgo: 35 });
    const r = await h.request.post(`/api/sessions/${v.sid}/extend-checkin`).set(h.auth(v.pete.token)).send({ minutes: 30 });
    expect(r.status).toBe(200);
    expect(r.body.state).toBe("within_window");
    expect(Number((await row(v.sid)).checkin_window_minutes)).toBeGreaterThanOrEqual(65);
    const told = pushes.find((p) => p.userId === v.cg.user.id && p.type === "checkin_extended");
    expect(told).toBeDefined();
    expect(told.body).toMatch(/gave you until/);
    expect(await overdueItems(v.pete.user.id)).toHaveLength(0);
  });

  test("only 15 / 30 / 60", async () => {
    const v = await startedVisit({ minutesAgo: 35 });
    const r = await h.request.post(`/api/sessions/${v.sid}/extend-checkin`).set(h.auth(v.pete.token)).send({ minutes: 600 });
    expect(r.status).toBe(400);
  });

  test("never past the visit's end", async () => {
    const v = await startedVisit({ minutesAgo: 35, hours: 1 });
    const r = await h.request.post(`/api/sessions/${v.sid}/extend-checkin`).set(h.auth(v.pete.token)).send({ minutes: 60 });
    expect(r.status).toBe(200);
    expect(Number((await row(v.sid)).checkin_window_minutes)).toBe(60);
  });
});

describe("cancel", () => {
  test("the family's cancel is a no-charge no-show, and Pete is not pushed about his own choice", async () => {
    const v = await startedVisit({ minutesAgo: 35 });
    const r = await h.request.post(`/api/sessions/${v.sid}/cancel-no-show`).set(h.auth(v.pete.token)).send({});
    expect(r.status).toBe(200);
    const s = await row(v.sid);
    expect(s.status).toBe("cancelled");
    expect(s.cancelled_by).toBe("family");
    expect(Number(s.caregiver_no_show)).toBe(1);
    expect(pushes.find((p) => p.userId === v.pete.user.id && p.type === "caregiver_no_show")).toBeUndefined();
    expect(pushes.find((p) => p.userId === v.cg.user.id && p.type === "no_show_cancelled")).toBeDefined();
  });

  test("nobody answers: the poller cancels only once the scheduled end has passed", async () => {
    const v = await startedVisit({ minutesAgo: 40, hours: 0.5 });
    await acct.pollCaregiverNoShows();
    const s = await row(v.sid);
    expect(s.status).toBe("cancelled");
    expect(s.cancelled_by).toBe("system");
  });
});

describe("Tina's Saturday: a time change asked for after the start", () => {
  test("the request is still answerable, and once accepted the visit is not cancelled", async () => {
    // Booked for "8:00", now 8:15; Pete asks for "9:00" (45 minutes from now).
    const v = await startedVisit({ minutesAgo: 15, hours: 8 });
    const nine = wallClock(45);
    const p = await h.request.post(`/api/sessions/${v.sid}/propose-time-change`).set(h.auth(v.pete.token))
      .send({ proposedTime: nine.time, proposedDuration: 7 });
    expect(p.status).toBe(200);
    const proposalId = p.body.proposal.id;

    // The sweep that used to kill it on the spot.
    await proposals.expireStaleProposals(db, null, null);
    const tcp = await db.prepare("SELECT status, expires_at FROM time_change_proposals WHERE id = ?").get(proposalId);
    expect(tcp.status).toBe("pending");
    expect(new Date(tcp.expires_at).getTime()).toBeGreaterThan(Date.now() + 30 * 60000);

    // While it waits for Tina, the no-show poller leaves the visit alone even past the window.
    await db.prepare("UPDATE care_sessions SET scheduled_time = ? WHERE id = ?").run(wallClock(-35).time, v.sid);
    await acct.pollCaregiverNoShows();
    expect((await row(v.sid)).status).toBe("confirmed");
    expect(await overdueItems(v.pete.user.id)).toHaveLength(0);

    const a = await h.request.put(`/api/sessions/${v.sid}/time-change/${proposalId}/respond`).set(h.auth(v.cg.token))
      .send({ action: "accept" });
    expect(a.status).toBe(200);
    const s = await row(v.sid);
    expect(s.scheduled_time).toBe(nine.time);
    await acct.pollCaregiverNoShows();
    expect((await row(v.sid)).status).toBe("confirmed");
  });
});
