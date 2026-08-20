/**
 * v1.105.107 — a vouched caregiver sees who she would be caring for.
 *
 * Julia, 7d94657c: the Find Work card said "Care Recipient". She is about to spend an
 * afternoon with a person, not a role.
 *
 * The name was withheld, not missing: `dashboard.js` required
 * `stripe_onboard_complete && (is_background_checked || vouched-by-this-family)` before
 * sending the name, city, family name, instructions, care summary, health tags or location.
 * Julia's background check was waived by vouch and she had no bank account yet, so she got
 * none of it — while the Stripe gate on ACCEPTING a job sits commented out in sessions.js.
 * Stripe blocked the information and not the action.
 *
 * This is a privacy boundary, so it is tested end to end against a real database rather than
 * by reading the flag: loosening it wrongly is a disclosure, not a cosmetic bug.
 */
const { startHarness, stopHarness } = require("./harness");
const { v4: uuid } = require("uuid");

jest.setTimeout(180000);

let h, db;
let julia, juliaProfileId, pete, stranger;
let peteRecipientId, strangerRecipientId;

const dashboardFor = async (user) => {
  const res = await h.request.get("/api/dashboard").set(h.auth(user.token));
  expect(res.status).toBe(200);
  return res.body;
};

const jobFor = (body, recipientIdOrNull, sessionId) =>
  (body.openJobs || []).find((j) => j.id === sessionId);

async function postJob({ familyUserId, recipientId }) {
  const id = uuid();
  await db.prepare(`
    INSERT INTO care_sessions (id, care_recipient_id, family_user_id, service_type, status,
                               scheduled_date, scheduled_time, duration_hours, estimated_cost,
                               special_instructions, created_at)
    VALUES (?, ?, ?, 'companionship', 'open', CURRENT_DATE + 5, '10:00', 3, 84,
            'Back door sticks — pull it toward you.', NOW())
  `).run(id, recipientId, familyUserId);
  return id;
}

beforeAll(async () => {
  h = await startHarness({ routers: { "/api/dashboard": "../../src/routes/dashboard" } });
  db = h.db;

  julia = await h.createUser({ firstName: "Julia", lastName: "Huth", roles: ["caregiver"] });
  pete = await h.createUser({ firstName: "Pete", lastName: "Lee" });
  stranger = await h.createUser({ firstName: "Someone", lastName: "Else" });

  juliaProfileId = uuid();
  // No bank account. is_background_checked stays 0 — hers was waived by vouch.
  await db.prepare(`
    INSERT INTO caregiver_profiles (id, user_id, hourly_rate, is_background_checked,
                                    stripe_onboard_complete, is_available, created_at)
    VALUES (?, ?, 25, 0, 0, 1, NOW())
  `).run(juliaProfileId, julia.user.id);

  const petesTeam = await h.createCareTeam({ familyUserId: pete.user.id });
  peteRecipientId = petesTeam.recipientId;
  await db.prepare("UPDATE care_recipients SET first_name = 'Betty', last_name = 'Lee', location_city = 'Fairlawn, VA' WHERE id = ?")
    .run(peteRecipientId);

  const strangersTeam = await h.createCareTeam({ familyUserId: stranger.user.id });
  strangerRecipientId = strangersTeam.recipientId;
  await db.prepare("UPDATE care_recipients SET first_name = 'Nora', last_name = 'Nobody', location_city = 'Roanoke, VA' WHERE id = ?")
    .run(strangerRecipientId);
});

afterAll(async () => { await stopHarness(h); });

describe("before anyone vouches for her", () => {
  test("she sees the job but not the person", async () => {
    const sessionId = await postJob({ familyUserId: pete.user.id, recipientId: peteRecipientId });
    const job = jobFor(await dashboardFor(julia), peteRecipientId, sessionId);
    expect(job).toBeTruthy();                    // the job is still offered to her
    expect(job.recipientName).toBeNull();        // the person is not
    expect(job.familyName).toBeNull();
    expect(job.specialInstructions).toBeNull();
  });

  // v1.105.108 — and it says WHICH input was false. I told Pete her card said "Care
  // Recipient" because of Stripe; he replied "julia very much has stripe enabled." The gate
  // had three inputs and the payload reported none of them, so the only way to tell was to
  // guess. It reports them now.
  test("and the payload says why, with the raw inputs behind it", async () => {
    const sessionId = await postJob({ familyUserId: pete.user.id, recipientId: peteRecipientId });
    const job = jobFor(await dashboardFor(julia), peteRecipientId, sessionId);
    expect(job.detailsWithheld).toBe(true);
    expect(job.detailsWithheldReason).toBe("no_trust_for_this_family");
    expect(job.isBackgroundChecked).toBe(false);
    expect(job.vouchedByThisFamily).toBe(false);
  });
});

describe("after Pete vouches for her", () => {
  let peteJobId, strangerJobId;

  beforeAll(async () => {
    await db.prepare(
      "INSERT INTO bg_admin_vouches (id, caregiver_user_id, family_user_id, vouched_by, created_at) VALUES (?, ?, ?, ?, NOW())"
    ).run(uuid(), julia.user.id, pete.user.id, pete.user.id);
    peteJobId = await postJob({ familyUserId: pete.user.id, recipientId: peteRecipientId });
    strangerJobId = await postJob({ familyUserId: stranger.user.id, recipientId: strangerRecipientId });
  });

  test("she sees Betty — with no Stripe account at all", async () => {
    const profile = await db.prepare("SELECT stripe_onboard_complete FROM caregiver_profiles WHERE id = ?").get(juliaProfileId);
    expect(!!profile.stripe_onboard_complete).toBe(false);   // the point of the test

    const job = jobFor(await dashboardFor(julia), peteRecipientId, peteJobId);
    expect(job.recipientName).toBe("Betty Lee");
    expect(job.familyName).toBe("Pete Lee");
    expect(job.specialInstructions).toBe("Back door sticks — pull it toward you.");
    expect(job.detailsWithheld).toBe(false);
    expect(job.detailsWithheldReason).toBeNull();
    expect(job.vouchedByThisFamily).toBe(true);
  });

  test("and still NOT the family nobody vouched from", async () => {
    // A vouch is scoped to one family (v1.64.0). Being trusted by Pete says nothing about
    // anyone else — this is the assertion that would catch the gate being loosened too far.
    const job = jobFor(await dashboardFor(julia), strangerRecipientId, strangerJobId);
    expect(job).toBeTruthy();
    expect(job.recipientName).toBeNull();
    expect(job.familyName).toBeNull();
    expect(job.specialInstructions).toBeNull();
  });

  test("a revoked vouch takes the name back", async () => {
    await db.prepare("UPDATE bg_admin_vouches SET revoked_at = NOW() WHERE caregiver_user_id = ?")
      .run(julia.user.id);
    const job = jobFor(await dashboardFor(julia), peteRecipientId, peteJobId);
    expect(job.recipientName).toBeNull();
    await db.prepare("UPDATE bg_admin_vouches SET revoked_at = NULL WHERE caregiver_user_id = ?")
      .run(julia.user.id);
  });
});
