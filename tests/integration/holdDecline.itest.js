/**
 * v1.117.0 — when the card hold is declined.
 *
 * Oct 5: the hold for Tina's Oct 6 visit was declined (Sara's debit card, insufficient funds).
 * The payer was never told, and the poller's retries replayed Stripe's cached decline for 24h
 * because the idempotency key never changed. Pete, 10/14: "sara checks her debit card,
 * transfers money in, and then we try again ... there needs to be a 'try that card again'
 * option."
 *
 * Every assertion about Stripe is on what the mock was actually handed.
 */
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "sk_test_integration_fake";

let mockDecline = null;          // decline_code to throw on the next create, or null to succeed
let mockTimeout = false;         // throw a connection error instead
const mockCreated = [];
let mockRetrieve = {};
jest.mock("stripe", () => jest.fn(() => ({
  paymentIntents: {
    create: jest.fn(async (args, opts) => {
      mockCreated.push({ args, opts });
      if (mockTimeout) { const err = new Error("Request timed out"); err.type = "StripeConnectionError"; throw err; }
      if (mockDecline) {
        const err = new Error("Your card has insufficient funds.");
        err.type = "StripeCardError"; err.rawType = "card_error"; err.code = "card_declined"; err.decline_code = mockDecline;
        throw err;
      }
      return { id: `pi_hd_${mockCreated.length}`, status: "requires_capture", amount: args.amount };
    }),
    retrieve: jest.fn(async (id) => mockRetrieve[id] || { id, status: "requires_capture" }),
    capture: jest.fn(), cancel: jest.fn(),
  },
  paymentMethods: {
    list: jest.fn(async ({ type }) => ({ data: type === "card" ? [{ id: "pm_debit_2293", type: "card", card: { last4: "2293", brand: "visa" } }] : [] })),
  },
})));

const { v4: uuid } = require("uuid");
const { startHarness, stopHarness } = require("./harness");

jest.setTimeout(180000);

let h, db, acct, admin;
const pushes = [];

async function trustThisNetwork(as) {
  const probe = await h.request.get("/api/admin/overview").set(h.auth(as.token));
  const ip = (probe.body && probe.body.ip) || "::ffff:127.0.0.1";
  const { registerTrustedIp } = require("../../src/utils/trustedIps");
  await registerTrustedIp(as.user.id, ip, { verifiedVia: "itest" });
}

beforeAll(async () => {
  const push = require("../../src/routes/push");
  push.sendPushToUser = async (userId, payload) => { pushes.push({ userId, type: payload?.data?.type, body: payload?.body }); return { sent: 1 }; };
  h = await startHarness({
    routers: {
      "/api/sessions": "../../src/routes/sessions",
      "/api/push": "../../src/routes/push",
      "/api/admin": "../../src/routes/admin",
    },
  });
  db = h.db;
  acct = require("../../src/routes/accountability");
  admin = await h.createUser({ firstName: "Ad", lastName: "Min", isAdmin: true });
  await db.prepare("UPDATE users SET is_admin = 1 WHERE id = ?").run(admin.user.id);
  await trustThisNetwork(admin);
});
afterAll(async () => { await stopHarness(h); });
beforeEach(() => { mockTimeout = false; mockDecline = null; mockCreated.length = 0; pushes.length = 0; mockRetrieve = {}; });

/** Pete leads Betty's team, Sara is the billing contact, Tina is the caregiver. */
async function tomorrowVisit() {
  const pete = await h.createUser({ firstName: "Pete", lastName: "Fam" });
  const sara = await h.createUser({ firstName: "Sara", lastName: "Payer" });
  await db.prepare("UPDATE users SET stripe_customer_id = ? WHERE id = ?").run(`cus_${uuid().slice(0, 8)}`, sara.user.id);
  const { recipientId, teamId } = await h.createCareTeam({ familyUserId: pete.user.id, billingUserId: sara.user.id });
  await h.addTeamMember(teamId, sara.user.id, "member");
  const cg = await h.createUser({ roles: ["caregiver"], firstName: "Tina" });
  const profileId = uuid();
  await db.prepare(`
    INSERT INTO caregiver_profiles (id, user_id, hourly_rate, rate_daytime, is_background_checked,
      stripe_account_id, stripe_onboard_complete, identity_verified, created_at)
    VALUES (?, ?, 22, 22, 1, ?, 1, 1, NOW())
  `).run(profileId, cg.user.id, `acct_${uuid().slice(0, 8)}`);
  await db.prepare(`
    INSERT INTO verified_documents (id, owner_type, owner_id, uploaded_by, category, document_type, file_data, status, created_at)
    VALUES (?, 'caregiver', ?, ?, 'identity', 'drivers_license', 'data:image/png;base64,AAAA', 'approved', NOW())
  `).run(uuid(), profileId, cg.user.id);
  const sid = uuid();
  const tomorrow = new Date(Date.now() + 26 * 3600 * 1000).toISOString().slice(0, 10);
  await db.prepare(`
    INSERT INTO care_sessions (id, care_recipient_id, family_user_id, caregiver_id, service_type, status,
      scheduled_date, scheduled_time, duration_hours, proposed_rate, estimated_cost, created_at)
    VALUES (?, ?, ?, ?, 'companionship', 'confirmed', ?, '09:00', 8, 22, 176, NOW())
  `).run(sid, recipientId, pete.user.id, profileId, tomorrow);
  return { sid, pete, sara, cg, recipientId };
}

