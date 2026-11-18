/**
 * A caregiver's background check waits for an admin to approve it. (v1.132.0)
 *
 * Pete, 11/18: "For now I intend to pay for the background checks. I want this roadblock to
 * instead be a needs you card for Admin where I approve them to go get a background check. I
 * don't want them to pay the $30 upfront." And: "since they acknowledge that in the onboarding
 * ... maybe that's what triggers the ask? If I [am] talking to them and anticipate them signing
 * up, it would speed it up a little."
 *
 * So:
 *   1. Ticking the background-check consent in onboarding IS the request (requestIfReady).
 *      A caregiver who skipped it can ask from Account (same function).
 *   2. Pete sees it in Needs you (utils/attention.js, kind bgCheckRequest) with what Checkr will
 *      be sent, and approves with one tap (approveRequest), which sends Checkr's form through the
 *      same sendInvitation() everything else uses. InPlace's Checkr account pays.
 *   3. From there only Checkr's own word moves anything (utils/checkrEvidence).
 *
 * The details Checkr needs and InPlace already holds — legal name, date of birth, email, phone,
 * ZIP — go to Checkr when the candidate is created, so Checkr's form opens with them filled in.
 */
const { notifyAdmins } = require("./checkrEvidence");

/** What Checkr will be given, and what is missing. Checkr requires the first four. */
function readiness(profile, user) {
  const legal = [profile.legal_first_name, profile.legal_middle_name, profile.legal_last_name].filter(Boolean).join(" ");
  const fields = {
    legalName: legal || null,
    dateOfBirth: profile.date_of_birth || null,
    email: (user && user.email) || null,
    phone: (user && user.phone) || null,
    zip: profile.zip || null,
  };
  const missing = [];
  if (!profile.legal_first_name || !profile.legal_last_name) missing.push("legal name");
  if (!profile.date_of_birth) missing.push("date of birth");
  if (!fields.email) missing.push("email");
  return { fields, missing };
}

/**
 * Record that this caregiver is ready for a check, once. A no-op if one is already requested,
 * running, finished, or if they are cleared. Tells admins the first time. Never throws.
 * @returns {Promise<boolean>} true when a new request was recorded
 */
async function requestIfReady(db, userId, { explicit = false } = {}) {
  try {
    // Pete, 11/18: "vouching pushes the 'start background check' to their account if they work
    // for more people than vouched." A vouched caregiver's onboarding agreement is NOT a request
    // — they ask from Account when they want other families' work (explicit).
    if (!explicit) {
      const vouched = await db.prepare(
        "SELECT 1 FROM bg_admin_vouches WHERE caregiver_user_id = ? AND revoked_at IS NULL LIMIT 1"
      ).get(userId);
      if (vouched) return false;
    }
    const res = await db.prepare(`
      UPDATE caregiver_profiles
         SET bg_check_requested_at = NOW(), updated_at = NOW()
       WHERE user_id = ?
         AND bg_check_requested_at IS NULL
         AND COALESCE(background_check_consent, 0) = 1
         AND COALESCE(is_background_checked, 0) = 0
         AND checkr_invitation_id IS NULL
    `).run(userId);
    if (!res || !res.changes) return false;
    const u = await db.prepare("SELECT first_name, last_name, email, COALESCE(is_demo, 0) AS is_demo FROM users WHERE id = ?").get(userId);
    if (u && !u.is_demo) {
      const who = `${u.first_name || ""} ${u.last_name || ""}`.trim() || u.email;
      await notifyAdmins(db, {
        eventType: "bg_check_requested",
        title: `🔍 ${who} is ready for a background check`,
        message: `${who} agreed to a background check during sign-up. Approve it in Needs you and Checkr emails the form, billed to InPlace.`,
        pushTitle: "Background check to approve",
        pushBody: "A caregiver is ready for a background check. Open InPlace to approve it.",
        metadata: { userId },
      });
    }
    return true;
  } catch (e) {
    console.error("[bg-request] could not record request:", e.message);
    return false;
  }
}

module.exports = { requestIfReady, readiness };
