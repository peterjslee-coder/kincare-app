/**
 * v1.109.7 — visit updates need two keys: the leader allows, the member turns them on.
 * Pete (b3c808fd): "Julia gets notifications when Tina arrives or leaves."
 */
const { v4: uuid } = require("uuid");
const { startHarness, stopHarness } = require("./harness");

jest.setTimeout(180000);

let h, db, pete, sister, julia, tina, betty, teamId, recipientId, tinaProfileId;
const pushes = [];

beforeAll(async () => {
  // Capture pushes before any route module binds sendPushToUser.
  const push = require("../../src/routes/push");
  const real = push.sendPushToUser;
  push.sendPushToUser = async (userId, payload, eventType) => { pushes.push({ userId, type: payload?.data?.type, eventType }); return { sent: 1 }; };
  h = await startHarness({ routers: {
    "/api/sessions": "../../src/routes/sessions",
    "/api/care-teams": "../../src/routes/careTeams",
  } });
  db = h.db;
  pete = await h.createUser({ roles: ["family"], firstName: "Pete" });
  sister = await h.createUser({ roles: ["family"], firstName: "Sis" });
  julia = await h.createUser({ roles: ["caregiver"], firstName: "Julia" });
  tina = await h.createUser({ roles: ["caregiver"], firstName: "Tina" });
  const t = await h.createCareTeam({ familyUserId: pete.user.id });
  teamId = t.teamId; recipientId = t.recipientId;
  await h.addTeamMember(teamId, sister.user.id);
  await h.addTeamMember(teamId, julia.user.id);
  tinaProfileId = uuid();
  await db.prepare("INSERT INTO caregiver_profiles (id, user_id, hourly_rate, is_background_checked, created_at) VALUES (?, ?, 25, 1, NOW())").run(tinaProfileId, tina.user.id);
});

afterAll(async () => { await stopHarness(h); });

const { visitUpdateAudience } = require("../../src/utils/visitAudience");
const audience = () => visitUpdateAudience(db, recipientId, { exclude: [tina.user.id] });
const allow = (who, allowed, as = pete) => h.request.put(`/api/care-teams/${teamId}/members/${who.user.id}/visit-updates`).set(h.auth(as.token)).send({ allowed });
const turn = (who, on) => h.request.put(`/api/care-teams/${teamId}/visit-updates/me`).set(h.auth(who.token)).send({ on });

describe("defaults — everyone off, the leader on", () => {
  test("only Pete is told", async () => {
    expect(await audience()).toEqual([pete.user.id]);
  });
  test("Julia's own list is empty; Pete's shows Betty, on", async () => {
    const j = await h.request.get("/api/care-teams/visit-updates/mine").set(h.auth(julia.token));
    expect(j.status).toBe(200);
    expect(j.body.teams).toEqual([]);
    const p = await h.request.get("/api/care-teams/visit-updates/mine").set(h.auth(pete.token));
    expect(p.body.teams).toEqual([expect.objectContaining({ teamId, isLeader: true, on: true })]);
  });
});

describe("two keys", () => {
  test("Julia cannot switch them on before Pete allows it", async () => {
    const res = await turn(julia, true);
    expect(res.status).toBe(403);
    expect(await audience()).not.toContain(julia.user.id);
  });
  test("allowing alone does not turn anything on", async () => {
    expect((await allow(julia, true)).status).toBe(200);
    expect(await audience()).not.toContain(julia.user.id);
    const j = await h.request.get("/api/care-teams/visit-updates/mine").set(h.auth(julia.token));
    expect(j.body.teams).toEqual([expect.objectContaining({ teamId, on: false })]);
  });
  test("allowed + on = told", async () => {
    expect((await turn(julia, true)).status).toBe(200);
    expect(await audience()).toContain(julia.user.id);
  });
  test("taking permission away stops it AND clears her choice", async () => {
    await allow(julia, false);
    expect(await audience()).not.toContain(julia.user.id);
    await allow(julia, true);
    expect(await audience()).not.toContain(julia.user.id); // must opt in again
  });
  test("only the leader can allow", async () => {
    expect((await allow(julia, true, sister)).status).toBe(403);
  });
  test("Pete can turn his own off", async () => {
    await turn(pete, false);
    expect(await audience()).not.toContain(pete.user.id);
    await turn(pete, true);
    expect(await audience()).toContain(pete.user.id);
  });
  test("the account-wide switch is a master off", async () => {
    await db.prepare("UPDATE users SET notification_prefs = ? WHERE id = ?").run(JSON.stringify({ push_session_status: false }), pete.user.id);
    expect(await audience()).not.toContain(pete.user.id);
    await db.prepare("UPDATE users SET notification_prefs = NULL WHERE id = ?").run(pete.user.id);
  });
});

describe("a real check-in", () => {
  test("Tina checks in: Pete is told, Julia and the sister are not", async () => {
    const sid = uuid();
    const today = new Date().toISOString().slice(0, 10);
    const hhmm = new Date().toISOString().slice(11, 16);
    await db.prepare(`
      INSERT INTO care_sessions (id, care_recipient_id, family_user_id, caregiver_id, service_type,
        status, scheduled_date, scheduled_time, duration_hours, created_at)
      VALUES (?, ?, ?, ?, 'companionship', 'confirmed', ?, ?, 2, NOW())
    `).run(sid, recipientId, pete.user.id, tinaProfileId, today, hhmm);
    await db.prepare("UPDATE care_recipients SET timezone = 'UTC' WHERE id = ?").run(recipientId);
    pushes.length = 0;
    const res = await h.request.post(`/api/sessions/${sid}/check-in`).set(h.auth(tina.token)).send({ briefingAcknowledged: true });
    expect(res.status).toBeLessThan(300);
    const told = pushes.filter((p) => p.type === "session_in_progress").map((p) => p.userId);
    expect(told).toEqual([pete.user.id]);
  });
});
