/**
 * v1.125.0 — the outreach progress ladder, end to end against a real Postgres.
 *
 * Pete, 10/26: "see steps along the way and how far they made it ... all the way to signup".
 * Every step comes from data the app already records; these tests write that data the way the
 * app does and check the ladder reads it back — gaps included, nothing back-filled.
 */
jest.mock("../../src/utils/sms", () => {
  const actual = jest.requireActual("../../src/utils/sms");
  return { ...actual, outreachNumber: () => "+15405550100", sendSms: jest.fn(async () => ({ success: true, sid: "SMx", status: "queued" })) };
});
jest.mock("../../src/routes/push", () => ({
  notifyAdmins: jest.fn(async () => {}),
  sendPushToAdmins: jest.fn(async () => {}),
}));
const { v4: uuid } = require("uuid");
const P = require("../../src/utils/outreachProgress");
const { startHarness, stopHarness } = require("./harness");
jest.setTimeout(180000);

let h, db, admin;
beforeAll(async () => {
  h = await startHarness({ routers: { "/api/admin/outreach": "../../src/routes/outreach", "/api/admin": "../../src/routes/admin" } });
  db = h.db;
  admin = await h.createUser({ firstName: "Ad", lastName: "Min", isAdmin: true });
  await db.prepare("UPDATE users SET is_admin = 1 WHERE id = ?").run(admin.user.id);
});
afterAll(async () => { await stopHarness(h); });

const A = () => h.auth(admin.token);
const ago = (days) => new Date(Date.now() - days * 86400000).toISOString();

async function contact(phone, extra = {}) {
  const id = uuid();
  await db.prepare(`
    INSERT INTO outreach_contacts (id, first_name, last_name, phone, status, texts_ok_at, opted_out_at, created_at, updated_at)
    VALUES (?, ?, 'Ladder', ?, ?, ?, ?, NOW(), NOW())
  `).run(id, extra.first || "Pat", phone, extra.status || "new", extra.textsOkAt || null, extra.optedOutAt || null);
  return id;
}
const msg = (cid, dir, kind, body, at, status = "delivered") => db.prepare(`
  INSERT INTO outreach_messages (id, contact_id, direction, body, status, kind, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
`).run(uuid(), cid, dir, body, status, kind, at);
async function link(cid) {
  const code = `L${Math.random().toString(36).slice(2, 8)}`;
  await db.prepare("INSERT INTO track_links (code, kind, audience, outreach_contact_id, created_at) VALUES (?, 'outreach', 'caregiver', ?, NOW())").run(code, cid);
  return code;
}
const visit = (vid, kind, extra) => db.prepare(`
  INSERT INTO visit_events (visitor_id, session_id, user_id, kind, page, ms, link_code, created_at)
  VALUES (?, 's1', ?, ?, ?, ?, ?, ?)
`).run(vid, extra.userId || null, kind, extra.page || null, extra.ms || null, extra.code || null, extra.at);

const list = async () => (await h.request.get("/api/admin/outreach").set(A())).body;
const step = (p, key) => p.steps.find((s) => s.key === key);

test("a contact nobody has reached is 'Not started', with no stall clock", async () => {
  const id = await contact("5405550301");
  const p = (await P.progressFor(db, [{ id }])).get(id);
  expect(p.furthest).toBeNull();
  expect(p.furthestLabel).toBe("Not started");
  expect(p.stalledDays).toBeNull();
  expect(p.next).toBe("Called");
});

test("called → JOIN → link → opened → read the caregiver page → started sign-up, each dated", async () => {
  const id = await contact("5405550302", { textsOkAt: ago(9) });
  await msg(id, "out", "call", "Call", ago(10), "completed");
  await msg(id, "out", "sms", "Hi Pat ... yourinplace.com/i/AbC123 ... Reply STOP to opt out.", ago(9));
  await msg(id, "out", "sms", "an earlier text that failed yourinplace.com/i/zzz", ago(12), "failed");
  const code = await link(id);
  const vid = uuid();
  await db.prepare("INSERT INTO visitors (id, first_link_code, first_seen_at) VALUES (?, ?, ?)").run(vid, code, ago(8));
  await visit(vid, "start", { code, at: ago(8) });
  await visit(vid, "page", { page: "land-caregiver", ms: 4 * 60000, at: ago(8) });
  await visit(vid, "page", { page: "splash", ms: 60000, at: ago(8) });
  await visit(vid, "page", { page: "register", ms: 30000, at: ago(7) });

  const p = (await P.progressFor(db, [{ id, texts_ok_at: ago(9) }])).get(id);
  for (const k of ["called", "texted_join", "link_sent", "link_opened", "read_page", "started"]) expect(step(p, k).done).toBe(true);
  expect(step(p, "account").done).toBe(false);
  // The failed text two days earlier is not when they got the link.
  expect(new Date(step(p, "link_sent").at).getTime()).toBeGreaterThan(new Date(ago(9.5)).getTime());
  expect(step(p, "read_page").ms).toBe(5 * 60000);
  expect(p.furthest).toBe("started");
  expect(p.next).toBe("Created an account");
  expect(p.stalledDays).toBe(7);
});

test("gaps stay gaps: met in person, never texted JOIN, signed up anyway", async () => {
  const id = await contact("5405550303");
  const u = await h.createUser({ firstName: "Gap", lastName: "Ladder", roles: ["caregiver"], idVerified: false });
  await db.prepare("UPDATE users SET phone = '540-555-0303', created_at = ? WHERE id = ?").run(ago(3), u.user.id);
  const { contacts } = await list();
  const p = contacts.find((c) => c.id === id).progress;
  expect(step(p, "account").done).toBe(true);
  expect(step(p, "started").done).toBe(true); // implied by the account, undated
  expect(step(p, "started").at).toBeNull();
  expect(step(p, "texted_join").done).toBe(false);
  expect(step(p, "called").done).toBe(false);
  expect(p.furthest).toBe("account");
  expect(p.stalledDays).toBe(3);
});

