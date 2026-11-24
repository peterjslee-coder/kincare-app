/**
 * Care Tasks integration tests (v1.99.0) — the full loop against the REAL
 * schema: create a recurring med task → today's occurrence materializes →
 * team member checks it off attributing a manual helper → helper is
 * remembered → note lands in recipient_notes → undo works → poller rolls
 * stale pending occurrences to 'missed'.
 */
const { v4: uuid } = require("uuid");
const { startHarness, stopHarness } = require("./harness");

jest.setTimeout(180000);

const ROUTERS = {
  "/api/care-tasks": "../../src/routes/careTasks",
};

let h;
let family, teamMember, outsider;
let recipientId, teamId;

beforeAll(async () => {
  h = await startHarness({ routers: ROUTERS });
  family = await h.createUser({ roles: ["family"], firstName: "Pete" });
  teamMember = await h.createUser({ roles: ["family"], firstName: "Sara" });
  outsider = await h.createUser({ roles: ["family"] });
  const t = await h.createCareTeam({ familyUserId: family.user.id });
  recipientId = t.recipientId;
  teamId = t.teamId;
  await h.addTeamMember(teamId, teamMember.user.id, "member");
});

afterAll(async () => { await stopHarness(h); });

const todayStr = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());

let taskId, occurrenceId;

