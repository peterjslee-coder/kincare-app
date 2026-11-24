/**
 * v1.106.13 — a pending time change used to have no end.
 *
 * Proposing one sets care_sessions.pending_time_change_id, and the only thing that ever
 * cleared it was the other party answering. Ignore the request and the session was stuck
 * forever: the propose handler refuses while that pointer is set, so no further time change
 * could ever be made on that visit, and the "asked to move a visit" card sat in the Needs You
 * feed with nothing able to clear it. It outlived the visit itself.
 *
 * Source anchors cannot show a row healing. This runs the real sweeper against the real
 * schema, including migration 036's column.
 */
const { startHarness, stopHarness } = require("./harness");
const { v4: uuid } = require("uuid");

jest.setTimeout(180000);

let h, db, expireStaleProposals;

beforeAll(async () => {
  h = await startHarness({ routers: { "/api/sessions": "../../src/routes/sessions" } });
  db = h.db;
  // v1.106.16 — moved out of the router into its own module.
  ({ expireStaleProposals } = require("../../src/utils/proposals"));
});

afterAll(async () => { await stopHarness(h); });

/** A confirmed visit with a caregiver on it, and a pending time change pointing at it. */
async function stuckVisit({ expiresAt, sessionStatus = "confirmed" }) {
  const family = await h.createUser({ firstName: "Fam", lastName: "Ily" });
  const { recipientId } = await h.createCareTeam({ familyUserId: family.user.id });
  const cg = await h.createUser({ firstName: "Care", lastName: "Giver", roles: ["caregiver"] });
  const profileId = uuid();
  await db.prepare(
    "INSERT INTO caregiver_profiles (id, user_id, hourly_rate, created_at) VALUES (?, ?, 25, NOW())"
  ).run(profileId, cg.user.id);

  const sessionId = uuid();
  await db.prepare(`
    INSERT INTO care_sessions (id, care_recipient_id, family_user_id, caregiver_id, service_type,
                               status, scheduled_date, scheduled_time, duration_hours, created_at)
    VALUES (?, ?, ?, ?, 'companionship', ?, '2026-09-02', '10:00', 2, NOW())
  `).run(sessionId, recipientId, family.user.id, profileId, sessionStatus);

  const propId = uuid();
  await db.prepare(`
    INSERT INTO time_change_proposals (id, session_id, proposed_by, proposed_by_user_id,
      original_time, original_duration, proposed_time, proposed_duration, status, created_at, expires_at)
    VALUES (?, ?, 'caregiver', ?, '10:00', 2, '14:00', 2, 'pending', NOW(), ?)
  `).run(propId, sessionId, cg.user.id, expiresAt);

  await db.prepare("UPDATE care_sessions SET pending_time_change_id = ? WHERE id = ?")
    .run(propId, sessionId);

  return { sessionId, propId, family, cg };
}

const readBack = async (sessionId, propId) => ({
  pointer: (await db.prepare("SELECT pending_time_change_id AS p FROM care_sessions WHERE id = ?").get(sessionId)).p,
  status: (await db.prepare("SELECT status FROM time_change_proposals WHERE id = ?").get(propId)).status,
  time: (await db.prepare("SELECT scheduled_time AS t FROM care_sessions WHERE id = ?").get(sessionId)).t,
});

describe("migration 036", () => {
  test("time_change_proposals has an expires_at column", async () => {
    const col = await db.prepare(`
      SELECT data_type FROM information_schema.columns
      WHERE table_name = 'time_change_proposals' AND column_name = 'expires_at'
    `).get();
    expect(col).toBeTruthy();
    expect(col.data_type).toMatch(/timestamp/);
  });
});

