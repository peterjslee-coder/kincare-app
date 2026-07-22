/**
 * Care Tasks — pure recurrence/scheduling helpers (v1.99.0).
 *
 * Kept free of DB and clock dependencies so the logic is unit-testable and
 * shared verbatim by the API routes and the server poller. Date strings are
 * YYYY-MM-DD; times are HH:MM (24h); day lists use the same lowercase
 * three-letter names Kindred's voice_reminders established (mon,tue,...).
 */

const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

// Weekday name for a YYYY-MM-DD string, timezone-proof (noon UTC never
// crosses a date boundary for any UTC±14 zone).
function dayNameOf(dateStr) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  if (isNaN(d.getTime())) return null;
  return DAY_NAMES[d.getUTCDay()];
}

/**
 * Is this task due on the given date?
 * task: { recurrence: 'daily'|'weekly'|'days', recurrence_days, start_date, end_date, is_active }
 * - 'daily'  → every day
 * - 'weekly' → the weekday of start_date
 * - 'days'   → any weekday named in recurrence_days ("mon,wed,fri")
 * Window: start_date <= date <= end_date (end_date null = ongoing).
 */
function isDueOn(task, dateStr) {
  if (!task || !dateStr) return false;
  if (task.is_active === 0 || task.is_active === false) return false;
  if (task.start_date && dateStr < task.start_date) return false;
  if (task.end_date && dateStr > task.end_date) return false;

  const rec = task.recurrence || "daily";
  if (rec === "daily") return true;

  const dow = dayNameOf(dateStr);
  if (!dow) return false;

  if (rec === "weekly") {
    return dayNameOf(task.start_date) === dow;
  }
  if (rec === "days") {
    const days = String(task.recurrence_days || "")
      .toLowerCase()
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return days.includes(dow);
  }
  return false;
}

// Basic input validation shared by create/update routes.
function validateTaskInput(body) {
  const errors = [];
  if (!body.title || !String(body.title).trim()) errors.push("Title is required");
  if (String(body.title || "").length > 200) errors.push("Title too long (200 max)");
  const rec = body.recurrence || "daily";
  if (!["daily", "weekly", "days"].includes(rec)) errors.push("Invalid recurrence");
  if (rec === "days") {
    const days = String(body.recurrence_days || "").toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);
    if (days.length === 0 || days.some((d) => !DAY_NAMES.includes(d))) errors.push("Pick at least one valid day");
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(body.due_time || ""))) errors.push("Due time must be HH:MM");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.start_date || ""))) errors.push("Start date must be YYYY-MM-DD");
  if (body.end_date && !/^\d{4}-\d{2}-\d{2}$/.test(String(body.end_date))) errors.push("End date must be YYYY-MM-DD");
  if (body.end_date && body.start_date && body.end_date < body.start_date) errors.push("End date is before start date");
  const grace = body.grace_minutes === undefined || body.grace_minutes === null ? 45 : Number(body.grace_minutes);
  if (!Number.isFinite(grace) || grace < 0 || grace > 24 * 60) errors.push("Grace must be 0–1440 minutes");
  const type = body.task_type || "custom";
  if (!["medication", "hygiene", "meal", "checkin", "custom"].includes(type)) errors.push("Invalid task type");
  return { errors, grace, rec, type };
}

module.exports = { DAY_NAMES, dayNameOf, isDueOn, validateTaskInput };
