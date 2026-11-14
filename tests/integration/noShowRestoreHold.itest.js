/**
 * v1.127.4 — a restored no-show visit could not be checked in.
 *
 * Nov 14, Tina and Betty. Tina arrived late; the no-show sweep cancelled the visit and voided
 * the card hold. Pete restored it from Admin. Check-in then refused: "card needed". The void
 * left stripe_payment_intent_id on the row, so authorizeSessionPayment answered "Already
 * authorized" and never placed a new hold — the card was fine, our own cancelled hold was in
 * the way.
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
      return { id: `pi_nr_${mockCreated.length}`, status: "requires_capture", amount: args.amount };
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


describe("a voided hold does not block a new one", () => {
  test("authorize after a void places a fresh hold instead of 'Already authorized'", async () => {
    const v = await tomorrowVisit();
    const first = await acct.authorizeSessionPayment(v.sid);
    expect(first.error).toBeUndefined();
    const held = await row(v.sid);
    expect(held.payment_status).toBe("authorized");

    await acct.voidSessionPayment(v.sid);
    const voided = await row(v.sid);
    expect(voided.payment_status).toBe("voided");
    expect(voided.stripe_payment_intent_id).toBe(held.stripe_payment_intent_id); // the trap

    const again = await acct.authorizeSessionPayment(v.sid, { manual: true });
    expect(again.error).toBeUndefined();
    const now = await row(v.sid);
    expect(now.payment_status).toBe("authorized");
    expect(now.stripe_payment_intent_id).not.toBe(held.stripe_payment_intent_id);
    // a different idempotency key, or Stripe would replay the cancelled intent
    expect(mockCreated[1].opts.idempotencyKey).not.toBe(mockCreated[0].opts.idempotencyKey);
    expect(mockCreated[1].opts.idempotencyKey).toMatch(/_rv\d+$/);
  });

  test("a live hold is still never doubled", async () => {
    const v = await tomorrowVisit();
    await acct.authorizeSessionPayment(v.sid);
    const r = await acct.authorizeSessionPayment(v.sid, { manual: true });
    expect(r.error).toBe("Already authorized");
    expect(mockCreated.length).toBe(1);
  });

  test("Admin restore of a no-show places a new hold, so check-in can proceed", async () => {
    const v = await tomorrowVisit();
    await acct.authorizeSessionPayment(v.sid);
    await acct.voidSessionPayment(v.sid);
    await db.prepare(`
      UPDATE care_sessions SET status = 'cancelled', cancelled_by = 'system', cancelled_at = NOW(),
        caregiver_no_show = 1, notifications_sent = ',no_show_flagged' WHERE id = ?
    `).run(v.sid);

    const res = await h.request.post(`/api/admin/sessions/${v.sid}/restore`).set(h.auth(admin.token)).send({});
    expect(res.status).toBe(200);
    expect(res.body.hold).toEqual({ placed: true });
    const s = await row(v.sid);
    expect(s.status).toBe("confirmed");
    expect(s.payment_status).toBe("authorized");
    expect(Number(s.caregiver_no_show)).toBe(0);
    expect(mockCreated.length).toBe(2);
  });
});
