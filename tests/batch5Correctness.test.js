/**
 * Batch 5 — correctness and efficiency debt (v1.106.10).
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || "batch5-test-secret";

const fs = require("fs");
const path = require("path");
const { raw, code } = require("./helpers/source");

describe("C1 — the money paths write a whole ledger or none of it", () => {
  const pay = code("src/routes/payments.js");
  const sess = code("src/routes/sessions.js");

  test("auto-pay records the payment, the tip and the session status as ONE transaction", () => {
    // Anchor on CODE, never on a comment: helpers/source.code() strips line-owning comments,
    // so an anchor containing one silently matches nothing and the test passes vacuously.
    // `const paymentId = uuid()` appears in the checkout route too — anchor on something only
    // the auto-pay path has.
    const key = pay.indexOf("idempotencyKey: `inplace_autopay_");
    expect(key).toBeGreaterThan(-1);
    const start = pay.indexOf("const paymentId = uuid();", key);
    expect(start).toBeGreaterThan(-1);
    const block = pay.slice(start, start + 2600);
    expect(block).toMatch(/await db\.transaction\(async \(tx\) => \{/);
    expect(block).toMatch(/INSERT INTO payments/);
    expect(block).toMatch(/INSERT INTO tips/);
    expect(block).toMatch(/UPDATE care_sessions SET payment_status = 'paid'/);
    // all three inside the transaction, i.e. before its closing brace
    const close = block.indexOf("\n        });");
    expect(close).toBeGreaterThan(-1);
    for (const w of ["INSERT INTO payments", "INSERT INTO tips", "SET payment_status = 'paid'"]) {
      expect(block.indexOf(w)).toBeLessThan(close);
    }
  });

  test("the tip is inside it — a tip charged and not recorded is money the caregiver never sees", () => {
    const block = pay.slice(pay.indexOf("await db.transaction"), pay.indexOf("await db.transaction") + 2600);
    expect(block).toMatch(/if \(tipCents > 0\) \{[\s\S]{0,400}INSERT INTO tips/);
    // and it is no longer its own swallowing try/catch
    expect(block).not.toMatch(/catch \(tipErr\)/);
  });

  test("the Stripe call stays OUTSIDE the transaction", () => {
    // Holding a DB transaction open across a third-party network call is the shape that
    // exhausted the pool in v1.105.50, and a charge cannot be rolled back by us anyway.
    const intentAt = pay.indexOf("idempotencyKey: `inplace_autopay_");
    const txAt = pay.indexOf("await db.transaction");
    expect(intentAt).toBeGreaterThan(-1);
    expect(txAt).toBeGreaterThan(-1);
    expect(intentAt).toBeLessThan(txAt);
  });

  test("checkout closes the session and its visit log together", () => {
    const start = sess.indexOf("const coGeo = geofenceEvidence(checkOutLatitude");
    expect(start).toBeGreaterThan(-1);
    const tx = sess.slice(start, start + 3000);
    expect(tx).toMatch(/await db\.transaction\(async \(tx\) => \{/);
    expect(tx).toMatch(/UPDATE care_sessions SET[\s\S]{0,400}status = 'completed'/);
    expect(tx).toMatch(/UPDATE visit_logs SET[\s\S]{0,120}check_out_time = NOW\(\)/);
  });

  test("and does it BEFORE the capture, so a Stripe failure cannot leave the log unclosed", () => {
    // v1.106.47 — the capture moved into utils/sessionCapture (one implementation, now that a
    // release can also end a visit), so the landmark is the call rather than the require. The
    // ordering property is unchanged and is the whole point: the session and its visit log
    // commit together, and only then does anything touch Stripe — a capture cannot be rolled
    // back by us, and a half-state where the money is owed against an unrecorded check-out is
    // the bad one.
    const txAt = sess.indexOf("const coGeo = geofenceEvidence(checkOutLatitude");
    const captureAt = sess.indexOf('captureForSession(db, req.params.id, adjustedCost * 100');
    expect(txAt).toBeGreaterThan(-1);
    expect(captureAt).toBeGreaterThan(-1);
    expect(txAt).toBeLessThan(captureAt);
  });

  test("the release ends the visit before it charges, for the same reason", () => {
    const relTx = sess.indexOf('"UPDATE visit_breaks SET ended_at = NOW(), ended_by = \'released\'');
    const relCapture = sess.indexOf("captureForSession(db, req.params.id, fullCost * 100");
    expect(relTx).toBeGreaterThan(-1);
    expect(relCapture).toBeGreaterThan(-1);
    expect(relTx).toBeLessThan(relCapture);
  });

  test("the second visit_logs UPDATE is gone — it must not run twice", () => {
    expect((sess.match(/UPDATE visit_logs SET\s*\n\s*check_out_time = NOW\(\)/g) || []).length).toBe(1);
  });
});

describe("C2 — one AI client, with a deadline", () => {
  test("the factory sets a timeout and one retry", () => {
    const f = code("src/utils/aiModels.js");
    expect(f).toMatch(/const AI_TIMEOUT_MS = 30000/);
    expect(f).toMatch(/const AI_MAX_RETRIES = 1/);
    expect(f).toMatch(/new Anthropic\(\{ apiKey, timeout: AI_TIMEOUT_MS, maxRetries: AI_MAX_RETRIES \}\)/);
  });

  test("it returns null without a key, so callers keep their existing 'AI unavailable' branch", () => {
    const { getAnthropic } = require("../src/utils/aiModels");
    expect(getAnthropic(undefined)).toBeNull();
    expect(getAnthropic("")).toBeNull();
  });

  test("nothing else in src/ constructs a client", () => {
    const offenders = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { walk(p); continue; }
        if (!e.name.endsWith(".js") || e.name === "aiModels.js") continue;
        const rel = path.relative(path.join(__dirname, ".."), p);
        if (/new Anthropic\(/.test(code(rel))) offenders.push(rel);
      }
    };
    walk(path.join(__dirname, "..", "src"));
    expect(offenders).toEqual([]);
  });

  test("all twelve call sites go through it", () => {
    let n = 0;
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { walk(p); continue; }
        if (!e.name.endsWith(".js") || e.name === "aiModels.js") continue;
        const rel = path.relative(path.join(__dirname, ".."), p);
        n += (code(rel).match(/getAnthropic\(/g) || []).length;
      }
    };
    walk(path.join(__dirname, "..", "src"));
    expect(n).toBeGreaterThanOrEqual(12);
  });
});

describe("C3 — a poller failure is news", () => {
  const s = code("src/server.js");

  test("no poller filters out 'relation' or 'column' any more", () => {
    // Those ARE the errors that mean a query names something that does not exist — the exact
    // evidence the Aug 11 sweep needed and could not find, because it was being discarded.
    expect(s).not.toMatch(/includes\("relation"\)/);
    expect(s).not.toMatch(/includes\("column"\)/);
  });

  test("everything reaches Sentry, and a schema error is tagged", () => {
    expect(s).toMatch(/function reportPollerFailure\(name, err\)/);
    expect(s).toMatch(/const schemaBug = \/relation\|column\/i\.test\(msg\)/);
    expect(s).toMatch(/captureException\([\s\S]{0,120}schemaBug,/);
  });

  test("all six pollers use it", () => {
    expect((s.match(/reportPollerFailure\(/g) || []).length).toBeGreaterThanOrEqual(7); // 1 def + 6 uses
  });
});

describe("C4 — the dashboard GET stopped writing", () => {
  test("the two offer-expiry UPDATEs are out of the request path", () => {
    const d = code("src/routes/dashboard.js");
    expect(d).not.toMatch(/Private request expired - scheduled date passed/);
    expect(d).not.toMatch(/SET offered_to_caregiver_id = NULL, exclusive_until = NULL/);
  });

  test("and into poller 102, where a failure is reported", () => {
    // v1.106.25 — the two statements moved into utils/exclusiveOffers so a real database
    // could be pointed at them; a recurring series has to expire as a unit and that had no
    // test. What C4 is about is unchanged and still asserted: this work runs in the poller,
    // not in a GET, and a failure is reported rather than swallowed.
    const s = code("src/server.js");
    const p102 = s.slice(s.indexOf("guardedPoller(102"), s.indexOf("Per-session timezone-aware"));
    expect(p102).toMatch(/await cancelPassedPrivateOffers\(pollDb\)/);
    expect(p102).toMatch(/await releaseExpiredExclusiveOffers\(pollDb\)/);
    expect(p102).toMatch(/captureException\(e, \{ where: "poller 102: offer expiry" \}\)/);

    // And the SQL still exists somewhere — an extraction that dropped a statement would
    // otherwise read as a pass here.
    const u = code("src/utils/exclusiveOffers.js");
    expect(u).toMatch(/Private request expired - scheduled date passed/);
    expect(u).toMatch(/SET offered_to_caregiver_id = NULL, exclusive_until = NULL/);
  });

  test("expireStaleProposals stays — it is about what this response is about to show", () => {
    expect(code("src/routes/dashboard.js")).toMatch(/expireStaleProposals\(db, null, null\)/);
  });
});

describe("C5 — the conversation list is one round trip, not 1 + 3×C", () => {
  const m = code("src/routes/messages.js");
  const block = m.slice(m.indexOf("const convIds = convRows.map"), m.indexOf("let conversations = []"));

  test("last message, unread and members are each ONE query for the whole list", () => {
    expect(block).toMatch(/CROSS JOIN LATERAL/);
    expect(block).toMatch(/GROUP BY v\.cid/);
    expect(block).toMatch(/WHERE cm\.conversation_id IN \(\$\{ph\}\)/);
  });

  test("nothing queries inside the render loop any more", () => {
    const start = m.indexOf("for (const conv of convRows) {");
    const loop = m.slice(start, m.indexOf("\n  }\n", start));
    expect(loop.length).toBeGreaterThan(200);
    expect(loop).not.toMatch(/await db\.prepare/);
  });

  test("the joined-at privacy cut survives — a preview is a message body on a list screen", () => {
    expect(block).toMatch(/m\.created_at >= v\.history_from/);
    // twice: once for the preview, once for the unread count
    expect((block.match(/history_from/g) || []).length).toBeGreaterThanOrEqual(5);
  });

  test("and so does every unread filter it had before", () => {
    expect(block).toMatch(/m\.sender_id != \?/);
    expect(block).toMatch(/m\.created_at > COALESCE\(v\.last_read_at/);
    expect(block).toMatch(/kindred@yourinplace\.com/);
  });
});

describe("C5b — two messages in the same instant cannot be lost or mis-previewed", () => {
  const m = code("src/routes/messages.js");

  test("the list preview breaks ties on id, so it agrees with the thread", () => {
    // Found on staging: an iPAi question and its reply were inserted at the same microsecond,
    // and the list previewed the QUESTION while the thread ended with the ANSWER.
    const block = m.slice(m.indexOf("const convIds = convRows.map"), m.indexOf("let conversations = []"));
    expect(block).toMatch(/ORDER BY m\.created_at DESC, m\.id DESC\s*\n\s*LIMIT 1/);
  });

  test("the thread page is ordered deterministically too", () => {
    expect(m).toMatch(/ORDER BY m\.created_at DESC, m\.id DESC\s*\n\s*LIMIT \?/);
  });

  test("the cursor is (created_at, id) — a bare timestamp SKIPS a tied message forever", () => {
    // Not on the first page (cut by LIMIT), not on the next (excluded by <). A dropped
    // message in a care conversation, appearing only at random, only when two land together.
    expect(m).toMatch(/\(m\.created_at, m\.id\) < \(\?::timestamptz, \?\)/);
    expect(m).not.toMatch(/m\.created_at < \?::timestamptz/);
  });

  test("the server hands back both halves of the cursor", () => {
    expect(m).toMatch(/const oldestOnPageId = messages\.length \? messages\[0\]\.id : null/);
    expect(m).toMatch(/oldestOnPageId,/);
  });

  test("and the client sends both back", () => {
    const c = code("public/js/components/Messages.js");
    expect(c).toMatch(/beforeId=\$\{encodeURIComponent\(oldestOnPageId\)\}/);
    expect(c).toMatch(/setOldestOnPageId\(data\.oldestOnPageId \|\| null\)/);
  });

  test("an older client that sends only `before` still works", () => {
    // '' sorts below every uuid, so the tuple comparison degrades to "strictly older".
    expect(m).toMatch(/beforeId \|\| ''/);
  });
});

describe("C6 — indexes, and the backfill that stopped running on every boot", () => {
  const db = raw("src/models/database.js");

  test("the five joins the app makes constantly have indexes", () => {
    const mig = db.slice(db.indexOf('id: "035_missing_indexes"'), db.indexOf('id: "034_one_user_photo_column"'));
    for (const idx of ["visit_photos(visit_log_id)", "conversation_members(user_id)",
                       "conversation_members(conversation_id)", "care_team_members(user_id)"]) {
      expect(mig).toContain(idx);
    }
    expect(mig).toMatch(/care_sessions\(offered_to_caregiver_id\) WHERE offered_to_caregiver_id IS NOT NULL/);
  });

  test("and so do the three tables the nightly retention sweep scans", () => {
    const mig = db.slice(db.indexOf('id: "035_missing_indexes"'), db.indexOf('id: "034_one_user_photo_column"'));
    for (const t of ["audit_log(created_at)", "activity_feed(created_at)", "notifications(created_at)"]) {
      expect(mig).toContain(t);
    }
  });

  test("the geocode backfill is a locked, capped poller instead of two boot loops", () => {
    const s = code("src/server.js");
    expect(s).toMatch(/guardedPoller\(111, async \(\) => \{/);
    expect(s).toMatch(/LIMIT \$\{GEOCODE_BATCH\}/);
    expect(s).not.toMatch(/Geocode backfill: \$\{missing\.length\}/);
  });
});

describe("C7 — the care-task poller stopped querying per task", () => {
  const t = code("src/routes/careTasks.js");
  const fn = t.slice(t.indexOf("async function pollCareTasks"));

  test("'roll to missed' is grouped by date, not run per task", () => {
    expect(fn).toMatch(/for \(const \[day, ids\] of byDate\)/);
    expect(fn).toMatch(/WHERE task_id IN \(\$\{ph\}\) AND status = 'pending' AND due_date < \?/);
  });

  test("today's occurrences are fetched in one query", () => {
    expect(fn).toMatch(/SELECT \* FROM care_task_occurrences\s*\n\s*WHERE task_id IN \(\$\{ph\}\) AND status = 'pending'/);
  });

  test("each task's own timezone still decides its 'today'", () => {
    // The batching must not collapse timezones — a task in Hawaii and one in Virginia have
    // different todays, and using one for both would mark a live task missed.
    expect(fn).toMatch(/todayByTask\.set\(t\.id, getTodayStringInZone\(taskTz\(t, t\.recipient_tz\)\)\)/);
    expect(fn).toMatch(/String\(r\.due_date\)\.slice\(0, 10\) === todayByTask\.get\(r\.task_id\)/);
  });

  test("an occurrence created by materialization this tick is still found", () => {
    // The batched read happens before materializeOccurrence, so a task whose occurrence was
    // created just now would otherwise be skipped for a whole minute.
    expect(fn).toMatch(/if \(!occ\) \{[\s\S]{0,260}SELECT \* FROM care_task_occurrences WHERE task_id = \? AND due_date = \?/);
  });
});

describe("C8 — an admin stat that failed is not a stat that is zero", () => {
  const o = code("src/routes/admin/overview.js");

  test("no bare catch is left on a dashboard query", () => {
    expect(o).not.toMatch(/catch \(e\) \{ \/\* \*\/ \}/);
  });

  test("they report instead, and keep their default so one panel cannot take the page down", () => {
    // Slice to the FUNCTION BODY. Asserting that the file contains a captureException call
    // somewhere passes happily against `function statFailed() { return; }` followed by a dead
    // copy of the real one — which is exactly what a revert of this produced.
    const start = o.indexOf("function statFailed(where, e) {");
    expect(start).toBeGreaterThan(-1);
    const body = o.slice(start, o.indexOf("\n}", start));
    expect(body).toMatch(/console\.error/);
    expect(body).toMatch(/captureException\(/);
    expect(body).not.toMatch(/\breturn;/);       // an early return makes the reporting dead code
    expect((o.match(/function statFailed\(/g) || []).length).toBe(1);
    expect((o.match(/statFailed\(/g) || []).length).toBeGreaterThanOrEqual(14);
  });
});
