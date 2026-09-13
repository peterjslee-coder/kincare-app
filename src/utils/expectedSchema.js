/**
 * The schema the CODE believes exists (v1.106.4).
 *
 * Parsed out of src/models/database.js: every CREATE TABLE and every ALTER TABLE ADD COLUMN.
 * Moved here from scripts/lint-sql-columns.js so the linter and GET /api/admin/schema-drift
 * answer from the same parser rather than two that can disagree — a second implementation of
 * "what columns should exist" is exactly the kind of duplication that lets a real gap hide.
 *
 * ⚠️ This describes what the code DECLARES, which is not the same as what a given database HAS.
 * The legacy `migrations` array is the frozen baseline and only runs on a database that has
 * never seen it, so a column added there after v1.82.0 appears here and does not exist on prod.
 * That is precisely how caregiver_profiles.location_source went missing for three weeks, and
 * why the drift endpoint compares this against information_schema instead of trusting it.
 */
const fs = require("fs");
const path = require("path");

const SCHEMA_FILE = path.join(__dirname, "..", "models", "database.js");

function loadSchema() {
  // Strip /* ... */ comments FIRST. The DDL is heavily commented, and those comments
  // contain both parentheses ("(C2 rule)") and prose commas — either of which derails a
  // parser that splits on commas or counts brackets. Both `reimbursement_receipts` and
  // `family_visits` were silently parsed as having fewer columns than they do, which the
  // linter then reported as missing columns in perfectly correct queries.
  const src = fs.readFileSync(SCHEMA_FILE, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ");
  const tables = new Map();
  const add = (table, col) => {
    if (!tables.has(table)) tables.set(table, new Set());
    tables.get(table).add(col);
  };

  const COLUMN_TYPE = /^(\w+)\s+(TEXT|INTEGER|REAL|SERIAL|BIGSERIAL|TIMESTAMPTZ|TIMESTAMP|BOOLEAN|JSONB|JSON|NUMERIC|BIGINT|DATE|VARCHAR|DECIMAL|UUID)/i;

  for (const m of src.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)\s*\(/g)) {
    const table = m[1];
    if (!tables.has(table)) tables.set(table, new Set());

    // Walk from the opening paren to its true match, so REFERENCES foo(id) and
    // NUMERIC(10,2) cannot end the block early.
    let i = m.index + m[0].length - 1;
    let depth = 0;
    const start = i + 1;
    for (; i < src.length; i++) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")") { depth--; if (depth === 0) break; }
    }
    const body = src.slice(start, i);

    // Split on commas at depth 0 only — NUMERIC(10,2) is one column, not two.
    let piece = "";
    let d = 0;
    const pieces = [];
    for (const ch of body) {
      if (ch === "(") d++;
      else if (ch === ")") d--;
      if (ch === "," && d === 0) { pieces.push(piece); piece = ""; continue; }
      piece += ch;
    }
    pieces.push(piece);

    for (const p of pieces) {
      const col = p.trim().match(COLUMN_TYPE);
      if (col && !/^(PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT)$/i.test(col[1])) add(table, col[1]);
    }
  }
  for (const m of src.matchAll(/ALTER TABLE (\w+)\s+ADD COLUMN IF NOT EXISTS (\w+)/g)) add(m[1], m[2]);

  return tables;
}

module.exports = { loadSchema, SCHEMA_FILE };
