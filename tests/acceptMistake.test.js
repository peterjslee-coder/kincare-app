/**
 * v1.147.0 — "accepted by mistake". The window rule, and the wiring a refactor could drop.
 */
const { mistakeWindow, MISTAKE_WINDOW_MINUTES } = require("../src/utils/acceptMistake");
const { code } = require("./helpers/source");

const NOW = Date.parse("2026-11-22T23:00:00Z");
const ago = (min) => new Date(NOW - min * 60000).toISOString();
const s = (over) => ({ caregiver_id: "p1", status: "confirmed", caregiver_accepted_at: ago(5), ...over });

describe("mistakeWindow", () => {
  test("open for her cancel inside the window, with minutes left", () => {
    expect(MISTAKE_WINDOW_MINUTES).toBe(30);
    expect(mistakeWindow(s(), "caregiver", NOW)).toEqual({ open: true, minutesLeft: 25 });
  });
  test("closed after the window, for the family, with no accept time, or once started", () => {
    expect(mistakeWindow(s({ caregiver_accepted_at: ago(31) }), "caregiver", NOW).open).toBe(false);
    expect(mistakeWindow(s(), "family", NOW).open).toBe(false);
    expect(mistakeWindow(s({ caregiver_accepted_at: null }), "caregiver", NOW).open).toBe(false);
    expect(mistakeWindow(s({ status: "in_progress" }), "caregiver", NOW).open).toBe(false);
    expect(mistakeWindow(s({ caregiver_id: null }), "caregiver", NOW).open).toBe(false);
  });
});

describe("wiring", () => {
  test("both claim paths stamp the accept time", () => {
    expect(code("src/utils/seriesClaim.js")).toContain("caregiver_accepted_at = NOW()");
    const sessions = code("src/routes/sessions.js");
    const claim = sessions.slice(sessions.indexOf('router.put("/:id/claim"'), sessions.indexOf('router.put("/:id/claim"') + 3000);
    expect(claim).toContain("caregiver_accepted_at = NOW()");
  });
  test("the late-cancel decision consults the window, in the cancel AND the preview", () => {
    const sessions = code("src/routes/sessions.js");
    expect((sessions.match(/mistakeWindow\(/g) || []).length).toBeGreaterThanOrEqual(3);
  });
  test("accepting offers Undo on Home and Find Work", () => {
    expect(code("public/js/components/CancelSessionModal.js")).toContain("window.offerUndoAccept =");
    expect(code("public/js/components/CaretakerHub.js")).toContain("window.offerUndoAccept([jobId]");
    expect(code("public/js/components/FindWork.js")).toContain("window.offerUndoAccept([sessionId]");
  });
});