describe("care task lifecycle", () => {
  test("owner creates a nightly medication task; today's occurrence materializes immediately", async () => {
    const res = await h.request.post("/api/care-tasks").set(h.auth(family.token)).send({
      care_recipient_id: recipientId,
      title: "Give Betty her evening medication",
      task_type: "medication",
      details: { med_name: "Anxiety med", dose: "1 tablet" },
      recurrence: "daily",
      due_time: "19:00",
      start_date: todayStr(),
      grace_minutes: 45,
    });
    expect(res.status).toBe(201);
    taskId = res.body.task.id;

    const today = await h.request.get("/api/care-tasks/today").set(h.auth(family.token));
    expect(today.status).toBe(200);
    const group = today.body.groups.find((g) => g.careRecipientId === recipientId);
    expect(group).toBeTruthy();
    expect(group.occurrences).toHaveLength(1);
    expect(group.occurrences[0].status).toBe("pending");
    occurrenceId = group.occurrences[0].id;
    // picker data comes along: team members present
    expect(group.teamMembers.map((m) => m.id)).toEqual(
      expect.arrayContaining([family.user.id, teamMember.user.id])
    );
  });

  test("plain team member (not owner) cannot create, CAN see today", async () => {
    const create = await h.request.post("/api/care-tasks").set(h.auth(teamMember.token)).send({
      care_recipient_id: recipientId, title: "x", due_time: "09:00", start_date: todayStr(),
    });
    expect(create.status).toBe(403);
    const today = await h.request.get("/api/care-tasks/today").set(h.auth(teamMember.token));
    expect(today.status).toBe(200);
    expect(today.body.groups.some((g) => g.careRecipientId === recipientId)).toBe(true);
  });

  test("outsider sees nothing and cannot check off", async () => {
    const today = await h.request.get("/api/care-tasks/today").set(h.auth(outsider.token));
    expect(today.body.groups).toHaveLength(0);
    const check = await h.request.post(`/api/care-tasks/occurrences/${occurrenceId}/check`)
      .set(h.auth(outsider.token)).send({ status: "done" });
    expect(check.status).toBe(403);
  });

  test("team member checks off attributing a manual helper + note → helper remembered, note in care notes", async () => {
    const res = await h.request.post(`/api/care-tasks/occurrences/${occurrenceId}/check`)
      .set(h.auth(teamMember.token))
      .send({ status: "done", completed_by_name: "Peggy Huber", note: "Took it with dinner, seemed calm." });
    expect(res.status).toBe(200);
    expect(res.body.occurrence.status).toBe("done");
    expect(res.body.occurrence.completed_by_name).toBe("Peggy Huber");
    expect(res.body.occurrence.recorded_by).toBe(teamMember.user.id);

    const helper = await h.db.prepare(
      "SELECT * FROM care_task_helpers WHERE care_recipient_id = ? AND name = 'Peggy Huber'"
    ).get(recipientId);
    expect(helper).toBeTruthy();

    const note = await h.db.prepare(
      "SELECT * FROM recipient_notes WHERE care_recipient_id = ? AND note_type = 'task'"
    ).get(recipientId);
    expect(note).toBeTruthy();
    expect(note.content).toContain("Peggy Huber");
    expect(note.content).toContain("Took it with dinner");
  });

  test("double check-off is a 409; undo restores pending", async () => {
    const again = await h.request.post(`/api/care-tasks/occurrences/${occurrenceId}/check`)
      .set(h.auth(family.token)).send({ status: "done" });
    expect(again.status).toBe(409);

    const undo = await h.request.post(`/api/care-tasks/occurrences/${occurrenceId}/undo`)
      .set(h.auth(family.token));
    expect(undo.status).toBe(200);
    expect(undo.body.occurrence.status).toBe("pending");
  });

  test("check-off without attribution defaults to the tapper", async () => {
    const res = await h.request.post(`/api/care-tasks/occurrences/${occurrenceId}/check`)
      .set(h.auth(family.token)).send({ status: "done" });
    expect(res.status).toBe(200);
    expect(res.body.occurrence.completed_by_user_id).toBe(family.user.id);
  });

  test("recipient view returns definitions with a recent strip; helpers pre-fill", async () => {
    const res = await h.request.get(`/api/care-tasks/recipient/${recipientId}`)
      .set(h.auth(teamMember.token));
    expect(res.status).toBe(200);
    const task = res.body.tasks.find((t) => t.id === taskId);
    expect(task).toBeTruthy();
    expect(task.recent.length).toBeGreaterThan(0);
    expect(res.body.helpers.map((x) => x.name)).toContain("Peggy Huber");
    expect(res.body.canManage).toBe(false); // plain member manages nothing
  });

  test("poller rolls yesterday's pending occurrence to missed", async () => {
    const { pollCareTasks } = require("../../src/routes/careTasks");
    const staleId = uuid();
    const yesterday = new Date(Date.now() - 24 * 3600000).toISOString();
    await h.db.prepare(`
      INSERT INTO care_task_occurrences (id, task_id, due_date, due_at, status)
      VALUES (?, ?, '2026-01-01', ?, 'pending')
    `).run(staleId, taskId, yesterday);

    const pushes = [];
    await pollCareTasks(async (uid, payload) => { pushes.push({ uid, payload }); });

    const rolled = await h.db.prepare("SELECT status FROM care_task_occurrences WHERE id = ?").get(staleId);
    expect(rolled.status).toBe("missed");
    // today's occurrence was already checked off above → no due push for it
    expect(pushes.every((p) => p.payload.data.type === "care_task_due")).toBe(true);
  });

  test("pushes are family-only: caregiver team member gets no due/escalation push (v1.99.2)", async () => {
    const { pollCareTasks } = require("../../src/routes/careTasks");
    const caregiver = await h.createUser({ roles: ["caregiver"], firstName: "Edwina" });
    await h.addTeamMember(teamId, caregiver.user.id, "member");

    // Unassigned task due right now (current minute in ET — keeps the due
    // push inside the poller's 6h stale cutoff no matter when CI runs) →
    // due push fans out to the team, minus caregiver-role users.
    const nowET = new Intl.DateTimeFormat("en-GB", {
      timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(new Date()).replace("24:", "00:");
    const create = await h.request.post("/api/care-tasks").set(h.auth(family.token)).send({
      care_recipient_id: recipientId, title: "Family-only push check", task_type: "checkin",
      recurrence: "daily", due_time: nowET, start_date: todayStr(), grace_minutes: 1440,
    });
    expect(create.status).toBe(201);
    const tId = create.body.task.id;

    const pushes = [];
    await pollCareTasks(async (uid, payload) => { pushes.push({ uid, type: payload.data.type }); });

    const duePushes = pushes.filter((p) => p.type === "care_task_due");
    const pushedIds = duePushes.map((p) => p.uid);
    expect(pushedIds).toEqual(expect.arrayContaining([family.user.id, teamMember.user.id]));
    expect(pushedIds).not.toContain(caregiver.user.id);

    // caregiver can still check it off and be attributed
    const occ = await h.db.prepare(
      "SELECT id FROM care_task_occurrences WHERE task_id = ? AND status = 'pending'"
    ).get(tId);
    const check = await h.request.post(`/api/care-tasks/occurrences/${occ.id}/check`)
      .set(h.auth(caregiver.token)).send({ status: "done" });
    expect(check.status).toBe(200);
    expect(check.body.occurrence.completed_by_user_id).toBe(caregiver.user.id);
  });

  test("pausing the task removes today's pending occurrence from the feed", async () => {
    // fresh task due later today, then pause it
    const create = await h.request.post("/api/care-tasks").set(h.auth(family.token)).send({
      care_recipient_id: recipientId, title: "Bath day", task_type: "hygiene",
      recurrence: "daily", due_time: "23:59", start_date: todayStr(),
    });
    const t2 = create.body.task.id;
    const pause = await h.request.put(`/api/care-tasks/${t2}`)
      .set(h.auth(family.token)).send({ is_active: 0 });
    expect(pause.status).toBe(200);
    const pending = await h.db.prepare(
      "SELECT * FROM care_task_occurrences WHERE task_id = ? AND status = 'pending'"
    ).all(t2);
    expect(pending).toHaveLength(0);
  });
});
