/**
 * Expand a recurrence rule into concrete dates. (v1.106.16)
 *
 * Moved out of routes/sessions.js. Pure function of its arguments — no db, no request.
 */
function generateRecurringDates(startDate, rule, weeks) {
  const dates = [];
  // Parse date safely without UTC offset issues
  const [y, mo, d] = startDate.split("-").map(Number);
  const start = new Date(y, mo - 1, d, 12, 0, 0);
  const interval = rule === "biweekly" ? 14 : 7; // weekly or biweekly

  for (let i = 0; i < weeks; i++) {
    const dt = new Date(start);
    dt.setDate(dt.getDate() + i * interval);
    const dateStr = dt.getFullYear() + "-" + String(dt.getMonth() + 1).padStart(2, "0") + "-" + String(dt.getDate()).padStart(2, "0");
    dates.push(dateStr);
  }
  return dates;
}

module.exports = { generateRecurringDates };
