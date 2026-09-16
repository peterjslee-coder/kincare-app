/**
 * v1.107.1 — the ways a single visit could be charged twice, or not at all.
 *
 * Each of these was reproduced by the Sep 15 verification review against this harness
 * (findings F2b, F3, F4, F5, M-h and the release/check-out race). Stripe is mocked and every
 * assertion is on what the Stripe client was asked to do. Dev Rule #7: live keys in prod.
 */
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "sk_test_integration_fake";

const mockCreated = [];
const mockCaptured = [];
const mockPI = {};              // id -> status the retrieve() call reports
let mockCaptureThrows = null;   // Error to throw from capture()
let mockSavedMethods = [];

jest.mock("stripe", () => jest.fn(() => ({
  paymentIntents: {
    create: jest.fn(async (args, opts) => {
      mockCreated.push({ args, opts });
      const id = `pi_new_${mockCreated.length}`;
      return { id, status: args.capture_method === "manual" ? "requires_capture" : "succeeded", amount: args.amount };
    }),
    capture: jest.fn(async (id, args) => {
      if (mockCaptureThrows) throw mockCaptureThrows;
      mockCaptured.push({ id, args });
      await new Promise((r) => setTimeout(r, 20)); // widen the race window
      return { id, status: "succeeded", amount_received: args && args.amount_to_capture };
    }),
    retrieve: jest.fn(async (id) => ({ id, status: mockPI[id] || "requires_capture", customer: "cus_hold", payment_method: "pm_hold" })),
    cancel: jest.fn(async (id) => ({ id, status: "canceled" })),
  },
  paymentMethods: {
    list: jest.fn(async ({ type }) => ({ data: mockSavedMethods.filter((m) => m.type === type) })),
  },
  checkout: { sessions: { create: jest.fn(async () => ({ id: "cs_1", url: "https://example.invalid" })) } },
})));

const jwt = require("jsonwebtoken");
const { startHarness, stopHarness } = require("./harness");
const { v4: uuid } = require("uuid");

// Today in the care location's zone. These visits used to carry a hard-coded date, and every
// suite that reads "today's" sessions went red at midnight on the day after it was written.
const TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());

jest.setTimeout(180000);

let h, db, payments, family, admin, cg, cgProfileId, recipientId, teamId;

beforeAll(async () => {
  h = await startHarness({ routers: {
    "/api/sessions": "../../src/routes/sessions",
    "/api/payments": "../../src/routes/payments",
  } });
  db = h.db;
  payments = require("../../src/routes/payments");
  await db.prepare(
    "INSERT INTO platform_settings (key, value) VALUES ('payments_enabled', 'true') ON CONFLICT (key) DO UPDATE SET value = 'true'"
  ).run();

  family = await h.createUser({ roles: ["family"], firstName: "Sara" });
  await db.prepare("UPDATE users SET stripe_customer_id = 'cus_family' WHERE id = ?").run(family.user.id);
  ({ recipientId, teamId } = await h.createCareTeam({ familyUserId: family.user.id }));
  await db.prepare("UPDATE care_teams SET billing_user_id = ? WHERE id = ?").run(family.user.id, teamId);

  admin = await h.createUser({ roles: ["family"], firstName: "Pete", isAdmin: true });

  cg = await h.createUser({ roles: ["caregiver"], firstName: "Tina" });
  cgProfileId = uuid();
  await db.prepare(`
    INSERT INTO caregiver_profiles (id, user_id, hourly_rate, stripe_account_id, stripe_onboard_complete, created_at)
    VALUES (?, ?, 22, 'acct_tina', 1, NOW())
  `).run(cgProfileId, cg.user.id);
});
afterAll(async () => { await stopHarness(h); });

beforeEach(() => {
  mockCreated.length = 0; mockCaptured.length = 0; mockCaptureThrows = null;
  for (const k of Object.keys(mockPI)) delete mockPI[k];
  mockSavedMethods = [{ id: "pm_card_1", type: "card", card: { last4: "4242", brand: "visa" } }];
});

