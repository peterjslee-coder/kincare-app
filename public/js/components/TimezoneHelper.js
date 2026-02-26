/**
 * TimezoneHelper — Frontend timezone utilities for InPlace
 *
 * Design principle: ALL times are care-location times.
 * The viewer's timezone is irrelevant — if a session is at 8am in Virginia,
 * it shows as 8am regardless of where the user is viewing from.
 *
 * Sessions include a `timezone` field from the API (default: "America/New_York").
 */
const TimezoneHelper = window.TimezoneHelper = (() => {
  const DEFAULT_TZ = "America/New_York";

  /**
   * Get "now" as a Date object in the care location's timezone.
   * The returned Date's getHours(), getMinutes(), etc. reflect the care timezone.
   */
  function getNow(tz) {
    const tzStr = tz || DEFAULT_TZ;
    const str = new Date().toLocaleString("en-US", { timeZone: tzStr });
    return new Date(str);
  }

  /**
   * Get today's date string (YYYY-MM-DD) in the care location's timezone.
   */
  function getToday(tz) {
    const now = getNow(tz);
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
   */
  function buildDateTime(dateStr, timeStr, tz) {
    const [y, mo, d] = dateStr.split("-").map(Number);
    const [h, m] = (timeStr || "00:00").split(":").map(Number);
    const ref = getNow(tz);
    const result = new Date(ref);
    result.setFullYear(y, mo - 1, d);
    result.setHours(h, m, 0, 0);
    return result;
  }

  /**
   * Parse a date string safely into a local Date (no UTC offset issues).
   * "2026-02-26" → new Date(2026, 1, 26) (local midnight, not UTC)
   */
  function parseDate(dateStr) {
    const clean = (dateStr || "").split("T")[0];
    const [y, mo, d] = clean.split("-").map(Number);
    if (!y || !mo || !d) return new Date(NaN);
    return new Date(y, mo - 1, d);
  }

  /**
   * Format a time string for display: "08:00" → "8:00 AM"
   */
  function formatTime(timeStr) {
    if (!timeStr) return "";
    const [h, m] = timeStr.split(":").map(Number);
    const ampm = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 || 12;
    return h12 + ":" + String(m).padStart(2, "0") + " " + ampm;
  }

  /**
   * Get a relative date label: "Today", "Tomorrow", or formatted date.
   */
  function getDateLabel(dateStr, tz) {
    const today = getToday(tz);
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

    const clean = (dateStr || "").split("T")[0];
    if (clean === today) return "Today";
    if (clean === tomorrowStr) return "Tomorrow";

    const [y, mo, d] = clean.split("-").map(Number);
    const dt = new Date(y, mo - 1, d);
    return dt.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  }

  return {
    DEFAULT_TZ,
    getNow,
    getToday,
    buildDateTime,
    parseDate,
    formatTime,
    getDateLabel,
  };
})();
