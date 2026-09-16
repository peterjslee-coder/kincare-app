/**
 * v1.107.7 — what was agreed is what is held, paid and shown.
 *
 * Accepting an offer set agreed_rate and left estimated_cost at the first quote; accepting a
 * time change moved duration_hours and left estimated_cost at the old length. estimated_cost
 * is what the hold, the capture and the caregiver's pay card read first, so both were paid
 * and shown at the wrong number. Pete: "Time x rate agreed in the offer accepted =
 * caregiver pay."
 */
const { v4: uuid } = require("uuid");
const { startHarness, stopHarness } = require("./harness");

jest.setTimeout(180000);

let h, db;

beforeAll(async () => {
  h = await startHarness({ routers: {
    "/api/sessions": ["../../src/routes/offers", "../../src/routes/sessions"],
  } });
  db = h.db;
});
afterAll(async () => { await stopHarness(h); });

async function visit({ estimated, hours, surcharge = 0, agreed = null, status = "pending" }) {
  const family = await h.createUser({ firstName: "Sara", roles: ["family"] });
  const { recipientId } = await h.createCareTeam({ familyUserId: family.user.id });
  const cg = await h.createUser({ firstName: "Tina", roles: ["caregiver"] });
  const pid = uuid();
  await db.prepare("INSERT INTO caregiver_profiles (id, user_id, hourly_rate, created_at) VALUES (?, ?, 24, NOW())").run(pid, cg.user.id);
  const sid = uuid();
  await db.prepare(`
    INSERT INTO care_sessions (id, care_recipient_id, family_user_id, caregiver_id, service_type, status,
      scheduled_date, scheduled_time, duration_hours, estimated_cost, short_notice_surcharge, agreed_rate, created_at)
    VALUES (?, ?, ?, ?, 'companion', ?, '2030-01-15', '09:00', ?, ?, ?, ?, NOW())
  `).run(sid, recipientId, family.user.id, pid, status, hours, estimated, surcharge, agreed);
  return { family, cg, sid };
}
const row = (sid) => db.prepare("SELECT estimated_cost, agreed_rate, duration_hours, status FROM care_sessions WHERE id = ?").get(sid);

describe("accepting an offer", () => {
  test("$22 accepted on an 8-hour visit quoted at $24 makes the price $176", async () => {
    const { family, cg, sid } = await visit({ estimated: 192, hours: 8 });
    const oid = uuid();
    await db.prepare(`
      INSERT INTO session_offers (id, session_id, from_user_id, to_user_id, offered_rate, status, round_number, expires_at)
      VALUES (?, ?, ?, ?, 22, 'pending', 1, NOW() + INTERVAL '1 day')
    `).run(oid, sid, cg.user.id, family.user.id);
    const res = await h.request.put(`/api/sessions/${sid}/offers/${oid}/respond`).set(h.auth(family.token)).send({ action: "accept" });
    expect(res.status).toBe(200);
    const r = await row(sid);
    expect(Number(r.estimated_cost)).toBeCloseTo(176, 2);
    expect(Number(r.agreed_rate)).toBeCloseTo(22, 2);
    expect(r.status).toBe("confirmed");
    const again = await h.request.put(`/api/sessions/${sid}/offers/${oid}/respond`).set(h.auth(family.token)).send({ action: "accept" });
    expect(again.status).toBeGreaterThanOrEqual(400);
  });

  test("a short-notice amount already on the booking is kept", async () => {
    const { family, cg, sid } = await visit({ estimated: 110, hours: 4, surcharge: 10 });
    const oid = uuid();
    await db.prepare(`
      INSERT INTO session_offers (id, session_id, from_user_id, to_user_id, offered_rate, status, round_number, expires_at)
      VALUES (?, ?, ?, ?, 30, 'pending', 1, NOW() + INTERVAL '1 day')
    `).run(oid, sid, family.user.id, cg.user.id);
    const res = await h.request.put(`/api/sessions/${sid}/offers/${oid}/respond`).set(h.auth(cg.token)).send({ action: "accept" });
    expect(res.status).toBe(200);
    expect(Number((await row(sid)).estimated_cost)).toBeCloseTo(130, 2);
  });

  test("rejecting leaves the price alone", async () => {
    const { family, cg, sid } = await visit({ estimated: 192, hours: 8 });
    const oid = uuid();
    await db.prepare(`
      INSERT INTO session_offers (id, session_id, from_user_id, to_user_id, offered_rate, status, round_number, expires_at)
      VALUES (?, ?, ?, ?, 22, 'pending', 1, NOW() + INTERVAL '1 day')
    `).run(oid, sid, cg.user.id, family.user.id);
    await h.request.put(`/api/sessions/${sid}/offers/${oid}/respond`).set(h.auth(family.token)).send({ action: "reject" });
    expect(Number((await row(sid)).estimated_cost)).toBeCloseTo(192, 2);
  });
});

