/**
 * v1.166.1 — Admin → Sessions, one caregiver at a time, with what each visit paid her.
 *
 * Pete, 11/27: Faith asked whether $76.56 was right for her first visit, and the sessions list
 * had no way to show only her visits or what any of them paid. Money comes from the ledger (a
 * visit settled by capturing its hold never writes a payments row), else legacy payments.
 */
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "sk_test_integration_fake";

const { startHarness, stopHarness } = require("./harness");
const { v4: uuid } = require("uuid");

jest.setTimeout(180000);

let h, db, admin;

const today = () => new Date().toISOString().slice(0, 10);

async function caregiver(name) {
  const cg = await h.createUser({ firstName: name, lastName: "Cg", roles: ["caregiver"] });
  const profileId = uuid();
  await db.prepare(`INSERT INTO caregiver_profiles (id, user_id, hourly_rate, created_at) VALUES (?, ?, 22, NOW())`)
    .run(profileId, cg.user.id);
  return profileId;
}

async function visit(fam, recipientId, profileId, surcharge = 0) {
  const id = uuid();
  await db.prepare(`
    INSERT INTO care_sessions (id, care_recipient_id, family_user_id, caregiver_id, service_type, status,
      scheduled_date, scheduled_time, duration_hours, proposed_rate, estimated_cost, short_notice_surcharge,
      payment_status, created_at)
    VALUES (?, ?, ?, ?, 'companionship', 'completed', ?, '17:00', 3, 22, ?, ?, 'paid', NOW())
  `).run(id, recipientId, fam.user.id, profileId, today(), 66 + surcharge, surcharge);
  return id;
}

beforeAll(async () => {
  h = await startHarness({ routers: { "/api/admin": "../../src/routes/admin" } });
  db = h.db;
  admin = await h.createUser({ firstName: "Ad", lastName: "Min", isAdmin: true });
  await db.prepare("UPDATE users SET is_admin = 1 WHERE id = ?").run(admin.user.id);
  const probe = await h.request.get("/api/admin/overview").set(h.auth(admin.token));
  const ip = (probe.body && probe.body.ip) || "::ffff:127.0.0.1";
  await require("../../src/utils/trustedIps").registerTrustedIp(admin.user.id, ip, { verifiedVia: "itest" });
});
afterAll(async () => { await stopHarness(h); });

test("filters to one caregiver and shows what each visit paid her", async () => {
  const fam = await h.createUser({ firstName: "Fam", lastName: "Ily" });
  const { recipientId } = await h.createCareTeam({ familyUserId: fam.user.id });
  const faith = await caregiver("Faithy");
  const tina = await caregiver("Tinay");

  const rush = await visit(fam, recipientId, faith, 13.2);
  await db.prepare(`
    INSERT INTO ledger_entries (id, session_id, care_recipient_id, kind, status, family_user_id, caregiver_id,
      family_cents, caregiver_cents, platform_cents)
    VALUES (?, ?, ?, 'capture', 'succeeded', ?, ?, 10269, 7656, 2613)
  `).run(uuid(), rush, recipientId, fam.user.id, faith);
  const legacy = await visit(fam, recipientId, faith);
  await db.prepare(`
    INSERT INTO payments (id, session_id, family_user_id, caregiver_id, amount, platform_fee, caregiver_payout, status)
    VALUES (?, ?, ?, ?, 79.2, 13.2, 66, 'completed')
  `).run(uuid(), legacy, fam.user.id, faith);
  await visit(fam, recipientId, tina);

  const all = await h.request.get("/api/admin/sessions/all?status=all&days=30").set(h.auth(admin.token));
  expect(all.status).toBe(200);
  const names = all.body.caregivers.map(c => c.name);
  expect(names).toEqual(expect.arrayContaining(["Faithy Cg", "Tinay Cg"]));
  expect(all.body.caregivers.find(c => c.id === faith).count).toBe(2);

  const res = await h.request.get(`/api/admin/sessions/all?status=all&days=30&caregiverId=${faith}`).set(h.auth(admin.token));
  expect(res.status).toBe(200);
  expect(res.body.sessions).toHaveLength(2);
  expect(res.body.sessions.every(s => s.caregiver_id === faith)).toBe(true);
  const byId = Object.fromEntries(res.body.sessions.map(s => [s.id, s]));
  expect(Number(byId[rush].caregiver_paid)).toBeCloseTo(76.56, 2);
  expect(Number(byId[rush].family_charged)).toBeCloseTo(102.69, 2);
  expect(Number(byId[rush].short_notice_surcharge)).toBeCloseTo(13.2, 2);
  expect(Number(byId[legacy].caregiver_paid)).toBeCloseTo(66, 2);
  // the picker still lists everyone while one caregiver is selected
  expect(res.body.caregivers.length).toBeGreaterThanOrEqual(2);
});
