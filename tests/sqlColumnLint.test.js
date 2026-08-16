// v1.105.65 — the linter that catches columns which do not exist, and the three ways it
// nearly shipped lying.
//
// This gate exists because the Aug 11 sweep found SIX features that had never worked once in
// production, every one of them a nonexistent column swallowed by a catch that logged
// "(non-blocking)". Postgres reported each of them perfectly clearly, every single time.
// Nobody ever saw one.
//
// But a linter is only worth having if its failures are true, and this one produced false
// positives in all three of its first drafts:
//
//   1. Regex string-scanning mis-paired quotes. Given `replace("legacy-", "")` it matched
//      from one string's closing quote to the next string's opening quote, swallowing whole
//      template literals in between, then reported columns against SQL that was never there.
//   2. The schema parser split CREATE TABLE bodies on every comma and stopped at the first
//      ")". Block comments containing "(C2 rule)" and REFERENCES foo(id) truncated the column
//      list, so real columns read as missing — reimbursement_receipts.file_name and
//      family_visits.mood_rating were both reported as defects in correct queries.
//   3. It read SQL comments. The fixes in this very release carry comments naming the wrong
//      column they replaced ("was cs.care_type"), and the linter flagged its own documentation.
//
// Each of those would have been noticed and the gate switched off. So the failure modes are
// pinned here: this file is a test of the test.

const { execFileSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const REPO = path.join(__dirname, "..");
const SCRIPT = path.join(REPO, "scripts", "lint-sql-columns.js");

// The script resolves the schema and src/ from its OWN location, not from cwd — so to lint a
// modified copy of the repo you must run the copy's script, not this one with a different cwd.
// (Getting that wrong made the injection tests below pass against the clean real repo, which is
// the exact "test that cannot fail" shape this whole release is about.)
function run(scriptPath = SCRIPT) {
  try {
    return { code: 0, out: execFileSync("node", [scriptPath], { encoding: "utf8" }) };
  } catch (e) {
    return { code: e.status, out: (e.stdout || "") + (e.stderr || "") };
  }
}

describe("the gate passes on the real repo", () => {
  const result = run();

  test("it exits clean", () => {
    expect(`exit ${result.code}: ${result.out.slice(0, 400)}`).toBe(`exit 0: ${result.out.slice(0, 400)}`);
  });

  test("it actually looked at a serious number of queries", () => {
    // A linter that silently stops finding queries passes forever. This is its tripwire.
    const m = result.out.match(/✓ (\d+) queries/);
    expect(m).not.toBeNull();
    expect(Number(m[1])).toBeGreaterThan(1500);
  });

  test("and parsed a serious number of tables", () => {
    const m = result.out.match(/\((\d+) tables\)/);
    expect(m).not.toBeNull();
    expect(Number(m[1])).toBeGreaterThan(60);
  });
});

describe("it catches what it was built to catch", () => {
  // Run the linter against a throwaway copy of the repo with a known bad column injected.
  function withInjected(relFile, find, replace) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sqllint-"));
    // Only the files the linter reads: the schema, the scripts dir, and src.
    for (const dir of ["src", "scripts"]) {
      fs.cpSync(path.join(REPO, dir), path.join(tmp, dir), { recursive: true });
    }
    const target = path.join(tmp, relFile);
    const src = fs.readFileSync(target, "utf8");
    expect(src.includes(find)).toBe(true);
    fs.writeFileSync(target, src.replace(find, replace));
    try {
      return run(path.join(tmp, "scripts", "lint-sql-columns.js"));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  test("an aliased column that does not exist fails the build", () => {
    const r = withInjected(
      "src/routes/dashboard.js",
      "cr.timezone AS care_timezone",
      "cr.timezone_typo_xyz AS care_timezone"
    );
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/timezone_typo_xyz/);
    expect(r.out).toMatch(/care_recipients has no column/);
  });

  test("an UPDATE assigning a column that does not exist fails the build", () => {
    // The shape that hid visit_logs.updated_at and users.ipai_access.
    const r = withInjected(
      "src/routes/kindred.js",
      "UPDATE users SET companion_access = ?, updated_at = NOW()",
      "UPDATE users SET companion_access_typo_xyz = ?, updated_at = NOW()"
    );
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/companion_access_typo_xyz/);
  });
});

describe("the false-positive traps that nearly disabled it", () => {
  const source = fs.readFileSync(SCRIPT, "utf8");

  test("string scanning walks the source instead of regexing it", () => {
    // Trap 1. A regex cannot tell a string's closing quote from the next string's opening one.
    expect(source).toMatch(/function sqlLiterals\(source\) \{[\s\S]{0,400}while \(i < n\)/);
    expect(source).not.toMatch(/source\.matchAll\(\/`\(\[\^`/);
  });

  test("the schema parser strips block comments and matches parens", () => {
    // Trap 2. "(C2 rule)" inside a comment, and REFERENCES foo(id), both truncated the parse.
    expect(source).toMatch(/replace\(\/\\\/\\\*\[\\s\\S\]\*\?\\\*\\\/\/g/);
    expect(source).toMatch(/depth\+\+/);
    expect(source).toMatch(/if \(ch === "," && d === 0\)/);
  });

  test("it blanks SQL comments before reading column references", () => {
    // Trap 3. Every fix in this release documents the wrong column it replaced.
    expect(source).toMatch(/Blank out SQL comments/);
    expect(source).toMatch(/" "\.repeat\(m\.length\)/);
  });

  test("it skips anything it cannot resolve with certainty", () => {
    // Unknown tables, ambiguous aliases and subquery shadowing are all left alone. A gate that
    // cries wolf gets switched off, and then it protects nothing.
    expect(source).toMatch(/if \(!schema\.has\(table\)\) \{ ambiguous\.add\(alias\); continue; \}/);
    expect(source).toMatch(/hasSubquery/);
  });

  test("the baseline is empty, and says why that matters", () => {
    // Every entry here is a real bug being tolerated. Starting non-empty invites growth.
    const m = source.match(/const BASELINE = \[([\s\S]*?)\];/);
    expect(m).not.toBeNull();
    const entries = m[1].split("\n").filter(l => l.trim().startsWith('"') || l.trim().startsWith("'"));
    expect(entries).toEqual([]);
  });
});

describe("it is wired into CI, not just available", () => {
  test("package.json exposes the script", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO, "package.json"), "utf8"));
    expect(pkg.scripts["lint:sql-columns"]).toBe("node scripts/lint-sql-columns.js");
  });

  test("the workflow runs it alongside the other two gates", () => {
    const ci = fs.readFileSync(path.join(REPO, ".github", "workflows", "ci.yml"), "utf8");
    expect(ci).toMatch(/npm run lint:sql-columns/);
    expect(ci).toMatch(/npm run lint:requires/);
    expect(ci).toMatch(/npm run lint:client/);
  });
});
