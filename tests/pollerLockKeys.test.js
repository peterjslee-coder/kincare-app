/**
 * Two pollers must not share a lock key. (v1.106.48)
 *
 * v1.105.50, in that commit's words: the Kindred reminder poller "was ALSO lock key 104, the
 * same key as the reimbursement digest sweeper directly above. Two unrelated pollers competing
 * for one lock: whichever ticked first blocked the other, so Kindred reminders and
 * reimbursement pushes were each silently skipping turns, and a hang in either killed both."
 *
 * Nothing stopped it happening again, and adding the fourteenth poller is exactly when it
 * would. Checking the keys by eye does not work either: key 106 legitimately appears twice —
 * a 90-second warm start and an hourly interval for the SAME job, sharing a lock on purpose —
 * so a plain uniqueness count reports a bug that is not there. I nearly filed it as one.
 *
 * The real rule is therefore about jobs, not occurrences: a key may repeat only when every
 * occurrence runs the same work.
 */
const { code } = require("./helpers/source");

const src = code("src/server.js");

/** From `start`, the text of one argument — up to the comma or paren that closes it. */
function callbackAt(start) {
  let depth = 0;
  for (let k = start; k < src.length; k++) {
    const ch = src[k];
    if (ch === "(" || ch === "{" || ch === "[") depth++;
    else if (ch === ")" || ch === "}" || ch === "]") {
      if (depth === 0) return src.slice(start, k);   // the ) that closes guardedPoller(
      depth--;
    }
  }
  return src.slice(start, start + 200);
}

/** Every guardedPoller(...) call, with the key and what it runs. */
function pollerCalls() {
  const out = [];
  // Scanned by index rather than with one big /g regex: a body capture wide enough to tell two
  // jobs apart also swallows the NEXT call, so key 106's adjacent pair came back as a single
  // occurrence and the test for it failed on its own blind spot.
  let i = -1;
  while ((i = src.indexOf("guardedPoller(", i + 1)) !== -1) {
    const after = src.slice(i + "guardedPoller(".length);
    const m = after.match(/^\s*(\d+)\s*,\s*/);
    if (!m) continue;
    out.push({
      key: Number(m[1]),
      // The callback, extracted by balancing parentheses rather than by taking a fixed number
      // of characters. A fixed window runs PAST the callback into setTimeout's own arguments,
      // so key 106's warm start and interval — the same job — differed only by "90 * 1000"
      // versus "60 * 60 * 1000" and were reported as two different jobs sharing a key. The
      // test's first version failed on its own blind spot rather than on anything in the code.
      body: callbackAt(i + "guardedPoller(".length + m[0].length).replace(/\s+/g, " ").trim(),
      at: src.slice(0, i).split("\n").length,
    });
  }
  return out;
}

describe("poller lock keys", () => {
  const calls = pollerCalls();

  test("there are pollers to check — the regex still matches this file", () => {
    // Without this the whole suite passes by finding nothing, which is how a source-scanning
    // test quietly stops testing.
    expect(calls.length).toBeGreaterThan(8);
  });

  test("no two DIFFERENT jobs share a key", () => {
    const byKey = new Map();
    for (const c of calls) {
      if (!byKey.has(c.key)) byKey.set(c.key, []);
      byKey.get(c.key).push(c);
    }
    const clashes = [];
    for (const [key, group] of byKey) {
      const distinct = new Set(group.map((g) => g.body));
      if (distinct.size > 1) {
        clashes.push(`key ${key} runs ${distinct.size} different jobs (lines ${group.map((g) => g.at).join(", ")})`);
      }
    }
    expect(clashes).toEqual([]);
  });

  test("a key repeated for ONE job is fine — 106 is a warm start plus an interval", () => {
    // Named so the exception is deliberate and visible rather than a hole in the rule.
    const g = calls.filter((c) => c.key === 106);
    expect(g.length).toBe(2);
    expect(new Set(g.map((c) => c.body)).size).toBe(1);
  });

  test("the settled-in poller has a key of its own", () => {
    // One occurrence: this one assigns guardedPoller(113, …) to a const and hands that const
    // to both setTimeout and setInterval — the tidier shape, and the reason a count alone
    // cannot tell you whether a key is shared.
    const k113 = calls.filter((c) => c.key === 113);
    expect(k113).toHaveLength(1);
    expect(k113[0].body).toMatch(/visitsDueConditionRead/);
    // And it is a real callback, not a truncated fragment — the extraction closed properly.
    expect(k113[0].body.endsWith("}")).toBe(true);
  });

  test("every key is a plain integer literal, never a variable", () => {
    // A computed key cannot be checked by anything, here or by eye.
    const literal = /guardedPoller\(\s*\d+\s*,/g;
    const any = /guardedPoller\(/g;
    expect((src.match(literal) || []).length).toBe((src.match(any) || []).length);
  });
});
