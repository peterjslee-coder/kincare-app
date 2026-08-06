// ─── "What needs me" — the one canonical count (v1.105.40) ───
//
// Pete: "notification on the app icon when there are unread events that need attention.
// For instance, if Sara needs to approve reimbursements."
//
// The plumbing for a badge is trivial — one field in the APNs payload, one call to
// navigator.setAppBadge. **The definition is the product.** A badge that counts every
// unread activity line sits at 47 forever and teaches everyone to ignore it, which is worse
// than no badge at all: it also trains them to ignore the push notifications attached to it.
//
// So, Pete's call: this counts ONLY things that will not resolve unless THIS PERSON does
// something. Not "what happened while I was away" — that is what the Activity card is for.
// A number here should always mean "you, specifically, are the blocker."
//
//   • a reimbursement waiting on your approval        (Sara's case, the one he asked for)
//   • a session time-change proposal waiting on you
//   • a care task assigned to you and now overdue
//   • an unread direct message
//
// Deliberately NOT counted: activity-feed lines, visits logged by others, notes added,
// check-ins, anything informational. Those are read-when-you-like.
//
// Everything is per-user and computed server-side. Each query fails soft to 0 — a badge is
// a convenience and must never take down a push send or a dashboard load.

async function safe(label, fn) {
  try {
    const n = await fn();
    return Number.isFinite(n) ? n : 0;
  } catch (e) {
    console.log(`[attention] ${label} failed (non-blocking):`, e.message);
    return 0;
  }
}

/**
 * Breakdown + total for one user.
 * @returns {{ total:number, reimbursements:number, timeChanges:number, careTasks:number, messages:number }}
 */
async function attentionCountFor(db, userId) {
  if (!userId) return { total: 0, reimbursements: 0, timeChanges: 0, careTasks: 0, messages: 0 };

  // ── Reimbursements awaiting MY approval ──
  // Approver = the team's billing contact, or the leader when no billing contact is set.
  // Mirrors teamAccess() in routes/reimbursements.js; kept as one query so the badge does
  // not need to walk every team.
  const reimbursements = await safe("reimbursements", async () => {
    const row = await db.prepare(`
      SELECT COUNT(*) AS count
      FROM reimbursements r
      JOIN care_teams ct ON ct.id = r.care_team_id
      LEFT JOIN care_team_members ctm
        ON ctm.care_team_id = ct.id AND ctm.user_id = ? AND ctm.role = 'leader'
      WHERE r.status = 'pending'
        AND r.payee_user_id IS DISTINCT FROM ?
        AND (ct.billing_user_id = ? OR (ct.billing_user_id IS NULL AND ctm.user_id IS NOT NULL))
    `).get(userId, userId, userId);
    return parseInt(row?.count || 0, 10);
  });

  // ── A session time change waiting on my answer ──
  // Table is `time_proposals`; the caregiver proposes, the booking family answers. Expired
  // proposals don't count — there is nothing left to do about them.
  const timeChanges = await safe("timeChanges", async () => {
    const row = await db.prepare(`
      SELECT COUNT(*) AS count
      FROM time_proposals tp
      JOIN care_sessions cs ON cs.id = tp.session_id
      WHERE tp.status = 'pending'
        AND cs.family_user_id = ?
        AND (tp.expires_at IS NULL OR tp.expires_at > NOW())
    `).get(userId);
    return parseInt(row?.count || 0, 10);
  });

  // ── A care task assigned to me that is already due ──
  // Assigned to me specifically: an unassigned task is the team's, not mine, and badging
  // everyone for it is how a badge becomes noise.
  //
  // v1.105.42 — `t.is_active = 1`. The nightly sweeper rolls yesterday's still-pending
  // occurrences to 'missed', and that is what keeps this bounded to today — but it only
  // sweeps occurrences of ACTIVE tasks (routes/careTasks.js). Delete or pause a task and
  // its pending occurrences are orphaned: still 'pending', still counted here, and no
  // longer reachable anywhere in the UI. Unclearable by construction.
  const careTasks = await safe("careTasks", async () => {
    const row = await db.prepare(`
      SELECT COUNT(*) AS count
      FROM care_task_occurrences occ
      JOIN care_tasks t ON t.id = occ.task_id
      WHERE occ.status = 'pending'
        AND t.is_active = 1
        AND t.assigned_user_id = ?
        AND occ.due_at <= NOW()
    `).get(userId);
    return parseInt(row?.count || 0, 10);
  });

  // ── Unread messages ──
  //
  // v1.105.42 — this is the query that put 78 on Pete's icon.
  //
  // It used to read `COALESCE(m.is_read, 0) = 0`. But `messages.is_read` is only ever
  // written for LEGACY direct messages — every UPDATE that sets it ends with
  // `AND conversation_id IS NULL` (routes/messages.js). Conversation messages keep
  // is_read = 0 for life. Joining conversation_members means every row counted here IS a
  // conversation message, so that filter was vacuously true: the count was every message
  // ever sent in every conversation he belongs to, by anyone, forever. Reading them
  // changed nothing — which is exactly what he reported: "I don't know how to clear any
  // of them."
  //
  // The app's own unread badge uses last_read_at, and always has. This is now a copy of
  // that query (routes/messages.js GET /conversations) so the icon and the in-app count
  // cannot disagree: newer than my last read, not mine, not the Kindred relay (which the
  // user reads in Kindred chat instead), and not in a conversation I archived or deleted.
  // An unread you cannot see is an unread you cannot clear.
  const messages = await safe("messages", async () => {
    const row = await db.prepare(`
      SELECT COUNT(*) AS count
      FROM messages m
      JOIN conversation_members cm
        ON cm.conversation_id = m.conversation_id AND cm.user_id = ?
      JOIN conversations c ON c.id = cm.conversation_id
      WHERE m.sender_id IS DISTINCT FROM ?
        AND m.created_at > COALESCE(cm.last_read_at, '1970-01-01'::TIMESTAMPTZ)
        AND cm.archived_at IS NULL
        AND (cm.deleted_at IS NULL OR c.updated_at > cm.deleted_at)
        AND m.sender_id NOT IN (SELECT id FROM users WHERE email = 'kindred@yourinplace.com')
    `).get(userId, userId);
    return parseInt(row?.count || 0, 10);
  });

  return {
    total: reimbursements + timeChanges + careTasks + messages,
    reimbursements,
    timeChanges,
    careTasks,
    messages,
  };
}

module.exports = { attentionCountFor };
