/**
 * Batch 4b — capped reads and retention (v1.106.9).
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || "batch4b-test-secret";

const fs = require("fs");
const path = require("path");
const { raw, code } = require("./helpers/source");

describe("R1 — a client-supplied limit cannot ask for the whole table", () => {
  const { clampLimit, clampOffset } = require("../src/utils/queryLimits");

  test("a sane value is honoured", () => expect(clampLimit("50", 20, 200)).toBe(50));
  test("an absurd one is capped", () => expect(clampLimit("999999999", 20, 200)).toBe(200));

  test("missing, unparseable, zero and negative all fall back to the DEFAULT, not to zero", () => {
    // A limit that silently becomes 0 turns a working list into an empty one, which reads to
    // the user as data loss — a worse outcome than the unbounded read this is preventing.
    for (const v of [undefined, null, "", "abc", "0", "-5", "NaN", {}, []]) {
      expect(clampLimit(v, 20, 200)).toBe(20);
    }
  });

  test("offsets are bounded too, so deep paging cannot scan forever", () => {
    expect(clampOffset("40")).toBe(40);
    expect(clampOffset("99999999")).toBe(10000);
    expect(clampOffset(undefined)).toBe(0);
  });

  test("no route still passes a raw parseInt of a query limit into SQL", () => {
    const dir = path.join(__dirname, "..", "src", "routes");
    const offenders = [];
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".js")) continue;
      const src = code(`src/routes/${f}`);
      // `parseInt(limit)` / `parseInt(req.query.limit)` bound straight into a query. A
      // Math.min(...) wrapper is its own clamp and is fine.
      for (const line of src.split("\n")) {
        if (/parseInt\((?:req\.query\.)?(?:limit|offset)\b/.test(line) && !/Math\.min/.test(line)) {
          offenders.push(`${f}: ${line.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("R2 — a thread is a page, not a transcript", () => {
  const m = code("src/routes/messages.js");

  test("the thread query is limited", () => {
    expect(m).toMatch(/const pageSize = clampLimit\(req\.query\.limit, 60, 200\)/);
    // v1.106.10 — the id tie-break joined it; see C5b in batch5Correctness for why.
    expect(m).toMatch(/ORDER BY m\.created_at DESC, m\.id DESC\s*\n\s*LIMIT \?/);
  });

  test("it takes the NEWEST page, then hands it back oldest-first", () => {
    // DESC + LIMIT is what makes the page the recent one; ASC + LIMIT would return the oldest
    // messages in the conversation, which is the opposite of what opening a thread means.
    const q = m.slice(m.indexOf("FROM messages m"), m.indexOf("messages.reverse()"));
    expect(q).toMatch(/ORDER BY m\.created_at DESC/);
    expect(m).toMatch(/messages\.reverse\(\);/);
  });

  test("a cursor walks backwards, and no cursor means the latest page", () => {
    expect(m).toMatch(/const before = typeof req\.query\.before === "string" && req\.query\.before \? req\.query\.before : null/);
    expect(m).toMatch(/\(\?::timestamptz IS NULL OR \(m\.created_at, m\.id\) < \(\?::timestamptz, \?\)\)/);
  });

  test("the response says whether anything is above the page", () => {
    expect(m).toMatch(/hasMore,/);
    expect(m).toMatch(/oldestOnPage,/);
  });

  test("the joined-at boundary still works and does not fight the pager", () => {
    // historyFrom is a privacy boundary (v1.105.92) — pagination must sit INSIDE it, never
    // page past the day someone joined the conversation.
    const q = m.slice(m.indexOf("FROM messages m"), m.indexOf("messages.reverse()"));
    expect(q).toMatch(/m\.created_at >= \?/);
  });

  test("the client can reach the older pages — pagination without that is data loss", () => {
    const c = code("public/js/components/Messages.js");
    expect(c).toMatch(/const loadEarlier = async \(\) => \{/);
    expect(c).toMatch(/before=\$\{encodeURIComponent\(oldestOnPage\)\}/);
    expect(c).toMatch(/Load earlier messages/);
  });

  test("loading earlier does not yank the reader somewhere else", () => {
    const c = code("public/js/components/Messages.js");
    const fn = c.slice(c.indexOf("const loadEarlier"), c.indexOf("const fetchMessages"));
    expect(fn).toMatch(/scrollHeight/);
    expect(fn).toMatch(/box\.scrollTop \+= box\.scrollHeight - heightBefore/);
  });

  test("and it cannot duplicate a message already on screen", () => {
    const c = code("public/js/components/Messages.js");
    const fn = c.slice(c.indexOf("const loadEarlier"), c.indexOf("const fetchMessages"));
    expect(fn).toMatch(/const seen = new Set\(prev\.map\(\(m\) => m\.id\)\)/);
    expect(fn).toMatch(/older\.filter\(\(m\) => !seen\.has\(m\.id\)\)/);
  });
});

describe("R3 — retention deletes what nobody reads, and nothing else", () => {
  const { RETENTION } = require("../src/utils/retention");
  const byTable = Object.fromEntries(RETENTION.map((r) => [r.table, r.days]));

  test("the windows are the ones Pete chose", () => {
    expect(byTable).toEqual({
      audit_log: 180,
      admin_audit_log: 365,
      notifications: 60,
      activity_feed: 60,
      onboarding_events: 30,
    });
  });

  test("the CARE RECORD is not in it — that is not a disk-space decision", () => {
    const tables = RETENTION.map((r) => r.table);
    for (const sacred of ["messages", "care_sessions", "visit_logs", "recipient_notes",
                          "visit_photos", "family_visits", "reviews", "payments", "users"]) {
      expect(tables).not.toContain(sacred);
    }
  });

  test("it deletes in bounded batches rather than one long-locking statement", () => {
    const r = code("src/utils/retention.js");
    expect(r).toMatch(/const BATCH = \d+/);
    expect(r).toMatch(/const MAX_BATCHES = \d+/);
    expect(r).toMatch(/LIMIT \$\{BATCH\}/);
    expect(r).toMatch(/if \(n < BATCH\) break;/);
  });

  test("a broken rule is reported, not swallowed — a rule that never runs looks like one that does", () => {
    const r = code("src/utils/retention.js");
    expect(r).toMatch(/row\.error = err\.message/);
    const s = code("src/server.js");
    expect(s).toMatch(/captureException\(new Error\(`retention \$\{r\.table\}/);
  });

  test("dry run counts without deleting", async () => {
    const { applyRetention } = require("../src/utils/retention");
    const calls = [];
    const db = { prepare: (sql) => ({
      get: async () => { calls.push(sql); return { n: 7 }; },
      run: async () => { calls.push(sql); return { changes: 0 }; },
    }) };
    const res = await applyRetention(db, { dryRun: true });
    expect(res.every((r) => r.wouldDelete === 7)).toBe(true);
    expect(calls.every((s) => /SELECT COUNT/.test(s))).toBe(true);
    expect(calls.some((s) => /DELETE/.test(s))).toBe(false);
  });

  test("it stops when a batch comes back short, instead of looping the ceiling every night", async () => {
    const { applyRetention, BATCH } = require("../src/utils/retention");
    let runs = 0;
    const db = { prepare: () => ({ run: async () => { runs++; return { changes: runs === 1 ? BATCH : 3 }; } }) };
    const res = await applyRetention(db);
    expect(res[0].deleted).toBe(BATCH + 3);
    expect(res[0].hitCeiling).toBeUndefined();
  });

  test("it runs as a locked poller, so two instances cannot both delete", () => {
    const s = code("src/server.js");
    expect(s).toMatch(/guardedPoller\(110, async \(\) => \{/);
    expect(s).toMatch(/setInterval\(runRetention, 24 \* 60 \* 60 \* 1000\)/);
  });

  test("and the architecture map can see it — a job the map misses is a job nobody knows about", () => {
    const arch = raw("docs/ARCHITECTURE.md");
    expect(arch).toMatch(/\| 110 \|.*Retention/);
  });
});

describe("R4 — boot snapshots stop copying blobs", () => {
  const db = raw("src/models/database.js");
  const block = db.slice(db.indexOf("const SNAPSHOT_TABLES = {"), db.indexOf("\n};", db.indexOf("const SNAPSHOT_TABLES = {")));

  test("messages excludes metadata — the Sept 2 root cause, copied five times", () => {
    expect(block).toMatch(/messages: \{ exclude: \["metadata"\] \}/);
  });

  test("both user photo columns are excluded", () => {
    expect(block).toMatch(/users: \{ exclude: \["profile_photo", "avatar_url"\] \}/);
  });

  test("and the care recipient photo", () => {
    expect(block).toMatch(/care_recipients: \{ exclude: \["photo"\] \}/);
  });
});