describe("the sweeper", () => {
  test("expires a lapsed change AND frees the session", async () => {
    const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { sessionId, propId } = await stuckVisit({ expiresAt: past });

    // Before: stuck.
    expect((await readBack(sessionId, propId)).pointer).toBe(propId);

    const swept = await expireStaleProposals(db, null, null);
    expect(swept).toBeGreaterThanOrEqual(1);

    const after = await readBack(sessionId, propId);
    expect(after.status).toBe("expired");
    expect(after.pointer).toBeNull();
  });

  test("the visit itself is untouched — an unanswered request is not a reschedule", async () => {
    const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { sessionId, propId } = await stuckVisit({ expiresAt: past });
    await expireStaleProposals(db, null, null);
    // proposed_time was 14:00; it must NOT have been applied.
    expect((await readBack(sessionId, propId)).time).toMatch(/^10:00/);
  });

  test("leaves a live request alone", async () => {
    const future = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
    const { sessionId, propId } = await stuckVisit({ expiresAt: future });
    await expireStaleProposals(db, null, null);
    const after = await readBack(sessionId, propId);
    expect(after.status).toBe("pending");
    expect(after.pointer).toBe(propId);
  });

  test("sweeps a cancelled visit's request even though its deadline has not passed", async () => {
    const future = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
    const { sessionId, propId } = await stuckVisit({ expiresAt: future, sessionStatus: "cancelled" });
    await expireStaleProposals(db, null, null);
    const after = await readBack(sessionId, propId);
    expect(after.status).toBe("expired");
    expect(after.pointer).toBeNull();
  });

  test("and the session can take a new time change afterwards — the actual stuck symptom", async () => {
    const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { sessionId, cg } = await stuckVisit({ expiresAt: past });

    // While stuck, the propose handler refuses.
    const blocked = await h.request
      .post(`/api/sessions/${sessionId}/propose-time-change`)
      .set(h.auth(cg.token))
      .send({ proposedTime: "15:00", proposedDuration: 2 });
    expect(blocked.status).toBe(400);
    expect(blocked.body.error).toMatch(/already pending/i);

    await expireStaleProposals(db, null, null);

    const allowed = await h.request
      .post(`/api/sessions/${sessionId}/propose-time-change`)
      .set(h.auth(cg.token))
      .send({ proposedTime: "15:00", proposedDuration: 2 });
    expect(allowed.status).toBe(200);
  });
});

describe("proposing sets a deadline", () => {
  test("a new time change is born with an expires_at, no later than the visit", async () => {
    const family = await h.createUser({ firstName: "Fam2", lastName: "Ily" });
    const { recipientId } = await h.createCareTeam({ familyUserId: family.user.id });
    const cg = await h.createUser({ firstName: "Care2", lastName: "Giver", roles: ["caregiver"] });
    const profileId = uuid();
    await db.prepare(
      "INSERT INTO caregiver_profiles (id, user_id, hourly_rate, created_at) VALUES (?, ?, 25, NOW())"
    ).run(profileId, cg.user.id);

    // A visit two hours from now: the 24h ceiling must lose to the visit's own start.
    const soon = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const dateStr = soon.toISOString().slice(0, 10);
    const timeStr = soon.toISOString().slice(11, 16);
    const sessionId = uuid();
    await db.prepare(`
      INSERT INTO care_sessions (id, care_recipient_id, family_user_id, caregiver_id, service_type,
                                 status, scheduled_date, scheduled_time, duration_hours, created_at)
      VALUES (?, ?, ?, ?, 'companionship', 'confirmed', ?, ?, 2, NOW())
    `).run(sessionId, recipientId, family.user.id, profileId, dateStr, timeStr);

    const res = await h.request
      .post(`/api/sessions/${sessionId}/propose-time-change`)
      .set(h.auth(cg.token))
      .send({ proposedTime: "23:00", proposedDuration: 2 });
    expect(res.status).toBe(200);

    const row = await db.prepare(
      "SELECT expires_at FROM time_change_proposals WHERE session_id = ? AND status = 'pending'"
    ).get(sessionId);
    expect(row.expires_at).toBeTruthy();
    // Well inside 24h, because the visit starts first.
    const hours = (new Date(row.expires_at) - Date.now()) / 3600000;
    expect(hours).toBeLessThan(24);
  });
});
