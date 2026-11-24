#!/usr/bin/env node
/**
 * Server-side require-path gate (v1.105.1).
 *
 * WHY THIS EXISTS
 * ---------------
 * v1.103.5 fixed Sentry INPLACE-3 — twelve lazy `require("../utils/push")`
 * calls whose target module never existed. Every one of them threw
 * "Cannot find module" straight into a catch block, silently dropping
 * Checkr admin alerts, iPAi safety alerts, visit-photo notifications and
 * admin support messages. Nobody noticed for weeks.
 *
 * It turned out the same class was still live in eleven MORE places, all of
 * them lazy requires inside route handlers in src/routes/admin/ that used
 * `../` where the post-v1.92.0 directory split needs `../../`. Among them:
 * admin document preview (500'd on every document — the exact screen needed
 * to approve a caregiver's ID) and admin force-reset-password.
 *
 * A top-of-file require crashes the app on boot, so it can never ship broken.
 * A require INSIDE a function body is invisible until that line runs — and if
 * it runs inside a try/catch, it stays invisible forever. Tests don't catch it
 * because the itest harness never exercises those branches.
 *
 * This script resolves EVERY relative require() in src/ statically, so a bad
 * path fails CI instead of failing silently in production a month later.
 *
 * Deliberately narrow: relative specifiers only (./ and ../). Bare package
 * specifiers are node_modules' problem and npm ci already gates those.
 *
 * Usage: node scripts/lint-requires.js   (also: npm run lint:requires)
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "src");

function jsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") out.push(...jsFiles(p));
    } else if (entry.name.endsWith(".js")) {
      out.push(p);
    }
  }
  return out;
}

// Matches require("./x"), require('../x'), with or without inner whitespace.
const REQUIRE_RE = /require\(\s*["'](\.\.?\/[^"']+)["']\s*\)/g;
// A relative specifier resolves if any of these exist (mirrors Node's algorithm
// for the shapes this codebase actually uses).
const CANDIDATES = ["", ".js", ".json", "/index.js"];

function resolves(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec);
  return CANDIDATES.some((ext) => {
    try {
      return fs.statSync(base + ext).isFile();
    } catch {
      return false;
    }
  });
}

function main() {
  if (!fs.existsSync(SRC)) {
    console.error("  [lint:requires] src/ not found — run from the repo root.");
    return 1;
  }

  const files = jsFiles(SRC);
  const broken = [];

  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    let match;
    REQUIRE_RE.lastIndex = 0;
    while ((match = REQUIRE_RE.exec(source))) {
      const spec = match[1];
      if (resolves(file, spec)) continue;
      broken.push({
        file: path.relative(ROOT, file),
        line: source.slice(0, match.index).split("\n").length,
        spec,
      });
    }
  }

  if (broken.length === 0) {
    console.log(`  [lint:requires] ✓ every relative require in ${files.length} src files resolves`);
    return 0;
  }

  console.error(`  [lint:requires] ✗ ${broken.length} require path(s) do not resolve:\n`);
  for (const b of broken) {
    console.error(`    ${b.file}:${b.line}  require("${b.spec}")`);
  }
  console.error(
    `\n  A require inside a function body does not fail at boot — it fails the first`
  );
  console.error(
    `  time that line runs, and inside a try/catch it fails silently forever.`
  );
  console.error(`  Fix the path (after the v1.92.0 admin split, src/routes/admin/ needs ../../).\n`);
  return 1;
}

process.exit(main());
