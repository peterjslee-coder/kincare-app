/**
 * v1.120.1 — when the payer is reminded (Pete, 10/15: "keep pinging members until they pay").
 */
const { cadence, reminderDue, reminderPush } = require("../src/utils/reimbursementReminders");

const row = (over = {}) => ({
  id: "r1", amount: 95, planned_method: null, tz: "America/New_York", payee_first: "Pete",
  care_team_id: "t1", approved_at: "2026-10-11T00:22:45Z", pay_reminder_last_at: null, ...over,
});

describe("cadence", () => {
  test("in-app or unspecified: day 2, every 2", () => expect(cadence(null)).toEqual({ firstDays: 2, everyDays: 2 }));
  test("check/cash: day 10, every 3", () => {
    expect(cadence("check")).toEqual({ firstDays: 10, everyDays: 3 });
    expect(cadence("cash")).toEqual({ firstDays: 10, everyDays: 3 });
  });
});

describe("reminderDue", () => {
  test("not on day 1, yes on day 2 at 2 PM Eastern", () => {
    expect(reminderDue(row(), new Date("2026-10-12T18:00:00Z"))).toBe(false);
    expect(reminderDue(row(), new Date("2026-10-13T18:00:00Z"))).toBe(true);
  });
  test("never at night in the care recipient's zone", () => {
    expect(reminderDue(row(), new Date("2026-10-14T03:00:00Z"))).toBe(false); // 11 PM ET
    expect(reminderDue(row(), new Date("2026-10-14T12:30:00Z"))).toBe(false); // 8:30 AM ET
    expect(reminderDue(row({ tz: "America/Los_Angeles" }), new Date("2026-10-14T15:00:00Z"))).toBe(false); // 8 AM PT
  });
  test("after a reminder, waits the full interval", () => {
    const r = row({ pay_reminder_last_at: "2026-10-13T18:00:00Z" });
    expect(reminderDue(r, new Date("2026-10-15T17:00:00Z"))).toBe(false);
    expect(reminderDue(r, new Date("2026-10-15T18:00:00Z"))).toBe(true);
  });
});

describe("reminderPush", () => {
  test("amount and payee, never the description; deep-links to the row", () => {
    const p = reminderPush(row({ description: "pharmacy for her condition" }));
    expect(p.body).toBe("$95.00 to Pete, approved Oct 10, hasn't been paid yet. Tap to pay.");
    expect(JSON.stringify(p)).not.toContain("pharmacy");
    expect(p.data).toMatchObject({ type: "reimbursement_unpaid", page: "care-team", focus: "reimbursement:r1" });
  });
});
