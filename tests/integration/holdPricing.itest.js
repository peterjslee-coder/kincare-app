/**
 * v1.107.0 — what the card is actually asked for, on the hold path.
 *
 * Sep 14 2026, a real visit: the pre-shift hold authorized $192 (8h × $24) with a $38.40
 * application fee INSIDE it. Check-out captured $176 and Stripe kept the full $38.40, so the
 * caregiver received $137.60. Pete's rule: she gets $176, InPlace gets 20% of that, and the
 * family pays $211.20.
 *
 * platformFeeAgreement.itest.js passed throughout, because it computed the "charged" fee
 * itself instead of looking at what Stripe was handed. Every assertion here is on the
 * arguments the Stripe client actually received.
 */
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "sk_test_integration_fake";

const mockCreated = [];
const mockCaptured = [];
let mockSavedMethods = [];
let mockHeld = {};
let mockFailNextCreate = false;

jest.mock("stripe", () => jest.fn(() => ({
  paymentIntents: {
    create: jest.fn(async (args, opts) => {
      if (mockFailNextCreate) { mockFailNextCreate = false; throw new Error("card_declined"); }
      mockCreated.push({ args, opts });
      const id = `pi_${mockCreated.length}`;
      mockHeld[id] = { id, customer: args.customer, payment_method: args.payment_method, amount: args.amount };
      return { id, status: args.capture_method === "manual" ? "requires_capture" : "succeeded", amount: args.amount };
    }),
    capture: jest.fn(async (id, args, opts) => { mockCaptured.push({ id, args, opts }); return { id, status: "succeeded", amount_received: args.amount_to_capture }; }),
    retrieve: jest.fn(async (id) => mockHeld[id] || { id, customer: "cus_legacy", payment_method: "pm_legacy" }),
    cancel: jest.fn(async (id) => ({ id, status: "canceled" })),
  },
  paymentMethods: {
    list: jest.fn(async ({ type }) => ({ data: mockSavedMethods.filter((m) => m.type === type) })),
  },
})));

const { startHarness, stopHarness } = require("./harness");
const { v4: uuid } = require("uuid");

jest.setTimeout(180000);

let h, db, acct, captureForSession;

const setFee = (pct) => db.prepare(
  "INSERT INTO platform_settings (key, value) VALUES ('platform_fee_percent', ?) ON CONFLICT (key) DO UPDATE SET value = ?"
).run(String(pct), String(pct));

beforeAll(async () => {
  h = await startHarness({ routers: { "/api/sessions": "../../src/routes/sessions" } });
  db = h.db;
  acct = require("../../src/routes/accountability");
  ({ captureForSession } = require("../../src/utils/sessionCapture"));
});
afterAll(async () => { await setFee(20); await stopHarness(h); });

beforeEach(async () => {
  mockCreated.length = 0; mockCaptured.length = 0; mockHeld = {};
  mockSavedMethods = [{ id: "pm_card_1", type: "card", card: { last4: "4242", brand: "visa" } }];
  await setFee(20);
});

/**
 * Tina's real booking by default: the family proposed $22/h for 8h, so the session carries
 * estimated_cost $176 and proposed_rate 22, and NO agreed_rate. Her profile says $24/h —
 * which is what the old hold used.
 */
async function fundableSession({ profileRate = 24, quoted = 176, proposedRate = 22, hours = 8, agreedRate = null } = {}) {
  const family = await h.createUser({ firstName: "Pay", lastName: "Er" });
  await db.prepare("UPDATE users SET stripe_customer_id = ? WHERE id = ?").run(`cus_${uuid().slice(0, 8)}`, family.user.id);
  const { recipientId } = await h.createCareTeam({ familyUserId: family.user.id });
  const cg = await h.createUser({ firstName: "Care", lastName: "Giver", roles: ["caregiver"] });
  const profileId = uuid();
  const acctId = `acct_${uuid().slice(0, 8)}`;
  await db.prepare(`
    INSERT INTO caregiver_profiles
      (id, user_id, hourly_rate, rate_daytime, is_background_checked, is_available,
       stripe_account_id, stripe_onboard_complete, identity_verified, created_at)
    VALUES (?, ?, ?, ?, 1, 1, ?, 1, 1, NOW())
  `).run(profileId, cg.user.id, profileRate, profileRate, acctId);
  await db.prepare(`
    INSERT INTO verified_documents
      (id, owner_type, owner_id, uploaded_by, category, document_type, file_data, status, created_at)
    VALUES (?, 'caregiver', ?, ?, 'identity', 'drivers_license', 'data:image/png;base64,AAAA', 'approved', NOW())
  `).run(uuid(), profileId, cg.user.id);
  const sessionId = uuid();
  await db.prepare(`
    INSERT INTO care_sessions
      (id, care_recipient_id, family_user_id, caregiver_id, service_type, status,
       scheduled_date, scheduled_time, duration_hours, agreed_rate, proposed_rate, estimated_cost, created_at)
    VALUES (?, ?, ?, ?, 'companionship', 'confirmed', '2026-11-10', '10:00', ?, ?, ?, ?, NOW())
  `).run(sessionId, recipientId, family.user.id, profileId, hours, agreedRate, proposedRate, quoted);
  return { sessionId, family, acctId };
}

