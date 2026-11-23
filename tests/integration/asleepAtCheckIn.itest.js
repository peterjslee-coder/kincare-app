/**
 * v1.153.3 — "she was asleep."
 *
 * Pete, 11/23: "we need an option besides whether or not Betty is aware. Because she was
 * asleep." Before this, a caregiver at a sleeping person's bedside could only pick "unaware"
 * or "unable to assess" — both of which PAUSE every future booking and alert the family and
 * admin. Asleep is not a concern: nothing pauses, and the question comes back at the
 * fifteen-minute check, where she answers once the person is up.
 */
const { startHarness, stopHarness } = require("./harness");
const { v4: uuid } = require("uuid");
const { awarenessFollowUpDue } = require("../../src/utils/settledCheck");

const TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
jest.setTimeout(180000);

let h, db, fam, cg, cgProfileId, recipientId;

beforeAll(async () => {
  h = await startHarness({ routers: { "/api/sessions": "../../src/routes/sessions", "/api/dashboard": "../../src/routes/dashboard" } });
  db = h.db;
  fam = await h.createUser({ roles: ["family"], firstName: "Sam" });
  ({ recipientId } = await h.createCareTeam({ familyUserId: fam.user.id }));
  cg = await h.createUser({ roles: ["caregiver"], firstName: "Jane" });
  cgProfileId = uuid();
  await db.prepare("INSERT INTO caregiver_profiles (id, user_id, hourly_rate, created_at) VALUES (?, ?, 25, NOW())").run(cgProfileId, cg.user.id);
});
afterAll(async () => { await stopHarness(h); });
beforeEach(async () => {
  await db.prepare("DELETE FROM first_visit_confirmations").run();
  await db.prepare("DELETE FROM visit_logs").run();
  await db.prepare("DELETE FROM care_sessions").run();
  await db.prepare("UPDATE care_recipients SET bookings_paused = 0, bookings_paused_reason = NULL").run();
});

async function visit(agoMinutes = 20) {
  const sessionId = uuid();
  await db.prepare(`
    INSERT INTO care_sessions (id, care_recipient_id, family_user_id, caregiver_id, service_type,
                               status, scheduled_date, scheduled_time, duration_hours, estimated_cost, created_at)
    VALUES (?, ?, ?, ?, 'companionship', 'in_progress', '${TODAY}', '09:00', 8, 200, NOW())
  `).run(sessionId, recipientId, fam.user.id, cgProfileId);
  await db.prepare(`
    INSERT INTO visit_logs (id, session_id, caregiver_id, check_in_time, created_at)
    VALUES (?, ?, ?, NOW() - (? || ' minutes')::interval, NOW())
  `).run(uuid(), sessionId, cgProfileId, String(agoMinutes));
  return sessionId;
}
const paused = async () => (await db.prepare("SELECT bookings_paused FROM care_recipients WHERE id = ?").get(recipientId)).bookings_paused;
const confirm = (id, body) => h.request.post(`/api/sessions/${id}/first-visit-confirm`).set(h.auth(cg.token)).send(body);
const follow = (id, body, token = cg.token) => h.request.post(`/api/sessions/${id}/awareness-followup`).set(h.auth(token)).send(body);

test("asleep at check-in pauses nothing and is asked again at fifteen minutes", async () => {
  const id = await visit(20);
  const r = await confirm(id, { confirmation: "asleep" });
  expect(r.status).toBe(200);
  expect(Number(await paused())).toBe(0);
  const feed = await db.prepare("SELECT COUNT(*) AS n FROM activity_feed WHERE event_type LIKE 'first_visit_concern%'").get();
  expect(Number(feed.n)).toBe(0);

  const dash = await h.request.get("/api/dashboard").set(h.auth(cg.token));
  const mine = JSON.stringify(dash.body);
  expect(mine).toMatch(/"awarenessFollowUpDue":true/);
});

test("awake and aware: recorded, nothing paused, and the question goes away", async () => {
  const id = await visit(20);
  await confirm(id, { confirmation: "asleep" });
  const r = await follow(id, { confirmation: "yes" });
  expect(r.body.confirmation).toBe("yes");
  const row = await db.prepare("SELECT confirmation FROM first_visit_confirmations WHERE session_id = ?").get(id);
  expect(row.confirmation).toBe("yes");
  expect(Number(await paused())).toBe(0);
});

test("awake but unaware: the same concern path as at the door", async () => {
  const id = await visit(20);
  await confirm(id, { confirmation: "asleep" });
  await follow(id, { confirmation: "no", notes: "Did not know who I was" });
  expect(Number(await paused())).toBe(1);
  const feed = await db.prepare("SELECT COUNT(*) AS n FROM activity_feed WHERE event_type = 'first_visit_concern'").get();
  expect(Number(feed.n)).toBe(1);
});

test("still asleep records nothing; an answered visit can't be re-answered; strangers can't answer", async () => {
  const id = await visit(20);
  await confirm(id, { confirmation: "asleep" });
  await follow(id, { confirmation: "asleep" });
  expect((await db.prepare("SELECT confirmation FROM first_visit_confirmations WHERE session_id = ?").get(id)).confirmation).toBe("asleep");

  const other = await h.createUser({ roles: ["caregiver"], firstName: "Sam" });
  expect((await follow(id, { confirmation: "no" }, other.token)).status).toBe(403);

  await follow(id, { confirmation: "yes" });
  const again = await follow(id, { confirmation: "no" });
  expect(again.body.alreadyAnswered).toBe(true);
  expect(Number(await paused())).toBe(0);
});

test("awarenessFollowUpDue: only asleep, only after fifteen minutes, only before check-out", () => {
  const now = new Date();
  const ago = (m) => new Date(now - m * 60000).toISOString();
  expect(awarenessFollowUpDue({ check_in_time: ago(20), first_visit_confirmation: "asleep" }, { now })).toBe(true);
  expect(awarenessFollowUpDue({ check_in_time: ago(5), first_visit_confirmation: "asleep" }, { now })).toBe(false);
  expect(awarenessFollowUpDue({ check_in_time: ago(20), first_visit_confirmation: "yes" }, { now })).toBe(false);
  expect(awarenessFollowUpDue({ check_in_time: ago(20), check_out_time: ago(1), first_visit_confirmation: "asleep" }, { now })).toBe(false);
});
