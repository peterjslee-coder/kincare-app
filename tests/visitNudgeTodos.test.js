/**
 * v1.112.4 — Pete: "on the to-dos it would be great if it prompted you when you got to the care
 * location, i.e. Betty's house" … "does the 'to do' also combine with 'wanna leave a note'
 * nudge?" One card: the visit nudge shows the to-dos waiting at the house. Same privacy line as
 * the nudge always had — the position is compared on the phone and sent nowhere.
 */
const { raw, code } = require("./helpers/source");

const src = code("public/js/components/FamilyVisitLog.js");
const card = src.slice(src.indexOf("const VisitNudgeCard"), src.indexOf("function haversineFeet"));

test("the nudge card lists the to-dos waiting for the person you're with", () => {
  expect(card).toMatch(/<CareTodoList recipientIds=\{\[match\.recipient\.id\]\}/);
  expect(card).toMatch(/apiFetch\('\/api\/care-todos'\)/);
  // refreshed when a to-do is done anywhere, so the card goes when there's nothing left
  expect(card).toMatch(/addEventListener\('inplace:care-todos-changed', load\)/);
});

test("a logged visit no longer hides the card while a to-do is still open", () => {
  expect(card).toMatch(/const settled = \(r\) => loggedFor\(r\) && !todosFor\(r\)/);
  expect(card).toMatch(/settled\(match\.recipient\)\) return null/);
  expect(card).toMatch(/\{needsLog && <button onClick=\{\(\) => onLog/);
});

test("it checks again when the app comes back to the front", () => {
  expect(card).toMatch(/addEventListener\('visibilitychange', onVis\)/);
});

test("the only request the card makes is the to-do list — no position goes with it", () => {
  const calls = card.match(/apiFetch\([^)]*\)/g) || [];
  expect(calls).toEqual(["apiFetch('/api/care-todos')"]);
  expect(card).not.toMatch(/latitude[^\n]*JSON\.stringify|JSON\.stringify\([^)]*latitude/);
});

test("there is no server endpoint that takes a family member's position for to-dos", () => {
  expect(raw("src/routes/careTodos.js")).not.toMatch(/nearby/);
});
