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

const { getTodayStringInZone, DEFAULT_TIMEZONE } = require("./timezone");
const TimeChange = require("../../public/js/timeChange"); // v1.123.0
const { FEE_CAREGIVER_PROFILE_SQL } = require("./cancellationFee");
const { careAccessFor } = require("./careAccess"); // v1.112.0

// A naive 'YYYY-MM-DD' plus n days, done in UTC on purpose: scheduled_date is a wall-clock
// date with no zone, so arithmetic in the server's zone would shift it across a boundary.
function addDays(dateStr, n) {
  const [y, m, d] = String(dateStr).split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + n * 86400000);
  return t.toISOString().slice(0, 10);
}

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
  careTasks: 0, approvals: 0, safetyFlags: 0, messages: 0, emptyWeeks: 0, cancelFees: 0, financialConcerns: 0, identity: 0, holdDeclined: 0, items: [],
};

/**
 * Everything waiting on one user, itemised, plus the counts derived from it.
 * `items` is what the dashboard card draws; the counts are what the app icon reads.
 * @returns {{ total:number, reimbursements:number, timeChanges:number,
 *             timeChangeSessionId:string|null, careTasks:number, messages:number,
 *             items:Array<object> }}
 */
// ─── v1.112.0 — "Verify your ID by <date>" ───
//
// The identity gate (utils/careAccess.js) gave every existing account 14 days. The deadline is
// something only this person can clear, so it is a real item, not a nudge — but once they have
// submitted, the wait is ours, and it turns soft ("with us for review", nothing to do).
// A person the gate is already holding gets ONLY this item: every other row below is about a
// care record they may not see.
function identityItem(access) {
  const submitted = access.identityStatus === "pending";
  const rejected = access.identityStatus === "rejected";
  const blocked = !access.allowed;
  const date = access.graceUntil || null;
  let title;
  if (submitted) title = "Your ID is with the InPlace team for review";
  else if (blocked) title = "Verify your ID to see care";
  else title = "Verify your ID";
  return {
    kind: "identity",
    soft: submitted,
    id: "identity:me",
    title,
    detail: null,
    forWhom: null,
    deadline: blocked ? null : date,
    verb: submitted ? "Open" : "Verify",
    action: null,
    page: "account",
    focus: "identity",
    note: submitted
      ? "Nothing more to do \u2014 we'll let you know when it's approved."
      : rejected
        ? "Your last photo couldn't be approved. A clear photo of your ID and a selfie is all it takes."
        : blocked
          ? "A person on the InPlace team checks every ID. Until then you can use your account, but not see care."
          : "Every account on InPlace now verifies their ID. After this date, care pages wait until yours is approved.",
  };
}

