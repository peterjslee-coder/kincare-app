/**
 * Vetting-path integration tests (infra #6):
 *  - uncleared caregivers are boxed to InPlace Support in messaging
 *  - careIntelligence access checks work against the REAL schema
 *    (regression for the v1.86.0 fix — the old queries referenced
 *    nonexistent columns, always threw, and silently denied access).
 */
const { v4: uuid } = require("uuid");
const { startHarness, stopHarness } = require("./harness");

jest.setTimeout(180000);

let h;
let family, unclearedCg, clearedCg, admin, teamMember;
let recipientId, teamId;

beforeAll(async () => {
  h = await startHarness();
  family = await h.createUser({ roles: ["family"] });
  unclearedCg = await h.createUser({ roles: ["caregiver"] });
  clearedCg = await h.createUser({ roles: ["caregiver"] });
  admin = await h.createUser({ roles: ["family"], isAdmin: true });
  teamMember = await h.createUser({ roles: ["family"] });

  // caregiver profiles: one vetted, one not
  await h.db.prepare(
    "INSERT INTO caregiver_profiles (id, user_id, hourly_rate, is_background_checked, created_at) VALUES (?, ?, 25, 0, NOW())"
  ).run(uuid(), unclearedCg.user.id);
  const clearedProfileId = uuid();
  await h.db.prepare(
    "INSERT INTO caregiver_profiles (id, user_id, hourly_rate, is_background_checked, created_at) VALUES (?, ?, 25, 1, NOW())"
  ).run(clearedProfileId, clearedCg.user.id);

  const t = await h.createCareTeam({ familyUserId: family.user.id });
  recipientId = t.recipientId;
  teamId = t.teamId;
  await h.addTeamMember(teamId, teamMember.user.id, "member");

  // give the cleared caregiver an active assignment to the recipient
  await h.db.prepare(`
    INSERT INTO caregiver_assignments (id, care_recipient_id, family_user_id, caregiver_profile_id, is_active, created_at)
    VALUES (?, ?, ?, ?, 1, NOW())
  `).run(uuid(), recipientId, family.user.id, clearedProfileId);
});

afterAll(async () => { await stopHarness(h); });

describe("messaging vetting gate", () => {
  test("uncleared caregiver cannot open a conversation with a family user", async () => {
    const res = await h.request.post("/api/messages/conversations")
      .set(h.auth(unclearedCg.token))
      .send({ type: "direct", memberIds: [family.user.id] });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/background check/i);
  });

  test("uncleared caregiver CAN open a conversation with admin (support line)", async () => {
    const res = await h.request.post("/api/messages/conversations")
      .set(h.auth(unclearedCg.token))
      .send({ type: "direct", memberIds: [admin.user.id] });
    expect(res.status).toBeLessThan(400);
  });

  test("cleared + assigned caregiver can open a conversation with the family", async () => {
    const res = await h.request.post("/api/messages/conversations")
      .set(h.auth(clearedCg.token))
      .send({ type: "direct", memberIds: [family.user.id] });
    expect(res.status).toBeLessThan(400);
  });
});

describe("careIntelligence access checks (v1.86.0 schema-fix regression)", () => {
  // /patterns is gated by userCanAccessRecipient — the helper whose team and
  // caregiver branches were dead code until v1.86.0. It may 404 for lack of
  // visit data, but it must NOT 403 for people who belong on the recipient.
  test("care team member is not denied", async () => {
    const res = await h.request.get(`/api/care-intelligence/${recipientId}/patterns`)
      .set(h.auth(teamMember.token));
    expect(res.status).not.toBe(403);
  });

  test("assigned caregiver is not denied", async () => {
    const res = await h.request.get(`/api/care-intelligence/${recipientId}/patterns`)
      .set(h.auth(clearedCg.token));
    expect(res.status).not.toBe(403);
  });

  test("unrelated user IS denied", async () => {
    const outsider = await h.createUser({});
    const res = await h.request.get(`/api/care-intelligence/${recipientId}/patterns`)
      .set(h.auth(outsider.token));
    expect(res.status).toBe(403);
  });

  test("care-plan GET does not 500 (unwrapped queries were killing it)", async () => {
    const res = await h.request.get(`/api/care-intelligence/${recipientId}/care-plan`)
      .set(h.auth(family.token));
    // 404 = no plan generated yet (fine); before the fix this was a 500
    expect([200, 404]).toContain(res.status);
  });
});
