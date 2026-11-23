// ─── Who may ring whom (v1.106.4, moved here v1.153.0) ───
//
// `call_invite` once took `targetUserId` and `callerName` straight off the wire, so any socket
// could light up any phone all night. The rule is the one people already understand from the
// rest of the app: you can call someone you can already message — a shared conversation.
//
// v1.153.0 — and the care team can call the person they care for, and she them. Pete, 11/23:
// "I want calling in app. I want her to be able to receive video and voice calls." Her Call
// buttons (Simple screen, InPlace Hub) ring the care team people the leader picked, and a
// family member on her team must be able to ring her screen without first having a chat open
// with her. Only a TRUSTED own-account link counts (utils/linkedAccount.js): a stale link is
// not the person, and gets nobody's calls.

const { TRUSTED_LINK_SQL } = require("./linkedAccount");

/** Is `linkedId` the trusted own account of a person whose care team (or owner) includes `otherId`? */
async function sameCareCircle(db, linkedId, otherId) {
  const row = await db.prepare(`
    SELECT 1 FROM care_recipients cr
    WHERE cr.linked_user_id = ? AND ${TRUSTED_LINK_SQL}
      AND (cr.family_user_id = ? OR EXISTS (
        SELECT 1 FROM care_team_members ctm JOIN care_teams ct ON ct.id = ctm.care_team_id
        WHERE ct.care_recipient_id = cr.id AND ctm.user_id = ?))
    LIMIT 1
  `).get(linkedId, otherId, otherId);
  return !!row;
}

async function mayCall(db, callerId, targetUserId) {
  if (!callerId || !targetUserId || callerId === targetUserId) return false;
  const [me, them] = await Promise.all([
    db.prepare("SELECT is_admin FROM users WHERE id = ?").get(callerId),
    db.prepare("SELECT is_admin, COALESCE(is_active,1) AS is_active FROM users WHERE id = ?").get(targetUserId),
  ]);
  if (!them || !them.is_active) return false;
  try {
    const { isBlockedBetween } = require("./blocks");
    if (await isBlockedBetween(db, callerId, targetUserId)) return false;
  } catch { /* blocks unavailable — fall through to the membership test */ }
  if (me?.is_admin || them.is_admin) return true;
  const shared = await db.prepare(`
    SELECT 1 FROM conversation_members a
    JOIN conversation_members b ON a.conversation_id = b.conversation_id
    WHERE a.user_id = ? AND b.user_id = ? LIMIT 1
  `).get(callerId, targetUserId);
  if (shared) return true;
  return (await sameCareCircle(db, targetUserId, callerId)) || (await sameCareCircle(db, callerId, targetUserId));
}

module.exports = { mayCall, sameCareCircle };
