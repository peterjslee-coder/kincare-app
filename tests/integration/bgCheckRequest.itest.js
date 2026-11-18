/**
 * v1.132.0 — ask → an admin approves → Checkr's form. No $30 up front.
 *
 * Pete, 11/18: "I want this roadblock to instead be a needs you card for Admin where I approve
 * them to go get a background check. I don't want them to pay the $30 upfront." And: agreeing in
 * onboarding should be the ask.
 *
 * Runs the real routes and the real Needs-you query against the real schema:
 *   1. saving the onboarding profile with consent records a request — no payment anywhere
 *   2. the request appears in the ADMIN's Needs you, with one-tap Approve; not in anyone else's
 *   3. the caregiver cannot send herself to Checkr before approval
 *   4. Approve creates the Checkr invitation (with her details), records the approval, and the
 *      card goes away
 *   5. a caregiver missing what Checkr requires gets a card with no one-tap approve
 */
const express = require("express");
const supertest = require("supertest");
const { startHarness, stopHarness } = require("./harness");
const { v4: uuid } = require("uuid");

jest.setTimeout(180000);

let h, db, req;
const realFetch = global.fetch;
const calls = [];

beforeAll(async () => {
  process.env.CHECKR_API_KEY = "test_key_bg_request";
  delete process.env.CHECKR_STAGING;
  delete process.env.CHECKR_PACKAGE;
  h = await startHarness({ routers: {} });
  db = h.db;
  const app = express();
  app.use(express.json());
  app.use("/api/checkr", require("../../src/routes/checkr"));
  app.use("/api/caregivers", require("../../src/routes/caregivers"));
  req = supertest(app);
  await db.prepare(
    "INSERT INTO platform_settings (key, value) VALUES ('bg_checks_enabled', 'true') ON CONFLICT (key) DO UPDATE SET value = 'true'"
  ).run();
  global.fetch = jest.fn(async (url, opts = {}) => {
    const u = String(url);
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ url: u, method: opts.method, body });
    const json = (o, status = 200) => ({ ok: status < 300, status, json: async () => o });
    if (u.includes("/nodes")) return json({ data: [] });
    if (u.endsWith("/packages")) return json({ data: [{ slug: "inplace_starter", name: "inPlace Starter" }] });
    if (u.endsWith("/candidates") && opts.method === "POST") return json({ id: "cand_" + uuid().slice(0, 8) });
    if (u.endsWith("/invitations") && opts.method === "POST") return json({ id: "inv_" + uuid().slice(0, 8), status: "pending", invitation_url: "https://apply.checkr.com/x" });
    return json({ error: "nope" }, 404);
  });
});

afterAll(async () => { global.fetch = realFetch; await stopHarness(h); });

async function caregiverWithProfile({ dob = "1990-03-14" } = {}) {
  const cg = await h.createUser({ firstName: "Jane", lastName: "Caregiver", roles: ["caregiver"] });
  await db.prepare(`
    INSERT INTO caregiver_profiles (id, user_id, hourly_rate, legal_first_name, legal_last_name, date_of_birth, zip, created_at)
    VALUES (?, ?, 22, 'Jane', 'Caregiver', ?, '24141', NOW())
  `).run(uuid(), cg.user.id, dob);
  return cg;
}

const needsYou = async (adminId) => {
  const { attentionItemsFor } = require("../../src/utils/attention");
  return (await attentionItemsFor(db, adminId)).items.filter((i) => i.kind === "bgCheckRequest");
};