test("after sign-up: ID, background check, payouts and first paid visit", async () => {
  const id = await contact("5405550304", { textsOkAt: ago(20) });
  const u = await h.createUser({ firstName: "Full", lastName: "Ladder", roles: ["caregiver"], idVerified: false });
  const uid = u.user.id;
  await db.prepare("UPDATE users SET phone = '+15405550304', created_at = ? WHERE id = ?").run(ago(15), uid);
  await db.prepare(`
    INSERT INTO verified_documents (id, owner_id, owner_type, uploaded_by, category, document_type, file_data, status, is_verified, verified_at, created_at)
    VALUES (?, ?, 'user', ?, 'identity', 'ID_Front', '', 'approved', 1, ?, ?)
  `).run(uuid(), uid, uid, ago(12), ago(14));
  const cpId = uuid();
  await db.prepare(`
    INSERT INTO caregiver_profiles (id, user_id, hourly_rate, checkr_status, is_background_checked, background_check_consent_at, stripe_onboard_complete)
    VALUES (?, ?, 25, 'clear', 1, ?, 1)
  `).run(cpId, uid, ago(11));
  const fam = await h.createUser({ firstName: "Fam", lastName: "Ily" });
  const { recipientId } = await h.createCareTeam({ familyUserId: fam.user.id });
  const sid = uuid();
  await db.prepare(`INSERT INTO care_sessions (id, care_recipient_id, family_user_id, caregiver_id, service_type, status, scheduled_date, scheduled_time)
                    VALUES (?, ?, ?, ?, 'companionship', 'completed', '2026-10-20', '09:00')`).run(sid, recipientId, fam.user.id, cpId);
  await db.prepare(`INSERT INTO payments (id, session_id, family_user_id, caregiver_id, amount, platform_fee, caregiver_payout, status, created_at)
                    VALUES (?, ?, ?, ?, 120, 20, 100, 'completed', ?)`).run(uuid(), sid, fam.user.id, cpId, ago(2));

  const p = (await P.progressFor(db, [{ id, texts_ok_at: ago(20), joined_user_id: uid }])).get(id);
  for (const k of ["account", "id_sent", "id_ok", "bg_started", "bg_clear", "payouts", "first_visit"]) expect(step(p, k).done).toBe(true);
  expect(step(p, "payouts").at).toBeNull(); // no timestamp exists for this fact
  expect(p.furthest).toBe("first_visit");
  expect(p.next).toBeNull();
  expect(p.stalledDays).toBeNull(); // finished
});

test("a background check that needs Pete is flagged; ID seen in person counts as approved", async () => {
  const id = await contact("5405550305");
  const u = await h.createUser({ firstName: "Flag", lastName: "Ladder", roles: ["caregiver"], idVerified: false });
  await db.prepare("UPDATE users SET phone = '5405550305', id_verified_in_person_at = NOW() WHERE id = ?").run(u.user.id);
  await db.prepare(`INSERT INTO caregiver_profiles (id, user_id, hourly_rate, checkr_status, is_background_checked)
                    VALUES (?, ?, 25, 'consider', 0)`).run(uuid(), u.user.id);
  const p = (await P.progressFor(db, [{ id, joined_user_id: u.user.id }])).get(id);
  expect(step(p, "id_ok").done).toBe(true);
  expect(step(p, "id_ok").inPerson).toBe(true);
  expect(step(p, "bg_started").done).toBe(true);
  expect(step(p, "bg_clear").done).toBe(false);
  expect(p.flag).toBe("bg_under_review");
});

test("opted out: flagged, and no stall clock nagging about someone who said STOP", async () => {
  const id = await contact("5405550306", { textsOkAt: ago(5), optedOutAt: ago(4), status: "opted_out" });
  const p = (await P.progressFor(db, [{ id, texts_ok_at: ago(5), opted_out_at: ago(4), status: "opted_out" }])).get(id);
  expect(p.flag).toBe("opted_out");
  expect(p.stalledDays).toBeNull();
});

test("the list carries a funnel that counts everyone who reached each step", async () => {
  const body = await list();
  expect(Array.isArray(body.funnel)).toBe(true);
  expect(body.funnel.map((f) => f.key)).toEqual(P.STEP_KEYS);
  const f = Object.fromEntries(body.funnel.map((x) => [x.key, x.count]));
  expect(f.account).toBeGreaterThanOrEqual(2);
  expect(f.called).toBeGreaterThanOrEqual(1);
  // A funnel only narrows step to step for people who did both; it is counts, not a chain.
  expect(f.first_visit).toBeLessThanOrEqual(f.account);
});

test("the thread endpoint returns the same ladder", async () => {
  const { contacts } = await list();
  const c = contacts.find((x) => x.phone === "5405550302");
  const r = await h.request.get(`/api/admin/outreach/${c.id}/messages`).set(A());
  expect(r.status).toBe(200);
  expect(r.body.progress.furthest).toBe("started");
});

test("texting someone with no OK explains both ways to get one", async () => {
  // v1.125.3 — the call-recording OK is back, as Pete's recorded override (outreachConsentOverride.itest.js).
  const id = await contact("5405550307");
  const r = await h.request.post(`/api/admin/outreach/${id}/messages`).set(A()).send({ body: "hi Reply STOP to opt out" });
  expect(r.status).toBe(400);
  expect(r.body.error).toMatch(/JOIN/);
  expect(r.body.error).toMatch(/Record OK from the call/);
});
