/**
 * v1.109.8 — Pete (50f59a7b): "when I clicked on the notification from my home screen, it
 * brought me to details of the appointment. I accepted the change, but the needs you tile is
 * still here and when I attempt to close it out, it says it's already been responded to."
 *
 * The Needs-you card reads 409 as "already in the state you asked for — done". The endpoints it
 * acts through answered 400 instead, so the second tap was shown as an error.
 */
const { v4: uuid } = require("uuid");
const { startHarness, stopHarness } = require("./harness");

jest.setTimeout(180000);
let h, db;

beforeAll(async () => {
  h = await startHarness({ routers: { "/api/sessions": "../../src/routes/sessions" } });
  db = h.db;
});
afterAll(async () => { await stopHarness(h); });

async function pendingChange() {
  const family = await h.createUser({ firstName: "Pete" });
  const { recipientId } = await h.createCareTeam({ familyUserId: family.user.id });
  const cg = await h.createUser({ firstName: "Tina", roles: ["caregiver"] });
  const profileId = uuid();
  await db.prepare("INSERT INTO caregiver_profiles (id, user_id, hourly_rate, created_at) VALUES (?, ?, 25, NOW())").run(profileId, cg.user.id);
  const sessionId = uuid();
  await db.prepare(`
    INSERT INTO care_sessions (id, care_recipient_id, family_user_id, caregiver_id, service_type,
      status, scheduled_date, scheduled_time, duration_hours, created_at)
    VALUES (?, ?, ?, ?, 'companionship', 'confirmed', '2026-12-02', '10:00', 2, NOW())
  `).run(sessionId, recipientId, family.user.id, profileId);
  const propId = uuid();
  await db.prepare(`
    INSERT INTO time_change_proposals (id, session_id, proposed_by, proposed_by_user_id,
      original_time, original_duration, proposed_time, proposed_duration, status, created_at)
    VALUES (?, ?, 'caregiver', ?, '10:00', 2, '14:00', 2, 'pending', NOW())
  `).run(propId, sessionId, cg.user.id);
  await db.prepare("UPDATE care_sessions SET pending_time_change_id = ? WHERE id = ?").run(propId, sessionId);
  return { family, sessionId, propId };
}

const respond = (t, action) => h.request.put(`/api/sessions/${t.sessionId}/time-change/${t.propId}/respond`)
  .set(h.auth(t.family.token)).send({ action });

test("accept from the visit details, then accept from the Needs-you card: 409, not an error", async () => {
  const t = await pendingChange();
  expect((await respond(t, "accept")).status).toBe(200);
  const again = await respond(t, "accept");
  expect(again.status).toBe(409);
  expect(again.body.code).toBe("ALREADY_RESPONDED");
});

test("and it has left the Needs-you list", async () => {
  const t = await pendingChange();
  const { attentionItemsFor } = require("../../src/utils/attention");
  const before = await attentionItemsFor(db, t.family.user.id);
  expect(JSON.stringify(before)).toContain(t.propId);
  await respond(t, "accept");
  const after = await attentionItemsFor(db, t.family.user.id);
  expect(JSON.stringify(after)).not.toContain(t.propId);
});

test("accepting something that was DECLINED is still a real error", async () => {
  const t = await pendingChange();
  expect((await respond(t, "reject")).status).toBe(200);
  const res = await respond(t, "accept");
  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/already rejected/);
});
