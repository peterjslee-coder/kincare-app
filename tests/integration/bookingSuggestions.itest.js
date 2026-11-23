/**
 * v1.151.0 — /api/assignments/suggestions carries what the ranked picker needs:
 *   - recent_visits: COMPLETED visits with this person in the last 30 days (care-location days)
 *   - booked: already has a confirmed visit that overlaps the one being requested
 *   - never the requester themself (a family member with a caregiver profile was listed in
 *     their own picker as "Available")
 */
const { startHarness, stopHarness } = require("./harness");
const { v4: uuid } = require("uuid");

jest.setTimeout(180000);
let h, getDb, BookingRank, getTodayStringInZone;

beforeAll(async () => {
  h = await startHarness({ routers: { "/api/assignments": "../../src/routes/assignments" } });
  ({ getDb } = require("../../src/models/database"));
  BookingRank = require("../../public/js/bookingRank");
  ({ getTodayStringInZone } = require("../../src/utils/timezone"));
});
afterAll(async () => { await stopHarness(h); });

async function caregiver(db, name) {
  const u = await h.createUser({ firstName: name, roles: ["caregiver"] });
  const profileId = uuid();
  await db.prepare(
    "INSERT INTO caregiver_profiles (id, user_id, hourly_rate, is_available) VALUES (?, ?, 24, 1)"
  ).run(profileId, u.user.id);
  return { ...u, profileId };
}

async function visit(db, { recipientId, familyId, profileId, date, time = "09:00", hours = 4, status = "completed" }) {
  await db.prepare(
    `INSERT INTO care_sessions (id, care_recipient_id, family_user_id, caregiver_id, service_type, status,
       scheduled_date, scheduled_time, duration_hours)
     VALUES (?, ?, ?, ?, 'companionship', ?, ?, ?, ?)`
  ).run(uuid(), recipientId, familyId, profileId, status, date, time, hours);
}

async function setup() {
  const db = await getDb();
  const family = await h.createUser({ firstName: "Sam", roles: ["family", "caregiver"] });
  const recipientId = uuid();
  await db.prepare(
    "INSERT INTO care_recipients (id, family_user_id, first_name, last_name, timezone) VALUES (?, ?, 'Jane', 'T', 'America/New_York')"
  ).run(recipientId, family.user.id);
  const today = getTodayStringInZone("America/New_York");
  return { db, family, recipientId, today };
}

const get = (token, qs) => h.request.get(`/api/assignments/suggestions?${qs}`).set(h.auth(token));

test("recent_visits counts only completed visits inside 30 days", async () => {
  const { db, family, recipientId, today } = await setup();
  const fresh = await caregiver(db, "Fresh");
  const old = await caregiver(db, "Old");
  const base = { recipientId, familyId: family.user.id };
  await visit(db, { ...base, profileId: fresh.profileId, date: BookingRank.minusDays(today, 3) });
  await visit(db, { ...base, profileId: fresh.profileId, date: BookingRank.minusDays(today, -10), status: "confirmed" });
  await visit(db, { ...base, profileId: old.profileId, date: BookingRank.minusDays(today, 45) });

  const res = await get(family.token, `careRecipientId=${recipientId}`);
  expect(res.status).toBe(200);
  const by = Object.fromEntries(res.body.suggestions.map((c) => [c.first_name, c]));
  expect(Number(by.Fresh.recent_visits)).toBe(1);   // the future confirmed one is not currency
  expect(Number(by.Fresh.visit_count)).toBe(2);
  expect(Number(by.Old.recent_visits)).toBe(0);
  expect(by.Old.last_completed_visit).toBe(BookingRank.minusDays(today, 45));
});

test("the requester is never in their own list", async () => {
  const { db, family, recipientId, today } = await setup();
  const selfProfile = uuid();
  await db.prepare(
    "INSERT INTO caregiver_profiles (id, user_id, hourly_rate, is_available) VALUES (?, ?, 28, 1)"
  ).run(selfProfile, family.user.id);
  await db.prepare(
    "INSERT INTO caregiver_assignments (id, caregiver_profile_id, care_recipient_id, family_user_id, is_active) VALUES (?, ?, ?, ?, 1)"
  ).run(uuid(), selfProfile, recipientId, family.user.id);
  await visit(db, { recipientId, familyId: family.user.id, profileId: selfProfile, date: BookingRank.minusDays(today, 2) });

  const res = await get(family.token, `careRecipientId=${recipientId}`);
  const ids = res.body.suggestions.map((c) => c.caregiver_user_id);
  expect(ids).not.toContain(family.user.id);
});

test("booked: an overlapping confirmed visit is flagged; with this person it says when", async () => {
  const { db, family, recipientId, today } = await setup();
  const kay = await caregiver(db, "Kay");
  const tina = await caregiver(db, "Tina");
  const day = BookingRank.minusDays(today, -6);
  const base = { recipientId, familyId: family.user.id };
  await visit(db, { ...base, profileId: kay.profileId, date: BookingRank.minusDays(today, 7) });
  await visit(db, { ...base, profileId: kay.profileId, date: day, time: "09:00", hours: 4, status: "confirmed" });
  await visit(db, { ...base, profileId: tina.profileId, date: BookingRank.minusDays(today, 7) });
  await visit(db, { ...base, profileId: tina.profileId, date: day, time: "13:00", hours: 4, status: "confirmed" });

  const res = await get(family.token, `careRecipientId=${recipientId}&date=${day}&time=09:00&durationHours=4`);
  const by = Object.fromEntries(res.body.suggestions.map((c) => [c.first_name, c]));
  expect(by.Kay.booked).toMatchObject({ sameRecipient: true, time: "09:00", durationHours: 4 });
  expect(by.Tina.booked).toBeNull();   // 13:00 starts as this one ends

  const noWindow = await get(family.token, `careRecipientId=${recipientId}`);
  expect(noWindow.body.suggestions.every((c) => c.booked === undefined)).toBe(true);
});
