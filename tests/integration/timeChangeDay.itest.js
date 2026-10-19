/**
 * v1.124.0 — a time change can move a visit to another DAY.
 *
 * Pete, 10/19: Tina accepted a Nov 7 visit and asked (outside the app) to move it to Nov 14.
 * Neither side could ask for a different day — the change sheet had start time and length only.
 *
 * Runs the real propose → accept round trip against the real schema (migration 073), and pins
 * the money edge: a card hold placed for the old day is released and the hold fields are
 * cleared, so the hold poller places a fresh one the day before the new date.
 */
const voided = [];
jest.mock("../../src/routes/accountability", () => ({
  // The real one calls Stripe. This records the call and does what the real one does to the row.
  voidSessionPayment: jest.fn(async (id) => {
    voided.push(id);
    const { getDb } = require("../../src/models/database");
    const db = await getDb();
    await db.prepare("UPDATE care_sessions SET payment_voided_at = NOW(), payment_status = 'voided' WHERE id = ?").run(id);
    return { success: true };
  }),
}));

const { v4: uuid } = require("uuid");
const { startHarness, stopHarness } = require("./harness");

jest.setTimeout(180000);

let h, db, family, cg, recipientId, profileId;

// Well in the future, so "already passed" and the 24-hour window never interfere.
const OLD_DAY = "2027-01-08";
const NEW_DAY = "2027-01-15";

beforeAll(async () => {
  h = await startHarness({ routers: { "/api/sessions": "../../src/routes/sessions" } });
  db = h.db;
  family = await h.createUser({ firstName: "Pete", lastName: "Lee", roles: ["family"] });
  cg = await h.createUser({ firstName: "Tina", lastName: "Houston", roles: ["caregiver"] });
  ({ recipientId } = await h.createCareTeam({ familyUserId: family.user.id }));
  profileId = uuid();
  await db.prepare(
    "INSERT INTO caregiver_profiles (id, user_id, hourly_rate, is_background_checked, created_at) VALUES (?, ?, 25, 1, NOW())"
  ).run(profileId, cg.user.id);
});

afterAll(async () => { await stopHarness(h); });

async function visit(extra = {}) {
  const id = uuid();
  await db.prepare(`
    INSERT INTO care_sessions (id, care_recipient_id, family_user_id, caregiver_id, service_type,
                               status, scheduled_date, scheduled_time, duration_hours, notifications_sent,
                               stripe_payment_intent_id, payment_status, created_at)
    VALUES (?, ?, ?, ?, 'companionship', 'confirmed', ?, '09:00', 8, ',reminder_24h', ?, ?, NOW())
  `).run(id, recipientId, family.user.id, profileId, OLD_DAY, extra.pi || null, extra.payStatus || null);
  return id;
}
const row = (id) => db.prepare("SELECT * FROM care_sessions WHERE id = ?").get(id);

const propose = (id, body, who = family) =>
  h.request.post(`/api/sessions/${id}/propose-time-change`).set(h.auth(who.token)).send(body);
const respond = (id, pid, action, who = cg) =>
  h.request.put(`/api/sessions/${id}/time-change/${pid}/respond`).set(h.auth(who.token)).send({ action });

