#!/usr/bin/env node
/**
 * lint:identity-reads — "has this person verified their identity?" gets ONE answer.
 *
 * The saga this closes, in order:
 *
 *   v1.105.64  Three doors to submit a selfie + ID, filed three ways. A caregiver could
 *              verify from My Account, be shown a blue check confirming it, and read
 *              "not submitted" in the admin panel with onboarding blocked forever.
 *              Fixed by src/utils/identity.js — a resolver every surface was meant to use.
 *   v1.105.80  Found three faults in the /api/auth/me copy of the same lookup. Fixed them
 *              in that copy. The resolver kept fault #1.
 *   v1.106.39  Tina. Approved document, app keeps asking, she submits again, the new
 *              'pending' row lands on top, and from then on the blue check says verified
 *              while the onboarding checklist says no — because the resolver took the
 *              newest and auth.js preferred the approved. Two more copies turned up while
 *              looking: selfOnboarding.js (which counted a bare selfie) and the bare
 *              `uploaded_by = <you>` in auth.js (which counted a CARE RECIPIENT's ID that
 *              the caregiver had uploaded, as the caregiver's own).
 *
 * Every one of those was the same mistake: a second query against verified_documents that
 * decides whether someone is verified. Writing one is easy and looks harmless; the damage
 * only shows up later, when the two copies disagree about a real person.
 *
 * So: no file outside src/utils/identity.js may run a SELECT over verified_documents that
 * filters on the identity category. Counting them for an admin queue is not deciding about
 * a person, and marks itself:
 *
 *     WHERE category = 'identity' AND status = 'pending'   // identity-read-ok: admin queue count
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "src");
const RESOLVER = path.join(SRC, "utils", "identity.js");
const ALLOW = /identity-read-ok:/;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && e.name.endsWith(".js")) out.push(p);
  }
  return out;
}

// Only line-owning comments are stripped. A trailing `// identity-read-ok:` marker has to
// survive, and a block-comment strip across a whole file has silently eaten real code in
// this repo before (see tests/helpers/source.js).
function strip(src) {
  return src.split("\n").map((l) => (/^\s*(\/\/|\*|\/\*)/.test(l) ? "" : l)).join("\n");
}

const findings = [];
for (const file of walk(SRC)) {
  if (path.resolve(file) === path.resolve(RESOLVER)) continue;
  const raw = fs.readFileSync(file, "utf8");
  const lines = raw.split("\n");
  const code = strip(raw).split("\n");

  // A query is usually spread over several lines, so scan a small window around each
  // mention of the identity category and ask whether it is a SELECT over the table.
  code.forEach((line, i) => {
    if (!/category\s*=\s*['"]identity['"]/.test(line)) return;
    if (ALLOW.test(lines[i])) return;
    const from = Math.max(0, i - 8);
    const to = Math.min(code.length, i + 9);
    const window = code.slice(from, to).join(" ");
    if (ALLOW.test(lines.slice(from, to).join("\n"))) return;
    if (!/\bverified_documents\b/.test(window)) return;
    if (!/\bSELECT\b/i.test(window)) return;         // INSERT/UPDATE are writes, not answers
    findings.push({
      file: path.relative(ROOT, file),
      line: i + 1,
      text: lines[i].trim().slice(0, 110),
    });
  });
}

const total = walk(SRC).length;
if (findings.length === 0) {
  console.log(`  [lint:identity-reads] ✓ ${total} server files, identity is resolved in one place`);
  process.exit(0);
}

console.error(`\n  [lint:identity-reads] ✗ ${findings.length} identity lookup(s) outside src/utils/identity.js.`);
console.error("  Four copies of this query have disagreed about a real person's government ID.");
console.error("  Use caregiverIdentityDoc / caregiverIdentityVerified / identityStatusFor, or mark an");
console.error("  admin-queue count with `// identity-read-ok: <why>`.\n");
for (const f of findings) console.error(`    ${f.file}:${f.line}  ${f.text}`);
console.error("");
process.exit(1);
