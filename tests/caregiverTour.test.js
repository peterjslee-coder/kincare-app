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
    const t = text(React.createElement(CaregiverTourCard, { firstName: "Tina" }));
    expect(t).toContain("That's everything, Tina. You're set up.");
    expect(t).toContain("Show me around");
    expect(t).toContain("Later");
  });
  // ─── v1.106.44 — the two tests below asserted the behaviour Pete reported as the bug ───
  //
  // "Tina's app seems to be stuck on showing her the tour again. If she takes the tour or
  // skips the tour, it should disappear from the home screen until she goes to her account."
  //
  // Both remnants were designed on purpose and both were wrong in the same way. "Later" left
  // a one-line strip offering the tour, forever. "Done" left the five-cell map with a "Tour
  // again" button until her first COMPLETED visit — and a caregiver whose first visit has not
  // happened yet cannot reach that condition, so for Tina it never went away. From where she
  // is standing, answering yes and answering no both look like being asked again.
  test("'later' retires it from Home", () => {
    win.__uiPrefs = { "tour.caregiver.later": true };
    expect(text(React.createElement(CaregiverTourCard, { firstName: "Tina" }))).toBe("");
  });
  test("done retires it too — immediately, not after some later milestone", () => {
    win.__uiPrefs = { "tour.caregiver.done": 1 };
    expect(text(React.createElement(CaregiverTourCard, { firstName: "Tina" }))).toBe("");
  });
  test("but an unanswered card still offers, so this retires the remnants and not the tour", () => {
    win.__uiPrefs = {};
    const t = text(React.createElement(CaregiverTourCard, { firstName: "Tina" }));
    expect(t).toContain("Show me around");
  });
});

describe("wired in", () => {
  test("the hub shows the card only when First Steps are resolved, empty, and not a demo", () => {
    const hub = code("public/js/components/CaretakerHub.js");
    expect(hub).toContain("{firstStepsResolved && !showFirstSteps && !profile.isDemo && typeof CaregiverTourCard !== 'undefined' && (");
    // v1.106.23 — the anchor is dynamic now, the same way FindWork's 'job-first' is: Up Next
    // was split so a session inside its check-in window pins above the offers that buried
    // Tina's check-in. Exactly one of the two blocks carries the anchor. The exclusivity is
    // asserted behaviourally in tests/caregiverHomeOrder.test.js — here we only pin that the
    // attribute still exists to be found, because the tour queries the live DOM for it.
    expect(hub).toContain("data-tour={tour ? 'up-next' : undefined}");
    expect(hub).toContain("tour: upNextSplit.rest.length === 0");
    expect(hub).toContain("tour: upNextSplit.rest.length > 0");
  });
  test("app.js hosts it above everything and starts it from anywhere", () => {
    const app = code("public/js/app.js");
    expect(app).toContain("window.__startCaregiverTour = () => setTourOpen(true);");
    expect(app).toContain("{tourOpen && role === 'caregiver' && typeof CaregiverTour !== 'undefined' && (");
    expect(app).toContain("data-tour={`nav-${item.id}`}");
  });
  test("the anchors it lights exist, and Help can replay it", () => {
    expect(code("public/js/components/FindWork.js")).toContain("data-tour={filteredRequests[0] === s ? 'job-first' : undefined}");
    expect(code("public/js/components/Messages.js")).toContain('data-tour="conversation-row"');
    expect(code("public/js/components/HelpPage.js")).toContain("'Show me around again'");
    expect(code("public/js/uiPrefs.js")).toContain("window.__setUiPref = (key, value) => {");
    expect(code("scripts/build-client.js")).toContain('"js/components/CaregiverTour.js"');
  });
});
