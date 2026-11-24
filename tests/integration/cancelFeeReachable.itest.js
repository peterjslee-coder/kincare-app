/**
 * v1.109.9 — feedback 9d286a8a. Pete: "I got a notice that the session that I canceled would
 * be charged unless there was a reason why. And it said tell us. So I tapped on the push
 * notification and it just brought me to the homepage."
 *
 * The fee endpoints existed and nothing called them. Now a sheet does, the Needs-you card
 * carries the fee, and the endpoints keep the "already answered" contract (409).
 */
const { v4: uuid } = require("uuid");
const { startHarness, stopHarness } = require("./harness");

jest.setTimeout(180000);
let h, db;

beforeAll(async () => {
  h = await startHarness({ routers: {
    "/api/sessions": "../../src/routes/sessions",
    "/api/push": "../../src/routes/push",
  } });
  db = h.db;
  // No Stripe here. Waive releases the hold through accountability's voidSessionPayment, which
  // the route reads off the module at call time — so stand in for the release, not the route.
  require("../../src/routes/accountability").voidSessionPayment = async () => ({ success: true });
});
afterAll(async () => { await stopHarness(h); });

async function pendingFee({ status = "cancelled", parkCaregiver = false } = {}) {
  const family = await h.createUser({ firstName: "Pete" });
  const { recipientId } = await h.createCareTeam({ familyUserId: family.user.id });
  const cg = await h.createUser({ firstName: "Tina", roles: ["caregiver"] });
  const profileId = uuid();
  await db.prepare("INSERT INTO caregiver_profiles (id, user_id, hourly_rate, created_at) VALUES (?, ?, 25, NOW())").run(profileId, cg.user.id);
  const sessionId = uuid();
  await db.prepare(`
    INSERT INTO care_sessions (id, care_recipient_id, family_user_id, caregiver_id, cancelled_caregiver_id,
      service_type, status, scheduled_date, scheduled_time, duration_hours, created_at,
      cancel_fee_status, cancel_fee_cents, cancel_fee_deadline)
    VALUES (?, ?, ?, ?, ?, 'companionship', ?, '2026-12-02', '10:00', 2, NOW(),
      'pending', 5000, NOW() + INTERVAL '24 hours')
  `).run(sessionId, recipientId, family.user.id, parkCaregiver ? null : profileId,
    parkCaregiver ? profileId : null, status);
  return { family, cg, sessionId };
}

const dispute = (t, token, reason = "The caregiver told me it was fine") =>
  h.request.post(`/api/sessions/${t.sessionId}/cancel-fee/dispute`).set(h.auth(token)).send({ reason });
const waive = (t, token) =>
  h.request.post(`/api/sessions/${t.sessionId}/cancel-fee/waive`).set(h.auth(token)).send({});

test("the sheet can read the fee, and knows who is looking", async () => {
  const t = await pendingFee();
  const fam = await h.request.get(`/api/sessions/${t.sessionId}/cancel-fee`).set(h.auth(t.family.token));
  expect(fam.status).toBe(200);
  expect(fam.body).toMatchObject({ status: "pending", amountCents: 5000, canDispute: true, canWaive: false, viewer: "family" });
  expect(fam.body.recipientFirstName).toBe("Betty");
  const cg = await h.request.get(`/api/sessions/${t.sessionId}/cancel-fee`).set(h.auth(t.cg.token));
  expect(cg.body).toMatchObject({ canWaive: true, canDispute: false, viewer: "caregiver" });
});

test("dispute, then dispute again: 409, not an error", async () => {
  // v1.109.9 — the FIRST dispute also used to answer 500: notifyAdmins returned undefined and
  // the route called .catch on it after saving the row.
  const t = await pendingFee();
  const first = await dispute(t, t.family.token);
  expect(first.status).toBe(200);
  expect(first.body.status).toBe("disputed");
  expect(first.body.message).toMatch(/paused the charge/);
  const again = await dispute(t, t.family.token);
  expect(again.status).toBe(409);
  expect(again.body.status).toBe("disputed");
});

test("waive, then waive again: 409", async () => {
  const t = await pendingFee();
  expect((await waive(t, t.cg.token)).status).toBe(200);
  const again = await waive(t, t.cg.token);
  expect(again.status).toBe(409);
  expect(again.body.status).toBe("waived");
});

test("a settled-some-other-way fee is still a real 400", async () => {
  const t = await pendingFee();
  await db.prepare("UPDATE care_sessions SET cancel_fee_status = 'charged' WHERE id = ?").run(t.sessionId);
  expect((await dispute(t, t.family.token)).status).toBe(400);
  expect((await waive(t, t.cg.token)).status).toBe(400);
});

test("the caregiver cannot dispute, the family cannot waive", async () => {
  const t = await pendingFee();
  expect((await dispute(t, t.cg.token)).status).toBe(403);
  expect((await waive(t, t.family.token)).status).toBe(403);
});

test("a caregiver parked by a declined time change can still see and waive her fee", async () => {
  // The time-change branch sets caregiver_id = NULL and status 'open'.
  const t = await pendingFee({ status: "open", parkCaregiver: true });
  const cg = await h.request.get(`/api/sessions/${t.sessionId}/cancel-fee`).set(h.auth(t.cg.token));
  expect(cg.status).toBe(200);
  expect(cg.body.canWaive).toBe(true);
  expect((await waive(t, t.cg.token)).status).toBe(200);
});

describe("Needs you", () => {
  const { attentionItemsFor } = require("../../src/utils/attention");

  test("the family sees a counted cancelFee row that opens the sheet", async () => {
    const t = await pendingFee();
    const a = await attentionItemsFor(db, t.family.user.id);
    const row = a.items.find((i) => i.kind === "cancelFee");
    expect(row).toBeTruthy();
    expect(row.soft).toBeFalsy();
    expect(row.focus).toBe(`cancelFee:${t.sessionId}`);
    expect(row.action).toBeNull();
    expect(row.title).toMatch(/\$50\.00/);
    expect(a.cancelFees).toBe(1);
    expect(a.total).toBe(a.items.filter((i) => !i.soft).length);
  });

  test("the caregiver sees a soft one — silence pays her, so it is not on her icon", async () => {
    const t = await pendingFee();
    const a = await attentionItemsFor(db, t.cg.user.id);
    const row = a.items.find((i) => i.kind === "cancelFee");
    expect(row).toBeTruthy();
    expect(row.soft).toBe(true);
    expect(a.total).toBe(0);
  });

  test("it leaves the list once disputed", async () => {
    const t = await pendingFee();
    await dispute(t, t.family.token);
    const a = await attentionItemsFor(db, t.family.user.id);
    expect(a.items.find((i) => i.kind === "cancelFee")).toBeUndefined();
  });

  test("'Looks right' puts it away without touching the fee", async () => {
    const t = await pendingFee();
    const a = await attentionItemsFor(db, t.family.user.id);
    const row = a.items.find((i) => i.kind === "cancelFee");
    const res = await h.request.post(row.dismiss.path).set(h.auth(t.family.token)).send(row.dismiss.body);
    expect(res.status).toBe(200);
    const after = await attentionItemsFor(db, t.family.user.id);
    expect(after.items.find((i) => i.kind === "cancelFee")).toBeUndefined();
    const fee = await db.prepare("SELECT cancel_fee_status FROM care_sessions WHERE id = ?").get(t.sessionId);
    expect(fee.cancel_fee_status).toBe("pending");
  });
});
