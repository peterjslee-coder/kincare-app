// ─── One vocabulary for audit_log.severity (v1.105.77) ───
//
// There were two words for the same thing and a third that nothing ever wrote.
//
//   'warn'     written by middleware/auditLog.js (4 route patterns) — and read by every filter
//   'warning'  written by admin/access.js (impersonation start) and checkr.js ×4 — read by NOTHING
//   'error'    read by three filters, written ZERO times
//
// So `severity IN ('critical','error')` only ever matched 'critical', and the five explicit
// 'warning' rows — an admin starting an impersonation session, a background check expiring,
// a candidate suspended, a dispute — were written to audit_log and could never appear in
// Admin → Monitoring. The security panel reported a clean night because it was asking for a
// word nobody used.
//
// This is the same shape as the wrong-column class from v1.105.65: a string constant that
// looks like a filter and matches nothing. It is not catchable by lint:sql-columns, because
// every column name here is real — only the VALUES are wrong.
//
// Canonical set going forward is 'warning'. Filters accept 'warn' too, because rows already in
// the table carry it and a security log must not lose history to a rename.

const SEVERITY = Object.freeze({
  INFO: "info",
  WARNING: "warning",
  CRITICAL: "critical",
});

// Everything that should reach a human looking at a security surface. Includes the legacy
// spellings on purpose — see above.
const ELEVATED = Object.freeze(["warn", "warning", "error", "critical"]);

// Ready to interpolate into a query: severity IN ('warn','warning','error','critical')
const ELEVATED_SQL = ELEVATED.map((s) => `'${s}'`).join(", ");

/** Map any legacy spelling onto the canonical set. */
function normalizeSeverity(s) {
  if (s === "warn") return SEVERITY.WARNING;
  if (s === "error") return SEVERITY.CRITICAL;
  return s || SEVERITY.INFO;
}

module.exports = { SEVERITY, ELEVATED, ELEVATED_SQL, normalizeSeverity };