/** Tina's visit: $22 × 8h, held $192 the pre-v1.107.0 way unless told otherwise. */
async function visit({ status = "in_progress", held = 19200, paymentStatus = "authorized", pi = true, dueAgo = false } = {}) {
  const id = uuid();
  const piId = pi ? `pi_hold_${id.slice(0, 8)}` : null;
  await db.prepare(`
    INSERT INTO care_sessions (id, care_recipient_id, family_user_id, caregiver_id, service_type, status,
      scheduled_date, scheduled_time, duration_hours, estimated_cost, flex_timing,
      stripe_payment_intent_id, authorized_amount, payment_status, payment_due_at, created_at)
    VALUES (?, ?, ?, ?, 'companionship', ?, '${TODAY}', '09:00', 8, 176, 'strict', ?, ?, ?,
      CASE WHEN ? THEN NOW() - INTERVAL '2 hours' ELSE NULL END, NOW())
  `).run(id, recipientId, family.user.id, cgProfileId, status, piId, pi ? held : null, paymentStatus, dueAgo);
  if (status === "in_progress") {
    await db.prepare(`
      INSERT INTO visit_logs (id, session_id, caregiver_id, check_in_time, created_at)
      VALUES (?, ?, ?, NOW() - INTERVAL '480 minutes', NOW())
    `).run(uuid(), id, cgProfileId);
  }
  return { id, piId };
}

const row = (id) => db.prepare("SELECT status, payment_status FROM care_sessions WHERE id = ?").get(id);
const release = (id, token) => h.request.post(`/api/sessions/${id}/release`).set(h.auth(token)).send({});
const checkout = (id, token) => h.request.post(`/api/sessions/${id}/check-out`).set(h.auth(token)).send({ summary: "" });
const impersonationToken = (user) => jwt.sign(
  { id: user.id, email: user.email, roles: ["family"], role: "family", impersonatedBy: admin.user.id },
  process.env.JWT_SECRET, { expiresIn: "2h" }
);

describe("one visit, one settlement", () => {
  test("two releases at once: exactly one capture", async () => {
    const { id } = await visit();
    const [a, b] = await Promise.all([release(id, family.token), release(id, family.token)]);
    expect([a.status, b.status].sort()).toEqual([200, 400]);
    expect(mockCaptured).toHaveLength(1);
  });

  test("release, then the caregiver checks out: the check-out is refused and nothing is captured again", async () => {
    const { id } = await visit();
    expect((await release(id, family.token)).status).toBe(200);
    const res = await checkout(id, cg.token);
    expect([400, 409]).toContain(res.status);
    expect(mockCaptured).toHaveLength(1);
  });

  test("two check-outs at once: exactly one capture", async () => {
    const { id } = await visit();
    const [a, b] = await Promise.all([checkout(id, cg.token), checkout(id, cg.token)]);
    expect([a.status, b.status]).toContain(200);
    expect(mockCaptured).toHaveLength(1);
  });
});

describe("Test Mode never touches a real visit's money", () => {
  test("releasing while impersonating is refused, and nothing is waived", async () => {
    const { id } = await visit();
    const res = await release(id, impersonationToken(family.user));
    expect(res.status).toBe(403);
    expect(mockCaptured).toHaveLength(0);
    expect((await row(id)).payment_status).toBe("authorized");
    expect((await row(id)).status).toBe("in_progress");
  });

  test("checking out while impersonating is refused", async () => {
    const { id } = await visit();
    const tok = jwt.sign({ id: cg.user.id, email: cg.user.email, roles: ["caregiver"], role: "caregiver", impersonatedBy: admin.user.id },
      process.env.JWT_SECRET, { expiresIn: "2h" });
    const res = await checkout(id, tok);
    expect(res.status).toBe(403);
    expect(mockCaptured).toHaveLength(0);
    expect((await row(id)).status).toBe("in_progress");
  });
});

describe("the auto-pay sweep never charges a visit that has a hold", () => {
  test("hold still open → it is CAPTURED, not charged again", async () => {
    const { id, piId } = await visit({ status: "completed", paymentStatus: "pending", dueAgo: true });
    mockPI[piId] = "requires_capture";
    await payments.processOverduePayments(null);
    expect(mockCaptured.map((c) => c.id)).toEqual([piId]);
    expect(mockCreated.filter((c) => c.args.amount === 21120)).toHaveLength(0); // no fresh full charge
    expect((await row(id)).payment_status).toBe("paid");
  });

  test("hold already captured (a timeout lied) → marked paid, no charge at all", async () => {
    const { id, piId } = await visit({ status: "completed", paymentStatus: "pending", dueAgo: true });
    mockPI[piId] = "succeeded";
    await payments.processOverduePayments(null);
    expect(mockCaptured).toHaveLength(0);
    expect(mockCreated).toHaveLength(0);
    expect((await row(id)).payment_status).toBe("paid");
  });

  test("hold cancelled → a normal fee-on-top charge", async () => {
    const { piId } = await visit({ status: "completed", paymentStatus: "pending", dueAgo: true });
    mockPI[piId] = "canceled";
    await payments.processOverduePayments(null);
    const charges = mockCreated.filter((c) => c.args.metadata && c.args.metadata.inplace_auto_charged);
    expect(charges).toHaveLength(1);
    expect(charges[0].args.amount).toBe(21120);
    expect(charges[0].args.application_fee_amount).toBe(3520);
  });

  test("a capture that errors but actually went through is not handed to auto-pay", async () => {
    const { id, piId } = await visit({ status: "in_progress" });
    mockCaptureThrows = new Error("socket hang up");
    mockPI[piId] = "succeeded";
    const res = await checkout(id, cg.token);
    expect(res.status).toBe(200);
    expect((await row(id)).payment_status).toBe("paid");
  });
});

