/**
 * v1.109.3 — archive a care task, keep the record.
 *
 * Pete, 9/18: "i can pause them, delete them, but they stay there. can we archive? it's a
 * great idea to archive and be able to see how long or who did what previously."
 *
 * Remove used to set is_active = 0 — exactly what Pause does — so a finished course of
 * antibiotics sat on the list forever looking like one on hold. Now it archives: off the
 * list, out of /today, out of the reminder poller, and every occurrence still readable.
 */
const { v4: uuid } = require("uuid");
const { startHarness, stopHarness } = require("./harness");

jest.setTimeout(180000);

const ROUTERS = { "/api/care-tasks": "../../src/routes/careTasks" };
const TZ = "America/New_York";
const todayStr = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
const daysAgo = (n) => {
  const d = new Date(Date.now() - n * 86400000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
};

let h, db, family, teamMember, outsider, recipientId, teamId, taskId;

beforeAll(async () => {
  h = await startHarness({ routers: ROUTERS });
  db = h.db;
  family = await h.createUser({ roles: ["family"], firstName: "Pete" });
  teamMember = await h.createUser({ roles: ["family"], firstName: "Sara" });
  outsider = await h.createUser({ roles: ["family"] });
  const t = await h.createCareTeam({ familyUserId: family.user.id });
  recipientId = t.recipientId;
  teamId = t.teamId;
  await h.addTeamMember(teamId, teamMember.user.id, "member");
  await db.prepare("UPDATE care_recipients SET timezone = ? WHERE id = ?").run(TZ, recipientId);

  const res = await h.request.post("/api/care-tasks").set(h.auth(family.token)).send({
    care_recipient_id: recipientId,
    title: "Amoxicillin",
    task_type: "medication",
    details: { med_name: "Amoxicillin", dose: "1 tablet" },
    recurrence: "daily",
    due_time: "09:00",
    start_date: daysAgo(10),
  });
  expect(res.status).toBe(201);
  taskId = res.body.task.id;

  // A fortnight of record: eight done by Tina, one missed, one dismissed.
  for (let i = 10; i >= 2; i--) {
    await db.prepare(`
      INSERT INTO care_task_occurrences (id, task_id, due_date, due_at, status,
        completed_at, completed_by_user_id, created_at)
      VALUES (?, ?, ?, ?::timestamptz, ?, NOW(), ?, NOW())
    `).run(uuid(), taskId, daysAgo(i), `${daysAgo(i)}T14:00:00Z`,
      i === 5 ? "missed" : i === 4 ? "skipped" : "done", i === 5 || i === 4 ? null : family.user.id);
  }
});

afterAll(async () => { await stopHarness(h); });

describe("archiving a care task", () => {
  test("before: it is on the list and in today", async () => {
    const list = await h.request.get(`/api/care-tasks/recipient/${recipientId}`).set(h.auth(family.token));
    expect(list.status).toBe(200);
    expect(list.body.tasks.map((t) => t.id)).toContain(taskId);
    expect(list.body.archived).toEqual([]);

    const today = await h.request.get("/api/care-tasks/today").set(h.auth(family.token));
    const group = today.body.groups.find((g) => g.careRecipientId === recipientId);
    expect(group.occurrences.some((o) => o.task_id === taskId)).toBe(true);
  });

  test("a plain team member cannot archive it", async () => {
    const res = await h.request.delete(`/api/care-tasks/${taskId}`).set(h.auth(teamMember.token));
    expect(res.status).toBe(403);
  });

  test("the owner archives it — off the list, off today, occurrences kept", async () => {
    const before = await db.prepare("SELECT COUNT(*)::int AS n FROM care_task_occurrences WHERE task_id = ?").get(taskId);
    const res = await h.request.delete(`/api/care-tasks/${taskId}`).set(h.auth(family.token));
    expect(res.status).toBe(200);
    expect(res.body.archived).toBe(true);

    const row = await db.prepare("SELECT archived_at, archived_by, is_active FROM care_tasks WHERE id = ?").get(taskId);
    expect(row.archived_at).toBeTruthy();
    expect(row.archived_by).toBe(family.user.id);

    const list = await h.request.get(`/api/care-tasks/recipient/${recipientId}`).set(h.auth(family.token));
    expect(list.body.tasks.map((t) => t.id)).not.toContain(taskId);
    expect(list.body.archived.map((t) => t.id)).toContain(taskId);
    expect(list.body.archived[0].archived_by_first_name).toBe("Pete");

    const today = await h.request.get("/api/care-tasks/today").set(h.auth(family.token));
    const group = today.body.groups.find((g) => g.careRecipientId === recipientId);
    expect(group ? group.occurrences.some((o) => o.task_id === taskId) : false).toBe(false);

    // What was recorded is the point. Only FUTURE pending rows go.
    const after = await db.prepare(
      "SELECT COUNT(*)::int AS n FROM care_task_occurrences WHERE task_id = ? AND status <> 'pending'"
    ).get(taskId);
    expect(after.n).toBe(9);
    expect(before.n).toBeGreaterThanOrEqual(after.n);
  });

  test("history says how long it ran and who did it", async () => {
    const res = await h.request.get(`/api/care-tasks/${taskId}/history`).set(h.auth(family.token));
    expect(res.status).toBe(200);
    const { task, summary, occurrences } = res.body;
    expect(task.title).toBe("Amoxicillin");
    expect(task.archived_at).toBeTruthy();
    expect(task.archived_by_first_name).toBe("Pete");
    expect(summary.firstDue).toBe(daysAgo(10));
    expect(summary.lastDue).toBe(daysAgo(2));
    expect(summary.days).toBe(9);
    expect(summary.done).toBe(7);
    expect(summary.missed).toBe(1);
    expect(summary.skipped).toBe(1);
    expect(summary.answered).toBe(9);
    expect(summary.doneRate).toBe(78);
    expect(summary.people[0]).toEqual({ name: "Pete U", count: 7 });
    expect(occurrences).toHaveLength(9);
    expect(occurrences[0].dueDate).toBeTruthy();
    expect(occurrences.find((o) => o.status === "done").by).toBe("Pete U");
  });

  test("a team member can read the history; an outsider cannot", async () => {
    const member = await h.request.get(`/api/care-tasks/${taskId}/history`).set(h.auth(teamMember.token));
    expect(member.status).toBe(200);
    const out = await h.request.get(`/api/care-tasks/${taskId}/history`).set(h.auth(outsider.token));
    expect(out.status).toBe(403);
  });

  test("restore brings it back PAUSED, so nothing starts reminding anyone", async () => {
    const denied = await h.request.post(`/api/care-tasks/${taskId}/restore`).set(h.auth(teamMember.token));
    expect(denied.status).toBe(403);

    const res = await h.request.post(`/api/care-tasks/${taskId}/restore`).set(h.auth(family.token));
    expect(res.status).toBe(200);

    const row = await db.prepare("SELECT archived_at, is_active FROM care_tasks WHERE id = ?").get(taskId);
    expect(row.archived_at).toBeNull();
    expect(Number(row.is_active)).toBe(0);

    const list = await h.request.get(`/api/care-tasks/recipient/${recipientId}`).set(h.auth(family.token));
    expect(list.body.tasks.map((t) => t.id)).toContain(taskId);
    expect(list.body.archived).toEqual([]);

    // Paused means paused: still not in today.
    const today = await h.request.get("/api/care-tasks/today").set(h.auth(family.token));
    const group = today.body.groups.find((g) => g.careRecipientId === recipientId);
    expect(group ? group.occurrences.some((o) => o.task_id === taskId) : false).toBe(false);
  });
});
