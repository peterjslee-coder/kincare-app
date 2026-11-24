// v1.107.5 — which appointments a visit caregiver sees: only those inside her shift.
const { duringShift } = require("../src/utils/careEventUtils");

const today = "2026-09-16";
const ev = (event_date, event_time, end_time = null) => ({ event_date, event_time, end_time });
const day = [{ date: today, time: "09:00", durationHours: 8, status: "confirmed" }];
const night = [{ date: today, time: "20:00", durationHours: 12, status: "confirmed" }];
const TZ = "America/New_York";

test("inside a day shift", () => {
  expect(duringShift(ev(today, "10:00"), day, today, TZ)).toBe(true);
  expect(duringShift(ev(today, "09:00"), day, today, TZ)).toBe(true);
});
test("after the shift ends, or before it starts", () => {
  expect(duringShift(ev(today, "17:00"), day, today, TZ)).toBe(false);
  expect(duringShift(ev(today, "18:30"), day, today, TZ)).toBe(false);
  expect(duringShift(ev(today, "08:00"), day, today, TZ)).toBe(false);
});
test("an appointment that starts before and runs into the shift counts", () => {
  expect(duringShift(ev(today, "08:30", "09:30"), day, today, TZ)).toBe(true);
  expect(duringShift(ev(today, "07:00", "08:30"), day, today, TZ)).toBe(false);
});
test("an overnight shift sees tomorrow's early appointment and not tomorrow's noon one", () => {
  expect(duringShift(ev("2026-09-17", "06:00"), night, today, TZ)).toBe(true);
  expect(duringShift(ev("2026-09-17", "12:00"), night, today, TZ)).toBe(false);
});
test("a later day is never in a today shift; all-day today is", () => {
  expect(duringShift(ev("2026-09-18", "10:00"), day, today, TZ)).toBe(false);
  expect(duringShift(ev(today, null), day, today, TZ)).toBe(true);
  expect(duringShift(ev("2026-09-17", null), night, today, TZ)).toBe(false);
});
test("12-hour times parse", () => {
  const pm = [{ date: today, time: "1:00 PM", durationHours: 2, status: "confirmed" }];
  expect(duringShift(ev(today, "14:30"), pm, today, TZ)).toBe(true);
  expect(duringShift(ev(today, "15:30"), pm, today, TZ)).toBe(false);
});
