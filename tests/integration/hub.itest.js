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
  expect(ok.body.hub).toEqual({ on: true, faces: true, week: true, photos: true, dimFrom: "21:00", dimTo: "06:30", callUserIds: [], photoAspect: null, dropInUserIds: [], noticeAwake: false, kiosk: true });
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

test("v1.155.2: 'Faith will be here soon' from 15 minutes before until she checks in", async () => {
  const tz = (await db.prepare("SELECT timezone FROM care_recipients WHERE id = ?").get(recipientId)).timezone || "America/New_York";
  const now = require("../../src/utils/timezone").getNowInZone(tz);
  const mins = now.getHours() * 60 + now.getMinutes();
  if (mins + 30 >= 24 * 60) return; // too close to midnight to place a visit later today
  const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const faith = await h.createUser({ roles: ["caregiver"], firstName: "Faith", lastName: "ITest" });
  const prof = uuid();
  await db.prepare("INSERT INTO caregiver_profiles (id, user_id, hourly_rate, created_at) VALUES (?, ?, 25, NOW())").run(prof, faith.user.id);
  const today = soon(0);
  const later = uuid(), soonId = uuid();
  const add = (id, time) => db.prepare(`INSERT INTO care_sessions (id, care_recipient_id, family_user_id, caregiver_id, scheduled_date, scheduled_time, duration_hours, service_type, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 2, 'companionship', 'confirmed', NOW())`).run(id, recipientId, leader.user.id, prof, today, time);
  await add(later, hhmm(mins + 25)); // not yet: more than 15 minutes away
  let hub = (await h.request.get("/api/dashboard").set(h.auth(mom.token))).body.simpleScreen.hub;
  expect(hub.arriving).toBeNull();
  await add(soonId, hhmm(mins + 10));
  hub = (await h.request.get("/api/dashboard").set(h.auth(mom.token))).body.simpleScreen.hub;
  expect(hub.arriving).toMatchObject({ sessionId: soonId, firstName: "Faith", time: hhmm(mins + 10) });
  expect(hub.arriving).toHaveProperty("photo");
  await db.prepare("UPDATE care_sessions SET status = 'in_progress' WHERE id = ?").run(soonId);
  hub = (await h.request.get("/api/dashboard").set(h.auth(mom.token))).body.simpleScreen.hub;
  expect(hub.arriving).toBeNull();
  await db.prepare("DELETE FROM care_sessions WHERE id IN (?, ?)").run(later, soonId);
});

test("v1.155.3: the tablet reports its photo space's shape; only her own account may", async () => {
  const no = await h.request.post(`/api/care-recipients/${recipientId}/simple-screen/hub-shape`).set(h.auth(leader.token)).send({ photoAspect: 0.86 });
  expect([403, 404]).toContain(no.status);
  const bad = await h.request.post(`/api/care-recipients/${recipientId}/simple-screen/hub-shape`).set(h.auth(mom.token)).send({ photoAspect: 9 });
  expect(bad.status).toBe(400);
  const ok = await h.request.post(`/api/care-recipients/${recipientId}/simple-screen/hub-shape`).set(h.auth(mom.token)).send({ photoAspect: 0.8612 });
  expect(ok.status).toBe(200);
  const g = await h.request.get(`/api/care-recipients/${recipientId}/simple-mode`).set(h.auth(leader.token));
  expect(g.body.hub.photoAspect).toBe(0.861);
  const d = await h.request.get("/api/dashboard").set(h.auth(leader.token));
  expect(d.body.hubRecipients.find((r) => r.id === recipientId).photoAspect).toBe(0.861);
  // a later settings change by the leader keeps it
  await h.request.put(`/api/care-recipients/${recipientId}/simple-mode`).set(h.auth(leader.token)).send({ on: true, callUserIds: [], hub: { faces: false } });
  const g2 = await h.request.get(`/api/care-recipients/${recipientId}/simple-mode`).set(h.auth(leader.token));
  expect(g2.body.hub.photoAspect).toBe(0.861);
});

test("v1.155.6: nobody here → the Hub names who comes next, with a face; someone here → no Next", async () => {
  let hub = (await h.request.get("/api/dashboard").set(h.auth(mom.token))).body.simpleScreen.hub;
  expect(hub.here).not.toBeNull();
  expect(hub.next).toBeNull();
  await db.prepare("UPDATE care_sessions SET status = 'completed' WHERE care_recipient_id = ? AND scheduled_date = ? AND status = 'in_progress'").run(recipientId, soon(0));
  try {
    hub = (await h.request.get("/api/dashboard").set(h.auth(mom.token))).body.simpleScreen.hub;
    expect(hub.here).toBeNull();
    expect(hub.next).toMatchObject({ firstName: "Tina", date: soon(3), time: "10:00" });
    expect(hub.next).toHaveProperty("photo");
    expect(typeof hub.next.day).toBe("string");
  } finally {
    await db.prepare("UPDATE care_sessions SET status = 'in_progress' WHERE care_recipient_id = ? AND scheduled_date = ? AND status = 'completed'").run(recipientId, soon(0));
  }
});

describe("v1.158.0 — seeing and refreshing the Hub from the family's phone", () => {
  test("only her own account reports; the leader sees it; nobody else can refresh", async () => {
    require("../../src/utils/hubStatus")._reset();
    const before = await h.request.get(`/api/care-recipients/${recipientId}/simple-mode`).set(h.auth(leader.token));
    expect(before.body.hubStatus).toBeNull();

    const notHer = await h.request.post(`/api/care-recipients/${recipientId}/simple-screen/hub-status`).set(h.auth(sister.token))
      .send({ version: "9.9.9" });
    expect(notHer.status).toBe(403);
    const hers = await h.request.post(`/api/care-recipients/${recipientId}/simple-screen/hub-status`).set(h.auth(mom.token))
      .send({ version: "1.158.0", kiosk: { deviceOwner: true, locked: true }, battery: { level: 97.4, charging: true }, junk: "<script>" });
    expect(hers.status).toBe(200);

    const after = await h.request.get(`/api/care-recipients/${recipientId}/simple-mode`).set(h.auth(leader.token));
    expect(after.body.hubStatus).toMatchObject({ version: "1.158.0", online: true, kiosk: { deviceOwner: true, locked: true }, battery: { level: 97, charging: true } });
    expect(after.body.hubStatus.junk).toBeUndefined();

    const sent = [];
    require("../../src/utils/callRegistry").setEmitter((uid, event) => { sent.push(`${uid}:${event}`); return 1; });
    expect((await h.request.post(`/api/care-recipients/${recipientId}/simple-screen/hub-refresh`).set(h.auth(tina.token))).status).toBe(403);
    const ok = await h.request.post(`/api/care-recipients/${recipientId}/simple-screen/hub-refresh`).set(h.auth(leader.token));
    expect(ok.status).toBe(200);
    expect(ok.body.sent).toBe(1);
    expect(sent).toEqual([`${mom.user.id}:hub_refresh`]);
  });
});
