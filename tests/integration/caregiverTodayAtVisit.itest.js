/**
 * v1.107.5 — the caregiver working today's visit sees today's tasks and appointments for
 * that person, and can check a task off — medications included ("marked taken", not
 * "administered"). Pete, 9/15: "I want Tina to be able to complete those tasks ... Tina
 * sees the events below the 'in progress' card."
 *
 * Boundaries: a caregiver booked for a later day sees nothing and can't check anything;
 * the visit caregiver sees today's events only, not Betty's fortnight.
 */
const { v4: uuid } = require("uuid");
const { startHarness, stopHarness } = require("./harness");

jest.setTimeout(180000);

const ROUTERS = {
  "/api/care-tasks": "../../src/routes/careTasks",
  "/api/care-events": "../../src/routes/careEvents",
};
const TZ = "America/New_York";
const dayStr = (offset = 0) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(Date.now() + offset * 86400000));

let h, db, family, tina, friday, stranger, recipientId, occId;

async function caregiverWithSession(user, date, status) {
  const pid = uuid();
  await db.prepare("INSERT INTO caregiver_profiles (id, user_id, hourly_rate, created_at) VALUES (?, ?, 22, NOW())").run(pid, user.user.id);
  await db.prepare(`
    INSERT INTO care_sessions (id, care_recipient_id, family_user_id, caregiver_id, service_type,
      status, scheduled_date, scheduled_time, duration_hours, estimated_cost, created_at)
    VALUES (?, ?, ?, ?, 'companion', ?, ?, '09:00', 8, 176, NOW())
  `).run(uuid(), recipientId, family.user.id, pid, status, date);
}

beforeAll(async () => {
  h = await startHarness({ routers: ROUTERS });
  db = h.db;
  family = await h.createUser({ roles: ["family"], firstName: "Sara" });
  tina = await h.createUser({ roles: ["caregiver"], firstName: "Tina" });
  friday = await h.createUser({ roles: ["caregiver"], firstName: "Fri" });
  stranger = await h.createUser({ roles: ["caregiver"], firstName: "Stranger" });
  const t = await h.createCareTeam({ familyUserId: family.user.id });
  recipientId = t.recipientId;
  await caregiverWithSession(tina, dayStr(0), "in_progress");
  await caregiverWithSession(friday, dayStr(3), "confirmed");

  const task = await h.request.post("/api/care-tasks").set(h.auth(family.token)).send({
    care_recipient_id: recipientId, title: "Evening medication", task_type: "medication",
    details: { med_name: "Med", dose: "1 tablet" }, recurrence: "daily", due_time: "19:00",
    start_date: dayStr(0),
  });
  expect(task.status).toBe(201);
  for (const [date, title] of [[dayStr(0), "PT with Sean"], [dayStr(0), "Hair appointment"], [dayStr(2), "Cardiology"]]) {
    const ev = await h.request.post("/api/care-events").set(h.auth(family.token)).send({
      care_recipient_id: recipientId, title, category: "medical", event_date: date, event_time: "10:00",
    });
    expect(ev.status).toBe(201);
  }
});

afterAll(async () => { await stopHarness(h); });

test("Tina, on today's visit, sees today's tasks for that person", async () => {
  const res = await h.request.get("/api/care-tasks/today").set(h.auth(tina.token));
  expect(res.status).toBe(200);
  const g = res.body.groups.find((x) => x.careRecipientId === recipientId);
  expect(g).toBeTruthy();
  expect(g.occurrences).toHaveLength(1);
  occId = g.occurrences[0].id;
});

test("Tina sees both of today's appointments and nothing past today", async () => {
  const res = await h.request.get("/api/care-events/upcoming").set(h.auth(tina.token));
  expect(res.status).toBe(200);
  const mine = res.body.events.filter((e) => e.care_recipient_id === recipientId);
  expect(mine.map((e) => e.title).sort()).toEqual(["Hair appointment", "PT with Sean"]);
  expect(mine.every((e) => e.canManage === false)).toBe(true);
});

test("the family still sees the whole fortnight", async () => {
  const res = await h.request.get("/api/care-events/upcoming").set(h.auth(family.token));
  expect(res.body.events.map((e) => e.title)).toEqual(expect.arrayContaining(["Cardiology", "PT with Sean"]));
});

test("a caregiver booked for a later day sees nothing today and cannot check off", async () => {
  const t = await h.request.get("/api/care-tasks/today").set(h.auth(friday.token));
  expect(t.body.groups).toHaveLength(0);
  const e = await h.request.get("/api/care-events/upcoming").set(h.auth(friday.token));
  expect(e.body.events).toHaveLength(0);
  const c = await h.request.post(`/api/care-tasks/occurrences/${occId}/check`).set(h.auth(friday.token)).send({ status: "done" });
  expect(c.status).toBe(403);
});

test("a stranger cannot check off", async () => {
  const c = await h.request.post(`/api/care-tasks/occurrences/${occId}/check`).set(h.auth(stranger.token)).send({ status: "done" });
  expect(c.status).toBe(403);
});

test("Tina marks the medication taken; it is attributed to her", async () => {
  const c = await h.request.post(`/api/care-tasks/occurrences/${occId}/check`).set(h.auth(tina.token)).send({ status: "done" });
  expect(c.status).toBe(200);
  const row = await db.prepare("SELECT status, completed_by_user_id FROM care_task_occurrences WHERE id = ?").get(occId);
  expect(row.status).toBe("done");
  expect(row.completed_by_user_id).toBe(tina.user.id);
});

test("a second tap on the same dose is a 409, not an overwrite", async () => {
  const c = await h.request.post(`/api/care-tasks/occurrences/${occId}/check`).set(h.auth(family.token)).send({ status: "skipped" });
  expect(c.status).toBe(409);
  const row = await db.prepare("SELECT status, completed_by_user_id FROM care_task_occurrences WHERE id = ?").get(occId);
  expect(row.status).toBe("done");
  expect(row.completed_by_user_id).toBe(tina.user.id);
});
