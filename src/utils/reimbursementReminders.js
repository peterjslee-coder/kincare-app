// ─── Unpaid reimbursement reminders (v1.120.1) ───
//
// Pete, 10/15, after the October Starlink Gatehouse $95 never reached him: "we need to keep
// pinging members until they pay."
//
// An approved reimbursement — and every recurring occurrence, which is created pre-approved —
// moves money only when the payer (the team's billing contact, or the leader when there is
// none) taps Pay. Until now the payer was told ONCE: a single push at the moment the request
// was approved or the occurrence generated (8:22 PM for the recurring ones). Miss it and
// nothing ever said it again. Sara paid September's the same day and October 1's the next
// morning; October 8's and October 11's sat for days with nobody but Pete noticing.
//
// So: the payer is reminded until it is paid, on a cadence, at a civil hour.
//   · in-app or unspecified: first reminder 2 days after approval, then every 2 days;
//   · the payer said check or cash: from day 10, every 3 days — the check may be in the
//     mail, and the payee can close it themselves ("I got it", v1.120.0).
// Hours: 9 AM–7 PM in the care recipient's zone (the care-location rule in CLAUDE.md).
// Quiet hours still apply on top — sendPushToUser holds and summarises as for any push.
//
// The push names the amount and the payee, never the description: descriptions are free text
// and routinely say what the money was for (the no-PHI-on-lock-screens rule, v1.105.39).

const DAY_MS = 24 * 60 * 60 * 1000;
const CHECK_OR_CASH = new Set(["check", "cash"]);
const FIRST_HOUR = 9;   // local, inclusive
const LAST_HOUR = 19;   // local, exclusive

function cadence(plannedMethod) {
  return CHECK_OR_CASH.has(plannedMethod)
    ? { firstDays: 10, everyDays: 3 }
    : { firstDays: 2, everyDays: 2 };
}

function localHour(now, tz) {
  try {
    const h = new Intl.DateTimeFormat("en-US", { timeZone: tz || "America/New_York", hour: "2-digit", hourCycle: "h23" })
      .formatToParts(now).find((p) => p.type === "hour").value;
    return Number(h) % 24;
  } catch {
    return localHour(now, "America/New_York");
  }
}

/** Is a reminder due for this row at `now`? Pure — the poller and the tests share it. */
function reminderDue(row, now = new Date()) {
  if (!row || !row.approved_at) return false;
  const { firstDays, everyDays } = cadence(row.planned_method);
  const h = localHour(now, row.tz);
  if (h < FIRST_HOUR || h >= LAST_HOUR) return false;
  const last = row.pay_reminder_last_at ? new Date(row.pay_reminder_last_at).getTime() : null;
  if (last) return now.getTime() - last >= everyDays * DAY_MS;
  return now.getTime() - new Date(row.approved_at).getTime() >= firstDays * DAY_MS;
}

function reminderPush(row) {
  const amount = `$${Number(row.amount).toFixed(2)}`;
  const who = row.payee_first || "your team member";
  const since = new Date(row.approved_at).toLocaleDateString("en-US", {
    month: "short", day: "numeric", timeZone: row.tz || "America/New_York",
  });
  return {
    title: "Reimbursement still to pay",
    body: CHECK_OR_CASH.has(row.planned_method)
      ? `${amount} to ${who}, approved ${since}, isn't marked paid yet.`
      : `${amount} to ${who}, approved ${since}, hasn't been paid yet. Tap to pay.`,
    tag: `reimbursement-unpaid-${row.id}`,
    data: {
      type: "reimbursement_unpaid", reimbursementId: row.id, careTeamId: row.care_team_id,
      page: "care-team", focus: `reimbursement:${row.id}`,
    },
  };
}

/** The unpaid, approved rows and who pays each. One query; the payer rule mirrors teamAccess(). */
async function unpaidRows(db) {
  return db.prepare(`
    SELECT r.id, r.amount, r.planned_method, r.approved_at, r.care_team_id, r.payee_user_id,
           r.pay_reminder_last_at, r.pay_reminder_count,
           COALESCE(ct.billing_user_id,
             (SELECT m.user_id FROM care_team_members m
               WHERE m.care_team_id = ct.id AND m.role = 'leader' LIMIT 1)) AS payer_id,
           cr.timezone AS tz, pu.first_name AS payee_first
      FROM reimbursements r
      JOIN care_teams ct ON ct.id = r.care_team_id
      JOIN care_recipients cr ON cr.id = ct.care_recipient_id
      LEFT JOIN users pu ON pu.id = r.payee_user_id
     WHERE r.status = 'approved'
       AND r.approved_at IS NOT NULL
       AND COALESCE(r.payout_status, '') NOT IN ('processing', 'succeeded')
  `).all();
}

/**
 * Poller 115 (hourly). Claims each due row with a compare-and-set on pay_reminder_count (not the timestamp: a JS
 * Date drops Postgres's microseconds, so an equality on it never matches), so
 * two passes can never both send the same reminder, then pushes the payer.
 */
async function sendUnpaidReimbursementReminders(db, pushFn, now = new Date()) {
  let sent = 0;
  for (const row of await unpaidRows(db)) {
    if (!row.payer_id || row.payer_id === row.payee_user_id) continue; // nobody else to ask
    if (!reminderDue(row, now)) continue;
    const claim = await db.prepare(`
      UPDATE reimbursements
         SET pay_reminder_last_at = NOW(), pay_reminder_count = COALESCE(pay_reminder_count, 0) + 1
       WHERE id = ? AND status = 'approved' AND COALESCE(pay_reminder_count, 0) = ?
    `).run(row.id, Number(row.pay_reminder_count || 0));
    if (!claim || claim.changes !== 1) continue;
    await pushFn(row.payer_id, reminderPush(row), "reimbursement_unpaid");
    sent++;
  }
  return sent;
}

module.exports = { cadence, reminderDue, reminderPush, sendUnpaidReimbursementReminders, CHECK_OR_CASH };
