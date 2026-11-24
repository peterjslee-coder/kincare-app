// v1.152.0 — InPlace Hub helpers: settings cleaning, visit end times, and the "days she comes" label.
const { cleanHub, addHours, weekdayLabel, nextVisitLabel, relationLabel, parseSimpleMode } = require("../src/utils/simpleMode");

test("cleanHub keeps known booleans and valid HH:MM only", () => {
  expect(cleanHub(null)).toEqual({ on: false, faces: true, week: true, photos: true, dimFrom: "21:00", dimTo: "07:00", callUserIds: [], photoAspect: null });
  expect(cleanHub({ on: true, faces: "yes", dimFrom: "9pm", dimTo: "06:15", x: 1 }))
    .toEqual({ on: true, faces: true, week: true, photos: true, dimFrom: "21:00", dimTo: "06:15", callUserIds: [], photoAspect: null });
});

test("a record saved before the Hub existed reads as Hub off", () => {
  expect(parseSimpleMode(JSON.stringify({ on: true, callUserIds: [] })).hub.on).toBe(false);
});

test("addHours", () => {
  expect(addHours("10:00", 2.5)).toBe("12:30");
  expect(addHours("22:30", 3)).toBe("01:30");
  expect(addHours(null, 2)).toBeNull();
});

test("weekdayLabel reads Monday-first", () => {
  // 2026-11-23 is a Monday, 11-26 a Thursday, 11-25 a Wednesday.
  expect(weekdayLabel([])).toBeNull();
  expect(weekdayLabel(["2026-11-25", "2026-12-02"])).toBe("Wednesdays");
  expect(weekdayLabel(["2026-11-26", "2026-11-23"])).toBe("Mon and Thu");
  expect(weekdayLabel(["2026-11-27", "2026-11-25", "2026-11-23"])).toBe("Mon, Wed, Fri");
  expect(weekdayLabel(["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27"])).toBe("Most days");
  expect(weekdayLabel(["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"])).toBe("Every day");
});

test("relationLabel", () => {
  expect(relationLabel("Son")).toBe("your son");
  expect(relationLabel("Best friend from church")).toBe("Best friend from church");
  expect(relationLabel("")).toBeNull();
});

test("nextVisitLabel: Today, Tomorrow, then the weekday", () => {
  expect(nextVisitLabel("2026-11-23", "2026-11-23")).toBe("Today");
  expect(nextVisitLabel("2026-11-24", "2026-11-23")).toBe("Tomorrow");
  expect(nextVisitLabel("2026-11-26", "2026-11-23")).toBe("Thursday");
  expect(nextVisitLabel(null, "2026-11-23")).toBe("your caregiver");
});

test("cleanHub keeps at most two Hub call buttons, strings only, no repeats", () => {
  expect(cleanHub({ callUserIds: ["a", "a", 3, "b", "c"] }).callUserIds).toEqual(["a", "b"]);
  expect(cleanHub({ callUserIds: "a" }).callUserIds).toEqual([]);
});
