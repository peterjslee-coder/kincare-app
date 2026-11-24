// One-time to-dos, rendered. (v1.109.9)
//
// e4cd314a — "There needs to be a to-do option… Something that reminds the next person that
// shows up at her house to accomplish a task."

const fs = require("fs");
const path = require("path");
const babel = require("@babel/core");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

const read = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");
const compile = (src) => babel.transformSync(src, { presets: [["@babel/preset-react"]], configFile: false }).code;

function load(file, exportName, seeds, extra = {}) {
  const win = { __currentUserId: "me", ...extra.window };
  let i = 0;
  const useState = (init) => {
    const v = i < seeds.length ? seeds[i] : init;
    i += 1;
    return [v, () => {}];
  };
  const shim = { ...React, useState, useEffect: () => {} };
  const TimezoneHelper = { DEFAULT_TZ: "America/New_York", getDateLabel: (d) => `on ${d}`, formatTime: (t) => t };
  const names = ["window", "React", "useState", "useEffect", "useCallback", "useRef", "useToast", "apiFetch", "TimezoneHelper", ...Object.keys(extra.globals || {})];
  const fn = new Function(...names, compile(read("public", "js", "components", file)) + `\nreturn window.${exportName};`);
  return fn(win, shim, useState, () => {}, React.useCallback, React.useRef, () => ({ showToast: () => {} }),
    async () => ({ ok: true, json: async () => ({}) }), TimezoneHelper, ...Object.values(extra.globals || {}));
}

const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

describe("the to-do list", () => {
  const todo = (over = {}) => ({
    id: "t1", title: "Lock her stove against the wall", details: "Bracket is in the drawer",
    created_by: "pete", created_by_first_name: "Pete", created_at: "2026-10-12T14:00:00Z",
    completed_at: null, ...over,
  });
  const group = (over = {}) => ({
    careRecipientId: "betty", recipientFirstName: "Betty", viaVisit: false,
    canAdd: true, canDo: true, canRemove: true, open: [todo()], done: [], ...over,
  });
  // seeds: groups, doneOpen, finishing, note, busy, adding
  const draw = (groups, props = {}, rest = []) => {
    const C = load("CareTodos.js", "CareTodoList", [groups, ...rest]);
    return renderToStaticMarkup(React.createElement(C, props));
  };

  test("an open to-do shows what, details, who added it, and one way to finish it", () => {
    const html = draw([group()]);
    const t = text(html);
    expect(t).toContain("Lock her stove against the wall");
    expect(t).toContain("Bracket is in the drawer");
    expect(t).toContain("Added by Pete");
    expect(t).toContain("I did this");
    // No clock: nothing to be late for.
    expect(t).not.toMatch(/overdue|missed|due /i);
  });

  test("the visiting caregiver can finish but not remove", () => {
    const t = draw([group({ viaVisit: true, canAdd: false, canRemove: false })]);
    expect(text(t)).toContain("I did this");
    expect(t).not.toMatch(/aria-label="Remove/);
  });

  test("done to-dos fold into a collapsed Done list with who and when", () => {
    const done = todo({ id: "t2", title: "Take the rug out", completed_at: "2026-10-12T15:00:00Z",
      completed_by_user_id: "tina", completed_by_first_name: "Tina", completion_note: "Garage" });
    const closed = text(draw([group({ open: [], done: [done] })]));
    expect(closed).toContain("Done (1)");
    expect(closed).not.toContain("Take the rug out");
    const opened = text(draw([group({ open: [], done: [done] })], {}, [true]));
    expect(opened).toContain("Take the rug out");
    expect(opened).toContain("Tina");
    expect(opened).toContain("Garage");
    expect(opened).toContain("Undo");
  });

  test("hideWhenNothingOpen draws nothing when nothing is waiting", () => {
    expect(draw([group({ open: [] })], { hideWhenNothingOpen: true })).toBe("");
    expect(draw([], { hideWhenNothingOpen: true })).toBe("");
  });

  test("the note box opens on 'I did this'", () => {
    const t = text(draw([group()], {}, [false, "t1", ""]));
    expect(t).toContain("Mark done");
  });
});

describe("the create flow asks which kind first", () => {
  const tasks = read("public", "js", "components", "CareTasks.js");
  test("a new task offers Recurring vs To-do; an edit does not", () => {
    expect(tasks).toMatch(/!existing && typeof CareTaskKindChoice !== 'undefined'/);
    expect(tasks).toMatch(/if \(!existing && kind === 'todo' && typeof CareTodoForm !== 'undefined'\)/);
  });
  test("the to-do form asks only a title and details", () => {
    const C = load("CareTodos.js", "CareTodoForm", []);
    const t = text(renderToStaticMarkup(React.createElement(C, { recipientId: "b", recipientFirstName: "Betty", onClose: () => {} })));
    expect(t).toContain("What needs doing?");
    expect(t).toContain("Details (optional)");
    expect(t).not.toMatch(/When|Whose job|Every day|not checked off/);
  });
  test("it is drawn where the team and the visiting caregiver look", () => {
    expect(tasks).toMatch(/<CareTodoList recipientIds=\{\[recipientId\]\} heading="To-dos for the next visit" showAdd \/>/);
    expect(tasks).toMatch(/<CareTodoList recipientIds=\{recipientIds\} heading="To-dos for this visit" hideWhenNothingOpen \/>/);
    expect(read("public", "js", "components", "Dashboard.js")).toMatch(/<CareTodoList heading="To-dos for the next visit" hideWhenNothingOpen framed \/>/);
    expect(read("public", "js", "components", "CaretakerHub.js")).toMatch(/React\.createElement\(CareTodoList, \{/);
    expect(read("scripts", "build-client.js")).toMatch(/js\/components\/CareTodos\.js/);
  });
});
