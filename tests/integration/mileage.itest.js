/**
 * v1.126.1 — visit mileage, end to end against real PostgreSQL and the real router.
 *
 * Pete, 10/28: errand miles only, a family-set rate and cap, the caregiver never types a
 * number, miles past the cap wait for the leader, and the caregiver gets all of it.
 * No GOOGLE_MAPS_API_KEY here, so every distance is the labelled estimate.
 */
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "sk_test_integration_fake";
delete process.env.GOOGLE_MAPS_API_KEY;

const mockCreated = [];
const mockKeys = [];
const mockRetrieved = [];
let mockDeclineNext = 0;
jest.mock("stripe", () => jest.fn(() => ({
  paymentIntents: {
    create: jest.fn(async (args, opts) => {
      mockKeys.push(opts && opts.idempotencyKey);
      if (mockDeclineNext > 0) { mockDeclineNext--; const e = new Error("Your card was declined."); e.type = "StripeCardError"; e.code = "card_declined"; throw e; }
      mockCreated.push(args); return { id: `pi_mi_${mockCreated.length}`, status: "succeeded", amount: args.amount };
    }),
    retrieve: jest.fn(async (id) => { mockRetrieved.push(id); return { id, status: "succeeded", customer: id === "pi_autopay" ? "cus_billing" : "cus_fam", payment_method: "pm_card" }; }),
    capture: jest.fn(), cancel: jest.fn(),
  },
})));

const { v4: uuid } = require("uuid");
const { startHarness, stopHarness } = require("./harness");

jest.setTimeout(180000);

let h, db, mileage;
const pushes = [];
let leader, member, outsider, cg, recipientId, teamId, sid;

// Blacksburg-ish. CVS ~2 mi away, a store ~4 mi away (made-up points).
const HOME = { lat: 37.2296, lng: -80.4139 };
const CVS = { label: "CVS Pharmacy", address: "880 Main St", lat: 37.2560, lng: -80.4300 };
const FAR = { label: "Far Store", address: "1 Far Rd", lat: 37.3100, lng: -80.4700 };

beforeAll(async () => {
  const push = require("../../src/routes/push");
  push.sendPushToUser = async (userId, payload) => { pushes.push({ userId, type: payload?.data?.type, body: payload?.body }); return { sent: 1 }; };
  h = await startHarness({ routers: { "/api/mileage": "../../src/routes/mileage" } });
  db = h.db;
  mileage = require("../../src/utils/mileage");

  leader = await h.createUser({ firstName: "Lea" });
  member = await h.createUser({ firstName: "Mem" });
  outsider = await h.createUser({ firstName: "Out" });
  ({ recipientId, teamId } = await h.createCareTeam({ familyUserId: leader.user.id }));
  await h.addTeamMember(teamId, member.user.id, "member");
  await db.prepare("UPDATE care_recipients SET latitude = ?, longitude = ?, timezone = 'UTC' WHERE id = ?").run(HOME.lat, HOME.lng, recipientId);

  cg = await h.createUser({ roles: ["caregiver"], firstName: "Tina" });
  const profileId = uuid();
  await db.prepare(`
    INSERT INTO caregiver_profiles (id, user_id, hourly_rate, rate_daytime, is_background_checked,
      stripe_account_id, stripe_onboard_complete, identity_verified, created_at)
    VALUES (?, ?, 22, 22, 1, 'acct_tina', 1, 1, NOW())
  `).run(profileId, cg.user.id);
  sid = uuid();
  await db.prepare(`
    INSERT INTO care_sessions (id, care_recipient_id, family_user_id, caregiver_id, service_type, status,
      scheduled_date, scheduled_time, duration_hours, proposed_rate, estimated_cost, stripe_payment_intent_id, created_at)
    VALUES (?, ?, ?, ?, 'companionship', 'in_progress', '2026-10-29', '09:00', 4, 22, 88, 'pi_visit', NOW())
  `).run(sid, recipientId, leader.user.id, profileId);
});
afterAll(async () => { await stopHarness(h); });

const as = (u) => h.auth(u.token);