const row = (sid) => db.prepare("SELECT * FROM care_sessions WHERE id = ?").get(sid);

describe("a declined hold", () => {
  test("is recorded with the card and the reason, and the error is a sentence a person can read", async () => {
    const v = await tomorrowVisit();
    mockDecline = "insufficient_funds";
    const r = await acct.authorizeSessionPayment(v.sid);
    expect(r.declined).toBe(true);
    expect(r.code).toBe("insufficient_funds");
    expect(r.card).toBe("Visa ending 2293");
    expect(r.error).toMatch(/Visa ending 2293 was declined — there wasn't enough money on it/);
    const s = await row(v.sid);
    expect(Number(s.hold_attempts)).toBe(1);
    expect(s.hold_failure_code).toBe("insufficient_funds");
    expect(s.hold_failed_pm).toBe("pm_debit_2293");
    expect(s.stripe_payment_intent_id).toBeNull();
    expect(mockCreated[0].opts.idempotencyKey).toMatch(/_pm_debit_2293_a0$/);
  });

  test("the poller does not retry the same card every minute — it waits", async () => {
    const v = await tomorrowVisit();
    mockDecline = "insufficient_funds";
    await acct.authorizeSessionPayment(v.sid);
    const r = await acct.authorizeSessionPayment(v.sid); // the next tick
    expect(r.waiting).toBe(true);
    expect(mockCreated.length).toBe(1); // the bank was not asked again
  });

  test("after the wait the poller retries with a NEW key, so it reaches the bank instead of a cached decline", async () => {
    const v = await tomorrowVisit();
    mockDecline = "insufficient_funds";
    await acct.authorizeSessionPayment(v.sid);
    await db.prepare("UPDATE care_sessions SET hold_last_attempt_at = NOW() - INTERVAL '4 hours' WHERE id = ?").run(v.sid);
    mockDecline = null;
    const r = await acct.authorizeSessionPayment(v.sid);
    expect(r.success).toBe(true);
    expect(mockCreated.length).toBe(2);
    expect(mockCreated[1].opts.idempotencyKey).toMatch(/_a1$/);
    const s = await row(v.sid);
    expect(s.payment_status).toBe("authorized");
    expect(s.hold_failed_at).toBeNull();
  });

  test("a timeout (not a decline) does not advance the key — an attempt that landed is replayed, not doubled", async () => {
    const v = await tomorrowVisit();
    mockTimeout = true;
    const r = await acct.authorizeSessionPayment(v.sid);
    mockTimeout = false;
    expect(r.declined).toBeUndefined();
    const s = await row(v.sid);
    expect(Number(s.hold_attempts)).toBe(0);
    expect(s.hold_failed_at).toBeNull();
  });
});

describe("Try the card again", () => {
  test("Sara moves money in and taps it: the bank is asked now, and the hold lands", async () => {
    const v = await tomorrowVisit();
    mockDecline = "insufficient_funds";
    await acct.authorizeSessionPayment(v.sid);
    await db.prepare("UPDATE care_sessions SET hold_last_attempt_at = NOW() - INTERVAL '2 minutes' WHERE id = ?").run(v.sid);
    mockDecline = null;
    const res = await h.request.post(`/api/sessions/${v.sid}/retry-hold`).set(h.auth(v.sara.token)).send({});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("held");
    expect(res.body.message).toMatch(/Visa ending 2293 went through/);
    expect(mockCreated.length).toBe(2);
    expect(mockCreated[1].opts.idempotencyKey).toMatch(/_a1$/);
  });

  test("declined again: 402 with the reason, and the attempt is counted", async () => {
    const v = await tomorrowVisit();
    mockDecline = "insufficient_funds";
    await acct.authorizeSessionPayment(v.sid);
    await db.prepare("UPDATE care_sessions SET hold_last_attempt_at = NOW() - INTERVAL '2 minutes' WHERE id = ?").run(v.sid);
    const res = await h.request.post(`/api/sessions/${v.sid}/retry-hold`).set(h.auth(v.pete.token)).send({});
    expect(res.status).toBe(402);
    expect(res.body.code).toBe("HOLD_DECLINED");
    expect(res.body.error).toMatch(/declined/);
    expect(Number((await row(v.sid)).hold_attempts)).toBe(2);
  });

  test("a double tap is one attempt", async () => {
    const v = await tomorrowVisit();
    mockDecline = "insufficient_funds";
    await acct.authorizeSessionPayment(v.sid);
    const res = await h.request.post(`/api/sessions/${v.sid}/retry-hold`).set(h.auth(v.sara.token)).send({});
    expect(res.status).toBe(429);
    expect(mockCreated.length).toBe(1);
  });

  test("the caregiver cannot retry the family's card, and cannot read it", async () => {
    const v = await tomorrowVisit();
    mockDecline = "insufficient_funds";
    await acct.authorizeSessionPayment(v.sid);
    expect((await h.request.post(`/api/sessions/${v.sid}/retry-hold`).set(h.auth(v.cg.token)).send({})).status).toBe(403);
    expect((await h.request.get(`/api/sessions/${v.sid}/hold`).set(h.auth(v.cg.token))).status).toBe(403);
  });

  test("the hold endpoint tells the payer which card and why", async () => {
    const v = await tomorrowVisit();
    mockDecline = "insufficient_funds";
    await acct.authorizeSessionPayment(v.sid);
    const res = await h.request.get(`/api/sessions/${v.sid}/hold`).set(h.auth(v.sara.token));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("declined");
    expect(res.body.card).toBe("Visa ending 2293");
    expect(res.body.reason).toBe("there wasn't enough money on it");
    expect(res.body.canRetrySameCard).toBe(true);
    expect(res.body.isPayer).toBe(true);
  });

  test("an expired card is not offered 'try again' — only a different card", async () => {
    const v = await tomorrowVisit();
    mockDecline = "expired_card";
    await acct.authorizeSessionPayment(v.sid);
    const res = await h.request.get(`/api/sessions/${v.sid}/hold`).set(h.auth(v.sara.token));
    expect(res.body.canRetrySameCard).toBe(false);
  });
});

describe("who hears about it", () => {
  test("the payer and the person who booked are told once, in words, with the sheet one tap away", async () => {
    const v = await tomorrowVisit();
    const { notifyHoldDeclined } = require("../../src/utils/holdDecline");
    await notifyHoldDeclined(db, {
      id: v.sid, billing_user_id: v.sara.user.id, family_user_id: v.pete.user.id,
      caregiver_first: "Tina", recipient_first_name: "Betty",
    }, { card: "Visa ending 2293", code: "insufficient_funds", hoursUntil: 24 });
    const told = pushes.filter((p) => p.type === "hold_declined").map((p) => p.userId).sort();
    expect(told).toEqual([v.pete.user.id, v.sara.user.id].sort());
    expect(pushes[0].body).toMatch(/Tina's visit with Betty is tomorrow, and Visa ending 2293 was declined — there wasn't enough money on it/);
  });

  test("Needs-you carries it for the payer and the leader, with Try the card again as the one-tap action", async () => {
    const v = await tomorrowVisit();
    mockDecline = "insufficient_funds";
    await acct.authorizeSessionPayment(v.sid);
    const { attentionItemsFor } = require("../../src/utils/attention");
    for (const who of [v.sara, v.pete]) {
      const a = await attentionItemsFor(db, who.user.id);
      const item = a.items.find((i) => i.kind === "holdDeclined");
      expect(item).toBeTruthy();
      expect(item.verb).toBe("Try the card again");
      expect(item.action.path).toBe(`/api/sessions/${v.sid}/retry-hold`);
      expect(a.holdDeclined).toBe(1);
    }
    const cgView = await attentionItemsFor(db, v.cg.user.id);
    expect(cgView.items.some((i) => i.kind === "holdDeclined")).toBe(false);

    // Once it goes through, it is no longer waiting on anyone.
    await db.prepare("UPDATE care_sessions SET hold_last_attempt_at = NOW() - INTERVAL '2 minutes' WHERE id = ?").run(v.sid);
    mockDecline = null;
    await h.request.post(`/api/sessions/${v.sid}/retry-hold`).set(h.auth(v.sara.token)).send({});
    const after = await attentionItemsFor(db, v.sara.user.id);
    expect(after.items.some((i) => i.kind === "holdDeclined")).toBe(false);
  });
});

describe("correcting the records (Pete, 10/14: \"correct the records\")", () => {
  test("backfill writes pre-ledger paid visits from Stripe's numbers, dated when paid, once", async () => {
    const v = await tomorrowVisit();
    await db.prepare(`
      UPDATE care_sessions SET status = 'completed', payment_status = 'paid', stripe_payment_intent_id = 'pi_old_1',
        payment_captured_at = '2026-09-15T20:00:00Z' WHERE id = ?
    `).run(v.sid);
    mockRetrieve.pi_old_1 = { id: "pi_old_1", status: "succeeded", amount_received: 21120, application_fee_amount: 3520, transfer_data: { destination: "acct_x" } };

    const dry = await h.request.post("/api/admin/ledger/backfill-captures").set(h.auth(admin.token)).send({ dryRun: true });
    expect(dry.status).toBe(200);
    const planned = dry.body.plan.find((p) => p.sessionId === v.sid);
    expect(planned).toMatchObject({ kind: "capture", familyCents: 21120, caregiverCents: 17600, platformCents: 3520 });
    expect(await db.prepare("SELECT COUNT(*)::int AS n FROM ledger_entries WHERE session_id = ?").get(v.sid)).toEqual({ n: 0 });

    const run = await h.request.post("/api/admin/ledger/backfill-captures").set(h.auth(admin.token)).send({});
    expect(run.status).toBe(200);
    const le = await db.prepare("SELECT * FROM ledger_entries WHERE session_id = ?").all(v.sid);
    expect(le.length).toBe(1);
    expect(Number(le[0].caregiver_cents)).toBe(17600);
    expect(Number(le[0].platform_cents)).toBe(3520);
    expect(le[0].family_user_id).toBe(v.sara.user.id);
    expect(new Date(le[0].created_at).toISOString()).toBe("2026-09-15T20:00:00.000Z");

    const again = await h.request.post("/api/admin/ledger/backfill-captures").set(h.auth(admin.token)).send({});
    expect(again.body.plan.some((p) => p.sessionId === v.sid)).toBe(false);
    expect((await db.prepare("SELECT COUNT(*)::int AS n FROM ledger_entries WHERE session_id = ?").get(v.sid)).n).toBe(1);
  });

  test("the cancel-fee correction moves the caregiver's share out of InPlace's column, from the hold's own row", async () => {
    const v = await tomorrowVisit();
    const pi = `pi_cf_${uuid().slice(0, 6)}`;
    const ins = (kind, fam, cg, plat) => db.prepare(`
      INSERT INTO ledger_entries (id, session_id, care_recipient_id, kind, family_user_id, caregiver_id,
        family_cents, caregiver_cents, platform_cents, stripe_payment_intent, breakdown)
      VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, '{"cancelFeeCents":21120}')
    `).run(uuid(), v.sid, v.recipientId, kind, v.sara.user.id, fam, cg, plat, pi);
    await ins("authorization", 21120, 17600, 3520);
    await ins("cancel_fee", 21120, 0, 21120);
    // Re-run just this migration, as a fresh deploy would.
    await db.prepare("DELETE FROM schema_migrations WHERE id = '065_cancel_fee_split_fix'").run();
    const { initializeDatabase } = require("../../src/models/database");
    await initializeDatabase();
    const cf = await db.prepare("SELECT * FROM ledger_entries WHERE stripe_payment_intent = ? AND kind = 'cancel_fee'").get(pi);
    expect(Number(cf.caregiver_cents)).toBe(17600);
    expect(Number(cf.platform_cents)).toBe(3520);
    expect(Number(cf.family_cents)).toBe(21120);
    expect(JSON.parse(cf.breakdown).corrected).toMatch(/v1\.117\.0/);
  });
});
