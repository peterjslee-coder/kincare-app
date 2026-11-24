// ─── Stepping out mid-visit, and what it costs (v1.106.41) ───
//
// Pete: "It's possible that Tina will take a job, need to leave for a couple hours, maybe
// come back... As long as it's inside of the time of the original appointment. Remember that
// part of the intent here is that caregivers have a little bit more flexibility in their own
// schedule." And, on the money: "if she needs to run somewhere for a personal reason for an
// hour, she can, but won't be paid... but also has to be cumulative...so no more than 30
// minutes break before we stop pay." And: "if someone is up for a 2 hour session, they
// shouldn't get a 30 minute grace. Let's call it for sessions longer than 4 hours, they get
// a 30 min break. we'll adjust from there."
//
// So the rule, entirely in this file because it is the kind of number that gets tuned:
//
//   · a visit longer than 4 scheduled hours carries 30 free break minutes, CUMULATIVE
//     across however many times she steps out;
//   · a visit of 4 hours or less carries none — a two-hour shift is not long enough to
//     have a paid break inside it;
//   · every minute past the budget comes off the billed time, which is the same thing as
//     saying the family pays for the time she was actually there.
//
// Nothing here decides whether she MAY step out. She may; that is the point. This only
// decides what the visit is worth afterwards.

/** Sessions longer than this (scheduled hours) carry a paid break budget. */
const PAID_BREAK_MIN_SESSION_HOURS = 4;

/** How many cumulative break minutes are paid, on a session long enough to have them. */
const PAID_BREAK_MINUTES = 30;

/**
 * The paid break budget for a visit, in minutes.
 * @param {number} scheduledHours  care_sessions.duration_hours
 */
function breakBudgetMinutes(scheduledHours) {
  const hours = Number(scheduledHours);
  if (!Number.isFinite(hours) || hours <= PAID_BREAK_MIN_SESSION_HOURS) return 0;
  return PAID_BREAK_MINUTES;
}

/**
 * How long a break lasted, in minutes. A break with no ended_at is still running, and is
 * measured to `now` — which at check-out is the check-out moment, so a caregiver who steps
 * out and never comes back is away until she leaves, not away for zero.
 */
function breakMinutes(row, now = new Date()) {
  if (!row || !row.started_at) return 0;
  const start = new Date(row.started_at);
  const end = row.ended_at ? new Date(row.ended_at) : now;
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return 0;
  return Math.max(0, (end - start) / 60000);
}

/**
 * Add up a visit's breaks and split them against the budget.
 *
 * @param {object[]} rows           visit_breaks rows for this session
 * @param {number}   scheduledHours care_sessions.duration_hours
 * @param {Date}     now            what an unfinished break is measured to
 * @returns {{ budgetMinutes, totalMinutes, paidMinutes, unpaidMinutes, remainingMinutes, breakCount, openBreak }}
 */
function summarizeBreaks(rows, scheduledHours, now = new Date()) {
  const list = Array.isArray(rows) ? rows : [];
  const budgetMinutes = breakBudgetMinutes(scheduledHours);
  const totalMinutes = list.reduce((sum, r) => sum + breakMinutes(r, now), 0);
  const paidMinutes = Math.min(totalMinutes, budgetMinutes);
  return {
    budgetMinutes,
    totalMinutes,
    paidMinutes,
    // Rounded UP to the minute against the caregiver only once, at the end, rather than per
    // break: three 11-minute breaks are 33 minutes, not 33 rounded three times.
    unpaidMinutes: Math.ceil(Math.max(0, totalMinutes - budgetMinutes)),
    remainingMinutes: Math.max(0, Math.round(budgetMinutes - totalMinutes)),
    breakCount: list.length,
    openBreak: list.find((r) => !r.ended_at) || null,
  };
}

/**
 * What Tina is told the moment she steps out. Pete: "she should get a notice... 'ok, take a
 * break...you have X minutes left to resume for your agreed pay'".
 *
 * `remaining` is what is left AFTER this break starts counting, so the sentence is about the
 * budget she still has, not the one she had before tapping.
 */
function breakNotice({ budgetMinutes, remainingMinutes }) {
  if (budgetMinutes === 0) {
    return `Take your break. This visit is short enough that it has no paid break time, so the clock is paused until you're back.`;
  }
  if (remainingMinutes <= 0) {
    return `Take your break. You've used your ${budgetMinutes} paid minutes, so from here the clock is paused until you're back.`;
  }
  return `Take your break — you have ${remainingMinutes} min left before it comes out of your pay for this visit.`;
}

module.exports = {
  PAID_BREAK_MIN_SESSION_HOURS,
  PAID_BREAK_MINUTES,
  breakBudgetMinutes,
  breakMinutes,
  summarizeBreaks,
  breakNotice,
};
