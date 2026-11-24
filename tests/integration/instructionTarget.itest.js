/**
 * v1.125.2 — feedback bba0e539. Pete: "when I texted Tina an instruction iPAi asked me if I
 * wanted to add it to the caregiver instructions. However, it's showing up as an instruction for
 * today, not yesterday."
 *
 * The model is stubbed; what is tested is what we GIVE it and what we let through:
 *   - a visit underway, and a visit later today in care-local time, are on the list
 *     (the old filter used the database's UTC date and excluded in_progress);
 *   - the prompt states today's date;
 *   - texting a caregiver narrows the list to that caregiver's visits;
 *   - an id the model invents is dropped; the label comes from the visit, not the model.
 */
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "itest-key";
const { v4: uuid } = require("uuid");
const mockCalls = [];
let mockReply = null;
jest.mock("../../src/utils/aiModels", () => {
  const actual = jest.requireActual("../../src/utils/aiModels");
  return {
    ...actual,
    getAnthropic: () => ({ messages: { create: async (req) => { mockCalls.push(req); return { content: [{ text: JSON.stringify(mockReply) }] }; } } }),
  };
});
const { getTodayStringInZone } = require("../../src/utils/timezone");
const { startHarness, stopHarness } = require("./harness");
jest.setTimeout(180000);

let h, db, t;
beforeAll(async () => {
  h = await startHarness({ routers: { "/api/ipai": "../../src/routes/ipaiChat" } });
  db = h.db;
  const family = await h.createUser({ firstName: "Pete" });
  const { recipientId } = await h.createCareTeam({ familyUserId: family.user.id });
  await db.prepare("UPDATE care_recipients SET timezone = 'America/New_York' WHERE id = ?").run(recipientId);
  const mk = async (name) => {
    const u = await h.createUser({ firstName: name, roles: ["caregiver"] });
    const pid = uuid();
    await db.prepare("INSERT INTO caregiver_profiles (id, user_id, hourly_rate, created_at) VALUES (?, ?, 25, NOW())").run(pid, u.user.id);
    return { ...u, pid };
  };
  const tina = await mk("Tina");
  const olga = await mk("Olga");
  const today = getTodayStringInZone("America/New_York");
  const plus = (n) => { const [y, m, d] = today.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().split("T")[0]; };
  const visit = async (cg, date, status, time = "16:00") => {
    const id = uuid();
    await db.prepare(`INSERT INTO care_sessions (id, care_recipient_id, family_user_id, caregiver_id, service_type, status, scheduled_date, scheduled_time, duration_hours, created_at)
      VALUES (?, ?, ?, ?, 'companionship', ?, ?, ?, 2, NOW())`).run(id, recipientId, family.user.id, cg.pid, status, date, time);
    return id;
  };
  const ids = {
    yesterdayDone: await visit(tina, plus(-1), "completed"),
    nowTina: await visit(tina, today, "in_progress", "00:01"),
    tomorrowTina: await visit(tina, plus(1), "confirmed"),
    tomorrowOlga: await visit(olga, plus(1), "confirmed", "09:00"),
  };
  // a conversation between Pete and Tina
  const conv = uuid();
  await db.prepare("INSERT INTO conversations (id, type, created_by) VALUES (?, 'direct', ?)").run(conv, family.user.id);
  for (const u of [family.user.id, tina.user.id]) {
    await db.prepare("INSERT INTO conversation_members (id, conversation_id, user_id) VALUES (?, ?, ?)").run(uuid(), conv, u);
  }
  // somebody else's conversation, to prove it cannot be used
  const foreign = uuid();
  await db.prepare("INSERT INTO conversations (id, type, created_by) VALUES (?, 'direct', ?)").run(foreign, olga.user.id);
  await db.prepare("INSERT INTO conversation_members (id, conversation_id, user_id) VALUES (?, ?, ?)").run(uuid(), foreign, olga.user.id);
  t = { family, tina, olga, ids, conv, foreign, today };
});
afterAll(async () => { await stopHarness(h); });

const detect = (body) => h.request.post("/api/ipai/detect-instructions").set(h.auth(t.family.token)).send(body);
const MSG = "Tonight please have her water the kitchen plant before you leave";

test("the visit underway is on the list, today's date is stated, and Tina's conversation narrows it to Tina", async () => {
  mockCalls.length = 0;
  mockReply = { hasInstructions: true, instructionSummary: "Please water the kitchen plant — thank you! 🌱", matchedSessionId: t.ids.nowTina, matchedSessionLabel: "made up" };
  const r = await detect({ message: MSG, conversationId: t.conv });
  expect(r.status).toBe(200);
  const sys = mockCalls[0].system;
  expect(sys).toContain(`(${t.today})`);
  expect(sys).toMatch(/TODAY is /);
  expect(sys).toContain(t.ids.nowTina);
  expect(sys).toMatch(/IN PROGRESS NOW/);
  expect(sys).toContain(t.ids.tomorrowTina);
  expect(sys).not.toContain(t.ids.tomorrowOlga);   // texting Tina is about Tina
  expect(sys).not.toContain(t.ids.yesterdayDone);  // finished visits are not candidates
  expect(r.body.suggestion.sessionId).toBe(t.ids.nowTina);
  expect(r.body.suggestion.sessionLabel).toMatch(/^Tina — .* · in progress now$/);
  expect(r.body.suggestion.alternatives.map((a) => a.sessionId)).toEqual([t.ids.nowTina, t.ids.tomorrowTina]);
});

test("without a conversation, every upcoming visit is a candidate", async () => {
  mockCalls.length = 0;
  mockReply = { hasInstructions: true, instructionSummary: "x please", matchedSessionId: t.ids.tomorrowOlga };
  const r = await detect({ message: MSG });
  expect(mockCalls[0].system).toContain(t.ids.tomorrowOlga);
  expect(r.body.suggestion.sessionId).toBe(t.ids.tomorrowOlga);
});

test("a conversation the sender is not in narrows nothing and reveals nothing", async () => {
  mockCalls.length = 0;
  mockReply = { hasInstructions: true, instructionSummary: "x please", matchedSessionId: t.ids.tomorrowOlga };
  await detect({ message: MSG, conversationId: t.foreign });
  expect(mockCalls[0].system).toContain(t.ids.tomorrowTina);
  expect(mockCalls[0].system).toContain(t.ids.tomorrowOlga);
});

test("an id the model made up is dropped", async () => {
  mockReply = { hasInstructions: true, instructionSummary: "x please", matchedSessionId: uuid() };
  const r = await detect({ message: MSG, conversationId: t.conv });
  expect(r.body.suggestion).toBeNull();
});

test("same-day words now get past the pre-screen", async () => {
  mockCalls.length = 0;
  mockReply = { hasInstructions: false, instructionSummary: null, matchedSessionId: null };
  await detect({ message: "Tonight she wants her tea at eight o'clock" });
  expect(mockCalls).toHaveLength(1);
});
