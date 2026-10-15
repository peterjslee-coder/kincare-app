/**
 * v1.121.0 — Betty's page is one page with six stops, in Pete's order (feedback a747e1cb).
 * Pinning the ORDER and that nothing fell off in the regroup: every section that existed
 * before still renders, inside the stop it was moved to.
 */
const { code } = require("./helpers/source");
const src = code("public/js/components/CareProfile.js");

const at = (needle) => {
  const i = src.indexOf(needle);
  if (i < 0) throw new Error(`missing from CareProfile: ${needle}`);
  return i;
};

test("the six stops are in Pete's order", () => {
  const order = ['id="person"', 'id="todo"', 'id="notes"', 'id="calendar"', 'id="money"', 'id="about"']
    .map((n) => at(`<LovedOneSection ${n}`));
  expect([...order].sort((a, b) => a - b)).toEqual(order);
});

test("every old section is still on the page, inside the right stop", () => {
  const stop = (id) => at(`<LovedOneSection id="${id}"`);
  const inside = (needle, id, next) => {
    const i = at(needle);
    expect(i).toBeGreaterThan(stop(id));
    if (next) expect(i).toBeLessThan(stop(next));
  };
  inside("<IPAiInsightsCard", "person", "todo");
  inside("<CareTasksSection", "todo", "notes");
  inside("ref={notesCardRef}", "notes", "calendar");
  inside("<CareEventsSection", "calendar", "money");
  inside('data-testid="loved-one-request-care"', "calendar", "money");
  inside("<LegalReadinessCard", "money", "about");
  inside('data-testid="open-documents-center"', "money", "about");
  inside("setPrefsExpanded(!prefsExpanded)", "about");
  inside("setPermsOpen(!permsOpen)", "about");
  inside("onNavigate('care-team')", "about");
});

test("the guide bar is drawn, and Documents is no longer a header button", () => {
  expect(src).toContain("<LovedOneGuideBar sections={lovedOneSections} />");
  expect(src.match(/data-testid="open-documents-center"/g)).toHaveLength(1);
});

test("a jump unfolds without rewriting the remembered fold", () => {
  const prefs = code("public/js/uiPrefs.js");
  expect(prefs).toMatch(/keys\.includes\(key\)\) setOpen\(true, \{ remember: false \}\)/);
  expect(prefs).toContain("window.addEventListener('inplace:open-section', onOpen)");
});