describe("settings", () => {
  test("off by default, readable by the team, not by a stranger", async () => {
    const r = await h.request.get(`/api/mileage/settings/${recipientId}`).set(as(member));
    expect(r.status).toBe(200);
    expect(r.body.settings).toMatchObject({ enabled: false, rateCents: 50, capMiles: 20, irsRateCents: 76, canEdit: false });
    expect(r.body.settings._row).toBeUndefined();
    expect((await h.request.get(`/api/mileage/settings/${recipientId}`).set(as(outsider))).status).toBe(404);
  });

  test("only the leader changes them; the rate stops at the IRS rate", async () => {
    expect((await h.request.put(`/api/mileage/settings/${recipientId}`).set(as(member)).send({ enabled: true })).status).toBe(403);
    expect((await h.request.put(`/api/mileage/settings/${recipientId}`).set(as(leader)).send({ enabled: true, rateCents: 90 })).status).toBe(400);
    const ok = await h.request.put(`/api/mileage/settings/${recipientId}`).set(as(leader)).send({ enabled: true, rateCents: 50, capMiles: 5 });
    expect(ok.status).toBe(200);
    expect(ok.body.settings).toMatchObject({ enabled: true, rateCents: 50, capMiles: 5, canEdit: true });
  });
});

describe("the calculator", () => {
  test("the caregiver gets a server-measured quote; nobody else can ask", async () => {
    const r = await h.request.post(`/api/mileage/sessions/${sid}/quote`).set(as(cg)).send({ from: "home", stops: [CVS], roundTrip: true });
    expect(r.status).toBe(200);
    expect(r.body.trip.source).toBe("estimate");
    expect(r.body.trip.miles).toBeGreaterThan(2);
    expect(r.body.trip.miles).toBeLessThan(8);
    expect(r.body.trip.cents).toBe(Math.round(r.body.trip.miles * 50));
    expect((await h.request.post(`/api/mileage/sessions/${sid}/quote`).set(as(leader)).send({ stops: [CVS] })).status).toBe(404);
    expect((await h.request.post(`/api/mileage/sessions/${sid}/quote`).set(as(outsider)).send({ stops: [CVS] })).status).toBe(404);
  });

  test("a trip needs a note, and a miles figure in the request is ignored", async () => {
    const noNote = await h.request.post(`/api/mileage/sessions/${sid}/trips`).set(as(cg)).send({ from: "home", stops: [CVS] });
    expect(noNote.status).toBe(400);
    const r = await h.request.post(`/api/mileage/sessions/${sid}/trips`).set(as(cg))
      .send({ from: "home", stops: [CVS], roundTrip: true, note: "Picked up a prescription", miles: 1, cents: 99999 });
    expect(r.status).toBe(201);
    expect(r.body.trip.miles).not.toBe(1);
    const row = await db.prepare("SELECT miles, distance_source, note FROM visit_trips WHERE id = ?").get(r.body.trip.id);
    expect(row.distance_source).toBe("estimate");
    expect(Number(row.miles)).toBe(r.body.trip.miles);
  });

  test("a far errand pushes the visit past the 5-mile cap", async () => {
    const r = await h.request.post(`/api/mileage/sessions/${sid}/trips`).set(as(cg))
      .send({ from: "home", stops: [FAR], roundTrip: true, note: "Book drop" });
    expect(r.status).toBe(201);
    expect(r.body.mileage.totalMiles).toBeGreaterThan(5);
    expect(r.body.mileage.paidMiles).toBe(5);
    expect(r.body.mileage.cents).toBe(250);
  });

  test("the family sees trips without stop coordinates", async () => {
    const r = await h.request.get(`/api/mileage/sessions/${sid}`).set(as(member));
    expect(r.status).toBe(200);
    expect(r.body.mileage.trips).toHaveLength(2);
    expect(r.body.mileage.trips[0].stops[0]).toEqual({ label: "CVS Pharmacy", address: "880 Main St" });
    expect(r.body.mileage.canLog).toBe(false);
  });
});

