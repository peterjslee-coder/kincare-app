#!/usr/bin/env node
/**
 * Move existing base64 blobs out of Postgres and into R2. (v1.106.8)
 *
 * From v1.106.8 every writer stores new uploads in R2 and keeps only an "r2:<key>" marker in
 * the column. This walks the rows that predate that and does the same to them.
 *
 * The three properties that make it safe to run against production:
 *
 *   1. ONE ROW AT A TIME, upload first. The object is written to R2 and only then does the
 *      column change. If the process dies between the two, the object is orphaned — which
 *      costs a fraction of a cent and nothing else. The row is untouched and will be picked
 *      up on the next run. The reverse order would lose an image.
 *   2. RESUMABLE. It selects only rows that still look like base64, so re-running continues
 *      where it stopped. Running it twice is a no-op the second time.
 *   3. READ-COMPATIBLE THROUGHOUT. Every reader goes through storage.resolveFileData, which
 *      handles both shapes, so a half-migrated table serves every row correctly. There is no
 *      moment where the app must be down.
 *
 * Usage (Railway → service → Console):
 *   node scripts/backfill-blobs-to-r2.js               # report only, changes nothing
 *   node scripts/backfill-blobs-to-r2.js --apply
 *   node scripts/backfill-blobs-to-r2.js --apply --limit 200
 *   node scripts/backfill-blobs-to-r2.js --apply --table visit_photos
 *
 * Take a backup first. `Backup InPlace DB.command`, or the nightly R2 archive.
 */
const { getDb } = require("../src/models/database");
const storage = require("../src/utils/storage");

// table, primary key, column, and the R2 prefix new uploads to that column already use.
const TARGETS = [
  { table: "visit_photos",       key: "id", column: "photo_url",  prefix: "visit-photo" },
  { table: "recipient_notes",    key: "id", column: "photo",      prefix: "note-photo" },
  { table: "family_visits",      key: "id", column: "photo",      prefix: "family-visit" },
  { table: "care_recipients",    key: "id", column: "photo",      prefix: "recipient-photo" },
  { table: "users",              key: "id", column: "profile_photo", prefix: "profile-photo" },
  { table: "messages",           key: "id", column: "metadata",   prefix: "message-photo", json: true },
  { table: "verified_documents", key: "id", column: "file_data",  prefix: "identity" },
  { table: "reimbursement_receipts", key: "id", column: "file_data", prefix: "receipt" },
];

const APPLY = process.argv.includes("--apply");
const ONLY = (() => { const i = process.argv.indexOf("--table"); return i > -1 ? process.argv[i + 1] : null; })();
const LIMIT = (() => { const i = process.argv.indexOf("--limit"); return i > -1 ? parseInt(process.argv[i + 1], 10) : 500; })();

const BYTES = (s) => Buffer.byteLength(s || "", "utf8");
const fmt = (n) => (n > 1e9 ? `${(n / 1e9).toFixed(2)} GB` : n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);

async function main() {
  if (!storage.isEnabled()) {
    console.error("  R2 is not configured (R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_UPLOADS_BUCKET).");
    console.error("  Nothing to do — new uploads are staying in Postgres too. Set them first.");
    process.exit(1);
  }
  const db = await getDb();
  console.log(`\n  ${APPLY ? "APPLYING" : "REPORT ONLY (pass --apply to write)"} · limit ${LIMIT} row(s) per table\n`);

  let grandRows = 0, grandBytes = 0;

  for (const t of TARGETS) {
    if (ONLY && t.table !== ONLY) continue;

    let rows;
    try {
      // Only rows still holding an inline data URI. `r2:` markers and NULLs are already done.
      rows = await db.prepare(
        `SELECT ${t.key} AS pk, ${t.column} AS val
           FROM ${t.table}
          WHERE ${t.column} IS NOT NULL
            AND ${t.column} LIKE '%data:%;base64,%'
          ORDER BY ${t.key}
          LIMIT ?`
      ).all(LIMIT);
    } catch (err) {
      console.log(`  ${t.table.padEnd(24)} skipped (${err.message.split("\n")[0]})`);
      continue;
    }

    if (!rows.length) { console.log(`  ${t.table.padEnd(24)} nothing to move`); continue; }

    const bytes = rows.reduce((a, r) => a + BYTES(r.val), 0);
    console.log(`  ${t.table.padEnd(24)} ${String(rows.length).padStart(5)} row(s), ${fmt(bytes)}`);
    grandRows += rows.length; grandBytes += bytes;
    if (!APPLY) continue;

    let moved = 0, failed = 0;
    for (const row of rows) {
      try {
        let next;
        if (t.json) {
          // messages.metadata is a JSON blob with a photoUrl inside it.
          const meta = JSON.parse(row.val);
          if (!meta || typeof meta.photoUrl !== "string" || !meta.photoUrl.startsWith("data:")) continue;
          meta.photoUrl = await storage.storeFileData(t.prefix, meta.photoUrl);
          next = JSON.stringify(meta);
        } else {
          next = await storage.storeFileData(t.prefix, row.val);
          if (next === row.val) continue; // not a data URI after all — leave it exactly as is
        }
        // Upload succeeded; only now does the row change. And only if it has not been
        // rewritten underneath us in the meantime.
        const res = await db.prepare(
          `UPDATE ${t.table} SET ${t.column} = ? WHERE ${t.key} = ? AND ${t.column} = ?`
        ).run(next, row.pk, row.val);
        if (res.changes === 1) moved++;
      } catch (err) {
        failed++;
        console.error(`    ! ${t.table} ${row.pk}: ${err.message.split("\n")[0]}`);
      }
    }
    console.log(`  ${"".padEnd(24)} moved ${moved}${failed ? `, ${failed} failed` : ""}`);
  }

  console.log(`\n  ${grandRows} row(s), ${fmt(grandBytes)} of base64 ${APPLY ? "processed" : "still inline"}.`);
  if (!APPLY && grandRows) console.log("  Re-run with --apply to move them. Take a backup first.\n");
  else if (grandRows >= LIMIT) console.log("  Hit the per-table limit — run again to continue.\n");
  else console.log("");
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
