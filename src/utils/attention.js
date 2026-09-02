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
//
// ─── v1.105.129 — the count is now DERIVED from the list ───
//
// Pete, 8/24: "I'm not happy with how the 'needs you' is displayed… if something needs me
// let's get it clear on WHAT they're needed for and make it a one-click event."
//
// A card that says what each item is needs the items, not a number. The obvious way to get
// them is a second set of queries beside the counting ones — and that is exactly how the
// badge and the card come to disagree, which is the one thing this file cannot afford
// (v1.105.105 note below). So there is one set of queries, they SELECT rows, and every count
// in the payload is `rows.length`. The two cannot drift because there is nothing to drift
// from.

async function safe(label, fn) {
  try {
    const n = await fn();
    return Number.isFinite(n) ? n : 0;
  } catch (e) {
    console.log(`[attention] ${label} failed (non-blocking):`, e.message);
    return 0;
  }
}

// Same contract as safe(), for the row lists. safe() coerces anything non-finite to 0,
// which would turn a list of things you have to do into the number zero.
async function safeRows(label, fn) {
  try {
    const rows = await fn();
    return Array.isArray(rows) ? rows : [];
  } catch (e) {
    console.log(`[attention] ${label} failed (non-blocking):`, e.message);
    return [];
  }
}

const money = (n) => {
  const v = Number(n);
  return Number.isFinite(v) ? `$${v.toFixed(2)}` : "$0.00";
};

const name = (first, last) => [first, last].filter(Boolean).join(" ").trim() || null;

const EMPTY = {
  total: 0, reimbursements: 0, timeChanges: 0, timeChangeSessionId: null,
  careTasks: 0, approvals: 0, safetyFlags: 0, messages: 0, items: [],
};

/**
 * Everything waiting on one user, itemised, plus the counts derived from it.
 * `items` is what the dashboard card draws; the counts are what the app icon reads.
 * @returns {{ total:number, reimbursements:number, timeChanges:number,
 *             timeChangeSessionId:string|null, careTasks:number, messages:number,
 *             items:Array<object> }}
 */
