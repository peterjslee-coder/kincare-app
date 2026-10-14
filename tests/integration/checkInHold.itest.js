/**
 * v1.114.2 — no card hold, no check-in.
 * Pete, 10/13: "check in requires a valid hold. 24 hours prior, there should be a hold, right?"
 * The poller places it ~24h ahead; at check-in the server tries once more, then refuses with
 * 402 HOLD_REQUIRED and tells the family.
 */
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "sk_test_integration_fake";

let mockMethods = [];
const mockCreated = [];
jest.mock("stripe", () => jest.fn(() => ({
  paymentIntents: {
    create: jest.fn(async (args) => { mockCreated.push(args); return { id: `pi_ci_${mockCreated.length}`, status: "requires_capture", amount: args.amount }; }),
    retrieve: jest.fn(async (id) => ({ id, status: "requires_capture" })),
    capture: jest.fn(), cancel: jest.fn(),
  },
  paymentMethods: { list: jest.fn(async ({ type }) => ({ data: mockMethods.filter((m) => m.type === type) })) },
})));

const { v4: uuid } = require("uuid");
const { startHarness, stopHarness } = require("./harness");

jest.setTimeout(180000);

let h, db;
const pushes = [];

beforeAll(async () => {
  const push = require("../../src/routes/push");
  push.sendPushToUser = async (userId, payload) => { pushes.push({ userId, type: payload?.data?.type }); return { sent: 1 }; };
  h = await startHarness({ routers: { "/api/sessions": "../../src/routes/sessions" } });
  db = h.db;
});
afterAll(async () => { await stopHarness(h); });
beforeEach(() => { mockMethods = []; mockCreated.length = 0; pushes.length = 0; });

async function visitNow({ cost = 88, paymentStatus = null, pi = null } = {}) {
  const fam = await h.createUser({ firstName: "Hold", lastName: "Fam" });
  await db.prepare("UPDATE users SET stripe_customer_id = ? WHERE id = ?").run(`cus_${uuid().slice(0, 8)}`, fam.user.id);
  const { recipientId } = await h.createCareTeam({ familyUserId: fam.user.id });
  await db.prepare("UPDATE care_recipients SET timezone = 'UTC' WHERE id = ?").run(recipientId);
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
  const today = new Date().toISOString().slice(0, 10);
  const hhmm = new Date().toISOString().slice(11, 16);
  await db.prepare(`
    INSERT INTO care_sessions (id, care_recipient_id, family_user_id, caregiver_id, service_type, status,
      scheduled_date, scheduled_time, duration_hours, proposed_rate, estimated_cost, payment_status,
      stripe_payment_intent_id, created_at)
    VALUES (?, ?, ?, ?, 'companionship', 'confirmed', ?, ?, 4, 22, ?, ?, ?, NOW())
  `).run(sid, recipientId, fam.user.id, profileId, today, hhmm, cost, paymentStatus, pi);
  return { sid, fam, cg };
}

const checkIn = (v) => h.request.post(`/api/sessions/${v.sid}/check-in`).set(h.auth(v.cg.token)).send({ briefingAcknowledged: true });

test("no hold and the family's card can't be held: refused, and the family is told", async () => {
  const v = await visitNow();
  const res = await checkIn(v);
  expect(res.status).toBe(402);
  expect(res.body.code).toBe("HOLD_REQUIRED");
  expect(pushes.some((p) => p.userId === v.fam.user.id && p.type === "hold_declined")).toBe(true); // v1.117.0 — opens the card sheet
  const s = await db.prepare("SELECT status FROM care_sessions WHERE id = ?").get(v.sid);
  expect(s.status).toBe("confirmed");
});

test("no hold yet, but the card works: the hold is placed on the spot and she checks in", async () => {
  mockMethods = [{ id: "pm_card_1", type: "card", card: { last4: "4242", brand: "visa" } }];
  const v = await visitNow();
  const res = await checkIn(v);
  expect(mockCreated.length).toBe(1);
  expect(mockCreated[0].capture_method).toBe("manual");
  expect(res.status).toBeLessThan(300);
});

test("hold already in place: checks in without touching Stripe", async () => {
  const v = await visitNow({ paymentStatus: "authorized", pi: "pi_existing" });
  const res = await checkIn(v);
  expect(res.status).toBeLessThan(300);
  expect(mockCreated.length).toBe(0);
});

test("a visit with nothing to pay is not blocked", async () => {
  const v = await visitNow({ cost: 0 });
  expect((await checkIn(v)).status).toBeLessThan(300);
});
