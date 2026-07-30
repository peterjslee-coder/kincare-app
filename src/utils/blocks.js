// ─── User blocking — the single source of truth (v1.105.13) ───
//
// App Review guideline 1.2 requires a way to block abusive users. The hard part is not
// storing the block, it is HONORING it: messages.js has no single chokepoint, so a block
// has to be applied at eight separate places (conversation list, last-message preview,
// unread count, the legacy virtual-conversation path, the message query, the contacts
// list, both send endpoints) plus the socket emit and the push send.
//
// A filter that covers the message list but not the push notification means a blocked
// person's text still lands on the other person's lock screen. That is the failure this
// module exists to prevent: every one of those call sites asks THIS file, so there is one
// definition of "blocked" to get right instead of eight to keep in sync.
//
// BLOCKING IS SYMMETRIC. If either party blocked the other, neither sees the other. This
// is a product decision (7/30, Pete): blocks are disclosed, not silent. It is also forced —
// blocking cancels the other party's future visits, so they find out regardless. Silence
// was never actually on the table, and pretending otherwise would just make the app lie.
//
// Blocking is NOT the abuse tool. Reporting is (content_reports) — quiet, admin-only,
// never disclosed. Someone frightened of a caregiver should report, not block, because
// telling an abuser "you have been blocked" can escalate. Keep the two apart.

const { v4: uuid } = require("uuid");

/**
 * Every user id this user cannot see, in either direction.
 *
 * Returns a Set for O(1) membership: callers filter arrays of messages and conversations
 * against it, and a linear scan per row is how a safety check quietly becomes a
 * performance bug on a busy thread.
 */
async function getBlockedIds(db, userId) {
  if (!userId) return new Set();
  try {
    const rows = await db.prepare(`
      SELECT blocked_user_id AS other FROM user_blocks WHERE blocker_user_id = ?
      UNION
      SELECT blocker_user_id AS other FROM user_blocks WHERE blocked_user_id = ?
    `).all(userId, userId);
    return new Set(rows.map((r) => r.other));
  } catch (e) {
    // Fail OPEN, deliberately, and say so loudly.
    //
    // The alternative — fail closed, hide everything — turns a transient database blip
    // into "all my messages vanished", which in a care app reads as data loss and will
    // generate a support call from a frightened family. A block leaking for the seconds
    // a query is failing is the lesser harm, and the log line is what makes it findable.
    console.error("[blocks] getBlockedIds failed, allowing through:", e.message);
    return new Set();
  }
}

/**
 * Is there a block between these two, in either direction?
 * For send paths, where building a whole Set to check one id is wasteful.
 */
async function isBlockedBetween(db, aUserId, bUserId) {
  if (!aUserId || !bUserId || aUserId === bUserId) return false;
  try {
    const row = await db.prepare(`
      SELECT 1 AS hit FROM user_blocks
      WHERE (blocker_user_id = ? AND blocked_user_id = ?)
         OR (blocker_user_id = ? AND blocked_user_id = ?)
      LIMIT 1
    `).get(aUserId, bUserId, bUserId, aUserId);
    return !!row;
  } catch (e) {
    console.error("[blocks] isBlockedBetween failed, allowing through:", e.message);
    return false;
  }
}

/**
 * Who did *I* block (as opposed to who blocked me)?
 *
 * The distinction matters for the UI: a conversation I blocked shows "You blocked X —
 * Unblock", which is the affordance that lets someone undo an impulsive block. A
 * conversation where THEY blocked ME must not offer me an unblock button I cannot honour.
 */
async function getOutgoingBlocks(db, userId) {
  if (!userId) return [];
  try {
    return await db.prepare(`
      SELECT ub.id, ub.blocked_user_id, ub.reason, ub.created_at,
             u.first_name, u.last_name, u.role, u.profile_photo, u.avatar_url
      FROM user_blocks ub
      JOIN users u ON u.id = ub.blocked_user_id
      WHERE ub.blocker_user_id = ?
      ORDER BY ub.created_at DESC
    `).all(userId);
  } catch (e) {
    console.error("[blocks] getOutgoingBlocks failed:", e.message);
    return [];
  }
}

/**
 * Can this user enact a block themselves, or must a care team leader approve it?
 *
 * Pete's rule (7/30): "if they manage it, they use it with full power. if it's a managed
 * account (like Betty's), then no, they cannot without care team leader approving."
 *
 * The codebase records "manages themselves" in three places that DISAGREE —
 * `linked_user_id`, `permission_tier`, and `authorization_tier` — so picking the wrong one
 * silently gets this backwards, which means either stripping agency from someone entitled
 * to it or letting a managed account sever its own care coordination. The unambiguous
 * signal is in auth.js: a care recipient who signs up for themselves gets
 * `family_user_id === linked_user_id`, both set to their own user id. Someone else's
 * profile always has a different family_user_id. That equality IS self-management, and it
 * cannot drift the way a denormalised tier column can.
 *
 * `permission_tier = 'managed'` is honoured as an explicit override on top, because a
 * family can deliberately move a self-signed-up recipient into managed mode later.
 *
 * Everyone who is not a care recipient — family, caregiver, admin — manages their own
 * account by definition and always blocks directly.
 */
async function canBlockDirectly(db, userId, activeRole) {
  if (!userId) return { allowed: false, reason: "no_user" };
  if (activeRole !== "care_for") return { allowed: true };

  try {
    const rec = await db.prepare(
      "SELECT id, family_user_id, linked_user_id, permission_tier FROM care_recipients WHERE linked_user_id = ?"
    ).get(userId);

    // No recipient profile: nothing is managing them, so they are self-directed.
    if (!rec) return { allowed: true };

    if (rec.permission_tier === "managed") {
      return { allowed: false, reason: "managed", recipientId: rec.id };
    }
    if (rec.family_user_id !== rec.linked_user_id) {
      return { allowed: false, reason: "managed", recipientId: rec.id };
    }
    return { allowed: true, recipientId: rec.id };
  } catch (e) {
    // Fail toward ASKING rather than toward acting. A block has consequences — cancelled
    // visits, a notified caregiver — and routing an uncertain case to a human leader is
    // recoverable in a way that an unintended cancellation is not. This is the opposite
    // default from getBlockedIds above, and deliberately so: there, failing open risks a
    // leaked message; here, failing open risks cancelling real care.
    console.error("[blocks] canBlockDirectly failed, routing to approval:", e.message);
    return { allowed: false, reason: "unknown" };
  }
}

/**
 * The care team leader who approves block requests for a managed recipient.
 * Mirrors the reimbursements approver shape: billing contact if set, else the leader.
 */
async function findApprover(db, recipientId) {
  try {
    const team = await db.prepare(
      "SELECT id, billing_user_id FROM care_teams WHERE care_recipient_id = ?"
    ).get(recipientId);
    if (!team) return null;
    if (team.billing_user_id) return { careTeamId: team.id, userId: team.billing_user_id };
    const leader = await db.prepare(
      "SELECT user_id FROM care_team_members WHERE care_team_id = ? AND role = 'leader'"
    ).get(team.id);
    return leader ? { careTeamId: team.id, userId: leader.user_id } : { careTeamId: team.id, userId: null };
  } catch (e) {
    console.error("[blocks] findApprover failed:", e.message);
    return null;
  }
}

module.exports = {
  uuid,
  getBlockedIds,
  isBlockedBetween,
  getOutgoingBlocks,
  canBlockDirectly,
  findApprover,
};