/** A hold exactly like the ones placed before v1.107.0: rate × time, fee inside. */
async function legacyHold(sessionId, cents) {
  await db.prepare(`
    UPDATE care_sessions SET stripe_payment_intent_id = 'pi_legacy', authorized_amount = ?,
      payment_status = 'authorized', payment_authorized_at = NOW() WHERE id = ?
  `).run(cents, sessionId);
}

describe("the hold is what the family was quoted, fee on top", () => {
  test("Tina's booking — $22 × 8h quoted, profile says $24 — holds $211.20 with a $35.20 fee", async () => {
    const { sessionId } = await fundableSession();
    const r = await acct.authorizeSessionPayment(sessionId);
    expect(r.error).toBeUndefined();
    expect(mockCreated[0].args.amount).toBe(21120);
    expect(mockCreated[0].args.application_fee_amount).toBe(3520);
    const row = await db.prepare("SELECT authorized_amount FROM care_sessions WHERE id = ?").get(sessionId);
    expect(Number(row.authorized_amount)).toBe(21120);
  });

  test("the hold equals the family_total the family is shown", async () => {
    const { sessionId, family } = await fundableSession({ quoted: 130, proposedRate: 26, hours: 5 });
    await acct.authorizeSessionPayment(sessionId);
    const res = await h.request.get("/api/sessions").set(h.auth(family.token));
    expect(res.status).toBe(200);
    const s = (res.body.sessions || []).find((x) => x.id === sessionId);
    expect(s).toBeTruthy();
    expect(Number(s.caregiver_payout)).toBe(130);
    expect(mockCreated[0].args.amount).toBe(Math.round(Number(s.family_total) * 100));
    expect(mockCreated[0].args.application_fee_amount).toBe(Math.round(Number(s.platform_fee) * 100));
  });

  test("the hold follows the admin fee dial", async () => {
    await setFee(12);
    const { sessionId } = await fundableSession();
    await acct.authorizeSessionPayment(sessionId);
    expect(mockCreated[0].args.amount).toBe(17600 + 2112);
    expect(mockCreated[0].args.application_fee_amount).toBe(2112);
  });

  test("with no quoted cost it falls back to the agreed rate", async () => {
    const { sessionId } = await fundableSession({ quoted: null, agreedRate: 22 });
    await acct.authorizeSessionPayment(sessionId);
    expect(mockCreated[0].args.amount).toBe(21120);
  });
});

