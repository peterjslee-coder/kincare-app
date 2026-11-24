// Predicates that read like filters and filter nothing. (v1.105.77)
//
// Every column name in these queries is real, so lint:sql-columns cannot see any of them —
// only the VALUES were wrong. Each one made a feature report "nothing to see" forever:
//
//   the no-show poller never fired for the sessions it exists for
//   "failed logins (24h)" was hard zero, so credential stuffing read as a clean night
//   five audit rows a security panel could never display
//   the briefing could never mention a flagged review
//   a visit being delivered right now was missing from the sessions chart

const fs = require("fs");
const path = require("path");

const REPO = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8");

// Strip JS (//) and SQL (--) comment lines before matching. Three times today an assertion
// was satisfied or broken by a COMMENT that quoted the very code it was checking — the fix
// documents the old predicate, so the old predicate is still in the file as prose.
const readCode = (p) =>
  read(p)
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith("//") && !t.startsWith("--") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");

describe("NULL NOT LIKE is NULL, not TRUE", () => {
  test("the no-show poller guards its nullable column", () => {
    // care_sessions.notifications_sent is `ADD COLUMN ... TEXT` — nullable, no default. A
    // session confirmed inside the reminder window, after its start time, or while the poller
    // was down has NULL here, and NULL NOT LIKE excluded exactly those rows.
    expect(readCode("src/routes/accountability.js")).toMatch(
      /AND \(cs\.notifications_sent IS NULL OR cs\.notifications_sent NOT LIKE '%no_show_flagged%'\)/
    );
  });

  test("every NOT LIKE on a nullable column in src/ is NULL-guarded", () => {
    // The sweep that found it. care_events.reminders_sent is NOT NULL DEFAULT '', so it does
    // not need the guard — the check is against nullable columns specifically.
    const files = [];
    (function walk(d) {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith(".js")) files.push(p);
      }
    })(path.join(REPO, "src"));

    const schema = read("src/models/database.js");
    const unguarded = [];
    for (const f of files) {
      const lines = fs.readFileSync(f, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (!/NOT LIKE/.test(line)) return;
        const col = (line.match(/([a-z_]+)\.([a-z_]+)\s+NOT LIKE/) || [])[2];
        if (!col) return;
        // NOT NULL DEFAULT columns cannot produce the bug.
        const declaredNotNull = new RegExp(`${col}\\s+TEXT NOT NULL DEFAULT`).test(schema);
        const guarded = /IS NULL/.test(lines.slice(Math.max(0, i - 2), i + 1).join(" "));
        if (!declaredNotNull && !guarded) unguarded.push(`${path.relative(REPO, f)}:${i + 1}`);
      });
    }
    expect(unguarded).toEqual([]);
  });
});

describe("one vocabulary for audit_log.severity", () => {
  const sev = read("src/utils/auditSeverity.js");

  test("the elevated set includes the legacy spellings, so history is not lost", () => {
    // Rows already in the table carry 'warn'. A security log must not lose them to a rename.
    expect(sev).toMatch(/ELEVATED = Object\.freeze\(\["warn", "warning", "error", "critical"\]\)/);
  });

  test("no filter hardcodes a severity list any more", () => {
    for (const f of ["src/routes/admin/monitoring.js", "src/routes/admin/reviews.js"]) {
      expect(readCode(f)).not.toMatch(/severity IN \('critical', 'error'\)/);
      expect(readCode(f)).not.toMatch(/severity IN \('warn', 'critical'\)/);
      expect(readCode(f)).toMatch(/severity IN \(\$\{ELEVATED_SQL\}\)/);
    }
  });

  test("the five explicit writers use the canonical constant", () => {
    // admin/access.js (impersonation start) + checkr.js x4 wrote 'warning', which no filter read.
    expect(read("src/routes/admin/access.js")).toMatch(/severity: SEVERITY\.WARNING/);
    expect((read("src/routes/checkr.js").match(/severity: SEVERITY\.WARNING/g) || []).length).toBe(4);
    expect(readCode("src/routes/checkr.js")).not.toMatch(/severity: ["']warning["']/);
  });

  test("the middleware no longer writes a severity nothing reads", () => {
    // 'error' was read by three filters and written zero times.
    expect(readCode("src/middleware/auditLog.js")).not.toMatch(/severity = statusCode >= 500 \? "error"/);
  });
});

describe("counts that could never be non-zero", () => {
  const reviews = readCode("src/routes/admin/reviews.js");

  test("failed logins counts the action that is actually written", () => {
    // The middleware writes action = 'login_attempt' and escalates severity on failure.
    // 'login_failed' is written nowhere.
    expect(reviews).not.toMatch(/action = 'login_failed'/);
    expect(reviews).toMatch(/action = 'login_attempt' AND severity IN \(\$\{ELEVATED_SQL\}\)/);
  });

  test("flagged_pending is computed, not hardcoded to 0 and then tested with > 0", () => {
    expect(reviews).not.toMatch(/0 AS flagged_pending/);
    expect(reviews).toMatch(/COUNT\(\*\) FILTER \(WHERE rating < 3 AND COALESCE\(admin_status, 'pending'\) = 'pending'\) AS flagged_pending/);
    // and the consumer that reads it still does
    expect(reviews).toMatch(/rv\.flagged_pending > 0/);
  });
});

describe("status filters match statuses that exist", () => {
  test("the sessions chart counts a visit that is happening now", () => {
    const fin = readCode("src/routes/financials.js");
    expect(fin).not.toMatch(/'checked_in', 'scheduled'/);
    expect(fin).toMatch(/WHERE cs\.status IN \('completed', 'confirmed', 'in_progress'\)/);
  });
});
