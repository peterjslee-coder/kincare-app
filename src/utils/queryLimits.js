/**
 * Clamp a client-supplied list limit. (v1.106.9)
 *
 * `LIMIT ?` with `parseInt(req.query.limit)` straight from the query string is an unbounded
 * read with extra steps: `?limit=999999999` is one authenticated request that makes Postgres
 * assemble the whole table and Node hold it in memory. On tables that only grow — sessions,
 * messages, activity — that is a denial of service anyone with a login can perform, and it
 * gets worse every month whether or not anyone tries.
 *
 * NaN and a missing value fall back to the caller's default rather than to zero: a limit that
 * silently becomes 0 turns a working list into an empty one, which reads as data loss.
 *
 * @param {*} value      req.query.limit, whatever shape it arrives in
 * @param {number} def   what to use when it is absent or unparseable
 * @param {number} max   the ceiling this endpoint will honour
 */
function clampLimit(value, def, max) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(n, max);
}

/** An offset with the same treatment, plus a ceiling so deep paging cannot scan forever. */
function clampOffset(value, max = 10000) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, max);
}

module.exports = { clampLimit, clampOffset };
