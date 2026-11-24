/**
 * A care task due more than once a day — against the real schema. (v1.105.147)
 *
 * Pete, from the hospital: "Would like more availability to check this task off three times
 * where I can mark morning lunch and dinner medication."
 *
 * `care_tasks.due_time` held exactly one time, and `care_task_occurrences` was UNIQUE on
 * (task_id, due_date) — one dose per day, enforced by the database. Three separate tasks is
 * not the same thing: three names to read, three histories, and three rows that never add up
 * to "did she get her meds today".
 *
 * This is an integration test rather than a unit test because the thing that had to change is
 * a UNIQUE constraint. A mocked db will happily accept three rows it would have rejected.
 */
const { startHarness, stopHarness } = require("./harness");

jest.setTimeout(180000);

const ROUTERS = { "/api/care-tasks": "../../src/routes/careTasks" };

let h, family, recipientId;

beforeAll(async () => {
  h = await startHarness({ routers: ROUTERS });
  family = await h.createUser({ roles: ["family"], firstName: "Pete" });
  const t = await h.createCareTeam({ familyUserId: family.user.id });
  recipientId = t.recipientId;
});

afterAll(async () => { await stopHarness(h); });

const todayStr = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());

const todaysOccurrences = async () => {
  const res = await h.request.get("/api/care-tasks/today").set(h.auth(family.token));
  expect(res.status).toBe(200);
  const group = (res.body.groups || []).find((g) => g.careRecipientId === recipientId);
  return (group?.occurrences || []).filter((o) => o.title === "Betty's medication");
};

let taskId;

describe("three doses, one task", () => {
  test("a task with three times makes three occurrences for one day", async () => {
    const res = await h.request.post("/api/care-tasks").set(h.auth(family.token)).send({
      care_recipient_id: recipientId,
      title: "Betty's medication",
      task_type: "medication",
      recurrence: "daily",
      due_times: ["08:00", "12:30", "18:00"],
      start_date: todayStr(),
      grace_minutes: 45,
    });
    expect(res.status).toBe(201);
    taskId = res.body.task.id;
    // due_time survives as the first of them: the reminder poller and the history strip
    // still read it, and breaking those for a UI feature is not a trade worth making.
    expect(res.body.task.due_time).toBe("08:00");

    const occ = await todaysOccurrences();
    expect(occ).toHaveLength(3);
    expect(occ.map((o) => o.slot_index)).toEqual([0, 1, 2]);
  });

  test("each row is labelled with ITS time, not the task's first", () => {
    // Labelling every dose "8:00 AM" would be worse than no label: it is a screen telling you
    // the evening dose is the morning one.
    return todaysOccurrences().then((occ) => {
      expect(occ.map((o) => o.occ_time)).toEqual(["08:00", "12:30", "18:00"]);
    });
  });

  test("checking off lunch leaves breakfast and dinner alone", async () => {
    const before = await todaysOccurrences();
    const lunch = before.find((o) => o.occ_time === "12:30");
    const res = await h.request.post(`/api/care-tasks/occurrences/${lunch.id}/check`)
      .set(h.auth(family.token)).send({});
    expect(res.status).toBe(200);

    const after = await todaysOccurrences();
    const byTime = Object.fromEntries(after.map((o) => [o.occ_time, o.status]));
    expect(byTime["12:30"]).toBe("done");
    expect(byTime["08:00"]).toBe("pending");
    expect(byTime["18:00"]).toBe("pending");
  });

  test("re-materializing does not duplicate or disturb what is already recorded", async () => {
    // /today materializes on every call. Three doses must stay three, and the done one stays
    // done — this is the constraint the old UNIQUE(task_id, due_date) used to guarantee for
    // one row and now has to guarantee per slot.
    await todaysOccurrences();
    await todaysOccurrences();
    const occ = await todaysOccurrences();
    expect(occ).toHaveLength(3);
    expect(occ.filter((o) => o.status === "done")).toHaveLength(1);
  });

  test("dropping a time removes its pending row and keeps the history", async () => {
    const res = await h.request.put(`/api/care-tasks/${taskId}`).set(h.auth(family.token))
      .send({ due_times: ["08:00", "12:30"] });
    expect(res.status).toBe(200);

    const occ = await todaysOccurrences();
    expect(occ.map((o) => o.occ_time)).toEqual(["08:00", "12:30"]);
    // The lunch dose was already given. Removing the evening time must not rewrite that.
    expect(occ.find((o) => o.occ_time === "12:30").status).toBe("done");
  });

  test("moving a time moves only that row", async () => {
    const res = await h.request.put(`/api/care-tasks/${taskId}`).set(h.auth(family.token))
      .send({ due_times: ["09:15", "12:30"] });
    expect(res.status).toBe(200);
    const occ = await todaysOccurrences();
    expect(occ.map((o) => o.occ_time)).toEqual(["09:15", "12:30"]);
    expect(occ.find((o) => o.occ_time === "12:30").status).toBe("done");
  });
});

describe("everything written before this still behaves exactly as it did", () => {
  test("a task created the old way, with due_time, makes exactly one occurrence", async () => {
    const res = await h.request.post("/api/care-tasks").set(h.auth(family.token)).send({
      care_recipient_id: recipientId,
      title: "Evening walk",
      task_type: "custom",
      recurrence: "daily",
      due_time: "19:00",
      start_date: todayStr(),
    });
    expect(res.status).toBe(201);

    const today = await h.request.get("/api/care-tasks/today").set(h.auth(family.token));
    const group = today.body.groups.find((g) => g.careRecipientId === recipientId);
    const walk = group.occurrences.filter((o) => o.title === "Evening walk");
    expect(walk).toHaveLength(1);
    expect(walk[0].slot_index).toBe(0);
    expect(walk[0].occ_time).toBe("19:00");
  });

  test("an empty list is refused rather than silently making a task nobody is ever due for", async () => {
    const res = await h.request.post("/api/care-tasks").set(h.auth(family.token)).send({
      care_recipient_id: recipientId, title: "Nothing", recurrence: "daily",
      due_times: [], start_date: todayStr(),
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at least one time/i);
  });
});
