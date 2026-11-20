/**
 * v1.138.0 — doses follow the caregiver on shift; a dose time nobody covers is a Needs you card
 * (Pete, 11/20, feedback 3ba9c4f5).
 */
const { startHarness, stopHarness } = require("./harness");
const { v4: uuid } = require("uuid");
const { attentionItemsFor } = require("../../src/utils/attention");

jest.setTimeout(180000);

let h, pete, tina, recipientId, noonTaskId, nightTaskId;
const todayStr = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());

beforeAll(async () => {
  h = await startHarness({ routers: { "/api/care-tasks": "../../src/routes/careTasks", "/api/push": "../../src/routes/push" } });
  pete = await h.createUser({ roles: ["family"], firstName: "Pete" });
  tina = await h.createUser({ roles: ["caregiver"], firstName: "Tina" });
  ({ recipientId } = await h.createCareTeam({ familyUserId: pete.user.id }));
  await h.db.prepare("UPDATE care_recipients SET timezone = 'America/New_York' WHERE id = ?").run(recipientId);
  const pid = uuid();
  await h.db.prepare("INSERT INTO caregiver_profiles (id, user_id, hourly_rate, created_at) VALUES (?, ?, 25, NOW())").run(pid, tina.user.id);
  await h.db.prepare(`INSERT INTO care_sessions (id, care_recipient_id, family_user_id, caregiver_id, service_type, status,
      scheduled_date, scheduled_time, duration_hours, created_at)
    VALUES (?, ?, ?, ?, 'companionship', 'confirmed', ?, '09:00', 8, NOW())`).run(uuid(), recipientId, pete.user.id, pid, todayStr());
  const mk = async (title, time) => (await h.request.post("/api/care-tasks").set(h.auth(pete.token)).send({
    care_recipient_id: recipientId, title, task_type: "medication", recurrence: "daily", due_time: time, start_date: todayStr(),
  })).body.task.id;
  noonTaskId = await mk("Noon meds", "12:00");
  nightTaskId = await mk("Night meds", "21:00");
});
afterAll(async () => { await stopHarness(h); });

test("the noon dose is Tina's because she's on shift; the 9 PM dose has nobody", async () => {
  const res = await h.request.get("/api/care-tasks/today").set(h.auth(pete.token));
  const occs = res.body.groups.find((g) => g.careRecipientId === recipientId).occurrences;
  const noon = occs.find((o) => o.task_id === noonTaskId);
  const night = occs.find((o) => o.task_id === nightTaskId);
  expect(noon).toMatchObject({ assigned_user_id: tina.user.id, assignee_first_name: "Tina", on_shift: true });
  expect(night.on_shift).toBe(false);
  expect(night.assigned_user_id).toBeFalsy();
});

test("Needs you asks about the 9 PM dose only, and 'Leave unassigned' puts it away", async () => {
  const items = (await attentionItemsFor(h.db, pete.user.id)).items.filter((i) => i.kind === "medUncovered");
  expect(items).toHaveLength(2); // noon is uncovered on the six days Tina isn't booked
  const night = items.find((i) => i.title.includes("Night meds"));
  expect(night.title).toBe("No caregiver on shift for Night meds at 9 PM");
  expect(night.detail).toBe("every day this week");
  expect(night.focus).toBe(`careTaskEdit:${nightTaskId}`);
  const noon = items.find((i) => i.title.includes("Noon meds"));
  expect(noon.detail.split(", ")).toHaveLength(6); // today is covered

  const r = await h.request.post("/api/push/attention/snooze").set(h.auth(pete.token)).send(night.dismiss.body);
  expect(r.status).toBe(200);
  const after = (await attentionItemsFor(h.db, pete.user.id)).items.filter((i) => i.kind === "medUncovered");
  expect(after.find((i) => i.title.includes("Night meds"))).toBeUndefined();
});

test("Tina doesn't get the card", async () => {
  const items = (await attentionItemsFor(h.db, tina.user.id)).items || [];
  expect(items.filter((i) => i.kind === "medUncovered")).toHaveLength(0);
});
