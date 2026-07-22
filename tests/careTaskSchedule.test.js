// Unit tests for the Care Tasks recurrence helpers (src/utils/careTaskSchedule.js).
// Pure logic — no DB, no clock. The poller and routes share these verbatim,
// so a bug here would double-remind or silently skip a medication night.
const { dayNameOf, isDueOn, validateTaskInput } = require("../src/utils/careTaskSchedule");

describe("careTaskSchedule", () => {
  describe("dayNameOf", () => {
    test("maps known dates to weekdays", () => {
      expect(dayNameOf("2026-07-22")).toBe("wed");
      expect(dayNameOf("2026-07-26")).toBe("sun");
      expect(dayNameOf("2026-07-27")).toBe("mon");
    });
    test("garbage in → null, not a crash", () => {
      expect(dayNameOf("not-a-date")).toBe(null);
    });
  });

  describe("isDueOn", () => {
    const base = { recurrence: "daily", start_date: "2026-07-01", end_date: null, is_active: 1 };

    test("daily task is due every day inside its window", () => {
      expect(isDueOn(base, "2026-07-22")).toBe(true);
      expect(isDueOn(base, "2026-12-25")).toBe(true);
    });

    test("respects start_date (nothing due before the course begins)", () => {
      expect(isDueOn(base, "2026-06-30")).toBe(false);
      expect(isDueOn(base, "2026-07-01")).toBe(true);
    });

    test("respects end_date — Pete's 'for how long' (inclusive)", () => {
      const course = { ...base, end_date: "2026-09-30" };
      expect(isDueOn(course, "2026-09-30")).toBe(true);
      expect(isDueOn(course, "2026-10-01")).toBe(false);
    });

    test("paused tasks are never due", () => {
      expect(isDueOn({ ...base, is_active: 0 }, "2026-07-22")).toBe(false);
    });

    test("weekly task fires on start_date's weekday only", () => {
      const weekly = { ...base, recurrence: "weekly", start_date: "2026-07-22" }; // a Wednesday
      expect(isDueOn(weekly, "2026-07-29")).toBe(true);  // next Wednesday
      expect(isDueOn(weekly, "2026-07-30")).toBe(false); // Thursday
    });

    test("custom days fire on listed weekdays only", () => {
      const mwf = { ...base, recurrence: "days", recurrence_days: "mon,wed,fri" };
      expect(isDueOn(mwf, "2026-07-22")).toBe(true);  // Wed
      expect(isDueOn(mwf, "2026-07-23")).toBe(false); // Thu
      expect(isDueOn(mwf, "2026-07-24")).toBe(true);  // Fri
    });

    test("days recurrence with empty list is never due (not always due)", () => {
      expect(isDueOn({ ...base, recurrence: "days", recurrence_days: "" }, "2026-07-22")).toBe(false);
    });
  });

  describe("validateTaskInput", () => {
    const good = { title: "Evening medication", recurrence: "daily", due_time: "19:00", start_date: "2026-07-22" };

    test("accepts a well-formed nightly med task with 45-min default grace", () => {
      const { errors, grace } = validateTaskInput(good);
      expect(errors).toEqual([]);
      expect(grace).toBe(45); // Pete's settled default
    });

    test("rejects missing title, bad time, backwards dates", () => {
      expect(validateTaskInput({ ...good, title: " " }).errors.length).toBeGreaterThan(0);
      expect(validateTaskInput({ ...good, due_time: "7pm" }).errors.length).toBeGreaterThan(0);
      expect(validateTaskInput({ ...good, end_date: "2026-07-01" }).errors.length).toBeGreaterThan(0);
    });

    test("rejects 'days' recurrence without any valid day", () => {
      expect(validateTaskInput({ ...good, recurrence: "days", recurrence_days: "" }).errors.length).toBeGreaterThan(0);
      expect(validateTaskInput({ ...good, recurrence: "days", recurrence_days: "mon,funday" }).errors.length).toBeGreaterThan(0);
      expect(validateTaskInput({ ...good, recurrence: "days", recurrence_days: "mon,wed,fri" }).errors).toEqual([]);
    });

    test("rejects unknown task types, accepts the five known ones", () => {
      expect(validateTaskInput({ ...good, task_type: "surgery" }).errors.length).toBeGreaterThan(0);
      for (const t of ["medication", "hygiene", "meal", "checkin", "custom"]) {
        expect(validateTaskInput({ ...good, task_type: t }).errors).toEqual([]);
      }
    });
  });
});
