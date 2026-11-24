/**
 * v1.125.2 — which visit a texted instruction pins to (feedback bba0e539). The pure parts.
 */
const IT = require("../src/utils/instructionTarget");

test("dayLabel names the weekday from the calendar date alone", () => {
  expect(IT.dayLabel("2026-10-27")).toBe("Tue Oct 27");
  expect(IT.dayLabel("2026-11-03T00:00:00")).toBe("Tue Nov 3");
});

test("whenWord: in progress beats the date; today and tomorrow are care-local", () => {
  expect(IT.whenWord({ status: "in_progress", scheduled_date: "2026-10-26" }, "2026-10-27")).toBe("in progress now");
  expect(IT.whenWord({ status: "confirmed", scheduled_date: "2026-10-27" }, "2026-10-27")).toBe("today");
  expect(IT.whenWord({ status: "confirmed", scheduled_date: "2026-10-28" }, "2026-10-27")).toBe("tomorrow");
  expect(IT.whenWord({ status: "confirmed", scheduled_date: "2026-11-02" }, "2026-10-27")).toBe("");
});

test("the label is built from the visit, not from the model", () => {
  const v = { status: "confirmed", scheduled_date: "2026-10-27", scheduled_time: "17:00", cg_first: "Tina" };
  expect(IT.visitLabel(v, "2026-10-27")).toBe("Tina — Tue Oct 27, 5pm · today");
});

describe("buildSuggestion", () => {
  const visits = [
    { id: "a", status: "in_progress", scheduled_date: "2026-10-27", scheduled_time: "16:00", cg_first: "Tina", care_timezone: "America/New_York" },
    { id: "b", status: "confirmed", scheduled_date: "2026-10-28", scheduled_time: "16:00", cg_first: "Tina", care_timezone: "America/New_York" },
  ];
  test("an id we did not offer is dropped, not trusted", () => {
    expect(IT.buildSuggestion(visits, { hasInstructions: true, instructionSummary: "x", matchedSessionId: "zzz" })).toBeNull();
  });
  test("no instructions, no card", () => {
    expect(IT.buildSuggestion(visits, { hasInstructions: false, instructionSummary: null, matchedSessionId: "a" })).toBeNull();
  });
  test("a good pick carries our label and every candidate to switch to", () => {
    const s = IT.buildSuggestion(visits, { hasInstructions: true, instructionSummary: "Please water the plant", matchedSessionId: "a", matchedSessionLabel: "WRONG LABEL" });
    expect(s.sessionId).toBe("a");
    expect(s.sessionLabel).toMatch(/^Tina — Tue Oct 27, 4pm · in progress now$/);
    expect(s.sessionLabel).not.toMatch(/WRONG/);
    expect(s.alternatives.map((x) => x.sessionId)).toEqual(["a", "b"]);
  });
});
