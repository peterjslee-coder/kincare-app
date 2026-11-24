/**
 * v1.106.14 — a failed background check must stop work, and wait for an admin.
 *
 * Pete, 13 Sep: "if someone fails a background check, they don't get jobs, they don't get an
 * invitation to do anything until I am in the loop and have reviewed their check."
 *
 * None of that held. The three adverse Checkr webhooks each set a status string and nothing
 * else — not is_background_checked, which is the column every work gate reads, and not the
 * admin vouches, which are the OTHER way a caregiver clears a gate. So:
 *
 *   · a caregiver cleared earlier (initial report clear, or an approved `consider`) who later
 *     failed adverse action kept is_background_checked = 1 and kept being offered work;
 *   · a caregiver Pete had vouched for kept working for that family whatever the result;
 *   · and 'did_not_pass' was in the re-initiate allow-list, so they could quietly start a
 *     fresh check with nobody told.
 *
 * Source anchors cannot show a gate opening. This runs the real block against the real schema
 * and then asks the real gate.
 */
const { startHarness, stopHarness } = require("./harness");
const { v4: uuid } = require("uuid");
const { blockPendingAdminReview } = require("../../src/utils/caregiverBlock");

jest.setTimeout(180000);

let h, db;

beforeAll(async () => {
  h = await startHarness({ routers: { "/api/checkr": "../../src/routes/checkr" } });
  db = h.db;
});
afterAll(async () => { await stopHarness(h); });

/** A caregiver who is cleared to work, optionally vouched for a family. */
async function clearedCaregiver({ vouchedForFamily = null, candidateId = null } = {}) {
  const cg = await h.createUser({ firstName: "Cleared", lastName: "Giver", roles: ["caregiver"] });
  const profileId = uuid();
  await db.prepare(`
    INSERT INTO caregiver_profiles
      (id, user_id, hourly_rate, is_background_checked, is_available, checkr_status, checkr_candidate_id, created_at)
    VALUES (?, ?, 25, 1, 1, 'clear', ?, NOW())
  `).run(profileId, cg.user.id, candidateId);

  if (vouchedForFamily) {
    await db.prepare(`
      INSERT INTO bg_admin_vouches (id, caregiver_user_id, family_user_id, vouched_by, created_at)
      VALUES (?, ?, ?, ?, NOW())
    `).run(uuid(), cg.user.id, vouchedForFamily, "admin-fixture");
  }
  return { cg, profileId };
}

const readProfile = (userId) => db.prepare(
  "SELECT is_background_checked, is_available, account_paused, account_paused_reason FROM caregiver_profiles WHERE user_id = ?"
).get(userId);

/** The gate both work paths actually use: cleared OR an active vouch for this family. */
async function mayWorkFor(caregiverUserId, familyUserId) {
  const row = await db.prepare(`
    SELECT 1 AS ok FROM caregiver_profiles cp
     WHERE cp.user_id = ?
       AND (cp.is_background_checked = 1 OR EXISTS (
             SELECT 1 FROM bg_admin_vouches v
              WHERE v.caregiver_user_id = cp.user_id AND v.family_user_id = ? AND v.revoked_at IS NULL))
  `).get(caregiverUserId, familyUserId);
  return !!row;
}

