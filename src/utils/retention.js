/**
 * Retention — the tables nothing ever deletes from. (v1.106.9)
 *
 * Five tables grow forever and are never read past a certain age: an audit entry from March,
 * a delivered notification from June, a telemetry row from an onboarding funnel that has since
 * been redesigned. Nobody looks at them, and every one is copied into every backup and scanned
 * by every unindexed query for the rest of the product's life.
 *
 * The windows are Pete's call, not a default (Sept 13):
 *
 *   audit_log            180 days   evidence. Shorten only if a lawyer says so.
 *   admin_audit_log      365 days   what an admin did to someone else's account. Keep longer.
 *   notifications         60 days   already delivered; the app shows a short list anyway.
 *   activity_feed         60 days   user-visible history, and 60 days is what he asked for.
 *   onboarding_events     30 days   telemetry, and the one table an UNAUTHENTICATED caller
 *                                   can write to, so it is the one that most needs a ceiling.
 *
 * Deliberately NOT here: messages, care_sessions, visit_logs, notes, photos. Those are the
 * care record. Deleting a family's history of their mother's care because it is old is not a
 * disk-space decision, and nothing in this file should ever make it look like one.
 *
 * Deletes in batches with a ceiling per run. A single unbounded DELETE against a table with a
 * year of rows takes a lock and a long transaction; the point of this is to be boring.
 */
const RETENTION = [
  { table: "audit_log",         column: "created_at", days: 180 },
  { table: "admin_audit_log",   column: "created_at", days: 365 },
  { table: "notifications",     column: "created_at", days: 60 },
  { table: "activity_feed",     column: "created_at", days: 60 },
  { table: "onboarding_events", column: "created_at", days: 30 },
];

const BATCH = 1000;          // rows per DELETE
const MAX_BATCHES = 50;      // 50k rows per table per run — a month of catch-up, then it idles

/**
 * @param {object} db      the database wrapper
 * @param {object} [opts]  { dryRun } — count what would go without deleting it
 * @returns {Promise<Array<{table, days, deleted, remaining?, error?}>>}
 */
async function applyRetention(db, opts = {}) {
  const results = [];

  for (const rule of RETENTION) {
    const row = { table: rule.table, days: rule.days, deleted: 0 };
    try {
      if (opts.dryRun) {
        const c = await db.prepare(
          `SELECT COUNT(*) AS n FROM ${rule.table} WHERE ${rule.column} < NOW() - INTERVAL '${rule.days} days'`
        ).get();
        row.wouldDelete = Number(c?.n || 0);
        results.push(row);
        continue;
      }

      for (let i = 0; i < MAX_BATCHES; i++) {
        // ctid keeps this index-independent: none of these tables is guaranteed to have an
        // index on created_at, and adding five is a bigger change than this deserves.
        const res = await db.prepare(`
          DELETE FROM ${rule.table}
           WHERE ctid IN (
             SELECT ctid FROM ${rule.table}
              WHERE ${rule.column} < NOW() - INTERVAL '${rule.days} days'
              LIMIT ${BATCH}
           )
        `).run();
        const n = res?.changes || 0;
        row.deleted += n;
        if (n < BATCH) break;      // caught up
      }
      if (row.deleted >= BATCH * MAX_BATCHES) row.hitCeiling = true;
    } catch (err) {
      // A table that does not exist yet, or a column named differently, must not stop the
      // rest. Reported rather than swallowed — a rule that silently never runs is worse than
      // no rule, because it looks like it is working.
      row.error = err.message.split("\n")[0];
    }
    results.push(row);
  }

  return results;
}

module.exports = { applyRetention, RETENTION, BATCH, MAX_BATCHES };
