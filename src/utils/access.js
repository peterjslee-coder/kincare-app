// ─── Canonical access checks (v1.105.35) ───
//
// The Aug 4 audit found six endpoints that were `authenticate`-gated and nothing more.
// Authentication answers "who are you"; every one of these needed "and does this row have
// anything to do with you". A logged-in stranger could read any session by id — including
// the recipient's home address, the caregiver's visit log (arrival mood, condition tags,
// care feedback) and the visit photos — and could drive any session's status transition,
// including cancelling a confirmed visit or marking one completed.
//
// Route files already carried three near-identical `hasAccess` helpers (careRecipients.js,
// careTasks.js, notes.js). Those are left alone deliberately — rewriting three working call
// sites to prove a point is how you break something on a Tuesday. This module is where NEW
// checks come from, and where the ones added in this pass live.
//
// Convention: callers answer a failed check with 404, not 403. "You may not see this" and
// "this does not exist" should be indistinguishable to someone probing ids.

/**
 * What access, if any, does `userId` have to `recipientId`?
 * Returns "admin" | "owner" | "edit" | "view" | null — the same vocabulary the route-local
 * helpers already return, so it reads the same at the call sites.
 */
async function recipientAccess(db, recipientId, userId) {
  if (!recipientId || !userId) return null;

  const user = await db.prepare("SELECT is_admin FROM users WHERE id = ?").get(userId);
  if (user?.is_admin) return "admin";

  const owned = await db.prepare(
    "SELECT id FROM care_recipients WHERE id = ? AND family_user_id = ?"
  ).get(recipientId, userId);
  if (owned) return "owner";

  const shared = await db.prepare(
    "SELECT permission FROM care_recipient_shares WHERE care_recipient_id = ? AND shared_with_user_id = ?"
  ).get(recipientId, userId);
  if (shared) return shared.permission;

  const teamMember = await db.prepare(`
    SELECT ctm.role FROM care_team_members ctm
    JOIN care_teams ct ON ctm.care_team_id = ct.id
    WHERE ct.care_recipient_id = ? AND ctm.user_id = ?
  `).get(recipientId, userId);
  if (teamMember) return teamMember.role === "leader" ? "edit" : "view";

  // A caregiver with a live booking can see the recipient — that is the whole job.
  const assignedCg = await db.prepare(`
    SELECT cs.id FROM care_sessions cs
    JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
    WHERE cs.care_recipient_id = ? AND cp.user_id = ?
      AND cs.status IN ('confirmed', 'in_progress')
    LIMIT 1
  `).get(recipientId, userId);
  if (assignedCg) return "view";

  return null;
}

/**
 * Access to one session. Returns null when the session does not exist OR the user has no
 * business with it — the caller cannot tell the two apart, and neither can an attacker.
 *
 * { session, isAdmin, isFamily, isCaregiver, canView, canManage }
 *
 * canManage = may change the session's state (status, cancellation). The booking family and
 * the assigned caregiver both qualify: the caregiver has to be able to start and finish the
 * visit. A care-team member with only view access does not.
 */
async function sessionAccess(db, sessionId, userId) {
  if (!sessionId || !userId) return null;

  const session = await db.prepare("SELECT * FROM care_sessions WHERE id = ?").get(sessionId);
  if (!session) return null;

  const user = await db.prepare("SELECT is_admin FROM users WHERE id = ?").get(userId);
  const isAdmin = !!user?.is_admin;
  const isFamily = session.family_user_id === userId;

  let isCaregiver = false;
  if (session.caregiver_id) {
    const cg = await db.prepare(
      "SELECT id FROM caregiver_profiles WHERE id = ? AND user_id = ?"
    ).get(session.caregiver_id, userId);
    isCaregiver = !!cg;
  }

  // Everyone else comes in through the recipient: siblings on the care team, shared users,
  // the recipient themselves. They can look; they cannot drive the session.
  const viaRecipient = (isAdmin || isFamily || isCaregiver)
    ? null
    : await recipientAccess(db, session.care_recipient_id, userId);

  const canView = isAdmin || isFamily || isCaregiver || !!viaRecipient;
  if (!canView) return null;

  return {
    session,
    isAdmin,
    isFamily,
    isCaregiver,
    canView,
    canManage: isAdmin || isFamily || isCaregiver || viaRecipient === "owner" || viaRecipient === "edit",
  };
}

module.exports = { recipientAccess, sessionAccess };
