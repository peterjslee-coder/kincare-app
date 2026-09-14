/**
 * v1.106.20 — care authorization must be verified before anyone books.
 *
 * consent_status is the legal gate: it records that the person receiving care (or someone
 * entitled to decide for them) actually agreed to it. Three places in sessions.js check it,
 * including a re-check inside the booking transaction under SELECT ... FOR UPDATE, and none of
 * them had a behavioural test.
 *
 * The assertion that matters most is not the 403. It is that NO SESSION ROW EXISTS afterwards:
 * a gate that refuses the caller and still writes the booking is worse than no gate, because
 * everything downstream — the caregiver's calendar, the payment hold, the notifications — runs
 * off the row, not off the response.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || "consent-gate-secret";
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "sk_test_consent_fake";

// The booking route has a PAYMENT wall in front of the consent gate. Satisfy it, or every
// "verified books" assertion measures the payment gate instead. Dev Rule #7: nothing live.
jest.mock("stripe", () => jest.fn(() => ({
  paymentMethods: { list: jest.fn(async ({ type }) => ({
    data: type === "card" ? [{ id: "pm_card_x", type: "card", card: { last4: "4242" } }] : [],
  })) },
  paymentIntents: { create: jest.fn(async () => ({ id: "pi_x", status: "requires_capture" })) },
})));

const { startHarness, stopHarness } = require("./harness");
const { v4: uuid } = require("uuid");

jest.setTimeout(180000);

let h, db, family, recipientId;

const tomorrow = () => {
  const d = new Date(); d.setDate(d.getDate() + 3);
  return d.toISOString().slice(0, 10);
};

const setConsent = (status) => db.prepare(
  "UPDATE care_recipients SET consent_status = ? WHERE id = ?"
).run(status, recipientId);

const book = () => h.request.post("/api/sessions").set(h.auth(family.token)).send({
  careRecipientId: recipientId,
  scheduledDate: tomorrow(),
  scheduledTime: "10:00",
  durationHours: 2,
  serviceType: "companion",
});

const sessionCount = async () => Number(
  (await db.prepare("SELECT COUNT(*)::int AS n FROM care_sessions WHERE care_recipient_id = ?").get(recipientId)).n
);

beforeAll(async () => {
  h = await startHarness({ routers: { "/api/sessions": "../../src/routes/sessions" } });
  db = h.db;
  family = await h.createUser({ firstName: "Con", lastName: "Sent" });
  await db.prepare("UPDATE users SET stripe_customer_id = ? WHERE id = ?")
    .run("cus_consent_test", family.user.id);
  ({ recipientId } = await h.createCareTeam({ familyUserId: family.user.id }));
});
afterAll(async () => { await stopHarness(h); });

describe("booking is refused until authorization is verified", () => {
  test.each(["pending", "attested", "revoked", "rejected"])(
    "consent '%s' is refused, and writes nothing", async (status) => {
      await setConsent(status);
      const before = await sessionCount();

      const res = await book();
      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/authorization must be verified/i);
      // The response tells the caller WHICH state they are in, so the UI can say something
      // useful rather than "forbidden".
      expect(res.body.consentStatus).toBe(status);

      // The one that actually matters.
      expect(await sessionCount()).toBe(before);
    });

  test("'verified' books", async () => {
    await setConsent("verified");
    const before = await sessionCount();
    const res = await book();
    expect(res.status).toBeLessThan(400);
    expect(await sessionCount()).toBe(before + 1);
  });
});

describe("the gate's deliberate hole, pinned so it stays deliberate", () => {
  test("a NULL consent_status books — legacy rows predate the column", async () => {
    // The check is `consent_status && consent_status !== 'verified'`, so NULL passes. That is
    // intentional: recipients created before the column existed have no status, and the
    // v1.105 migration backfilled them to 'verified' anyway. New recipients are never NULL —
    // careRecipients.js sets 'verified' for tier1 self-signup and 'pending' for everything
    // else. If that ever changes, a recipient could be created that skips the gate entirely,
    // and this test is where that shows up.
    await db.prepare("UPDATE care_recipients SET consent_status = NULL WHERE id = ?").run(recipientId);
    const res = await book();
    expect(res.status).toBeLessThan(400);
  });

  test("…and nothing creates a NULL-consent recipient", () => {
    const { code } = require("../helpers/source");
    const src = code("src/routes/careRecipients.js");
    expect(src).toMatch(/const consentStatus = tier === 'tier1' \? 'verified' : 'pending';/);
  });
});

describe("the transaction re-checks under a lock", () => {
  test("the booking transaction takes SELECT ... FOR UPDATE and re-reads consent", () => {
    // Between the first check and the INSERT there is a window. The re-check inside the
    // transaction is what closes it; without the lock the re-read could see a stale row.
    const { code } = require("../helpers/source");
    const src = code("src/routes/sessions.js");
    const at = src.indexOf("Consent revoked during booking");
    expect(at).toBeGreaterThan(-1);
    const before = src.slice(Math.max(0, at - 1200), at);
    expect(before).toMatch(/FOR UPDATE/);
    expect(before).toMatch(/lockedRecipient/);
  });

  test("and it throws a 403 rather than continuing", () => {
    const { code } = require("../helpers/source");
    const src = code("src/routes/sessions.js");
    const at = src.indexOf("Consent revoked during booking");
    expect(src.slice(at, at + 300)).toMatch(/status: 403/);
  });
});
