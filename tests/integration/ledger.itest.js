/**
 * v1.109.0 — every movement of money leaves a record, with its arithmetic.
 *
 * Pete (9/18): "def need payment records with breakdown of all costs and adjustments." Before
 * this, the capture at check-out, the balance charge, cancel fees and tips wrote nothing to
 * any ledger, so admin financials fell back to estimated_cost × 0.2 and the family's payment
 * history simply omitted the visit.
 *
 * Also his rush rule: "there's a 20% surcharge for rush inside 24 hours...of that extra 20%,
 * the caregiver gets 80, IP gets 20."
 */
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "sk_test_integration_fake";
const captures = [];
const creates = [];
jest.mock("stripe", () => jest.fn(() => ({
  paymentIntents: {
    create: jest.fn(async (args) => { creates.push(args); return { id: `pi_new_${creates.length}`, status: "succeeded", customer: "cus_1", payment_method: "pm_1", amount: args.amount }; }),
    capture: jest.fn(async (id, args) => { captures.push({ id, args }); return { id, status: "succeeded", amount_received: args.amount_to_capture }; }),
    retrieve: jest.fn(async (id) => ({ id, status: "requires_capture", customer: "cus_1", payment_method: "pm_1" })),
  },
  paymentMethods: { list: jest.fn(async () => ({ data: [] })) },
})));
jest.mock("../../src/routes/push", () => {
  const actual = jest.requireActual("../../src/routes/push");
  return { ...actual, sendPushToUser: jest.fn(async () => ({ sent: 0 })), notifyAdmins: jest.fn() };
});

const { v4: uuid } = require("uuid");
const { startHarness, stopHarness } = require("./harness");
const { priceVisit } = require("../../src/utils/pricing");

jest.setTimeout(180000);
const TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());

let h, db, family, tina, profileId, recipientId;
beforeAll(async () => {
  h = await startHarness({ routers: { "/api/sessions": "../../src/routes/sessions", "/api/payments": "../../src/routes/payments" } });
  db = h.db;
  family = await h.createUser({ firstName: "Sara", roles: ["family"] });
  ({ recipientId } = await h.createCareTeam({ familyUserId: family.user.id }));
  tina = await h.createUser({ firstName: "Tina", roles: ["caregiver"] });
  profileId = uuid();
  await db.prepare("INSERT INTO caregiver_profiles (id, user_id, hourly_rate, stripe_account_id, created_at) VALUES (?, ?, 22, 'acct_tina', NOW())").run(profileId, tina.user.id);
});
afterAll(async () => { await stopHarness(h); });

/** An in-progress visit, checked in `minutesAgo` ago, with a hold already on the card. */
async function activeVisit({ cost = 176, surcharge = 0, hours = 8, minutesAgo = 480, authorized = null } = {}) {
  const sid = uuid();
  // A PaymentIntent id per visit: the ledger keys on it, so sharing one across visits would
  // (correctly) collapse them into a single row.
  await db.prepare(`
    INSERT INTO care_sessions (id, care_recipient_id, family_user_id, caregiver_id, service_type, status,
      scheduled_date, scheduled_time, duration_hours, estimated_cost, short_notice_surcharge, agreed_rate,
      stripe_payment_intent_id, authorized_amount, payment_status, flex_timing, created_at)
    VALUES (?, ?, ?, ?, 'companionship', 'in_progress', ?, '09:00', ?, ?, ?, 22, ?, ?, 'authorized', 'strict', NOW())
  `).run(sid, recipientId, family.user.id, profileId, TODAY, hours, cost, surcharge,
    `pi_hold_${sid.slice(0, 8)}`,
    authorized == null ? Math.round(cost * 120) : authorized);
  await db.prepare(`
    INSERT INTO visit_logs (id, session_id, caregiver_id, check_in_time, created_at)
    VALUES (?, ?, ?, NOW() - (? || ' minutes')::interval, NOW())
  `).run(uuid(), sid, profileId, String(minutesAgo));
  return sid;
}
const checkOut = (sid) => h.request.post(`/api/sessions/${sid}/check-out`).set(h.auth(tina.token)).send({ summary: "fine" });
const entries = (sid) => db.prepare("SELECT * FROM ledger_entries WHERE session_id = ? ORDER BY created_at").all(sid);

test("an ordinary visit writes one capture row with the arithmetic behind it", async () => {
  const sid = await activeVisit();
  captures.length = 0;
  expect((await checkOut(sid)).status).toBe(200);
  const rows = await entries(sid);
  expect(rows.map((r) => r.kind)).toEqual(["capture"]);
  const r = rows[0];
  expect([r.family_cents, r.caregiver_cents, r.platform_cents]).toEqual([21120, 17600, 3520]);
  const b = JSON.parse(r.breakdown);
  expect(b).toEqual(expect.objectContaining({
    quotedCents: 17600, baseCents: 17600, surchargeCents: 0, platformFeeCents: 3520,
    feePercent: 20, hourlyCents: 2200, capturedCents: 21120, remainderCents: 0, settledAt: "check-out",
  }));
  expect(r.stripe_payment_intent).toBe(`pi_hold_${sid.slice(0, 8)}`);
});

