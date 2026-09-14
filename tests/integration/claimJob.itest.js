/**
 * v1.106.24 — coverage for PUT /api/sessions/:id/claim, written BEFORE touching it.
 *
 * This is the route that puts a caregiver on a job. Before this file, `/claim` appeared in
 * four tests and not one of them called it. Every gate in front of it — paused account,
 * missing care preferences, no background check, claiming your own request, claiming a
 * session someone already took — was unverified, on the path where money starts.
 *
 * It exists now because the recurring-offer work needs to accept a whole series at once, and
 * the honest way to do that is to extract the single-session claim and reuse it. A refactor
 * of an uncovered money path is a guess. So: characterise it first, refactor second, and the
 * same assertions have to still pass afterwards.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || "claim-job-secret";

const { startHarness, stopHarness } = require("./harness");
const { v4: uuid } = require("uuid");

jest.setTimeout(180000);

let h, db, family, caregiver, profileId, recipientId;

const soon = (daysOut = 3) => {
  const d = new Date(); d.setDate(d.getDate() + daysOut);
  return d.toISOString().slice(0, 10);
};

/** An open request, optionally offered exclusively to our caregiver. */
async function makeSession(overrides = {}) {
  const id = uuid();
  await db.prepare(`
    INSERT INTO care_sessions
      (id, care_recipient_id, family_user_id, service_type, status,
       scheduled_date, scheduled_time, duration_hours, estimated_cost,
       offered_to_caregiver_id, recurrence_group_id, exclusive_until, created_at)
    VALUES (?, ?, ?, 'companion', ?, ?, '10:00', 2, 100, ?, ?, ?, NOW())
  `).run(
    id, overrides.recipientId || recipientId, overrides.familyUserId || family.user.id,
    overrides.status || "open", overrides.date || soon(),
    overrides.offeredTo === undefined ? profileId : overrides.offeredTo,
    overrides.groupId || null,
    overrides.exclusiveUntil || null
  );
  return id;
}

const claim = (id, token = caregiver.token) =>
  h.request.put(`/api/sessions/${id}/claim`).set(h.auth(token)).send({});

const statusOf = async (id) =>
  (await db.prepare("SELECT status, caregiver_id FROM care_sessions WHERE id = ?").get(id));

/** Put the caregiver back in a state where claiming is allowed. */
const resetProfile = () => db.prepare(`
  UPDATE caregiver_profiles
  SET account_paused = 0, care_stoplight = 'green', is_background_checked = 1
  WHERE id = ?
`).run(profileId);

beforeAll(async () => {
  h = await startHarness({ routers: { "/api/sessions": "../../src/routes/sessions" } });
  db = h.db;

  family = await h.createUser({ firstName: "Pete", lastName: "ITest" });
  caregiver = await h.createUser({ roles: ["caregiver"], firstName: "Tina", lastName: "ITest" });

  profileId = uuid();
  await db.prepare(`
    INSERT INTO caregiver_profiles (id, user_id, hourly_rate, is_background_checked, care_stoplight, created_at)
    VALUES (?, ?, 25, 1, 'green', NOW())
  `).run(profileId, caregiver.user.id);

  ({ recipientId } = await h.createCareTeam({ familyUserId: family.user.id }));
});

afterEach(resetProfile);
afterAll(async () => { await stopHarness(h); });

describe("claiming a job", () => {
  test("a cleared caregiver takes an open request", async () => {
    const id = await makeSession();
    const res = await claim(id);
    expect(res.status).toBe(200);

    const row = await statusOf(id);
    expect(row.status).toBe("confirmed");
    expect(row.caregiver_id).toBe(profileId);
  });

  test("claiming creates the assignment, so she shows up in future Request Care lists", async () => {
    const id = await makeSession();
    await claim(id).expect(200);
    const a = await db.prepare(`
      SELECT is_active FROM caregiver_assignments
      WHERE caregiver_profile_id = ? AND care_recipient_id = ?
    `).get(profileId, recipientId);
    expect(a).toBeTruthy();
  });

  test("a second caregiver cannot take a session already confirmed", async () => {
    const id = await makeSession();
    await claim(id).expect(200);

    const other = await h.createUser({ roles: ["caregiver"], firstName: "Julia", lastName: "ITest" });
    await db.prepare(`
      INSERT INTO caregiver_profiles (id, user_id, hourly_rate, is_background_checked, care_stoplight, created_at)
      VALUES (?, ?, 25, 1, 'green', NOW())
    `).run(uuid(), other.user.id);

    const res = await claim(id, other.token);
    expect(res.status).toBe(400);
    // And the first caregiver still owns it.
    expect((await statusOf(id)).caregiver_id).toBe(profileId);
  });
});

describe("the gates in front of it", () => {
  test("a family account cannot claim at all", async () => {
    const id = await makeSession();
    const res = await claim(id, family.token);
    expect(res.status).toBe(403);
    expect((await statusOf(id)).status).toBe("open");
  });

  test("you cannot accept a request you posted yourself", async () => {
    // The caregiver is also the family on this one — paying yourself.
    const own = await h.createUser({ roles: ["caregiver", "family"], firstName: "Solo", lastName: "ITest" });
    const soloProfile = uuid();
    await db.prepare(`
      INSERT INTO caregiver_profiles (id, user_id, hourly_rate, is_background_checked, care_stoplight, created_at)
      VALUES (?, ?, 25, 1, 'green', NOW())
    `).run(soloProfile, own.user.id);
    const id = await makeSession({ familyUserId: own.user.id, offeredTo: soloProfile });

    const res = await claim(id, own.token);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/posted yourself/i);
    expect((await statusOf(id)).status).toBe("open");
  });

  test("a paused account is refused", async () => {
    await db.prepare("UPDATE caregiver_profiles SET account_paused = 1 WHERE id = ?").run(profileId);
    const id = await makeSession();
    const res = await claim(id);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/paused/i);
    expect((await statusOf(id)).status).toBe("open");
  });

  test("no care preferences set is refused", async () => {
    await db.prepare("UPDATE caregiver_profiles SET care_stoplight = NULL, care_preferences = NULL WHERE id = ?").run(profileId);
    const id = await makeSession();
    const res = await claim(id);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/care preferences/i);
    expect((await statusOf(id)).status).toBe("open");
  });

  test("no background check and no vouch is refused", async () => {
    await db.prepare("UPDATE caregiver_profiles SET is_background_checked = 0 WHERE id = ?").run(profileId);
    const id = await makeSession();
    const res = await claim(id);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/background check/i);
    expect((await statusOf(id)).status).toBe("open");
  });

  test("an active admin vouch for THIS family stands in for the background check", async () => {
    await db.prepare("UPDATE caregiver_profiles SET is_background_checked = 0 WHERE id = ?").run(profileId);
    await db.prepare(`
      INSERT INTO bg_admin_vouches (id, caregiver_user_id, family_user_id, vouched_by, created_at)
      VALUES (?, ?, ?, ?, NOW())
    `).run(uuid(), caregiver.user.id, family.user.id, family.user.id);

    const id = await makeSession();
    const res = await claim(id);
    expect(res.status).toBe(200);
    expect((await statusOf(id)).caregiver_id).toBe(profileId);

    await db.prepare("DELETE FROM bg_admin_vouches WHERE caregiver_user_id = ?").run(caregiver.user.id);
  });

  test("a cancelled session is not claimable", async () => {
    const id = await makeSession({ status: "cancelled" });
    const res = await claim(id);
    expect(res.status).toBe(400);
  });

  test("a session that does not exist is a 404, not a crash", async () => {
    const res = await claim(uuid());
    expect(res.status).toBe(404);
  });
});
