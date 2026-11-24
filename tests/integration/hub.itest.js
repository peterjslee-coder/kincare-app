/**
 * v1.152.0 — InPlace Hub: the Simple screen on a tablet on the kitchen counter.
 *
 * Pete, 11/23: "what day it is today, including the year. Upcoming birthdays. Upcoming visits.
 * upcoming appointments. It has to be simple...and it requires a new section in managing her
 * access to the app." And faces: "'Tina' and a pic of her would be helpful to remind mom of
 * who's who."
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || "hub-secret";

jest.mock("../../src/routes/push", () => {
  const actual = jest.requireActual("../../src/routes/push");
  return { ...actual, sendPushToUser: async () => ({ sent: 0 }) };
});

const { startHarness, stopHarness } = require("./harness");
const { v4: uuid } = require("uuid");

jest.setTimeout(180000);

let h, db, leader, sister, mom, recipientId, teamId, tina, tinaProfile;

const soon = (d) => {
  const today = require("../../src/utils/timezone").getTodayStringInZone("America/New_York");
  const x = new Date(`${today}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10);
};

beforeAll(async () => {
  h = await startHarness({ routers: {
    "/api/care-recipients": "../../src/routes/careRecipients",
    "/api/dashboard": "../../src/routes/dashboard",
  } });
  db = h.db;
  leader = await h.createUser({ firstName: "Pete", lastName: "ITest" });
  sister = await h.createUser({ firstName: "Sara", lastName: "ITest" });
  ({ recipientId, teamId } = await h.createCareTeam({ familyUserId: leader.user.id }));
  await h.addTeamMember(teamId, sister.user.id);
  await db.prepare("UPDATE care_team_members SET relationship_label = 'Daughter' WHERE care_team_id = ? AND user_id = ?").run(teamId, sister.user.id);

  const r = await h.request.post(`/api/care-recipients/${recipientId}/own-login`).set(h.auth(leader.token))
    .send({ email: "mom-hub@itest.local", password: "Kitchen#2026" });
  expect(r.status).toBe(201);
  const { generateToken } = require("../../src/middleware/auth");
  await h.verifyIdentity(r.body.userId);
  mom = { user: { id: r.body.userId }, token: generateToken({ id: r.body.userId, email: "mom-hub@itest.local", roles: ["care_for"], role: "care_for" }) };

  tina = await h.createUser({ roles: ["caregiver"], firstName: "Tina", lastName: "ITest" });
  tinaProfile = uuid();
  await db.prepare("INSERT INTO caregiver_profiles (id, user_id, hourly_rate, created_at) VALUES (?, ?, 25, NOW())").run(tinaProfile, tina.user.id);
  const visit = (date, time, status, hours = 2) => db.prepare(`INSERT INTO care_sessions (id, care_recipient_id, family_user_id, caregiver_id, scheduled_date, scheduled_time, duration_hours, service_type, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'companionship', ?, NOW())`).run(uuid(), recipientId, leader.user.id, tinaProfile, date, time, hours, status);
  await visit(soon(0), "10:00", "in_progress", 5);
  await visit(soon(3), "10:00", "confirmed");
  await visit(soon(10), "10:00", "confirmed");
  await db.prepare(`INSERT INTO care_events (id, care_recipient_id, created_by, title, event_date, event_time, starts_at)
    VALUES (?, ?, ?, 'Thanksgiving at Peter''s', ?, '13:00', NOW() + INTERVAL '4 days')`).run(uuid(), recipientId, leader.user.id, soon(4));
  await db.prepare(`INSERT INTO care_events (id, care_recipient_id, created_by, title, event_date, event_time, starts_at)
    VALUES (?, ?, ?, 'Too far out', ?, '13:00', NOW() + INTERVAL '9 days')`).run(uuid(), recipientId, leader.user.id, soon(9));

  const put = await h.request.put(`/api/care-recipients/${recipientId}/simple-mode`).set(h.auth(leader.token))
    .send({ on: true, callUserIds: [], show: { comingUp: true } });
  expect(put.status).toBe(200);
});

afterAll(async () => { await stopHarness(h); });

test("the Hub is off until the leader turns it on, and nothing of it is sent", async () => {
  const g = await h.request.get(`/api/care-recipients/${recipientId}/simple-mode`).set(h.auth(leader.token));
  expect(g.body.hub).toMatchObject({ on: false, faces: true, week: true, dimFrom: "21:00", dimTo: "07:00" });
  const d = await h.request.get("/api/dashboard").set(h.auth(mom.token));
  expect(d.body.simpleScreen.on).toBe(true);
  expect(d.body.simpleScreen.hub).toBeNull();
});

test("only the leader changes it, and bad hours are ignored", async () => {
  const no = await h.request.put(`/api/care-recipients/${recipientId}/simple-mode`).set(h.auth(sister.token))
    .send({ on: true, callUserIds: [], hub: { on: true } });
  expect(no.status).toBe(403);
  const ok = await h.request.put(`/api/care-recipients/${recipientId}/simple-mode`).set(h.auth(leader.token))
    .send({ on: true, callUserIds: [], hub: { on: true, dimFrom: "25:99", dimTo: "06:30", extra: "x" } });
  expect(ok.status).toBe(200);
  expect(ok.body.hub).toEqual({ on: true, faces: true, week: true, photos: true, dimFrom: "21:00", dimTo: "06:30", callUserIds: [] });
});

test("a later Simple-screen save keeps the Hub settings", async () => {
  const r = await h.request.put(`/api/care-recipients/${recipientId}/simple-mode`).set(h.auth(leader.token))
    .send({ on: true, callUserIds: [], show: { tellFamily: true } });
  expect(r.status).toBe(200);
  expect(r.body.hub).toMatchObject({ on: true, dimTo: "06:30" });
});

test("her dashboard carries who is here, seven days, and faces with names", async () => {
  const d = await h.request.get("/api/dashboard").set(h.auth(mom.token));
  const hub = d.body.simpleScreen.hub;
  expect(hub.on).toBe(true);
  expect(hub.here).toMatchObject({ firstName: "Tina", until: "15:00" });
  // Seven days: the visit in 3 days and Thanksgiving in 4 are in; 9 and 10 days out are not.
  const titles = hub.days.map((x) => x.title || x.who);
  expect(titles).toContain("Thanksgiving at Peter's");
  expect(titles).not.toContain("Too far out");
  expect(hub.days.filter((x) => x.kind === "visit").map((x) => x.date)).toEqual([soon(0), soon(3)]);
  // Faces (v1.153.1): only caregivers coming this week — Tina, labelled with her days. No family.
  expect(hub.people).toHaveLength(1);
  expect(hub.people[0]).toMatchObject({ firstName: "Tina", today: true, label: "Today" });
  expect(hub.people.map((p) => p.firstName)).not.toContain("Pete");
  expect(hub.people.map((p) => p.userId)).not.toContain(mom.user.id);
  // The phone list stays today and tomorrow.
  expect(d.body.simpleScreen.comingUp.every((c) => c.date <= soon(1))).toBe(true);
});

test("a caregiver whose only visits are past or more than a week out is not on Who's who", async () => {
  const ryan = await h.createUser({ roles: ["caregiver"], firstName: "Ryan", lastName: "ITest" });
  const prof = uuid();
  await db.prepare("INSERT INTO caregiver_profiles (id, user_id, hourly_rate, created_at) VALUES (?, ?, 25, NOW())").run(prof, ryan.user.id);
  for (const [d, st] of [[soon(-5), "completed"], [soon(9), "confirmed"]]) {
    await db.prepare(`INSERT INTO care_sessions (id, care_recipient_id, family_user_id, caregiver_id, scheduled_date, scheduled_time, duration_hours, service_type, status, created_at)
      VALUES (?, ?, ?, ?, ?, '09:00', 2, 'companionship', ?, NOW())`).run(uuid(), recipientId, leader.user.id, prof, d, st);
  }
  const d = await h.request.get("/api/dashboard").set(h.auth(mom.token));
  expect(d.body.simpleScreen.hub.people.map((p) => p.firstName)).not.toContain("Ryan");
});

test("week off: the Hub shows today and tomorrow; faces off: no faces", async () => {
  await h.request.put(`/api/care-recipients/${recipientId}/simple-mode`).set(h.auth(leader.token))
    .send({ on: true, callUserIds: [], hub: { week: false, faces: false } });
  const d = await h.request.get("/api/dashboard").set(h.auth(mom.token));
  const hub = d.body.simpleScreen.hub;
  expect(hub.days.every((x) => x.date <= soon(1))).toBe(true);
  expect(hub.people).toEqual([]);
});

test("v1.155.1: the Hub's own Call buttons, care team only, with a photo", async () => {
  const put = await h.request.put(`/api/care-recipients/${recipientId}/simple-mode`).set(h.auth(leader.token))
    .send({ on: true, callUserIds: [], hub: { on: true, callUserIds: [sister.user.id, tina.user.id] } });
  expect(put.status).toBe(200);
  expect(put.body.hub.callUserIds).toEqual([sister.user.id, tina.user.id]);
  const d = await h.request.get("/api/dashboard").set(h.auth(mom.token));
  const calls = d.body.simpleScreen.hub.calls;
  // Tina is a caregiver, not on the care team: she is not offered as a Call button.
  expect(calls.map((c) => c.firstName)).toEqual(["Sara"]);
  expect(calls[0]).toHaveProperty("photo");
  // The phone's own Call buttons are untouched.
  expect(d.body.simpleScreen.callContacts).toEqual([]);
});
