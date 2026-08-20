// ─── When a caregiver may see WHO she would be caring for (v1.105.107) ───
//
// Julia, 7d94657c: the Find Work card said "Care Recipient". She is about to spend an
// afternoon with a person, not a role.
//
// The name was not missing — it was withheld. `dashboard.js` gated every personal detail on
// `stripe_onboard_complete && (is_background_checked || vouched-by-this-family)`.
//
// The Stripe half was a conflation, and Pete's call on Aug 19 was to split them:
//
//   TRUST   — a real background check, or a vouch from THAT job's family — decides whether
//             you may see a person's name, city, family, instructions and care summary.
//   PAYMENT — Stripe onboarding — decides whether you can be paid.
//
// One is about safety, the other about banking, and requiring a Stripe account before you may
// learn who you would be caring for is not a privacy control. Worse, it was backwards in
// practice: the Stripe gate on ACCEPTING a job (sessions.js "skipped for now — not live yet")
// is commented out, so Stripe blocked the information and not the action. Julia could take a
// job for Pete's mother while the card still called her "Care Recipient".
//
// Two sibling definitions already omitted Stripe — `isCaregiverCleared` in routes/messages.js
// and `caregiverCleared` in routes/dashboard.js — so line 807 was the outlier, not the rule.
//
// A vouch is scoped to ONE family (v1.64.0), never the whole platform, which is why this takes
// the family id: being trusted by the Lowes says nothing about the Hubers.

/**
 * May this caregiver see the personal details attached to one family's job?
 *
 * @param {{is_background_checked?: any}} profile          caregiver_profiles row
 * @param {Set<string>} vouchedFamilyIds                   families who vouched for her
 * @param {string} familyUserId                            the family whose job this is
 * @returns {boolean}
 */
function maySeeRecipientDetails(profile, vouchedFamilyIds, familyUserId) {
  if (!profile) return false;
  if (profile.is_background_checked) return true;
  return !!(vouchedFamilyIds && familyUserId && vouchedFamilyIds.has(familyUserId));
}

/**
 * The platform-wide form: trusted by ANYONE. Used where there is no single family in scope —
 * a client-side capability flag, not a per-job disclosure decision.
 */
function isTrustedCaregiver(profile, vouchedFamilyIds) {
  if (!profile) return false;
  return !!profile.is_background_checked || !!(vouchedFamilyIds && vouchedFamilyIds.size > 0);
}

module.exports = { maySeeRecipientDetails, isTrustedCaregiver };
