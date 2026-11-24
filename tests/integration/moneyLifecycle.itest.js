/**
 * v1.106.18 — authorize → capture → void, against a real database.
 *
 * This session has spent most of its time in these three functions and proved every fix by
 * reading source. That is how the two live bugs got here in the first place:
 *
 *   · `payment_method: undefined` with a comment saying "will use customer's default".
 *     Stripe rejects that outright. The source read fine.
 *   · an idempotency key of `<session>_<amount>` that did not change when the request did,
 *     so every corrected retry replayed the cached failure for 24 hours.
 *
 * Neither is visible in a grep. Both are obvious the moment you call the function and look at
 * what it hands Stripe. So: Stripe is mocked at the module level — Dev Rule #7, nothing here
 * touches a live key — and the assertions are about the arguments and the rows.
 */
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "sk_test_integration_fake";

// jest hoists jest.mock() above these, so the factory may only close over names it can
// prove are mock state. The `mock` prefix is how it is told.
const mockCreated = [];
const mockCaptured = [];
const mockCancelled = [];
let mockSavedMethods = [];

jest.mock("stripe", () => jest.fn(() => ({
  paymentIntents: {
    create: jest.fn(async (args, opts) => {
      mockCreated.push({ args, opts });
      return { id: `pi_${mockCreated.length}`, status: "requires_capture", amount: args.amount };
    }),
    capture: jest.fn(async (id, args) => { mockCaptured.push({ id, args }); return { id, status: "succeeded" }; }),
    cancel: jest.fn(async (id) => { mockCancelled.push(id); return { id, status: "canceled" }; }),
  },
  paymentMethods: {
    list: jest.fn(async ({ type }) => ({ data: mockSavedMethods.filter((m) => m.type === type) })),
  },
})));

const { startHarness, stopHarness } = require("./harness");
const { v4: uuid } = require("uuid");

jest.setTimeout(180000);

let h, db, acct;

beforeAll(async () => {
  h = await startHarness({ routers: {} });
  db = h.db;
  acct = require("../../src/routes/accountability");
});
afterAll(async () => { await stopHarness(h); });

beforeEach(() => { mockCreated.length = 0; mockCaptured.length = 0; mockCancelled.length = 0; mockSavedMethods = []; });

/** A confirmed, fundable session: payer with a Stripe customer, caregiver onboarded + verified. */
async function fundableSession({ isDemo = false, rate = 40, hours = 3 } = {}) {
  const family = await h.createUser({ firstName: "Pay", lastName: "Er" });
  await db.prepare("UPDATE users SET stripe_customer_id = ?, is_demo = ? WHERE id = ?")
    .run(`cus_${uuid().slice(0, 8)}`, isDemo ? 1 : 0, family.user.id);

  const { recipientId } = await h.createCareTeam({ familyUserId: family.user.id });

  const cg = await h.createUser({ firstName: "Care", lastName: "Giver", roles: ["caregiver"] });
  const profileId = uuid();
  await db.prepare(`
    INSERT INTO caregiver_profiles
      (id, user_id, hourly_rate, is_background_checked, is_available,
       stripe_account_id, stripe_onboard_complete, identity_verified, created_at)
    VALUES (?, ?, ?, 1, 1, ?, 1, 1, NOW())
  `).run(profileId, cg.user.id, rate, `acct_${uuid().slice(0, 8)}`);

  // Identity is NOT the caregiver_profiles.identity_verified column — v1.105.124 moved the
  // money gate onto the resolver in utils/identity, which reads the newest non-selfie identity
  // document. Setting the column and not the document is exactly how Julia's shift went
  // unfunded: verified through the selfie + document path, which never touches that column.
  await db.prepare(`
    INSERT INTO verified_documents
      (id, owner_type, owner_id, uploaded_by, category, document_type, file_data, status, created_at)
    VALUES (?, 'caregiver', ?, ?, 'identity', 'drivers_license', 'data:image/png;base64,AAAA', 'approved', NOW())
  `).run(uuid(), profileId, cg.user.id);

  const sessionId = uuid();
  await db.prepare(`
    INSERT INTO care_sessions
      (id, care_recipient_id, family_user_id, caregiver_id, service_type, status,
       scheduled_date, scheduled_time, duration_hours, agreed_rate, estimated_cost, created_at)
    VALUES (?, ?, ?, ?, 'companionship', 'confirmed', '2026-11-10', '10:00', ?, ?, ?, NOW())
  `).run(sessionId, recipientId, family.user.id, profileId, hours, rate, rate * hours);

  return { sessionId, family, cg, profileId };
}

