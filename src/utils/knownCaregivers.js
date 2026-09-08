// ─── Known caregivers (v1.105.186) ───
//
// A family leader meets someone who could help — a neighbour, a friend from church, someone
// who has helped before — and adds them by name and email. The next thing that person gets is
// an email to finish setting up, for THIS family only.
//
// POSTURE, decided Sep 8 2026 and not a lawyer item: this is NOT a vouch. InPlace does not
// control who works for a family that only uses us to coordinate their own care. The family
// brought the caregiver; every surface says so in plain words, and nothing ever displays a
// check InPlace did not run. The word "vouch" must not reach a screen for this path.
//
// The MECHANISM reuses two rows that already exist, because they already gate the right things:
//   - `bg_admin_vouches` keyed caregiver × family OWNER is what `sessions.js` consults before a
//     caregiver may claim that family's jobs. Note `family_user_id` is the recipient's OWNER
//     (`care_recipients.family_user_id`), not the inviter — a non-owner leader's invite must
//     still open the owner's jobs, which is what the gate checks against.
//   - `caregiver_assignments` is what puts a caregiver under "Betty's caregivers".
//
// A row here carries `note = FAMILY_BROUGHT_NOTE` so the listing can say "Your caregiver · no
// background check" instead of the admin-approved wording.

const { v4: uuid } = require("uuid");

const KIND = "known-caregiver";
const FAMILY_BROUGHT_NOTE = "family-brought";
const INVITE_DAYS = 14;
const OPEN_CAP_PER_LEADER = 5;

/** Owner, or a care-team leader for the recipient. Returns the recipient row or null. */
async function recipientIfLeader(db, recipientId, userId) {
  const recipient = await db.prepare(
    "SELECT id, first_name, last_name, family_user_id FROM care_recipients WHERE id = ?"
  ).get(recipientId);
  if (!recipient) return null;
  if (recipient.family_user_id === userId) return recipient;
  const lead = await db.prepare(`
    SELECT ctm.id FROM care_team_members ctm
    JOIN care_teams ct ON ct.id = ctm.care_team_id
    WHERE ct.care_recipient_id = ? AND ctm.user_id = ? AND ctm.role = 'leader'
    LIMIT 1
  `).get(recipientId, userId);
  return lead ? recipient : null;
}

/** The leader's relationship to the recipient ("mother"), if the care team recorded one. */
async function relationshipFor(db, recipientId, userId) {
  const row = await db.prepare(`
    SELECT ctm.relationship_label FROM care_team_members ctm
    JOIN care_teams ct ON ct.id = ctm.care_team_id
    WHERE ct.care_recipient_id = ? AND ctm.user_id = ?
    LIMIT 1
  `).get(recipientId, userId);
  return row && row.relationship_label ? row.relationship_label : null;
}

/**
 * Open the family's jobs to this caregiver and, when a profile exists, put them under the
 * recipient. Idempotent: safe to call from accept-invite and again from profile creation.
 * Returns { gated, assigned }.
 */
async function fulfillKnownCaregiverInvite(db, invite, caregiverUserId) {
  const out = { gated: false, assigned: false };
  if (!invite || invite.kind !== KIND || !invite.care_recipient_id) return out;
  const recipient = await db.prepare(
    "SELECT id, family_user_id FROM care_recipients WHERE id = ?"
  ).get(invite.care_recipient_id);
  if (!recipient) return out;

  const existing = await db.prepare(
    "SELECT id FROM bg_admin_vouches WHERE caregiver_user_id = ? AND family_user_id = ? AND revoked_at IS NULL LIMIT 1"
  ).get(caregiverUserId, recipient.family_user_id);
  if (!existing) {
    await db.prepare(
      "INSERT INTO bg_admin_vouches (id, caregiver_user_id, family_user_id, vouched_by, note) VALUES (?, ?, ?, ?, ?)"
    ).run(uuid(), caregiverUserId, recipient.family_user_id, invite.invited_by, FAMILY_BROUGHT_NOTE);
    out.gated = true;
  }

  const profile = await db.prepare("SELECT id FROM caregiver_profiles WHERE user_id = ?").get(caregiverUserId);
  if (profile) {
    const assigned = await db.prepare(`
      SELECT id FROM caregiver_assignments
      WHERE care_recipient_id = ? AND caregiver_profile_id = ? AND family_user_id = ? AND is_active = 1
    `).get(recipient.id, profile.id, recipient.family_user_id);
    if (!assigned) {
      await db.prepare(`
        INSERT INTO caregiver_assignments (id, care_recipient_id, family_user_id, caregiver_profile_id, is_favorite)
        VALUES (?, ?, ?, ?, 0)
      `).run(uuid(), recipient.id, recipient.family_user_id, profile.id);
      out.assigned = true;
    }
  }
  return out;
}

/**
 * Called when a caregiver profile is first created. The invite was accepted at step 1, before
 * a profile existed, so the assignment could not be written then. Finish it now.
 */
async function fulfillPendingForUser(db, caregiverUserId) {
  const user = await db.prepare("SELECT email FROM users WHERE id = ?").get(caregiverUserId);
  if (!user || !user.email) return [];
  const invites = await db.prepare(`
    SELECT * FROM platform_invites
    WHERE kind = ? AND status = 'accepted' AND LOWER(invited_email) = LOWER(?)
  `).all(KIND, user.email);
  const results = [];
  for (const inv of invites) {
    results.push(await fulfillKnownCaregiverInvite(db, inv, caregiverUserId));
  }
  return results;
}

/** Does this caregiver work for families ONLY because a family brought them in? */
async function isFamilyBroughtOnly(db, caregiverUserId) {
  const profile = await db.prepare(
    "SELECT is_background_checked FROM caregiver_profiles WHERE user_id = ?"
  ).get(caregiverUserId);
  if (profile && profile.is_background_checked) return false;
  const row = await db.prepare(
    "SELECT id FROM bg_admin_vouches WHERE caregiver_user_id = ? AND note = ? AND revoked_at IS NULL LIMIT 1"
  ).get(caregiverUserId, FAMILY_BROUGHT_NOTE);
  return !!row;
}

module.exports = {
  KIND, FAMILY_BROUGHT_NOTE, INVITE_DAYS, OPEN_CAP_PER_LEADER,
  recipientIfLeader, relationshipFor,
  fulfillKnownCaregiverInvite, fulfillPendingForUser, isFamilyBroughtOnly,
};
