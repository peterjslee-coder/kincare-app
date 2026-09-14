/**
 * v1.106.33 — Mon–Fri for four weeks is ONE request.
 *
 * Pete: "Would it be easier for me to make an appointment for MTWThF from 9-5 for four weeks
 * instead of doing separate appointments for every day?" It would, and it could not be done:
 * "weekly" stepped 7 days from one start date, so Monday-to-Friday for a month was five
 * bookings, five recurrence groups, and five cards for the caregiver to accept.
 *
 * Date expansion is arithmetic with a calendar in it, which is where the quiet bugs live —
 * month boundaries, DST, and the mid-week start that would otherwise book a visit in the
 * past. All of it runs the real function.
 */
const { generateRecurringDates, parseDays, DAY_KEYS } = require("../src/utils/recurrence");
const { code } = require("./helpers/source");

const MF = "mon,tue,wed,thu,fri";
// 2026-09-21 is a Monday.
const MON = "2026-09-21";

const dow = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d, 12).getDay();
};

describe("the old rules are untouched", () => {
  test("weekly still steps 7 days from the start", () => {
    expect(generateRecurringDates("2026-10-01", "weekly", 3))
      .toEqual(["2026-10-01", "2026-10-08", "2026-10-15"]);
  });

  test("biweekly still steps 14", () => {
    expect(generateRecurringDates("2026-10-01", "biweekly", 3))
      .toEqual(["2026-10-01", "2026-10-15", "2026-10-29"]);
  });
});

describe("a weekday pattern", () => {
  test("Mon–Fri for four weeks is twenty dates", () => {
    const out = generateRecurringDates(MON, "days", 4, MF);
    expect(out).toHaveLength(20);
    expect(out[0]).toBe(MON);
  });

  test("every date really is a weekday", () => {
    for (const d of generateRecurringDates(MON, "days", 4, MF)) {
      expect(dow(d)).toBeGreaterThanOrEqual(1);
      expect(dow(d)).toBeLessThanOrEqual(5);
    }
  });

  test("three days a week gives three a week", () => {
    const out = generateRecurringDates(MON, "days", 3, "mon,wed,fri");
    expect(out).toHaveLength(9);
    for (const d of out) expect([1, 3, 5]).toContain(dow(d));
  });

  test("dates come back ascending and unique", () => {
    const out = generateRecurringDates(MON, "days", 4, MF);
    expect([...out].sort()).toEqual(out);
    expect(new Set(out).size).toBe(out.length);
  });

  test("a mid-week start does not book into the past", () => {
    // THE one that matters. A session created in the past is immediately overdue,
    // un-checkin-able, and sitting on someone's screen.
    const THU = "2026-10-01"; // a Thursday
    const out = generateRecurringDates(THU, "days", 2, MF);
    expect(out[0]).toBe(THU);
    for (const d of out) expect(d >= THU).toBe(true);
  });

  test("N weeks is N weeks of cover whichever day you ask on", () => {
    // The first cut aligned the window to Sunday, which quietly short-changed anyone not
    // starting on one — "two weeks of weekends" booked on a Saturday gave THREE visits,
    // because that week's Sunday was already behind the start date. The window runs
    // weeks * 7 days from the day you picked, so each selected weekday falls in it exactly
    // `weeks` times and the count is days-per-week x weeks, always.
    expect(generateRecurringDates(MON, "days", 4, MF)).toHaveLength(20);          // Mon start
    expect(generateRecurringDates("2026-10-01", "days", 2, MF)).toHaveLength(10); // Thu start
    expect(generateRecurringDates("2026-09-26", "days", 2, "sat,sun")).toHaveLength(4);
    expect(generateRecurringDates(MON, "days", 3, "mon,wed,fri")).toHaveLength(9);
  });

  test("a start date on a day that is not selected still starts after it", () => {
    const SAT = "2026-09-26"; // Saturday
    const out = generateRecurringDates(SAT, "days", 1, "mon,tue");
    for (const d of out) expect(d > SAT).toBe(true);
  });

  test("it crosses a month boundary correctly", () => {
    const out = generateRecurringDates("2026-09-28", "days", 2, MF);
    expect(out).toContain("2026-09-30");
    expect(out).toContain("2026-10-01");
    for (const d of out) expect(dow(d)).toBeLessThanOrEqual(5);
  });

  test("it survives the DST change without shifting a day", () => {
    // US DST ends 2026-11-01. Stepping by 24h across it moves the wall clock; the expander
    // works in local-noon dates so the weekday must hold either side.
    const out = generateRecurringDates("2026-10-26", "days", 3, MF);
    for (const d of out) {
      expect(dow(d)).toBeGreaterThanOrEqual(1);
      expect(dow(d)).toBeLessThanOrEqual(5);
    }
    expect(out).toContain("2026-11-02"); // the Monday after the change
  });

  test("weekends can be booked too — care does not stop on Saturday", () => {
    const out = generateRecurringDates("2026-09-26", "days", 2, "sat,sun");
    expect(out).toHaveLength(4);
    for (const d of out) expect([0, 6]).toContain(dow(d));
  });

  test("the form's count matches what the server will actually create", () => {
    // The hint says "N visits" now rather than "about N" — a family reading a total before
    // committing to a month of care should be reading the real number.
    for (const [start, weeks, days] of [
      [MON, 4, MF], ["2026-10-01", 2, MF], ["2026-09-26", 3, "sat,sun"], [MON, 6, "tue,thu"],
    ]) {
      const expected = days.split(",").length * weeks;
      expect(generateRecurringDates(start, "days", weeks, days)).toHaveLength(expected);
    }
  });
});