describe("migration 073", () => {
  test("time_change_proposals has original_date and proposed_date", async () => {
    const cols = await db.prepare(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'time_change_proposals' AND column_name IN ('original_date', 'proposed_date')
    `).all();
    expect(cols.map((c) => c.column_name).sort()).toEqual(["original_date", "proposed_date"]);
  });
});

describe("the family asks to move a visit to another day", () => {
  test("Pete asks Nov 7 → Nov 14; nothing moves until Tina accepts; then it moves, reminders reset", async () => {
    const id = await visit();
    const res = await propose(id, { proposedDate: NEW_DAY, proposedTime: "09:00", proposedDuration: 8, reason: "Following Saturday?" });
    expect(res.status).toBe(200);
    expect(res.body.proposal).toMatchObject({ proposedDate: NEW_DAY, originalDate: OLD_DAY, proposedBy: "family" });

    const p = await db.prepare("SELECT * FROM time_change_proposals WHERE id = ?").get(res.body.proposal.id);
    expect(p).toMatchObject({ original_date: OLD_DAY, proposed_date: NEW_DAY, status: "pending" });
    // A request, not a change.
    expect(String((await row(id)).scheduled_date).slice(0, 10)).toBe(OLD_DAY);

    // Pete cannot accept his own request.
    expect((await respond(id, p.id, "accept", family)).status).toBe(400);

    const ok = await respond(id, p.id, "accept");
    expect(ok.status).toBe(200);
    expect(ok.body.newDate).toBe(NEW_DAY);
    const after = await row(id);
    expect(String(after.scheduled_date).slice(0, 10)).toBe(NEW_DAY);
    expect(after.scheduled_time).toBe("09:00");
    expect(after.notifications_sent).toBeNull();
    expect(after.pending_time_change_id).toBeNull();
  });

  test("a hold placed for the old day is released and cleared for the poller", async () => {
    const id = await visit({ pi: "pi_test_old_day", payStatus: "authorized" });
    const res = await propose(id, { proposedDate: NEW_DAY, proposedTime: "09:00", proposedDuration: 8 });
    expect(res.status).toBe(200);
    expect((await respond(id, res.body.proposal.id, "accept")).status).toBe(200);
    expect(voided).toContain(id);
    const after = await row(id);
    expect(after.stripe_payment_intent_id).toBeNull();
    expect(after.payment_status).toBeNull();
  });

  test("a same-day change leaves the hold alone", async () => {
    const id = await visit({ pi: "pi_test_same_day", payStatus: "authorized" });
    const res = await propose(id, { proposedTime: "09:00", proposedDuration: 6 }, cg);
    expect(res.status).toBe(200);
    expect((await respond(id, res.body.proposal.id, "accept", family)).status).toBe(200);
    expect(voided).not.toContain(id);
    const after = await row(id);
    expect(after.stripe_payment_intent_id).toBe("pi_test_same_day");
    expect(String(after.scheduled_date).slice(0, 10)).toBe(OLD_DAY);
    expect(Number(after.duration_hours)).toBe(6);
  });
});

describe("what the request refuses", () => {
  test("no change at all", async () => {
    const id = await visit();
    const res = await propose(id, { proposedDate: OLD_DAY, proposedTime: "09:00", proposedDuration: 8 });
    expect(res.status).toBe(400);
  });
  test("a day that has passed", async () => {
    const id = await visit();
    expect((await propose(id, { proposedDate: "2020-01-01", proposedTime: "09:00", proposedDuration: 8 })).status).toBe(400);
  });
  test("a malformed day", async () => {
    const id = await visit();
    expect((await propose(id, { proposedDate: "Nov 14", proposedTime: "09:00", proposedDuration: 8 })).status).toBe(400);
  });
});

test("an old proposal (no proposed_date) keeps the day when accepted", async () => {
  const id = await visit();
  const pid = uuid();
  await db.prepare(`
    INSERT INTO time_change_proposals (id, session_id, proposed_by, proposed_by_user_id,
      original_time, original_duration, proposed_time, proposed_duration, status, created_at, expires_at)
    VALUES (?, ?, 'caregiver', ?, '09:00', 8, '10:00', 8, 'pending', NOW(), NOW() + INTERVAL '1 day')
  `).run(pid, id, cg.user.id);
  await db.prepare("UPDATE care_sessions SET pending_time_change_id = ? WHERE id = ?").run(pid, id);
  expect((await respond(id, pid, "accept", family)).status).toBe(200);
  const after = await row(id);
  expect(String(after.scheduled_date).slice(0, 10)).toBe(OLD_DAY);
  expect(after.scheduled_time).toBe("10:00");
});
