/**
 * v1.129.1 — change who an open request goes to (PUT /api/sessions/:id/recipient).
 *
 * Pete, 11/16 (ddd923a7): "I want the ability to be able to edit requests that I've sent to
 * caretakers. In case I have sent it to everyone, but I wanted it to be for Tina only."
 * Pete's call: narrowing to one caregiver withdraws other caregivers' pending offers.
 */
const { v4: uuid } = require("uuid");
const { startHarness, stopHarness } = require("./harness");
const { CAP } = require("../../src/utils/capabilities");

jest.setTimeout(180000);

let h, db, pete, daniel, stranger, tina, sam, newbie, recipientId, teamId, tinaProfileId, samProfileId, newbieProfileId;

async function caregiver(user, checked) {
  const id = uuid();
  await db.prepare("INSERT INTO caregiver_profiles (id, user_id, hourly_rate, is_background_checked, created_at) VALUES (?, ?, 25, ?, NOW())")
    .run(id, user.user.id, checked ? 1 : 0);
  return id;
}

beforeAll(async () => {
  h = await startHarness({ routers: { "/api/sessions": "../../src/routes/sessions" } });
  db = h.db;
  pete = await h.createUser({ roles: ["family"], firstName: "Pete" });
  daniel = await h.createUser({ roles: ["family"], firstName: "Daniel" });
  stranger = await h.createUser({ roles: ["family"], firstName: "Stranger" });
  tina = await h.createUser({ roles: ["caregiver"], firstName: "Tina" });
  sam = await h.createUser({ roles: ["caregiver"], firstName: "Sam" });
  newbie = await h.createUser({ roles: ["caregiver"], firstName: "Newbie" });
  ({ recipientId, teamId } = await h.createCareTeam({ familyUserId: pete.user.id }));
  await h.addTeamMember(teamId, daniel.user.id);
  await db.prepare(
    "INSERT INTO care_recipient_shares (id, care_recipient_id, shared_with_user_id, permission, capabilities, shared_by_user_id) VALUES (?, ?, ?, 'view', ?, ?)"
  ).run(uuid(), recipientId, daniel.user.id, JSON.stringify([CAP.READ_VISITS, CAP.SCHEDULE_EVENTS]), pete.user.id);
  tinaProfileId = await caregiver(tina, true);
  samProfileId = await caregiver(sam, true);
  newbieProfileId = await caregiver(newbie, false); // no check, no vouch
});

afterAll(async () => { await stopHarness(h); });

async function openRequest({ group = null, date = "2026-12-01", status = "open", caregiverId = null } = {}) {
  const id = uuid();
  await db.prepare(`
    INSERT INTO care_sessions (id, care_recipient_id, family_user_id, caregiver_id, service_type, status,
      scheduled_date, scheduled_time, duration_hours, recurrence_group_id, created_at)
    VALUES (?, ?, ?, ?, 'companionship', ?, ?, '10:00', 2, ?, NOW())
  `).run(id, recipientId, pete.user.id, caregiverId, status, date, group);
  return id;
}
async function bid(sessionId, fromUser) {
  const id = uuid();
  await db.prepare(`
    INSERT INTO session_offers (id, session_id, from_user_id, to_user_id, offered_rate, status, expires_at, created_at)
    VALUES (?, ?, ?, ?, 25, 'pending', NOW() + INTERVAL '1 day', NOW())
  `).run(id, sessionId, fromUser.user.id, pete.user.id);
  return id;
}
const put = (id, who, body) => h.request.put(`/api/sessions/${id}/recipient`).set(h.auth(who.token)).send(body);
const row = (id) => db.prepare("SELECT offered_to_caregiver_id, exclusive_until, private_only FROM care_sessions WHERE id = ?").get(id);

test("sent to everyone → Tina only: offered to her, private, and Sam's offer is withdrawn", async () => {
  const id = await openRequest();
  const samBid = await bid(id, sam);
  const tinaBid = await bid(id, tina);
  const res = await put(id, pete, { caregiverId: tinaProfileId, privateOnly: true });
  expect(res.status).toBe(200);
  expect(res.body.withdrawnOffers).toBe(1);
  const r = await row(id);
  expect(r.offered_to_caregiver_id).toBe(tinaProfileId);
  expect(Number(r.private_only)).toBe(1);
  expect(r.exclusive_until).toBeNull();
  expect((await db.prepare("SELECT status FROM session_offers WHERE id = ?").get(samBid)).status).toBe("withdrawn");
  expect((await db.prepare("SELECT status FROM session_offers WHERE id = ?").get(tinaBid)).status).toBe("pending");
});

test("Tina first for an hour sets the head start; back to everyone clears it", async () => {
  const id = await openRequest();
  expect((await put(id, pete, { caregiverId: tinaProfileId, privateOnly: false })).status).toBe(200);
  let r = await row(id);
  expect(r.exclusive_until).not.toBeNull();
  expect(Number(r.private_only)).toBe(0);
  expect((await put(id, pete, { caregiverId: null })).status).toBe(200);
  r = await row(id);
  expect(r.offered_to_caregiver_id).toBeNull();
  expect(r.exclusive_until).toBeNull();
});

test("a series: 'series' changes this and the later open visits, not earlier ones or taken ones", async () => {
  const g = uuid();
  const earlier = await openRequest({ group: g, date: "2026-12-01" });
  const thisOne = await openRequest({ group: g, date: "2026-12-08" });
  const later = await openRequest({ group: g, date: "2026-12-15" });
  const taken = await openRequest({ group: g, date: "2026-12-22", status: "confirmed", caregiverId: samProfileId });
  const res = await put(thisOne, pete, { caregiverId: tinaProfileId, scope: "series" });
  expect(res.status).toBe(200);
  expect(res.body.count).toBe(2);
  expect((await row(thisOne)).offered_to_caregiver_id).toBe(tinaProfileId);
  expect((await row(later)).offered_to_caregiver_id).toBe(tinaProfileId);
  expect((await row(earlier)).offered_to_caregiver_id).toBeNull();
  expect((await row(taken)).offered_to_caregiver_id).toBeNull();
});

test("someone who can schedule (Daniel) may change it; a stranger may not", async () => {
  const id = await openRequest();
  expect((await put(id, daniel, { caregiverId: tinaProfileId })).status).toBe(200);
  expect((await put(id, stranger, { caregiverId: null })).status).toBe(403);
});

test("a caregiver who isn't cleared for this family is refused", async () => {
  const id = await openRequest();
  const res = await put(id, pete, { caregiverId: newbieProfileId, privateOnly: true });
  expect(res.status).toBe(409);
  expect((await row(id)).offered_to_caregiver_id).toBeNull();
});

test("a visit a caregiver already has can't be re-pointed", async () => {
  const id = await openRequest({ status: "confirmed", caregiverId: samProfileId });
  expect((await put(id, pete, { caregiverId: tinaProfileId })).status).toBe(409);
});
