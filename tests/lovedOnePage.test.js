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
  inside("<LovedOneToDo", "todo", "notes");
  inside("ref={notesCardRef}", "notes", "calendar");
  inside("<CareEventsSection", "calendar", "money");
  inside('data-testid="loved-one-request-care"', "calendar", "money");
  inside("<LovedOneReimbursements", "money", "about");
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

// ─── step 2: the notes summary ───
describe("notes summary (v1.121.0 step 2)", () => {
  test("flagged first, then new to this reader, then review-all; a no-new message", () => {
    const i = (n) => at(n);
    expect(i("groupLabel('Needs attention')")).toBeLessThan(i("New since your last look"));
    expect(src).toContain('data-testid="notes-nothing-new"');
    expect(src).toContain("No new notes since your last look");
    expect(src).toContain('data-testid="notes-review-all"');
    expect(src).toContain("Review all ${noteTimeline.length} notes, photos & reactions");
  });

  test("a reader's own notes are never 'new' to them", () => {
    expect(src).toMatch(/isNewToMe = \(t\) => [^\n]*authorOf\(t\) !== me/);
  });

  test("collapsed cards still show photos, suggestions, reactions and the flag", () => {
    expect(src).toMatch(/AttachmentThumb size=\{48\}/);
    expect(src).toMatch(/suggestion\{nSugg === 1 \? '' : 's'\}/);
    expect(src).toContain("reacts.length > 0");
    expect(src).toContain("Needs attention</span>}");
  });

  test("expanded is the full note as before, and a deep link opens its note", () => {
    expect(src).toContain("t.kind === 'visit' ? renderVisit(t.row) : renderNote(t.row)");
    expect(src).toMatch(/setExpandedNoteKeys\(\(prev\) => \{ const next = new Set\(prev\); next\.add\(`\$\{isVisit \? 'visit' : 'note'\}:\$\{id\}`\)/);
  });

  test("'last look' is per person, on the account, stamped on leave", () => {
    expect(src).toContain("const key = `notesSeen.${id}`;");
    // Measured against the newest item actually loaded, not the moment of leaving: a note that
    // arrives while the page sits open was never seen (staging, 10/15).
    expect(src).toContain("window.__setUiPref(key, `${nowIso}|${newest || nowIso}`);");
    expect(src).toContain("newestNoteAtRef.current = noteTimeline.length ? noteTimeline[0].at : null;");
    expect(src).toContain("window.addEventListener('pagehide', stamp)");
  });
});
