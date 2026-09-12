// v1.105.193 — a greyed-out Find Work says why, and takes you to the list.
//
// Tina, Sep 12: everything on her path done but preferences and availability, and the Find
// Work button was dead — no sentence next to it, no tap response. Every real caregiver so far
// has hit some version of this. Now the tap names what is left and goes to the card.
const { code } = require("./helpers/source");
const app = code("public/js/app.js");
const hub = code("public/js/components/CaretakerHub.js");
const utils = code("public/js/utils.js");

test("the hub publishes WHAT is left, by name, not only that something is", () => {
  expect(hub).toContain("window.__caregiverFirstStepsLeft = showFirstSteps");
  expect(hub).toMatch(/hubRoute\.items\.filter\(\(i\) => i\.state === 'todo'\)\.map\(\(i\) => i\.label\)/);
});

test("all three Find Work buttons explain when locked — sidebar action, sidebar link, bottom bar", () => {
  expect(app).toContain("const explainLockedFindWork = () => {");
  expect(app).toContain("`Find Work unlocks when you finish: ${left.join(', ')}.`");
  expect(app).toContain("handlePageChange('dashboard');");
  expect((app.match(/item\.id === 'find-work' \? explainLockedFindWork/g) || []).length).toBe(3);
});

test("window.__showToast exists now — it had callers and no definition", () => {
  expect(utils).toContain("window.__showToast = showToast;");
  expect((utils.match(/window\.__showToast\?\.\(/g) || []).length).toBeGreaterThanOrEqual(2);
});