test("a rush visit splits the surcharge 80/20 and says so on the record", async () => {
  // $176 of care + a $35.20 rush surcharge.
  const sid = await activeVisit({ cost: 211.20, surcharge: 35.20, authorized: 24640 });
  expect((await checkOut(sid)).status).toBe(200);
  const r = (await entries(sid)).find((x) => x.kind === "capture");
  const expected = priceVisit({ baseCents: 17600, surchargeCents: 3520, feePercent: 20 });
  expect(expected.caregiverCents).toBe(20416); // 176 + 80% of 35.20
  expect(expected.platformFeeCents).toBe(4224); // 20% of 176 + 20% of 35.20
  expect(r.caregiver_cents).toBe(20416);
  expect(r.platform_cents).toBe(4224);
  expect(r.family_cents).toBe(24640);
  const b = JSON.parse(r.breakdown);
  expect(b.surchargeToCaregiverCents).toBe(2816);
  expect(b.surchargeToPlatformCents).toBe(704);
});

test("breaks and overtime appear as adjustments, not as a changed price", async () => {
  const sid = await activeVisit({ minutesAgo: 500 }); // 20 min past an 8h visit → overtime
  await db.prepare(`
    INSERT INTO visit_breaks (id, session_id, caregiver_user_id, started_at, ended_at, created_at)
    VALUES (?, ?, ?, NOW() - interval '200 minutes', NOW() - interval '140 minutes', NOW())
  `).run(uuid(), sid, tina.user.id);
  expect((await checkOut(sid)).status).toBe(200);
  const b = JSON.parse((await entries(sid)).find((x) => x.kind === "capture").breakdown);
  expect(b.quotedCents).toBe(17600);
  expect(b.breakMinutes).toBeGreaterThan(0);
  expect(b.breakDeductionCents).toBeGreaterThan(0);
  expect(b.scheduledHours).toBe(8);
});

test("a hold too small for the visit records the capture AND the balance charge", async () => {
  const sid = await activeVisit({ authorized: 19200 }); // the old fee-inside hold
  expect((await checkOut(sid)).status).toBe(200);
  const rows = await entries(sid);
  expect(rows.map((r) => r.kind)).toEqual(["capture", "remainder"]);
  expect(rows[0].family_cents).toBe(19200);
  expect(rows[0].caregiver_cents).toBe(17600);
  expect(rows[0].platform_cents).toBe(1600);
  expect(rows[1].family_cents).toBe(1920);
  expect(rows[1].caregiver_cents).toBe(0);
  const totals = rows.reduce((n, r) => n + r.family_cents, 0);
  expect(totals).toBe(21120);
});

test("the family's history shows the charge, itemised, and totals it", async () => {
  const sid = await activeVisit();
  await checkOut(sid);
  const res = await h.request.get("/api/payments/history").set(h.auth(family.token));
  expect(res.status).toBe(200);
  const row = res.body.payments.find((p) => p.sessionId === sid);
  expect(row).toEqual(expect.objectContaining({ amount: 211.20, toCaregiver: 176, toInPlace: 35.20, kind: "capture" }));
  expect(row.lines.map((l) => l.label)).toEqual(expect.arrayContaining([
    expect.stringContaining("Care — 8 h at $22.00/h"), "InPlace fee (20%)",
  ]));
  expect(res.body.totalSpent).toBeGreaterThanOrEqual(211.20);
});

test("the visit sheet carries the receipt; the caregiver sees her side only", async () => {
  const sid = await activeVisit();
  await checkOut(sid);
  const fam = await h.request.get(`/api/sessions/${sid}`).set(h.auth(family.token));
  expect(fam.body.receipt.totals).toEqual(expect.objectContaining({ charged: 211.20, toCaregiver: 176, toInPlace: 35.20 }));
  const cg = await h.request.get(`/api/sessions/${sid}`).set(h.auth(tina.token));
  expect(cg.body.receipt.totals).toEqual({ toCaregiver: 176 });
  expect(JSON.stringify(cg.body.receipt)).not.toMatch(/InPlace fee/);
});

test("a tip is its own record: all of it hers, the card fee passed through", async () => {
  const sid = await activeVisit();
  await checkOut(sid);
  await db.prepare("UPDATE care_sessions SET review_completed = 0 WHERE id = ?").run(sid);
  const r = await h.request.post(`/api/sessions/${sid}/tip`).set(h.auth(family.token)).send({ amount_cents: 2000 });
  expect(r.status).toBe(200);
  const tip = (await entries(sid)).find((x) => x.kind === "tip");
  expect(tip.caregiver_cents).toBe(2000);
  expect(tip.platform_cents).toBe(0);
  expect(tip.card_fee_cents).toBe(tip.family_cents - 2000);
});
