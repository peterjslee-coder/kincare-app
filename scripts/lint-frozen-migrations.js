#!/usr/bin/env node
/**
 * lint:frozen-migrations — the legacy `migrations` array in src/models/database.js is frozen.
 *
 * That array is recorded as `000_legacy_baseline` in schema_migrations and runs exactly once,
 * on a database that has never seen it. Prod and staging both recorded it in July 2026. Anything
 * added to it afterwards therefore runs on a fresh developer database and on the test harness —
 * and never on the two databases that matter.
 *
 * That is not hypothetical. On 2026-08-20, v1.105.121 added `caregiver_profiles.location_source`
 * to the array. It reached every test and every new checkout, and neither prod nor staging. The
 * UPDATE that names the column threw for three weeks, and because the whole statement failed the
 * caregiver's coordinates were never written either — so "share my location" left her invisible
 * to families with an empty job list. Found 2026-09-13 by calling the endpoint, not by reading
 * the code: every test passed the whole time.
 *
 * `lint:sql-columns` cannot catch this, because it builds its picture of the schema by parsing
 * the same array — it believes every column in there exists.
 *
 * So the array is checksummed. Any edit fails this check, and the fix is always the same: put
 * the change in MIGRATIONS_V2 instead, where the runner will apply it to databases that already
 * exist.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const FILE = path.join(__dirname, "..", "src", "models", "database.js");
const src = fs.readFileSync(FILE, "utf8");
const lines = src.split("\n");

const start = lines.findIndex((l) => /^\s*const migrations = \[/.test(l));
if (start === -1) {
  console.error("[lint:frozen-migrations] ✗ could not find `const migrations = [` in database.js");
  process.exit(1);
}
let end = -1;
for (let i = start + 1; i < lines.length; i++) {
  if (/^\s*\];\s*$/.test(lines[i])) { end = i; break; }
}
if (end === -1) {
  console.error("[lint:frozen-migrations] ✗ could not find the end of the frozen array");
  process.exit(1);
}

const body = lines.slice(start, end + 1).join("\n");
const actual = crypto.createHash("sha256").update(body).digest("hex").slice(0, 16);

// Pinned 2026-09-13 at v1.106.1. Update ONLY when deliberately removing something from the
// frozen array (which no migration ever needs to do) — never to make a new column pass.
const EXPECTED = "d297b973b65f16b0";

if (actual !== EXPECTED) {
  console.error(`
[lint:frozen-migrations] ✗ the frozen legacy migrations array has been modified.

  src/models/database.js lines ${start + 1}-${end + 1}
  expected sha256:16  ${EXPECTED}
  actual   sha256:16  ${actual}

  That array is '000_legacy_baseline'. It runs ONCE, on a database that has never seen it, and
  prod and staging both recorded it in July 2026. A schema change added there reaches your tests
  and a fresh checkout, and never reaches production — silently, because the tests build their
  schema from this same array.

  Put the change in MIGRATIONS_V2 instead:

      {
        id: "0NN_short_description",
        statements: [\`ALTER TABLE t ADD COLUMN IF NOT EXISTS c TEXT\`],
      },

  See migration 030 for the one that had to clean up after this exact mistake.
`);
  process.exit(1);
}

console.log(`  [lint:frozen-migrations] ✓ legacy baseline array unchanged (${end - start} lines, sha ${actual})`);
