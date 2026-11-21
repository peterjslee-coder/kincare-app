// v1.144.0 — Postgres has no "UPDATE … ORDER BY … LIMIT" or "DELETE … LIMIT" (that is MySQL /
// SQLite). The admin tier-3 approve shipped one: every approve/reject 500'd after the consent
// row had already changed (Kit's dad, 11/21). Target "the newest row" with a subquery instead:
//   UPDATE t SET … WHERE id = (SELECT id FROM t WHERE … ORDER BY created_at DESC LIMIT 1)
const fs = require("fs");
const path = require("path");

function jsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? jsFiles(p) : e.name.endsWith(".js") ? [p] : [];
  });
}

// Remove parenthesized groups (subqueries) repeatedly, so only the outer statement is checked.
function outer(sql) {
  let prev;
  do { prev = sql; sql = sql.replace(/\([^()]*\)/g, ""); } while (sql !== prev);
  return sql;
}

test("no UPDATE or DELETE statement carries its own ORDER BY or LIMIT", () => {
  const offenders = [];
  for (const file of jsFiles(path.join(__dirname, "..", "src"))) {
    const src = fs.readFileSync(file, "utf8");
    for (const m of src.matchAll(/(["`])\s*(UPDATE|DELETE\s+FROM)\b([\s\S]*?)\1/gi)) {
      if (/\b(ORDER\s+BY|LIMIT)\b/i.test(outer(m[3]))) {
        offenders.push(`${path.relative(process.cwd(), file)}:${src.slice(0, m.index).split("\n").length}`);
      }
    }
  }
  expect(offenders).toEqual([]);
});

test("the check catches the shape it is for", () => {
  const bad = "UPDATE attestations SET admin_status = ? WHERE care_recipient_id = ? ORDER BY created_at DESC LIMIT 1";
  const good = "UPDATE attestations SET admin_status = ? WHERE id = (SELECT id FROM attestations WHERE care_recipient_id = ? ORDER BY created_at DESC LIMIT 1)";
  expect(/\b(ORDER\s+BY|LIMIT)\b/i.test(outer(bad))).toBe(true);
  expect(/\b(ORDER\s+BY|LIMIT)\b/i.test(outer(good))).toBe(false);
});
