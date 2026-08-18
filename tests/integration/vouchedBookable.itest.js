/**
 * v1.105.83 — a caregiver you vouched for can actually be booked.
 *
 * Pete, trying to schedule Julia: "why can't I pick her as one of the locals? because she's
 * got no address or something?... she's ready to go and I can't hire her because I can't
 * find her."
 *
 * Yes. The booking picker offered two groups: people with a prior SESSION for this recipient,
 * and people with coordinates within range. Julia has neither — never booked, and onboarding
 * does not require an address. A cold start with no exit: you need a booking to appear in the
 * known list and an address to appear in the nearby list.
 *
 * A vouch is, per the schema, "an admin's approval of ONE caregiver working for ONE family",
 * and the work gates already honour it. The picker did not.
 */
const { startHarness, stopHarness } = require("./harness");
const { v4: uuid } = require("uuid");

jest.setTimeout(180000);
let h, getDb;

beforeAll(async () => {
  h = await startHarness({ routers: { "/api/assignments": "../../src/routes/assignments" } });
  ({ getDb } = require("../../src/models/database"));
});
afterAll(async () => { await stopHarness(h); });

async function setup() {
  const db = await getDb();
  const family = await h.createUser({ firstName: "Pete", roles: ["family"] });
  const cg = await h.createUser({ firstName: "Julia", roles: ["caregiver"] });
  const profileId = uuid();
  // No latitude/longitude, exactly like Julia: onboarding never asked for an address.
  await db.prepare(
    "INSERT INTO caregiver_profiles (id, user_id, hourly_rate, is_available) VALUES (?, ?, 25, 1)"
  ).run(profileId, cg.user.id);
  const recipientId = uuid();
  await db.prepare(
    "INSERT INTO care_recipients (id, family_user_id, first_name, last_name, latitude, longitude) VALUES (?, ?, 'Betty', 'T', 37.13, -80.55)"
  ).run(recipientId, family.user.id);
  return { db, family, cg, profileId, recipientId };
}

const suggestions = (token, recipientId) =>
  h.request.get(`/api/assignments/suggestions?careRecipientId=${recipientId}`).set(h.auth(token));

describe("before the vouch", () => {
  test("a caregiver with no address and no history is invisible", async () => {
    const { family, cg, recipientId } = await setup();
    const res = await suggestions(family.token, recipientId);
    expect(res.status).toBe(200);
    const ids = (res.body.caregivers || res.body.suggestions || []).map((c) => c.caregiverUserId || c.caregiver_user_id);
    expect(ids).not.toContain(cg.user.id);   // the bug Pete hit
  });
});

describe("after the vouch", () => {
  test("she appears, and as one of THIS family's caregivers", async () => {
    const { db, family, cg, recipientId } = await setup();
    await db.prepare(
      "INSERT INTO bg_admin_vouches (id, caregiver_user_id, family_user_id, vouched_by) VALUES (?, ?, ?, ?)"
    ).run(uuid(), cg.user.id, family.user.id, family.user.id);

    const res = await suggestions(family.token, recipientId);
    const list = res.body.caregivers || res.body.suggestions || [];
    const hit = list.find((c) => (c.caregiverUserId || c.caregiver_user_id) === cg.user.id);
    expect(hit).toBeDefined();
    // The server sends `source`; RequestCareModal derives isTeam from it
    // (isTeam: source === 'history' || source === 'assigned'). A vouched caregiver has no
    // visits, so she comes through as 'assigned' and lands under "Betty's caregivers" rather
    // than "Nearby" — which is right: she is known to this family by name, not by proximity.
    expect(hit.source).toBe('assigned');
  });

  test("a revoked vouch takes her back out", async () => {
    const { db, family, cg, recipientId } = await setup();
    await db.prepare(
      "INSERT INTO bg_admin_vouches (id, caregiver_user_id, family_user_id, vouched_by, revoked_at) VALUES (?, ?, ?, ?, NOW())"
    ).run(uuid(), cg.user.id, family.user.id, family.user.id);
    const res = await suggestions(family.token, recipientId);
    const ids = (res.body.caregivers || res.body.suggestions || []).map((c) => c.caregiverUserId || c.caregiver_user_id);
    expect(ids).not.toContain(cg.user.id);
  });

  test("a vouch for a DIFFERENT family does not leak her into this one", async () => {
    // A vouch is one caregiver, one family. It must not become a general listing.
    const { db, family, cg, recipientId } = await setup();
    const other = await h.createUser({ firstName: "Someone", roles: ["family"] });
    await db.prepare(
      "INSERT INTO bg_admin_vouches (id, caregiver_user_id, family_user_id, vouched_by) VALUES (?, ?, ?, ?)"
    ).run(uuid(), cg.user.id, other.user.id, other.user.id);
    const res = await suggestions(family.token, recipientId);
    const ids = (res.body.caregivers || res.body.suggestions || []).map((c) => c.caregiverUserId || c.caregiver_user_id);
    expect(ids).not.toContain(cg.user.id);
  });
});
