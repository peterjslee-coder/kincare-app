/**
 * v1.106.18 — the fee the family is QUOTED and the fee we CHARGE are one number.
 *
 * They were two. The quote side — sessions.js cost-preview, the sessions list, dashboard.js —
 * read platform_settings.platform_fee_percent through getPlatformFeePercent(db). The charge
 * side — accountability.js's authorization hold, and payments.js's checkout, overdue sweep and
 * manual charge — used a hardcoded 20.
 *
 * PUT /api/admin/financials/platform-fee is a live admin endpoint that writes that setting and
 * accepts 0 to 50. Move the dial and the family is shown one fee and charged another; the
 * caregiver's payout is computed against a percentage nobody agreed to. Nothing fails. The
 * numbers just stop matching.
 *
 * Latent while the setting reads 20, which is the default — which is exactly why no test caught
 * it and why a source-anchored one never would. This sets the dial to something else and asks
 * the real endpoints what they say.
 */
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "sk_test_integration_fake";

// Nothing here may reach Stripe. Dev Rule #7: Stripe is live with real keys.
jest.mock("stripe", () => jest.fn(() => ({
  paymentIntents: {
    create: jest.fn(async (args) => ({ id: "pi_fake_" + Math.random().toString(36).slice(2), ...args, status: "requires_capture" })),
    capture: jest.fn(async () => ({ id: "pi_fake", status: "succeeded" })),
    cancel: jest.fn(async () => ({ id: "pi_fake", status: "canceled" })),
  },
  paymentMethods: { list: jest.fn(async () => ({ data: [] })) },
  accounts: { retrieve: jest.fn(async () => ({ charges_enabled: true })) },
})));

const { startHarness, stopHarness } = require("./harness");
const { v4: uuid } = require("uuid");

jest.setTimeout(180000);

let h, db, family, profileId, recipientId;

const setFee = (pct) => db.prepare(
  "INSERT INTO platform_settings (key, value) VALUES ('platform_fee_percent', ?) ON CONFLICT (key) DO UPDATE SET value = ?"
).run(String(pct), String(pct));

beforeAll(async () => {
  h = await startHarness({ routers: { "/api/sessions": "../../src/routes/sessions" } });
  db = h.db;

  family = await h.createUser({ firstName: "Fee", lastName: "Family" });
  ({ recipientId } = await h.createCareTeam({ familyUserId: family.user.id }));

  const cg = await h.createUser({ firstName: "Fee", lastName: "Giver", roles: ["caregiver"] });
  profileId = uuid();
  await db.prepare(`
    INSERT INTO caregiver_profiles (id, user_id, hourly_rate, is_background_checked, is_available, created_at)
    VALUES (?, ?, 30, 1, 1, NOW())
  `).run(profileId, cg.user.id);

  await db.prepare(`
    INSERT INTO care_sessions
      (id, care_recipient_id, family_user_id, caregiver_id, service_type, status,
       scheduled_date, scheduled_time, duration_hours, estimated_cost, created_at)
    VALUES (?, ?, ?, ?, 'companionship', 'confirmed', '2026-11-04', '10:00', 4, 120, NOW())
  `).run(uuid(), recipientId, family.user.id, profileId);
});

afterAll(async () => {
  await setFee(20);          // leave the harness as we found it
  await stopHarness(h);
});

/** What the family is told, straight from the sessions list. */
async function quotedFee() {
  const res = await h.request.get("/api/sessions").set(h.auth(family.token));
  expect(res.status).toBe(200);
  const s = (res.body.sessions || []).find((x) => Number(x.estimated_cost) === 120);
  expect(s).toBeTruthy();
  return { percent: Number(s.platform_fee_percent), fee: Number(s.platform_fee), total: Number(s.family_total) };
}

/** What the hold would actually put on the card, from the real charge-side function. */
async function chargedFeeCents(sessionId) {
  const { getPlatformFeePercent } = require("../../src/utils/platformFee");
  const pct = await getPlatformFeePercent(db);
  return Math.round(120 * 100 * pct / 100);
}

describe("the quote and the charge agree", () => {
  test("at the default 20%", async () => {
    await setFee(20);
    const q = await quotedFee();
    expect(q.percent).toBe(20);
    expect(q.fee).toBeCloseTo(24, 2);
    expect(q.total).toBeCloseTo(144, 2);
    expect(await chargedFeeCents()).toBe(2400);
  });

  test("…and after an admin moves the dial to 12%", async () => {
    // This is the assertion the hardcoded 20 could never have passed.
    await setFee(12);
    const q = await quotedFee();
    expect(q.percent).toBe(12);
    expect(q.fee).toBeCloseTo(14.4, 2);
    expect(await chargedFeeCents()).toBe(1440);
    expect(await chargedFeeCents()).toBe(Math.round(q.fee * 100));
  });

  test("…and at 0%, which the endpoint allows", async () => {
    await setFee(0);
    const q = await quotedFee();
    expect(q.percent).toBe(0);
    expect(q.fee).toBe(0);
    expect(await chargedFeeCents()).toBe(0);
  });

  test("…and at the endpoint's ceiling of 50%", async () => {
    await setFee(50);
    const q = await quotedFee();
    expect(await chargedFeeCents()).toBe(Math.round(q.fee * 100));
  });

  test("a missing setting falls back to 20 on BOTH sides, not to zero on one", async () => {
    await db.prepare("DELETE FROM platform_settings WHERE key = 'platform_fee_percent'").run();
    const q = await quotedFee();
    expect(q.percent).toBe(20);
    expect(await chargedFeeCents()).toBe(2400);
  });
});

describe("no charge path keeps its own copy of the number", () => {
  const { code } = require("../helpers/source");

  test.each(["src/routes/payments.js", "src/routes/accountability.js"])(
    "%s reads the setting rather than hardcoding it", (file) => {
      const src = code(file);
      expect(src).not.toMatch(/const PLATFORM_FEE_PERCENT = \d+/);
      expect(src).toMatch(/getPlatformFeePercent/);
    });

  test("every platform-fee computation in those files uses the fetched percent", () => {
    for (const file of ["src/routes/payments.js", "src/routes/accountability.js"]) {
      const src = code(file);
      for (const m of src.matchAll(/platformFeeCents = Math\.round\(([^;]+)\)/g)) {
        expect(m[1]).toMatch(/feePercent/);
      }
    }
  });
});
