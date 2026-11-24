// ─── v1.155.7 — how a repeating event finds its next date ───
//
// v1.130.2 made events repeat weekly ("church every Sunday"). Pete, 11/24: "repeating on days
// that we chose and labels as we typed. It might be anniversaries or birthdays or we could
// import major holiday lists like Christmas and Thanksgiving" — and "yes to all those holidays.
// Add emojis."
//
// A series is still materialized rows sharing series_id (routes/careEvents.js extendSeries);
// this file only answers "what date comes after this one?" for each rule:
//   weekly          +7 days
//   yearly          same month and day next year (Feb 29 → Feb 28 in a non-leap year)
//   holiday:<key>   that holiday's date next year — Thanksgiving is not the same date twice

const pad = (n) => String(n).padStart(2, "0");
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const dow = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday

/** The nth (1-based) given weekday of a month; n = -1 is the last. */
function nthWeekday(y, m, weekday, n) {
  if (n > 0) {
    const first = dow(y, m, 1);
    return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
  }
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const last = dow(y, m, lastDay);
  return lastDay - ((last - weekday + 7) % 7);
}

/** Western Easter (anonymous Gregorian algorithm). */
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return [month, day];
}

// The list Pete approved, in calendar order. Titles carry their emoji.
const HOLIDAYS = [
  { key: "new-year", title: "\u{1F386} New Year's Day", date: (y) => ymd(y, 1, 1) },
  { key: "easter", title: "\u{1F430} Easter", date: (y) => { const [m, d] = easter(y); return ymd(y, m, d); } },
  { key: "mothers-day", title: "\u{1F490} Mother's Day", date: (y) => ymd(y, 5, nthWeekday(y, 5, 0, 2)) },
  { key: "memorial-day", title: "\u{1F1FA}\u{1F1F8} Memorial Day", date: (y) => ymd(y, 5, nthWeekday(y, 5, 1, -1)) },
  { key: "fathers-day", title: "\u{1F454} Father's Day", date: (y) => ymd(y, 6, nthWeekday(y, 6, 0, 3)) },
  { key: "july-4", title: "\u{1F387} Independence Day", date: (y) => ymd(y, 7, 4) },
  { key: "labor-day", title: "\u{1F6E0}️ Labor Day", date: (y) => ymd(y, 9, nthWeekday(y, 9, 1, 1)) },
  { key: "thanksgiving", title: "\u{1F983} Thanksgiving", date: (y) => ymd(y, 11, nthWeekday(y, 11, 4, 4)) },
  { key: "christmas", title: "\u{1F384} Christmas", date: (y) => ymd(y, 12, 25) },
];
const HOLIDAY_BY_KEY = new Map(HOLIDAYS.map((h) => [h.key, h]));

const REPEAT_CHOICES = ["weekly", "yearly"]; // what a person can pick on an event

function isRepeatRule(rule) {
  return rule === "weekly" || rule === "yearly" || (typeof rule === "string" && rule.startsWith("holiday:") && HOLIDAY_BY_KEY.has(rule.slice(8)));
}

/** The date after `dateStr` for a rule, or null for an unknown rule. */
function nextDate(rule, dateStr) {
  const [y, m, d] = String(dateStr).split("-").map(Number);
  if (rule === "weekly") {
    const t = new Date(Date.UTC(y, m - 1, d + 7));
    return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
  }
  if (rule === "yearly") {
    if (m === 2 && d === 29 && !isLeap(y + 1)) return ymd(y + 1, 2, 28);
    return ymd(y + 1, m, d);
  }
  if (typeof rule === "string" && rule.startsWith("holiday:")) {
    const h = HOLIDAY_BY_KEY.get(rule.slice(8));
    return h ? h.date(y + 1) : null;
  }
  return null;
}

/** The first date of a holiday on or after `todayStr`. */
function nextHolidayDate(key, todayStr) {
  const h = HOLIDAY_BY_KEY.get(key);
  if (!h) return null;
  const y = Number(String(todayStr).slice(0, 4));
  const thisYear = h.date(y);
  return thisYear >= todayStr ? thisYear : h.date(y + 1);
}

/** Is a series filled far enough? Weekly is bounded by its 12-week horizon in the caller;
 *  yearly and holidays only need their next date (on or after today). */
function isFilled(rule, lastDate, todayStr) {
  if (rule === "weekly") return false;
  return lastDate >= todayStr;
}

/** "every week" / "every year" for labels. */
function repeatLabel(rule) {
  if (rule === "weekly") return "every week";
  if (rule === "yearly" || (rule && String(rule).startsWith("holiday:"))) return "every year";
  return "";
}

module.exports = { HOLIDAYS, REPEAT_CHOICES, isRepeatRule, nextDate, nextHolidayDate, isFilled, repeatLabel, nthWeekday, easter };
