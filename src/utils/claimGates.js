/**
 * The checks that stand between a caregiver and a job. (v1.106.24)
 *
 * Lifted out of PUT /sessions/:id/claim so the recurring-series claim can enforce exactly the
 * same ones. Two copies of a gate is two places to forget a gate, and these are the gates that
 * decide whether an unvetted person gets into somebody's mother's house.
 *
 * Split in two on purpose, because they answer different questions at different times:
 *
 *   caregiverGate   — about the PERSON. Roles, not your own request, a profile, not paused,
 *                     care preferences set. Runs once, whether she is claiming one visit or
 *                     twelve. The own-request check sits in the middle of it rather than in
 *                     sessionGate because its position relative to the profile checks decides
 *                     which reason she is told, and the original code says so out loud.
 *   sessionGate     — about THIS JOB. Claimable status; background-checked, OR vouched by an
 *                     admin FOR THIS FAMILY. The vouch is family-scoped (v1.64.0), so it has
 *                     to be asked per session, not once.
 *
 * Each returns null when it passes, or { status, error } to be handed straight to res.
 */
const { hasActiveVouch } = require("./vouches");

const CLAIMABLE = ["requested", "open", "pending"];

async function caregiverGate(db, req, session) {
  const roles = req.user.roles || [req.user.role];
  if (!roles.includes("caregiver")) {
    return { status: 403, error: "Only caregivers can claim care requests" };
  }

  // ─── v1.105.90: you cannot accept a request you posted yourself ───
  //
  // Narrower than v1.105.89, which blocked any job for a recipient you are the family for.
  // Pete: "if sara posts a job and i have to take it, I'll take the pay for it. do not
  // prohibit members of the team from also doing things for money if they can't hire
  // someone." What remains is only the incoherent case: paying yourself.
  //
  // It lives here rather than in the dashboard query because hiding the job made the endpoint
  // unreachable through the UI while leaving it open to anything that knew a session id.
  //
  // v1.106.24 — the ORDER is load-bearing and the original code says so: this runs before the
  // profile checks "so the reason given is the real one, not 'set your care preferences'".
  // Extracting the gates moved it below them for one commit; a test pins it now.
  if (session && session.family_user_id === req.user.id) {
    return { status: 403, error: "You can't accept a request you posted yourself." };
  }

  const profile = await db.prepare(`
    SELECT id, background_check_paid, is_background_checked, bg_check_admin_approved,
           stripe_onboard_complete, is_available, care_stoplight, care_preferences, account_paused
    FROM caregiver_profiles WHERE user_id = ?
  `).get(req.user.id);
  if (!profile) return { status: 404, error: "Caregiver profile not found" };

  if (profile.account_paused) {
    return { status: 403, error: "Your account is paused. Contact support for assistance." };
  }

  // v1.64.0 — the Stripe gate is deliberately not enforced here; see the note in sessions.js.
  if (!profile.care_stoplight && !profile.care_preferences) {
    return { status: 403, error: "Please set your care preferences before accepting jobs. Go to Account → Care Preferences." };
  }

  return { profile };
}

async function sessionGate(db, req, session, profile) {
  if (!CLAIMABLE.includes(session.status)) {
    return { status: 400, error: "This session is not available for claiming (status: " + session.status + ")" };
  }

  // Honest background-check gate (v1.64.0):
  //  - a real Checkr result clears the caregiver for any job;
  //  - an admin vouch clears them ONLY for the vouched family's jobs.
  if (!profile.is_background_checked) {
    const vouched = await hasActiveVouch(db, req.user.id, session.family_user_id);
    if (!vouched) {
      return { status: 403, error: "You must complete your background check before accepting care requests. If you have an existing relationship with this family, ask the platform admin to approve you for them." };
    }
  }

  return null;
}

module.exports = { caregiverGate, sessionGate, CLAIMABLE };
