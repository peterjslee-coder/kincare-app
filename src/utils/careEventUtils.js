/**
 * Care Events — pure helpers (v1.100.0).
 *
 * Everything here is side-effect-free so it can be unit tested without a
 * database: input validation, local date/time math in the care recipient's
 * timezone, the reminder-stage decision the poller acts on, and .ics
 * generation for "Add to my calendar".
 *
 * Timezone rule (house style): event_date/event_time are naive strings in
 * the care recipient's timezone; starts_at is the derived real instant.
 */

const { zonedDateTimeToInstant } = require("./timezone");

const DEFAULT_TZ = "America/New_York";
const CATEGORIES = ["medical", "social", "transport", "other"];

// ─── Local date/time strings for an instant, in a zone ───

function localDateStringInZone(date, tz) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz || DEFAULT_TZ }).format(date);
}

function localTimeStringInZone(date, tz) {
  const s = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz || DEFAULT_TZ, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(date);
  return s.replace(/^24:/, "00:"); // en-GB quirk: midnight formats as 24:xx
}

// "2026-07-22" + n days → "2026-07-23" (pure string math, DST-proof)
function addDaysToDateString(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

// The real instant an event starts. All-day events anchor at 00:00 local.
function eventStartInstant(ev) {
  const tz = ev.tz || DEFAULT_TZ;
  return zonedDateTimeToInstant(ev.event_date, ev.event_time || "00:00", tz);
}

// ─── Validation ───

function validateEventInput(body) {
  const errors = [];
  if (!body.title || !String(body.title).trim()) errors.push("What's the event? A title is required.");
  if (String(body.title || "").length > 200) errors.push("Title is too long.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.event_date || "")) errors.push("A date is required (YYYY-MM-DD).");
  if (body.event_time != null && body.event_time !== "" && !/^\d{2}:\d{2}$/.test(body.event_time)) {
    errors.push("Time must be HH:MM.");
  }
  if (body.end_time != null && body.end_time !== "" && !/^\d{2}:\d{2}$/.test(body.end_time)) {
    errors.push("End time must be HH:MM.");
  }
  const category = CATEGORIES.includes(body.category) ? body.category : "other";
  return { errors, category };
}

// ─── Reminder stages (family-only pushes; decided here, sent by the poller) ───
//
// Two notices per event, once each:
//  - 'day_before'  → fires the evening before (>= 5pm local on the prior day)
//  - 'same_day'    → timed events: inside the 2h window before start (until
//                    1h after — late is still useful, ancient is not);
//                    all-day events: from 8am local on the day.
// Events are awareness, not obligations: nothing escalates, nothing "misses".

function reminderStage(ev, nowMs) {
  const sent = ev.reminders_sent || "";
  const tz = ev.tz || DEFAULT_TZ;
  const now = new Date(nowMs);
  const todayLocal = localDateStringInZone(now, tz);
  const localHour = parseInt(localTimeStringInZone(now, tz).slice(0, 2), 10);
  const startMs = eventStartInstant(ev).getTime();

  if (!sent.includes("same_day")) {
    if (!ev.event_time) {
      // All-day: morning-of nudge
      if (ev.event_date === todayLocal && localHour >= 8) return "same_day";
    } else {
      const windowOpen = startMs - 2 * 3600000;
      const windowClose = startMs + 1 * 3600000;
      if (nowMs >= windowOpen && nowMs <= windowClose) return "same_day";
    }
  }

  if (!sent.includes("day_before")) {
    const tomorrowLocal = addDaysToDateString(todayLocal, 1);
    if (ev.event_date === tomorrowLocal && localHour >= 17) return "day_before";
  }

  return null;
}

// ─── .ics generation ("Add to my calendar") ───

function icsEscape(s) {
  return String(s || "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function icsUtcStamp(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function buildIcs(ev, { now = new Date() } = {}) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//InPlace//Care Events//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${ev.id}@yourinplace.com`,
    `DTSTAMP:${icsUtcStamp(now)}`,
  ];
  if (!ev.event_time) {
    // All-day: DATE values; DTEND is exclusive → next day
    lines.push(`DTSTART;VALUE=DATE:${ev.event_date.replace(/-/g, "")}`);
    lines.push(`DTEND;VALUE=DATE:${addDaysToDateString(ev.event_date, 1).replace(/-/g, "")}`);
  } else {
    const start = eventStartInstant(ev);
    const end = ev.end_time
      ? zonedDateTimeToInstant(ev.event_date, ev.end_time, ev.tz || DEFAULT_TZ)
      : new Date(start.getTime() + 3600000); // default 1h
    lines.push(`DTSTART:${icsUtcStamp(start)}`);
    lines.push(`DTEND:${icsUtcStamp(end <= start ? new Date(start.getTime() + 3600000) : end)}`);
  }
  lines.push(`SUMMARY:${icsEscape(ev.title)}`);
  if (ev.location) lines.push(`LOCATION:${icsEscape(ev.location)}`);
  if (ev.details) lines.push(`DESCRIPTION:${icsEscape(ev.details)}`);
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

module.exports = {
  CATEGORIES,
  localDateStringInZone,
  localTimeStringInZone,
  addDaysToDateString,
  eventStartInstant,
  validateEventInput,
  reminderStage,
  buildIcs,
};
