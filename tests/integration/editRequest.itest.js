/**
 * v1.129.2 — Edit request.
 *
 * Pete, 11/17: "I want to be able to edit the details of the appointment after I've sent it. Say
 * i want to change it from companionship to personal care. Or adjust the time request. Or make it
 * repeating. Or offer it only to Tina. Or anyone. Or request an interview."
 *
 * GET /:id/edit-draft fills the booking form; POST / with `replaces` creates the edited request
 * and retires the original (only the visits nobody has taken), withdrawing offers on it.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || "edit-request-secret";
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "sk_test_edit_fake";

jest.mock("stripe", () => jest.fn(() => ({
  paymentMethods: { list: jest.fn(async ({ type }) => ({
    data: type === "card" ? [{ id: "pm_x", type: "card", card: { last4: "4242" } }] : [],
  })) },
  paymentIntents: { create: jest.fn(async () => ({ id: "pi_x", status: "requires_capture" })) },
})));

const mockPush = jest.fn(async () => ({ sent: 1 }));
jest.mock("../../src/routes/push", () => {
  const actual = jest.requireActual("../../src/routes/push");
  return { ...actual, sendPushToUser: (...a) => mockPush(...a) };
});

const { startHarness, stopHarness } = require("./harness");
const { v4: uuid } = require("uuid");

jest.setTimeout(180000);

let h, db, family, stranger, tina, tinaProfile, sam, samProfile, recipientId;

const soon = (d) => { const x = new Date(); x.setDate(x.getDate() + d); return x.toISOString().slice(0, 10); };

const book = (extra = {}) => h.request.post("/api/sessions").set(h.auth(family.token)).send({
  careRecipientId: recipientId, scheduledDate: soon(5), scheduledTime: "09:00", durationHours: 3,
  serviceType: "companionship", ...extra,
});
const row = (id) => db.prepare("SELECT * FROM care_sessions WHERE id = ?").get(id);

beforeAll(async () => {
  h = await startHarness({ routers: { "/api/sessions": "../../src/routes/sessions" } });
  db = h.db;
  family = await h.createUser({ firstName: "Pete", lastName: "ITest" });
  await db.prepare("UPDATE users SET stripe_customer_id = ? WHERE id = ?").run("cus_x", family.user.id);
  stranger = await h.createUser({ firstName: "Stranger", lastName: "ITest" });
  tina = await h.createUser({ roles: ["caregiver"], firstName: "Tina", lastName: "ITest" });
  tinaProfile = uuid();
  await db.prepare("INSERT INTO caregiver_profiles (id, user_id, hourly_rate, is_background_checked, care_stoplight, created_at) VALUES (?, ?, 25, 1, 'green', NOW())").run(tinaProfile, tina.user.id);
  sam = await h.createUser({ roles: ["caregiver"], firstName: "Sam", lastName: "ITest" });
  samProfile = uuid();
  await db.prepare("INSERT INTO caregiver_profiles (id, user_id, hourly_rate, is_background_checked, care_stoplight, created_at) VALUES (?, ?, 25, 1, 'green', NOW())").run(samProfile, sam.user.id);
  ({ recipientId } = await h.createCareTeam({ familyUserId: family.user.id }));
  await db.prepare("UPDATE care_recipients SET consent_status = 'verified' WHERE id = ?").run(recipientId);
});

afterAll(async () => { await stopHarness(h); });

test("edit-draft returns what the form needs", async () => {
  const r = await book({ status: "open", specialInstructions: "Bring a book" });
  expect(r.status).toBe(201);
  const id = r.body.id || (r.body.session && r.body.session.id);
  const d = await h.request.get(`/api/sessions/${id}/edit-draft`).set(h.auth(family.token));
  expect(d.status).toBe(200);
  expect(d.body).toMatchObject({ sessionId: id, careRecipientId: recipientId, serviceType: "companionship", time: "09:00", specialInstructions: "Bring a book", recurrence: null });
  expect(d.body.seriesIds).toEqual([id]);
  // A stranger can't see it.
  expect((await h.request.get(`/api/sessions/${id}/edit-draft`).set(h.auth(stranger.token))).status).toBe(404);
});

test("companionship → personal care, to Tina only: new request offered to her, original retired, Sam's offer withdrawn", async () => {
  const r = await book({ status: "open" });
  const oldId = r.body.id || r.body.session.id;
  const samOffer = uuid();
  await db.prepare(`INSERT INTO session_offers (id, session_id, from_user_id, to_user_id, offered_rate, status, expires_at, created_at)
    VALUES (?, ?, ?, ?, 25, 'pending', NOW() + INTERVAL '1 day', NOW())`).run(samOffer, oldId, sam.user.id, family.user.id);
  mockPush.mockClear();

  const res = await book({ serviceType: "personal_care", scheduledTime: "10:30", caregiverId: tinaProfile, directOffer: true, privateOnly: true,
    replaces: { sessionId: oldId, scope: "this" } });
  expect(res.status).toBe(201);
  const newId = res.body.id || res.body.session.id;
  expect(newId).not.toBe(oldId);
  const n = await row(newId);
  expect(n.service_type).toBe("personal_care");
  expect(n.scheduled_time).toBe("10:30");
  expect(n.offered_to_caregiver_id).toBe(tinaProfile);
  expect(Number(n.private_only)).toBe(1);
  const o = await row(oldId);
  expect(o.status).toBe("cancelled");
  expect(o.cancellation_reason).toBe("Replaced by an edited request");
  expect((await db.prepare("SELECT status FROM session_offers WHERE id = ?").get(samOffer)).status).toBe("withdrawn");
  expect(mockPush.mock.calls.some((c) => c[0] === sam.user.id)).toBe(true);
  expect(mockPush.mock.calls.some((c) => c[0] === tina.user.id)).toBe(true);
});

test("make it repeating: one visit becomes a weekly series, the original retired", async () => {
  const r = await book({ status: "open" });
  const oldId = r.body.id || r.body.session.id;
  const res = await book({ recurrenceRule: "weekly", recurrenceWeeks: 3, replaces: { sessionId: oldId, scope: "this" } });
  expect(res.status).toBe(201);
  expect((res.body.sessions || []).length).toBe(3);
  expect((await row(oldId)).status).toBe("cancelled");
});

test("series scope retires this and the later open visits; earlier and taken ones stay", async () => {
  const r = await book({ recurrenceRule: "weekly", recurrenceWeeks: 4, scheduledDate: soon(6) });
  expect(r.status).toBe(201);
  const ids = r.body.sessions.map((s) => s.id);
  // the last one is taken
  await db.prepare("UPDATE care_sessions SET caregiver_id = ?, status = 'confirmed' WHERE id = ?").run(samProfile, ids[3]);
  const res = await book({ scheduledDate: soon(13), recurrenceRule: "weekly", recurrenceWeeks: 2, scheduledTime: "11:00",
    replaces: { sessionId: ids[1], scope: "series" } });
  expect(res.status).toBe(201);
  expect((await row(ids[0])).status).not.toBe("cancelled");
  expect((await row(ids[1])).status).toBe("cancelled");
  expect((await row(ids[2])).status).toBe("cancelled");
  expect((await row(ids[3])).status).toBe("confirmed");
});

test("a visit someone already took can't be edited this way, and nothing new is created", async () => {
  const r = await book({ status: "open" });
  const id = r.body.id || r.body.session.id;
  await db.prepare("UPDATE care_sessions SET caregiver_id = ?, status = 'confirmed' WHERE id = ?").run(samProfile, id);
  const before = (await db.prepare("SELECT COUNT(*) AS n FROM care_sessions").get()).n;
  const res = await book({ replaces: { sessionId: id, scope: "this" } });
  expect(res.status).toBe(409);
  expect((await db.prepare("SELECT COUNT(*) AS n FROM care_sessions").get()).n).toBe(before);
  expect((await h.request.get(`/api/sessions/${id}/edit-draft`).set(h.auth(family.token))).status).toBe(409);
});

test("someone with no say over this person can't replace it", async () => {
  const r = await book({ status: "open" });
  const id = r.body.id || r.body.session.id;
  const res = await h.request.post("/api/sessions").set(h.auth(stranger.token)).send({
    careRecipientId: recipientId, scheduledDate: soon(5), scheduledTime: "09:00", durationHours: 3,
    serviceType: "companionship", replaces: { sessionId: id, scope: "this" } });
  expect([403, 404]).toContain(res.status);
  expect((await row(id)).status).not.toBe("cancelled");
});
