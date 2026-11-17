/**
 * Date-of-birth comparison for identity checks (v1.128.3).
 *
 * Pete, 11/16 (feedback 2cbb633c): "Keeps saying that the DOB mismatch is because of leading
 * zeros on the dates. This is not a mismatch."
 *
 * Both ID routes turned the stored DOB into `new Date(x).toLocaleDateString('en-US')` —
 * "3/5/1990" — and compared it as TEXT against what the model read off the card, "03/05/1990".
 * Every birthday with a month or day under 10 was a "mismatch". It also parsed a bare
 * "1990-03-05" as UTC midnight, which is the previous day anywhere west of Greenwich.
 *
 * Dates are compared as numbers (year, month, day). A date we cannot read is NOT a mismatch —
 * it is "not known", and the caller says so (CLAUDE.md: a check has three states).
 */

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function valid(y, m, d) {
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 0)) return null;
  return { y, m, d };
}

/** @returns {{y:number,m:number,d:number}|null} y may be 2-digit (0–99) when the source was. */
function parseDateParts(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    // pg's DATE parser builds a Date at LOCAL midnight; read it back in the same frame.
    return valid(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }
  const s = String(value).trim();
  let m;
  // 1990-03-05 (optionally followed by a time)
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:$|[T\s])/))) return valid(+m[1], +m[2], +m[3]);
  // 03/05/1990, 3-5-1990, 03.05.90 — US order, as the IDs we accept print it
  if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/))) return valid(+m[3], +m[1], +m[2]);
  // 05 MAR 1990 / 5 March 1990 (passports)
  if ((m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{2}|\d{4})$/))) {
    const mo = MONTHS[m[2].toLowerCase().slice(0, 3)];
    return mo ? valid(+m[3], mo, +m[1]) : null;
  }
  // March 5, 1990 / Mar 05 1990
  if ((m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{2}|\d{4})$/))) {
    const mo = MONTHS[m[1].toLowerCase().slice(0, 3)];
    return mo ? valid(+m[3], mo, +m[2]) : null;
  }
  return null;
}

/**
 * @returns {true|false|null} true = same day, false = different day, null = could not compare.
 */
function sameBirthDate(a, b) {
  const x = parseDateParts(a);
  const y = parseDateParts(b);
  if (!x || !y) return null;
  if (x.m !== y.m || x.d !== y.d) return false;
  // A two-digit year on either side can only be compared modulo 100.
  if (x.y < 100 || y.y < 100) return x.y % 100 === y.y % 100;
  return x.y === y.y;
}

/** "3/5/1990" — how we show a stored date back to an admin. */
function formatUS(value) {
  const p = parseDateParts(value);
  return p ? `${String(p.m).padStart(2, "0")}/${String(p.d).padStart(2, "0")}/${p.y}` : String(value || "");
}

module.exports = { parseDateParts, sameBirthDate, formatUS };
