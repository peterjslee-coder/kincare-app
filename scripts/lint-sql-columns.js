#!/usr/bin/env node
/**
 * lint:sql-columns — every `alias.column` in a query must exist on that alias's table.
 * (v1.105.65)
 *
 * WHY THIS EXISTS
 *
 * The Aug 11 silent-failure sweep found SIX features that had never worked once, in
 * production, for months — every one of them a column name that does not exist:
 *
 *   cr.mobility          iPAi caregiver coaching never generated for any visit
 *   cs.care_type         Kindred never knew about a single scheduled visit
 *   users.ipai_access    the admin iPAi toggle 500'd every time
 *   visit_logs.updated_at  admin restore-session and force-check-in 500'd
 *   cr.family_id + 4 more  natural-language scheduling 500'd on every request
 *   reviews.reviewer_id  a query that threw on every call, silently
 *
 * Postgres raises a perfectly clear error for each. Nobody ever saw one, because every
 * call site sat inside a catch that logged "(non-blocking)" and returned []. A feature
 * that throws on every invocation and a feature nobody enabled look identical from the
 * outside, and that is the whole thesis of the v1.105.4x-6x work.
 *
 * A test cannot catch these: the unit suites use a fake db, and a fake db will happily
 * return rows for a column that does not exist. The integration suite only covers the
 * queries someone wrote a test for. This gate reads the schema and checks every query in
 * the repo, which is the only approach that scales past the ones we already know about.
 *
 * WHAT IT CHECKS
 *
 * Only the unambiguous case: an alias bound directly to a real table (`FROM users u`,
 * `JOIN care_sessions cs ON ...`), and a `u.column` reference against that table's real
 * columns. Anything it cannot resolve with certainty — subquery aliases, CTEs, tables it
 * has no schema for, dynamically built SQL — it skips. A linter that cries wolf gets
 * disabled, and then it protects nothing.
 */

const fs = require("fs");
const path = require("path");

const REPO = path.join(__dirname, "..");
const SCHEMA_FILE = path.join(REPO, "src", "models", "database.js");
const SRC_DIR = path.join(REPO, "src");

/**
 * Known exceptions. Each needs a reason. Empty is the goal — if you are adding to this,
 * you are almost certainly looking at a real bug of the kind described above.
 */
const BASELINE = [
  // e.g. "src/routes/foo.js: bar.baz — reason"
];

// ─── 1. The schema, as the database actually defines it ───

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

// ─── 2. Alias → table bindings, and the references to check ───

// `FROM users u`, `JOIN care_sessions cs ON`, `FROM visit_logs AS vl`
const BIND_RE = /\b(?:FROM|JOIN)\s+(\w+)\s+(?:AS\s+)?(\w+)\b/gi;
const REF_RE = /\b([a-z_][a-z0-9_]{0,20})\.([a-z_][a-z0-9_]*)\b/gi;

// Words that look like an alias binding but are not, and reference prefixes that are JS.
const NOT_A_TABLE = new Set(["select", "lateral", "unnest", "generate_series", "values", "only"]);
const SQL_KEYWORD_AFTER_ALIAS = new Set([
  "on", "where", "set", "using", "left", "right", "inner", "outer", "full", "cross",
  "join", "group", "order", "limit", "having", "union", "and", "or", "as", "for",
]);

/**
 * Pull out string/template literals long enough to plausibly be SQL, with their offsets.
 *
 * This walks the source rather than running a regex over it, and the difference is not
 * academic. The regex version of this function mis-paired quotes: given
 * `convId.replace("legacy-", "")` it matched from one string's closing quote to the next
 * string's opening quote, swallowing the real code in between — including whole template
 * literals — and then reported column errors against SQL that was never in that literal.
 * It produced five confident false positives on the first run.
 *
 * A linter whose failures are wrong is worse than no linter, because the first thing
 * anyone does with a noisy gate is switch it off.
 */
function sqlLiterals(source) {
  const out = [];
  const n = source.length;
  let i = 0;
  while (i < n) {
    const c = source[i];

    // Comments — skip, so a quote or backtick inside prose can't open a phantom string.
    if (c === "/" && source[i + 1] === "/") {
      const nl = source.indexOf("\n", i);
      i = nl === -1 ? n : nl + 1;
      continue;
    }
    if (c === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }

    if (c === "'" || c === '"' || c === "`") {
      const quote = c;
      const start = i;
      i++;
      let depth = 0; // ${ ... } nesting inside a template literal
      while (i < n) {
        const ch = source[i];
        if (ch === "\\") { i += 2; continue; }
        if (quote === "`" && ch === "$" && source[i + 1] === "{") { depth++; i += 2; continue; }
        if (quote === "`" && depth > 0 && ch === "}") { depth--; i++; continue; }
        if (depth === 0 && ch === quote) { i++; break; }
        // An unescaped newline ends a single/double quoted string in practice; bail rather
        // than run away through the rest of the file.
        if (quote !== "`" && ch === "\n") break;
        i++;
      }
      const text = source.slice(start, i);
      if (text.length >= 25 && /\b(SELECT|UPDATE|INSERT INTO|DELETE FROM)\b/i.test(text)) {
        out.push({ text, index: start });
      }
      continue;
    }

    i++;
  }
  return out;
}

function lineOf(source, index) {
  return source.slice(0, index).split("\n").length;
}

// ─── 3. Walk and check ───

function jsFiles(dir, acc = []) {
  for (const entry of fs.readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (fs.statSync(p).isDirectory()) jsFiles(p, acc);
    else if (entry.endsWith(".js")) acc.push(p);
  }
  return acc;
}