describe("bad input does not explode", () => {
  test("no days selected falls back to the single start date", () => {
    expect(generateRecurringDates(MON, "days", 4, "")).toEqual([MON]);
    expect(generateRecurringDates(MON, "days", 4, undefined)).toEqual([MON]);
  });

  test("junk day names are dropped, the real ones survive", () => {
    const out = generateRecurringDates(MON, "days", 1, "mon,notaday,fri");
    expect(out).toHaveLength(2);
    expect(out.map(dow).sort()).toEqual([1, 5]);
  });

  test("whitespace and case do not matter", () => {
    expect(parseDays(" MON , Tue ,WED ")).toEqual(new Set([1, 2, 3]));
  });

  test("full day names work as well as the three-letter form", () => {
    expect(parseDays("monday,friday")).toEqual(new Set([1, 5]));
  });

  test("the key order matches JS getDay()", () => {
    expect(DAY_KEYS[0]).toBe("sun");
    expect(DAY_KEYS[6]).toBe("sat");
  });
});

describe("wired through", () => {
  test("the booking route accepts the rule", () => {
    const src = code("src/routes/sessions.js");
    expect(src).toContain('const validRules = ["weekly", "biweekly", "days"];');
    expect(src).toContain("req.body.recurrenceDays");
  });

  test("a runaway request is capped rather than creating a quarter of care", () => {
    // 12 weeks x 7 days is 84 rows, 84 payment authorizations and a list the caregiver has
    // to read before accepting. A mis-tap should not commit a family to that.
    const src = code("src/routes/sessions.js");
    expect(src).toContain("MAX_SESSIONS_PER_REQUEST = 40");
    expect(src).toContain("dates.length > MAX_SESSIONS_PER_REQUEST");
  });

  test("the form offers the days and sends them", () => {
    const src = code("public/js/components/RequestCareModal.js");
    expect(src).toContain("{ value: 'days', label: 'Certain days' }");
    expect(src).toContain("recurrenceDays: recurrence === 'days' ? recurrenceDays.join(',') : undefined");
  });

  test("the caregiver card names the days from the DATES, not from the rule", () => {
    // "Every Thursday" on a Monday-to-Friday month would be confidently wrong, and the first
    // visit's weekday says nothing about the rest of a day-set.
    const hub = code("public/js/components/CaretakerHub.js");
    expect(hub).toContain("for (const j of jobs)");
    expect(hub).toContain("return 'Weekdays'");
  });
});