describe("a charge that went through is never reported as failed", () => {
  test("ledger write fails after Stripe charged → 'paid', no 'Payment failed' push", async () => {
    const { id } = await visit({ status: "completed", paymentStatus: null, pi: false, dueAgo: true });
    await db.exec(`
      CREATE OR REPLACE FUNCTION zz_fail_payments() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'simulated ledger failure'; END $$ LANGUAGE plpgsql;
      DROP TRIGGER IF EXISTS zz_fail_payments ON payments;
      CREATE TRIGGER zz_fail_payments BEFORE INSERT ON payments FOR EACH ROW EXECUTE FUNCTION zz_fail_payments();
    `);
    const pushes = [];
    try {
      await payments.processOverduePayments(async (uid, payload) => { pushes.push(payload.title); });
    } finally {
      await db.exec("DROP TRIGGER IF EXISTS zz_fail_payments ON payments;");
    }
    const mine = mockCreated.filter((c) => c.args.metadata && c.args.metadata.inplace_session_id === id);
    expect(mine).toHaveLength(1);
    expect((await row(id)).payment_status).toBe("paid");
    expect(pushes).not.toContain("Payment failed");
  });
});

describe("two care-team rows do not mean two charges", () => {
  test("a second team for the same recipient with its own billing contact → one charge", async () => {
    const other = await h.createUser({ roles: ["family"], firstName: "Daniel" });
    await db.prepare("UPDATE users SET stripe_customer_id = 'cus_daniel' WHERE id = ?").run(other.user.id);
    const team2 = uuid();
    await db.prepare(
      "INSERT INTO care_teams (id, name, care_recipient_id, created_by, billing_user_id) VALUES (?, 'dup', ?, ?, ?)"
    ).run(team2, recipientId, other.user.id, other.user.id);
    try {
      const { id } = await visit({ status: "completed", paymentStatus: null, pi: false, dueAgo: true });
      await payments.processOverduePayments(null);
      const mine = mockCreated.filter((c) => c.args.metadata && c.args.metadata.inplace_session_id === id);
      expect(mine).toHaveLength(1);
    } finally {
      await db.prepare("DELETE FROM care_teams WHERE id = ?").run(team2);
    }
  });
});

describe("the family cannot pay a held visit a second time", () => {
  test("paid through its hold → checkout refuses", async () => {
    const { id } = await visit({ status: "completed", paymentStatus: "paid" });
    const res = await h.request.post("/api/payments/checkout").set(h.auth(family.token)).send({ sessionId: id });
    expect(res.status).toBe(400);
  });

  test("hold still to be captured → checkout refuses", async () => {
    const { id } = await visit({ status: "completed", paymentStatus: "authorized" });
    const res = await h.request.post("/api/payments/checkout").set(h.auth(family.token)).send({ sessionId: id });
    expect(res.status).toBe(400);
  });
});

describe("demo visits", () => {
  test("a demo capture refusal does not queue the visit for auto-pay", async () => {
    const demoFam = await h.createUser({ roles: ["family"], firstName: "Demo" });
    await db.prepare("UPDATE users SET is_demo = 1 WHERE id = ?").run(demoFam.user.id);
    const id = uuid();
    await db.prepare(`
      INSERT INTO care_sessions (id, care_recipient_id, family_user_id, caregiver_id, service_type, status,
        scheduled_date, scheduled_time, duration_hours, estimated_cost, stripe_payment_intent_id,
        authorized_amount, payment_status, created_at)
      VALUES (?, ?, ?, ?, 'companionship', 'completed', '${TODAY}', '09:00', 8, 176, 'pi_demo', 19200, 'authorized', NOW())
    `).run(id, recipientId, demoFam.user.id, cgProfileId);
    const { captureForSession } = require("../../src/utils/sessionCapture");
    await captureForSession(db, id, 17600, { where: "checkout", testMode: false });
    expect((await row(id)).payment_status).toBe("authorized");
    expect(mockCaptured).toHaveLength(0);
  });
});
