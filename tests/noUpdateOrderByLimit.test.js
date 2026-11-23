// v1.150.2 — Postgres has no UPDATE ... ORDER BY ... LIMIT (nor DELETE ... LIMIT).
//
// The admin consent approve used that form to touch "the newest attestation". It threw AFTER
// consent_status had been written, so every tier-3 approval half-saved, answered 500, and left
// the recipient stuck in Needs-you. Narrow the row with a subquery instead:
//     UPDATE t SET ... WHERE id = (SELECT id FROM t WHERE ... ORDER BY ... LIMIT 1)
const fs = require("fs");
const path = require("path");
const { code, REPO } = require("./helpers/source");

function jsFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...jsFiles(p));
    else if (e.name.endsWith(".js")) out.push(p);
  }
  return out;
}

test("no UPDATE or DELETE statement ends in ORDER BY ... LIMIT outside a subquery", () => {
  const offenders = [];
  const files = jsFiles(path.join(REPO, "src"));
  expect(files.length).toBeGreaterThan(50); // the scan actually looked at something
  for (const f of files) {
    const rel = path.relative(REPO, f);
    const src = code(rel);
    // One SQL statement = the text up to the next quote/backtick/semicolon. A SELECT inside it
    // means the ORDER BY belongs to a subquery, which is the correct form.
    const re = /\b(UPDATE|DELETE\s+FROM)\s[^`"';]{0,800}?\bORDER\s+BY\b[^`"';]{0,200}?\bLIMIT\b/gi;
    let m;
    while ((m = re.exec(src))) {
      if (/\bSELECT\b/i.test(m[0])) continue;
      offenders.push(`${rel}: ${m[0].replace(/\s+/g, " ").slice(0, 120)}`);
    }
  }
  expect(offenders).toEqual([]);
});

test("the scan catches the shape it exists to catch", () => {
  const re = /\b(UPDATE|DELETE\s+FROM)\s[^`"';]{0,800}?\bORDER\s+BY\b[^`"';]{0,200}?\bLIMIT\b/gi;
  const bad = "UPDATE attestations SET admin_status = ? WHERE care_recipient_id = ? ORDER BY created_at DESC LIMIT 1";
  const good = "UPDATE attestations SET admin_status = ? WHERE id = (SELECT id FROM attestations WHERE care_recipient_id = ? ORDER BY created_at DESC LIMIT 1)";
  const hit = (s) => { re.lastIndex = 0; const m = re.exec(s); return !!m && !/\bSELECT\b/i.test(m[0]); };
  expect(hit(bad)).toBe(true);
  expect(hit(good)).toBe(false);
});
