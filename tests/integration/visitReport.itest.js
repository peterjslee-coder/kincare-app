/**
 * v1.108.0 — the visit report, end to end against real Postgres.
 *
 * Pete, 9/16: meals, bathing, appointments, mobility — every row needs a tap ("Didn't come
 * up" counts), follow-ups chosen by rules from the last report, and the family sees it.
 */
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "sk_test_integration_fake";
jest.mock("stripe", () => jest.fn(() => ({
  paymentIntents: {
    create: jest.fn(async (args) => ({ id: "pi_x", status: "succeeded", amount: args.amount })),
    capture: jest.fn(async (id) => ({ id, status: "succeeded", amount_received: 0 })),
    retrieve: jest.fn(async (id) => ({ id, status: "requires_capture" })),
    cancel: jest.fn(async (id) => ({ id, status: "canceled" })),
  },
  paymentMethods: { list: jest.fn(async () => ({ data: [] })) },
})));
const mockPush = jest.fn(async () => ({ sent: 1 }));
jest.mock("../../src/routes/push", () => {
  const actual = jest.requireActual("../../src/routes/push");
  return { ...actual, sendPushToUser: (...a) => mockPush(...a), notifyAdmins: jest.fn() };
});

const { v4: uuid } = require("uuid");
const { startHarness, stopHarness } = require("./harness");
const { zonedDateTimeToInstant } = require("../../src/utils/timezone");

jest.setTimeout(180000);

const TZ = "America/New_York";
const DAY1 = "2030-01-15";
const DAY2 = "2030-01-16";
let h, db, family, tina, profileId, recipientId, taskId;

beforeAll(async () => {
  h = await startHarness({ routers: { "/api/sessions": "../../src/routes/sessions" } });
  db = h.db;
  family = await h.createUser({ firstName: "Peter", roles: ["family"] });
  ({ recipientId } = await h.createCareTeam({ familyUserId: family.user.id }));
  await db.prepare("UPDATE care_recipients SET first_name = 'Betty', timezone = ? WHERE id = ?").run(TZ, recipientId);
  tina = await h.createUser({ firstName: "Tina", roles: ["caregiver"] });
  profileId = uuid();
  await db.prepare("INSERT INTO caregiver_profiles (id, user_id, hourly_rate, created_at) VALUES (?, ?, 22, NOW())").run(profileId, tina.user.id);
  taskId = uuid();
  await db.prepare(`
    INSERT INTO care_tasks (id, care_recipient_id, created_by, title, task_type, recurrence, due_time, start_date)
    VALUES (?, ?, ?, 'Morning pills', 'medication', 'daily', '10:00', ?)
  `).run(taskId, recipientId, family.user.id, DAY1);
});
afterAll(async () => { await stopHarness(h); });

