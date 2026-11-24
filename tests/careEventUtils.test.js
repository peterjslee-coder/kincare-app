/**
 * Care Events pure-logic tests (v1.100.0): validation, date math, the
 * reminder-stage decision the poller acts on, and .ics generation.
 */
const {
  validateEventInput, addDaysToDateString, reminderStage, buildIcs,
} = require("../src/utils/careEventUtils");
const { zonedDateTimeToInstant } = require("../src/utils/timezone");

const TZ = "America/New_York";

describe("validateEventInput", () => {
  test("requires title and a real date", () => {
    expect(validateEventInput({ title: "", event_date: "2026-07-28" }).errors.length).toBe(1);
    expect(validateEventInput({ title: "X", event_date: "tomorrow" }).errors.length).toBe(1);
    expect(validateEventInput({ title: "X", event_date: "2026-07-28" }).errors).toHaveLength(0);
  });
  test("rejects malformed times, allows null time (all-day)", () => {
    expect(validateEventInput({ title: "X", event_date: "2026-07-28", event_time: "2pm" }).errors.length).toBe(1);
    expect(validateEventInput({ title: "X", event_date: "2026-07-28", event_time: null }).errors).toHaveLength(0);
    expect(validateEventInput({ title: "X", event_date: "2026-07-28", event_time: "14:00" }).errors).toHaveLength(0);
  });
  test("unknown category falls back to 'other'", () => {
    expect(validateEventInput({ title: "X", event_date: "2026-07-28", category: "banana" }).category).toBe("other");
    expect(validateEventInput({ title: "X", event_date: "2026-07-28", category: "medical" }).category).toBe("medical");
  });
});

describe("addDaysToDateString", () => {
  test("crosses month and year boundaries", () => {
    expect(addDaysToDateString("2026-07-31", 1)).toBe("2026-08-01");
    expect(addDaysToDateString("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysToDateString("2026-08-01", -1)).toBe("2026-07-31");
  });
});

describe("reminderStage", () => {
  const timed = (overrides = {}) => ({
    event_date: "2026-07-29", event_time: "14:00", tz: TZ, reminders_sent: "", ...overrides,
  });

  test("timed event: same_day fires inside the 2h-before window, not earlier", () => {
    const start = zonedDateTimeToInstant("2026-07-29", "14:00", TZ).getTime();
    expect(reminderStage(timed(), start - 90 * 60000)).toBe("same_day");
    expect(reminderStage(timed(), start - 3 * 3600000)).toBe(null);
    expect(reminderStage(timed(), start + 30 * 60000)).toBe("same_day"); // late is still useful
    expect(reminderStage(timed(), start + 2 * 3600000)).toBe(null); // ancient is not
  });

  test("same_day never repeats", () => {
    const start = zonedDateTimeToInstant("2026-07-29", "14:00", TZ).getTime();
    expect(reminderStage(timed({ reminders_sent: "day_before,same_day" }), start - 60 * 60000)).toBe(null);
  });

  test("day_before fires the prior evening (>= 5pm local), not the afternoon", () => {
    const eveningBefore = zonedDateTimeToInstant("2026-07-28", "18:00", TZ).getTime();
    const afternoonBefore = zonedDateTimeToInstant("2026-07-28", "15:00", TZ).getTime();
    expect(reminderStage(timed(), eveningBefore)).toBe("day_before");
    expect(reminderStage(timed(), afternoonBefore)).toBe(null);
    expect(reminderStage(timed({ reminders_sent: "day_before" }), eveningBefore)).toBe(null);
  });

  test("all-day event: morning-of nudge from 8am local", () => {
    const allDay = { event_date: "2026-07-29", event_time: null, tz: TZ, reminders_sent: "" };
    expect(reminderStage(allDay, zonedDateTimeToInstant("2026-07-29", "09:00", TZ).getTime())).toBe("same_day");
    expect(reminderStage(allDay, zonedDateTimeToInstant("2026-07-29", "07:00", TZ).getTime())).toBe(null);
    expect(reminderStage(allDay, zonedDateTimeToInstant("2026-07-28", "19:00", TZ).getTime())).toBe("day_before");
  });
});

describe("buildIcs", () => {
  test("timed event renders UTC DTSTART/DTEND (2pm ET = 18:00Z in July)", () => {
    const ics = buildIcs({
      id: "abc", title: "Cardiology — Dr. Patel", event_date: "2026-07-28",
      event_time: "14:00", end_time: "15:00", tz: TZ, location: "Carilion Clinic, Radford",
    });
    expect(ics).toContain("DTSTART:20260728T180000Z");
    expect(ics).toContain("DTEND:20260728T190000Z");
    expect(ics).toContain("SUMMARY:Cardiology — Dr. Patel");
    expect(ics).toContain("LOCATION:Carilion Clinic\\, Radford"); // comma escaped
    expect(ics).toContain("UID:abc@yourinplace.com");
  });

  test("no end time defaults to one hour", () => {
    const ics = buildIcs({ id: "x", title: "T", event_date: "2026-07-28", event_time: "14:00", tz: TZ });
    expect(ics).toContain("DTSTART:20260728T180000Z");
    expect(ics).toContain("DTEND:20260728T190000Z");
  });

  test("all-day event uses DATE values with exclusive DTEND", () => {
    const ics = buildIcs({ id: "x", title: "Birthday", event_date: "2026-07-31", event_time: null, tz: TZ });
    expect(ics).toContain("DTSTART;VALUE=DATE:20260731");
    expect(ics).toContain("DTEND;VALUE=DATE:20260801");
  });

  test("newlines in details are escaped, not literal", () => {
    const ics = buildIcs({ id: "x", title: "T", event_date: "2026-07-28", event_time: "14:00", tz: TZ, details: "line one\nline two" });
    expect(ics).toContain("DESCRIPTION:line one\\nline two");
  });
});
