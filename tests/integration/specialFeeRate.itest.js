/**
 * v1.111.0 — a family's special service fee.
 *
 * Pete, 10/12: friends who bring their own caregivers pay a reduced fee. "It's 20% as a
 * default unless I go in and change their rate to lower. Set the floor at 5%." And the
 * Financials report has to price each visit at ITS percent — it used `estimated_cost * 0.2`
 * for the platform and `* 0.8` for the caregiver, which was wrong even before special rates
 * (the fee is added on top; the caregiver keeps all of estimated_cost).
 *
 * Every money assertion is on what the Stripe client was actually handed.
 */
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "sk_test_integration_fake";

const mockCreated = [];
const mockCaptured = [];
let mockHeld = {};

jest.mock("stripe", () => jest.fn(() => ({
  paymentIntents: {
    create: jest.fn(async (args, opts) => {
      mockCreated.push({ args, opts });
      const id = `pi_sf_${mockCreated.length}`;
      mockHeld[id] = { id, customer: args.customer, payment_method: args.payment_method, amount: args.amount };
      return { id, status: args.capture_method === "manual" ? "requires_capture" : "succeeded", amount: args.amount };
    }),
    capture: jest.fn(async (id, args, opts) => { mockCaptured.push({ id, args, opts }); return { id, status: "succeeded", amount_received: args.amount_to_capture }; }),
    retrieve: jest.fn(async (id) => mockHeld[id] || { id, customer: "cus_x", payment_method: "pm_card_1" }),
    cancel: jest.fn(async (id) => ({ id, status: "canceled" })),
  },
  paymentMethods: {
    list: jest.fn(async ({ type }) => ({ data: type === "card" ? [{ id: "pm_card_1", type: "card", card: { last4: "4242", brand: "visa" } }] : [] })),
  },
})));

const { startHarness, stopHarness } = require("./harness");
const { v4: uuid } = require("uuid");

jest.setTimeout(180000);

let h, db, acct, admin;

async function trustThisNetwork(as) {
  const probe = await h.request.get("/api/admin/overview").set(h.auth(as.token));
  const ip = (probe.body && probe.body.ip) || "::ffff:127.0.0.1";
  const { registerTrustedIp } = require("../../src/utils/trustedIps");
  await registerTrustedIp(as.user.id, ip, { verifiedVia: "itest" });
}

const setSpecialFee = (userId, body) =>
  h.request.put(`/api/admin/users/${userId}/special-fee`).set(h.auth(admin.token)).send(body);

/** A family with a card, a loved one it owns, and a fundable caregiver. */
async function familyWithCaregiver(name) {
  const family = await h.createUser({ firstName: name, lastName: "Fam" });
  await db.prepare("UPDATE users SET stripe_customer_id = ? WHERE id = ?").run(`cus_${uuid().slice(0, 8)}`, family.user.id);
  const { recipientId } = await h.createCareTeam({ familyUserId: family.user.id });
  const cg = await h.createUser({ firstName: "Care", lastName: name, roles: ["caregiver"] });
  const profileId = uuid();
  await db.prepare(`
    INSERT INTO caregiver_profiles
      (id, user_id, hourly_rate, rate_daytime, is_background_checked, is_available,
       stripe_account_id, stripe_onboard_complete, identity_verified, created_at)
    VALUES (?, ?, 22, 22, 1, 1, ?, 1, 1, NOW())
  `).run(profileId, cg.user.id, `acct_${uuid().slice(0, 8)}`);
  await db.prepare(`
    INSERT INTO verified_documents
      (id, owner_type, owner_id, uploaded_by, category, document_type, file_data, status, created_at)
    VALUES (?, 'caregiver', ?, ?, 'identity', 'drivers_license', 'data:image/png;base64,AAAA', 'approved', NOW())
  `).run(uuid(), profileId, cg.user.id);
  return { family, recipientId, profileId };
}

