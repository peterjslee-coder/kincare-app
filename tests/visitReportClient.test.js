// v1.108.0 — the visit report's client half, rendered rather than grepped, plus the server's
// answer checker run directly.
const fs = require("fs");
const path = require("path");
const babel = require("@babel/core");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { checkAnswers, CATALOG } = require("../src/utils/visitReport");

const src = fs.readFileSync(path.join(__dirname, "..", "public", "js", "components", "VisitReport.js"), "utf8");
const compiled = babel.transformSync(src, { presets: [["@babel/preset-react"]], configFile: false }).code;
function load() {
  const win = {};
  const useState = (init) => [init, () => {}];
  new Function("window", "React", "useState", compiled)(win, React, useState);
  return win;
}

const opts = (topic) => [...CATALOG[topic].options.map((o) => ({ ...o, concern: !!o.concern })), { value: "na", label: "Didn't come up" }];
const form = {
  rowCount: 3,
  groups: [
    { id: "meals", label: "Meals & drinks", rows: [
      { key: "meal|lunch", topic: "meal", ref: "lunch", label: "How much did Betty eat at lunch?", short: "Lunch", options: opts("meal"),
        followUp: "Betty ate only a little at lunch on Tuesday. How was lunch today?" },
      { key: "fluids|", topic: "fluids", ref: "", label: "Did Betty drink enough?", short: "Drinks", options: opts("fluids") },
    ] },
    { id: "meds", label: "Medications & appointments", rows: [
      { key: "med|t1:0", topic: "med", ref: "t1:0", label: "Morning pills · 10:00 AM", short: "Morning pills", options: opts("med"), prefill: "taken", alreadyRecorded: true },
    ] },
  ],
};

test("prefill fills only the dose already checked off", () => {
  const w = load();
  expect(w.visitReportInitial(form)).toEqual({ "med|t1:0": { value: "taken", note: "" } });
});

test("missing lists every row without a value; the payload carries only answered rows", () => {
  const w = load();
  const answers = { "meal|lunch": { value: "na" }, "med|t1:0": { value: "taken" } };
  expect(w.visitReportMissing(form, answers).map((r) => r.key)).toEqual(["fluids|"]);
  expect(w.visitReportPayload(form, answers)).toEqual([
    { topic: "meal", ref: "lunch", value: "na", note: undefined },
    { topic: "med", ref: "t1:0", value: "taken", note: undefined },
  ]);
});

test("the form draws every row, its follow-up, 'Didn't come up', and flags a blank row when asked", () => {
  const w = load();
  const html = renderToStaticMarkup(React.createElement(w.VisitReportForm, {
    form, answers: { "med|t1:0": { value: "taken" } }, onChange: () => {}, showMissing: true,
  }));
  expect(html).toContain("How much did Betty eat at lunch?");
  expect(html).toContain("Betty ate only a little at lunch on Tuesday");
  expect(html).toContain("already checked off");
  expect((html.match(/Didn(’|&#x27;|')t come up/g) || []).length).toBeGreaterThanOrEqual(3);
  expect(html).toContain("1 of 3");
  expect((html.match(/Tap an answer/g) || []).length).toBe(2);
});

test("the family card shows answers, concerns and what changed", () => {
  const w = load();
  const html = renderToStaticMarkup(React.createElement(w.VisitReportCard, {
    summaryText: "Betty had a quiet day.",
    report: { concerns: 1, groups: [{ id: "meals", label: "Meals & drinks", items: [
      { topic: "meal", ref: "lunch", label: "Lunch", answer: "A little", concern: true, changedFrom: "All of it", note: "Said she wasn't hungry" },
    ] }] },
  }));
  expect(html).toContain("1 to look at");
  expect(html).toContain("Betty had a quiet day.");
  expect(html).toContain("last visit: All of it");
  expect(html).toContain("Said she wasn");
});

test("the server refuses unknown values and blank rows, and trims notes", () => {
  const r = checkAnswers(form, [
    { topic: "meal", ref: "lunch", value: "delicious" },
    { topic: "fluids", ref: "", value: "good", note: `  ${"x".repeat(600)}  ` },
  ]);
  expect(r.ok).toBe(false);
  expect(r.missing).toEqual(["Lunch", "Morning pills"]);
  expect(r.clean).toHaveLength(1);
  expect(r.clean[0].note).toHaveLength(500);
});

test("the AI is told to word, never to advise", () => {
  const server = fs.readFileSync(path.join(__dirname, "..", "src", "utils", "visitReport.js"), "utf8");
  expect(server).toMatch(/Never give medical, health or care advice/);
  // and the family view never shows the summary's "suggestions" (advice)
  const routes = fs.readFileSync(path.join(__dirname, "..", "src", "routes", "sessions.js"), "utf8");
  expect(routes).toMatch(/visitSummaryText = JSON\.parse\(visitLog\.ai_summary\)\.summary/);
});
