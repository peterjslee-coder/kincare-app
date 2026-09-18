// v1.109.3 — the archive's client half: the history sheet, rendered, and the two helpers that
// turn a summary into the line Pete actually reads ("6 weeks · Aug 9 – Sep 16").
const fs = require("fs");
const path = require("path");
const babel = require("@babel/core");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

const src = fs.readFileSync(path.join(__dirname, "..", "public", "js", "components", "CareTasks.js"), "utf8");
const compiled = babel.transformSync(src, { presets: [["@babel/preset-react"]], configFile: false }).code;

// One scripted useState queue per render, so a component that loads in an effect can be
// rendered in its loaded state without a DOM or a fetch.
function load(states = []) {
  const win = {};
  let i = 0;
  const useState = (init) => { const v = i < states.length ? states[i] : init; i += 1; return [v, () => {}]; };
  const noop = () => {};
  const useEffect = noop;
  const useRef = (v) => ({ current: v });
  const useToast = () => ({ showToast: noop });
  const apiFetch = async () => ({ ok: false });
  const TimezoneHelper = { formatTime: (t) => t, getToday: () => "2026-09-18", DEFAULT_TZ: "America/New_York" };
  const useStickySection = (k, d) => [d, noop];
  new Function("window", "React", "useState", "useEffect", "useRef", "useToast", "apiFetch",
    "TimezoneHelper", "useStickySection", compiled)(
    win, React, useState, useEffect, useRef, useToast, apiFetch, TimezoneHelper, useStickySection);
  return win;
}

const HISTORY = {
  task: { id: "t1", title: "Amoxicillin", task_type: "medication", archived_at: "2026-09-16T14:00:00Z", archived_by_first_name: "Pete" },
  summary: {
    firstDue: "2026-08-09", lastDue: "2026-09-16", days: 39,
    done: 34, skipped: 2, missed: 3, pending: 0, answered: 39, doneRate: 87,
    people: [{ name: "Tina R", count: 30 }, { name: "Pete U", count: 4 }],
  },
  occurrences: [
    { id: "o1", dueDate: "2026-09-16", status: "done", by: "Tina R", note: "took it with breakfast" },
    { id: "o2", dueDate: "2026-09-15", status: "missed", by: null, note: null },
    { id: "o3", dueDate: "2026-09-14", status: "skipped", by: null, note: null },
  ],
};

test("careTaskDay reads a naive date in its own frame, not the browser's", () => {
  const w = load();
  // new Date('2026-09-16') is UTC midnight — anywhere west of Greenwich that renders as the 15th.
  expect(w.careTaskDay("2026-09-16")).toBe("Sep 16");
  expect(w.careTaskDay("2026-01-01", { weekday: "short" })).toBe("Thu, Jan 1");
  expect(w.careTaskDay(null)).toBe("");
  expect(w.careTaskDay("nonsense")).toBe("");
});

test("careTaskRan says how long it ran in units a person uses", () => {
  const w = load();
  expect(w.careTaskRan({ firstDue: "2026-08-09", lastDue: "2026-09-16", days: 39 })).toBe("6 weeks · Aug 9 – Sep 16");
  expect(w.careTaskRan({ firstDue: "2026-09-16", lastDue: "2026-09-16", days: 1 })).toBe("1 day · Sep 16");
  expect(w.careTaskRan({ firstDue: "2026-03-01", lastDue: "2026-09-16", days: 200 })).toBe("7 months · Mar 1 – Sep 16");
  expect(w.careTaskRan({ firstDue: null })).toBe(null);
  expect(w.careTaskRan(null)).toBe(null);
});

test("the history sheet shows how long, how much, and who — plus who removed it", () => {
  const w = load([HISTORY, false]);
  const html = renderToStaticMarkup(React.createElement(w.CareTaskHistorySheet, {
    task: { id: "t1", title: "Amoxicillin", task_type: "medication" }, onClose: () => {},
  }));
  expect(html).toContain("Amoxicillin");
  expect(html).toContain("6 weeks");
  expect(html).toContain("Done 34 of 39");
  expect(html).toContain("87%");
  expect(html).toContain("3 missed");
  expect(html).toContain("Tina R");
  expect(html).toContain("Removed Sep 16");
  expect(html).toContain("by Pete");
  // every occurrence, with its own word for what happened
  expect(html).toContain("took it with breakfast");
  expect(html).toContain("Missed");
  expect(html).toContain("Dismissed");
});

test("a task with nothing recorded says so rather than rendering an empty sheet", () => {
  const w = load([{ task: { id: "t1", title: "Vitamin D" }, summary: { firstDue: null, done: 0, skipped: 0, missed: 0, pending: 0, answered: 0, doneRate: null, people: [] }, occurrences: [] }, false]);
  const html = renderToStaticMarkup(React.createElement(w.CareTaskHistorySheet, {
    task: { id: "t1", title: "Vitamin D", task_type: "medication" }, onClose: () => {},
  }));
  expect(html).toContain("Nothing recorded yet");
  expect(html).toContain("Nothing was ever recorded for this one");
});

test("Remove says where it goes — archived, not deleted", () => {
  // Copy is the whole feature here: "remove" that silently keeps the record has to say so.
  expect(src).toContain("It moves to Archived");
  expect(src).toContain("everything already recorded stays");
  expect(src).toMatch(/Moved to Archived/);
  // and restore must come back paused, not live
  expect(src).toContain("Back on the list \\u2014 paused");
});