async function attentionItemsFor(db, userId) {
  if (!userId) return { ...EMPTY };

  // ── Reimbursements awaiting MY approval ──
  // Approver = the team's billing contact, or the leader when no billing contact is set.
  // Mirrors teamAccess() in routes/reimbursements.js; kept as one query so the badge does
  // not need to walk every team.
  const reimbursementRows = await safeRows("reimbursements", () => db.prepare(`
    SELECT r.id, r.amount, r.description, r.category, r.expense_date, r.care_team_id,
           pu.first_name AS payee_first, pu.last_name AS payee_last,
           cr.first_name AS recipient_first
    FROM reimbursements r
    JOIN care_teams ct ON ct.id = r.care_team_id
    LEFT JOIN care_team_members ctm
      ON ctm.care_team_id = ct.id AND ctm.user_id = ? AND ctm.role = 'leader'
    LEFT JOIN users pu ON pu.id = r.payee_user_id
    LEFT JOIN care_recipients cr ON cr.id = r.care_recipient_id
    WHERE r.status = 'pending'
      AND r.payee_user_id IS DISTINCT FROM ?
      AND (ct.billing_user_id = ? OR (ct.billing_user_id IS NULL AND ctm.user_id IS NOT NULL))
    ORDER BY r.created_at
  `).all(userId, userId, userId));

  // ── A session time change waiting on my answer ──
  //
  // There are TWO proposal tables and they are different things:
  //
  //   time_proposals         a caregiver offering a time for an OPEN request. Has expires_at,
  //                          and expireStaleProposals sweeps it — an expired one is back in the
  //                          open pool, so there is nothing left for anyone to do about it.
  //   time_change_proposals  a change to an ALREADY-BOOKED session. Either side can propose;
  //                          the other side answers.
  //
  // v1.105.62 — only the first was counted. The second is the one Pete asked to add, and it is
  // the more urgent of the two: **it has no expires_at and nothing sweeps it.** A pending time
  // change sits there indefinitely, and the visit it belongs to is already on the calendar with
  // a caregiver expecting to work it. Nobody is coming to resolve that but the person it is
  // waiting on — which is the badge's whole definition.
  //
  // Counted for the COUNTERPARTY only: you are not the blocker on your own proposal.
  //
  // Gated on `cs.pending_time_change_id = tcp.id` rather than status alone, for the reason
  // recorded against careTasks below: the UI surfaces a time change through that pointer
  // (dashboard.js), so a pending row the pointer no longer references cannot be acted on from
  // anywhere in the app. Badging it would be unclearable by construction. Terminal sessions are
  // excluded for the same reason — there is no answering a change to a cancelled visit.
  const offerRows = await safeRows("timeOffers", () => db.prepare(`
    SELECT tp.id, tp.session_id, tp.proposed_date, tp.proposed_time, tp.message,
           cu.first_name AS caregiver_first, cu.last_name AS caregiver_last,
           cs.service_type, cs.scheduled_date, cs.scheduled_time, cs.duration_hours,
           cr.timezone AS tz, cr.first_name AS recipient_first
    FROM time_proposals tp
    JOIN care_sessions cs ON cs.id = tp.session_id
    LEFT JOIN users cu ON cu.id = tp.caregiver_user_id
    LEFT JOIN care_recipients cr ON cr.id = cs.care_recipient_id
    WHERE tp.status = 'pending'
      AND cs.family_user_id = ?
      AND (tp.expires_at IS NULL OR tp.expires_at > NOW())
    ORDER BY tp.created_at
  `).all(userId));

  const changeRows = await safeRows("timeChanges", () => db.prepare(`
    SELECT tcp.id, tcp.session_id, tcp.proposed_by, tcp.original_time, tcp.proposed_time,
           tcp.original_duration, tcp.proposed_duration, tcp.reason, tcp.is_within_24h,
           cs.scheduled_date, cs.scheduled_time, cs.service_type,
           cr.timezone AS tz, cr.first_name AS recipient_first,
           cu.first_name AS caregiver_first, cu.last_name AS caregiver_last,
           fu.first_name AS family_first, fu.last_name AS family_last
    FROM time_change_proposals tcp
    JOIN care_sessions cs
      ON cs.id = tcp.session_id AND cs.pending_time_change_id = tcp.id
    LEFT JOIN caregiver_profiles cp ON cp.id = cs.caregiver_id
    LEFT JOIN users cu ON cu.id = cp.user_id
    LEFT JOIN users fu ON fu.id = cs.family_user_id
    LEFT JOIN care_recipients cr ON cr.id = cs.care_recipient_id
    WHERE tcp.status = 'pending'
      AND cs.status NOT IN ('cancelled', 'completed', 'disputed')
      AND (
        (tcp.proposed_by = 'caregiver' AND cs.family_user_id = ?)
        OR (tcp.proposed_by = 'family' AND cp.user_id = ?)
      )
    ORDER BY cs.scheduled_date, cs.scheduled_time
  `).all(userId, userId));

  // ── Someone waiting on ME to let them into InPlace ──
  //
  // v1.105.145. Pete, after Rebecca signed up: "I never got a push notification that something
  // was waiting on me as an admin, and there was no indication inside the app that I needed
  // attention to approve her account… I got an email that made me go to the app… It needs to
  // be faster than that."
  //
  // The push fan-out to admins does exist and is keyed on is_admin, correctly. But a push is
  // gone the moment it is missed, and nothing PERSISTENT ever said so — the one surface whose
  // entire job is "you are the blocker" did not know that approvals exist. A person who signed
  // up and cannot get in is the purest example of this file's definition at the top.
  //
  // Admins only, and by is_admin rather than role: Pete is role 'family' AND is_admin, and a
  // check on role would skip the only admin there is.
  const approvalRows = await safeRows("approvals", async () => {
    const me = await db.prepare("SELECT is_admin FROM users WHERE id = ?").get(userId);
    if (!me || !me.is_admin) return [];
    return db.prepare(`
      SELECT id, first_name, last_name, email, role, created_at
      FROM users
      WHERE COALESCE(account_approved, 0) = 0
        AND COALESCE(is_demo, 0) = 0
        AND COALESCE(is_active, 1) = 1
        AND created_at > '2026-02-20'
      ORDER BY created_at
    `).all();
  });

  // ── A pending safety flag, for an admin ──
  //
  // v1.105.177. Pete tapped a safety-flag push: "it opened the app, but no 'needs you' or
  // prompt to open admin or anything. just dead ends. found it when i went looking in admin."
  //
  // The deep link is fixed separately, but a link is not the answer on its own — a push is
  // gone the moment it is missed, and this is the one surface whose entire job is "you are the
  // blocker". A suspected-abuse report sitting unread because nobody happened to open the
  // Admin page is the worst version of the thing this file exists to prevent.
  //
  // Admins only, by is_admin rather than role, for the same reason as approvals above.
  // Escalated counts too: escalating is not resolving, and something escalated is still open.
  const safetyRows = await safeRows("safetyFlags", async () => {
    const me = await db.prepare("SELECT is_admin FROM users WHERE id = ?").get(userId);
    if (!me || !me.is_admin) return [];
    return db.prepare(`
      SELECT sf.id, sf.flag_type, sf.created_at, sf.status,
             u.first_name, u.last_name
      FROM safety_flags sf
      LEFT JOIN users u ON u.id = sf.user_id
      WHERE sf.status IN ('pending', 'escalated')
      ORDER BY sf.created_at
    `).all();
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
  const taskRows = await safeRows("careTasks", () => db.prepare(`
    SELECT occ.id, occ.due_at, occ.due_date, t.title, t.task_type, t.tz,
           t.care_recipient_id, cr.first_name AS recipient_first
    FROM care_task_occurrences occ
    JOIN care_tasks t ON t.id = occ.task_id
    LEFT JOIN care_recipients cr ON cr.id = t.care_recipient_id
    WHERE occ.status = 'pending'
      AND t.is_active = 1
      AND t.assigned_user_id = ?
      AND occ.due_at <= NOW()
    ORDER BY occ.due_at
  `).all(userId));

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
  //
  // Still a COUNT: this one is not itemised, because it is not in `total` and the card does
  // not draw it (see the note on the return value).
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

  // ── The list the card draws ──
  //
  // Each item carries the sentence to show and the ONE request that clears it. The endpoint
  // is named here, on the server, next to the query that found the row — so the thing that
  // knows an item is waiting is the thing that says how to answer it. A client guessing the
  // URL from a `kind` string is how the wrong id ends up in the right-looking path.
  //
  // `verb` is what the button says. `undoable` marks the ones with a real server-side undo;
  // the card gives every action a hold-then-send window, but only these can be taken back
  // after it closes.
  const items = [
    ...reimbursementRows.map((r) => ({
      kind: "reimbursement",
      id: r.id,
      title: `Approve ${money(r.amount)} to ${name(r.payee_first, r.payee_last) || "a team member"}`,
      detail: [r.description, r.category].filter(Boolean).join(" · "),
      forWhom: r.recipient_first || null,
      when: r.expense_date || null,
      verb: "Approve",
      action: { method: "POST", path: `/api/reimbursements/${r.id}/approve` },
      page: "care-team",
      // v1.105.139 — Pete (51d4226c): "Need you alerts shouldn't open a generic page…they
      // should open the task or event." Reimbursements.js has consumed this exact focus since
      // v1.97.0 — it scrolls to the row, flashes it, and opens the approve modal for the
      // approver. .129 simply never sent it.
      focus: `reimbursement:${r.id}`,
      // Approval is not payment. Pete's money rule: say plainly where money moves — and
      // here it does not move yet, so the card says so rather than implying a transfer.
      note: "Approving doesn't send money — you choose how to pay after.",
    })),
    ...offerRows.map((p) => ({
      kind: "timeOffer",
      id: p.id,
      sessionId: p.session_id,
      title: `${name(p.caregiver_first, p.caregiver_last) || "A caregiver"} offered a time`,
      detail: p.message || null,
      forWhom: p.recipient_first || null,
      serviceType: p.service_type || null,
      tz: p.tz || null,
      proposedDate: p.proposed_date || null,
      proposedTime: p.proposed_time || null,
      verb: "Accept",
      action: { method: "PUT", path: `/api/sessions/${p.session_id}/proposals/${p.id}/accept` },
      page: "dashboard",
      focus: `session:${p.session_id}`,
    })),
    ...changeRows.map((c) => ({
      kind: "timeChange",
      id: c.id,
      sessionId: c.session_id,
      title: `${c.proposed_by === "caregiver"
        ? (name(c.caregiver_first, c.caregiver_last) || "Your caregiver")
        : (name(c.family_first, c.family_last) || "The family")} asked to move a visit`,
      detail: c.reason || null,
      forWhom: c.recipient_first || null,
      serviceType: c.service_type || null,
      tz: c.tz || null,
      date: c.scheduled_date || null,
      fromTime: c.original_time || null,
      toTime: c.proposed_time || null,
      fromDuration: c.original_duration || null,
      toDuration: c.proposed_duration || null,
      isWithin24h: !!c.is_within_24h,
      verb: "Accept",
      action: {
        method: "PUT",
        path: `/api/sessions/${c.session_id}/time-change/${c.id}/respond`,
        body: { action: "accept" },
      },
      page: "dashboard",
      focus: `session:${c.session_id}`,
    })),
    ...approvalRows.map((u) => ({
      kind: "approval",
      id: u.id,
      title: `Approve ${name(u.first_name, u.last_name) || u.email} — waiting to get in`,
      detail: [u.email, u.role].filter(Boolean).join(" · "),
      forWhom: null,
      when: u.created_at || null,
      verb: "Approve",
      action: { method: "PUT", path: `/api/admin/users/${u.id}/approve` },
      page: "admin",
      focus: `approval:${u.id}`,
      note: "They can't use InPlace until you do.",
    })),
    ...safetyRows.map((f) => ({
      kind: "safetyFlag",
      id: f.id,
      // No excerpt, deliberately: the flagged message is the thing being reported and this
      // card is read on a lock screen's worth of dashboard. Same rule as the push (v1.105.39).
      title: `Review safety flag — ${name(f.first_name, f.last_name) || "a member"}`,
      detail: String(f.flag_type || "").replace(/_/g, " ") || null,
      forWhom: null,
      when: f.created_at || null,
      // No one-tap action. Every other item here can be settled from the card; this one cannot,
      // because resolving an abuse report without reading it is not a thing to make easy.
      verb: "Open",
      action: null,
      page: "admin",
      focus: `safetyFlag:${f.id}`,
      note: f.status === "escalated" ? "Escalated and still open." : "Nobody else is reviewing this.",
    })),
    ...taskRows.map((t) => ({
      kind: "careTask",
      id: t.id,
      title: t.title,
      detail: null,
      forWhom: t.recipient_first || null,
      tz: t.tz || null,
      dueAt: t.due_at || null,
      verb: "Mark done",
      action: { method: "POST", path: `/api/care-tasks/occurrences/${t.id}/check` },
      undo: { method: "POST", path: `/api/care-tasks/occurrences/${t.id}/undo` },
      undoable: true,
      // ─── v1.105.161 — a way out that is not "do it" ───
      //
      // Pete: "I either mark it done by hitting the task and completing it, or I dismiss that
      // needs me now. But it can't have me go multiple places trying to get rid of the warning
      // unsuccessfully."
      //
      // Until now the only exits from this row were finishing the task or opening it. Skipping
      // is a real answer — the medication was not given, or someone else handled it off-app —
      // and the dashboard row has offered it all along. The row that INTERRUPTS him should
      // offer at least as much as the one he has to scroll to.
      dismiss: {
        method: "POST",
        path: `/api/care-tasks/occurrences/${t.id}/check`,
        body: { status: "skipped" },
        label: "Not today",
        confirm: "Mark as skipped for today?",
      },
      // v1.105.139 — "I went to log Betty's meds… it just took me to the care team page… I
      // gotta scroll down and find the task." The dashboard is where today's tasks live and
      // where the check sheet opens, so Open now opens the SHEET for this occurrence: who did
      // it, and a note. Care-team was the page you had to go hunting on.
      page: "dashboard",
      focus: `careTask:${t.id}`,
    })),
  ];

  const timeChanges = offerRows.length + changeRows.length;

  return {
    // v1.105.105 — unread messages are NOT in the total any more. Pete: five of them showed
    // in "Needs you" and "I wanted to show up as the notifications over the message pill" —
    // which it already does, in the nav (app.js `unreadMsgCount`). Counting them twice made
    // the badge a number about correspondence rather than about decisions, and the definition
    // at the top of this file is the product: a number here means YOU are the blocker.
    // Reading a message is not a decision anyone is waiting on.
    // The count is still returned — it is honest, and the caller may want it — but the card
    // and the app icon both read `total`, so they stay in agreement, which is the one thing
    // AttentionCard cannot afford to lose.
    total: reimbursementRows.length + timeChanges + taskRows.length + approvalRows.length
      + safetyRows.length,
    reimbursements: reimbursementRows.length,
    approvals: approvalRows.length,
    safetyFlags: safetyRows.length,
    timeChanges,
    // v1.105.105 — a count with no destination is why "1 schedule change waiting on your
    // answer" was a dead end: the card sent you to a page and the page said nothing. Kept
    // for any caller still reading it; the items each carry their own `focus` now, so
    // nothing in the card depends on this single id any more.
    timeChangeSessionId: changeRows[0]?.session_id || null,
    careTasks: taskRows.length,
    messages,
    items,
  };
}

/**
 * Breakdown + total for one user, without the item list — the badge's view.
 * Same rows, same numbers, by construction: this is attentionItemsFor with `items` dropped.
 * @returns {{ total:number, reimbursements:number, timeChanges:number, careTasks:number, messages:number }}
 */
async function attentionCountFor(db, userId) {
  const { items, ...counts } = await attentionItemsFor(db, userId);
  return counts;
}

module.exports = { attentionCountFor, attentionItemsFor };
