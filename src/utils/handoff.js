// ─── The hand-off note (v1.154.0) ───
//
// Pete, 11/23 — the first day one caregiver handed Betty over to another: "have the caretaker
// who's leaving fill out notes before the other caretaker shows up or checks in. Maybe prompt
// for notes and handoff situation 15 minutes prior?" His calls the same evening: optional (she
// can Skip, and the family sees that she did); a hand-off only when the next caregiver's visit
// starts no later than an hour after this one ends; read by the next caregiver and the family —
// not by every caregiver on the team.
//
// All times here are naive care-location wall times (scheduled_date / scheduled_time), compared
// as minutes from the outgoing visit's own date, so an overnight hand-off across midnight works.

const BookingRank = require("../../public/js/bookingRank");
const { getNowInZone, buildDateTimeInZone } = require("./timezone");

const HANDOFF_WINDOW_MIN = 60;   // the next visit starts no later than this after the end
const PROMPT_BEFORE_END_MIN = 15;
const CONDITIONS = ["napping", "calm", "happy", "restless", "unwell"];
const CONDITION_LABELS = { napping: "Napping", calm: "Calm", happy: "Happy", restless: "Restless", unwell: "Not feeling well" };

const minutesOn = (baseDate, date, time) => {
  const t = BookingRank.toMin(time);
  if (t == null) return null;
  if (date === baseDate) return t;
  if (BookingRank.minusDays(date, 1) === baseDate) return t + 24 * 60;
  return null;
};

/**
 * The visit that follows `s` for the same person, with a different caregiver, starting after
 * `s` starts and no later than an hour after it ends. Overlaps count (both there at once).
 */
async function nextVisitAfter(db, s) {
  if (!s || !s.scheduled_date || !s.scheduled_time || !s.care_recipient_id) return null;
  const start = BookingRank.toMin(s.scheduled_time);
  const end = start + Math.round((Number(s.duration_hours) || 0) * 60);
  const tomorrow = BookingRank.minusDays(s.scheduled_date, -1);
  const rows = await db.prepare(`
    SELECT cs.id, cs.scheduled_date, cs.scheduled_time, cs.duration_hours, cs.caregiver_id,
           cp.user_id AS caregiver_user_id, u.first_name AS caregiver_first_name
      FROM care_sessions cs
      JOIN caregiver_profiles cp ON cp.id = cs.caregiver_id
      JOIN users u ON u.id = cp.user_id
     WHERE cs.care_recipient_id = ?
       AND cs.id <> ?
       AND cs.status IN ('confirmed', 'in_progress')
       AND cs.caregiver_id IS NOT NULL
       AND cs.caregiver_id <> ?
       AND cs.scheduled_date IN (?, ?)
  `).all(s.care_recipient_id, s.id, s.caregiver_id || "", s.scheduled_date, tomorrow);
  let best = null;
  for (const r of rows) {
    const m = minutesOn(s.scheduled_date, r.scheduled_date, r.scheduled_time);
    if (m == null || m <= start || m > end + HANDOFF_WINDOW_MIN) continue;
    if (!best || m < best.m) best = { m, r };
  }
  if (!best) return null;
  const r = best.r;
  return {
    sessionId: r.id,
    caregiverUserId: r.caregiver_user_id,
    caregiverFirstName: r.caregiver_first_name || null,
    date: r.scheduled_date,
    time: r.scheduled_time,
  };
}

/** Is it time to ask the outgoing caregiver? 15 minutes before her scheduled end, onwards. */
function promptDue(s, tz, now = getNowInZone(tz)) {
  const start = buildDateTimeInZone(s.scheduled_date, s.scheduled_time, tz);
  if (!start || isNaN(start.getTime())) return false;
  const endMs = start.getTime() + (Number(s.duration_hours) || 0) * 3600000;
  return now.getTime() >= endMs - PROMPT_BEFORE_END_MIN * 60000;
}

/**
 * What the outgoing caregiver's day already says, so she does not retype it: today's care
 * checks for this person (done / still due, with the time) and the open to-dos. Plain lines,
 * frozen into the hand-off when it is written.
 */
async function buildSnapshot(db, s, tz) {
  const fmt = (d) => {
    try {
      return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz || "America/New_York" }).format(new Date(d));
    } catch { return ""; }
  };
  const tasks = await db.prepare(`
    SELECT ct.title, o.status, o.due_at, o.completed_at
      FROM care_task_occurrences o
      JOIN care_tasks ct ON ct.id = o.task_id
     WHERE ct.care_recipient_id = ? AND o.due_date = ? AND ct.is_active = 1
     ORDER BY o.due_at ASC
     LIMIT 20
  `).all(s.care_recipient_id, s.scheduled_date);
  const todos = await db.prepare(`
    SELECT title FROM care_todos
     WHERE care_recipient_id = ? AND removed_at IS NULL AND completed_at IS NULL
     ORDER BY created_at ASC LIMIT 10
  `).all(s.care_recipient_id);
  return {
    tasks: tasks.map((t) => ({
      title: t.title,
      done: t.status === "done" || (!!t.completed_at && t.status !== "skipped"),
      skipped: t.status === "skipped",
      at: fmt(t.completed_at || t.due_at),
    })),
    todos: todos.map((t) => t.title),
  };
}

module.exports = {
  HANDOFF_WINDOW_MIN, PROMPT_BEFORE_END_MIN, CONDITIONS, CONDITION_LABELS,
  nextVisitAfter, promptDue, buildSnapshot,
};
