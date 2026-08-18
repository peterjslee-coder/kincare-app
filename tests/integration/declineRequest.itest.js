/**
 * v1.105.84 — a caregiver can say no.
 *
 * Pete, after sending Julia a care request: "it only allows her to accept or propose a new
 * time. not to decline." There was no decline endpoint at all — the only answers were claim
 * and propose-a-different-time, so a request she could not take just sat there and the family
 * got no signal.
 *
 * The request comes back to the FAMILY rather than the open pool: they chose this person by
 * name, and broadcasting the request to caregivers they did not pick is not a decision a
 * decline should make for them.
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

async function directedRequest({ status = "pending" } = {}) {
  const db = await getDb();
  const family = await h.createUser({ firstName: "Pete", roles: ["family"] });
  const cg = await h.createUser({ firstName: "Julia", roles: ["caregiver"] });
  const profileId = uuid();
  await db.prepare("INSERT INTO caregiver_profiles (id, user_id, hourly_rate) VALUES (?, ?, 25)").run(profileId, cg.user.id);
  const recipientId = uuid();
  await db.prepare("INSERT INTO care_recipients (id, family_user_id, first_name, last_name) VALUES (?, ?, 'Betty', 'T')").run(recipientId, family.user.id);
  const sessionId = uuid();
  await db.prepare(`
    INSERT INTO care_sessions (id, care_recipient_id, family_user_id, caregiver_id, service_type, status, scheduled_date, scheduled_time)
    VALUES (?, ?, ?, ?, 'companionship', ?, '2026-08-19', '17:00')
  `).run(sessionId, recipientId, family.user.id, profileId, status);
  return { db, family, cg, profileId, sessionId };
}

const decline = (token, id, body) =>
  h.request.put(`/api/sessions/${id}/decline`).set(h.auth(token)).send(body || {});

describe("declining a request sent to you", () => {
  test("it succeeds, records who and why, and unassigns her", async () => {
    const { db, cg, sessionId } = await directedRequest();
    const res = await decline(cg.token, sessionId, { reason: "I'm away that week" });
    expect(res.status).toBe(200);

    const row = await db.prepare("SELECT status, caregiver_id, declined_by, decline_reason FROM care_sessions WHERE id = ?").get(sessionId);
    expect(row.status).toBe("declined");
    expect(row.caregiver_id).toBeNull();          // no longer hers
    expect(row.declined_by).toBe(cg.user.id);     // but we remember it was her
    expect(row.decline_reason).toBe("I'm away that week");
  });

  test("the reason is optional — declining must never be harder than staying silent", async () => {
    const { db, cg, sessionId } = await directedRequest();
    expect((await decline(cg.token, sessionId)).status).toBe(200);
    const row = await db.prepare("SELECT status, decline_reason FROM care_sessions WHERE id = ?").get(sessionId);
    expect(row.status).toBe("declined");
    expect(row.decline_reason).toBeNull();
  });

  test("it does NOT go to the open pool", async () => {
    // The family picked this person by name. Re-offering Betty's request to caregivers they
    // did not choose is their call, not the decliner's.
    const { db, cg, sessionId } = await directedRequest();
    await decline(cg.token, sessionId);
    const row = await db.prepare("SELECT status FROM care_sessions WHERE id = ?").get(sessionId);
    expect(row.status).not.toBe("open");
  });
});

describe("who may decline what", () => {
  test("a different caregiver cannot decline someone else's request", async () => {
    const { sessionId } = await directedRequest();
    const stranger = await h.createUser({ firstName: "Nosy", roles: ["caregiver"] });
    const db = await getDb();
    await db.prepare("INSERT INTO caregiver_profiles (id, user_id, hourly_rate) VALUES (?, ?, 25)").run(uuid(), stranger.user.id);
    const res = await decline(stranger.token, sessionId);
    expect(res.status).toBe(404);   // not 403 — probing ids learns nothing
  });

  test("a family member cannot use the caregiver's decline", async () => {
    const { family, sessionId } = await directedRequest();
    expect((await decline(family.token, sessionId)).status).toBe(403);
  });

  test("an already-confirmed session cannot be declined out from under the family", async () => {
    const { cg, sessionId } = await directedRequest({ status: "confirmed" });
    const res = await decline(cg.token, sessionId);
    expect(res.status).toBe(400);
  });

  test("declining twice is refused the second time", async () => {
    const { cg, sessionId } = await directedRequest();
    expect((await decline(cg.token, sessionId)).status).toBe(200);
    expect((await decline(cg.token, sessionId)).status).toBe(404); // caregiver_id is now null
  });
});
