/**
 * v1.116.3 — the admin person drawer, and the cancel fee's split.
 *
 * Pete, 10/14, on Tina Houston's drawer: "some of her information is correct. much of it isn't.
 * it doesn't have her ratings, her revenue, care teams". Every one was a wiring fault, not data:
 *   - revenue summed `payments`, which a visit settled by capturing its hold never writes;
 *   - the rating read avg_rating/total_reviews, the server sends avgReceived/received;
 *   - Care Teams counted care_team_members, and a caregiver is linked via caregiver_assignments;
 *   - No-shows read a field nothing sent.
 * And the cancel fee was ledgered as 100% InPlace when Stripe pays the caregiver her share.
 */
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "sk_test_integration_fake";

let mockFee = 3520;
jest.mock("stripe", () => jest.fn(() => ({
  paymentIntents: {
    capture: jest.fn(async (id, args) => ({ id, status: "succeeded", amount_received: 21120, application_fee_amount: mockFee })),
    retrieve: jest.fn(async (id) => ({ id, status: "requires_capture", application_fee_amount: mockFee })),
  },
})));

const { startHarness, stopHarness } = require("./harness");
const { v4: uuid } = require("uuid");

jest.setTimeout(180000);

let h, db, admin;

async function trustThisNetwork(as) {
  const probe = await h.request.get("/api/admin/overview").set(h.auth(as.token));
  const ip = (probe.body && probe.body.ip) || "::ffff:127.0.0.1";
  const { registerTrustedIp } = require("../../src/utils/trustedIps");
  await registerTrustedIp(as.user.id, ip, { verifiedVia: "itest" });
}

async function setup(name) {
  const family = await h.createUser({ firstName: name, lastName: "Fam" });
  const { recipientId } = await h.createCareTeam({ familyUserId: family.user.id, name: `${name} team` });
  const cg = await h.createUser({ firstName: "Care", lastName: name, roles: ["caregiver"] });
  const profileId = uuid();
  await db.prepare(`
    INSERT INTO caregiver_profiles (id, user_id, hourly_rate, rate_daytime, stripe_account_id, stripe_onboard_complete, created_at)
    VALUES (?, ?, 22, 22, ?, 1, NOW())
  `).run(profileId, cg.user.id, `acct_${uuid().slice(0, 8)}`);
  await db.prepare(`
    INSERT INTO caregiver_assignments (id, care_recipient_id, family_user_id, caregiver_profile_id, is_active)
    VALUES (?, ?, ?, ?, 1)
  `).run(uuid(), recipientId, family.user.id, profileId);
  return { family, cg, recipientId, profileId };
}

async function visit(s, { status = "completed", paid = true, noShow = false, pi = null, authorized = null } = {}) {
  const id = uuid();
  await db.prepare(`
    INSERT INTO care_sessions (id, care_recipient_id, family_user_id, caregiver_id, service_type, status,
      scheduled_date, scheduled_time, duration_hours, proposed_rate, estimated_cost, payment_status,
      caregiver_no_show, stripe_payment_intent_id, authorized_amount, created_at)
    VALUES (?, ?, ?, ?, 'companionship', ?, '2026-10-01', '09:00', 8, 22, 176, ?, ?, ?, ?, NOW())
  `).run(id, s.recipientId, s.family.user.id, s.profileId, status, paid ? "paid" : null, noShow ? 1 : 0, pi, authorized);
  return id;
}

const ledgerCapture = (s, sid) => db.prepare(`
  INSERT INTO ledger_entries (id, session_id, care_recipient_id, kind, family_user_id, caregiver_id,
    family_cents, caregiver_cents, platform_cents, stripe_payment_intent)
  VALUES (?, ?, ?, 'capture', ?, ?, 21120, 17600, 3520, ?)
`).run(uuid(), sid, s.recipientId, s.family.user.id, s.profileId, `pi_${uuid().slice(0, 8)}`);

beforeAll(async () => {
  h = await startHarness({ routers: { "/api/admin": "../../src/routes/admin" } });
  db = h.db;
  admin = await h.createUser({ firstName: "Ad", lastName: "Min", isAdmin: true });
  await db.prepare("UPDATE users SET is_admin = 1 WHERE id = ?").run(admin.user.id);
  await trustThisNetwork(admin);
});
afterAll(async () => { await stopHarness(h); });

