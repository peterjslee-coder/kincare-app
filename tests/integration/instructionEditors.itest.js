/**
 * v1.127.1 — who may leave caregiver instructions.
 *
 * Pete, 11/11: Daniel tried to leave instructions before a visit and was told "Session not
 * found". The route let in only the recipient's owner and the visit's booker; the visit sheet
 * offered Edit to anyone in the family role. Pete's rule: "Anyone who can schedule appointments
 * should be able to leave care instructions."
 */
const { v4: uuid } = require("uuid");
const { startHarness, stopHarness } = require("./harness");
const { CAP, PRESETS } = require("../../src/utils/capabilities");

jest.setTimeout(180000);

let h, db, pete, daniel, viewer, tina, stranger, recipientId, teamId, tinaProfileId;

async function share(userId, caps) {
  await db.prepare(
    "INSERT INTO care_recipient_shares (id, care_recipient_id, shared_with_user_id, permission, capabilities, shared_by_user_id) VALUES (?, ?, ?, 'view', ?, ?)"
  ).run(uuid(), recipientId, userId, JSON.stringify(caps), pete.user.id);
}

beforeAll(async () => {
  h = await startHarness({ routers: { "/api/sessions": "../../src/routes/sessions" } });
  db = h.db;
  pete = await h.createUser({ roles: ["family"], firstName: "Pete" });
  daniel = await h.createUser({ roles: ["family"], firstName: "Daniel" });
  viewer = await h.createUser({ roles: ["family"], firstName: "Viewer" });
  tina = await h.createUser({ roles: ["caregiver"], firstName: "Tina" });
  stranger = await h.createUser({ roles: ["family"], firstName: "Stranger" });
  ({ recipientId, teamId } = await h.createCareTeam({ familyUserId: pete.user.id }));

  await h.addTeamMember(teamId, daniel.user.id);
  await share(daniel.user.id, [CAP.READ_VISITS, CAP.SCHEDULE_EVENTS]);
  await h.addTeamMember(teamId, viewer.user.id);
  await share(viewer.user.id, PRESETS.viewer);

  tinaProfileId = uuid();
  await db.prepare(
    "INSERT INTO caregiver_profiles (id, user_id, hourly_rate, is_background_checked, created_at) VALUES (?, ?, 25, 1, NOW())"
  ).run(tinaProfileId, tina.user.id);
  // The Julia shape: the caregiver on the visit also holds an everything share.
  await h.addTeamMember(teamId, tina.user.id);
  await share(tina.user.id, PRESETS.member);
});

afterAll(async () => { await stopHarness(h); });

async function visit(status = "confirmed") {
  const id = uuid();
  await db.prepare(`
    INSERT INTO care_sessions (id, care_recipient_id, family_user_id, caregiver_id, service_type,
                               status, scheduled_date, scheduled_time, duration_hours, special_instructions, created_at)
    VALUES (?, ?, ?, ?, 'companionship', ?, '2026-12-01', '10:00', 2, 'Help her shower.', NOW())
  `).run(id, recipientId, pete.user.id, tinaProfileId, status);
  return id;
}
const put = (id, who, text) => h.request.put(`/api/sessions/${id}/instructions`)
  .set(h.auth(who.token)).send({ specialInstructions: text, mode: "replace" });
const get = (id, who) => h.request.get(`/api/sessions/${id}`).set(h.auth(who.token));
const text = async (id) => (await db.prepare("SELECT special_instructions FROM care_sessions WHERE id = ?").get(id)).special_instructions;

describe("saving instructions", () => {
  test("Daniel — on the team, can schedule, did not book — can save them", async () => {
    const id = await visit();
    const res = await put(id, daniel, "Lunch at noon, please.");
    expect(res.status).toBe(200);
    expect(await text(id)).toBe("Lunch at noon, please.");
  });

  test("the owner who booked still can", async () => {
    const id = await visit();
    expect((await put(id, pete, "Walk after lunch.")).status).toBe(200);
  });

  test("a team member who cannot schedule is told why, and nothing changes", async () => {
    const id = await visit();
    const res = await put(id, viewer, "Skip the shower.");
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/schedule appointments/);
    expect(await text(id)).toBe("Help her shower.");
  });

  test("the caregiver on the visit cannot rewrite them, even with an everything share", async () => {
    const id = await visit();
    const res = await put(id, tina, "Leave at noon.");
    expect(res.status).toBe(403);
    expect(await text(id)).toBe("Help her shower.");
  });

  test("a stranger still learns nothing about the visit", async () => {
    const id = await visit();
    const res = await put(id, stranger, "Hello.");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Session not found");
  });
});

describe("the visit sheet is told who may edit", () => {
  test("canEditInstructions matches the save rule", async () => {
    const id = await visit();
    expect((await get(id, pete)).body.canEditInstructions).toBe(true);
    expect((await get(id, daniel)).body.canEditInstructions).toBe(true);
    expect((await get(id, viewer)).body.canEditInstructions).toBe(false);
    expect((await get(id, tina)).body.canEditInstructions).toBe(false);
  });

  test("nobody may edit a finished visit", async () => {
    const id = await visit("completed");
    expect((await get(id, pete)).body.canEditInstructions).toBe(false);
  });
});
