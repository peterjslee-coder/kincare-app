const { isShortNoticeVisit, calculateSessionCost } = require("../src/utils/rateCalculator");

// v1.163.1 — the rush surcharge is decided in the care recipient's zone, per visit.
// The real case: a Mon–Wed 5–8pm series booked Sun Nov 22 2026 at 4:00pm Eastern
// (21:00 UTC). Monday's visit was 25 hours out; all three were charged +20%.
describe("v1.163.1 — short-notice rush", () => {
  const booked = new Date("2026-11-22T21:00:16Z");
  const ET = "America/New_York";

  test("a visit 25 hours out in Eastern time is not a rush", () => {
    expect(isShortNoticeVisit("2026-11-23", "17:00", ET, booked)).toBe(false);
  });

  test("later visits in the same series are not a rush either", () => {
    expect(isShortNoticeVisit("2026-11-24", "17:00", ET, booked)).toBe(false);
    expect(isShortNoticeVisit("2026-11-25", "17:00", ET, booked)).toBe(false);
  });

  test("a visit genuinely inside 24 hours still is", () => {
    expect(isShortNoticeVisit("2026-11-23", "15:00", ET, booked)).toBe(true); // 23h out
    expect(isShortNoticeVisit("2026-11-22", "18:00", ET, booked)).toBe(true);
  });

  test("defaults to Eastern when no zone is known", () => {
    expect(isShortNoticeVisit("2026-11-23", "17:00", undefined, booked)).toBe(false);
  });

  test("the zone matters: the same wall clock in Pacific is three hours later", () => {
    expect(isShortNoticeVisit("2026-11-23", "14:30", "America/Los_Angeles", booked)).toBe(false); // 25.5h
    expect(isShortNoticeVisit("2026-11-23", "14:30", ET, booked)).toBe(true); // 22.5h
  });

  test("price for the case: $22 x 3h, no rush = $66", () => {
    const r = calculateSessionCost("17:00", null, { daytime: 22, nighttime: 22, overnight: 22, base: 22 }, {
      scheduledDate: "2026-11-23", durationHours: 3,
      shortNotice: isShortNoticeVisit("2026-11-23", "17:00", ET, booked),
    });
    expect(r.surcharge).toBe(0);
    expect(r.total).toBe(66);
  });
});