function main() {
  const schema = loadSchema();
  if (schema.size < 20) {
    console.error(`  [lint:sql-columns] ✗ only parsed ${schema.size} tables from database.js — the parser is broken, not the code`);
    process.exit(1);
  }

  const findings = [];
  let queriesChecked = 0;

  for (const file of jsFiles(SRC_DIR)) {
    const rel = path.relative(REPO, file);
    const source = fs.readFileSync(file, "utf8");

    for (const { text: rawText, index } of sqlLiterals(source)) {
      queriesChecked++;

      // Blank out SQL comments, preserving offsets so line numbers stay honest. Queries in
      // this repo carry explanatory comments that NAME the wrong column they replaced —
      // "was cs.care_type; the column is service_type" — and without this the linter reports
      // its own documentation as a defect. It did exactly that on the first run.
      const text = rawText
        .replace(/\/\*[\s\S]*?\*\//g, (m) => " ".repeat(m.length))
        .replace(/--[^\n]*/g, (m) => " ".repeat(m.length));

      // ── UPDATE <table> SET col = ..., col2 = ... ──
      //
      // These carry no alias, so the aliased pass below cannot see them — and two of the six
      // never-worked features found in the Aug 11 sweep were exactly this shape:
      // `UPDATE visit_logs SET ... updated_at = NOW()` on a table with no updated_at, and
      // `UPDATE users SET ipai_access = ?` where the column is companion_access. Both 500'd
      // every time they ran.
      for (const upd of text.matchAll(/\bUPDATE\s+(\w+)\s+SET\b/gi)) {
        const table = upd[1].toLowerCase();
        if (!schema.has(table)) continue;
        const cols = schema.get(table);
        const after = text.slice(upd.index + upd[0].length);
        // The SET clause runs to WHERE / RETURNING / end of statement.
        const stop = after.search(/\b(WHERE|RETURNING|FROM)\b/i);
        const setClause = stop === -1 ? after : after.slice(0, stop);
        // Assignments at paren depth 0 only, so COALESCE(a, b) is not read as two columns.
        let depth = 0, piece = "", pieces = [];
        for (const ch of setClause) {
          if (ch === "(") depth++;
          else if (ch === ")") depth--;
          if (ch === "," && depth === 0) { pieces.push(piece); piece = ""; continue; }
          piece += ch;
        }
        pieces.push(piece);
        for (const p of pieces) {
          const assign = p.trim().match(/^(\w+)\s*=/);
          if (!assign) continue;
          const column = assign[1];
          if (cols.has(column)) continue;
          const key = `${rel}: ${table}.${column}`;
          if (BASELINE.some(b => b.startsWith(key))) continue;
          findings.push({ file: rel, line: lineOf(source, index + upd.index), alias: table, table, column });
        }
      }

      // Bind aliases, but only to tables we actually have a schema for.
      const aliases = new Map();
      const ambiguous = new Set();
      for (const b of text.matchAll(BIND_RE)) {
        const table = b[1].toLowerCase();
        const alias = b[2].toLowerCase();
        if (NOT_A_TABLE.has(table)) continue;
        if (SQL_KEYWORD_AFTER_ALIAS.has(alias)) continue; // `FROM users WHERE` — no alias
        if (!schema.has(table)) { ambiguous.add(alias); continue; }
        if (aliases.has(alias) && aliases.get(alias) !== table) ambiguous.add(alias);
        aliases.set(alias, table);
      }
      if (aliases.size === 0) continue;

      // A CTE or subquery alias can shadow a table; if the query has either, only trust
      // aliases that appear exactly once as a binding.
      const hasSubquery = /\(\s*SELECT\b/i.test(text) || /\bWITH\s+\w+\s+AS\s*\(/i.test(text);

      for (const r of text.matchAll(REF_RE)) {
        const alias = r[1].toLowerCase();
        const column = r[2];
        if (!aliases.has(alias) || ambiguous.has(alias)) continue;
        const table = aliases.get(alias);
        const cols = schema.get(table);
        if (cols.has(column)) continue;
        // Postgres built-ins and casts that look like columns.
        if (/^(id|\*)$/.test(column)) continue;
        if (hasSubquery) {
          // Be extra conservative inside subqueries: only report when the alias binds once.
          const bindCount = [...text.matchAll(BIND_RE)].filter(b => b[2].toLowerCase() === alias).length;
          if (bindCount !== 1) continue;
        }
        const key = `${rel}: ${alias}.${column}`;
        if (BASELINE.some(b => b.startsWith(key))) continue;
        // Point at the reference itself, not the top of the query it sits in.
        findings.push({ file: rel, line: lineOf(source, index + r.index), alias, table, column });
      }
    }
  }

  // De-duplicate: the same bad column in the same query reads once.
  const seen = new Set();
  const unique = findings.filter(f => {
    const k = `${f.file}:${f.line}:${f.alias}.${f.column}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  if (unique.length > 0) {
    console.error(`\n  [lint:sql-columns] ✗ ${unique.length} reference(s) to columns that do not exist:\n`);
    for (const f of unique) {
      console.error(`    ${f.file}:${f.line}  ${f.alias}.${f.column}  —  ${f.table} has no column "${f.column}"`);
    }
    console.error(`\n  Postgres raises an error for each of these. If you have never seen it, the`);
    console.error(`  call site is swallowing it — which means the feature has never worked.\n`);
    process.exit(1);
  }

  console.log(`  [lint:sql-columns] ✓ ${queriesChecked} queries, every aliased column resolves against the schema (${schema.size} tables)`);
}

main();
