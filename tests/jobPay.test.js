// Money a caregiver can check with a calculator. (v1.105.106)
//
// Julia, dc5e86b5: "$24 and then $29 listed on same job (doesn't match up)."
//
// She was right, and it was arithmetic, not taste. Both job cards computed the money inline:
//
//   basePerHour    = Math.round(baseCost / hours)   ← whole dollars
//   effectiveTotal = baseCost                       ← rendered with .toFixed(0)
//
// Two independent roundings of the same money, and the total carried no label at all. A
// 1.2-hour job at $29 showed a "$24/hr" pill and a bare "$29": 24 x 1.2 = 28.8, so
// multiplying what she could see never produced what she could see.

const fs = require("fs");
const path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "public", "js", "utils.js"), "utf8");
const slice = src.slice(src.indexOf("const jobPay"), src.indexOf("const formatServiceType"));
// eslint-disable-next-line no-new-func
const { jobPay, formatMoney, exclusiveMinutesLeft, isExclusiveExpired } =
  new Function(`const window = {}; ${slice}; return window;`)();

describe("Julia's card", () => {
  const job = { durationHours: 1.2, estimatedCost: 29, shortNoticeSurcharge: 0, proposedRate: 0 };

  test("the rate times the hours is the total, to the penny", () => {
    const p = jobPay(job);
    expect(Math.round(p.perHour * p.hours * 100) / 100).toBe(p.total);
  });

  test("and that is what she sees", () => {
    const p = jobPay(job);
    expect(formatMoney(p.perHour)).toBe("$24.17");   // was "$24"
    expect(formatMoney(p.total)).toBe("$29");
  });

  test("the old arithmetic did not reconcile — this is the bug, pinned", () => {
    const oldBasePerHour = Math.round(29 / 1.2);      // 24
    expect(oldBasePerHour * 1.2).not.toBe(29);
  });
});

describe("everything is derived from one total", () => {
  test("a short-notice bonus raises the effective rate, and the base still reconciles", () => {
    // subtotal 90 over 3h, plus a 15 surcharge.
    const p = jobPay({ durationHours: 3, estimatedCost: 105, shortNoticeSurcharge: 15 });
    expect(p.total).toBe(105);
    expect(p.perHour).toBeCloseTo(35, 10);
    expect(p.basePerHour).toBeCloseTo(30, 10);       // (105 - 15) / 3
    expect(p.hasBonus).toBe(true);
    expect(Math.round((p.basePerHour * 3 + p.surcharge) * 100) / 100).toBe(p.total);
  });

  test("a proposed rate wins, and the surcharge rides on top", () => {
    const p = jobPay({ durationHours: 4, estimatedCost: 999, proposedRate: 22, shortNoticeSurcharge: 8 });
    expect(p.total).toBe(96);                        // 22*4 + 8
    expect(p.perHour).toBe(24);
    expect(p.basePerHour).toBe(22);
  });

  test("zero hours never divides by zero", () => {
    const p = jobPay({ durationHours: 0, estimatedCost: 50 });
    expect(p.perHour).toBe(0);
    expect(p.basePerHour).toBe(0);
    expect(Number.isFinite(p.perHour)).toBe(true);
  });

  test("a junk job is zeroes, not NaN", () => {
    for (const j of [null, undefined, {}, { durationHours: "x", estimatedCost: "y" }]) {
      const p = jobPay(j);
      expect(Number.isFinite(p.total)).toBe(true);
      expect(Number.isFinite(p.perHour)).toBe(true);
    }
  });
});

describe("formatMoney", () => {
  test("whole dollars stay whole; anything else keeps its cents", () => {
    expect(formatMoney(29)).toBe("$29");
    expect(formatMoney(24.166666)).toBe("$24.17");
    expect(formatMoney(0)).toBe("$0");
    expect(formatMoney(24.5)).toBe("$24.50");
  });

  test("it never prints NaN at a caregiver", () => {
    expect(formatMoney(undefined)).toBe("$0");
    expect(formatMoney("nonsense")).toBe("$0");
  });
});

describe("an exclusive window moves only when the clock is passed in", () => {
  const T = Date.parse("2026-08-20T12:00:00Z");
  const job = { exclusiveUntil: "2026-08-20T12:20:00Z" };

  test("minutes left are measured against the caller's now", () => {
    expect(exclusiveMinutesLeft(job, T)).toBe(20);
    expect(exclusiveMinutesLeft(job, T + 19 * 60000)).toBe(1);
  });

  test("the same now always gives the same answer", () => {
    // The whole point: two filters and a countdown, one render, one moment. Calling
    // new Date() in each of them is what let a card change sections mid-tap.
    const at = T + 21 * 60000;
    expect(isExclusiveExpired(job, at)).toBe(true);
    expect(isExclusiveExpired(job, at)).toBe(true);
    expect(exclusiveMinutesLeft(job, at)).toBe(0);
  });

  test("a job with no window is never 'expired'", () => {
    // It was never exclusive; it belongs in the open list on its own merits.
    expect(exclusiveMinutesLeft({}, T)).toBeNull();
    expect(isExclusiveExpired({}, T)).toBe(false);
    expect(isExclusiveExpired({ exclusiveUntil: "not a date" }, T)).toBe(false);
  });
});
