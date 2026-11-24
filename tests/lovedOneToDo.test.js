// v1.121.0 (Batch 2 step 3) — Betty's "To do": one list grouped by when. Pinning the grouping
// rule (a late dose is never "later"), the render order, and that the setup and the to-dos
// are each shown once.
const fs = require("fs");
const path = require("path");
const babel = require("@babel/core");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

const src = fs.readFileSync(path.join(__dirname, "..", "public", "js", "components", "CareTasks.js"), "utf8");
const compiled = babel.transformSync(src, { presets: [["@babel/preset-react"]], configFile: false }).code
  // Rows and the setup card live in this same file, so a global stub can't shadow them. Rename
  // the local bindings; every use in the file then resolves to the global stub.
  .replace("const CareTaskNextUpRow = window.CareTaskNextUpRow =", "const __realNextUpRow = window.CareTaskNextUpRow =")
  .replace("const CareTasksSection = window.CareTasksSection =", "const __realTasksSection = window.CareTasksSection =");
if (!compiled.includes("__realNextUpRow") || !compiled.includes("__realTasksSection")) {
  throw new Error("stub hooks did not apply — the component names moved; update this test");
}

function load(states = []) {
  const win = {};
  let i = 0;
  const useState = (init) => { const v = i < states.length ? states[i] : init; i += 1; return [v, () => {}]; };
  const noop = () => {};
  const TimezoneHelper = {
    formatTime: (t) => t, getToday: () => "2026-10-15", DEFAULT_TZ: "America/New_York",
    buildDateTime: () => new Date(Date.now() + 5 * 3600e3), realNowMs: () => Date.now(),
  };
  const useStickySection = (k, d) => [d, noop];
  new Function("window", "React", "useState", "useEffect", "useRef", "useToast", "apiFetch",
    "TimezoneHelper", "useStickySection", compiled)(
    win, React, useState, noop, (v) => ({ current: v }), () => ({ showToast: noop }), async () => ({ ok: false }),
    TimezoneHelper, useStickySection);
  return win;
}

const NOW = Date.parse("2026-10-15T16:00:00Z");
const occ = (id, minsFromNow, status = "pending", extra = {}) => ({
  id, title: `Task ${id}`, task_type: "care", status, due_at: new Date(NOW + minsFromNow * 60000).toISOString(),
  occ_time: `${String(10 + Math.floor((minsFromNow + 600) / 60) % 14).padStart(2, "0")}:00`, ...extra,
});

describe("lovedOneToDoBuckets", () => {
  const { lovedOneToDoBuckets } = load();

  test("overdue and due within two hours are Now; later is Later; done/skipped are Done", () => {
    const b = lovedOneToDoBuckets([
      occ("late", -180), occ("soon", 90), occ("evening", 300), occ("took", -60, "done"), occ("skip", -30, "skipped"),
    ], [], NOW);
    expect(b.now.map((r) => r.occ.id).sort()).toEqual(["late", "soon"]);
    expect(b.later.map((r) => r.occ.id)).toEqual(["evening"]);
    expect(b.done.map((r) => r.occ.id)).toEqual(["took", "skip"]);
  });

  test("a row with an unreadable due time is Now, never hidden in Later", () => {
    const b = lovedOneToDoBuckets([{ id: "x", status: "pending", due_at: null }], [], NOW);
    expect(b.now).toHaveLength(1);
  });

  test("appointments: all-day and soon are Now, this evening is Later", () => {
    const b = lovedOneToDoBuckets([], [
      { id: "allday", event_time: null, __untilMs: -Infinity },
      { id: "soon", event_time: "13:00", __untilMs: 3600e3 },
      { id: "late", event_time: "18:00", __untilMs: 6 * 3600e3 },
      { id: "started", event_time: "09:00", __untilMs: -2 * 3600e3 },
    ], NOW);
    expect(b.now.map((r) => r.ev.id).sort()).toEqual(["allday", "soon", "started"]);
    expect(b.later.map((r) => r.ev.id)).toEqual(["late"]);
  });
});

describe("LovedOneToDo render", () => {
  // Stubs for the rows and lists this composes, so the test reads the arrangement.
  const render = (group, events = []) => {
    const stubs = {
      CareTaskNextUpRow: ({ occ }) => React.createElement("i", null, `task:${occ.id}`),
      CareEventNextUpRow: ({ ev }) => React.createElement("i", null, `event:${ev.id}`),
      CareTodoList: ({ heading }) => React.createElement("i", null, `todos:${heading}`),
      CareTasksSection: (p) => React.createElement("i", null, `setup:${p.title}:${p.hideTodos ? "notodos" : "todos"}:${p.foldKey}:${p.defaultOpen}`),
    };
    Object.assign(global, stubs, { CareTaskSync: { onChange: () => () => {} } });
    const w2 = load([group, events, true, false, null, null, 0]);
    return renderToStaticMarkup(React.createElement(w2.LovedOneToDo, { recipientId: "r1", recipientFirstName: "Jane" }));
  };
  afterAll(() => { for (const k of ["CareTaskNextUpRow", "CareEventNextUpRow", "CareTodoList", "CareTasksSection", "CareTaskSync"]) delete global[k]; });

  test("Now, then Later today, then Next visit, then Done today, then the setup fold", () => {
    const realNow = Date.now;
    Date.now = () => NOW;
    try {
      const html = render({ careRecipientId: "r1", occurrences: [occ("a", -10), occ("b", 300), occ("c", -60, "done")] });
      const pos = (s) => { const i = html.indexOf(s); expect(i).toBeGreaterThan(-1); return i; };
      expect(pos("task:a")).toBeLessThan(pos("Later today"));
      expect(pos("Later today")).toBeLessThan(pos("task:b"));
      expect(pos("task:b")).toBeLessThan(pos("todos:Next visit"));
      expect(pos("todos:Next visit")).toBeLessThan(pos("Done today (1)"));
      expect(pos("Done today (1)")).toBeLessThan(pos("setup:Recurring tasks"));
      // Done rows stay folded until asked for.
      expect(html).not.toContain("task:c");
      // The setup fold doesn't repeat the to-dos, and starts folded under its own key.
      expect(html).toContain("setup:Recurring tasks:notodos:lovedOne.careTasksSetup:false");
      expect(html.match(/<i>todos:/g)).toHaveLength(1);
    } finally { Date.now = realNow; }
  });

  test("an empty day says so in Jane's name, and still shows the to-dos and setup", () => {
    const html = render(null);
    expect(html).toContain("Nothing left on Jane’s list today.");
    expect(html).toContain("todos:Next visit");
    expect(html).toContain("setup:Recurring tasks");
    expect(html).not.toContain("Later today");
  });
});
