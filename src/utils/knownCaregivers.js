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
 * v1.105.192 — she signed up on her own, with the same email the family invited.
 *
 * Tina, Sep 12: Pete added her by email on the 10th; she found the app herself and made an
 * account the normal way. Her invite sat "pending" while Pete vouched and assigned her by
 * hand, then asked why she had not "automatically show[n] up as an assigned caregiver". The
 * link was never the point — the EMAIL was. So a pending, unexpired known-caregiver invite
 * whose email matches a caregiver account is claimed by that account: gate row, assignment
 * when a profile exists, phone kept, leader told. Same writes as accept-invite, minus the token.
 */
async function claimPendingByEmail(db, caregiverUserId, email) {
  if (!caregiverUserId || !email) return [];
  const invites = await db.prepare(`
    SELECT * FROM platform_invites
    WHERE kind = ? AND status = 'pending' AND expires_at > NOW() AND LOWER(invited_email) = LOWER(?)
  `).all(KIND, email);
  const claimed = [];
  for (const inv of invites) {
    const r = await db.prepare(
      "UPDATE platform_invites SET status = 'accepted' WHERE id = ? AND status = 'pending'"
    ).run(inv.id);
    if (r && r.changes === 0) continue;
    await fulfillKnownCaregiverInvite(db, inv, caregiverUserId);
    if (inv.phone) {
      await db.prepare("UPDATE users SET phone = COALESCE(NULLIF(phone, ''), ?) WHERE id = ?").run(inv.phone, caregiverUserId);
    }
    try {
      const u = await db.prepare("SELECT first_name, last_name, email FROM users WHERE id = ?").get(caregiverUserId);
      const name = `${u.first_name || ""} ${u.last_name || ""}`.trim() || u.email;
      const recipient = await db.prepare("SELECT first_name FROM care_recipients WHERE id = ?").get(inv.care_recipient_id);
      const rf = recipient ? recipient.first_name : "your loved one";
      await db.prepare(
        "INSERT INTO activity_feed (id, family_user_id, care_recipient_id, event_type, title, message) VALUES (?, ?, ?, 'known_caregiver_joined', ?, ?)"
      ).run(uuid(), inv.invited_by, inv.care_recipient_id, `${name} is setting up`,
        `${name} made an account with the email you invited, so they're set up as ${rf}'s caregiver. You can book them once they're set up to be paid and have sent a photo of their licence.`);
      const { sendPushToUser } = require("../routes/push");
      await sendPushToUser(inv.invited_by, {
        title: `${name} is setting up`,
        body: `They signed up with the email you invited for ${rf}.`,
        data: { type: "known_caregiver_joined", careRecipientId: inv.care_recipient_id, page: "caregivers" },
      });
    } catch (e) { console.error("known-caregiver claim notify (non-blocking):", e.message); }
    claimed.push(inv.id);
  }
  return claimed;
}

/**
 * Called when a caregiver profile is first created. The invite was accepted at step 1, before
 * a profile existed, so the assignment could not be written then. Finish it now.
 */
async function fulfillPendingForUser(db, caregiverUserId) {
  const user = await db.prepare("SELECT email FROM users WHERE id = ?").get(caregiverUserId);
  if (!user || !user.email) return [];
  // v1.105.192 — an invite she never clicked but whose email is hers.
  await claimPendingByEmail(db, caregiverUserId, user.email);
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

/**
 * Progress on the short path for the leader's "2 of 4 done" line. Four jobs: account, quick
 * details (a profile exists), pay (Stripe), licence photo (SUBMITTED counts — approval is our
 * wait, not hers).
 */
async function progressFor(db, email) {
  const { caregiverIdentityDoc } = require("./identity");
  const user = await db.prepare("SELECT id FROM users WHERE LOWER(email) = LOWER(?)").get(email);
  if (!user) return { userId: null, account: false, details: false, pay: false, licence: false, done: 0, of: 4, ready: false };
  const profile = await db.prepare(
    "SELECT id, stripe_onboard_complete FROM caregiver_profiles WHERE user_id = ?"
  ).get(user.id);
  const doc = await caregiverIdentityDoc(db, user.id, profile ? profile.id : null);
  const p = { userId: user.id, account: true, details: !!profile, pay: !!(profile && profile.stripe_onboard_complete), licence: !!doc };
  p.done = ["account", "details", "pay", "licence"].filter((k) => p[k]).length;
  p.of = 4;
  p.ready = p.done === 4;
  return p;
}

/**
 * v1.105.188 — "I want a notification when she's joined." The accept push says she is SETTING
 * UP; this one says she is READY TO BOOK, which is the moment the family actually wants. Called
 * after each thing that can be the last thing (Stripe completing, the licence photo landing).
 * Marks the invite `ready` so it fires once. Fire-and-forget at every call site.
 */
async function notifyIfReadyToBook(db, caregiverUserId) {
  const user = await db.prepare("SELECT id, email, first_name, last_name FROM users WHERE id = ?").get(caregiverUserId);
  if (!user || !user.email) return [];
  const invites = await db.prepare(`
    SELECT * FROM platform_invites
    WHERE kind = ? AND status = 'accepted' AND LOWER(invited_email) = LOWER(?)
  `).all(KIND, user.email);
  if (invites.length === 0) return [];
  const progress = await progressFor(db, user.email);
  if (!progress.ready) return [];
  const name = `${user.first_name || ""} ${user.last_name || ""}`.trim() || user.email;
  const fired = [];
  for (const inv of invites) {
    // Claim it first so two racing call sites cannot both notify.
    const claimed = await db.prepare(
      "UPDATE platform_invites SET status = 'ready' WHERE id = ? AND status = 'accepted'"
    ).run(inv.id);
    if (!claimed || (claimed.changes !== undefined && claimed.changes === 0)) continue;
    const recipient = await db.prepare("SELECT id, first_name FROM care_recipients WHERE id = ?").get(inv.care_recipient_id);
    const rf = recipient ? recipient.first_name : "your loved one";
    try {
      await db.prepare(
        "INSERT INTO activity_feed (id, family_user_id, care_recipient_id, event_type, title, message) VALUES (?, ?, ?, 'known_caregiver_ready', ?, ?)"
      ).run(uuid(), inv.invited_by, inv.care_recipient_id, `${name} is ready to book`,
        `${name} is set up to be paid and has sent a photo of their licence. Book them for ${rf} from the Caregivers tab.`);
      const { sendPushToUser } = require("../routes/push");
      await sendPushToUser(inv.invited_by, {
        title: `${name} is ready to book`,
        body: `Set up to be paid, licence photo in. Book them for ${rf} whenever you like.`,
        data: { type: "known_caregiver_ready", careRecipientId: inv.care_recipient_id, page: "caregivers" },
      });
    } catch (e) {
      console.error("known-caregiver ready notify (non-blocking):", e.message);
    }
    fired.push(inv.id);
  }
  return fired;
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
  progressFor, notifyIfReadyToBook, claimPendingByEmail,
};
