// v1.155.7 — the dates a repeating event moves to.
const { nextDate, nextHolidayDate, HOLIDAYS, isRepeatRule } = require("../src/utils/eventRepeats");

test("weekly and yearly", () => {
  expect(nextDate("weekly", "2026-12-29")).toBe("2027-01-05");
  expect(nextDate("yearly", "2026-03-14")).toBe("2027-03-14");
  expect(nextDate("yearly", "2028-02-29")).toBe("2029-02-28");
});

test("holidays land on the right day each year", () => {
  expect(nextDate("holiday:thanksgiving", "2026-11-26")).toBe("2027-11-25");
  expect(nextHolidayDate("thanksgiving", "2026-11-24")).toBe("2026-11-26");
  expect(nextHolidayDate("thanksgiving", "2026-11-27")).toBe("2027-11-25");
  expect(nextHolidayDate("easter", "2027-01-01")).toBe("2027-03-28");
  expect(nextHolidayDate("easter", "2028-01-01")).toBe("2028-04-16");
  expect(nextHolidayDate("mothers-day", "2027-01-01")).toBe("2027-05-09");
  expect(nextHolidayDate("memorial-day", "2027-01-01")).toBe("2027-05-31");
  expect(nextHolidayDate("fathers-day", "2027-01-01")).toBe("2027-06-20");
  expect(nextHolidayDate("labor-day", "2027-01-01")).toBe("2027-09-06");
  expect(nextHolidayDate("christmas", "2026-12-26")).toBe("2027-12-25");
});

test("every holiday title starts with an emoji; unknown rules are refused", () => {
  expect(HOLIDAYS).toHaveLength(9);
  for (const h of HOLIDAYS) expect(h.title).toMatch(/^(\p{Extended_Pictographic}|\p{Regional_Indicator})/u);
  expect(isRepeatRule("holiday:nope")).toBe(false);
  expect(isRepeatRule("monthly")).toBe(false);
});

test("the event form offers Every year, and the Events card offers the holidays once", () => {
  const { code } = require("./helpers/source");
  const c = code("public/js/components/CareEvents.js");
  expect(c).toContain('data-testid="repeat-yearly"');
  expect(c).toMatch(/\{canManage && !hasHolidays && \(\s*<button type="button" data-testid="add-holidays"/);
  expect(c).toContain("((repeat === 'weekly' || repeat === 'yearly') && !inSeries ? { repeat } : {})");
});
