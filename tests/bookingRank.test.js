/**
 * v1.151.0 — the caregiver order on Request care (public/js/bookingRank.js).
 *
 * The case it was built against: a Sunday 9–1 request. Tina has 59 visits but is off Sundays;
 * Kay is free; Edwina and Cary last came in April; Faith is new. The old order put lifetime
 * visit count first and availability last, so the one caregiver actually free sat third.
 */
const BookingRank = require("../public/js/bookingRank");

const cg = (name, o) => ({ name, visitCount: 0, recentVisits: 0, available: false, rating: 0, booked: null, ...o });

describe("rank", () => {
  const list = [
    cg("Tina", { visitCount: 59, recentVisits: 8, rating: 5 }),
    cg("Cary", { visitCount: 25, recentVisits: 0, rating: 4.5 }),
    cg("Kay", { visitCount: 5, recentVisits: 2, available: true, rating: 5 }),
    cg("Edwina", { visitCount: 5, recentVisits: 0, rating: 5, available: true }),
    cg("Faith", { visitCount: 0 }),
    cg("Ryan", { visitCount: 2, recentVisits: 1, rating: 5 }),
  ];

  test("free and recent first; off-day but recent next; new; then lapsed", () => {
    const ranked = BookingRank.rank(list);
    expect(ranked.map((c) => c.name)).toEqual(["Kay", "Tina", "Ryan", "Faith", "Cary", "Edwina"]);
    expect(ranked.map((c) => c.group)).toEqual(["available", "off", "off", "new", "lapsed", "lapsed"]);
    expect(BookingRank.bestMatch(ranked).name).toBe("Kay");
  });

  test("a lapsed caregiver who is free that day is still not the best match", () => {
    const ranked = BookingRank.rank([cg("Edwina", { visitCount: 5, available: true, rating: 5 })]);
    expect(ranked[0].group).toBe("lapsed");
    expect(BookingRank.bestMatch(ranked)).toBeNull();
  });

  test("already booked then goes to the bottom and is never the best match", () => {
    const ranked = BookingRank.rank([
      cg("Kay", { visitCount: 5, recentVisits: 2, available: true, booked: { sameRecipient: true } }),
      cg("Tina", { visitCount: 59, recentVisits: 8 }),
    ]);
    expect(ranked.map((c) => c.name)).toEqual(["Tina", "Kay"]);
    expect(ranked[1].group).toBe("booked");
    expect(BookingRank.bestMatch(ranked)).toBeNull();
  });

  test("inside a group: recent visits, then all visits, then stars", () => {
    const ranked = BookingRank.rank([
      cg("A", { visitCount: 9, recentVisits: 1, available: true, rating: 5 }),
      cg("B", { visitCount: 3, recentVisits: 3, available: true, rating: 4 }),
      cg("C", { visitCount: 9, recentVisits: 1, available: true, rating: 4.8 }),
    ]);
    expect(ranked.map((c) => c.name)).toEqual(["B", "A", "C"]);
  });
});

describe("overlaps", () => {
  const want = { date: "2026-11-29", time: "09:00", durationHours: 4 };
  test("same morning clashes, back-to-back does not", () => {
    expect(BookingRank.overlaps({ date: "2026-11-29", time: "12:30", durationHours: 2 }, want)).toBe(true);
    expect(BookingRank.overlaps({ date: "2026-11-29", time: "13:00", durationHours: 2 }, want)).toBe(false);
    expect(BookingRank.overlaps({ date: "2026-11-29", time: "07:00", durationHours: 2 }, want)).toBe(false);
  });
  test("an overnight from the night before runs into the morning", () => {
    expect(BookingRank.overlaps({ date: "2026-11-28", time: "22:00", durationHours: 12 }, want)).toBe(true);
    expect(BookingRank.overlaps({ date: "2026-11-28", time: "22:00", durationHours: 8 }, want)).toBe(false);
  });
  test("other days and bad input never clash", () => {
    expect(BookingRank.overlaps({ date: "2026-11-27", time: "09:00", durationHours: 30 }, want)).toBe(false);
    expect(BookingRank.overlaps({ date: "2026-11-29", time: "", durationHours: 4 }, want)).toBe(false);
  });
  test("minusDays crosses months and years", () => {
    expect(BookingRank.minusDays("2026-12-01", 1)).toBe("2026-11-30");
    expect(BookingRank.minusDays("2027-01-15", 30)).toBe("2026-12-16");
  });
});