async function visit({ recipientId, bookedBy, profileId, status = "confirmed", cost = 176, completed = false }) {
  const id = uuid();
  await db.prepare(`
    INSERT INTO care_sessions
      (id, care_recipient_id, family_user_id, caregiver_id, service_type, status,
       scheduled_date, scheduled_time, duration_hours, proposed_rate, estimated_cost, completed_at, created_at)
    VALUES (?, ?, ?, ?, 'companionship', ?, '2026-11-10', '10:00', 8, 22, ?, ${completed ? "NOW()" : "NULL"}, NOW())
  `).run(id, recipientId, bookedBy, profileId, status, cost);
  return id;
}

beforeAll(async () => {
  h = await startHarness({
    routers: {
      "/api/admin/financials": "../../src/routes/financials",
      "/api/admin": "../../src/routes/admin",
      "/api/sessions": "../../src/routes/sessions",
    },
  });
  db = h.db;
  acct = require("../../src/routes/accountability");
  admin = await h.createUser({ firstName: "Ad", lastName: "Min", isAdmin: true });
  await db.prepare("UPDATE users SET is_admin = 1 WHERE id = ?").run(admin.user.id);
  await trustThisNetwork(admin);
});
afterAll(async () => { await stopHarness(h); });
beforeEach(() => { mockCreated.length = 0; mockCaptured.length = 0; mockHeld = {}; });

describe("setting a special rate", () => {
  test("the floor is 5%, and a special rate must be below the default", async () => {
    const { family } = await familyWithCaregiver("Floor");
    expect((await setSpecialFee(family.user.id, { percent: 4 })).status).toBe(400);
    expect((await setSpecialFee(family.user.id, { percent: 20 })).status).toBe(400);
    expect((await setSpecialFee(family.user.id, { percent: "abc" })).status).toBe(400);
    const ok = await setSpecialFee(family.user.id, { percent: 7, note: "friend — own caregiver" });
    expect(ok.status).toBe(200);
    expect(ok.body.special_fee_percent).toBe(7);
    const row = await db.prepare("SELECT special_fee_percent, special_fee_set_by, special_fee_note FROM users WHERE id = ?").get(family.user.id);
    expect(Number(row.special_fee_percent)).toBe(7);
    expect(row.special_fee_set_by).toBe(admin.user.id);
    expect(row.special_fee_note).toBe("friend — own caregiver");
    const audit = await db.prepare("SELECT action FROM admin_audit_log WHERE target_id = ? ORDER BY created_at DESC LIMIT 1").get(family.user.id);
    expect(audit.action).toBe("special_fee_set");
  });

  test("the database refuses a rate below the floor even without the route", async () => {
    const { family } = await familyWithCaregiver("Check");
    await expect(db.prepare("UPDATE users SET special_fee_percent = 4 WHERE id = ?").run(family.user.id)).rejects.toThrow();
  });

  test("clearing goes back to the default", async () => {
    const { family } = await familyWithCaregiver("Clear");
    await setSpecialFee(family.user.id, { percent: 7 });
    const res = await setSpecialFee(family.user.id, { percent: null });
    expect(res.status).toBe(200);
    expect(res.body.effective_fee_percent).toBe(20);
    const row = await db.prepare("SELECT special_fee_percent FROM users WHERE id = ?").get(family.user.id);
    expect(row.special_fee_percent).toBeNull();
  });

  test("admin People shows the rate on the user", async () => {
    const { family } = await familyWithCaregiver("Shown");
    await setSpecialFee(family.user.id, { percent: 7 });
    const res = await h.request.get(`/api/admin/users/${family.user.id}/detail`).set(h.auth(admin.token));
    expect(res.status).toBe(200);
    expect(Number(res.body.user.special_fee_percent)).toBe(7);
  });
});

