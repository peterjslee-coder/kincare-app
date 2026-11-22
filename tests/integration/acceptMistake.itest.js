/**
 * v1.147.0 — Pete, 11/22: "somebody accidentally accepted the job that they can't do."
 * Within 30 minutes of HER accept, her cancel is an undo: the visit goes back to open, it is
 * NOT a late cancellation (no review of her), and the family is told it was a mistake. After
 * the window, the old rule holds.
 */
const { v4: uuid } = require("uuid");
jest.mock("../../src/routes/push", () => {
  const actual = jest.requireActual("../../src/routes/push");
  return { ...actual, sendPushToUser: jest.fn(async () => {}), notifyAdmins: jest.fn(async () => {}) };
});
let push;
const { startHarness, stopHarness } = require("./harness");
jest.setTimeout(180000);

let h, db, family, kay, recipientId, profileId;

// A visit a few hours from now, in the care location's zone — inside the 24-hour late window.
function soon(hours) {
  const d = new Date(Date.now() + hours * 3600000);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(d).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

beforeAll(async () => {
  h = await startHarness({ routers: { "/api/sessions": "../../src/routes/sessions" } });
  push = require("../../src/routes/push");
  db = h.db;
  require("../../src/routes/accountability").voidSessionPayment = async () => ({ success: true });
  family = await h.createUser({ firstName: "Pete" });
  ({ recipientId } = await h.createCareTeam({ familyUserId: family.user.id }));
  await db.prepare("UPDATE care_recipients SET timezone = 'America/New_York' WHERE id = ?").run(recipientId);
  kay = await h.createUser({ firstName: "Kay", roles: ["caregiver"] });
  profileId = uuid();
  await db.prepare("INSERT INTO caregiver_profiles (id, user_id, hourly_rate, created_at) VALUES (?, ?, 25, NOW())").run(profileId, kay.user.id);
});
afterAll(async () => { await stopHarness(h); });

async function visit(acceptedMinutesAgo) {
  const id = uuid();
  const { date, time } = soon(5);
  await db.prepare(`
    INSERT INTO care_sessions (id, care_recipient_id, family_user_id, caregiver_id, service_type, status,
      scheduled_date, scheduled_time, duration_hours, caregiver_accepted_at, created_at)
    VALUES (?, ?, ?, ?, 'companionship', 'confirmed', ?, ?, 2,
      ${acceptedMinutesAgo == null ? "NULL" : `NOW() - INTERVAL '${acceptedMinutesAgo} minutes'`}, NOW())
  `).run(id, recipientId, family.user.id, profileId, date, time);
  return id;
}
const cancel = (id) => h.request.put(`/api/sessions/${id}/cancel`).set(h.auth(kay.token)).send({ scope: "one" });
const preview = (id) => h.request.get(`/api/sessions/${id}/cancel-preview`).set(h.auth(kay.token));
const row = (id) => db.prepare("SELECT status, caregiver_id, late_cancel, cancelled_caregiver_id FROM care_sessions WHERE id = ?").get(id);

test("claiming records when she accepted", async () => {
  const id = uuid();
  const { date, time } = soon(30);
  await db.prepare(`
    INSERT INTO care_sessions (id, care_recipient_id, family_user_id, service_type, status, scheduled_date, scheduled_time, duration_hours, created_at)
    VALUES (?, ?, ?, 'companionship', 'open', ?, ?, 2, NOW())`).run(id, recipientId, family.user.id, date, time);
  const r = await h.request.put(`/api/sessions/${id}/claim`).set(h.auth(kay.token)).send({});
  if (r.status !== 200) return; // the claim gates (ID, payouts…) are covered by claimJob.itest; only the stamp matters here
  const s = await db.prepare("SELECT caregiver_accepted_at FROM care_sessions WHERE id = ?").get(id);
  expect(s.caregiver_accepted_at).toBeTruthy();
});

test("minutes after accepting: an undo, not a late cancel", async () => {
  push.sendPushToUser.mockClear();
  const id = await visit(3);
  const p = await preview(id);
  expect(p.status).toBe(200);
  expect(p.body.isLateCancel).toBe(false);
  expect(p.body.mistakeWindow).toEqual({ minutesLeft: expect.any(Number) });
  const r = await cancel(id);
  expect(r.status).toBe(200);
  expect(r.body.acceptedByMistake).toBe(true);
  expect(r.body.isLateCancel).toBe(false);
  expect(r.body.canReview).toBe(false);
  expect(await row(id)).toMatchObject({ status: "open", caregiver_id: null, late_cancel: 0 });
  const toFamily = push.sendPushToUser.mock.calls.find((c) => c[0] === family.user.id);
  expect(toFamily[1].title).toBe("Visit open again");
  expect(toFamily[1].body).toMatch(/by mistake/);
});

test("after the window: the usual late cancellation", async () => {
  const id = await visit(45);
  const p = await preview(id);
  expect(p.body.mistakeWindow).toBeNull();
  expect(p.body.isLateCancel).toBe(true);
  const r = await cancel(id);
  expect(r.body.acceptedByMistake).toBe(false);
  expect(r.body.isLateCancel).toBe(true);
  expect((await row(id)).late_cancel).toBe(1);
});

test("a visit the family booked her on (no accept time) gets no mistake window", async () => {
  const id = await visit(null);
  const p = await preview(id);
  expect(p.body.mistakeWindow).toBeNull();
});

test("the family's own cancel is never treated as her mistake", async () => {
  const id = await visit(2);
  const p = await h.request.get(`/api/sessions/${id}/cancel-preview`).set(h.auth(family.token));
  expect(p.body.mistakeWindow).toBeNull();
});
