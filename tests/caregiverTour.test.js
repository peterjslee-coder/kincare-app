// v1.105.194 — the caregiver's first-visit tour.
//
// Pete, Sep 12: "a guided walk-through of checking in and leaving notes and checking out. A
// quick click through hitting the right buttons as a tutorial." And: "yes on the location."
// Rendered for real (react-dom/server), not source-matched, wherever the claim is about what
// she reads. The two rules these tests exist to hold: the practice visit WRITES NOTHING, and
// the one real thing it does is ask the phone for location.

const fs = require("fs");
const path = require("path");
const babel = require("@babel/core");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { code } = require("./helpers/source");

const src = fs.readFileSync(path.join(__dirname, "..", "public", "js", "components", "CaregiverTour.js"), "utf8");
const compiled = babel.transformSync(src, { presets: [["@babel/preset-react"]], configFile: false }).code;
const win = { __uiPrefs: {} };
global.navigator = global.navigator || {};
new Function("window", "React", "navigator", compiled)(win, React, {});
const { CaregiverTour, CaregiverTourCard } = win;

const text = (el) => (renderToStaticMarkup(el) || "").replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/\u2019/g, "'").replace(/\s+/g, " ").trim();

describe("the tour", () => {
  test("opens on stop 1 with one sentence and a way out", () => {
    const t = text(React.createElement(CaregiverTour, { onNavigate: () => {}, onClose: () => {}, firstName: "Tina" }));
    expect(t).toContain("This is your day");
    expect(t).toContain("Skip tour");
    expect(t).toContain("Next");
    expect(t).not.toContain("Back"); // nothing behind her yet
  });

  test("has eight stops: three on real screens, four of practice, one map", () => {
    expect(src).toContain("{ id: 'home', page: 'dashboard'");
    expect(src).toContain("{ id: 'find-work', page: 'find-work'");
    expect(src).toContain("{ id: 'messages', page: 'messages'");
    for (const id of ["p-briefing", "p-checkin", "p-during", "p-checkout"]) expect(src).toContain(`{ id: '${id}', practice: true }`);
    expect(src).toContain("{ id: 'map' }");
  });

  test("the practice visit writes nothing — no fetch, no apiFetch, no CareTaskSync", () => {
    const c = code("public/js/components/CaregiverTour.js");
    expect(c).not.toMatch(/apiFetch\(/);
    expect(c).not.toMatch(/\bfetch\(/);
    expect(c).not.toMatch(/CareTaskSync\.write/);
    expect(c).not.toMatch(/localStorage/);
  });

  test("the one real thing: it asks the phone for location at check-in, and never reads the answer", () => {
    expect(src).toContain("navigator.geolocation.getCurrentPosition(");
    expect(src).toContain("() => setPin('pinned'),          // the coordinates are never read, never sent");
    expect(src).toContain("() => setPin('denied'),");
    // A "no" is explained, not punished.
    expect(src).toContain("Your phone said no. That’s okay for practice");
  });

  test("every practice screen is ribboned and says nothing is recorded", () => {
    expect(src).toContain(">Practice</div>");
    expect(src).toContain("Practice visit {'·'} nothing is recorded");
  });

  test("copy rules: reminder only on the task, never a live track, money says where it moves", () => {
    expect(src).toContain("reminder only");
    expect(src).toContain("it never advises on medication");
    expect(src).toContain("never a live track");
    expect(src).toContain("goes to your bank in 2{'–'}3 business days");
  });

  test("done or skipped is remembered on the account, and 'later' is forgotten", () => {
    expect(src).toContain("window.__setUiPref('tour.caregiver.done', Date.now()); window.__setUiPref('tour.caregiver.later', null);");
  });
});

describe("the card on Home", () => {
  test("offers once, where the First Steps list was", () => {
    win.__uiPrefs = {};
    const t = text(React.createElement(CaregiverTourCard, { firstName: "Tina", completedCount: 0 }));
    expect(t).toContain("That's everything, Tina. You're set up.");
    expect(t).toContain("Show me around");
    expect(t).toContain("Later");
  });
  test("'later' folds it to one line", () => {
    win.__uiPrefs = { "tour.caregiver.later": true };
    const t = text(React.createElement(CaregiverTourCard, { firstName: "Tina", completedCount: 0 }));
    expect(t).toContain("Two-minute tour of the app, whenever you like.");
    expect(t).not.toContain("That's everything");
  });
  test("done → the five-cell map until her first real visit, then nothing", () => {
    win.__uiPrefs = { "tour.caregiver.done": 1 };
    const t = text(React.createElement(CaregiverTourCard, { firstName: "Tina", completedCount: 0 }));
    expect(t).toContain("Where things live");
    for (const n of ["Home", "Find Work", "Messages", "Care Notes", "Account"]) expect(t).toContain(n);
    expect(text(React.createElement(CaregiverTourCard, { firstName: "Tina", completedCount: 1 }))).toBe("");
  });
});

describe("wired in", () => {
  test("the hub shows the card only when First Steps are resolved, empty, and not a demo", () => {
    const hub = code("public/js/components/CaretakerHub.js");
    expect(hub).toContain("{firstStepsResolved && !showFirstSteps && !profile.isDemo && typeof CaregiverTourCard !== 'undefined' && (");
    expect(hub).toContain('data-tour="up-next"');
  });
  test("app.js hosts it above everything and starts it from anywhere", () => {
    const app = code("public/js/app.js");
    expect(app).toContain("window.__startCaregiverTour = () => setTourOpen(true);");
    expect(app).toContain("{tourOpen && role === 'caregiver' && typeof CaregiverTour !== 'undefined' && (");
    expect(app).toContain("data-tour={`nav-${item.id}`}");
  });
  test("the anchors it lights exist, and Help can replay it", () => {
    expect(code("public/js/components/FindWork.js")).toContain('data-tour="jobs"');
    expect(code("public/js/components/Messages.js")).toContain('data-tour="conversations"');
    expect(code("public/js/components/HelpPage.js")).toContain("'Show me around again'");
    expect(code("public/js/uiPrefs.js")).toContain("window.__setUiPref = (key, value) => {");
    expect(code("scripts/build-client.js")).toContain('"js/components/CaregiverTour.js"');
  });
});
