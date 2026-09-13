#!/usr/bin/env node
/**
 * lint:blobs — no INSERT or UPDATE may write a blob column with a value that did not come
 * from storage.storeFileData. (v1.106.8)
 *
 * WHY THIS EXISTS
 *
 * Photos-in-Postgres has been the same bug twice. `src/utils/storage.js` was written in
 * v1.91.0 to end it, and it works — but it only helps the call sites that remember to use
 * it, and five of them never did. On Sept 2 the volume filled and the site went down. The
 * September review found the same shape still live: visit photos, note photos, family-visit
 * photos, profile photos and message photos all writing base64 straight into TEXT columns.
 *
 * A code review finds that once. A gate finds it every time someone adds the sixth.
 *
 * WHAT IT CHECKS
 *
 * For every INSERT/UPDATE in src/ that writes a column whose name matches
 *   photo | image | receipt | document | attachment | avatar | file_data
 * the value bound to it must be a name that was produced by storeFileData — established
 * either by `const x = await storage.storeFileData(...)` in the same file, or by the
 * parameter being passed through a variable this file already resolved that way.
 *
 * It is deliberately shallow: it looks for `storeFileData` in the same function body as the
 * write. Anything cleverer than that produces false positives, and a linter that cries wolf
 * gets switched off, and then it protects nothing. NULL writes and column *reads* are fine.
 */

const fs = require("fs");
const path = require("path");

const REPO = path.join(__dirname, "..");
const SRC_DIR = path.join(REPO, "src");

/**
 * Reviewed exceptions. Each needs a reason and a name. Empty is the goal.
 */
const { BASELINE } = require("./lint-blobs-baseline");

const BLOB_COL = /^(?:.*_)?(photo|photos|image|images|receipt|document|attachment|avatar|file_data|photo_url|avatar_url|profile_photo)$/i;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (entry.name.endsWith(".js")) out.push(p);
  }
  return out;
}

/** Strip line-owning comments so prose about `photo = ?` is not mistaken for code. */
function stripComments(src) {
  const out = [];
  let inBlock = false;
  for (const line of src.split("\n")) {
    const t = line.trim();
    if (inBlock) { if (t.includes("*/")) inBlock = false; out.push(""); continue; }
    if (t.startsWith("//")) { out.push(""); continue; }
    if (t.startsWith("/*")) { if (!t.includes("*/")) inBlock = true; out.push(""); continue; }
    out.push(line);
  }
  return out.join("\n");
}

/**
 * The columns an INSERT or UPDATE writes, and the 1-based index of each in the value list.
 * Returns [{ column, argIndex }]. Only handles the shapes this codebase actually uses:
 *   INSERT INTO t (a, b, c) VALUES (?, ?, ?)
 *   UPDATE t SET a = ?, b = ?
 */
function writtenColumns(sql) {
  const found = [];

  const ins = /INSERT\s+INTO\s+(\w+)\s*\(([^)]*)\)\s*VALUES\s*\(([^)]*)\)/is.exec(sql);
  if (ins) {
    const cols = ins[2].split(",").map((c) => c.trim());
    const vals = ins[3].split(",").map((v) => v.trim());
    cols.forEach((col, i) => {
      if (BLOB_COL.test(col)) found.push({ column: col, placeholder: vals[i], table: ins[1] });
    });
    return found;
  }

  const upd = /UPDATE\s+(\w+)\s+SET\s+([\s\S]*?)(?:\bWHERE\b|$)/i.exec(sql);
  if (upd) {
    for (const part of upd[2].split(",")) {
      const m = /^\s*(\w+)\s*=\s*(.+?)\s*$/s.exec(part);
      if (m && BLOB_COL.test(m[1])) found.push({ column: m[1], placeholder: m[2], table: upd[1] });
    }
  }
  return found;
}

/**
 * The scope in which "did this code route the value through storage" is answered.
 *
 * Back to the nearest handler or function opener, and forward to the end of the STATEMENT
 * containing the SQL — because the value is bound in the `.run(...)` arguments, which come
 * after the query string:
 *
 *     await db.prepare(`INSERT INTO verified_documents (... file_data ...)`)
 *       .run(docId, ..., await storage.storeFileData("identity", idPhotoBase64), ...);
 *
 * A fixed forward window got this wrong and reported two already-correct writers. Ending at
 * the statement is both wider where it needs to be and narrower than "the rest of the
 * handler", which would let an unrelated call elsewhere mask a real miss.
 */
