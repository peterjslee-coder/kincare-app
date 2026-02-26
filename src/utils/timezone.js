/**
 * Centralized timezone utilities for InPlace
 *
 * Design principle: ALL times are care-location times.
 * If a session is at 8am in Virginia, that means 8am Eastern —
 * regardless of where the viewer is located.
 *
 * Sessions store naive date/time strings (scheduled_date = "2026-02-26",
 * scheduled_time = "08:00") with no timezone metadata. The timezone
 * comes from the care_recipients.timezone column (default: America/New_York).
 */

const DEFAULT_TIMEZONE = "America/New_York";

/**
 * Get "now" as a Date object in the care location's timezone.
 * The returned Date's getHours(), getMinutes(), etc. reflect the care timezone.
 */
function getNowInZone(tz = DEFAULT_TIMEZONE) {
  const str = new Date().toLocaleString("en-US", { timeZone: tz });
  return new Date(str);
}

/**
 * Get today's date string (YYYY-MM-DD) in the care location's timezone.
 */
function getTodayStringInZone(tz = DEFAULT_TIMEZONE) {
  const now = getNowInZone(tz);
  return (
    now.getFullYear() +
    "-" +
    String(now.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(now.getDate()).padStart(2, "0")
  );
}

/**
 * Build a Date object for a session's date + time in the care timezone.
 * dateStr: "2026-02-26", timeStr: "08:00"
 * Returns a Date whose .getHours() etc. match the care timezone.
 */
function buildDateTimeInZone(dateStr, timeStr, tz = DEFAULT_TIMEZONE) {
  const [y, mo, d] = dateStr.split("-").map(Number);
  const [h, m] = (timeStr || "00:00").split(":").map(Number);
  // Get "now" in the timezone so we have a reference frame
  const ref = getNowInZone(tz);
  const result = new Date(ref);
  result.setFullYear(y, mo - 1, d);
  result.setHours(h, m, 0, 0);
  return result;
}

/**
 * Format a session time for display: "8:00 AM"
 */
function formatTimeForDisplay(timeStr) {
  if (!timeStr) return "";
  const [h, m] = timeStr.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

/**
 * Format a date string relative to "today" in the care timezone.
 * Returns "Today", "Tomorrow", or a formatted date string.
 */
function formatDateRelative(dateStr, tz = DEFAULT_TIMEZONE) {
  const today = getTodayStringInZone(tz);
  const todayParts = today.split("-").map(Number);
  const todayDate = new Date(todayParts[0], todayParts[1] - 1, todayParts[2]);
  const tomorrow = new Date(todayDate);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr =
    tomorrow.getFullYear() +
    "-" +
    String(tomorrow.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(tomorrow.getDate()).padStart(2, "0");

  if (dateStr === today) return "Today";
  if (dateStr === tomorrowStr) return "Tomorrow";
  // Return a readable date
  const [y, mo, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, mo - 1, d);
  return dt.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

module.exports = {
  DEFAULT_TIMEZONE,
  getNowInZone,
  getTodayStringInZone,
  buildDateTimeInZone,
  formatTimeForDisplay,
  formatDateRelative,
};
