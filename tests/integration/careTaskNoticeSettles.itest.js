/**
 * v1.112.2 — Pete: "why's there a care task not accomplished activity thing with a 'sara
 * completed meds for betty'?" The 7:00 PM "not checked off" question stayed unread on top of
 * Sara's 7:12 PM answer. Checking off settles every notice about that occurrence, and the feed
 * says who answered.
 */
const { v4: uuid } = require("uuid");
const { startHarness, stopHarness } = require("./harness");
jest.setTimeout(180000);
let h, db, pete, sara, recipientId, taskId, occId, noteId;

beforeAll(async () => {
  h = await startHarness({ routers: {
    "/api/care-tasks": "../../src/routes/careTasks",
    "/api/push": "../../src/routes/push",
  } });
  db = h.db;
  pete = await h.createUser({ firstName: "Pete" });
  sara = await h.createUser({ firstName: "Sara" });
  const t = await h.createCareTeam({ familyUserId: pete.user.id });
  recipientId = t.recipientId;
  await h.addTeamMember(t.teamId, sara.user.id);
  taskId = uuid(); occId = uuid(); noteId = uuid();
  await db.prepare(`INSERT INTO care_tasks (id, care_recipient_id, created_by, title, task_type, recurrence, due_time, tz, start_date)
    VALUES (?, ?, ?, 'Meds', 'medication', 'daily', '17:00', 'America/New_York', '2026-10-01')`).run(taskId, recipientId, pete.user.id);
  await db.prepare(`INSERT INTO care_task_occurrences (id, task_id, due_date, due_at, status)
    VALUES (?, ?, '2026-10-12', '2026-10-12T21:00:00Z', 'pending')`).run(occId, taskId);
  await db.prepare(`INSERT INTO notifications (id, user_id, title, body, type, data, read, created_at)
    VALUES (?, ?, 'Care task not checked off', 'x', 'care_task', ?, 0, NOW())`)
    .run(noteId, pete.user.id, JSON.stringify({ type: "care_task_due", occurrenceId: occId, taskId }));
});
afterAll(async () => { await stopHarness(h); });

test("an open question stays a question", async () => {
  const r = await h.request.get("/api/push/notifications").set(h.auth(pete.token));
  const n = r.body.notifications.find((x) => x.id === noteId || (x.ids || []).includes(noteId)) || r.body.notifications[0];
  expect(n.title).toBe("Care task not checked off");
  expect(r.body.unreadCount).toBeGreaterThanOrEqual(1);
});

test("Sara checks it off → the notice is read and says who answered", async () => {
  const c = await h.request.post(`/api/care-tasks/occurrences/${occId}/check`).set(h.auth(sara.token)).send({});
  expect(c.status).toBe(200);
  const row = await db.prepare("SELECT read FROM notifications WHERE id = ?").get(noteId);
  expect(Number(row.read)).toBe(1);
  const r = await h.request.get("/api/push/notifications").set(h.auth(pete.token));
  const n = r.body.notifications[0];
  expect(n.title).toMatch(/checked off/);
  expect(n.body).toMatch(/^Sara checked off .*5:00 PM task/);
  expect(r.body.unreadCount).toBe(0);
});
