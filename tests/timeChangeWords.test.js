/**
 * v1.123.0 — a time change says what moves.
 *
 * Pete, 10/19: Tina kept a 9:00 start and shortened the visit from 8 hours to 6. The push, the
 * Needs-you card and the review sheet all said "9:00 AM → 9:00 AM" — each compared start times
 * only. These pin the describer and the three places that must use it.
 */
const fs = require("fs");
const path = require("path");
const TimeChange = require("../public/js/timeChange");

const d = (fromTime, fromHours, toTime, toHours) => TimeChange.describe({ fromTime, fromHours, toTime, toHours });
const read = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");

describe("TimeChange.describe", () => {
  test("Tina's request: same start, shorter → says the END moves, never 9:00 → 9:00", () => {
    const c = d("09:00", 8, "09:00", 6);
    expect(c.kind).toBe("endEarlier");
    expect(c.headline).toBe("End at 3:00 PM instead of 5:00 PM");
    expect(c.sub).toBe("6 hr instead of 8 hr");
    expect(c.verb).toBe("end a visit early");
    expect(c.headline).not.toMatch(/9:00 AM.*9:00 AM/);
    expect(c.from).toBe("9:00 AM – 5:00 PM");
    expect(c.to).toBe("9:00 AM – 3:00 PM");
  });

  test("half hours read as ½", () => {
    expect(d("09:00", 8, "09:00", 6.5).headline).toBe("End at 3:30 PM instead of 5:00 PM");
    expect(d("09:00", 8, "09:00", 6.5).sub).toBe("6½ hr instead of 8 hr");
  });

  test("staying later", () => {
    expect(d("09:00", 4, "09:00", 6)).toMatchObject({ kind: "endLater", headline: "End at 3:00 PM instead of 1:00 PM" });
  });

  test("same end, later start", () => {
    expect(d("09:00", 8, "11:00", 6)).toMatchObject({ kind: "startLater", headline: "Start at 11:00 AM instead of 9:00 AM", sub: "6 hr instead of 8 hr" });
  });

  test("same length, slid later — says the new end", () => {
    expect(d("09:00", 8, "11:00", 8)).toMatchObject({ kind: "shiftLater", sub: "Same 8 hr, now ends 7:00 PM" });
  });

  test("both ends move → both windows", () => {
    expect(d("09:00", 8, "10:00", 5).headline).toBe("Run 10:00 AM – 3:00 PM instead of 9:00 AM – 5:00 PM");
  });

  test("wraps past midnight", () => {
    expect(d("22:00", 4, "22:00", 3).headline).toBe("End at 1:00 AM instead of 2:00 AM");
  });

  // v1.124.0 — another day (Pete, 10/19: Tina's Nov 7 → Nov 14)
  test("a different day leads with the day", () => {
    const c = TimeChange.describe({ fromDate: "2026-11-07", toDate: "2026-11-14", fromTime: "09:00", fromHours: 8, toTime: "09:00", toHours: 8 });
    expect(c).toMatchObject({ kind: "moveDay", dateChanged: true, headline: "Move to Sat, Nov 14 instead of Sat, Nov 7", sub: "Same time, 9:00 AM – 5:00 PM" });
  });
  test("a different day AND hours says both", () => {
    const c = TimeChange.describe({ fromDate: "2026-11-07", toDate: "2026-11-14", fromTime: "09:00", fromHours: 8, toTime: "10:00", toHours: 6 });
    expect(c.sub).toBe("10:00 AM – 4:00 PM instead of 9:00 AM – 5:00 PM");
  });
  test("same day given explicitly behaves as before", () => {
    const c = TimeChange.describe({ fromDate: "2026-11-07", toDate: "2026-11-07", fromTime: "09:00", fromHours: 8, toTime: "09:00", toHours: 6 });
    expect(c.kind).toBe("endEarlier");
  });
  test("dateLabel never shifts a day (built in UTC from the date's own numbers)", () => {
    expect(TimeChange.dateLabel("2026-11-14")).toBe("Sat, Nov 14");
    expect(TimeChange.dateLabel("2027-01-01")).toBe("Fri, Jan 1");
  });

  test("onDay", () => {
    expect(TimeChange.onDay("Today")).toBe("today");
    expect(TimeChange.onDay("Thu, Oct 22")).toBe("on Thu, Oct 22");
  });
});

describe("every place that summarises a time change uses the describer", () => {
  test("push body (sessions.js)", () => {
    const src = read("src", "routes", "sessions.js");
    expect(src).toMatch(/TimeChange\.describe\(/);
    expect(src).not.toMatch(/session from \$\{origFriendlyTime\} to \$\{friendlyTime\}/);
  });
  test("Needs-you title (attention.js)", () => {
    expect(read("src", "utils", "attention.js")).toMatch(/TimeChange\.describe\([\s\S]{0,400}\.verb/);
  });
  test("Needs-you detail (AttentionCard.js)", () => {
    expect(read("public", "js", "components", "AttentionCard.js")).toMatch(/TimeChange\.describe\(/);
  });
  test("both review sheets draw TimeChangeSummary", () => {
    expect(read("public", "js", "components", "Dashboard.js")).toMatch(/<TimeChangeSummary /);
    expect(read("public", "js", "components", "CaretakerHub.js")).toMatch(/<TimeChangeSummary /);
  });
  test("timeChange.js is in the bundle before anything that reads it", () => {
    const b = read("scripts", "build-client.js");
    expect(b.indexOf('"js/timeChange.js"')).toBeGreaterThan(-1);
    expect(b.indexOf('"js/timeChange.js"')).toBeLessThan(b.indexOf('"js/components/AttentionCard.js"'));
    expect(b.indexOf('"js/components/TimeChangeSummary.js"')).toBeLessThan(b.indexOf('"js/components/Dashboard.js"'));
  });
});

describe("v1.124.0 — changing a visit is reachable from every visit details screen", () => {
  const vdm = read("public", "js", "components", "VisitDetailModal.js");
  test("VisitDetailModal opens the shared sheet itself when its host has none", () => {
    expect(vdm).toMatch(/if \(onTimeChange\) \{[^}]*\} else \{ setChanging\(true\); \}/);
    expect(vdm).toMatch(/<ChangeVisitSheet /);
  });
  test("the button no longer requires onTimeChange", () => {
    expect(vdm).not.toMatch(/!data\.session\.pending_time_change_id && onTimeChange &&/);
  });
  test("Home and the caregiver hub use the same sheet (no hand-kept copies)", () => {
    expect(read("public", "js", "components", "Dashboard.js")).toMatch(/<ChangeVisitSheet [^>]*role="family"/);
    expect(read("public", "js", "components", "CaretakerHub.js")).toMatch(/<ChangeVisitSheet [^>]*role="caregiver"/);
    expect(read("public", "js", "components", "Dashboard.js")).not.toMatch(/propose-time-change/);
    expect(read("public", "js", "components", "CaretakerHub.js")).not.toMatch(/propose-time-change/);
  });
  test("the sheet sends a day", () => {
    expect(read("public", "js", "components", "ChangeVisitSheet.js")).toMatch(/proposedDate:/);
  });
});
