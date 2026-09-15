// ─── What a break costs (v1.106.41) ───
//
// Pete's rule, in his words: "if she needs to run somewhere for a personal reason for an
// hour, she can, but won't be paid. So short is free is probably closest...but also has to be
// cumulative...so no more than 30 minutes break before we stop pay." And: "if someone is up
// for a 2 hour session, they shouldn't get a 30 minute grace. Let's call it for sessions
// longer than 4 hours, they get a 30 min break. we'll adjust from there."
//
// The arithmetic lives on its own so it can be read against that paragraph line by line.
// Whether it is APPLIED correctly at check-out is a different question, answered against a
// real database in tests/integration/visitBreakCheckout.itest.js.
const {
  breakBudgetMinutes, breakMinutes, summarizeBreaks, breakNotice,
  PAID_BREAK_MINUTES, PAID_BREAK_MIN_SESSION_HOURS,
} = require("../src/utils/visitBreaks");

const at = (hhmm) => `2026-09-15T${hhmm}:00.000Z`;
const brk = (from, to) => ({ id: `${from}-${to}`, started_at: at(from), ended_at: to ? at(to) : null });

describe("who gets a paid break at all", () => {
  test("a visit longer than four hours does", () => {
    expect(breakBudgetMinutes(4.5)).toBe(PAID_BREAK_MINUTES);
    expect(breakBudgetMinutes(8)).toBe(30);
    expect(breakBudgetMinutes(12)).toBe(30);
  });

  test("a two-hour shift does not — Pete: 'they shouldn't get a 30 minute grace'", () => {
    expect(breakBudgetMinutes(2)).toBe(0);
    expect(breakBudgetMinutes(1)).toBe(0);
    expect(breakBudgetMinutes(0.5)).toBe(0);
  });

  test("exactly four hours does not — the rule is LONGER than four", () => {
    expect(PAID_BREAK_MIN_SESSION_HOURS).toBe(4);
    expect(breakBudgetMinutes(4)).toBe(0);
    expect(breakBudgetMinutes(4.01)).toBe(30);
  });

  test("a missing or nonsense duration is treated as too short, never as unlimited", () => {
    for (const bad of [null, undefined, NaN, "", "abc", -3]) {
      expect(breakBudgetMinutes(bad)).toBe(0);
    }
  });
});

describe("how long she was away", () => {
  test("a finished break is its own length", () => {
    expect(breakMinutes(brk("11:00", "11:20"))).toBe(20);
  });

  test("an unfinished break runs to 'now' — leaving and not returning is not zero", () => {
    expect(breakMinutes(brk("11:00", null), new Date(at("13:00")))).toBe(120);
  });

  test("garbage timestamps are zero, not NaN — NaN would poison the whole total", () => {
    expect(breakMinutes({ started_at: "nope", ended_at: at("11:00") })).toBe(0);
    expect(breakMinutes({ started_at: at("11:00"), ended_at: "nope" })).toBe(0);
    expect(breakMinutes(null)).toBe(0);
    expect(breakMinutes({})).toBe(0);
  });

  test("a negative interval clamps to zero rather than crediting her time", () => {
    expect(breakMinutes(brk("13:00", "11:00"))).toBe(0);
  });
});

