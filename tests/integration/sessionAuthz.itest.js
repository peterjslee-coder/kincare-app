/**
 * Session authorization — a role is not a permission.
 *
 * The Sep 13 2026 review found that several /api/sessions/:id routes decided what you could do
 * by reading the role in your own token: `activeRole === "caregiver"`. That role is free — you
 * can register with it, or add it to any existing account via POST /api/auth/add-role, with no
 * vetting and no background check. So any account on the platform could cancel, reschedule or
 * re-negotiate ANY confirmed visit, and any account holding the self-assignable `care_for` role
 * could append text to ANY session's special instructions, which the caregiver reads at check-in.
 *
 * The cancel path was the worst of them: it set the session back to `open` and recorded
 * `cancelled_caregiver_id` + `late_cancel = 1` against the real caregiver, so a stranger could
 * unbook an elderly person's visit and leave the caregiver holding the blame.
 *
 * `scripts/lint-authz.js` stops the SHAPE coming back. These tests check the BEHAVIOUR: a
 * stranger is refused, and — just as important — the two legitimate parties are not.
 */
const { v4: uuid } = require("uuid");
const { startHarness, stopHarness } = require("./harness");

jest.setTimeout(180000);

let h, db;
let family, assignedCg, strangerCg, strangerCareFor;
let recipientId, sessionId, assignedProfileId;

const SESSION_DATE = "2026-12-01";

beforeAll(async () => {
  h = await startHarness();
  db = h.db;

  family        = await h.createUser({ roles: ["family"] });
  assignedCg    = await h.createUser({ roles: ["caregiver"] });
  // The attacker: a brand new account that simply holds the caregiver role.
  strangerCg    = await h.createUser({ roles: ["caregiver"] });
  // And one holding care_for, which POST /api/auth/add-role hands out on request.
  strangerCareFor = await h.createUser({ roles: ["care_for"] });

  const team = await h.createCareTeam({ familyUserId: family.user.id });
  recipientId = team.recipientId;

  assignedProfileId = uuid();
  await db.prepare(
    "INSERT INTO caregiver_profiles (id, user_id, hourly_rate, is_background_checked, created_at) VALUES (?, ?, 25, 1, NOW())"
  ).run(assignedProfileId, assignedCg.user.id);
  // The stranger has a profile too — being a *real* caregiver elsewhere on the platform must
  // not grant anything here.
  await db.prepare(
    "INSERT INTO caregiver_profiles (id, user_id, hourly_rate, is_background_checked, created_at) VALUES (?, ?, 25, 1, NOW())"
  ).run(uuid(), strangerCg.user.id);

  sessionId = uuid();
  await db.prepare(`
    INSERT INTO care_sessions (id, care_recipient_id, family_user_id, caregiver_id, service_type,
                               status, scheduled_date, scheduled_time, duration_hours,
                               special_instructions, created_at)
    VALUES (?, ?, ?, ?, 'companionship', 'confirmed', ?, '10:00', 2, 'Original instructions.', NOW())
  `).run(sessionId, recipientId, family.user.id, assignedProfileId, SESSION_DATE);
});

afterAll(async () => { await stopHarness(h); });

async function session() {
  return db.prepare("SELECT * FROM care_sessions WHERE id = ?").get(sessionId);
}

describe("a stranger holding the caregiver role cannot touch someone else's session", () => {
  test("cannot cancel it — and the visit survives", async () => {
    const res = await h.request.put(`/api/sessions/${sessionId}/cancel`)
      .set(h.auth(strangerCg.token))
      .send({ reason: "not mine to cancel" });
    expect(res.status).toBe(404);

    const after = await session();
    expect(after.status).toBe("confirmed");
    expect(after.caregiver_id).toBe(assignedProfileId);
    // The real caregiver must not be recorded as having dropped the job.
    expect(after.cancelled_caregiver_id == null).toBe(true);
    expect(after.late_cancel == null || Number(after.late_cancel) === 0).toBe(true);
  });

  test("cannot propose a new time", async () => {
    const res = await h.request.post(`/api/sessions/${sessionId}/propose-time-change`)
      .set(h.auth(strangerCg.token))
      .send({ proposedTime: "03:00", proposedDuration: 2, reason: "middle of the night" });
    expect(res.status).toBe(404);
    expect((await session()).scheduled_time).toBe("10:00");
  });

  test("cannot read the pending time-change proposal", async () => {
    const res = await h.request.get(`/api/sessions/${sessionId}/time-change`)
      .set(h.auth(strangerCg.token));
    expect(res.status).toBe(404);
  });

  test("cannot preview the cancellation", async () => {
    const res = await h.request.get(`/api/sessions/${sessionId}/cancel-preview`)
      .set(h.auth(strangerCg.token));
    expect(res.status).toBe(404);
  });

  test("refusal is indistinguishable from a session that does not exist", async () => {
    const real = await h.request.get(`/api/sessions/${sessionId}/cancel-preview`)
      .set(h.auth(strangerCg.token));
    const imaginary = await h.request.get(`/api/sessions/${uuid()}/cancel-preview`)
      .set(h.auth(strangerCg.token));
    expect(real.status).toBe(imaginary.status);
  });
});

describe("a stranger holding the care_for role cannot write care instructions", () => {
  test("cannot append to another recipient's session instructions", async () => {
    const res = await h.request.put(`/api/sessions/${sessionId}/instructions`)
      .set(h.auth(strangerCareFor.token))
      .send({ specialInstructions: "Please give her the second dose too." });
    expect(res.status).toBe(404);

    const after = await session();
    expect(after.special_instructions).toBe("Original instructions.");
    expect(after.special_instructions).not.toMatch(/second dose/i);
  });
});

describe("the people who should have access still do", () => {
  test("the booking family can preview a cancellation", async () => {
    const res = await h.request.get(`/api/sessions/${sessionId}/cancel-preview`)
      .set(h.auth(family.token));
    expect(res.status).toBe(200);
    expect(res.body.cancelledBy).toBe("family");
  });

  test("the assigned caregiver can preview a cancellation, and is seen as the caregiver", async () => {
    const res = await h.request.get(`/api/sessions/${sessionId}/cancel-preview`)
      .set(h.auth(assignedCg.token));
    expect(res.status).toBe(200);
    expect(res.body.cancelledBy).toBe("caregiver");
  });

  test("the booking family can read the time-change endpoint", async () => {
    const res = await h.request.get(`/api/sessions/${sessionId}/time-change`)
      .set(h.auth(family.token));
    expect(res.status).toBe(200);
  });

  test("the booking family can edit the instructions", async () => {
    const res = await h.request.put(`/api/sessions/${sessionId}/instructions`)
      .set(h.auth(family.token))
      .send({ specialInstructions: "Front door code is 1234." });
    expect(res.status).toBeLessThan(400);
    expect((await session()).special_instructions).toMatch(/1234/);
  });
});
