// ─── Who may see a care recipient's medical records — decided in ONE place ───
//
// Documents Center Phase 1 (migration 050). Pete's rules:
//
//   · The record OWNER — the care recipient's own linked account (care_recipients.linked_user_id),
//     a capable adult managing her own care — always sees her records.
//   · The care team LEADER (or the recipient's family owner, care_recipients.family_user_id)
//     always sees them and decides who else does.
//   · Family members the leader allows ONE BY ONE (medical_record_access).
//   · Caregivers NEVER — even on the care team, even if a grant row somehow exists.
//   · Admins get NO blanket read. There is deliberately no is_admin shortcut in this file.
//
// The iPAi key ("iPAi may read these records") is held by the member if she has an account,
// otherwise by the leader. Default OFF.
//
// Every medical route, and every generic documents route that meets a category='medical' row,
// asks these functions. Do not re-derive any of this inline.

const { v4: uuid } = require("uuid");

/** The leader row for the recipient's care team, if any. */
async function leaderIdFor(db, careRecipientId) {
  const row = await db.prepare(`
    SELECT ctm.user_id FROM care_team_members ctm
    JOIN care_teams ct ON ct.id = ctm.care_team_id
    WHERE ct.care_recipient_id = ? AND ctm.role = 'leader'
    ORDER BY ctm.created_at ASC LIMIT 1
  `).get(careRecipientId);
  return row ? row.user_id : null;
}

async function recipientRow(db, careRecipientId) {
  if (!careRecipientId) return null;
  return db.prepare(
    "SELECT id, family_user_id, linked_user_id, first_name, last_name, called_by FROM care_recipients WHERE id = ?"
  ).get(careRecipientId);
}

/**
 * Is this person a caregiver? A caregiver profile, or the caregiver role on the account.
 * Holding the role only ever REMOVES medical access here, so a self-assigned role cannot be
 * used to gain anything.
 */
async function isCaregiverUser(db, userId) {
  const prof = await db.prepare("SELECT 1 FROM caregiver_profiles WHERE user_id = ? LIMIT 1").get(userId);
  if (prof) return true;
  const u = await db.prepare("SELECT role, roles FROM users WHERE id = ?").get(userId);
  if (!u) return false;
  let roles = [];
  try { roles = u.roles ? (typeof u.roles === "string" ? JSON.parse(u.roles) : u.roles) : []; } catch { roles = []; }
  if (!Array.isArray(roles)) roles = [];
  return u.role === "caregiver" || roles.includes("caregiver");
}

/** Is the user on this recipient's care team (any role)? */
async function isTeamMember(db, careRecipientId, userId) {
  const row = await db.prepare(`
    SELECT ctm.role FROM care_team_members ctm
    JOIN care_teams ct ON ct.id = ctm.care_team_id
    WHERE ct.care_recipient_id = ? AND ctm.user_id = ?
    LIMIT 1
  `).get(careRecipientId, userId);
  return row || null;
}

/** Leader or family owner of the record. */
async function isLeaderOrOwner(db, cr, userId) {
  if (!cr || !userId) return false;
  if (cr.family_user_id === userId) return true;
  const m = await isTeamMember(db, cr.id, userId);
  return !!(m && m.role === "leader");
}

/**
 * The full answer for one person and one recipient.
 * @returns {Promise<{exists: boolean, canView: boolean, canManageAccess: boolean,
 *   isMember: boolean, isLeader: boolean, isGranted: boolean, isKeyHolder: boolean,
 *   keyHolderId: string|null}>}
 */
/**
 * v1.111.2 — the linked account counts as the person herself only if it is ALSO on her care
 * team (or owns the record). A genuine one always is: self-signup makes her the leader, and
 * accepting a care_recipient invite adds her as a member. Betty's profile carried a stale
 * self-signup link to an unrelated account that was on no team; that account was being
 * treated as Betty — key holder, medical records, legal documents.
 */