describe("check-out, charging, and the extra", () => {
  test("lock splits at the cap and tells the leader about the extra", async () => {
    const out = await mileage.lockForSession(db, sid);
    expect(out.paidMiles).toBe(5);
    expect(out.status).toBe("owed");
    expect(out.extraStatus).toBe("pending");
    expect(pushes.some((p) => p.userId === leader.user.id && p.type === "mileage_extra")).toBe(true);
    expect(await mileage.lockForSession(db, sid)).toBeNull(); // idempotent
    const late = await h.request.post(`/api/mileage/sessions/${sid}/trips`).set(as(cg)).send({ from: "home", stops: [CVS], note: "Late one" });
    expect(late.status).toBe(400);
  });

  test("nothing is charged until the visit itself is paid", async () => {
    const r = await mileage.settleSession(db, sid);
    expect(r.paid.skipped).toBe("visit not paid yet");
    expect(mockCreated).toHaveLength(0);
  });

  test("once paid: one charge to the visit's card, all of it to the caregiver, fee = card cost only", async () => {
    await db.prepare("UPDATE care_sessions SET payment_status = 'paid' WHERE id = ?").run(sid);
    const r = await mileage.settleSession(db, sid);
    expect(r.paid.charged).toBe(true);
    expect(mockCreated).toHaveLength(1);
    const c = mockCreated[0];
    expect(c.transfer_data).toEqual({ destination: "acct_tina" });
    expect(c.customer).toBe("cus_fam");
    expect(c.amount - c.application_fee_amount).toBe(250); // the caregiver receives exactly the mileage
    expect(c.amount).toBe(Math.ceil((250 + 30) / (1 - 0.029)));
    const s = await db.prepare("SELECT mileage_status, mileage_pi FROM care_sessions WHERE id = ?").get(sid);
    expect(s.mileage_status).toBe("charged");
    const led = await db.prepare("SELECT kind, caregiver_cents, platform_cents FROM ledger_entries WHERE stripe_payment_intent = ?").get(s.mileage_pi);
    expect(led).toMatchObject({ kind: "mileage", caregiver_cents: 250, platform_cents: 0 });
    // A second settle (the poller) charges nothing more.
    await mileage.settleSession(db, sid);
    expect(mockCreated).toHaveLength(1);
  });

  test("only the leader decides the extra; approving charges it", async () => {
    expect((await h.request.post(`/api/mileage/sessions/${sid}/extra`).set(as(member)).send({ approve: true })).status).toBe(403);
    const r = await h.request.post(`/api/mileage/sessions/${sid}/extra`).set(as(leader)).send({ approve: true });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("approved");
    expect(r.body.charge.charged).toBe(true);
    expect(r.body.mileage.extraStatus).toBe("charged");
    expect(mockCreated).toHaveLength(2);
    expect(mockCreated[1].metadata.type).toBe("session_mileage_extra");
    expect(pushes.some((p) => p.userId === cg.user.id && p.type === "mileage_extra_decided")).toBe(true);
    expect((await h.request.post(`/api/mileage/sessions/${sid}/extra`).set(as(leader)).send({ approve: true })).status).toBe(400);
  });
});

