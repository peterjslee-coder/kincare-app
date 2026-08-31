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

  // v1.105.78 — returns the legacy level string, unchanged, so every existing caller behaves
  // exactly as before. Callers that need the finer grain use recipientCapabilities() below.
  const shared = await db.prepare(
    "SELECT permission, capabilities FROM care_recipient_shares WHERE care_recipient_id = ? AND shared_with_user_id = ?"
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
 * The capability list for this user against this recipient (v1.105.78).
 *
 * Deliberately separate from recipientAccess() rather than replacing it: ten route files read
 * that function, and a big-bang change to all of them is how a permission bug ships. Callers
 * move over one at a time, and until they do the legacy mapping in utils/capabilities.js keeps
 * them behaving identically.
 *
 * @returns {Promise<string[]>} empty array when the user has no access at all
 */
async function recipientCapabilities(db, recipientId, userId) {
  const { capabilitiesFor, LEGACY } = require("./capabilities");
  if (!recipientId || !userId) return [];

  const user = await db.prepare("SELECT is_admin FROM users WHERE id = ?").get(userId);
  if (user?.is_admin) return [...LEGACY.admin];

  const owned = await db.prepare(
    "SELECT id FROM care_recipients WHERE id = ? AND family_user_id = ?"
  ).get(recipientId, userId);
  if (owned) return [...LEGACY.owner];

  // A share is the only thing that can carry an explicit capability set today.
  const shared = await db.prepare(
    "SELECT permission, capabilities FROM care_recipient_shares WHERE care_recipient_id = ? AND shared_with_user_id = ?"
  ).get(recipientId, userId);
  if (shared) return capabilitiesFor(shared.capabilities, shared.permission);

  // Everything below has no per-person grant, so it maps through the legacy levels — which is
  // what these paths already resolved to.
  const teamMember = await db.prepare(`
    SELECT ctm.role FROM care_team_members ctm
    JOIN care_teams ct ON ctm.care_team_id = ct.id
    WHERE ct.care_recipient_id = ? AND ctm.user_id = ?
  `).get(recipientId, userId);
  if (teamMember) return capabilitiesFor(null, teamMember.role === "leader" ? "edit" : "view");

  const assignedCg = await db.prepare(`
    SELECT cs.id FROM care_sessions cs
    JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
    WHERE cs.care_recipient_id = ? AND cp.user_id = ?
      AND cs.status IN ('confirmed', 'in_progress')
    LIMIT 1
  `).get(recipientId, userId);
  if (assignedCg) return capabilitiesFor(null, "view");

  return [];
}

/**
 * Everyone who should be TOLD about something, given what they are allowed to see (v1.105.81).
 *
 * The note, care-task and family-visit fan-outs each selected every care_team_member for the
 * recipient and pushed to all of them. With per-invitation capabilities that is wrong in a way
 * that matters: Peggy is on the team to leave a note and record a visit, and is deliberately
 * denied the care record — yet she would receive "New note — Betty" for a note she cannot open.
 * A notification about something you are not allowed to see is both useless and a small leak:
 * it tells you a thing happened, and to whom.
 *
 * The rule: you are only notified about what you could go and read.
 *
 * NOTE this is separate from teamUserIds() in careTasks.js, which feeds the who-did-it picker
 * as well as the escalation push. That picker must keep listing everyone — Peggy needs to be
 * selectable as the person who gave the medication even though she is not notified about it.
 * Filtering there would have quietly removed her from the list.
 *
 * @returns {Promise<string[]>} user ids holding `cap`
 */
async function usersWithCapability(db, recipientId, cap) {
  const { can } = require("./capabilities");
  if (!recipientId || !cap) return [];

  const rows = await db.prepare(`
    SELECT DISTINCT u.id
    FROM users u
    WHERE COALESCE(u.is_active, 1) = 1
      AND u.id IN (
        SELECT family_user_id FROM care_recipients WHERE id = ?
        UNION
        SELECT ctm.user_id FROM care_team_members ctm
        JOIN care_teams ct ON ctm.care_team_id = ct.id
        WHERE ct.care_recipient_id = ?
        UNION
        SELECT shared_with_user_id FROM care_recipient_shares WHERE care_recipient_id = ?
      )
  `).all(recipientId, recipientId, recipientId);

  const allowed = [];
  for (const r of rows) {
    const caps = await recipientCapabilities(db, recipientId, r.id);
    if (can(caps, cap)) allowed.push(r.id);
  }
  return allowed;
}

/**
 * The inverse of usersWithCapability: which care recipients grant THIS user a capability.
 *
 * v1.105.153. Pete: "not all caregivers should get it...it's just that Julia IS on Betty's
 * care team AND she's a caregiver" and "not all caregivers will be on the care team."
 *
 * So the question a notes screen must ask is never "is this person a caregiver". It is "which
 * care recipients has this person been given the care record for" — the same three sources
 * usersWithCapability walks (owner, care_team_members, care_recipient_shares), read from the
 * other end, and then the same capability check. A caregiver who is merely assigned to a
 * session is in none of those sets and gets an empty list, which is the intended answer.
 */
async function recipientsWithCapabilityFor(db, userId, cap) {
  const { can } = require("./capabilities");
  if (!userId || !cap) return [];

  const rows = await db.prepare(`
    SELECT DISTINCT cr.id, cr.first_name, cr.last_name, cr.timezone
    FROM care_recipients cr
    LEFT JOIN care_teams ct ON ct.care_recipient_id = cr.id
    LEFT JOIN care_team_members ctm ON ctm.care_team_id = ct.id AND ctm.user_id = ?
    LEFT JOIN care_recipient_shares s ON s.care_recipient_id = cr.id AND s.shared_with_user_id = ?
    WHERE cr.family_user_id = ? OR ctm.user_id IS NOT NULL OR s.id IS NOT NULL
    ORDER BY cr.first_name
  `).all(userId, userId, userId);

  const allowed = [];
  for (const r of rows) {
    const caps = await recipientCapabilities(db, r.id, userId);
    if (can(caps, cap)) allowed.push(r);
  }
  return allowed;
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

module.exports = {
  recipientCapabilities, usersWithCapability, recipientsWithCapabilityFor,
  recipientAccess, sessionAccess };
