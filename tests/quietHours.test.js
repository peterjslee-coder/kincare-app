/**
 * v1.107.3 — quiet hours, the pure half (window arithmetic and the exempt list).
 * Behaviour through the real push path is in tests/integration/quietHours.itest.js.
 */
const { parseQuietHours, isQuietNow, isExempt, shouldHold } = require("../src/utils/quietHours");

// 2026-09-16 at the given Eastern wall-clock time (EDT, UTC-4).
const et = (hh, mm) => new Date(Date.UTC(2026, 8, 16, hh + 4, mm));
const overnight = { enabled: true, start: "22:00", end: "07:00", tz: "America/New_York" };
const daytime = { enabled: true, start: "13:00", end: "15:30", tz: "America/New_York" };

describe("the window", () => {
  test("crosses midnight", () => {
    const q = parseQuietHours({ quiet_hours: overnight });
    expect(isQuietNow(q, et(21, 59))).toBe(false);
    expect(isQuietNow(q, et(22, 0))).toBe(true);
    expect(isQuietNow(q, et(23, 30))).toBe(true);
    expect(isQuietNow(q, et(0, 5))).toBe(true);
    expect(isQuietNow(q, et(6, 59))).toBe(true);
    expect(isQuietNow(q, et(7, 0))).toBe(false);
    expect(isQuietNow(q, et(12, 0))).toBe(false);
  });

  test("within a day", () => {
    const q = parseQuietHours({ quiet_hours: daytime });
    expect(isQuietNow(q, et(12, 59))).toBe(false);
    expect(isQuietNow(q, et(13, 0))).toBe(true);
    expect(isQuietNow(q, et(15, 29))).toBe(true);
    expect(isQuietNow(q, et(15, 30))).toBe(false);
  });

  test("uses the zone that set it, not the server's", () => {
    // 22:30 Eastern is 19:30 Pacific — quiet for the East Coast phone, not for the West.
    const east = parseQuietHours({ quiet_hours: overnight });
    const west = parseQuietHours({ quiet_hours: { ...overnight, tz: "America/Los_Angeles" } });
    expect(isQuietNow(east, et(22, 30))).toBe(true);
    expect(isQuietNow(west, et(22, 30))).toBe(false);
  });

  test("off, missing, malformed, or zero-length means never quiet", () => {
    expect(parseQuietHours(null)).toBeNull();
    expect(parseQuietHours({})).toBeNull();
    expect(parseQuietHours({ quiet_hours: { ...overnight, enabled: false } })).toBeNull();
    expect(parseQuietHours({ quiet_hours: { ...overnight, start: "25:00" } })).toBeNull();
    expect(parseQuietHours({ quiet_hours: { ...overnight, start: "07:00", end: "07:00" } })).toBeNull();
    // a bad zone falls back rather than throwing
    expect(parseQuietHours({ quiet_hours: { ...overnight, tz: "Mars/Olympus" } }).tz).toBe("America/New_York");
  });
});

describe("what still gets through", () => {
  test.each([
    "safety_flag", "observation_attention",
    "caregiver_no_show", "overdue_check_in", "overdue_check_out_family",
    "payment_method_needed", "payment_authorization_failed",
  ])("%s is delivered", (t) => {
    expect(isExempt(t, {})).toBe(true);
    expect(shouldHold({ quiet_hours: overnight }, t, {}, et(23, 0))).toBe(false);
  });

  test("a type carried only in data.type is recognised", () => {
    expect(isExempt(undefined, { data: { type: "safety_flag" } })).toBe(true);
  });

  test.each(["team_note", "message", "session_in_progress", "care_event", "call_incoming", undefined])(
    "%s is held (Pete: calls too)", (t) => {
      expect(shouldHold({ quiet_hours: overnight }, t, { data: { type: t } }, et(23, 0))).toBe(true);
      expect(shouldHold({ quiet_hours: overnight }, t, { data: { type: t } }, et(9, 0))).toBe(false);
    });

  test("prefs stored as a JSON string are read", () => {
    expect(shouldHold(JSON.stringify({ quiet_hours: overnight }), "team_note", {}, et(23, 0))).toBe(true);
    expect(shouldHold("not json", "team_note", {}, et(23, 0))).toBe(false);
  });
});