describe("review fixes (v1.126.2)", () => {
  async function lockedVisit() {
    const id = uuid();
    await db.prepare(`
      INSERT INTO care_sessions (id, care_recipient_id, family_user_id, caregiver_id, service_type, status,
        scheduled_date, scheduled_time, duration_hours, proposed_rate, estimated_cost, stripe_payment_intent_id, payment_status, created_at)
      SELECT ?, care_recipient_id, family_user_id, caregiver_id, 'companionship', 'completed', '2026-10-29', '09:00', 4, 22, 88, 'pi_old_hold', 'paid', NOW()
        FROM care_sessions WHERE id = ?
    `).run(id, sid);
    await db.prepare(`
      INSERT INTO visit_trips (id, session_id, care_recipient_id, caregiver_user_id, start_kind, start_label, stops, round_trip, miles, distance_source, note, rate_cents)
      VALUES (?, ?, ?, ?, 'home', 'Home', '[]', 1, 3, 'estimate', 'Errand', 50)
    `).run(uuid(), id, recipientId, cg.user.id);
    return id;
  }

  test("the charge goes on the card that actually paid the visit (auto-pay after a lapsed hold)", async () => {
    const id = await lockedVisit();
    await mileage.lockForSession(db, id);
    await db.prepare(`INSERT INTO ledger_entries (id, session_id, kind, status, family_cents, stripe_payment_intent) VALUES (?, ?, 'autopay', 'succeeded', 10560, 'pi_autopay')`).run(uuid(), id);
    mockRetrieved.length = 0;
    const r = await mileage.chargeMileage(db, id, "paid");
    expect(r.charged).toBe(true);
    expect(mockRetrieved).toEqual(["pi_autopay"]);
    expect(mockCreated[mockCreated.length - 1].customer).toBe("cus_billing");
  });

  test("a decline waits, then retries on a NEW idempotency key; the extra has its own counter", async () => {
    const id = await lockedVisit();
    await mileage.lockForSession(db, id);
    mockDeclineNext = 1; mockKeys.length = 0;
    const first = await mileage.chargeMileage(db, id, "paid");
    expect(first.error).toMatch(/declined/);
    let s = await db.prepare("SELECT mileage_status, mileage_attempts, mileage_declines, mileage_extra_attempts, mileage_next_try_at FROM care_sessions WHERE id = ?").get(id);
    expect(s).toMatchObject({ mileage_status: "owed", mileage_attempts: 1, mileage_declines: 1, mileage_extra_attempts: 0 });
    expect(new Date(s.mileage_next_try_at).getTime()).toBeGreaterThan(Date.now() + 5 * 3600e3);
    // The sweep leaves it alone until then.
    const before = mockKeys.length;
    await mileage.sweepOwed(db);
    expect(mockKeys.length).toBe(before);
    // Time passes.
    await db.prepare("UPDATE care_sessions SET mileage_next_try_at = NOW() - INTERVAL '1 minute' WHERE id = ?").run(id);
    await mileage.sweepOwed(db);
    s = await db.prepare("SELECT mileage_status FROM care_sessions WHERE id = ?").get(id);
    expect(s.mileage_status).toBe("charged");
    expect(mockKeys[0]).toMatch(/_d0$/);
    expect(mockKeys[mockKeys.length - 1]).toMatch(/_d1$/);
  });

  test("a completed visit that skipped check-out still gets its trips locked by the sweep", async () => {
    const id = await lockedVisit();
    await mileage.sweepOwed(db);
    const s = await db.prepare("SELECT mileage_locked_at, mileage_cap_miles FROM care_sessions WHERE id = ?").get(id);
    expect(s.mileage_locked_at).toBeTruthy();
    expect(Number(s.mileage_cap_miles)).toBe(5);
  });

  test("'Use my location' far from the home is refused", async () => {
    const v = uuid();
    await db.prepare(`
      INSERT INTO care_sessions (id, care_recipient_id, family_user_id, caregiver_id, service_type, status,
        scheduled_date, scheduled_time, duration_hours, proposed_rate, estimated_cost, created_at)
      SELECT ?, care_recipient_id, family_user_id, caregiver_id, 'companionship', 'in_progress', '2026-10-30', '09:00', 4, 22, 88, NOW()
        FROM care_sessions WHERE id = ?
    `).run(v, sid);
    const r = await h.request.post(`/api/mileage/sessions/${v}/quote`).set(as(cg))
      .send({ from: "here", here: { lat: 38.03, lng: -78.48 }, stops: [CVS] }); // ~100 mi away
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("here_too_far");
  });
});

describe("pure arithmetic", () => {
  test("splitAtCap", () => {
    expect(mileage.splitAtCap(23.4, 20, 50)).toEqual({ totalMiles: 23.4, paidMiles: 20, extraMiles: 3.4, cents: 1000, extraCents: 170 });
    expect(mileage.splitAtCap(4.8, 20, 50)).toEqual({ totalMiles: 4.8, paidMiles: 4.8, extraMiles: 0, cents: 240, extraCents: 0 });
  });
  test("rates outside 10–76¢ are refused", () => {
    expect(mileage.clampRate(9)).toBeNull();
    expect(mileage.clampRate(77)).toBeNull();
    expect(mileage.clampRate(76)).toBe(76);
  });
});
