/**
 * v1.108.1 — a tip on a visit that is already paid.
 * Pete (9/17): "I see the tip option for Paul...but I never see that live with Tina." Visits are
 * paid at check-out now, and the only tip path was the pay-later window. His rules: the
 * caregiver gets the whole tip, the family also covers the card fee, offered until reviewed.
 */
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "sk_test_integration_fake";
const mockCreated = [];
let mockFail = false;
jest.mock("stripe", () => jest.fn(() => ({
  paymentIntents: {
    retrieve: jest.fn(async (id) => ({ id, status: "succeeded", customer: "cus_sara", payment_method: "pm_sara" })),
    create: jest.fn(async (args, opts) => {
      if (mockFail) { const e = new Error("card declined"); e.code = "card_declined"; throw e; }
      mockCreated.push({ args, opts });
      return { id: `pi_tip_${mockCreated.length}`, status: "succeeded" };
    }),
  },
})));
const mockPush = jest.fn(async () => ({ sent: 1 }));
jest.mock("../../src/routes/push", () => {
  const actual = jest.requireActual("../../src/routes/push");
  return { ...actual, sendPushToUser: (...a) => mockPush(...a) };
});

const { v4: uuid } = require("uuid");
const { startHarness, stopHarness } = require("./harness");
const { tipWithCardFee } = require("../../src/utils/pricing");
jest.setTimeout(180000);

let h, db, pete, sara, stranger, tina, profileId, recipientId;
beforeAll(async () => {
  h = await startHarness({ routers: { "/api/sessions": "../../src/routes/sessions" } });
  db = h.db;
  pete = await h.createUser({ firstName: "Peter", roles: ["family"] });
  sara = await h.createUser({ firstName: "Sara", roles: ["family"] });
  stranger = await h.createUser({ firstName: "Nobody", roles: ["family"] });
  ({ recipientId } = await h.createCareTeam({ familyUserId: pete.user.id, billingUserId: sara.user.id }));
  await db.prepare("UPDATE care_recipients SET first_name = 'Betty' WHERE id = ?").run(recipientId);
  tina = await h.createUser({ firstName: "Tina", roles: ["caregiver"] });
  profileId = uuid();
  await db.prepare("INSERT INTO caregiver_profiles (id, user_id, hourly_rate, stripe_account_id, created_at) VALUES (?, ?, 22, 'acct_tina', NOW())").run(profileId, tina.user.id);
});
afterAll(async () => { await stopHarness(h); });

async function visit({ paid = true, reviewed = false } = {}) {
  const sid = uuid();
  await db.prepare(`
    INSERT INTO care_sessions (id, care_recipient_id, family_user_id, caregiver_id, service_type, status,
      scheduled_date, scheduled_time, duration_hours, estimated_cost, payment_status, stripe_payment_intent_id,
      review_required, review_completed, created_at)
    VALUES (?, ?, ?, ?, 'companion', 'completed', '2026-09-16', '09:00', 8, 176, ?, 'pi_visit', 1, ?, NOW())
  `).run(sid, recipientId, pete.user.id, profileId, paid ? "paid" : "authorized", reviewed ? 1 : 0);
  return sid;
}
const tip = (sid, who, cents) => h.request.post(`/api/sessions/${sid}/tip`).set(h.auth(who.token)).send({ amount_cents: cents });

test("a $35.20 tip charges the card the tip plus the card fee, and Tina receives all of it", async () => {
  const sid = await visit();
  mockCreated.length = 0; mockPush.mockClear();
  const r = await tip(sid, sara, 3520);
  expect(r.status).toBe(200);
  const q = tipWithCardFee(3520);
  expect(q.totalCents - q.feeCents).toBe(3520);
  expect(q.totalCents).toBe(3657); // ceil((3520 + 30) / 0.971) = ceil(3656.02)
  const { args, opts } = mockCreated[0];
  expect(args).toEqual(expect.objectContaining({
    amount: q.totalCents, application_fee_amount: q.feeCents,
    customer: "cus_sara", payment_method: "pm_sara", off_session: true, confirm: true,
    transfer_data: { destination: "acct_tina" },
  }));
  expect(opts.idempotencyKey).toBe(`inplace_tip_${sid}_3520`);
  const row = await db.prepare("SELECT status, amount_cents, card_fee_cents, stripe_payment_intent FROM tips WHERE session_id = ?").get(sid);
  expect(row).toEqual({ status: "paid", amount_cents: 3520, card_fee_cents: q.feeCents, stripe_payment_intent: "pi_tip_1" });
  const toTina = mockPush.mock.calls.filter((c) => c[0] === tina.user.id);
  expect(toTina[0][1].body).toBe("Sara sent you a $35.20 tip for your visit with Betty.");
});

test("a second tip on the same visit is refused and charges nothing", async () => {
  const sid = await visit();
  expect((await tip(sid, pete, 2000)).status).toBe(200);
  mockCreated.length = 0;
  const again = await tip(sid, sara, 2000);
  expect(again.status).toBe(409);
  expect(mockCreated).toHaveLength(0);
});

test("once reviewed, or before it is paid, there is no tip here", async () => {
  expect((await tip(await visit({ reviewed: true }), pete, 2000)).status).toBe(409);
  expect((await tip(await visit({ paid: false }), pete, 2000)).status).toBe(409);
});

test("someone who neither booked nor pays for the visit gets nothing", async () => {
  expect((await tip(await visit(), stranger, 2000)).status).toBe(404);
});

test("a declined card leaves no tip behind, so she can try again", async () => {
  const sid = await visit();
  mockFail = true;
  const r = await tip(sid, sara, 2000);
  mockFail = false;
  expect(r.status).toBe(402);
  expect(await db.prepare("SELECT id FROM tips WHERE session_id = ?").get(sid)).toBeUndefined();
  expect((await tip(sid, sara, 2000)).status).toBe(200);
});

test("amounts outside $1–$500 are refused", async () => {
  const sid = await visit();
  expect((await tip(sid, pete, 50)).status).toBe(400);
  expect((await tip(sid, pete, 50001)).status).toBe(400);
});