async function trustedLinkedUserId(db, cr) {
  if (!cr || !cr.linked_user_id) return null;
  if (cr.family_user_id === cr.linked_user_id) return cr.linked_user_id;
  return (await isTeamMember(db, cr.id, cr.linked_user_id)) ? cr.linked_user_id : null;
}

async function medicalRole(db, careRecipientId, userId) {
  const none = { exists: false, canView: false, canManageAccess: false, isMember: false, isLeader: false, isGranted: false, isKeyHolder: false, keyHolderId: null };
  const cr = await recipientRow(db, careRecipientId);
  if (!cr || !userId) return none;
  const keyHolderId = await aiKeyHolder(db, careRecipientId, cr);
  const linked = await trustedLinkedUserId(db, cr);
  const isMember = !!linked && linked === userId;
  const isLeader = await isLeaderOrOwner(db, cr, userId);
  let isGranted = false;
  if (!isMember && !isLeader) {
    const grant = await db.prepare(
      "SELECT 1 FROM medical_record_access WHERE care_recipient_id = ? AND user_id = ?"
    ).get(careRecipientId, userId);
    // A grant counts only while the person is still on the team and is not a caregiver.
    if (grant && (await isTeamMember(db, careRecipientId, userId)) && !(await isCaregiverUser(db, userId))) {
      isGranted = true;
    }
  }
  return {
    exists: true,
    canView: isMember || isLeader || isGranted,
    // The leader decides who else sees them; the member herself may too — they are her records.
    canManageAccess: isLeader || isMember,
    isMember, isLeader, isGranted,
    isKeyHolder: !!keyHolderId && keyHolderId === userId,
    keyHolderId,
  };
}

async function canViewMedical(db, careRecipientId, userId) {
  return (await medicalRole(db, careRecipientId, userId)).canView;
}

async function canManageMedicalAccess(db, careRecipientId, userId) {
  return (await medicalRole(db, careRecipientId, userId)).canManageAccess;
}

/** Who holds the iPAi key: the member if she has an account, otherwise the leader (or owner). */
async function aiKeyHolder(db, careRecipientId, crRow) {
  const cr = crRow || (await recipientRow(db, careRecipientId));
  if (!cr) return null;
  const linked = await trustedLinkedUserId(db, cr);
  if (linked) return linked;
  return (await leaderIdFor(db, careRecipientId)) || cr.family_user_id || null;
}

/** Is the iPAi key ON for this recipient? Default OFF (no row). */
async function aiConsentOn(db, careRecipientId) {
  const row = await db.prepare("SELECT granted FROM medical_ai_consent WHERE care_recipient_id = ?").get(careRecipientId);
  return !!(row && Number(row.granted) === 1);
}

/** Whether a user may be ADDED to the sharing list: on the team, not a caregiver, not already implicit. */
async function grantableReason(db, careRecipientId, targetUserId) {
  const cr = await recipientRow(db, careRecipientId);
  if (!cr) return "not_found";
  if (!(await isTeamMember(db, careRecipientId, targetUserId))) return "not_on_team";
  // "already" first: a leader who also holds the caregiver role (Pete) is the leader here.
  if ((await trustedLinkedUserId(db, cr)) === targetUserId || (await isLeaderOrOwner(db, cr, targetUserId))) return "already";
  if (await isCaregiverUser(db, targetUserId)) return "caregiver";
  return null;
}

/** Write one audit row. Never throws — but logs loudly, because a silent audit gap is the failure. */
async function logMedicalAudit(db, { careRecipientId, documentId = null, actorId = null, eventType, detail = null }) {
  try {
    await db.prepare(`
      INSERT INTO medical_record_audit (id, care_recipient_id, document_id, actor_id, event_type, detail)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(uuid(), careRecipientId, documentId, actorId, eventType, detail ? JSON.stringify(detail) : null);
  } catch (err) {
    console.error("[medical-audit] write failed:", err.message);
  }
}

module.exports = {
  medicalRole, canViewMedical, canManageMedicalAccess, aiKeyHolder, aiConsentOn,
  isCaregiverUser, grantableReason, logMedicalAudit, recipientRow, trustedLinkedUserId,
};
