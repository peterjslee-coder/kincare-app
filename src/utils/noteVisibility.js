// ─── Who is allowed to read which notes — decided in ONE place ───
//
// v1.106.38 — this rule already existed, written out longhand in
// src/routes/notes.js. The care-for dashboard (dashboard.js, careForDashboard)
// had no copy of it at all: it served the linked care recipient `SELECT rn.*`,
// every row, including the observations the family wrote ABOUT her that
// GET /api/notes/:careRecipientId explicitly refuses to show her.
//
// So the same question — "may this reader see this note?" — was answered two
// different ways on two screens showing the same care record. Extracting it is
// not tidiness: it is the only way the two screens can't disagree again.
//
// The rule itself (v1.76.0, unchanged):
//   • the linked care recipient sees her OWN notes and visit summaries, but not
//     the observations her family wrote about her (candor vs. dignity — if the
//     family can't write frankly, the record stops being useful; if she reads
//     them, it stops being kind). She is NOT filtered when she is also the
//     family owner of her own record — then there is no "family" to protect.
//   • a caregiver with view-only access via an active session gets observations
//     through the AI-digested briefing, never raw.
//   • everyone else — the owner, team members, admins — sees everything.

/**
 * @param {object} cr    the care_recipients row (needs linked_user_id, family_user_id)
 * @param {boolean} teamOrOwner  reader owns the record or is on the care team
 * @param {string} access  the hasAccess() result ("admin" bypasses)
 * @param {string} userId  the reader
 * @returns {{sql: string, params: string[]}}  a fragment for `WHERE ... ${sql}`,
 *          aliased to `rn`. Empty string when the reader may see everything.
 */
function noteVisibility({ cr, teamOrOwner, access, userId }, alias = "rn") {
  const isLinkedRecipient = !!cr && cr.linked_user_id === userId && cr.family_user_id !== userId;
  const caregiverOnly = !teamOrOwner && access !== "admin" && !isLinkedRecipient;

  if (isLinkedRecipient) {
    return { sql: ` AND (${alias}.note_type != 'observation' OR ${alias}.author_id = ?)`, params: [userId] };
  }
  if (caregiverOnly) {
    return { sql: ` AND ${alias}.note_type != 'observation'`, params: [] };
  }
  return { sql: "", params: [] };
}

/**
 * The team/owner lookup the rule needs. Separated so a caller that already knows
 * the answer (the owner's own dashboard) can skip the query.
 */
async function isTeamOrOwner(db, recipientId, userId) {
  const row = await db.prepare(`
    SELECT 1 FROM care_recipients c
    LEFT JOIN care_teams ct ON ct.care_recipient_id = c.id
    LEFT JOIN care_team_members ctm ON ctm.care_team_id = ct.id AND ctm.user_id = ?
    WHERE c.id = ? AND (c.family_user_id = ? OR ctm.user_id IS NOT NULL)
    LIMIT 1
  `).get(userId, recipientId, userId);
  return !!row;
}

/**
 * The same rule asked about ONE note, for the single-row reads (GET /:id/photo) that cannot
 * use the SQL fragment. Written next to it on purpose: a filter and a per-row check that
 * disagree is worse than either alone — the list hides a note and the photo endpoint serves
 * its picture, or the other way round.
 *
 * @param {object} note  needs note_type and author_id
 * @returns {boolean}
 */
function mayReadNote({ cr, teamOrOwner, access, userId }, note) {
  if (!note) return false;
  const { sql } = noteVisibility({ cr, teamOrOwner, access, userId });
  if (!sql) return true;                          // no filter — everything is readable
  if (note.note_type !== "observation") return true;
  // Both filter shapes allow an observation only when this reader wrote it; the linked
  // recipient's carries `OR rn.author_id = ?`, the caregiver's carries nothing.
  return sql.includes("author_id") && note.author_id === userId;
}

module.exports = { noteVisibility, isTeamOrOwner, mayReadNote };