describe("what the card is charged", () => {
  test("a friend's visit is held at 7% — $176 of care, $12.32 fee, $188.32 held — and the percent locks", async () => {
    const f = await familyWithCaregiver("Friend");
    await setSpecialFee(f.family.user.id, { percent: 7 });
    const sid = await visit({ recipientId: f.recipientId, bookedBy: f.family.user.id, profileId: f.profileId });
    const r = await acct.authorizeSessionPayment(sid);
    expect(r.error).toBeUndefined();
    expect(mockCreated[0].args.amount).toBe(18832);
    expect(mockCreated[0].args.application_fee_amount).toBe(1232);
    const s = await db.prepare("SELECT platform_fee_percent FROM care_sessions WHERE id = ?").get(sid);
    expect(Number(s.platform_fee_percent)).toBe(7);
  });

  test("changing the rate after the hold does not re-price the capture", async () => {
    const f = await familyWithCaregiver("Locked");
    await setSpecialFee(f.family.user.id, { percent: 7 });
    const sid = await visit({ recipientId: f.recipientId, bookedBy: f.family.user.id, profileId: f.profileId });
    await acct.authorizeSessionPayment(sid);
    await setSpecialFee(f.family.user.id, { percent: 10 });
    const r = await acct.captureSessionPay(sid, 17600);
    expect(r.error).toBeUndefined();
    expect(mockCaptured[0].args.amount_to_capture).toBe(18832);
    expect(mockCaptured[0].args.application_fee_amount).toBe(1232);
  });

  test("a sibling booking for the friend's mother gets the friend's rate", async () => {
    const f = await familyWithCaregiver("Owner");
    await setSpecialFee(f.family.user.id, { percent: 7 });
    const sibling = await h.createUser({ firstName: "Sib", lastName: "Ling" });
    const sid = await visit({ recipientId: f.recipientId, bookedBy: sibling.user.id, profileId: f.profileId });
    const { getPlatformFeePercent } = require("../../src/utils/platformFee");
    expect(await getPlatformFeePercent(db, { sessionId: sid })).toBe(7);
  });

  test("everyone else is still held at the default 20%", async () => {
    const f = await familyWithCaregiver("Normal");
    const sid = await visit({ recipientId: f.recipientId, bookedBy: f.family.user.id, profileId: f.profileId });
    await acct.authorizeSessionPayment(sid);
    expect(mockCreated[0].args.amount).toBe(21120);
    expect(mockCreated[0].args.application_fee_amount).toBe(3520);
  });

  test("the friend's quote shows 7% before booking", async () => {
    const f = await familyWithCaregiver("Quote");
    await setSpecialFee(f.family.user.id, { percent: 7 });
    const res = await h.request
      .get(`/api/sessions/cost-preview?scheduledDate=2026-11-10&scheduledTime=10:00&durationHours=8&proposedRate=22&careRecipientId=${f.recipientId}`)
      .set(h.auth(f.family.token));
    expect(res.status).toBe(200);
    expect(res.body.platformFeePercent).toBe(7);
    expect(res.body.platformFee).toBeCloseTo(12.32, 2);
  });
});

describe("nothing else moves — Pete: the tech adds must not mess up the rest of the cost and pay", () => {
  test("the friend's caregiver is paid exactly the same $176 — the discount comes out of InPlace's side only", async () => {
    const f = await familyWithCaregiver("CgPay");
    await setSpecialFee(f.family.user.id, { percent: 7 });
    const sid = await visit({ recipientId: f.recipientId, bookedBy: f.family.user.id, profileId: f.profileId });
    await acct.authorizeSessionPayment(sid);
    const a = mockCreated[0].args;
    expect(a.amount - a.application_fee_amount).toBe(17600);
  });

  test("an untagged family sees and pays 20% on every surface, all agreeing", async () => {
    // Another family being tagged must not leak into this one.
    const friend = await familyWithCaregiver("Leak");
    await setSpecialFee(friend.family.user.id, { percent: 7 });
    const f = await familyWithCaregiver("Plain");
    const sid = await visit({ recipientId: f.recipientId, bookedBy: f.family.user.id, profileId: f.profileId });

    const prev = await h.request
      .get(`/api/sessions/cost-preview?scheduledDate=2026-11-10&scheduledTime=10:00&durationHours=8&proposedRate=22&careRecipientId=${f.recipientId}`)
      .set(h.auth(f.family.token));
    expect(prev.body.platformFeePercent).toBe(20);
    expect(prev.body.platformFee).toBeCloseTo(35.2, 2);
    expect(prev.body.familyTotal).toBeCloseTo(211.2, 2);

    const list = await h.request.get("/api/sessions").set(h.auth(f.family.token));
    const row = (list.body.sessions || []).find((x) => x.id === sid);
    expect(row.platform_fee_percent).toBe(20);
    expect(Number(row.family_total)).toBeCloseTo(211.2, 2);
    expect(Number(row.caregiver_payout)).toBe(176);

    const detail = await h.request.get(`/api/sessions/${sid}`).set(h.auth(f.family.token));
    expect(detail.status).toBe(200);
    expect(detail.body.costBreakdown.platformFeePercent).toBe(20);

    await acct.authorizeSessionPayment(sid);
    expect(mockCreated[0].args.amount).toBe(21120);
    expect(mockCreated[0].args.application_fee_amount).toBe(3520);
    await acct.captureSessionPay(sid, 17600);
    expect(mockCaptured[0].args.amount_to_capture).toBe(21120);
    expect(mockCaptured[0].args.application_fee_amount).toBe(3520);
  });

  test("the public pricing endpoint and the default read are untouched by special rates", async () => {
    const f = await familyWithCaregiver("Pub");
    await setSpecialFee(f.family.user.id, { percent: 7 });
    const { getPlatformFeePercent } = require("../../src/utils/platformFee");
    expect(await getPlatformFeePercent(db)).toBe(20);
  });
});

