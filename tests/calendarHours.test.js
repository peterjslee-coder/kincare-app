// The calendar shows the hours that matter, and never hides one. (v1.105.110)
//
// Tyler, 16328059: "Calendar starts at 0am and looks odd on the dashboard."
//
// Two things, and the first is literal. The hour label was
// `hour <= 12 ? hour : hour - 12` — which maps midnight to 0, and there is no 0 o'clock on a
// 12-hour clock. The row said "0a".
//
// The second: the grid was a fixed hourStart = 0, hourEnd = 24, so ten almost-always-empty
// overnight rows pushed the part he came to look at a screen and a half down.
//
// The tempting fix — hardcode 7 to 21 — would be worse. Overnight supervision is a service
// InPlace sells. A caregiver working 10pm to 6am would find her own shift clipped off the top
// with nothing to say it had been, and a calendar that silently omits a booked visit is worse
// than a tall one.

const fs = require("fs");
const path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "public", "js", "utils.js"), "utf8");
const slice = src.slice(src.indexOf("const DEFAULT_CALENDAR_HOURS"), src.indexOf("// How long an exclusive"));
// eslint-disable-next-line no-new-func
const { calendarHourRange } = new Function(`const window = {}; ${slice}; return window;`)();

const cal = fs.readFileSync(path.join(__dirname, "..", "public", "js", "components", "CaregiverCalendar.js"), "utf8");

describe("an ordinary week", () => {
  test("an empty calendar shows a comfortable default, not 24 rows", () => {
    expect(calendarHourRange([])).toEqual({ start: 7, end: 21 });
  });

  test("daytime visits do not widen it", () => {
    expect(calendarHourRange([{ hour: 9, span: 2 }, { hour: 14, span: 3 }])).toEqual({ start: 7, end: 21 });
  });

  test("that is ten fewer rows than before", () => {
    const { start, end } = calendarHourRange([]);
    expect(end - start).toBe(14);
  });
});

describe("nothing is ever hidden", () => {
  test("an early shift pulls the window back", () => {
    expect(calendarHourRange([{ hour: 5, span: 4 }]).start).toBe(5);
  });

  test("a late one pushes it forward", () => {
    expect(calendarHourRange([{ hour: 20, span: 3 }]).end).toBe(23);
  });

  test("an overnight shift shows midnight — its tail is on the next day", () => {
    // 10pm + 8h. Clipping at 24 would leave an overnight caregiver unable to see half her week.
    expect(calendarHourRange([{ hour: 22, span: 8 }])).toEqual({ start: 0, end: 24 });
  });

  test("a visit at midnight itself is visible", () => {
    expect(calendarHourRange([{ hour: 0, span: 1 }]).start).toBe(0);
  });

  test("an availability block a caregiver deliberately set counts too", () => {
    // Her own 6am availability should not be invisible on her own calendar.
    expect(calendarHourRange([{ hour: 6, span: 2 }]).start).toBe(6);
  });
});

describe("bad data cannot collapse or explode the grid", () => {
  test("a missing time does NOT read as midnight", () => {
    // Number(null) is 0, and 0 is a valid hour — so an unguarded coercion would drag the
    // window back to midnight, which is the exact complaint being fixed.
    expect(calendarHourRange([{ hour: null, span: 2 }])).toEqual({ start: 7, end: 21 });
    expect(calendarHourRange([{ hour: "", span: 2 }])).toEqual({ start: 7, end: 21 });
    expect(calendarHourRange([{ hour: "x" }])).toEqual({ start: 7, end: 21 });
    expect(calendarHourRange([null, undefined])).toEqual({ start: 7, end: 21 });
  });

  test("it never returns an empty or inverted range", () => {
    for (const spans of [[], [{ hour: 23, span: 99 }], [{ hour: 0, span: 0 }], null]) {
      const r = calendarHourRange(spans);
      expect(r.start).toBeGreaterThanOrEqual(0);
      expect(r.end).toBeLessThanOrEqual(24);
      expect(r.end).toBeGreaterThan(r.start);
    }
  });
});

describe("the component", () => {
  test("the fixed 0–24 grid is gone", () => {
    expect(cal).not.toMatch(/const hourStart = 0;/);
    expect(cal).not.toMatch(/const hourEnd = 24;/);
    expect(cal).toMatch(/return calendarHourRange\(spans\);/);
  });

  test("midnight is labelled 12a, not 0a", () => {
    expect(cal).toMatch(/\{hour % 12 === 0 \? 12 : hour % 12\}\{hour < 12 \? 'a' : 'p'\}/);
    expect(cal).not.toMatch(/\{hour <= 12 \? hour : hour - 12\}/);
  });

  test("sessions, requests and availability all feed the window", () => {
    const block = cal.slice(cal.indexOf("const visibleHours = (() =>"), cal.indexOf("const hourStart ="));
    expect(block).toMatch(/getSessionsForDate\(dateStr\)/);
    expect(block).toMatch(/getRequestsForDate\(dateStr\)/);
    expect(block).toMatch(/getAvailForDay\(d\.getDay\(\), weekStrs\[i\]\)/);
  });
});
