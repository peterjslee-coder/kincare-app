// ─── Reading source for structural assertions (v1.105.31) ───
//
// Several suites assert things about source text: "this call exists", and more importantly
// "this call does NOT exist". The negative form needs comments removed, because a file's own
// explanatory prose names the very identifiers the assertion forbids. That has bitten four
// times in this codebase (the Android background-location check, the cancellation capture,
// the pricing promise, and the collapse toggle).
//
// The naive fix — `src.replace(/\/\*[\s\S]*?\*\//g, "")` — is itself wrong, and wrong in the
// worst possible direction. Reimbursements.js contains:
//
//     accept="image/*,application/pdf"
//
// The `/*` inside that STRING opens a block comment as far as the regex is concerned, and the
// match then runs to the next `*/` — swallowing about nine thousand characters of real code.
// A positive assertion fails loudly when that happens, which is how it was found. A NEGATIVE
// assertion passes silently, because the code it was meant to forbid was deleted before the
// check ran. A test that cannot fail is worse than no test: it reports safety it never
// verified.
//
// So: only strip comments that OWN A LINE. Every explanatory comment in this codebase sits on
// its own line, and no string literal starts a line with `/*` or `//`. That rule cannot reach
// inside `accept="image/*"`, and it removes everything the negative assertions actually need
// removed. Narrow and boring beats clever here — this helper's failure mode is a test that
// falsely passes.

const fs = require("fs");
const path = require("path");

const REPO = path.join(__dirname, "..", "..");

/** Raw file contents. Use for "is this on the page" assertions. */
function raw(relPath) {
  return fs.readFileSync(path.join(REPO, relPath), "utf8");
}

/**
 * Contents with line-owning comments removed. Use for "must NOT appear" assertions.
 *
 * Handles: `// line`, `/* block *​/` and JSX `{/* block *​/}` — each when the line begins with
 * the opener. Multi-line blocks are removed from their opening line to their closing line.
 */
function code(relPath) {
  const lines = raw(relPath).split("\n");
  const out = [];
  let inBlock = false;
  for (const line of lines) {
    const t = line.trim();
    if (inBlock) {
      if (t.includes("*/")) inBlock = false;
      continue;
    }
    if (t.startsWith("//")) continue;
    if (t.startsWith("/*") || t.startsWith("{/*")) {
      // A single-line block comment closes on the same line; anything else opens a run.
      if (!t.includes("*/")) inBlock = true;
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

module.exports = { raw, code, REPO };

// ─── the helper's own regression test lives here, beside it ───
// If this file is ever "simplified" back to a global /* ... */ replace, this fails.
if (process.env.NODE_ENV === "test" || typeof describe === "function") {
  // no-op at import time; the assertions live in tests/sourceHelper.test.js
}
