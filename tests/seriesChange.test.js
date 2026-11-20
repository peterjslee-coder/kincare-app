const SC = require("../src/utils/seriesChange");

describe("v1.139.0 — change a series", () => {
  const visit = { scheduled_time: "09:00", duration_hours: 8, agreed_rate: 25, estimated_cost: 200, short_notice_surcharge: 0, special_instructions: "Lunch at noon" };
  test("validates what can change", () => {
    expect(SC.normalizeChanges({ time: "25:00" }).error).toBeTruthy();
    expect(SC.normalizeChanges({ durationHours: 0.1 }).error).toBeTruthy();
    expect(SC.normalizeChanges({ rate: 5 }).error).toBeTruthy();
    expect(SC.normalizeChanges({ time: "9:30", durationHours: "6", rate: "28" }).changes).toEqual({ time: "09:30", durationHours: 6, rate: 28 });
  });
  test("only what differs counts, and it reads in plain words", () => {
    const eff = SC.effectiveChanges({ time: "09:00", durationHours: 6, rate: 28, instructions: "Lunch at noon" }, visit);
    expect(eff).toEqual({ durationHours: 6, rate: 28 });
    expect(SC.describe(eff, visit)).toEqual(["6 hr instead of 8 hr", "$28/hr instead of $25/hr"]);
  });
  test("the price follows rate × hours (plus any short-notice amount)", () => {
    expect(SC.newValues(visit, { rate: 28 }).estimated_cost).toBe(224);
    expect(SC.newValues({ ...visit, short_notice_surcharge: 10 }, { durationHours: 6 }).estimated_cost).toBe(160);
    expect(SC.newValues(visit, { time: "10:00" })).toMatchObject({ scheduled_time: "10:00", estimated_cost: 200, priceMoves: false });
  });
  test("current rate falls back to the quoted price when no rate was stored", () => {
    expect(SC.currentRate({ estimated_cost: 176, duration_hours: 8 })).toBe(22);
    expect(SC.currentRate({ proposed_rate: 24, estimated_cost: 999, duration_hours: 8 })).toBe(24);
  });
});
