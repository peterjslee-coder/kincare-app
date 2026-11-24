#!/usr/bin/env node
/**
 * lint:bundle-fresh — the committed bundle must match the source it is built from.
 *
 * v1.106.49, and this one cost an afternoon of Pete's day.
 *
 * `public/js-compiled/` is listed in .gitignore, and the two bundles inside it are ALSO tracked
 * in git. That combination is quiet and lethal: `git add public/js-compiled/...` and `git add
 * -A` both refuse the path as ignored, so a commit takes the source change and leaves the
 * artifact behind — and nothing says so, because a tracked-and-ignored file shows as modified
 * while being skipped by the very commands used to stage it.
 *
 * Production served a bundle last committed at v1.106.38 while its own /api/health reported
 * v1.106.47. Nine versions of client work — the Step out button, the tour that would not go
 * away, the visit-log nudge, the release-with-pay card — were written, tested green, committed,
 * deployed, and never reached a single phone. Server-side fixes landed normally the whole time,
 * which is what made it so convincing: the photo fix worked, so the deploy was obviously fine.
 *
 * Pete found it by going to look for a button I had told him was there.
 *
 * Habit is not the fix. I ran `node scripts/build-client.js` before every one of those commits
 * and still shipped nine stale bundles, because building is not committing. So this rebuilds
 * and compares, byte for byte, and fails with the one command that puts it right.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");

/** What must match. */
const ARTIFACTS = ["js-compiled/bundle.js", "js-compiled/bundle-admin.js"];
/** What the build writes — index.html and sw.js carry a cache buster derived from the bundle. */
const TOUCHED = [...ARTIFACTS, "index.html", "sw.js"];

const sha = (p) => {
  try { return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex").slice(0, 16); }
  catch { return null; }
};

const before = Object.fromEntries(ARTIFACTS.map((a) => [a, sha(path.join(PUBLIC, a))]));
const missing = ARTIFACTS.filter((a) => before[a] === null);
if (missing.length) {
  console.error(`\n  [lint:bundle-fresh] ✗ missing built artifact(s): ${missing.join(", ")}`);
  console.error("    Run: npm run build\n");
  process.exit(1);
}

// build-client.js writes in place and has no output override, so: snapshot everything it
// touches, build for real, compare, put the snapshot back. A lint that leaves the working tree
// modified is annoying; one that silently "fixes" the artifact so the next run passes would
// defeat its own purpose.
const snapshot = new Map(TOUCHED.map((a) => {
  const abs = path.join(PUBLIC, a);
  return [a, fs.existsSync(abs) ? fs.readFileSync(abs) : null];
}));
const restore = () => {
  for (const [a, buf] of snapshot) if (buf !== null) fs.writeFileSync(path.join(PUBLIC, a), buf);
};

let after = null;
let buildError = null;
try {
  execFileSync(process.execPath, [path.join(__dirname, "build-client.js")], { cwd: ROOT, stdio: "pipe" });
  after = Object.fromEntries(ARTIFACTS.map((a) => [a, sha(path.join(PUBLIC, a))]));
} catch (err) {
  buildError = String(err.stdout || "") + String(err.stderr || "");
} finally {
  restore();
}

if (buildError !== null) {
  console.error("\n  [lint:bundle-fresh] ✗ the client build itself failed:\n");
  console.error(buildError);
  process.exit(1);
}

const stale = ARTIFACTS.filter((a) => before[a] !== after[a]);
if (stale.length === 0) {
  console.log(`  [lint:bundle-fresh] ✓ ${ARTIFACTS.length} committed bundle(s) match the source`);
  process.exit(0);
}

console.error(`\n  [lint:bundle-fresh] ✗ ${stale.length} bundle(s) do not match the source they are built from:\n`);
for (const a of stale) console.error(`    ${a}  committed ${before[a]} → rebuilt ${after[a]}`);
console.error(`
  The source changed and the artifact did not come with it. Production would serve the old
  client while /api/health reported the new version — silently, which is exactly how nine
  versions of client work never reached a phone (see the header of this file).

  Fix:  npm run build && git add -f ${ARTIFACTS.map((a) => "public/" + a).join(" ")} public/index.html public/sw.js

  The -f is required: public/js-compiled/ is in .gitignore AND tracked, so a plain \`git add\`
  skips it without saying anything.
`);
process.exit(1);
