// v1.128.0 — the arrival window comes from the visit's own terms (Pete, 11/15: a flexible visit
// is "plus or minus 30 minutes"), and nothing is cancelled for a missed check-in before the end.
const w = require("../src/utils/checkinWindow");

test("strict is 10 minutes, flexible and open are 30, unknown is strict", () => {
  expect(w.arrivalWindowMinutes("strict")).toBe(10);
  expect(w.arrivalWindowMinutes("flexible")).toBe(30);
  expect(w.arrivalWindowMinutes("open")).toBe(30);
  expect(w.arrivalWindowMinutes(null)).toBe(10);
});

test("the family's extra time moves the deadline, but only later and never past the end", () => {
  expect(w.checkInDeadlineMinutes({ flex_timing: "flexible", duration_hours: 8 })).toBe(30);
  expect(w.checkInDeadlineMinutes({ flex_timing: "flexible", duration_hours: 8, checkin_window_minutes: 60 })).toBe(60);
  expect(w.checkInDeadlineMinutes({ flex_timing: "flexible", duration_hours: 8, checkin_window_minutes: 5 })).toBe(30);
  expect(w.checkInDeadlineMinutes({ flex_timing: "flexible", duration_hours: 0.5, checkin_window_minutes: 90 })).toBe(30);
});

test("a no-show is cancelled at the scheduled end, not at +30", () => {
  expect(w.noShowCancelMinutes({ duration_hours: 8 })).toBe(480);
  expect(w.noShowCancelMinutes({ duration_hours: null })).toBe(30);
});

test("the poller no longer cancels at a fixed 30 minutes", () => {
  const src = require("fs").readFileSync(require("path").join(__dirname, "../src/routes/accountability.js"), "utf8");
  const poller = src.slice(src.indexOf("async function pollCaregiverNoShows"), src.indexOf("async function pollLateResolutionDefaults"));
  expect(poller).toMatch(/minutesPastStart >= cancelAt/);
  expect(poller).not.toMatch(/minutesPastStart >= 30\)/);
  expect(poller).toMatch(/cs\.pending_time_change_id IS NULL/);
});
