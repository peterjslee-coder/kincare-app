// v1.105.63 — you could not waive a background check without first starting one.
//
// The real case, and it cost an afternoon. A caregiver signs up. The admin knows her
// personally and decides she needs no background check. He opens her record and grants the
// only control that looks like a waiver — "Background Check Paid" — and three things happen,
// none of them what he wanted:
//
//   1. The flag records that she PAID $30. She paid nothing. The label says otherwise, so
//      the admin's own record now disagrees with reality.
//   2. Her First Steps advances from "pay the fee" to "complete the background check form" —
//      the waiver pushed her FURTHER INTO the pipeline she was being exempted from.
//   3. The vouch, which is the control that actually waives a check, was reachable only from
//      Admin → BG Checks. That page lists caregivers who have entered the Checkr pipeline.
//      She hadn't. So she wasn't there, and there was no card to vouch on.
//
// Point 3 is the circle: to exempt someone from Checkr you first had to make them start
// Checkr. v1.104.9 saw this and added `legal_first_name IS NOT NULL` as an escape hatch —
// but the legal name is collected inside the background-check step, so the hatch opens from
// the inside only.
//
// These tests pin the way out: the fee flag and a connected bank account both make someone
// findable, the fee's label tells the truth about whether money moved, and vouching is
// reachable from the screen the admin is already on.

const { code } = require("./helpers/source");

const checkr = code("src/routes/checkr.js");
const userFlags = code("src/routes/admin/userFlags.js");
const dashboard = code("src/routes/dashboard.js");
const adminPanel = code("public/js/components/AdminPanel.js");
const hub = code("public/js/components/CaretakerHub.js");

function region(src, startMarker, endMarker, label) {
  const start = src.indexOf(startMarker);
  const end = src.indexOf(endMarker, start + 1);
  expect(`${label}: start`).toBe(start > -1 ? `${label}: start` : `${label}: START MARKER NOT FOUND`);
  expect(`${label}: end`).toBe(end > start ? `${label}: end` : `${label}: END MARKER NOT FOUND AFTER START`);
  return src.slice(start, end);
}

// ───────────────────────────────────────────────────────────────────────────────
describe("a caregiver an admin has already acted on is findable", () => {
  const where = region(checkr, "FROM caregiver_profiles cp", "ORDER BY cp.updated_at DESC", "candidates filter");

  test("a waived or paid fee puts them on the list", () => {
    // The exact hole Julia fell through: the flag was SELECTed and never used to include her.
    expect(where).toMatch(/OR cp\.background_check_paid = 1/);
  });

  test("so does a connected bank account", () => {
    // Nobody connects a bank account to an app by accident.
    expect(where).toMatch(/OR cp\.stripe_onboard_complete = 1/);
  });

  test("the earlier escape hatches are still there", () => {
    // This is an additive fix. Removing any of these would hide someone who is visible today.
    for (const cond of [
      /cp\.background_check_consent = 1/,
      /cp\.checkr_candidate_id IS NOT NULL/,
      /cp\.is_background_checked = 1/,
      /cp\.onboarding_complete = 1/,
      /cp\.legal_first_name IS NOT NULL/,
      /FROM bg_admin_vouches v WHERE v\.caregiver_user_id = cp\.user_id AND v\.revoked_at IS NULL/,
    ]) expect(where).toMatch(cond);
  });

  test("empty stubs are still excluded, and so are demo accounts", () => {
    // The filter has to keep meaning something. If it ever becomes unconditional, this fails.
    expect(where).toMatch(/COALESCE\(u\.is_demo, 0\) = 0/);
    expect(where).toMatch(/AND \(/);
  });
});

// ───────────────────────────────────────────────────────────────────────────────
describe("a waived fee is not a paid fee", () => {
  test("the server distinguishes them from the payments table, not the flag", () => {
    // The flag is identical in both cases. Only a completed payment row proves money moved.
    expect(userFlags).toMatch(/FROM background_check_payments WHERE user_id = \? AND status = 'completed'/);
    expect(userFlags).toMatch(/backgroundCheckFee: !profile\.background_check_paid \? 'none' : \(feePaidForReal \? 'paid' : 'waived'\)/);
  });

  test("the caregiver's own view knows too", () => {
    expect(dashboard).toMatch(/backgroundCheckFeeWaived/);
    expect(dashboard).toMatch(/FROM background_check_payments WHERE user_id = \? AND status = 'completed'/);
  });

  test("the admin label no longer claims a payment that never happened", () => {
    const flagRow = region(adminPanel, "key: 'backgroundCheckPaid'", "key: 'onboardingComplete'", "fee flag row");
    expect(flagRow).not.toMatch(/label: 'Background Check Paid'/);
    expect(flagRow).not.toMatch(/desc: 'Paid \$30 fee for background check'/);
    expect(flagRow).toMatch(/waived/i);
  });

  test("and it says plainly that waiving the fee is not waiving the check", () => {
    // The single sentence that would have saved the afternoon.
    const flagRow = region(adminPanel, "key: 'backgroundCheckPaid'", "key: 'onboardingComplete'", "fee flag row");
    expect(flagRow).toMatch(/does not waive the background check|waive the check itself/i);
  });

  test("the caregiver is told the fee was waived rather than billed for it", () => {
    const step = region(hub, "label: 'Start your background check'", "done: bgCheckSubmitted || bgOverride", "bg step");
    expect(step).toMatch(/feeWaived/);
    expect(step).toMatch(/has been waived for you/);
    // The $30 sentence must be conditional now, not unconditional prose.
    expect(step).not.toMatch(/desc: 'A background check is required to participate on InPlace\. This is a one-time \$30 fee/);
  });
});

// ───────────────────────────────────────────────────────────────────────────────
describe("vouching is reachable without entering the Checkr pipeline", () => {
  test("the People modal is given the caregiver's vouches", () => {
    expect(userFlags).toMatch(/const vouches = profile \? await activeVouchesFor\(db, user\.id\)/);
    expect(userFlags).toMatch(/\n\s+vouches,/);
  });

  test("the modal can create and revoke one", () => {
    expect(adminPanel).toMatch(/const vouchFromPeople = async/);
    expect(adminPanel).toMatch(/const revokeVouchFromPeople = async/);
    const fn = region(adminPanel, "const vouchFromPeople = async", "const revokeVouchFromPeople = async", "vouchFromPeople");
    expect(fn).toMatch(/apiFetch\('\/api\/admin\/vouches', \{/);
    expect(fn).toMatch(/caregiverUserId: onboardingModal\.userId/);
  });

  test("it reuses the honest wording — a vouch is never shown as a background check", () => {
    // v1.64.0's rule. A second entry point must not become a second, laxer story.
    const fn = region(adminPanel, "const vouchFromPeople = async", "const revokeVouchFromPeople = async", "vouchFromPeople");
    expect(fn).toMatch(/NOT a background check/);
    expect(fn).toMatch(/family ONLY/);
  });

  test("the panel explains what the fee flag above it does not do", () => {
    const panel = region(adminPanel, "Family Vouches", "Additional Info", "vouch panel");
    expect(panel).toMatch(/waives the background check for one family/);
    expect(panel).toMatch(/vouchFromPeople/);
  });

  test("BG Checks keeps its own vouch flow — this is a second door, not a move", () => {
    expect(adminPanel).toMatch(/const vouchForFamily = async/);
    expect(adminPanel).toMatch(/const convertToVouch = async/);
  });
});
