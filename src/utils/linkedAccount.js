// ─── Is a care recipient's "own account" link real? — decided in ONE place ───
//
// care_recipients.linked_user_id marks the recipient's OWN account (a care_for user, a capable
// adult managing her own care). v1.111.2 found Betty's profile carrying a link to an unrelated
// real person, left over from a March care_for self-signup, and the app treated that person as
// Betty. A GENUINE link is always also one of:
//
//   · the record's owner (family_user_id = linked_user_id — she signed up for herself), or
//   · on her care team (care_team_members via care_teams.care_recipient_id) — accepting a
//     care_recipient invite adds her as a member.
//
// A link that is neither is STALE: the account is not the person, and gets nothing that the
// person would get — not her dashboard, her visits, her messages contacts, her notifications,
// her documents. Every read that treats linked_user_id as "this is her" must go through this
// file: the JS check for a row in hand, or the SQL fragment for "recipients where I am the
// linked user". Writes that CLEAR links (account deletion) do not need it.
//
// GET /api/admin/integrity/linked-accounts lists the stale ones; an admin can unlink there.

/**
 * SQL boolean: the row aliased `alias` has a TRUSTED linked account. Self-contained (no
 * placeholders). Inner aliases are prefixed tl_ so they never collide with the outer query's.
 */
function trustedLinkSql(alias = "cr") {
  return `(${alias}.linked_user_id IS NOT NULL AND (${alias}.family_user_id = ${alias}.linked_user_id`
    + ` OR EXISTS (SELECT 1 FROM care_team_members tl_ctm JOIN care_teams tl_ct ON tl_ct.id = tl_ctm.care_team_id`
    + ` WHERE tl_ct.care_recipient_id = ${alias}.id AND tl_ctm.user_id = ${alias}.linked_user_id)))`;
}

/** The fragment for the usual `care_recipients cr` alias. */
const TRUSTED_LINK_SQL = trustedLinkSql("cr");

/** SQL expression: the linked user id if trusted, else NULL. For SELECT lists / JOIN conditions. */
function trustedLinkedIdSql(alias = "cr") {
  return `(CASE WHEN ${trustedLinkSql(alias)} THEN ${alias}.linked_user_id END)`;
}

/** For a care_recipients row in hand (needs id, family_user_id, linked_user_id). */
async function trustedLinkedUserId(db, cr) {
  if (!cr || !cr.linked_user_id) return null;
  if (cr.family_user_id === cr.linked_user_id) return cr.linked_user_id;
  const row = await db.prepare(`
    SELECT 1 FROM care_team_members ctm
    JOIN care_teams ct ON ct.id = ctm.care_team_id
    WHERE ct.care_recipient_id = ? AND ctm.user_id = ?
    LIMIT 1
  `).get(cr.id, cr.linked_user_id);
  return row ? cr.linked_user_id : null;
}

/** Is `userId` this recipient's own, trusted, linked account? */
async function isTrustedLinkedUser(db, cr, userId) {
  if (!userId) return false;
  return (await trustedLinkedUserId(db, cr)) === userId;
}

/**
 * The care recipient record this user is the TRUSTED linked account of, or undefined.
 * `columns` is a select list over alias `cr` (default `cr.id`). Oldest first so the answer is
 * stable if two rows ever carry the same link.
 */
async function recipientForLinkedUser(db, userId, columns = "cr.id") {
  if (!userId) return undefined;
  return db.prepare(`
    SELECT ${columns} FROM care_recipients cr
    WHERE cr.linked_user_id = ? AND ${TRUSTED_LINK_SQL}
    ORDER BY cr.created_at ASC
    LIMIT 1
  `).get(userId);
}

module.exports = {
  trustedLinkSql, TRUSTED_LINK_SQL, trustedLinkedIdSql,
  trustedLinkedUserId, isTrustedLinkedUser, recipientForLinkedUser,
};