const readSession = (id) => db.prepare(
  "SELECT stripe_payment_intent_id, payment_status, authorized_amount, payment_captured_at, payment_voided_at FROM care_sessions WHERE id = ?"
).get(id);

describe("authorizing a shift", () => {
  test("with a saved card it holds, and records what it held", async () => {
    mockSavedMethods = [{ id: "pm_card_1", type: "card", card: { last4: "4242", brand: "visa" } }];
    const { sessionId } = await fundableSession();

    const r = await acct.authorizeSessionPayment(sessionId);
    expect(r.error).toBeUndefined();
    expect(r.success).toBe(true);

    const row = await readSession(sessionId);
    expect(row.stripe_payment_intent_id).toBe("pi_1");
    expect(row.payment_status).toBe("authorized");
    expect(Number(row.authorized_amount)).toBe(r.amount);
  });

  test("it is a HOLD, not a charge — capture_method is manual", async () => {
    // Pete asked this directly: if the caregiver no-shows tomorrow, has the money moved?
    mockSavedMethods = [{ id: "pm_card_1", type: "card", card: { last4: "4242" } }];
    const { sessionId } = await fundableSession();
    await acct.authorizeSessionPayment(sessionId);
    expect(mockCreated[0].args.capture_method).toBe("manual");
  });

  test("it names the payment method — the bug that spammed Pete's phone", async () => {
    // v1.106.11: this passed `payment_method: undefined` with a comment claiming Stripe would
    // use the customer's default. It does not; it rejects the call.
    mockSavedMethods = [{ id: "pm_card_1", type: "card", card: { last4: "4242" } }];
    const { sessionId } = await fundableSession();
    await acct.authorizeSessionPayment(sessionId);
    expect(mockCreated[0].args.payment_method).toBe("pm_card_1");
    expect(mockCreated[0].args.payment_method_types).toEqual(["card"]);
    expect(mockCreated[0].args.confirm).toBe(true);
    expect(mockCreated[0].args.off_session).toBe(true);
  });

  test("the idempotency key changes when the payment method does", async () => {
    // v1.106.12: the key was `<session>_<amount>`, so the broken no-payment_method attempts
    // burned it and every corrected retry replayed the cached failure for 24 hours.
    mockSavedMethods = [{ id: "pm_card_1", type: "card", card: { last4: "4242" } }];
    const a = await fundableSession();
    await acct.authorizeSessionPayment(a.sessionId);
    const keyA = mockCreated[0].opts.idempotencyKey;
    expect(keyA).toContain("pm_card_1");

    mockCreated.length = 0;
    mockSavedMethods = [{ id: "pm_card_2", type: "card", card: { last4: "1111" } }];
    const b = await fundableSession();
    await acct.authorizeSessionPayment(b.sessionId);
    expect(mockCreated[0].opts.idempotencyKey).not.toBe(keyA);
    expect(mockCreated[0].opts.idempotencyKey).toContain("pm_card_2");
  });

  test("ACH is accepted, not just cards", async () => {
    mockSavedMethods = [{ id: "pm_ach_1", type: "us_bank_account", us_bank_account: { last4: "6789", bank_name: "Chase" } }];
    const { sessionId } = await fundableSession();
    const r = await acct.authorizeSessionPayment(sessionId);
    expect(r.error).toBeUndefined();
    expect(mockCreated[0].args.payment_method_types).toEqual(["us_bank_account"]);
  });

  test("with no saved method it says so, and names who must fix it", async () => {
    mockSavedMethods = [];
    const { sessionId, family } = await fundableSession();
    const r = await acct.authorizeSessionPayment(sessionId);
    // The poller routes an "Add a payment method" push at this person.
    expect(r.error).toBe("no_payment_method");
    expect(r.payerUserId).toBe(family.user.id);
    expect(mockCreated).toHaveLength(0);
    expect((await readSession(sessionId)).payment_status).toBeFalsy();
  });

  test("a demo session never reaches Stripe — Dev Rule #7", async () => {
    mockSavedMethods = [{ id: "pm_card_1", type: "card", card: { last4: "4242" } }];
    const { sessionId } = await fundableSession({ isDemo: true });
    const r = await acct.authorizeSessionPayment(sessionId);
    expect(r.error).toBe("demo_session_blocked");
    expect(mockCreated).toHaveLength(0);
  });

  test("authorizing twice does not place a second hold", async () => {
    mockSavedMethods = [{ id: "pm_card_1", type: "card", card: { last4: "4242" } }];
    const { sessionId } = await fundableSession();
    await acct.authorizeSessionPayment(sessionId);
    const again = await acct.authorizeSessionPayment(sessionId);
    expect(again.error).toBe("Already authorized");
    expect(mockCreated).toHaveLength(1);
  });
});

