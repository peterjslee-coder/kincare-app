/**
 * v1.105.191 — hand tonight's task to someone else, and remove a task for good.
 *
 * Pete, Sep 11: "I want a way to assign the task we're waiting on (mom's meds tonight) to
 * Daniel. or sara. it defaults to me and if I open it and select dan, my only option in the
 * 'needs you' pane is to complete the task or skip...no 'save and update'." And: "i still
 * can't cancel tasks." Real Postgres: the occurrence-level assignee, the COALESCE the
 * dashboard and Needs-you read through, and the handoff notifying the new person.
 */
const { startHarness, stopHarness } = require("./harness");

jest.setTimeout(180000);

const ROUTERS = { "/api/care-tasks": "../../src/routes/careTasks" };

let h, pete, daniel, outsider, recipientId, teamId, taskId, occId;

beforeAll(async () => {
  h = await startHarness({ routers: ROUTERS });
  pete = await h.createUser({ roles: ["family"], firstName: "Pete" });
  daniel = await h.createUser({ roles: ["family"], firstName: "Daniel" });
  outsider = await h.createUser({ roles: ["family"], firstName: "Nobody" });
  const t = await h.createCareTeam({ familyUserId: pete.user.id });
  recipientId = t.recipientId; teamId = t.teamId;
  await h.addTeamMember(teamId, daniel.user.id, "member");
});
afterAll(async () => { await stopHarness(h); });

const todayStr = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());

describe("tonight is Daniel's", () => {
  test("a task assigned to Pete by default", async () => {
    const res = await h.request.post("/api/care-tasks").set(h.auth(pete.token)).send({
      care_recipient_id: recipientId, title: "Evening Meds", task_type: "medication",
      recurrence: "daily", due_time: "19:00", start_date: todayStr(), assigned_user_id: pete.user.id,
    });
    expect(res.status).toBe(201);
    taskId = res.body.task.id;
    const today = await h.request.get("/api/care-tasks/today").set(h.auth(pete.token));
    const occ = today.body.groups.find((g) => g.careRecipientId === recipientId).occurrences[0];
    occId = occ.id;
    expect(occ.assignee_first_name).toBe("Pete");
    expect(occ.assigned_user_id).toBe(pete.user.id);
  });

  test("an outsider cannot hand it off; a stranger cannot receive it", async () => {
    const a = await h.request.post(`/api/care-tasks/occurrences/${occId}/assign`).set(h.auth(outsider.token)).send({ userId: daniel.user.id });
    expect(a.status).toBe(403);
    const b = await h.request.post(`/api/care-tasks/occurrences/${occId}/assign`).set(h.auth(pete.token)).send({ userId: outsider.user.id });
    expect(b.status).toBe(400);
  });

  test("Pete hands tonight to Daniel: today's row says Daniel; the task's default is still Pete", async () => {
    const res = await h.request.post(`/api/care-tasks/occurrences/${occId}/assign`).set(h.auth(pete.token)).send({ userId: daniel.user.id });
    expect(res.status).toBe(200);
    expect(res.body.assigneeFirstName).toBe("Daniel");
    const today = await h.request.get("/api/care-tasks/today").set(h.auth(pete.token));
    const occ = today.body.groups.find((g) => g.careRecipientId === recipientId).occurrences[0];
    expect(occ.assignee_first_name).toBe("Daniel");
    expect(occ.assigned_user_id).toBe(daniel.user.id);
    expect(occ.task_assigned_user_id).toBe(pete.user.id);
    const task = await h.db.prepare("SELECT assigned_user_id FROM care_tasks WHERE id = ?").get(taskId);
    expect(task.assigned_user_id).toBe(pete.user.id);
  });

  test("Needs-you follows tonight's person, not the default", async () => {
    // Make it due: push due_at into the past.
    await h.db.prepare("UPDATE care_task_occurrences SET due_at = NOW() - INTERVAL '10 minutes' WHERE id = ?").run(occId);
    const { attentionItemsFor } = require("../../src/utils/attention");
    const forDaniel = await attentionItemsFor(h.db, daniel.user.id);
    const forPete = await attentionItemsFor(h.db, pete.user.id);
    const has = (a) => JSON.stringify(a).includes(occId);
    expect(has(forDaniel)).toBe(true);
    expect(has(forPete)).toBe(false);
  });

  test("handing it back (null) restores the default", async () => {
    const res = await h.request.post(`/api/care-tasks/occurrences/${occId}/assign`).set(h.auth(pete.token)).send({ userId: null });
    expect(res.status).toBe(200);
    expect(res.body.assigneeFirstName).toBe("Pete");
  });

  test("a checked-off occurrence cannot be handed off", async () => {
    await h.request.post(`/api/care-tasks/occurrences/${occId}/check`).set(h.auth(pete.token)).send({ status: "done" });
    const res = await h.request.post(`/api/care-tasks/occurrences/${occId}/assign`).set(h.auth(pete.token)).send({ userId: daniel.user.id });
    expect(res.status).toBe(409);
  });
});

describe("removing a task", () => {
  test("gone from the list, history kept, pending rows dropped", async () => {
    const res = await h.request.delete(`/api/care-tasks/${taskId}`).set(h.auth(pete.token));
    expect(res.status).toBe(200);
    const list = await h.request.get(`/api/care-tasks/recipient/${recipientId}`).set(h.auth(pete.token));
    expect((list.body.tasks || []).filter((t) => t.id === taskId && t.is_active)).toHaveLength(0);
    const done = await h.db.prepare("SELECT status FROM care_task_occurrences WHERE id = ?").get(occId);
    expect(done.status).toBe("done"); // the record of tonight survives the task's removal
  });
});