describe("a caregiver's drawer", () => {
  test("money comes from the ledger, legacy payments, and counts pre-ledger paid visits", async () => {
    const s = await setup("Money");
    const a = await visit(s); await ledgerCapture(s, a);
    const b = await visit(s); await ledgerCapture(s, b);
    const legacy = await visit(s);
    await db.prepare(`
      INSERT INTO payments (id, session_id, family_user_id, caregiver_id, amount, platform_fee, caregiver_payout, status)
      VALUES (?, ?, ?, ?, 211.2, 35.2, 176, 'completed')
    `).run(uuid(), legacy, s.family.user.id, s.profileId);
    await visit(s); // paid before the ledger existed: no ledger row, no payments row

    const res = await h.request.get(`/api/admin/users/${s.cg.user.id}/detail`).set(h.auth(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.money.earnedCents).toBe(17600 * 3);
    expect(res.body.money.chargedCents).toBe(21120 * 3);
    expect(res.body.money.platformCents).toBe(3520 * 3);
    expect(res.body.money.paidVisits).toBe(3);
    expect(res.body.money.unitemizedPaidVisits).toBe(1);
    expect(res.body.lifetimeRevenue).toBe(528);
  });

  test("ratings, care teams and no-shows are sent in the shape the drawer reads", async () => {
    const s = await setup("Shape");
    for (const r of [5, 4]) {
      const sid = await visit(s);
      await db.prepare("INSERT INTO reviews (id, session_id, family_user_id, caregiver_id, rating) VALUES (?, ?, ?, ?, ?)")
        .run(uuid(), sid, s.family.user.id, s.profileId, r);
    }
    await visit(s, { status: "cancelled", paid: false, noShow: true });
    const res = await h.request.get(`/api/admin/users/${s.cg.user.id}/detail`).set(h.auth(admin.token));
    expect(res.body.reviewStats.received).toBe(2);
    expect(res.body.reviewStats.avgReceived).toBe(4.5);
    expect(res.body.careTeams.length).toBe(1);
    expect(res.body.careTeams[0].recipient_name).toBe("Betty ITest");
    expect(res.body.sessionStats.no_shows).toBe(1);
  });

  test("an inactive assignment is not a care team", async () => {
    const s = await setup("Inactive");
    await db.prepare("UPDATE caregiver_assignments SET is_active = 0 WHERE caregiver_profile_id = ?").run(s.profileId);
    const res = await h.request.get(`/api/admin/users/${s.cg.user.id}/detail`).set(h.auth(admin.token));
    expect(res.body.careTeams.length).toBe(0);
  });
});

describe("a family's drawer", () => {
  test("shows what the family was charged", async () => {
    const s = await setup("Fam");
    const a = await visit(s); await ledgerCapture(s, a);
    const res = await h.request.get(`/api/admin/users/${s.family.user.id}/detail`).set(h.auth(admin.token));
    expect(res.body.money.chargedCents).toBe(21120);
    expect(res.body.money.earnedCents).toBe(0);
    expect(res.body.lifetimeRevenue).toBe(211.2);
  });
});

describe("the late-cancel fee's ledger row", () => {
  test("records the caregiver's share, not 100% to InPlace", async () => {
    const s = await setup("Cancel");
    const pi = `pi_${uuid().slice(0, 8)}`;
    const sid = await visit(s, { status: "cancelled", paid: false, pi, authorized: 21120 });
    mockFee = 3520;
    const acct = require("../../src/routes/accountability");
    const r = await acct.captureSessionPayment(sid, 21120);
    expect(r.success).toBe(true);
    const row = await db.prepare("SELECT * FROM ledger_entries WHERE session_id = ? AND kind = 'cancel_fee'").get(sid);
    expect(Number(row.family_cents)).toBe(21120);
    expect(Number(row.platform_cents)).toBe(3520);
    expect(Number(row.caregiver_cents)).toBe(17600);
    expect(row.caregiver_id).toBe(s.profileId);
  });
});
