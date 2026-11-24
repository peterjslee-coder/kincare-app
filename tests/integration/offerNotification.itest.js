/**
 * v1.106.34 — tell the person the job is actually for. (Pete: "I'm not sure she even
 * realizes they're there.")
 *
 * She didn't, and this is why. The create route notified
 * `caregiver_assignments WHERE family_user_id = ?` — caregivers who have ALREADY worked for
 * this family. Every ensureAssignment call site runs after a caregiver is confirmed onto a
 * session, so that table holds nobody until they have accepted something. A direct offer to
 * a caregiver who has never accepted one therefore notified NOBODY, while appearing silently
 * as a tile on her home screen.
 *
 * Tina's case was worse: ensureAssignment had been throwing `uuid is not defined` since
 * v1.106.16 (fixed this morning in v1.106.23), so the table had no row for her at all.
 * Twenty offers, zero notifications, twenty silent tiles.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || "offer-notify-secret";
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "sk_test_notify_fake";

jest.mock("stripe", () => jest.fn(() => ({
  paymentMethods: { list: jest.fn(async ({ type }) => ({
    data: type === "card" ? [{ id: "pm_x", type: "card", card: { last4: "4242" } }] : [],
  })) },
  paymentIntents: { create: jest.fn(async () => ({ id: "pi_x", status: "requires_capture" })) },
})));

// Capture every push instead of sending one.
const mockPush = jest.fn(async () => ({ sent: 1 }));
jest.mock("../../src/routes/push", () => {
  const actual = jest.requireActual("../../src/routes/push");
  return { ...actual, sendPushToUser: (...a) => mockPush(...a) };
});

const { startHarness, stopHarness } = require("./harness");
const { v4: uuid } = require("uuid");

jest.setTimeout(180000);

let h, db, family, tina, tinaProfile, julia, juliaProfile, recipientId;

const soon = (d = 3) => {
  const x = new Date(); x.setDate(x.getDate() + d);
  return x.toISOString().slice(0, 10);
};

const book = (extra = {}) => h.request.post("/api/sessions").set(h.auth(family.token)).send({
  careRecipientId: recipientId,
  scheduledDate: soon(),
  scheduledTime: "09:00",
  durationHours: 8,
  serviceType: "companion",
  ...extra,
});

const pushesTo = (userId) => mockPush.mock.calls.filter((c) => c[0] === userId);

beforeAll(async () => {
  h = await startHarness({ routers: { "/api/sessions": "../../src/routes/sessions" } });
  db = h.db;

  family = await h.createUser({ firstName: "Pete", lastName: "ITest" });
  await db.prepare("UPDATE users SET stripe_customer_id = ? WHERE id = ?").run("cus_x", family.user.id);

  // Tina: offered work, has NEVER accepted anything, so no caregiver_assignments row.
  tina = await h.createUser({ roles: ["caregiver"], firstName: "Tina", lastName: "ITest" });
  tinaProfile = uuid();
  await db.prepare(`
    INSERT INTO caregiver_profiles (id, user_id, hourly_rate, is_background_checked, care_stoplight, created_at)
    VALUES (?, ?, 25, 1, 'green', NOW())
  `).run(tinaProfile, tina.user.id);

  // Julia: already on the family's roster, the only person the old code could reach.
  julia = await h.createUser({ roles: ["caregiver"], firstName: "Julia", lastName: "ITest" });
  juliaProfile = uuid();
  await db.prepare(`
    INSERT INTO caregiver_profiles (id, user_id, hourly_rate, is_background_checked, care_stoplight, created_at)
    VALUES (?, ?, 25, 1, 'green', NOW())
  `).run(juliaProfile, julia.user.id);

  ({ recipientId } = await h.createCareTeam({ familyUserId: family.user.id }));
  await db.prepare("UPDATE care_recipients SET consent_status = 'verified' WHERE id = ?").run(recipientId);
  await db.prepare(`
    INSERT INTO caregiver_assignments (id, caregiver_profile_id, care_recipient_id, family_user_id, is_active, created_at)
    VALUES (?, ?, ?, ?, 1, NOW())
  `).run(uuid(), juliaProfile, recipientId, family.user.id);
});

beforeEach(() => mockPush.mockClear());
afterEach(async () => {
  await db.prepare("DELETE FROM care_sessions WHERE care_recipient_id = ?").run(recipientId);
});
afterAll(async () => { await stopHarness(h); });

describe("a job offered directly to someone", () => {
  test("reaches her even though she has never worked for this family", async () => {
    // THE bug. She is not in caregiver_assignments, which is the only list the old code
    // notified, so twenty offers produced zero notifications.
    const res = await book({ directOffer: true, caregiverId: tinaProfile });
    expect(res.status).toBeLessThan(300);
    expect(pushesTo(tina.user.id)).toHaveLength(1);
  });

  test("the message is about HER offer, not the generic broadcast", async () => {
    await book({ directOffer: true, caregiverId: tinaProfile });
    const [, payload] = pushesTo(tina.user.id)[0];
    expect(payload.title).toMatch(/offered to you/i);
    expect(payload.data.page).toBe("find-work");
  });

  test("nobody else on the roster is told — an exclusive offer is exclusive", async () => {
    // Telling the rest of the roster about a job that is hers for the next hour is how
    // "just for you" stops meaning anything.
    await book({ directOffer: true, caregiverId: tinaProfile });
    expect(pushesTo(julia.user.id)).toHaveLength(0);
  });

  test("a whole series is ONE notification that says how many", async () => {
    // Twenty separate bookings meant twenty identical pings this morning, which is how a
    // person learns to ignore them.
    const res = await book({
      directOffer: true, caregiverId: tinaProfile,
      recurrenceRule: "days", recurrenceWeeks: 4, recurrenceDays: "mon,tue,wed,thu,fri",
    });
    expect(res.status).toBeLessThan(300);
    const got = pushesTo(tina.user.id);
    expect(got).toHaveLength(1);
    expect(got[0][1].body).toMatch(/20 visits/);
  });
});

describe("an open request, offered to nobody in particular", () => {
  test("still goes to the family's roster, as before", async () => {
    const res = await book({});
    expect(res.status).toBeLessThan(300);
    expect(pushesTo(julia.user.id)).toHaveLength(1);
  });

  test("and not to a caregiver with no connection to this family", async () => {
    await book({});
    expect(pushesTo(tina.user.id)).toHaveLength(0);
  });

  test("a recurring open request is one notification saying the count", async () => {
    await book({ recurrenceRule: "weekly", recurrenceWeeks: 4 });
    const got = pushesTo(julia.user.id);
    expect(got).toHaveLength(1);
    expect(got[0][1].body).toMatch(/4 visits/);
  });
});