describe("ask → approve → Checkr", () => {
  let cg, admin, other;
  beforeAll(async () => {
    cg = await caregiverWithProfile();
    admin = await h.createUser({ firstName: "Admin", lastName: "One", isAdmin: true });
    other = await h.createUser({ firstName: "Not", lastName: "Admin" });
  });

  test("agreeing in onboarding (the profile save) is the request — no payment involved", async () => {
    const r = await req.post("/api/caregivers/profile").set(h.auth(cg.token))
      .send({ hourlyRate: 22, backgroundCheckConsent: true });
    expect([200, 201]).toContain(r.status);
    const row = await db.prepare("SELECT bg_check_requested_at, background_check_paid FROM caregiver_profiles WHERE user_id = ?").get(cg.user.id);
    expect(row.bg_check_requested_at).toBeTruthy();
    expect(row.background_check_paid === 1).toBe(false);
  });

  test("it is in the admin's Needs you with a one-tap Approve, and in nobody else's", async () => {
    const mine = (await needsYou(admin.user.id)).filter((i) => i.id === `bgCheckRequest:${cg.user.id}`);
    expect(mine).toHaveLength(1);
    expect(mine[0].action).toEqual({ method: "POST", path: `/api/checkr/admin/requests/${cg.user.id}/approve` });
    expect(await needsYou(other.user.id)).toHaveLength(0);
  });

  test("she can't send herself to Checkr before approval — the button just asks", async () => {
    calls.length = 0;
    const r = await req.post("/api/checkr/initiate").set(h.auth(cg.token)).send({});
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("requested");
    expect(calls.find((c) => c.url.endsWith("/invitations"))).toBeUndefined();
  });

  test("Approve sends her details to Checkr, records the approval, and the card goes away", async () => {
    calls.length = 0;
    const r = await req.post(`/api/checkr/admin/requests/${cg.user.id}/approve`).set(h.auth(admin.token));
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("invitation_sent");
    const cand = calls.find((c) => c.url.endsWith("/candidates") && c.method === "POST");
    // What makes Checkr's form open already filled in.
    expect(cand.body).toMatchObject({ first_name: "Jane", last_name: "Caregiver", dob: "1990-03-14", zipcode: "24141", email: cg.user.email });
    expect(calls.find((c) => c.url.endsWith("/invitations")).body.package).toBe("inplace_starter");
    const row = await db.prepare("SELECT bg_check_approved_at, bg_check_approved_by FROM caregiver_profiles WHERE user_id = ?").get(cg.user.id);
    expect(row.bg_check_approved_at).toBeTruthy();
    expect(row.bg_check_approved_by).toBe(admin.user.id);
    expect((await needsYou(admin.user.id)).filter((i) => i.id === `bgCheckRequest:${cg.user.id}`)).toHaveLength(0);
    const s = await req.get("/api/checkr/status").set(h.auth(cg.token));
    expect(s.body.phase).toBe("awaiting_caregiver");
    expect(s.body.approvedAt).toBeTruthy();
    expect(s.body.details.fields.dateOfBirth).toBe("1990-03-14");
  });

  test("only an admin can approve", async () => {
    const cg2 = await caregiverWithProfile();
    const r = await req.post(`/api/checkr/admin/requests/${cg2.user.id}/approve`).set(h.auth(other.token));
    expect(r.status).toBe(403);
  });
});

// v1.132.1 — Pete: "vouching pushes the 'start background check' to their account if they work
// for more people than vouched."
test("a vouched caregiver's onboarding agreement is not a request — tapping I'm ready is", async () => {
  const cg = await caregiverWithProfile();
  const fam = await h.createUser({ firstName: "Fam", lastName: "Ily" });
  await db.prepare("INSERT INTO bg_admin_vouches (id, caregiver_user_id, family_user_id, vouched_by, created_at) VALUES (?, ?, ?, 'admin-fixture', NOW())")
    .run(uuid(), cg.user.id, fam.user.id);
  await req.post("/api/caregivers/profile").set(h.auth(cg.token)).send({ hourlyRate: 22, backgroundCheckConsent: true });
  let row = await db.prepare("SELECT bg_check_requested_at FROM caregiver_profiles WHERE user_id = ?").get(cg.user.id);
  expect(row.bg_check_requested_at).toBeNull();
  const admin = await h.createUser({ isAdmin: true });
  expect((await needsYou(admin.user.id)).find((i) => i.id === `bgCheckRequest:${cg.user.id}`)).toBeUndefined();

  const r = await req.post("/api/checkr/initiate").set(h.auth(cg.token)).send({});
  expect(r.body.status).toBe("requested");
  row = await db.prepare("SELECT bg_check_requested_at FROM caregiver_profiles WHERE user_id = ?").get(cg.user.id);
  expect(row.bg_check_requested_at).toBeTruthy();
  expect((await needsYou(admin.user.id)).find((i) => i.id === `bgCheckRequest:${cg.user.id}`)).toBeTruthy();
});

test("missing what Checkr needs → the card says what, and has no one-tap approve", async () => {
  const cg = await caregiverWithProfile({ dob: null });
  await db.prepare("UPDATE caregiver_profiles SET background_check_consent = 1 WHERE user_id = ?").run(cg.user.id);
  const { requestIfReady } = require("../../src/utils/bgCheckRequest");
  expect(await requestIfReady(db, cg.user.id)).toBe(true);
  expect(await requestIfReady(db, cg.user.id)).toBe(false); // once
  const admin = await h.createUser({ isAdmin: true });
  const item = (await needsYou(admin.user.id)).find((i) => i.id === `bgCheckRequest:${cg.user.id}`);
  expect(item.title).toMatch(/waiting on them for date of birth/);
  expect(item.soft).toBe(true); // their move, not the admin's: not in the badge
  expect(item.action).toBeNull();
});
