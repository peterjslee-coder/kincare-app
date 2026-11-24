/**
 * Changing a password must end the sessions (v1.106.4).
 *
 * `revokeAllUserRefreshTokens` was written, exported, and imported into routes/auth.js — and
 * called from nowhere. So the one action a person takes when they think they have been
 * compromised did nothing: a stolen access token stayed valid for its full seven days, and a
 * stolen refresh token renewed itself indefinitely.
 *
 * The load-bearing half of the fix lives in middleware/auth.js, which now refuses any token
 * issued before users.password_changed_at. That is what these tests exercise, because it is
 * what protects a token that was stolen rather than one that was politely handed back.
 *
 * Also here: group conversations used to skip the relationship check that direct messages get.
 */
const { v4: uuid } = require("uuid");
const { startHarness, stopHarness } = require("./harness");

jest.setTimeout(180000);

let h, db;

beforeAll(async () => {
  h = await startHarness();
  db = h.db;
});
afterAll(async () => { await stopHarness(h); });

describe("a token minted before the password changed is dead", () => {
  test("it works before, and stops working after", async () => {
    const u = await h.createUser({ roles: ["family"] });

    const before = await h.request.get("/api/messages/conversations").set(h.auth(u.token));
    expect(before.status).toBe(200);

    // What a password change does, from the middleware's point of view.
    await db.prepare("UPDATE users SET password_changed_at = NOW() + INTERVAL '10 seconds' WHERE id = ?")
      .run(u.user.id);

    const after = await h.request.get("/api/messages/conversations").set(h.auth(u.token));
    expect(after.status).toBe(401);
    expect(after.body.error).toMatch(/sign in again/i);
  });

  test("a token issued after the change still works", async () => {
    const u = await h.createUser({ roles: ["family"] });
    await db.prepare("UPDATE users SET password_changed_at = NOW() - INTERVAL '1 hour' WHERE id = ?")
      .run(u.user.id);
    const res = await h.request.get("/api/messages/conversations").set(h.auth(u.token));
    expect(res.status).toBe(200);
  });

  test("an account that has never changed its password is unaffected", async () => {
    const u = await h.createUser({ roles: ["family"] });
    await db.prepare("UPDATE users SET password_changed_at = NULL WHERE id = ?").run(u.user.id);
    const res = await h.request.get("/api/messages/conversations").set(h.auth(u.token));
    expect(res.status).toBe(200);
  });

  test("the grace window covers same-second issuance, and nothing more", async () => {
    // `iat` is whole seconds; password_changed_at has sub-second precision. Without a small
    // grace, a token minted in the same second as the change would be rejected as older.
    const u = await h.createUser({ roles: ["family"] });
    await db.prepare("UPDATE users SET password_changed_at = NOW() + INTERVAL '3 seconds' WHERE id = ?")
      .run(u.user.id);
    const withinGrace = await h.request.get("/api/messages/conversations").set(h.auth(u.token));
    expect(withinGrace.status).toBe(200);
  });
});

describe("a group conversation is not a way around the relationship check", () => {
  test("an uncleared caregiver cannot open a group with a family they have no link to", async () => {
    const family = await h.createUser({ roles: ["family"] });
    const cg = await h.createUser({ roles: ["caregiver"] });
    await db.prepare(
      "INSERT INTO caregiver_profiles (id, user_id, hourly_rate, is_background_checked, created_at) VALUES (?, ?, 25, 0, NOW())"
    ).run(uuid(), cg.user.id);

    const res = await h.request.post("/api/messages/conversations")
      .set(h.auth(cg.token))
      .send({ type: "group", name: "hello", memberIds: [family.user.id] });

    expect(res.status).toBe(403);
  });

  test("a stranger cannot open a group with an unrelated user either", async () => {
    const a = await h.createUser({ roles: ["family"] });
    const b = await h.createUser({ roles: ["family"] });
    const res = await h.request.post("/api/messages/conversations")
      .set(h.auth(a.token))
      .send({ type: "group", name: "hello", memberIds: [b.user.id] });
    expect(res.status).toBe(403);
  });

  test("people who share a care team can still open a group", async () => {
    const family = await h.createUser({ roles: ["family"] });
    const sibling = await h.createUser({ roles: ["family"] });
    const t = await h.createCareTeam({ familyUserId: family.user.id });
    await h.addTeamMember(t.teamId, sibling.user.id, "member");

    const res = await h.request.post("/api/messages/conversations")
      .set(h.auth(family.token))
      .send({ type: "group", name: "Betty's team", memberIds: [sibling.user.id] });
    expect(res.status).toBeLessThan(400);
  });
});
