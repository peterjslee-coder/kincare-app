#!/usr/bin/env node
/**
 * Does this deployment's R2 actually work — both ways? (v1.106.44)
 *
 * Pete: "Pictures uploaded to visits are displaying. Shows an upload but just black box with
 * an x." v1.106.43 made a failed blob read a calm 404 with a reasoned Sentry event instead of
 * a 500 and a black screen. It did not answer the question underneath: is the read broken?
 *
 * That question was unanswerable from outside, and guessing at it is how an afternoon goes.
 * So: run this in the Railway console and it says, in words.
 *
 *   node scripts/check-r2.js
 *
 * It does three things, in order of how much they prove:
 *
 *   1. Writes a tiny object, reads it back, compares the bytes, deletes it. Proves the
 *      credentials can do both halves. A token with write and no read is the shape that
 *      produces exactly Pete's symptom: the upload succeeds, the picture never loads.
 *   2. Takes a real `r2:` marker the APP wrote and reads it. This is the operation that was
 *      failing, with a key the app chose, so it is the one that counts.
 *   3. Counts how many rows still hold base64 and how many hold markers, which is the
 *      backfill's remaining work.
 *
 * It prints no credential, no bucket name and no account id — only whether each step worked.
 */
const storage = require("../src/utils/storage");

// The same list the backfill uses, imported rather than retyped. The first draft of this file
// had its own copy with a table that does not exist and a column that was never there, and
// because a missing table was caught and skipped, it reported fewer rows and looked fine.
const { TARGETS } = require("./backfill-blobs-to-r2");
const BLOB_COLUMNS = TARGETS.filter((t) => !t.json).map((t) => [t.table, t.column]);

const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => console.log(`  ✗ ${m}`);

async function main() {
  let failed = false;

  console.log("\nR2 configuration");
  const mode = storage.storageMode();
  if (mode !== "r2") {
    bad("R2 is NOT configured here — uploads are being stored in the database.");
    console.log("    All four of R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and");
    console.log("    R2_UPLOADS_BUCKET must be set. Three of four reads as off.");
    console.log("    Any row already holding an `r2:` marker is unreadable until they are.\n");
    process.exit(1);
  }
  ok("all four variables are set");

  // ── 1. Round trip with an object we made ──
  console.log("\nWrite and read back");
  const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  let marker = null;
  try {
    marker = await storage.storeFileData("healthcheck", PNG);
    ok("wrote a test object");
  } catch (err) {
    bad(`could not WRITE: ${err.message}`);
    console.log("    The credentials cannot put objects in this bucket. Uploads are failing too.\n");
    process.exit(1);
  }

  try {
    const back = await storage.resolveFileData(marker);
    if (back === null) {
      bad("wrote it, could not READ IT BACK");
      console.log("    This is the one that matches the symptom: uploads succeed and pictures");
      console.log("    never load. Check that the R2 API token has OBJECT READ as well as");
      console.log("    write, and that R2_UPLOADS_BUCKET names the bucket it was issued for.");
      failed = true;
    } else if (back !== PNG) {
      bad("read it back, but the bytes or the content type differ from what went in");
      console.log("    A mime that does not survive the round trip is served as 404 by");
      console.log("    sendStoredFile, because it is no longer an allowed image type.");
      failed = true;
    } else {
      ok("read it back, byte for byte, with its content type intact");
    }
  } catch (err) {
    bad(`could not READ: ${err.message}`);
    failed = true;
  }

  try {
    await storage.deleteFileData(marker);
    ok("cleaned up the test object");
  } catch { console.log("    (could not delete the test object — harmless, it is one pixel)"); }

  // ── 2. A key the app itself chose ──
  console.log("\nReading a photo the app actually stored");
  const { getDb } = require("../src/models/database");
  const db = await getDb();
  let sampled = false;
  for (const [table, column] of BLOB_COLUMNS) {
    let row;
    try {
      row = await db.prepare(
        `SELECT ${column} AS v FROM ${table} WHERE ${column} LIKE 'r2:%' ORDER BY created_at DESC LIMIT 1`
      ).get();
    } catch (err) {
      // Loud, not skipped. A silently-swallowed query here is how a check reports health it
      // never measured — which is the failure this whole script exists to avoid.
      bad(`${table}.${column}: could not be queried — ${err.message}`);
      failed = true;
      continue;
    }
    if (!row || !row.v) continue;
    sampled = true;
    const data = await storage.resolveFileData(row.v);
    if (data === null) {
      bad(`${table}.${column}: the newest stored blob could NOT be read`);
      failed = true;
    } else {
      ok(`${table}.${column}: read the newest stored blob (${Math.round(data.length / 1365)} KB)`);
    }
  }
  if (!sampled) console.log("  – nothing stored in R2 yet, so there was nothing to re-read");

  // ── 3. What the backfill still has to do ──
  console.log("\nWhere the blobs are");
  for (const [table, column] of BLOB_COLUMNS) {
    try {
      const r = await db.prepare(`
        SELECT COUNT(*) FILTER (WHERE ${column} LIKE 'r2:%')::int    AS in_r2,
               COUNT(*) FILTER (WHERE ${column} LIKE 'data:%')::int  AS in_db
          FROM ${table}
      `).get();
      if (r && (r.in_r2 || r.in_db)) {
        console.log(`  ${table}.${column}: ${r.in_r2} in R2, ${r.in_db} still in the database`);
      }
    } catch (err) {
      bad(`${table}.${column}: could not be counted — ${err.message}`);
      failed = true;
    }
  }

  console.log(failed
    ? "\nR2 is configured but not working. The lines marked ✗ say which half.\n"
    : "\nR2 is working in both directions.\n");
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error("\ncheck-r2 failed to run:", err.message, "\n");
  process.exit(1);
});