describe("the Financials report prices each visit at its own percent", () => {
  test("summary, breakdown and special-rates", async () => {
    // A clean slate for the totals: only this test's completed visits count.
    await db.prepare("UPDATE care_sessions SET status = 'cancelled' WHERE status = 'completed'").run();
    const friend = await familyWithCaregiver("Rep");
    await setSpecialFee(friend.family.user.id, { percent: 7 });
    const normal = await familyWithCaregiver("Std");
    await visit({ recipientId: friend.recipientId, bookedBy: friend.family.user.id, profileId: friend.profileId, status: "completed", completed: true });
    await visit({ recipientId: normal.recipientId, bookedBy: normal.family.user.id, profileId: normal.profileId, status: "completed", completed: true });
    // History: a visit paid at 20% BEFORE the friend was tagged keeps 20%.
    const old = await visit({ recipientId: friend.recipientId, bookedBy: friend.family.user.id, profileId: friend.profileId, status: "completed", completed: true });
    await db.prepare("UPDATE care_sessions SET platform_fee_percent = 20 WHERE id = ?").run(old);

    const sum = await h.request.get("/api/admin/financials/summary").set(h.auth(admin.token));
    expect(sum.status).toBe(200);
    // platform: 12.32 (friend) + 35.20 (normal) + 35.20 (friend's old 20% visit)
    expect(sum.body.allTime.platformRevenue).toBeCloseTo(82.72, 2);
    // gross = what the cards were charged: 188.32 + 211.20 + 211.20
    expect(sum.body.allTime.grossRevenue).toBeCloseTo(610.72, 2);
    const month = sum.body.monthly[sum.body.monthly.length - 1];
    expect(month.caregiverPayout).toBeCloseTo(528, 2); // she keeps all $176, three times

    const brk = await h.request.get("/api/admin/financials/breakdown").set(h.auth(admin.token));
    expect(brk.status).toBe(200);
    const companionship = brk.body.byServiceType.find((r) => r.serviceType === "companionship");
    expect(companionship.platformFee).toBeCloseTo(82.72, 2);

    const sr = await h.request.get("/api/admin/financials/special-rates").set(h.auth(admin.token));
    expect(sr.status).toBe(200);
    const mine = sr.body.families.find((x) => x.id === friend.family.user.id);
    expect(mine.feePercent).toBe(7);
    expect(mine.completedVisits).toBe(2);
  });

  test("the schema parser sees the new columns (a phantom /* comment once hid every migration after 054)", () => {
    const { loadSchema } = require("../../src/utils/expectedSchema");
    const schema = loadSchema();
    const cols = (t) => (schema instanceof Map ? schema.get(t) : schema[t]);
    expect([...cols("users")]).toContain("special_fee_percent");
    expect([...cols("care_sessions")]).toContain("platform_fee_percent");
  });
});