async function visit(date, { service = "companionship", occStatus = "pending" } = {}) {
  const sid = uuid();
  await db.prepare(`
    INSERT INTO care_sessions (id, care_recipient_id, family_user_id, caregiver_id, service_type, status,
      scheduled_date, scheduled_time, duration_hours, estimated_cost, created_at)
    VALUES (?, ?, ?, ?, ?, 'in_progress', ?, '09:00', 8, 176, NOW())
  `).run(sid, recipientId, family.user.id, profileId, service, date);
  await db.prepare(`
    INSERT INTO visit_logs (id, session_id, caregiver_id, check_in_time, created_at)
    VALUES (?, ?, ?, NOW() - interval '8 hours', NOW())
  `).run(uuid(), sid, profileId);
  const occId = uuid();
  await db.prepare(`
    INSERT INTO care_task_occurrences (id, task_id, due_date, due_at, slot_index, status)
    VALUES (?, ?, ?, ?, 0, ?)
    ON CONFLICT (task_id, due_date, slot_index) DO NOTHING
  `).run(occId, taskId, date, zonedDateTimeToInstant(date, "10:00", TZ).toISOString(), occStatus);
  const inShift = uuid();
  const afterShift = uuid();
  for (const [id, title, t] of [[inShift, "PT with Sean", "10:00"], [afterShift, "Evening call", "18:30"]]) {
    await db.prepare(`
      INSERT INTO care_events (id, care_recipient_id, created_by, title, event_date, event_time, starts_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, recipientId, family.user.id, title, date, t, zonedDateTimeToInstant(date, t, TZ).toISOString());
  }
  return { sid, occId, inShift, afterShift };
}

const getForm = async (sid) => {
  const r = await h.request.get(`/api/sessions/${sid}/visit-report/form`).set(h.auth(tina.token));
  expect(r.status).toBe(200);
  return r.body.form;
};
const rows = (form) => form.groups.flatMap((g) => g.rows);
const answerAll = (form, pick = {}) => rows(form).map((r) => ({
  topic: r.topic, ref: r.ref, value: pick[r.key] || r.options[0].value,
}));
const checkOut = (sid, visitReport) =>
  h.request.post(`/api/sessions/${sid}/check-out`).set(h.auth(tina.token)).send({ summary: "Good day", visitReport });

let v1;
describe("day one", () => {
  test("the form asks about the meals, dose and appointment inside a 9–5 shift, and nothing else", async () => {
    v1 = await visit(DAY1);
    const form = await getForm(v1.sid);
    const keys = rows(form).map((r) => r.key);
    expect(keys).toEqual(expect.arrayContaining(["meal|breakfast", "meal|lunch", "fluids|", "toileting|", "arrival|", "nap|", "mobility|", "fall|", `med|${taskId}:0`, `appt|${v1.inShift}`]));
    expect(keys).not.toContain("meal|dinner");
    expect(keys).not.toContain(`appt|${v1.afterShift}`);
    expect(keys).not.toContain("bath|"); // not a personal-care booking
    expect(rows(form).every((r) => r.options.some((o) => o.value === "na"))).toBe(true);
    expect(form.followUps).toEqual([]);
  });

  test("only the assigned caregiver can load it", async () => {
    const r = await h.request.get(`/api/sessions/${v1.sid}/visit-report/form`).set(h.auth(family.token));
    expect(r.status).toBe(404);
  });

  test("a report with a row left blank is refused, and the visit stays open", async () => {
    const form = await getForm(v1.sid);
    const partial = answerAll(form).filter((a) => a.topic !== "fluids");
    const r = await checkOut(v1.sid, partial);
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("VISIT_REPORT_INCOMPLETE");
    expect(r.body.missing).toContain("Drinks");
    expect((await db.prepare("SELECT status FROM care_sessions WHERE id = ?").get(v1.sid)).status).toBe("in_progress");
  });

  test("a complete report checks out, is stored, closes the dose, and raises a fall", async () => {
    const form = await getForm(v1.sid);
    mockPush.mockClear();
    const answers = answerAll(form, { "meal|lunch": "little", "fall|": "near", "arrival|": "asleep", [`med|${taskId}:0`]: "taken" })
      .map((a) => (a.topic === "fall" ? { ...a, note: "Caught her by the stairs" } : a));
    const r = await checkOut(v1.sid, answers);
    expect(r.status).toBe(200);
    const stored = await db.prepare("SELECT COUNT(*)::int AS n FROM visit_report_answers WHERE session_id = ?").get(v1.sid);
    expect(stored.n).toBe(rows(form).length);
    const occ = await db.prepare("SELECT status, completed_by_user_id FROM care_task_occurrences WHERE id = ?").get(v1.occId);
    expect(occ).toEqual({ status: "done", completed_by_user_id: tina.user.id });
    const note = await db.prepare("SELECT content, needs_attention FROM recipient_notes WHERE care_recipient_id = ? AND needs_attention = 1").get(recipientId);
    expect(note.content).toMatch(/near-fall/);
    const flag = await db.prepare("SELECT severity FROM safety_flags WHERE flag_type = 'visit_report_fall'").get();
    expect(flag.severity).toBe("medium");
    const toFamily = mockPush.mock.calls.filter((c) => c[0] === family.user.id && c[1].data.type === "observation_attention");
    expect(toFamily).toHaveLength(1);
    expect(toFamily[0][1].body).not.toMatch(/fall/i); // nothing about it on the lock screen
  });

  test("the family reads it, labelled, with the concerns counted", async () => {
    const r = await h.request.get(`/api/sessions/${v1.sid}`).set(h.auth(family.token));
    expect(r.status).toBe(200);
    const items = r.body.visitReport.groups.flatMap((g) => g.items);
    const lunch = items.find((i) => i.topic === "meal" && i.ref === "lunch");
    expect(lunch).toEqual(expect.objectContaining({ label: "Lunch", answer: "A little", concern: true }));
    expect(items.find((i) => i.topic === "med").label).toBe("Morning pills");
    expect(items.find((i) => i.topic === "appt").label).toBe("PT with Sean");
    expect(r.body.visitReport.concerns).toBe(2);
  });

  test("an app that sends no report still checks out", async () => {
    const legacy = await visit("2030-01-10");
    const r = await h.request.post(`/api/sessions/${legacy.sid}/check-out`).set(h.auth(tina.token)).send({ summary: "old app" });
    expect(r.status).toBe(200);
  });
});

describe("day two", () => {
  let v2;
  test("the next visit asks about what was flagged, on the rows they belong to", async () => {
    v2 = await visit(DAY2, { service: "personal_care" });
    const form = await getForm(v2.sid);
    const byKey = new Map(rows(form).map((r) => [r.key, r]));
    expect(byKey.has("bath|")).toBe(true); // personal care this time
    expect(form.followUps.length).toBeGreaterThanOrEqual(3);
    expect(form.followUps.length).toBeLessThanOrEqual(3);
    // Concerns first: the near-fall and lunch outrank "asleep on arrival".
    expect(form.followUps.map((f) => f.key)).toEqual(["fall|", "meal|lunch", "arrival|"]);
    expect(byKey.get("meal|lunch").followUp).toMatch(/Lunch — “A little”/);
    expect(byKey.get("fall|").followUp).toMatch(/Caught her by the stairs/);
  });

  test("the family sees what changed since last time", async () => {
    const form = await getForm(v2.sid);
    const r = await checkOut(v2.sid, answerAll(form, { "meal|lunch": "all" }));
    expect(r.status).toBe(200);
    const view = await h.request.get(`/api/sessions/${v2.sid}`).set(h.auth(family.token));
    const lunch = view.body.visitReport.groups.flatMap((g) => g.items).find((i) => i.topic === "meal" && i.ref === "lunch");
    expect(lunch.answer).toBe("All of it");
    expect(lunch.changedFrom).toBe("A little");
    const fluids = view.body.visitReport.groups.flatMap((g) => g.items).find((i) => i.topic === "fluids");
    expect(fluids.changedFrom).toBeNull();
  });

  test("the day-one report still compares against what came before IT, not day two", async () => {
    const r = await h.request.get(`/api/sessions/${v1.sid}`).set(h.auth(family.token));
    const lunch = r.body.visitReport.groups.flatMap((g) => g.items).find((i) => i.topic === "meal" && i.ref === "lunch");
    expect(lunch.changedFrom).toBeNull();
  });
});

describe("day three — patterns, not just yesterday (v1.109.2)", () => {
  test("the same answer twice running is described as a run, and asked about", async () => {
    // Day one and day two both had lunch flagged? No — day two was "all". So set up a run of
    // long naps across the two days that already exist, then open a third visit.
    for (const sid of (await db.prepare(
      "SELECT DISTINCT session_id FROM visit_report_answers WHERE care_recipient_id = ? ORDER BY session_id"
    ).all(recipientId)).map((r) => r.session_id)) {
      await db.prepare("UPDATE visit_report_answers SET value = 'long' WHERE session_id = ? AND topic = 'nap'").run(sid);
    }
    const v3 = await visit("2030-01-17");
    const form = await getForm(v3.sid);
    const nap = form.groups.flatMap((g) => g.rows).find((r) => r.key === "nap|");
    expect(nap.followUp).toMatch(/Rest has been “long nap \(1h\+\)” on the last 2 visits for Betty/);
    expect(nap.followUp).toMatch(/Is that true today\?/);
    expect(nap.trend).toEqual(expect.objectContaining({ run: 2, answer: "long" }));
  });

  test("a report older than the window is not a pattern", async () => {
    await db.prepare("UPDATE visit_report_answers SET created_at = NOW() - interval '20 days' WHERE care_recipient_id = ?").run(recipientId);
    const v4 = await visit("2030-01-18");
    const form = await getForm(v4.sid);
    expect(form.followUps).toEqual([]);
  });
});