describe("the block stops work", () => {
  test("a previously-cleared caregiver is no longer cleared", async () => {
    const family = await h.createUser({ firstName: "Fam", lastName: "A" });
    const { cg } = await clearedCaregiver();

    expect(await mayWorkFor(cg.user.id, family.user.id)).toBe(true);   // the bug's starting point

    const r = await blockPendingAdminReview(db, {
      caregiverUserId: cg.user.id, reason: "under review", source: "checkr:post_adverse_action",
    });
    expect(r.blocked).toBe(true);
    expect(r.wasCleared).toBe(true);   // this person WAS working

    expect(await mayWorkFor(cg.user.id, family.user.id)).toBe(false);
    const p = await readProfile(cg.user.id);
    expect(p.is_background_checked).toBeFalsy();
    expect(p.is_available).toBeFalsy();
    expect(p.account_paused).toBeTruthy();
    expect(p.account_paused_reason).toBe("under review");
  });

  test("an admin vouch does not survive it — the second way through the gate", async () => {
    const family = await h.createUser({ firstName: "Fam", lastName: "B" });
    const { cg } = await clearedCaregiver({ vouchedForFamily: family.user.id });

    const r = await blockPendingAdminReview(db, {
      caregiverUserId: cg.user.id, reason: "under review", source: "checkr:post_adverse_action",
    });
    expect(r.vouchesRevoked).toBe(1);

    // Without revoking, clearing is_background_checked alone would leave this true.
    expect(await mayWorkFor(cg.user.id, family.user.id)).toBe(false);

    const v = await db.prepare(
      "SELECT revoked_at, revoked_by FROM bg_admin_vouches WHERE caregiver_user_id = ?"
    ).get(cg.user.id);
    expect(v.revoked_at).toBeTruthy();
    // Records that a machine did this, and which webhook — not a phantom admin click.
    expect(v.revoked_by).toBe("system:checkr:post_adverse_action");
  });

  test("it resolves by Checkr candidate id, which is all a webhook has", async () => {
    const candidateId = `cand_${uuid().slice(0, 8)}`;
    const { cg } = await clearedCaregiver({ candidateId });
    const r = await blockPendingAdminReview(db, {
      candidateId, reason: "under review", source: "checkr:suspended",
    });
    expect(r.blocked).toBe(true);
    expect(r.userId).toBe(cg.user.id);
    expect((await readProfile(cg.user.id)).is_background_checked).toBeFalsy();
  });

  test("an unknown candidate is a no-op, not a throw — a webhook must still 200", async () => {
    const r = await blockPendingAdminReview(db, {
      candidateId: "cand_does_not_exist", reason: "x", source: "checkr:suspended",
    });
    expect(r).toEqual({ blocked: false, userId: null, vouchesRevoked: 0, wasCleared: false });
  });

  test("blocking someone already blocked is safe and reports wasCleared false", async () => {
    const { cg } = await clearedCaregiver();
    await blockPendingAdminReview(db, { caregiverUserId: cg.user.id, reason: "r1", source: "checkr:suspended" });
    const second = await blockPendingAdminReview(db, { caregiverUserId: cg.user.id, reason: "r2", source: "checkr:post_adverse_action" });
    expect(second.blocked).toBe(true);
    expect(second.wasCleared).toBe(false);
    expect(second.vouchesRevoked).toBe(0);
  });
});

describe("and they are not invited to do anything", () => {
  async function initiateAs(cg) {
    return h.request.post("/api/checkr/initiate").set(h.auth(cg.token)).send({});
  }

  test("a blocked caregiver cannot start a new check", async () => {
    const { cg } = await clearedCaregiver();
    await blockPendingAdminReview(db, {
      caregiverUserId: cg.user.id, reason: "under review", source: "checkr:post_adverse_action",
    });
    const res = await initiateAs(cg);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("PENDING_ADMIN_REVIEW");
    // …and is told nothing about an outcome.
    expect(res.body.error).not.toMatch(/fail|not approved|declined|reject/i);
  });

  test("the re-initiate allow-list is exactly the restartable phase", () => {
    // 'rejected' and 'did_not_pass' used to be in it. Pinning them equal keeps the allow-list
    // and the phase definition from drifting apart again.
    const { RESTARTABLE } = require("../../src/constants/checkrStatus");
    expect(RESTARTABLE).not.toContain("did_not_pass");
    expect(RESTARTABLE).not.toContain("rejected");
    expect(RESTARTABLE).toEqual(expect.arrayContaining(["invitation_expired", "invitation_canceled"]));
  });
});
