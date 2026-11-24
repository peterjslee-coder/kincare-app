/**
 * Asking how she found her, once she has had a chance to look. (v1.106.48)
 *
 * Pete: "There needs to be a mechanism to have the caregiver leave feedback on found condition
 * 15 minutes after start. We're asking them to declare how the patient is doing before they've
 * had a chance to interact when they start their day. A trigger 15 minutes later to ask them to
 * return to check-in would be ideal."
 *
 * He is right that the old question was unanswerable: a caregiver taps check in at the door and
 * is immediately shown eight faces and asked which one Betty is. Whatever she picks is a guess,
 * and a guess recorded as an observation is worse than none — the family reads it as one.
 *
 * Two halves are tested here, because they are deliberately different questions and the split
 * is the design: the PROMPT goes out once (or a poller running every minute buzzes her every
 * minute), and her own screen keeps OFFERING until she actually answers (or swiping a
 * notification away takes the question with it).
 */
const { startHarness, stopHarness } = require("./harness");
const { v4: uuid } = require("uuid");

// Today in the care location's zone. These visits used to carry a hard-coded date, and every
// suite that reads "today's" sessions went red at midnight on the day after it was written.
const TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
const { visitsDueConditionRead, conditionReadDue, SETTLED_MINUTES } = require("../../src/utils/settledCheck");

jest.setTimeout(180000);

const ROUTERS = {
  "/api/sessions": "../../src/routes/sessions",
  "/api/dashboard": "../../src/routes/dashboard",
};

let h, db, pete, tina, tinaProfileId, recipientId;

beforeAll(async () => {
  h = await startHarness({ routers: ROUTERS });
  db = h.db;
  pete = await h.createUser({ roles: ["family"], firstName: "Pete" });
  ({ recipientId } = await h.createCareTeam({ familyUserId: pete.user.id }));
  tina = await h.createUser({ roles: ["caregiver"], firstName: "Tina" });
  tinaProfileId = uuid();
  await db.prepare(
    "INSERT INTO caregiver_profiles (id, user_id, hourly_rate, created_at) VALUES (?, ?, 25, NOW())"
  ).run(tinaProfileId, tina.user.id);
});

afterAll(async () => { await stopHarness(h); });
beforeEach(async () => {
  await db.prepare("DELETE FROM visit_logs").run();
  await db.prepare("DELETE FROM care_sessions").run();
});

async function visit({ agoMinutes = 20, mood = null, isTest = 0, status = "in_progress", checkedOut = false } = {}) {
  const sessionId = uuid();
  await db.prepare(`
    INSERT INTO care_sessions (id, care_recipient_id, family_user_id, caregiver_id, service_type,
                               status, scheduled_date, scheduled_time, duration_hours, estimated_cost, created_at)
    VALUES (?, ?, ?, ?, 'companionship', ?, '${TODAY}', '09:00', 8, 200, NOW())
  `).run(sessionId, recipientId, pete.user.id, tinaProfileId, status);
  const logId = uuid();
  await db.prepare(`
    INSERT INTO visit_logs (id, session_id, caregiver_id, check_in_time, arrival_mood, is_test, check_out_time, created_at)
    VALUES (?, ?, ?, NOW() - (? || ' minutes')::interval, ?, ?, ${checkedOut ? "NOW()" : "NULL"}, NOW())
  `).run(logId, sessionId, tinaProfileId, String(agoMinutes), mood, isTest);
  return { sessionId, logId };
}

const due = () => visitsDueConditionRead(db);

describe("who the poller asks", () => {
  test("a visit twenty minutes in, unanswered", async () => {
    const { sessionId } = await visit({ agoMinutes: 20 });
    expect((await due()).map((v) => v.session_id)).toEqual([sessionId]);
  });

  test("not five minutes in — that is the question he objected to", async () => {
    await visit({ agoMinutes: 5 });
    expect(await due()).toEqual([]);
  });

  test("exactly at the threshold, she is asked", async () => {
    await visit({ agoMinutes: SETTLED_MINUTES });
    expect(await due()).toHaveLength(1);
  });

  test("not if she has already said", async () => {
    await visit({ agoMinutes: 40, mood: JSON.stringify(["sleepy"]) });
    expect(await due()).toEqual([]);
  });

  test("not once the visit is over", async () => {
    await visit({ agoMinutes: 40, checkedOut: true });
    expect(await due()).toEqual([]);
  });

  test("not a session that is no longer in progress", async () => {
    await visit({ agoMinutes: 40, status: "completed" });
    expect(await due()).toEqual([]);
  });

  test("never a test check-in — an admin impersonating must not buzz a real phone", async () => {
    await visit({ agoMinutes: 40, isTest: 1 });
    expect(await due()).toEqual([]);
  });

  test("it carries what the push needs, and no health detail", async () => {
    await visit({ agoMinutes: 20 });
    const [v] = await due();
    expect(v.caregiver_user_id).toBe(tina.user.id);
    expect(v.recipient_first_name).toBeTruthy();
    expect(v.visit_log_id).toBeTruthy();
  });
});

describe("asked once, not once a minute", () => {
  test("marking it sent takes it out of the queue", async () => {
    const { logId } = await visit({ agoMinutes: 20 });
    expect(await due()).toHaveLength(1);
    await db.prepare("UPDATE visit_logs SET condition_prompt_sent_at = NOW() WHERE id = ?").run(logId);
    expect(await due()).toEqual([]);
  });

  test("...but her own screen keeps offering it", async () => {
    // The two questions are deliberately different. A caregiver who swiped the notification
    // away still needs somewhere to answer.
    const { sessionId, logId } = await visit({ agoMinutes: 20 });
    await db.prepare("UPDATE visit_logs SET condition_prompt_sent_at = NOW() WHERE id = ?").run(logId);
    const res = await h.request.get("/api/dashboard").set(h.auth(tina.token));
    expect(res.status).toBe(200);
    const s = (res.body.upcomingSessions || []).find((x) => x.id === sessionId);
    expect(s.conditionReadDue).toBe(true);
  });
});

