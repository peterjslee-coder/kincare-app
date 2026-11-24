/**
 * Expand a recurrence rule into concrete dates. (v1.106.16)
 *
 * Moved out of routes/sessions.js. Pure function of its arguments — no db, no request.
 *
 * ─── v1.106.33 — a weekday pattern, not just "same day next week" ───
 *
 * Pete: "Would it be easier for me to make an appointment for MTWThF from 9-5 for four weeks
 * instead of doing separate appointments for every day?" It would, and it could not be done:
 * "weekly" stepped 7 days from ONE start date, so Monday-to-Friday for four weeks meant five
 * separate bookings, five recurrence groups, and five cards for the caregiver to accept.
 *
 * care_tasks has stored `recurrence_days` as 'mon,tue,wed,thu,fri' since 011; bookings never
 * learned it. Now they have, which means one request → one group → ONE card with twenty dates
 * and one tap, because the grouping and the atomic claim from v1.106.24 already handle N
 * occurrences in a group and needed nothing new.
 */
const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** 'mon,tue,fri' → Set{1,2,5}. Unknown tokens are dropped rather than throwing. */
function parseDays(recurrenceDays) {
  const out = new Set();
  for (const raw of String(recurrenceDays || "").split(",")) {
    const i = DAY_KEYS.indexOf(raw.trim().toLowerCase().slice(0, 3));
    if (i !== -1) out.add(i);
  }
  return out;
}

/** Local-noon Date for a YYYY-MM-DD string. Noon so no timezone shift moves the date. */
function atNoon(dateStr) {
  const [y, mo, d] = String(dateStr).split("-").map(Number);
  return new Date(y, mo - 1, d, 12, 0, 0);
}

function toDateString(dt) {
  return dt.getFullYear() + "-" + String(dt.getMonth() + 1).padStart(2, "0") + "-" + String(dt.getDate()).padStart(2, "0");
}

/**
 * @param {string} startDate  YYYY-MM-DD — the first day of the arrangement
 * @param {string} rule       "weekly" | "biweekly" | "days"
 * @param {number} weeks      how many weeks the arrangement runs
 * @param {string} [recurrenceDays] for rule "days": 'mon,tue,wed,thu,fri'
 * @returns {string[]} ascending, unique dates
 */
function generateRecurringDates(startDate, rule, weeks, recurrenceDays) {
  // ─── "days": every chosen weekday, for N weeks ───
  //
  // The week runs from the START DATE's own week, and dates before the start are skipped —
  // booking Mon–Fri on a Wednesday gives you Wed, Thu, Fri and then four full weeks, not a
  // Monday two days in the past. That is the behaviour someone booking mid-week expects, and
  // silently creating a session in the past would be worse than any alternative.
  if (rule === "days") {
    const want = parseDays(recurrenceDays);
    if (want.size === 0) return [startDate];

    // The window is `weeks * 7` days STARTING AT the start date — not calendar weeks
    // aligned to Sunday. Aligning to Sunday quietly short-changes anyone who does not start
    // on one: "two weeks of Saturdays and Sundays" booked on a Saturday produced three
    // visits, because the Sunday of that week was already in the past. Anchoring the window
    // on the day you picked means N weeks is always N weeks of cover, whichever day you ask
    // on, and nothing can land behind the start date because the window begins there.
    const start = atNoon(startDate);
    const dates = [];
    for (let i = 0; i < weeks * 7; i++) {
      const dt = new Date(start);
      dt.setDate(dt.getDate() + i);
      if (want.has(dt.getDay())) dates.push(toDateString(dt));
    }
    return dates;
  }

  // ─── "weekly" / "biweekly": the same weekday, stepping forward ───
  const dates = [];
  const start = atNoon(startDate);
  const interval = rule === "biweekly" ? 14 : 7;
  for (let i = 0; i < weeks; i++) {
    const dt = new Date(start);
    dt.setDate(dt.getDate() + i * interval);
    dates.push(toDateString(dt));
  }
  return dates;
}

module.exports = { generateRecurringDates, parseDays, DAY_KEYS };
