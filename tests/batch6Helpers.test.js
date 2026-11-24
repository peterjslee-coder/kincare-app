/**
 * Batch 6 — the helpers that were trapped inside a router (v1.106.16).
 *
 * routes/sessions.js is an Express router with 33 routes. It also held six functions that take
 * no request and return no response, two of which existed a second time elsewhere, and one of
 * which — expireStaleProposals — was required OUT of the router by dashboard.js and server.js.
 * Sweeping proposals meant loading the whole router and everything it pulls in.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || "batch6-helpers-secret";

const fs = require("fs");
const path = require("path");
const { code } = require("./helpers/source");

describe("H1 — the platform fee has one owner", () => {
  const { getPlatformFeePercent, DEFAULT_PLATFORM_FEE_PERCENT } = require("../src/utils/platformFee");

  test("the default is a named constant, not a number typed twice", () => {
    // It existed byte-identically in sessions.js and dashboard.js, `20` and all. Two copies of
    // a money default is one edit away from the dashboard quoting a fee the session won't charge.
    expect(DEFAULT_PLATFORM_FEE_PERCENT).toBe(20);
    const src = code("src/utils/platformFee.js");
    expect((src.match(/\b20\b/g) || []).length).toBe(1);
  });

  test("it reads the setting when there is one", async () => {
    const db = { prepare: () => ({ get: async () => ({ value: "12.5" }) }) };
    await expect(getPlatformFeePercent(db)).resolves.toBe(12.5);
  });

  test("it falls back to the default when the row is missing", async () => {
    const db = { prepare: () => ({ get: async () => undefined }) };
    await expect(getPlatformFeePercent(db)).resolves.toBe(DEFAULT_PLATFORM_FEE_PERCENT);
  });

  test("…and when the read throws — a fee of NaN would price a booking at nothing", async () => {
    const db = { prepare: () => ({ get: async () => { throw new Error("db down"); } }) };
    await expect(getPlatformFeePercent(db)).resolves.toBe(DEFAULT_PLATFORM_FEE_PERCENT);
  });

  test("no route defines its own copy any more", () => {
    for (const f of ["src/routes/sessions.js", "src/routes/dashboard.js"]) {
      expect(code(f)).not.toMatch(/async function getPlatformFeePercent/);
    }
    expect(code("src/routes/dashboard.js")).toMatch(/require\("\.\.\/utils\/platformFee"\)/);
  });
});

describe("H2 — one time parser, and it is the defensive one", () => {
  const { parseTimeToMinutes } = require("../src/utils/timezone");

  test.each([
    ["14:30", 870], ["00:00", 0], ["9:05", 545], ["23:59", 1439],
    ["", 0], [null, 0], [undefined, 0],
  ])("%s → %s", (input, expected) => {
    expect(parseTimeToMinutes(input)).toBe(expected);
  });

  test("a malformed time is 0, never NaN", () => {
    // The two copies disagreed here: sessions.js used `h * 60` and returned NaN, jobMatching
    // used `(h || 0) * 60` and returned 0. NaN then propagates silently through the overlap and
    // duration arithmetic that decides cancellation fees.
    for (const bad of ["garbage", "::", "abc:def", "14"]) {
      const v = parseTimeToMinutes(bad);
      expect(Number.isNaN(v)).toBe(false);
      expect(typeof v).toBe("number");
    }
    expect(parseTimeToMinutes("14")).toBe(840);   // hour-only still parses
  });

  test("neither old home defines it any more", () => {
    for (const f of ["src/routes/sessions.js", "src/utils/jobMatching.js"]) {
      expect(code(f)).not.toMatch(/function parseTimeToMinutes/);
    }
  });
});

describe("H3 — the router is no longer a library", () => {
  test.each([
    ["src/utils/proposals.js", "expireStaleProposals"],
    ["src/utils/assignments.js", "ensureAssignment"],
    ["src/utils/paymentStanding.js", "checkPaymentStanding"],
    ["src/utils/recurrence.js", "generateRecurringDates"],
    ["src/utils/platformFee.js", "getPlatformFeePercent"],
  ])("%s exports %s", (file, fn) => {
    expect(fs.existsSync(path.join(__dirname, "..", file))).toBe(true);
    expect(typeof require(path.join("..", file))[fn]).toBe("function");
  });

  test("and sessions.js no longer defines any of them", () => {
    const sess = code("src/routes/sessions.js");
    for (const fn of ["expireStaleProposals", "ensureAssignment", "checkPaymentStanding",
                      "generateRecurringDates", "getPlatformFeePercent"]) {
      expect(sess).not.toMatch(new RegExp(`(async )?function ${fn}\\s*\\(`));
    }
  });

  test("recurrence expands a rule without a database or a request", () => {
    // The test that says it is really a library: no db, no req, no router.
    const { generateRecurringDates } = require("../src/utils/recurrence");
    const out = generateRecurringDates("2026-10-01", "weekly", 3);
    expect(Array.isArray(out)).toBe(true);
    expect(out.length).toBeGreaterThan(0);
    for (const d of out) expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