describe("capture pays the caregiver exactly what she worked", () => {
  test("a full visit: $176 to her, $35.20 fee, $211.20 from the family", async () => {
    const { sessionId } = await fundableSession();
    await acct.authorizeSessionPayment(sessionId);
    await captureForSession(db, sessionId, 17600, { where: "checkout", testMode: false });
    expect(mockCaptured).toHaveLength(1);
    const { amount_to_capture: cap, application_fee_amount: fee } = mockCaptured[0].args;
    expect(cap).toBe(21120);
    expect(fee).toBe(3520);
    expect(cap - fee).toBe(17600);
    expect(mockCreated).toHaveLength(1); // the hold only — no second charge
  });

  test("a shorter visit: 6h of $22 → capture $158.40, fee $26.40 — the fee shrinks with it", async () => {
    const { sessionId } = await fundableSession();
    await acct.authorizeSessionPayment(sessionId);
    await captureForSession(db, sessionId, 13200, { where: "checkout", testMode: false });
    expect(mockCaptured[0].args).toEqual({ amount_to_capture: 15840, application_fee_amount: 2640 });
  });

  test("TODAY'S AND TOMORROW'S HOLDS ($192, placed before the fix): full day → $176 to her, $35.20 to InPlace, $211.20 from Sara", async () => {
    const { sessionId } = await fundableSession();
    await legacyHold(sessionId, 19200);
    const r = await captureForSession(db, sessionId, 17600, { where: "checkout", testMode: false });
    expect(r.captured).toBe(true);
    const { amount_to_capture: cap, application_fee_amount: fee } = mockCaptured[0].args;
    expect(cap).toBe(19200);
    expect(fee).toBe(1600);
    expect(cap - fee).toBe(17600);           // caregiver
    expect(mockCreated).toHaveLength(1);     // the balance
    const bal = mockCreated[0].args;
    expect(bal.amount).toBe(1920);
    expect(bal.transfer_data).toBeUndefined(); // all of it is InPlace's fee
    expect(fee + bal.amount).toBe(3520);       // InPlace in total
    expect(cap + bal.amount).toBe(21120);      // Sara in total
    expect(bal.customer).toBe("cus_legacy");
    expect(bal.payment_method).toBe("pm_legacy");
  });

  test("a pre-fix hold and a shorter visit: nothing extra is charged", async () => {
    const { sessionId } = await fundableSession();
    await legacyHold(sessionId, 19200);
    await captureForSession(db, sessionId, 13200, { where: "checkout", testMode: false });
    expect(mockCaptured[0].args).toEqual({ amount_to_capture: 15840, application_fee_amount: 2640 });
    expect(mockCreated).toHaveLength(0);
  });

  test("a little overtime: the hold covers her, and the balance is fee only", async () => {
    const { sessionId } = await fundableSession();
    await acct.authorizeSessionPayment(sessionId); // 21120 held
    mockCreated.length = 0;
    await captureForSession(db, sessionId, 18700, { where: "checkout", testMode: false });
    const { amount_to_capture: cap, application_fee_amount: fee } = mockCaptured[0].args;
    expect(cap).toBe(21120);
    expect(cap - fee).toBe(18700);
    const bal = mockCreated[0].args;
    expect(bal.transfer_data).toBeUndefined();
    expect(fee + bal.amount).toBe(3740);
    expect(cap + bal.amount).toBe(22440);
  });

  test("more overtime than the hold covers: her share of the balance is transferred to her", async () => {
    const { sessionId, acctId } = await fundableSession();
    await acct.authorizeSessionPayment(sessionId); // 21120 held
    mockCreated.length = 0;
    await captureForSession(db, sessionId, 22000, { where: "checkout", testMode: false });
    const { amount_to_capture: cap, application_fee_amount: fee } = mockCaptured[0].args;
    expect(cap).toBe(21120);
    expect(fee).toBe(0);
    const bal = mockCreated[0].args;
    expect(bal.amount).toBe(26400 - 21120);
    expect(bal.transfer_data).toEqual({ destination: acctId });
    const toHer = bal.amount - bal.application_fee_amount;
    expect(cap - fee + toHer).toBe(22000);
    expect(fee + bal.application_fee_amount).toBe(4400);
  });

  test("a failed balance charge does not undo the capture, and is not silent", async () => {
    const { sessionId } = await fundableSession();
    await legacyHold(sessionId, 19200);
    mockFailNextCreate = true;
    const r = await acct.captureSessionPay(sessionId, 17600);
    expect(r.success).toBe(true);
    expect(r.remainder).toMatchObject({ charged: false, cents: 1920 });
    const row = await db.prepare("SELECT payment_status FROM care_sessions WHERE id = ?").get(sessionId);
    expect(row.payment_status).toBe("paid");
  });

  test("the cancellation-fee capture keeps its contract: 100% of what was authorized", async () => {
    const { sessionId } = await fundableSession();
    await acct.authorizeSessionPayment(sessionId);
    await acct.captureSessionPayment(sessionId, 21120);
    expect(mockCaptured[0].args).toEqual({});
    expect(mockCreated).toHaveLength(1);
  });
});
