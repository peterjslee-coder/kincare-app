/**
 * v1.109.6 — the family's instructions are acknowledged on their own, and changes made during a
 * visit reach the caregiver.
 *
 * Pete, 9/28: "if I leave caregiver instructions, does it require the caretaker to acknowledge
 * them? I get the sense Tina is just sort of blasting through the check in and missing notes."
 */
const { v4: uuid } = require("uuid");
const { startHarness, stopHarness } = require("./harness");

jest.setTimeout(180000);

let h, db, family, tina, stranger, recipientId, tinaProfileId;
const emitted = [];

beforeAll(async () => {
  h = await startHarness({ routers: {
    "/api/sessions": "../../src/routes/sessions",
    "/api/dashboard": "../../src/routes/dashboard",
  } });
  db = h.db;
  h.app.set("emitToUser", (userId, event, payload) => emitted.push({ userId, event, payload }));
  family = await h.createUser({ roles: ["family"], firstName: "Pete" });
  tina = await h.createUser({ roles: ["caregiver"], firstName: "Tina" });
  stranger = await h.createUser({ roles: ["caregiver"] });
  recipientId = (await h.createCareTeam({ familyUserId: family.user.id })).recipientId;
  tinaProfileId = uuid();
  await db.prepare(
    "INSERT INTO caregiver_profiles (id, user_id, hourly_rate, is_background_checked, created_at) VALUES (?, ?, 25, 1, NOW())"
  ).run(tinaProfileId, tina.user.id);
  await db.prepare(
    "INSERT INTO caregiver_profiles (id, user_id, hourly_rate, is_background_checked, created_at) VALUES (?, ?, 25, 1, NOW())"
  ).run(uuid(), stranger.user.id);
});

afterAll(async () => { await stopHarness(h); });

async function visit(status, instructions = "Help her shower.") {
  const id = uuid();
  await db.prepare(`
    INSERT INTO care_sessions (id, care_recipient_id, family_user_id, caregiver_id, service_type,
                               status, scheduled_date, scheduled_time, duration_hours, special_instructions, created_at)
    VALUES (?, ?, ?, ?, 'companionship', ?, '2026-12-01', '10:00', 2, ?, NOW())
  `).run(id, recipientId, family.user.id, tinaProfileId, status, instructions);
  return id;
}
const row = (id) => db.prepare("SELECT * FROM care_sessions WHERE id = ?").get(id);
const put = (id, body) => h.request.put(`/api/sessions/${id}/instructions`).set(h.auth(family.token)).send(body);
const ack = (id, text, who = tina) => h.request.post(`/api/sessions/${id}/instructions/acknowledge`).set(h.auth(who.token)).send({ text });

describe("editing instructions", () => {
  test("the Edit box replaces — it no longer doubles the text", async () => {
    const id = await visit("confirmed", "Help her shower.");
    const res = await put(id, { specialInstructions: "Help her shower.\nAnd lunch at noon.", mode: "replace" });
    expect(res.status).toBe(200);
    expect((await row(id)).special_instructions).toBe("Help her shower.\nAnd lunch at noon.");
  });

  test("append stays the default (the Messages suggestion relies on it)", async () => {
    const id = await visit("confirmed", "Help her shower.");
    await put(id, { specialInstructions: "Lunch at noon." });
    expect((await row(id)).special_instructions).toBe("Help her shower.\n\nLunch at noon.");
  });

  test("saving the same words is not a change and does not re-ask her", async () => {
    const id = await visit("in_progress", "Help her shower.");
    const before = emitted.length;
    const res = await put(id, { specialInstructions: "Help her shower.", mode: "replace" });
    expect(res.body.unchanged).toBe(true);
    expect((await row(id)).instructions_updated_at).toBeNull();
    expect(emitted.length).toBe(before);
  });

  test("a change during a visit is sent to the caregiver", async () => {
    const id = await visit("in_progress", "Help her shower.");
    const res = await put(id, { specialInstructions: "Please do the shower before lunch." , mode: "replace" });
    expect(res.body.caregiverNotified).toBe(true);
    expect((await row(id)).instructions_updated_at).not.toBeNull();
    expect(emitted.some(e => e.userId === tina.user.id && e.event === "instructions_updated" && e.payload.sessionId === id)).toBe(true);
  });

  test("a change before check-in does not buzz her — check-in will ask", async () => {
    const id = await visit("confirmed", "Help her shower.");
    const res = await put(id, { specialInstructions: "Lunch too.", mode: "replace" });
    expect(res.body.caregiverNotified).toBe(false);
  });
});

describe("acknowledging", () => {
  test("the assigned caregiver acknowledges the text on her screen", async () => {
    const id = await visit("in_progress", "Help her shower.");
    const res = await ack(id, "Help her shower.");
    expect(res.status).toBe(200);
    expect((await row(id)).instructions_acknowledged_at).not.toBeNull();
    expect(emitted.some(e => e.userId === family.user.id && e.payload && e.payload.instructionsAcknowledged)).toBe(true);
  });

  test("an acknowledgement for words that have since changed stamps nothing", async () => {
    const id = await visit("in_progress", "Help her shower.");
    await put(id, { specialInstructions: "Shower AND lunch.", mode: "replace" });
    const res = await ack(id, "Help her shower.");
    expect(res.status).toBe(409);
    expect(res.body.special_instructions).toBe("Shower AND lunch.");
    expect((await row(id)).instructions_acknowledged_at).toBeNull();
  });

  test("a change after acknowledging asks again (dashboard flag)", async () => {
    const { instructionsNeedAck } = require("../../src/utils/instructionAck");
    const id = await visit("in_progress", "Help her shower.");
    await ack(id, "Help her shower.");
    expect(instructionsNeedAck(await row(id))).toBe(false);
    await new Promise(r => setTimeout(r, 20));
    await put(id, { specialInstructions: "Also lunch.", mode: "replace" });
    expect(instructionsNeedAck(await row(id))).toBe(true);
  });

  test("the caregiver's dashboard carries the flag on an active visit", async () => {
    const id = await visit("in_progress", "Watch the stairs.");
    const res = await h.request.get("/api/dashboard").set(h.auth(tina.token));
    expect(res.status).toBe(200);
    const s = (res.body.upcomingSessions || []).find(x => x.id === id);
    expect(s).toBeTruthy();
    expect(s.instructionsNeedAck).toBe(true);
    await ack(id, "Watch the stairs.");
    const res2 = await h.request.get("/api/dashboard").set(h.auth(tina.token));
    expect(res2.body.upcomingSessions.find(x => x.id === id).instructionsNeedAck).toBe(false);
  });

  test("someone else's caregiver cannot acknowledge — and it looks like no session", async () => {
    const id = await visit("in_progress", "Help her shower.");
    const res = await ack(id, "Help her shower.", stranger);
    expect(res.status).toBe(404);
    expect((await row(id)).instructions_acknowledged_at).toBeNull();
  });

  test("the family cannot acknowledge on her behalf", async () => {
    const id = await visit("in_progress", "Help her shower.");
    const res = await ack(id, "Help her shower.", family);
    expect(res.status).toBe(404);
  });

  test("a finished visit cannot be acknowledged", async () => {
    const id = await visit("completed", "Help her shower.");
    expect((await ack(id, "Help her shower.")).status).toBe(400);
  });
});