describe("what her card is told", () => {
  const dash = async () => {
    const res = await h.request.get("/api/dashboard").set(h.auth(tina.token));
    expect(res.status).toBe(200);
    return res.body.upcomingSessions || [];
  };

  test("five minutes in, the card does not ask", async () => {
    const { sessionId } = await visit({ agoMinutes: 5 });
    expect((await dash()).find((x) => x.id === sessionId).conditionReadDue).toBe(false);
  });

  test("twenty minutes in, it does", async () => {
    const { sessionId } = await visit({ agoMinutes: 20 });
    expect((await dash()).find((x) => x.id === sessionId).conditionReadDue).toBe(true);
  });

  test("and stops once answered", async () => {
    const { sessionId } = await visit({ agoMinutes: 20, mood: JSON.stringify(["warm"]) });
    expect((await dash()).find((x) => x.id === sessionId).conditionReadDue).toBe(false);
  });
});

describe("recording the answer", () => {
  const post = (sessionId, who, body) =>
    h.request.post(`/api/sessions/${sessionId}/arrival-condition`).set(h.auth(who.token)).send(body);

  test("she can record it, and it lands in arrival_mood", async () => {
    const { sessionId } = await visit({ agoMinutes: 20 });
    const res = await post(sessionId, tina, { mood: ["sleepy", "warm"] });
    expect(res.status).toBe(200);
    const vl = await db.prepare("SELECT arrival_mood FROM visit_logs WHERE session_id = ?").get(sessionId);
    expect(JSON.parse(vl.arrival_mood)).toEqual(["sleepy", "warm"]);
  });

  test("the same column check-in used — one fact, not two", async () => {
    // A second column would split one question in two and leave every reader — the family
    // feed, the briefing, the doctor report — deciding which to trust.
    const { sessionId } = await visit({ agoMinutes: 20 });
    await post(sessionId, tina, { mood: ["happy"] });
    const cols = await db.prepare(`
      SELECT COUNT(*)::int AS n FROM information_schema.columns
       WHERE table_name = 'visit_logs' AND column_name = 'arrival_mood'
    `).get();
    expect(cols.n).toBe(1);
  });

  test("an empty answer is refused rather than recorded as nothing", async () => {
    const { sessionId } = await visit({ agoMinutes: 20 });
    expect((await post(sessionId, tina, { mood: [] })).status).toBe(400);
  });

  test("only the caregiver on the visit — not the family", async () => {
    const { sessionId } = await visit({ agoMinutes: 20 });
    const res = await post(sessionId, pete, { mood: ["happy"] });
    expect(res.status).toBe(403);
    const vl = await db.prepare("SELECT arrival_mood FROM visit_logs WHERE session_id = ?").get(sessionId);
    expect(vl.arrival_mood).toBeNull();
  });

  test("a second answer does not overwrite the first", async () => {
    // A first impression the family has already read must not be quietly rewritten. Changing
    // her mind about how the day went is what the check-out summary is for.
    const { sessionId } = await visit({ agoMinutes: 20 });
    expect((await post(sessionId, tina, { mood: ["warm"] })).status).toBe(200);
    const second = await post(sessionId, tina, { mood: ["upset"] });
    expect(second.status).toBe(409);
    const vl = await db.prepare("SELECT arrival_mood FROM visit_logs WHERE session_id = ?").get(sessionId);
    expect(JSON.parse(vl.arrival_mood)).toEqual(["warm"]);
  });

  test("not on a visit that is not running", async () => {
    const { sessionId } = await visit({ agoMinutes: 20, status: "completed" });
    expect((await post(sessionId, tina, { mood: ["happy"] })).status).toBe(400);
  });

  test("the family sees it in the feed, with no condition in the text", async () => {
    // The mood IS the health observation. A feed line naming it is fine on a screen behind a
    // login; the push that prompted it carries only the question. See pushPhi.test.js.
    const { sessionId } = await visit({ agoMinutes: 20 });
    await post(sessionId, tina, { mood: ["upset", "sad"] });
    const row = await db.prepare(
      "SELECT title, message FROM activity_feed WHERE event_type = 'condition_read' ORDER BY created_at DESC LIMIT 1"
    ).get();
    expect(row).toBeTruthy();
    expect(row.title).toMatch(/Tina settled in/);
    expect(`${row.title} ${row.message}`).not.toMatch(/upset|sad/i);
  });
});

describe("the unit rule behind both", () => {
  const now = new Date("2026-09-15T12:00:00Z");
  const at = (m) => new Date(now.getTime() - m * 60000).toISOString();

  test("a missing check-in time is never due", () => {
    expect(conditionReadDue({ check_in_time: null }, { now })).toBe(false);
    expect(conditionReadDue(null, { now })).toBe(false);
    expect(conditionReadDue({}, { now })).toBe(false);
  });

  test("a nonsense timestamp is not due either — NaN must not read as true", () => {
    expect(conditionReadDue({ check_in_time: "not a date" }, { now })).toBe(false);
  });

  test("the threshold is fifteen minutes, which is the number Pete gave", () => {
    expect(SETTLED_MINUTES).toBe(15);
    expect(conditionReadDue({ check_in_time: at(14.9) }, { now })).toBe(false);
    expect(conditionReadDue({ check_in_time: at(15.1) }, { now })).toBe(true);
  });
});