function statementScope(src, index) {
  const before = src.slice(0, index);
  const starts = [...before.matchAll(/\n(?:async )?(?:function |router\.(?:get|post|put|patch|delete)\(|const \w+ = async|\w+\s*:\s*async)/g)];
  const start = starts.length ? starts[starts.length - 1].index : Math.max(0, index - 3000);

  // Forward to the semicolon that closes this statement, ignoring ones inside strings.
  let i = index, depth = 0, quote = null;
  for (; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === "\\") { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "`" || c === '"' || c === "'") { quote = c; continue; }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === ";" && depth <= 0) break;
  }
  return src.slice(start, Math.min(src.length, i + 1));
}

const findings = [];
for (const file of walk(SRC_DIR)) {
  const rel = path.relative(REPO, file);
  const src = stripComments(fs.readFileSync(file, "utf8"));

  // Every SQL string literal (template or quoted) that writes something.
  const sqlRe = /(`[^`]*`|"[^"]*"|'[^']*')/gs;
  let m;
  while ((m = sqlRe.exec(src)) !== null) {
    const sql = m[1].slice(1, -1);
    if (!/\b(INSERT\s+INTO|UPDATE)\b/i.test(sql)) continue;
    const writes = writtenColumns(sql);
    if (!writes.length) continue;

    const line = src.slice(0, m.index).split("\n").length;
    const block = statementScope(src, m.index);
    const routed = /storeFileData\s*\(/.test(block);

    for (const w of writes) {
      // An upload always arrives as a bound parameter: the db wrapper converts `?` to $n, so
      // a JS value can reach a column no other way. Everything else — NULL, a literal, a
      // column-to-column copy in a migration, COALESCE(avatar_url, ...) — is SQL moving data
      // that is already in the database, which is not an upload and has nothing to store.
      if ((w.placeholder || "").trim() !== "?") continue;
      if (routed) continue;
      const id = `${rel}:${line}`;
      if (BASELINE.some((b) => b.startsWith(rel + " ") || b.startsWith(id))) continue;
      findings.push(`  ${id} — ${w.table}.${w.column} written without storage.storeFileData()`);
    }
  }
}

// ─── 2. Every sendStoredFile() must be awaited ───
//
// It became async in v1.106.8 so it could resolve R2 markers for every reader at once. A
// forgotten `await` still "works" — Express sends the response either way — right up until
// the R2 fetch fails, at which point the rejection has no owner: the handler's try/catch has
// already returned, so instead of its 500 you get an unhandled rejection and a hung request.
for (const file of walk(SRC_DIR)) {
  const rel = path.relative(REPO, file);
  const src = stripComments(fs.readFileSync(file, "utf8"));
  for (const m of src.matchAll(/(\w*)\s*(sendStoredFile|sendDataUrl)\s*\(/g)) {
    // `\w*` swallows the keyword before the call, so test THAT rather than the text before it.
    if (m[1] === "await") continue;
    if (m[1] === "function" || m[1] === "async") continue;   // the definition itself
    const line = src.slice(0, m.index).split("\n").length;
    findings.push(`  ${rel}:${line} — ${m[2]}() called without await (it is async since v1.106.8)`);
  }
}

if (findings.length) {
  console.error("\n  [lint:blobs] a blob column is written without going through storage.storeFileData():\n");
  console.error([...new Set(findings)].join("\n"));
  console.error(`\n  ${new Set(findings).size} finding(s).`);
  console.error("  Route the value through storage.storeFileData(prefix, dataUri) — it is a");
  console.error("  no-op pass-through when R2 is not configured, so this is safe everywhere.");
  console.error("  If a write genuinely is not an upload, add it to BASELINE with a reason.\n");
  process.exit(1);
}

console.log(`  [lint:blobs] ✓ every blob-column write routes through storage.storeFileData (${BASELINE.length} reviewed exception(s))`);
