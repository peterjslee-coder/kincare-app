/**
 * Batch 6 — the dual-name API reads (v1.106.15).
 *
 * The plan said "fix the API boundary — 84 dual-name fallbacks". Measured, it is 36 fields
 * across 131 sites, and the fallbacks are load-bearing rather than sloppy:
 *
 *   /api/sessions   spreads raw database rows  → snake_case
 *   /api/dashboard  hand-builds its objects    → camelCase
 *
 * and components render sessions from both. Against production, renaming to one convention
 * breaks ~200 unguarded reads whichever way you go — 254 snake, 165 camel — for nothing a user
 * would ever see. So the debt is frozen, not paid, and the failure mode it hides is caught
 * instead: `x.a || x.b` where the server sends neither is undefined, and undefined renders as
 * a blank cell with no error anywhere.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || "batch6-dualnames-secret";

const { execFileSync } = require("child_process");
const path = require("path");
const { raw } = require("./helpers/source");

const REPO = path.join(__dirname, "..");
const runGate = () => {
  try {
    return { code: 0, out: execFileSync("node", ["scripts/lint-dual-names.js"], { cwd: REPO, encoding: "utf8" }) };
  } catch (e) {
    return { code: e.status, out: (e.stdout || "") + (e.stderr || "") };
  }
};

describe("G1 — the gate holds the line", () => {
  test("it passes on the tree as it stands", () => {
    const { code, out } = runGate();
    expect(code).toBe(0);
    expect(out).toMatch(/none new/);
  });

  test("the baseline is a real measurement, not a round number someone typed", () => {
    const lint = raw("scripts/lint-dual-names.js");
    const block = lint.slice(lint.indexOf("const BASELINE = {"), lint.indexOf("};", lint.indexOf("const BASELINE = {")));
    const entries = [...block.matchAll(/([a-z_]+):\s*(\d+)/g)];
    expect(entries.length).toBe(36);
    const total = entries.reduce((a, m) => a + Number(m[2]), 0);
    expect(total).toBe(131);
    // and the gate's own count agrees with it
    expect(runGate().out).toMatch(/36 dual-name field\(s\), 131 site\(s\)/);
  });

  test("it reports a baselined pair that has gone, so the number gets lowered", () => {
    // Otherwise the baseline silently protects debt that is already paid.
    expect(raw("scripts/lint-dual-names.js")).toMatch(/baselined pair\(s\) are gone/);
    expect(raw("scripts/lint-dual-names.js")).toMatch(/shrunk, lower the baseline/);
  });

  test("it runs in CI", () => {
    expect(raw(".github/workflows/ci.yml")).toMatch(/npm run lint:dual-names/);
  });

  test("it tells you to fix the endpoint, not to add another fallback", () => {
    const lint = raw("scripts/lint-dual-names.js");
    expect(lint).toMatch(/Fix the endpoint/);
  });
});

describe("G2 — why the rename was not done, recorded so nobody re-derives it", () => {
  test("the reasoning lives with the gate", () => {
    const lint = raw("scripts/lint-dual-names.js");
    expect(lint).toMatch(/spreads raw rows/);
    expect(lint).toMatch(/254 snake, 165 camel/);
  });

  test("the contract test is named as the other half", () => {
    expect(raw("scripts/lint-dual-names.js")).toMatch(/apiFieldContract\.itest\.js/);
    expect(raw(".github/workflows/ci.yml")).toMatch(/apiFieldContract\.itest\.js/);
  });
});
