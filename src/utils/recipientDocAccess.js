// ─── Who may see a care recipient's legal / consent documents (v1.110.1) ───
//
// Pete, 10/12: "Caregivers should not be able to open any legal documents unless the
// careteam explicitly allows it. Legal docs and medical records are strictly for care teams."
//
// Before this, documents.js `canAccessOwner` answered yes for ANY care-team member and any
// care_recipient_shares row — caregivers included — so a caregiver on Betty's team could list,
// open and download her POA, healthcare POA and consent papers. This file is now the one
// answer for every non-medical document a care recipient owns (medical records answer to
// medicalAccess.js and caregivers never see those at all).
//
//   • Family side of the care team (owner, the recipient's own linked account, the leader,
//     non-caregiver team members, non-caregiver shares) → may see them.
//   • A caregiver → only the specific documents the family has shared with her, one by one
//     (`recipient_doc_shares`). Shared by the owner, the leader or the member herself.
//   • Admin → may see them (consent / POA verification is an admin job). Medical stays out.
//
// "Caregiver" is decided the same way as for medical records: a caregiver profile or the
// caregiver role. Holding the role only ever REMOVES access here.

const { isCaregiverUser, trustedLinkedUserId } = require("./medicalAccess");

async function recipientRow(db, careRecipientId) {
  if (!careRecipientId) return null;
  return db.prepare("SELECT id, family_user_id, linked_user_id FROM care_recipients WHERE id = ?").get(careRecipientId);
}

async function teamRole(db, careRecipientId, userId) {
  const row = await db.prepare(`
    SELECT ctm.role FROM care_team_members ctm
    JOIN care_teams ct ON ct.id = ctm.care_team_id
    WHERE ct.care_recipient_id = ? AND ctm.user_id = ?
    LIMIT 1
  `).get(careRecipientId, userId);
  return row ? row.role : null;
}

/**
 * @returns {Promise<{exists:boolean, family:boolean, canManage:boolean, isCaregiver:boolean, onTeam:boolean}>}
 *   family    — may see every non-medical document this recipient owns
 *   canManage — may share a document with a caregiver (owner, leader, the member herself)
 */
async function recipientDocRole(db, careRecipientId, userId) {
  const none = { exists: false, family: false, canManage: false, isCaregiver: false, onTeam: false };
  const cr = await recipientRow(db, careRecipientId);
  if (!cr || !userId) return none;
  const role = await teamRole(db, careRecipientId, userId);
  const isOwner = cr.family_user_id === userId;
  // v1.111.2 — a linked account that is on no team is not the person (see medicalAccess).
  const linked = await trustedLinkedUserId(db, cr);
  const isMember = !!linked && linked === userId;
  const isLeader = role === "leader";
  const canManage = isOwner || isMember || isLeader;
  const isCaregiver = await isCaregiverUser(db, userId);
  let family = canManage;
  if (!family && !isCaregiver) {
    if (role) family = true;
    else {
      const share = await db.prepare(
        "SELECT 1 FROM care_recipient_shares WHERE care_recipient_id = ? AND shared_with_user_id = ?"
      ).get(careRecipientId, userId);
      family = !!share;
    }
  }
  return { exists: true, family, canManage, isCaregiver, onTeam: !!role };
}

/** Has this document been shared with this person explicitly? */
async function isSharedWith(db, documentId, userId) {
  const row = await db.prepare(
    "SELECT 1 FROM recipient_doc_shares WHERE document_id = ? AND user_id = ?"
  ).get(documentId, userId);
  return !!row;
}

/** May this user open this (non-medical, care_recipient-owned) document? */
async function canViewRecipientDoc(db, doc, userId, isAdmin) {
  if (!doc || doc.owner_type !== "care_recipient" || doc.category === "medical") return false;
  if (isAdmin) return true;
  const r = await recipientDocRole(db, doc.owner_id, userId);
  if (!r.exists) return false;
  if (r.family) return true;
  return isSharedWith(db, doc.id, userId);
}

/**
 * Caregivers the family could share this recipient's documents with: caregivers on the care
 * team, plus any caregiver who has had a visit booked with this recipient.
 */
async function shareableCaregivers(db, careRecipientId) {
  const rows = await db.prepare(`
    SELECT DISTINCT u.id, u.first_name, u.last_name
    FROM users u
    WHERE u.id IN (
      SELECT ctm.user_id FROM care_team_members ctm
        JOIN care_teams ct ON ct.id = ctm.care_team_id
        WHERE ct.care_recipient_id = ?
      UNION
      SELECT cp.user_id FROM care_sessions cs
        JOIN caregiver_profiles cp ON cp.id = cs.caregiver_id
        WHERE cs.care_recipient_id = ?
    )
  `).all(careRecipientId, careRecipientId);
  const out = [];
  for (const r of rows) {
    if (await isCaregiverUser(db, r.id)) out.push(r);
  }
  return out;
}

module.exports = { recipientDocRole, canViewRecipientDoc, isSharedWith, shareableCaregivers };
