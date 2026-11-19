// The 24-hour day bar (v1.135.0).
//
// Pete, 11/18: "appointment at 8 starts about 1/3 from the left border and stretches to about
// 2/3 of the way in green because it's 8 hours ... they can stack/overlap."

const fs = require("fs");
const path = require("path");
const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

const src = read("public/js/components/DayBar.js");
const w = {};
// Only the pure half: the JSX components are not needed to answer what the bar holds.
new Function("window", src.slice(0, src.indexOf("const DayBar = window.DayBar")))(w);
const { dayBarSegments, dayBarCoveredHours, dayBarKind } = w;

const TODAY = "2026-11-18";
const at = (date, time, hours, status, name) => ({ id: `${date}-${time}-${name || status}`, scheduled_date: date, scheduled_time: time, duration_hours: hours, status, caregiver_name: name });
const byDate = (...ss) => ss.reduce((m, s) => { (m[s.scheduled_date] = m[s.scheduled_date] || []).push(s); return m; }, {});

test("8am for 8 hours is 8 → 16: a third in, to two thirds", () => {
  const [g] = dayBarSegments(byDate(at("2026-11-19", "08:00", 8, "confirmed", "Ryan Huber")), "2026-11-19", TODAY);
  expect(g).toMatchObject({ start: 8, end: 16, kind: "confirmed", lane: 0, label: "Ryan" });
  expect(g.start / 24).toBeCloseTo(1 / 3);
  expect(g.end / 24).toBeCloseTo(2 / 3);
});

test("colors follow status: requested/open orange, in progress, done, past confirmed is done", () => {
  expect(dayBarKind("open", "2026-11-19", TODAY)).toBe("requested");
  expect(dayBarKind("requested", "2026-11-19", TODAY)).toBe("requested");
  expect(dayBarKind("pending", "2026-11-19", TODAY)).toBe("requested");
  expect(dayBarKind("in_progress", TODAY, TODAY)).toBe("now");
  expect(dayBarKind("completed", "2026-11-10", TODAY)).toBe("done");
  expect(dayBarKind("confirmed", "2026-11-10", TODAY)).toBe("done");
  expect(dayBarKind("confirmed", "2026-11-19", TODAY)).toBe("confirmed");
});

test("overlapping visits stack on separate lines; back-to-back share one", () => {
  const segs = dayBarSegments(byDate(
    at("2026-11-19", "08:00", 8, "confirmed", "Ryan"),
    at("2026-11-19", "12:00", 5, "open"),
    at("2026-11-19", "16:00", 4, "requested"),
  ), "2026-11-19", TODAY);
  const lane = (s) => segs.find((g) => g.start === s).lane;
  expect(lane(8)).toBe(0);
  expect(lane(12)).toBe(1);
  expect(lane(16)).toBe(0); // starts as Ryan's ends
});

test("an overnight is cut at midnight and continues on the next day", () => {
  const data = byDate(at("2026-11-20", "22:00", 8, "confirmed", "Tina"));
  expect(dayBarSegments(data, "2026-11-20", TODAY)).toEqual([expect.objectContaining({ start: 22, end: 24 })]);
  expect(dayBarSegments(data, "2026-11-21", TODAY)).toEqual([expect.objectContaining({ start: 0, end: 6, label: "Tina" })]);
});

test("hours covered count overlap once and leave requested out", () => {
  const segs = dayBarSegments(byDate(
    at("2026-11-19", "08:00", 8, "confirmed"),
    at("2026-11-19", "12:00", 6, "confirmed"),
    at("2026-11-19", "20:00", 2, "open"),
  ), "2026-11-19", TODAY);
  expect(dayBarCoveredHours(segs)).toBe(10);
});

test("a visit with no time is left off rather than drawn at midnight", () => {
  expect(dayBarSegments(byDate(at("2026-11-19", null, 2, "open")), "2026-11-19", TODAY)).toEqual([]);
});

describe("where it shows", () => {
  const sched = read("public/js/components/Schedule.js");
  test("every month cell draws the bar (the dots are gone)", () => {
    expect(sched).toContain("<DayBar segments={dayBarSegments(sessionsByDate, dateStr, todayStr)} laneHeight={6}");
    expect(sched).not.toContain("Session dots — one per session");
  });
  test("Month first, Week one tap away, remembered", () => {
    expect(sched).toContain("useStickySection('schedule.weekView', false)");
  });
  test("the fetch reaches a week either side, so overnights and straddling weeks are whole", () => {
    expect(sched).toContain("from: ds(new Date(y, m, 1 - 7)), to: ds(new Date(y, m + 1, 7))");
  });
  test("the care team header has a Calendar button to the Schedule page", () => {
    const team = read("public/js/components/CareTeamManage.js");
    expect(team).toMatch(/aria-label="Calendar"[\s\S]{0,200}navigateTo\('schedule'\)/);
  });
  test("DayBar is bundled before Schedule", () => {
    const b = read("scripts/build-client.js");
    expect(b.indexOf("DayBar.js")).toBeGreaterThan(0);
    expect(b.indexOf("DayBar.js")).toBeLessThan(b.indexOf("Schedule.js"));
  });
});

test("the Home care-team banner has a Calendar button too (v1.135.2), and it doesn't open the team", () => {
  const dash = read("public/js/components/Dashboard.js");
  expect(dash).toMatch(/data-testid="banner-calendar"[\s\S]{0,120}e\.stopPropagation\(\); window\.__navigateTo/);
});
