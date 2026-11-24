// ─── v1.109.7 — who is told when a caregiver arrives and leaves ───
//
// Pete (b3c808fd, 9/26): "Everyone on the Care team is still getting all the notifications for
// everything Mom does. For instance, Julia gets notifications when Tina arrives or leaves."
//
// Until now every visit-lifecycle push (arriving soon, on my way, 5 min away, checked in,
// wrapping up, late, running over, complete, booking accepted) went to every care_team_members
// row, copy-pasted in six places, with no filter at all. Julia is a caregiver on Betty's team,
// so she was told about every one of Tina's visits.
//
// Pete's rule, 9/28 — TWO KEYS:
//   1. the team leader ALLOWS a member to receive visit updates   (visit_updates_allowed)
//   2. the member TURNS THEM ON for themselves                     (visit_updates_opt_in)
// Both must be true. The leader (and the recipient's owner) is always allowed and is on by
// default; everyone else starts not allowed and off (migration 049, Pete: "everyone off, you
// allow"). The account-wide "Session status changes" switch (push_session_status) is a master
// off on top of that — before this it was tied to nothing and did nothing.
//
// This does NOT touch a caregiver's pushes about her OWN visit — those are sent to
// session.caregiver_user_id directly and are her work, not an update about Betty.

function isLeadRow(row) {
  return row.role === "leader" || (row.owner_id && row.user_id === row.owner_id);
}

function masterOff(prefsJson) {
  if (!prefsJson) return false;
  try { return JSON.parse(prefsJson).push_session_status === false; } catch { return false; }
}

/** Does this membership row receive visit updates? (Exported for the UI payloads and tests.) */
function receivesVisitUpdates(row) {
  const lead = isLeadRow(row);
  const allowed = lead || Number(row.visit_updates_allowed) === 1;
  if (!allowed) return false;
  const opt = row.visit_updates_opt_in;
  const on = opt === null || opt === undefined ? lead : Number(opt) === 1;
  return on && !masterOff(row.notification_prefs);
}

/**
 * The user ids to tell about a visit to this care recipient, excluding `exclude`
 * (the caregiver doing the visit, the actor). De-duplicated.
 */
async function visitUpdateAudience(db, careRecipientId, { exclude = [] } = {}) {
  const skip = new Set(exclude.filter(Boolean));
  const out = new Set();
  const rows = await db.prepare(`
    SELECT ctm.user_id, ctm.role, ctm.visit_updates_allowed, ctm.visit_updates_opt_in,
      u.notification_prefs, cr.family_user_id AS owner_id
    FROM care_team_members ctm
    JOIN care_teams ct ON ctm.care_team_id = ct.id
    JOIN care_recipients cr ON ct.care_recipient_id = cr.id
    JOIN users u ON u.id = ctm.user_id
    WHERE ct.care_recipient_id = ?
  `).all(careRecipientId);
  for (const r of rows) {
    if (!skip.has(r.user_id) && receivesVisitUpdates(r)) out.add(r.user_id);
  }
  // The owner with no team row (a recipient added before care teams existed) keeps getting
  // them, as the old fallback did — still subject to the master switch.
  if (!rows.some((r) => r.user_id === r.owner_id)) {
    const owner = await db.prepare(`
      SELECT cr.family_user_id AS user_id, u.notification_prefs
      FROM care_recipients cr JOIN users u ON u.id = cr.family_user_id WHERE cr.id = ?
    `).get(careRecipientId);
    if (owner && owner.user_id && !skip.has(owner.user_id) && !masterOff(owner.notification_prefs)) {
      out.add(owner.user_id);
    }
  }
  return [...out];
}

module.exports = { visitUpdateAudience, receivesVisitUpdates, isLeadRow };