async function attentionItemsFor(db, userId) {
  if (!userId) return { ...EMPTY };

  let access = null;
  try { access = await careAccessFor(db, userId); }
  catch (e) { console.log("[attention] care access failed (non-blocking):", e.message); }
  if (access && !access.allowed) {
    const item = identityItem(access);
    return { ...EMPTY, identity: item.soft ? 0 : 1, total: item.soft ? 0 : 1, items: [item] };
  }
  const idItems = access && access.status === "grace" ? [identityItem(access)] : [];

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
           tcp.proposed_date,
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

  // ── v1.124.1 — a change *I* asked for, still waiting on the other person ──
  //
  // Pete, 10/19: asked Tina to move Nov 7 to Nov 14 and then "I can't see there was any change
  // from my end either." The request existed; nothing on his screens said so. Soft: he is not
  // the blocker, so it never counts toward the badge — it only says what he is waiting on.
  const sentChangeRows = await safeRows("timeChangesSent", () => db.prepare(`
    SELECT tcp.id, tcp.session_id, tcp.proposed_by, tcp.original_time, tcp.proposed_time,
           tcp.original_duration, tcp.proposed_duration, tcp.proposed_date,
           cs.scheduled_date, cr.first_name AS recipient_first,
           cu.first_name AS caregiver_first, fu.first_name AS family_first
    FROM time_change_proposals tcp
    JOIN care_sessions cs
      ON cs.id = tcp.session_id AND cs.pending_time_change_id = tcp.id
    LEFT JOIN caregiver_profiles cp ON cp.id = cs.caregiver_id
    LEFT JOIN users cu ON cu.id = cp.user_id
    LEFT JOIN users fu ON fu.id = cs.family_user_id
    LEFT JOIN care_recipients cr ON cr.id = cs.care_recipient_id
    WHERE tcp.status = 'pending'
      AND tcp.proposed_by_user_id = ?
      AND cs.status NOT IN ('cancelled', 'completed', 'disputed')
    ORDER BY cs.scheduled_date, cs.scheduled_time
  `).all(userId));

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

  // ── A late-cancellation fee with a 24-hour clock on it (v1.109.9) ──
  //
  // Pete (9d286a8a): "I got a notice that the session that I canceled would be charged unless
  // there was a reason why. And it said tell us. So I tapped on the push notification and it
  // just brought me to the homepage." The push was the ONLY place the fee was ever mentioned,
  // and it went nowhere. A push is gone the moment it is missed; this is the persistent half.
  //
  // FAMILY: counted in `total`. It is a decision only they can make, it is on a deadline, and
  // silence charges their card — the badge's definition exactly. It is clearable without
  // disputing: "Looks right" snoozes it until the charge has gone through.
  //
  // CAREGIVER: `soft`. Silence pays her, so nothing is blocked on her; waiving is a kindness
  // she may offer, not a task. It rides in `items` so her home screen can show it, and stays
  // out of the number on her icon.
  //
  // Bounded by the deadline: after it the poller captures, and a row past it would be a
  // decision that has already been made for you.
  const cancelFeeRows = await safeRows("cancelFees", () => db.prepare(`
    SELECT cs.id, cs.cancel_fee_cents, cs.cancel_fee_deadline, cs.scheduled_date,
           cs.service_type, cr.first_name AS recipient_first, cr.timezone AS tz
    FROM care_sessions cs
    LEFT JOIN care_recipients cr ON cr.id = cs.care_recipient_id
    WHERE cs.family_user_id = ?
      AND cs.cancel_fee_status = 'pending'
      AND cs.cancel_fee_deadline > NOW()
      AND NOT EXISTS (
        SELECT 1 FROM nudge_snoozes ns
         WHERE ns.user_id = ? AND ns.kind = 'cancelFee' AND ns.ref = cs.id AND ns.snoozed_until > NOW()
      )
    ORDER BY cs.cancel_fee_deadline
  `).all(userId, userId));

  // ── A visit whose card hold the bank declined (v1.117.0) ──
  // A blocker in the plainest sense: the visit cannot start until the card goes through
  // (v1.114.2), and the caregiver is not paid for it until then. The payer, the person who
  // booked and the loved one's care team leader all see it; any of them can tap "Try the card
  // again" — Pete, 10/14, on Sara: she "transfers money in, and then we try again". Bounded by the
  // visit itself: once it is over or cancelled, it is not waiting on a card.
  const holdDeclinedRows = await safeRows("holdDeclined", () => db.prepare(`
    SELECT cs.id, cs.scheduled_date, cs.scheduled_time, cs.service_type, cs.hold_failure_card,
           cs.hold_failure_code, cr.first_name AS recipient_first, cr.timezone AS tz,
           cu.first_name AS caregiver_first
      FROM care_sessions cs
      LEFT JOIN care_recipients cr ON cr.id = cs.care_recipient_id
      LEFT JOIN caregiver_profiles cp ON cp.id = cs.caregiver_id
      LEFT JOIN users cu ON cu.id = cp.user_id
     WHERE cs.status IN ('confirmed', 'in_progress')
       AND cs.hold_failed_at IS NOT NULL
       AND cs.stripe_payment_intent_id IS NULL
       AND cs.scheduled_date >= TO_CHAR((NOW() - INTERVAL '1 day') AT TIME ZONE 'America/New_York', 'YYYY-MM-DD')
       AND (cs.family_user_id = ?
            OR EXISTS (SELECT 1 FROM care_teams ct WHERE ct.care_recipient_id = cs.care_recipient_id AND ct.billing_user_id = ?)
            OR EXISTS (SELECT 1 FROM care_team_members ctm JOIN care_teams ct ON ct.id = ctm.care_team_id
                        WHERE ct.care_recipient_id = cs.care_recipient_id AND ctm.user_id = ? AND ctm.role = 'leader'))
     ORDER BY cs.scheduled_date, cs.scheduled_time
  `).all(userId, userId, userId));

  const owedFeeRows = await safeRows("owedCancelFees", () => db.prepare(`
    SELECT cs.id, cs.cancel_fee_cents, cs.cancel_fee_deadline, cs.scheduled_date,
           cs.service_type, cr.first_name AS recipient_first, cr.timezone AS tz
    FROM care_sessions cs
    JOIN caregiver_profiles cp ON cp.id = ${FEE_CAREGIVER_PROFILE_SQL}
    LEFT JOIN care_recipients cr ON cr.id = cs.care_recipient_id
    WHERE cp.user_id = ?
      AND cs.family_user_id IS DISTINCT FROM ?
      AND cs.cancel_fee_status = 'pending'
      AND cs.cancel_fee_deadline > NOW()
      AND NOT EXISTS (
        SELECT 1 FROM nudge_snoozes ns
         WHERE ns.user_id = ? AND ns.kind = 'cancelFee' AND ns.ref = cs.id AND ns.snoozed_until > NOW()
      )
    ORDER BY cs.cancel_fee_deadline
  `).all(userId, userId, userId));

  // ── A care task assigned to me that is already due ──
  // Assigned to me specifically: an unassigned task is the team's, not mine, and badging
  // everyone for it is how a badge becomes noise.
  //
  // v1.105.42 — `t.is_active = 1`. The nightly sweeper rolls yesterday's still-pending
  // occurrences to 'missed', and that is what keeps this bounded to today — but it only
  // sweeps occurrences of ACTIVE tasks (routes/careTasks.js). Delete or pause a task and
  // its pending occurrences are orphaned: still 'pending', still counted here, and no
  // longer reachable anywhere in the UI. Unclearable by construction.
  // ── Nothing on the calendar next week (v1.109.4) ──
  //
  // Pete (7e3ff970): "There needs to be a reminder to set up appointments if there's nothing a
  // week out. No gate or anything just a nudge like a needs you card for Betty has no
  // appointments next week, make one now?"
  //
  // This is the first SOFT item in this file, and it breaks the rule at the top of it on
  // purpose — nobody is blocked by an empty calendar, and the badge's definition is "you,
  // specifically, are the blocker". So it rides in `items` and is deliberately left OUT of
  // `total`: Pete sees the card, the app icon stays a number about decisions.
  //
  // One query per recipient rather than one clever one, because "next week" is seven days in
  // HER zone and scheduled_date is naive text. A single range would be right for whichever
  // recipient happened to share the server's day.
  const emptyWeekRows = await safeRows("emptyWeek", async () => {
    const mine = await db.prepare(`
      SELECT DISTINCT cr.id, cr.first_name, cr.timezone AS tz
        FROM care_recipients cr
        LEFT JOIN care_teams ct ON ct.care_recipient_id = cr.id
        LEFT JOIN care_team_members ctm
          ON ctm.care_team_id = ct.id AND ctm.user_id = ? AND ctm.role = 'leader'
       WHERE cr.family_user_id = ? OR ctm.user_id IS NOT NULL
    `).all(userId, userId);
    const out = [];
    for (const r of mine) {
      const snoozed = await db.prepare(`
        SELECT 1 AS x FROM nudge_snoozes
         WHERE user_id = ? AND kind = 'emptyWeek' AND ref = ? AND snoozed_until > NOW()
      `).get(userId, r.id);
      if (snoozed) continue;
      const from = getTodayStringInZone(r.tz || DEFAULT_TIMEZONE);
      const until = addDays(from, 7);
      // An unfilled request still counts as an appointment made: he asked for it, and nudging
      // him to ask again is the app not reading its own calendar.
      const booked = await db.prepare(`
        SELECT 1 AS x FROM care_sessions
         WHERE care_recipient_id = ?
           AND status NOT IN ('cancelled', 'cancelled_no_fee', 'cancelled_with_fee', 'declined', 'rejected', 'expired')
           AND scheduled_date >= ? AND scheduled_date <= ?
         LIMIT 1
      `).get(r.id, from, until);
      if (!booked) out.push({ id: r.id, first_name: r.first_name, tz: r.tz, from, until });
    }
    return out;
  });

  // ── v1.119.1 — "Did the check arrive?" (feedback bfbb79bd) ──
  //
  // Pete: "Some of these deposits are via check. And it needs to prompt me to go back and ask
  // if I ever received payment." A check or cash payment never marks itself paid, so an
  // approved request sits "awaiting payment" after the money has long since been deposited.
  //
  // Two soft nudges, neither in `total` (nobody is blocked; the money already moved or it
  // didn't): the PAYEE is asked 3 days after approval, "Not yet" asks again in 3; the APPROVER
  // is asked 10 days after approval whether they sent it. In-app transfers are excluded —
  // that rail marks itself paid.
  const paymentArrivedRows = await safeRows("paymentArrived", () => db.prepare(`
    SELECT r.id, r.amount, r.description, r.planned_method,
           au.first_name AS approver_first, cr.first_name AS recipient_first
      FROM reimbursements r
      LEFT JOIN users au ON au.id = r.approved_by
      LEFT JOIN users pu ON pu.id = r.payee_user_id
      LEFT JOIN care_recipients cr ON cr.id = r.care_recipient_id
     WHERE r.status = 'approved'
       AND r.payee_user_id = ?
       AND r.approved_at < NOW() - INTERVAL '3 days'
       AND COALESCE(r.payout_status, '') NOT IN ('processing', 'succeeded')
       AND COALESCE(r.planned_method, '') <> 'inplace'
       -- v1.120.1 — a request the payee can be paid for IN THE APP, with nothing saying check
       -- or cash (every recurring occurrence), is waiting on the PAYER to tap Pay. Asking the
       -- payee "have you been paid?" with a one-tap "Got it" would close it with no money
       -- moved. The payer's reminders (reimbursementUnpaid below) cover it instead.
       AND NOT (r.planned_method IS NULL AND COALESCE(pu.stripe_onboard_complete, 0) = 1)
       AND NOT EXISTS (
         SELECT 1 FROM nudge_snoozes ns
          WHERE ns.user_id = ? AND ns.kind = 'paymentArrived' AND ns.ref = r.id AND ns.snoozed_until > NOW()
       )
     ORDER BY r.approved_at
  `).all(userId, userId));

  // ── v1.120.1 — an approved reimbursement I still have to PAY ──
  //
  // Pete, 10/15: "we need to keep pinging members until they pay." Approval is not payment,
  // and the payer used to be told once. This is a decision waiting on exactly one person, so
  // it is a hard item: it counts toward the badge and has no "Not now". Paying, or the payee
  // confirming a check/cash payment, is what clears it.
  // A check or cash the payer said they'd send shows from day 10 (it may be in the mail);
  // everything else from the moment it's approved. Pushes: utils/reimbursementReminders.js.
  const unpaidRows = await safeRows("reimbursementUnpaid", () => db.prepare(`
    SELECT r.id, r.amount, r.description, r.planned_method, r.approved_at,
           pu.first_name AS payee_first, pu.last_name AS payee_last,
           COALESCE(pu.stripe_onboard_complete, 0) AS payee_payout_ready,
           cr.first_name AS recipient_first
      FROM reimbursements r
      JOIN care_teams ct ON ct.id = r.care_team_id
      LEFT JOIN care_team_members ctm
        ON ctm.care_team_id = ct.id AND ctm.user_id = ? AND ctm.role = 'leader'
      LEFT JOIN users pu ON pu.id = r.payee_user_id
      LEFT JOIN care_recipients cr ON cr.id = r.care_recipient_id
     WHERE r.status = 'approved'
       AND r.approved_at IS NOT NULL
       AND r.payee_user_id IS DISTINCT FROM ?
       AND (ct.billing_user_id = ? OR (ct.billing_user_id IS NULL AND ctm.user_id IS NOT NULL))
       AND COALESCE(r.payout_status, '') NOT IN ('processing', 'succeeded')
       AND (COALESCE(r.planned_method, '') NOT IN ('check', 'cash')
            OR r.approved_at < NOW() - INTERVAL '10 days')
     ORDER BY r.approved_at
  `).all(userId, userId, userId));

  const taskRows = await safeRows("careTasks", () => db.prepare(`
    SELECT occ.id, occ.due_at, occ.due_date, t.title, t.task_type, t.tz,
           t.care_recipient_id, cr.first_name AS recipient_first
    FROM care_task_occurrences occ
    JOIN care_tasks t ON t.id = occ.task_id
    LEFT JOIN care_recipients cr ON cr.id = t.care_recipient_id
    WHERE occ.status = 'pending'
      AND t.is_active = 1
      AND COALESCE(occ.assigned_user_id, t.assigned_user_id) = ? /* v1.105.191 — tonight's person */
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

  // ── v1.110 — money-safety resources an admin chose to share with me ──
  //
  // Created only by an admin, from a financial-exploitation flag, addressed to the care team
  // leader (routes/legalReadiness.js). Never shown to caregivers: it is addressed to one
  // person by id. Cleared by POST /api/legal-readiness/concerns/:id/acknowledge.
  const financialConcernRows = await safeRows("financialConcerns", () => db.prepare(`
    SELECT fc.id, fc.care_recipient_id, fc.shared_at, cr.first_name AS recipient_first
    FROM financial_concerns fc
    JOIN care_recipients cr ON cr.id = fc.care_recipient_id
    WHERE fc.shared_with_user_id = ? AND fc.shared_at IS NOT NULL AND fc.acknowledged_at IS NULL
    ORDER BY fc.shared_at
  `).all(userId));

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
    ...idItems,
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
      // v1.123.0 — "asked to end a visit early", not "asked to move a visit": the visit had
      // not moved, it had got shorter, and the detail line under this read "9:00 → 9:00".
      title: `${c.proposed_by === "caregiver"
        ? (name(c.caregiver_first, c.caregiver_last) || "Your caregiver")
        : (name(c.family_first, c.family_last) || "The family")} asked to ${TimeChange.describe({
          fromTime: c.original_time, fromHours: c.original_duration,
          toTime: c.proposed_time, toHours: c.proposed_duration,
          fromDate: c.scheduled_date, toDate: c.proposed_date || c.scheduled_date,
        }).verb}`,
      detail: c.reason || null,
      forWhom: c.recipient_first || null,
      serviceType: c.service_type || null,
      tz: c.tz || null,
      date: c.scheduled_date || null,
      fromTime: c.original_time || null,
      toTime: c.proposed_time || null,
      // v1.124.0 — the day it would move to; null = same day.
      toDate: c.proposed_date || null,
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
    ...sentChangeRows.map((c) => {
      const other = c.proposed_by === "caregiver" ? (c.family_first || "the family") : (c.caregiver_first || "your caregiver");
      const ch = TimeChange.describe({
        fromTime: c.original_time, fromHours: c.original_duration,
        toTime: c.proposed_time, toHours: c.proposed_duration,
        fromDate: c.scheduled_date, toDate: c.proposed_date || c.scheduled_date,
      });
      const whose = c.recipient_first ? `${c.recipient_first}'s visit` : "the visit";
      const day = TimeChange.dayOnly(c.scheduled_date) ? TimeChange.dateLabel(TimeChange.dayOnly(c.scheduled_date)) : "";
      return {
        kind: "timeChangeSent",
        soft: true,
        id: `timeChangeSent:${c.id}`,
        sessionId: c.session_id,
        title: `Waiting on ${other}: ${whose}${day && !ch.dateChanged ? ` on ${day}` : ""} — ${ch.phrase || "a new time"}`,
        detail: null,
        forWhom: c.recipient_first || null,
        verb: "Open",
        action: null,
        page: "dashboard",
        focus: `session:${c.session_id}`,
        note: `Nothing changes until ${other} accepts.`,
      };
    }),
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
    ...cancelFeeRows.map((f) => ({
      kind: "cancelFee",
      id: `cancelFee:${f.id}`,
      sessionId: f.id,
      title: `Cancellation fee — ${money((f.cancel_fee_cents || 0) / 100)} will be charged tomorrow`,
      // Not `detail`: the card quotes `detail` as if someone had written it.
      detail: null,
      forWhom: f.recipient_first || null,
      tz: f.tz || null,
      date: f.scheduled_date || null,
      deadline: f.cancel_fee_deadline || null,
      // No one-tap action. The answer is either "fine" (Looks right) or a sentence about what
      // went wrong, and a sentence needs the sheet.
      verb: "Review",
      action: null,
      page: "dashboard",
      focus: `cancelFee:${f.id}`,
      note: "Cancelling inside 24 hours means the caregiver still gets paid. If something's wrong, tell us before then.",
      dismiss: {
        method: "POST",
        path: "/api/push/attention/snooze",
        body: { kind: "cancelFee", ref: f.id, days: 2 },
        label: "Looks right",
      },
    })),
    ...holdDeclinedRows.map((h) => {
      const { declineReason, retryCanHelp } = require("./holdDecline");
      const sameCardMayWork = retryCanHelp(h.hold_failure_code);
      const card = h.hold_failure_card || "the card";
      return {
        kind: "holdDeclined",
        id: `holdDeclined:${h.id}`,
        sessionId: h.id,
        title: `Card declined — ${h.caregiver_first || "the caregiver"}'s visit isn't paid for yet`,
        detail: null,
        forWhom: h.recipient_first || null,
        serviceType: h.service_type || null,
        tz: h.tz || null,
        date: h.scheduled_date || null,
        verb: sameCardMayWork ? "Try the card again" : "Use a different card",
        // One tap retries the same card. Open is the sheet, which also offers another card.
        action: sameCardMayWork ? { method: "POST", path: `/api/sessions/${h.id}/retry-hold` } : null,
        page: "dashboard",
        focus: `holdDeclined:${h.id}`,
        note: `${card.charAt(0).toUpperCase() + card.slice(1)} was declined — ${declineReason(h.hold_failure_code)}. The visit can't start until it goes through.`,
      };
    }),
    ...owedFeeRows.map((f) => ({
      kind: "cancelFee",
      soft: true,
      id: `cancelFeeOwed:${f.id}`,
      sessionId: f.id,
      title: `Late cancellation — you're owed ${money((f.cancel_fee_cents || 0) / 100)}`,
      detail: null,
      forWhom: f.recipient_first || null,
      tz: f.tz || null,
      date: f.scheduled_date || null,
      deadline: f.cancel_fee_deadline || null,
      verb: "Review",
      action: null,
      page: "dashboard",
      focus: `cancelFee:${f.id}`,
      note: "You'll be paid automatically. You can waive it if you'd rather.",
      dismiss: {
        method: "POST",
        path: "/api/push/attention/snooze",
        body: { kind: "cancelFee", ref: f.id, days: 2 },
        label: "Not now",
      },
    })),
    ...financialConcernRows.map((c) => ({
      kind: "financialConcern",
      id: c.id,
      // Calm on purpose, and nothing about WHAT prompted it — that stays with the admin.
      title: "The InPlace team shared some money-safety resources",
      detail: null,
      forWhom: c.recipient_first || null,
      when: c.shared_at || null,
      // Reading is the point, so no one-tap action: Open goes to the card, which has "Got it".
      verb: "Open",
      action: null,
      page: "care-profile",
      focus: `legalReadiness:${c.care_recipient_id}`,
      note: "General information, not legal or financial advice.",
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
    ...paymentArrivedRows.map((r) => {
      const payer = r.approver_first || "the approver";
      const title = r.planned_method === "check" ? `Did ${payer}'s check for ${money(r.amount)} arrive?`
        : r.planned_method === "cash" ? `Did ${payer} pay you the ${money(r.amount)} in cash?`
        : `Have you been paid the ${money(r.amount)}?`;
      return {
        kind: "paymentArrived",
        soft: true,
        id: `paymentArrived:${r.id}`,
        title,
        detail: r.description || null,
        forWhom: r.recipient_first || null,
        when: null,
        verb: "Got it",
        // One tap closes it, with the method the approver said they'd use.
        action: { method: "POST", path: `/api/reimbursements/${r.id}/mark-received`, body: { method: r.planned_method || undefined } },
        page: "care-team",
        focus: `reimbursement:${r.id}`,
        note: `Approved, but nothing has marked it paid. ${payer === "the approver" ? "They'll" : payer + " will"} see that you got it.`,
        dismiss: {
          method: "POST",
          path: "/api/push/attention/snooze",
          body: { kind: "paymentArrived", ref: r.id, days: 3 },
          label: "Not yet",
        },
      };
    }),
    ...unpaidRows.map((r) => {
      const byHand = r.planned_method === "check" || r.planned_method === "cash";
      return {
        kind: "reimbursementUnpaid",
        id: `reimbursementUnpaid:${r.id}`,
        title: `Pay ${money(r.amount)} to ${name(r.payee_first, r.payee_last) || "a team member"}`,
        detail: r.description || null,
        forWhom: r.recipient_first || null,
        when: r.approved_at || null,
        // No one-tap action: paying is a money movement with its own confirmation on the row,
        // and a check/cash "mark paid" should be a deliberate act on the request itself.
        verb: "Pay",
        action: null,
        page: "care-team",
        focus: `reimbursement:${r.id}`,
        note: byHand
          ? `You said you'd pay by ${r.planned_method}. If you already have, open it and mark it paid.`
          : Number(r.payee_payout_ready) === 1
            ? "Approved, but no money has moved yet. Open it and tap Pay."
            : "Approved, but not marked paid yet. Pay them, then mark it paid.",
      };
    }),
    ...emptyWeekRows.map((r) => ({
      kind: "emptyWeek",
      // `soft` is the whole contract: the card draws it quietly and leaves it out of its own
      // count, and nothing here reaches `total`. A nudge that shouts is a gate.
      soft: true,
      id: `emptyWeek:${r.id}`,
      title: `${r.first_name} has nothing booked next week`,
      detail: null,
      forWhom: r.first_name || null,
      when: null,
      verb: "Request care",
      action: null,
      // "Request Care" in the nav lands on `schedule` (app.js, _request_care) — the same
      // place this button has to go, or it is the dead-end pattern from v1.105.139 again.
      // No focus: an id nobody claims is a promise the page does not keep.
      page: "schedule",
      focus: null,
      note: "Nothing is wrong \u2014 just easier to fill now than on the day.",
      dismiss: {
        method: "POST",
        path: "/api/push/attention/snooze",
        body: { kind: "emptyWeek", ref: r.id, days: 7 },
        label: "Not now",
      },
    })),
  ];

  const timeChanges = offerRows.length + changeRows.length;

  // v1.112.0 — the ID deadline counts (only they can clear it); "with us for review" does not.
  const idCount = idItems.filter((i) => !i.soft).length;

  const payload = {
    // v1.105.105 — unread messages are NOT in the total any more. Pete: five of them showed
    // in "Needs you" and "I wanted to show up as the notifications over the message pill" —
    // which it already does, in the nav (app.js `unreadMsgCount`). Counting them twice made
    // the badge a number about correspondence rather than about decisions, and the definition
    // at the top of this file is the product: a number here means YOU are the blocker.
    // Reading a message is not a decision anyone is waiting on.
    // The count is still returned — it is honest, and the caller may want it — but the card
    // and the app icon both read `total`, so they stay in agreement, which is the one thing
    // AttentionCard cannot afford to lose.
    // v1.109.4 — emptyWeekRows is NOT in here. See the note against the query: an empty
    // calendar is a nudge, not a blocker, and the app icon means blocker.
    // v1.109.9 — the FAMILY's pending cancellation fees count; the caregiver's do not (see
    // the note against the query).
    total: reimbursementRows.length + timeChanges + taskRows.length + approvalRows.length
      // v1.120.1 — unpaidRows: an approved reimbursement still to pay; the payer is the blocker.
      + unpaidRows.length + cancelFeeRows.length + financialConcernRows.length + safetyRows.length + holdDeclinedRows.length,
    cancelFees: cancelFeeRows.length,
    holdDeclined: holdDeclinedRows.length, // v1.117.0
    financialConcerns: financialConcernRows.length,
    emptyWeeks: emptyWeekRows.length,
    paymentChecks: paymentArrivedRows.length, // v1.120.0, soft
    unpaidReimbursements: unpaidRows.length, // v1.120.1, counts
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
  payload.total += idCount;
  payload.identity = idCount;
  return payload;
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
