/**
 * v1.105.90 — your own POSTED request: visible, and not acceptable by you.
 *
 * Pete is a caregiver as well as a family user: "i'm also a caregiver. why can't i see the job
 * i posted?" He could not, because the dashboard query removed it from the list entirely — so
 * a job he had just posted looked exactly like a job that had failed to post.
 *
 * Two changes. It is now shown and flagged rather than hidden. And the rule it was enforcing
 * by accident — you cannot accept work for someone you are the family for — is now enforced on
 * the SERVER, where it belongs, because a hidden job was never actually protected.
 */
const { startHarness, stopHarness } = require("./harness");
const { v4: uuid } = require("uuid");

jest.setTimeout(180000);
let h, getDb;

beforeAll(async () => {
  h = await startHarness({ routers: { "/api/sessions": "../../src/routes/sessions" } });
  ({ getDb } = require("../../src/models/database"));
});
afterAll(async () => { await stopHarness(h); });

async function scenario({ postedBy } = {}) {
  const db = await getDb();
  // Pete: family owner of Betty AND a caregiver.
  const pete = await h.createUser({ firstName: "Pete", roles: ["family", "caregiver"] });
  const petesProfile = uuid();
  await db.prepare("INSERT INTO caregiver_profiles (id, user_id, hourly_rate, is_background_checked, stripe_onboard_complete) VALUES (?, ?, 25, 1, 1)")
    .run(petesProfile, pete.user.id);
  const sara = await h.createUser({ firstName: "Sara", roles: ["family"] });

  const recipientId = uuid();
  await db.prepare("INSERT INTO care_recipients (id, family_user_id, first_name, last_name) VALUES (?, ?, 'Betty', 'T')")
    .run(recipientId, pete.user.id);   // Pete is Betty's family

  const sessionId = uuid();
  await db.prepare(`
    INSERT INTO care_sessions (id, care_recipient_id, family_user_id, service_type, status, scheduled_date, scheduled_time)
    VALUES (?, ?, ?, 'companionship', 'open', '2026-08-25', '10:00')
  `).run(sessionId, recipientId, postedBy === "sara" ? sara.user.id : pete.user.id);

  return { db, pete, sara, recipientId, sessionId };
}

describe("the server refuses the claim, not just the UI", () => {
  test("Pete cannot claim a job he posted for Betty", async () => {
    const { pete, sessionId } = await scenario();
    const res = await h.request.put(`/api/sessions/${sessionId}/claim`).set(h.auth(pete.token));
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/posted yourself/i);
  });

  test("Pete CAN claim it when Sara posted it, and gets paid", async () => {
    // v1.105.90 reversed v1.105.89 here, on Pete's instruction: "if sara posts a job and i have
    // to take it, I'll take the pay for it. do not prohibit members of the team from also doing
    // things for money if they can't hire someone." The point of the team is that the work gets
    // covered; someone covering a shift nobody else will take should be paid for it.
    const { db, pete, sessionId } = await scenario({ postedBy: "sara" });
    await db.prepare("UPDATE caregiver_profiles SET care_preferences = '{}' WHERE user_id = ?").run(pete.user.id);
    const res = await h.request.put(`/api/sessions/${sessionId}/claim`).set(h.auth(pete.token));
    expect([200, 201]).toContain(res.status);
  });

  test("an unrelated caregiver can still claim it", async () => {
    // The rule must not become "nobody can work this job".
    const { db, sessionId } = await scenario();
    const other = await h.createUser({ firstName: "Julia", roles: ["caregiver"] });
    await db.prepare("INSERT INTO caregiver_profiles (id, user_id, hourly_rate, is_background_checked, stripe_onboard_complete, care_preferences) VALUES (?, ?, 25, 1, 1, '{}')")
      .run(uuid(), other.user.id);
    const res = await h.request.put(`/api/sessions/${sessionId}/claim`).set(h.auth(other.token));
    expect([200, 201]).toContain(res.status);
  });
});