describe("accepting a bid on an open job", () => {
  async function openJob() {
    const family = await h.createUser({ firstName: "Sara", roles: ["family"] });
    const { recipientId } = await h.createCareTeam({ familyUserId: family.user.id });
    const sid = uuid();
    await db.prepare(`
      INSERT INTO care_sessions (id, care_recipient_id, family_user_id, service_type, status,
        scheduled_date, scheduled_time, duration_hours, estimated_cost, created_at)
      VALUES (?, ?, ?, 'companion', 'open', '2030-01-15', '09:00', 8, 192, NOW())
    `).run(sid, recipientId, family.user.id);
    return { family, sid };
  }
  async function bidder(checked) {
    const cg = await h.createUser({ firstName: "Bid", roles: ["caregiver"] });
    const pid = uuid();
    await db.prepare("INSERT INTO caregiver_profiles (id, user_id, hourly_rate, is_background_checked, created_at) VALUES (?, ?, 24, ?, NOW())").run(pid, cg.user.id, checked);
    return { cg, pid };
  }
  async function bid(sid, from, to) {
    const oid = uuid();
    await db.prepare(`
      INSERT INTO session_offers (id, session_id, from_user_id, to_user_id, offered_rate, status, round_number, expires_at)
      VALUES (?, ?, ?, ?, 22, 'pending', 1, NOW() + INTERVAL '1 day')
    `).run(oid, sid, from, to);
    return oid;
  }

  test("the cleared bidder is put on the visit, at her price", async () => {
    const { family, sid } = await openJob();
    const { cg, pid } = await bidder(1);
    const oid = await bid(sid, cg.user.id, family.user.id);
    const res = await h.request.put(`/api/sessions/${sid}/offers/${oid}/respond`).set(h.auth(family.token)).send({ action: "accept" });
    expect(res.status).toBe(200);
    const r = await db.prepare("SELECT caregiver_id, status, estimated_cost FROM care_sessions WHERE id = ?").get(sid);
    expect(r.caregiver_id).toBe(pid);
    expect(r.status).toBe("confirmed");
    expect(Number(r.estimated_cost)).toBeCloseTo(176, 2);
  });

  test("a bidder who is no longer cleared is refused, and nothing changes", async () => {
    const { family, sid } = await openJob();
    const { cg } = await bidder(0);
    const oid = await bid(sid, cg.user.id, family.user.id);
    const res = await h.request.put(`/api/sessions/${sid}/offers/${oid}/respond`).set(h.auth(family.token)).send({ action: "accept" });
    expect(res.status).toBe(409);
    const r = await db.prepare("SELECT caregiver_id, status FROM care_sessions WHERE id = ?").get(sid);
    expect(r.caregiver_id).toBeNull();
    expect(r.status).toBe("open");
    expect((await db.prepare("SELECT status FROM session_offers WHERE id = ?").get(oid)).status).toBe("pending");
  });

  test("a second bid accepted after the job is taken is refused and stays pending", async () => {
    const { family, sid } = await openJob();
    const a = await bidder(1);
    const b = await bidder(1);
    const oa = await bid(sid, a.cg.user.id, family.user.id);
    const ob = uuid();
    await db.prepare(`
      INSERT INTO session_offers (id, session_id, from_user_id, to_user_id, offered_rate, status, round_number, expires_at)
      VALUES (?, ?, ?, ?, 20, 'pending', 1, NOW() + INTERVAL '1 day')
    `).run(ob, sid, b.cg.user.id, family.user.id);
    expect((await h.request.put(`/api/sessions/${sid}/offers/${oa}/respond`).set(h.auth(family.token)).send({ action: "accept" })).status).toBe(200);
    const second = await h.request.put(`/api/sessions/${sid}/offers/${ob}/respond`).set(h.auth(family.token)).send({ action: "accept" });
    expect(second.status).toBe(409);
    const r = await db.prepare("SELECT caregiver_id, agreed_rate FROM care_sessions WHERE id = ?").get(sid);
    expect(r.caregiver_id).toBe(a.pid);
    expect(Number(r.agreed_rate)).toBeCloseTo(22, 2);
    expect((await db.prepare("SELECT status FROM session_offers WHERE id = ?").get(ob)).status).toBe("pending");
  });
});

describe("accepting a time change", () => {
  async function proposeAndAccept({ estimated, hours, surcharge, agreed, newHours }) {
    const v = await visit({ estimated, hours, surcharge, agreed, status: "confirmed" });
    const pid = uuid();
    await db.prepare(`
      INSERT INTO time_change_proposals (id, session_id, proposed_by, proposed_by_user_id,
        original_time, original_duration, proposed_time, proposed_duration, status, created_at, expires_at)
      VALUES (?, ?, 'caregiver', ?, '09:00', ?, '10:00', ?, 'pending', NOW(), NOW() + INTERVAL '2 hours')
    `).run(pid, v.sid, v.cg.user.id, hours, newHours);
    await db.prepare("UPDATE care_sessions SET pending_time_change_id = ? WHERE id = ?").run(pid, v.sid);
    const res = await h.request.put(`/api/sessions/${v.sid}/time-change/${pid}/respond`).set(h.auth(v.family.token)).send({ action: "accept" });
    expect(res.status).toBe(200);
    return row(v.sid);
  }

  test("8h at an agreed $22 shortened to 6h is $132", async () => {
    const r = await proposeAndAccept({ estimated: 176, hours: 8, surcharge: 0, agreed: 22, newHours: 6 });
    expect(Number(r.duration_hours)).toBeCloseTo(6, 2);
    expect(Number(r.estimated_cost)).toBeCloseTo(132, 2);
  });

  test("no agreed rate: the booking's own hourly, and the short-notice amount stays", async () => {
    const r = await proposeAndAccept({ estimated: 110, hours: 4, surcharge: 10, agreed: null, newHours: 2 });
    expect(Number(r.estimated_cost)).toBeCloseTo(60, 2);
  });
});
