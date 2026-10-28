/**
 * v1.125.2 — the client side of "cancel one visit or the series" (d42baa59) and of the instruction
 * day picker (bba0e539). Rule 8: raw() for presence, code() for absence.
 */
const { raw, code } = require("./helpers/source");

const modal = raw("public/js/components/CancelSessionModal.js");

test("the cancel screen sends a scope, and only 'series' when that was chosen", () => {
  expect(modal).toMatch(/scope: scope === 'series' \? 'series' : 'one'/);
});
test("when there is a series, nothing is pre-chosen and Cancel waits for a choice", () => {
  expect(modal).toMatch(/useState\(null\); \/\/ null until chosen/);
  expect(modal).toMatch(/const needChoice = !!series && !scope;/);
  expect(modal).toMatch(/disabled=\{loading \|\| needChoice\}/);
});
test("a click inside the screen never reaches an overlay underneath", () => {
  expect(modal).toMatch(/<div onClick=\{\(e\) => e\.stopPropagation\(\)\}/);
});

test("every cancel surface uses the shared screen", () => {
  expect(raw("public/js/components/VisitDetailModal.js")).toMatch(/<CancelSessionModal\s+role=\{role === 'caregiver' \? 'caregiver' : 'family'\}/);
  expect(raw("public/js/components/FindWork.js")).toMatch(/<CancelSessionModal\s+role="caregiver"/);
  // the old one-visit-only paths are gone
  expect(code("public/js/components/VisitDetailModal.js")).not.toMatch(/Cancel your session with/);
  expect(code("public/js/components/FindWork.js")).not.toMatch(/handleCancelSession/);
});

test("the dashboard no longer calls the series DELETE that skipped open visits", () => {
  expect(code("public/js/components/Dashboard.js")).not.toMatch(/\/api\/sessions\/recurring\/\$\{/);
  expect(raw("public/js/components/Dashboard.js")).toMatch(/cancelled this day only \\u2014 the rest of the series is still with/);
});

test("the instruction card sends the conversation and lets the family pick a different visit", () => {
  const m = raw("public/js/components/Messages.js");
  expect(m).toMatch(/JSON\.stringify\(\{ message: sentText, conversationId: data\.conversationId \|\| activeConvId \}\)/);
  expect(m).toMatch(/instructionSuggestion\.alternatives\.map/);
});

test("the old series DELETE route is gone from the server (v1.125.4)", () => {
  expect(code("src/routes/sessions.js")).not.toMatch(/router\.delete\("\/recurring\/:groupId"/);
});
