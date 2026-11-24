/**
 * v1.109.9 — one-time to-dos, feedback e4cd314a. Pete: "Something that reminds the next person
 * that shows up at her house to accomplish a task. Like, I need to lock her stove against the
 * wall. It doesn't have a time, it doesn't have to be me, but somebody needs to do it when
 * they're there."
 *
 * Same audience as care tasks: the family team, and the caregiver on today's visit. Not a
 * caregiver booked for another day, not a stranger. Done once; a second "done" is 409. The care
 * task poller and its nightly roll to 'missed' never see one.
 */
const { v4: uuid } = require("uuid");
const { startHarness, stopHarness } = require("./harness");

jest.setTimeout(180000);

const TZ = "America/New_York";
const dayStr = (offset = 0) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(Date.now() + offset * 86400000));

let h, db, family, sibling, tina, friday, stranger, recipientId, teamId;

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
  h = await startHarness({ routers: {
    "/api/care-todos": "../../src/routes/careTodos",
    "/api/care-tasks": "../../src/routes/careTasks",
  } });
  db = h.db;
  family = await h.createUser({ roles: ["family"], firstName: "Pete" });
  sibling = await h.createUser({ roles: ["family"], firstName: "Dan" });
  tina = await h.createUser({ roles: ["caregiver"], firstName: "Tina" });
  friday = await h.createUser({ roles: ["caregiver"], firstName: "Fri" });
  stranger = await h.createUser({ roles: ["caregiver"], firstName: "Stranger" });
  const t = await h.createCareTeam({ familyUserId: family.user.id });
  recipientId = t.recipientId;
  teamId = t.teamId;
  await h.addTeamMember(teamId, sibling.user.id, "member");
  await caregiverWithSession(tina, dayStr(0), "confirmed");
  await caregiverWithSession(friday, dayStr(3), "confirmed");
});
afterAll(async () => { await stopHarness(h); });

const add = (token, body) => h.request.post("/api/care-todos").set(h.auth(token)).send(body);
const list = (token, q = "") => h.request.get(`/api/care-todos${q}`).set(h.auth(token));
const openFor = (res) => (res.body.groups || []).find((g) => g.careRecipientId === recipientId)?.open || [];

test("the family adds a to-do with only a title — no time, no owner", async () => {
  const res = await add(family.token, { care_recipient_id: recipientId, title: "Lock her stove against the wall" });
  expect(res.status).toBe(201);
  expect(res.body.todo.title).toBe("Lock her stove against the wall");
  expect(res.body.todo.completed_at).toBeNull();
});

test("a title is required", async () => {
  expect((await add(family.token, { care_recipient_id: recipientId, title: "  " })).status).toBe(400);
});

test("a team member sees it", async () => {
  const res = await list(sibling.token);
  expect(res.status).toBe(200);
  expect(openFor(res).map((t) => t.title)).toContain("Lock her stove against the wall");
});

test("the caregiver on today's visit sees it — and may not add one", async () => {
  const res = await list(tina.token);
  const g = res.body.groups.find((x) => x.careRecipientId === recipientId);
  expect(g).toBeTruthy();
  expect(g.viaVisit).toBe(true);
  expect(g.canAdd).toBe(false);
  expect(g.open.map((t) => t.title)).toContain("Lock her stove against the wall");
  expect((await add(tina.token, { care_recipient_id: recipientId, title: "Mine" })).status).toBe(403);
});

test("a caregiver booked for another day, and a stranger, see nothing", async () => {
  for (const who of [friday, stranger]) {
    const res = await list(who.token);
    expect(res.status).toBe(200);
    expect(res.body.groups.find((x) => x.careRecipientId === recipientId)).toBeUndefined();
    expect((await list(who.token, `?recipientId=${recipientId}`)).status).toBe(403);
  }
});

test("an unrelated caregiver cannot finish one", async () => {
  const todo = (await add(family.token, { care_recipient_id: recipientId, title: "Change the smoke detector battery" })).body.todo;
  expect((await h.request.post(`/api/care-todos/${todo.id}/done`).set(h.auth(friday.token)).send({})).status).toBe(404);
  expect((await h.request.post(`/api/care-todos/${todo.id}/done`).set(h.auth(stranger.token)).send({})).status).toBe(404);
});