describe("cumulative, which is the word Pete used", () => {
  test("three ten-minute breaks are thirty minutes and still free", () => {
    const r = summarizeBreaks([brk("10:00", "10:10"), brk("12:00", "12:10"), brk("14:00", "14:10")], 8);
    expect(r.totalMinutes).toBe(30);
    expect(r.unpaidMinutes).toBe(0);
    expect(r.remainingMinutes).toBe(0);
  });

  test("four ten-minute breaks cost her the fourth — not each one separately", () => {
    const r = summarizeBreaks(
      [brk("10:00", "10:10"), brk("12:00", "12:10"), brk("14:00", "14:10"), brk("15:00", "15:10")], 8);
    expect(r.totalMinutes).toBe(40);
    expect(r.paidMinutes).toBe(30);
    expect(r.unpaidMinutes).toBe(10);
  });

  test("Pete's example: away two hours on an eight-hour day costs ninety minutes", () => {
    const r = summarizeBreaks([brk("11:00", "13:00")], 8);
    expect(r.totalMinutes).toBe(120);
    expect(r.unpaidMinutes).toBe(90);
  });

  test("the same two hours on a four-hour visit costs all of it", () => {
    const r = summarizeBreaks([brk("11:00", "13:00")], 4);
    expect(r.budgetMinutes).toBe(0);
    expect(r.unpaidMinutes).toBe(120);
  });

  test("rounding is applied ONCE at the end, not per break", () => {
    // Three 10.5-minute breaks: 31.5 total, 1.5 over → 2. Rounding each break up first would
    // make it 33 total and 3 over, charging her a minute she did not take.
    const half = (from, to) => ({ id: from, started_at: from, ended_at: to });
    const rows = [
      half("2026-09-15T10:00:00.000Z", "2026-09-15T10:10:30.000Z"),
      half("2026-09-15T12:00:00.000Z", "2026-09-15T12:10:30.000Z"),
      half("2026-09-15T14:00:00.000Z", "2026-09-15T14:10:30.000Z"),
    ];
    const r = summarizeBreaks(rows, 8);
    expect(r.totalMinutes).toBeCloseTo(31.5, 5);
    expect(r.unpaidMinutes).toBe(2);
  });

  test("no breaks is the whole budget, still available", () => {
    const r = summarizeBreaks([], 8);
    expect(r).toMatchObject({ budgetMinutes: 30, totalMinutes: 0, unpaidMinutes: 0, remainingMinutes: 30, breakCount: 0, openBreak: null });
  });

  test("a non-array is treated as no breaks, not as a crash on the money path", () => {
    expect(summarizeBreaks(null, 8).totalMinutes).toBe(0);
    expect(summarizeBreaks(undefined, 8).unpaidMinutes).toBe(0);
  });

  test("an open break is reported, so check-out knows to close it", () => {
    const r = summarizeBreaks([brk("10:00", "10:10"), brk("14:00", null)], 8, new Date(at("14:30")));
    expect(r.openBreak).toBeTruthy();
    expect(r.openBreak.id).toBe("14:00-null");
    expect(r.totalMinutes).toBe(40);
    expect(r.unpaidMinutes).toBe(10);
  });
});

describe("what Tina is told when she taps Step out", () => {
  test("it names the minutes she has left — Pete: 'you have X minutes left'", () => {
    const msg = breakNotice(summarizeBreaks([], 8));
    expect(msg).toMatch(/30 min left/);
    expect(msg).toMatch(/pay/);
  });

  test("it counts down as she uses it", () => {
    expect(breakNotice(summarizeBreaks([brk("10:00", "10:20")], 8))).toMatch(/10 min left/);
  });

  test("once the budget is gone it says so plainly, and does not say '0 min left'", () => {
    const msg = breakNotice(summarizeBreaks([brk("10:00", "11:00")], 8));
    expect(msg).not.toMatch(/0 min left/);
    expect(msg).toMatch(/clock is paused/);
  });

  test("a short visit is told it has no paid break, rather than being told about 0 minutes", () => {
    const msg = breakNotice(summarizeBreaks([], 2));
    expect(msg).toMatch(/no paid break time/);
    expect(msg).not.toMatch(/\b0 min\b/);
  });

  test("every version of the notice tells her she may go", () => {
    for (const hours of [2, 8]) {
      for (const rows of [[], [brk("10:00", "10:20")], [brk("10:00", "11:00")]]) {
        expect(breakNotice(summarizeBreaks(rows, hours))).toMatch(/Take (your|a) break/i);
      }
    }
  });
});