describe("capturing and voiding", () => {
  async function held() {
    mockSavedMethods = [{ id: "pm_card_1", type: "card", card: { last4: "4242" } }];
    const s = await fundableSession();
    await acct.authorizeSessionPayment(s.sessionId);
    return s;
  }

  test("capture moves the money and marks the session paid", async () => {
    const { sessionId } = await held();
    const r = await acct.captureSessionPayment(sessionId);
    expect(r.error).toBeUndefined();
    expect(mockCaptured).toHaveLength(1);
    const row = await readSession(sessionId);
    expect(row.payment_status).toBe("paid");
    expect(row.payment_captured_at).toBeTruthy();
  });

  test("capture takes the amount actually worked, which can be less than the hold", async () => {
    const { sessionId } = await held();
    const before = await readSession(sessionId);
    await acct.captureSessionPayment(sessionId, 5000);
    expect(mockCaptured[0].args.amount_to_capture).toBe(5000);
    expect(5000).toBeLessThan(Number(before.authorized_amount));
  });

  test("void releases the hold and records it", async () => {
    // What a caregiver no-show does at +30 min.
    const { sessionId } = await held();
    const r = await acct.voidSessionPayment(sessionId);
    expect(r.success).toBe(true);
    expect(mockCancelled).toEqual(["pi_1"]);
    const row = await readSession(sessionId);
    expect(row.payment_status).toBe("voided");
    expect(row.payment_voided_at).toBeTruthy();
  });

  test("voiding a session that was never held reports it rather than pretending", async () => {
    // v1.105.48: the family is pushed "no payment will be charged" off the back of this.
    // A silent failure makes that promise false.
    const { sessionId } = await fundableSession();
    const r = await acct.voidSessionPayment(sessionId);
    expect(r.error).toMatch(/No payment authorization found/i);
    expect(mockCancelled).toHaveLength(0);
  });

  test("a demo session is blocked from capture and void too", async () => {
    mockSavedMethods = [{ id: "pm_card_1", type: "card", card: { last4: "4242" } }];
    const { sessionId } = await fundableSession({ isDemo: true });
    expect((await acct.captureSessionPayment(sessionId)).error).toBe("demo_session_blocked");
    expect((await acct.voidSessionPayment(sessionId)).error).toBe("demo_session_blocked");
    expect(mockCaptured).toHaveLength(0);
    expect(mockCancelled).toHaveLength(0);
  });
});