test("done once by the visiting caregiver, recorded; the second tap is 409", async () => {
  const todo = (await add(family.token, { care_recipient_id: recipientId, title: "Take the rug to the garage" })).body.todo;
  const first = await h.request.post(`/api/care-todos/${todo.id}/done`).set(h.auth(tina.token)).send({ note: "Rolled it up" });
  expect(first.status).toBe(200);
  expect(first.body.todo.completed_by_user_id).toBe(tina.user.id);
  expect(first.body.todo.completed_by_first_name).toBe("Tina");
  expect(first.body.todo.completion_note).toBe("Rolled it up");
  expect(first.body.todo.completed_at).toBeTruthy();
  const again = await h.request.post(`/api/care-todos/${todo.id}/done`).set(h.auth(family.token)).send({});
  expect(again.status).toBe(409);
  // It is in Done now, not open.
  const res = await list(family.token);
  const g = res.body.groups.find((x) => x.careRecipientId === recipientId);
  expect(g.open.map((t) => t.id)).not.toContain(todo.id);
  expect(g.done.map((t) => t.id)).toContain(todo.id);
});

test("undo puts it back; undoing an open one is 409", async () => {
  const todo = (await add(family.token, { care_recipient_id: recipientId, title: "Water the plants" })).body.todo;
  expect((await h.request.post(`/api/care-todos/${todo.id}/undo`).set(h.auth(family.token))).status).toBe(409);
  await h.request.post(`/api/care-todos/${todo.id}/done`).set(h.auth(family.token)).send({});
  // The visiting caregiver cannot take back the family's tick.
  expect((await h.request.post(`/api/care-todos/${todo.id}/undo`).set(h.auth(tina.token))).status).toBe(403);
  const undo = await h.request.post(`/api/care-todos/${todo.id}/undo`).set(h.auth(family.token));
  expect(undo.status).toBe(200);
  expect(undo.body.todo.completed_at).toBeNull();
});

test("remove: the caregiver cannot, the family can, and it leaves the list", async () => {
  const todo = (await add(family.token, { care_recipient_id: recipientId, title: "Typo" })).body.todo;
  expect((await h.request.delete(`/api/care-todos/${todo.id}`).set(h.auth(tina.token))).status).toBe(403);
  expect((await h.request.delete(`/api/care-todos/${todo.id}`).set(h.auth(family.token))).status).toBe(200);
  expect(openFor(await list(family.token)).map((t) => t.id)).not.toContain(todo.id);
});

test("the care-task poller and its nightly roll to 'missed' never touch a to-do", async () => {
  const todo = (await add(family.token, { care_recipient_id: recipientId, title: "Fix the porch light" })).body.todo;
  // Age it, as if it had sat there for a week.
  await db.prepare("UPDATE care_todos SET created_at = NOW() - INTERVAL '7 days' WHERE id = ?").run(todo.id);
  const before = await db.prepare("SELECT * FROM care_todos WHERE id = ?").get(todo.id);
  const { pollCareTasks } = require("../../src/routes/careTasks");
  const pushes = [];
  await pollCareTasks(async (uid, payload) => { pushes.push({ uid, payload }); });
  const after = await db.prepare("SELECT * FROM care_todos WHERE id = ?").get(todo.id);
  expect(after).toEqual(before);
  expect(pushes).toHaveLength(0);
  const occ = await db.prepare("SELECT COUNT(*)::int AS n FROM care_task_occurrences").get();
  expect(occ.n).toBe(0);
  // And it is still there for the next visit.
  expect(openFor(await list(tina.token)).map((t) => t.id)).toContain(todo.id);
});

test("no Needs-you row for a to-do — it is nobody's blocker", async () => {
  const { attentionItemsFor } = require("../../src/utils/attention");
  const a = await attentionItemsFor(db, family.user.id);
  expect(JSON.stringify(a.items)).not.toMatch(/stove|porch light/i);
});
