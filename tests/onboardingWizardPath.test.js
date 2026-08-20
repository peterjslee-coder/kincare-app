// The wizard shows the whole path, and stops celebrating in the middle of it. (v1.105.115)
//
// The nine-segment progress bar measured SCREENS, and the wizard was never the whole route —
// seven more things waited on the dashboard and nothing here said so. A bar that fills as you
// walk cannot answer "how much is left?" when the thing filling it is not the thing left.
//
// The header is a real component rendered here, not a string match: React and react-dom are
// already dependencies, and renderToStaticMarkup needs no DOM. The parts that are genuinely
// copy — the handoff wording — are checked against source, which is all a string can honestly
// tell you.

const fs = require("fs");
const path = require("path");
const babel = require("@babel/core");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

const read = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");
const routeSrc = read("public", "js", "onboardingRoute.js");
const wizardSrc = read("public", "js", "components", "CaregiverOnboarding.js");
// Comments quote the copy they replaced, so assertions about what the wizard SAYS run
// against code only — same approach as threeStateChecklist.test.js.
const wizardCode = wizardSrc
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .filter((l) => !l.trim().startsWith("//"))
  .join("\n");

// public/js is one concatenated scope with no module system, so rebuild the slice we need:
// the route module, then the header component that reads it.
const headerSrc = wizardSrc.slice(0, wizardSrc.indexOf("// ─── Caregiver Onboarding Flow ───"));
const compiled = babel.transformSync(routeSrc + "\n;\n" + headerSrc, {
  presets: [["@babel/preset-react"]],
  configFile: false,
}).code;
const win = {};
new Function("window", "React", compiled)(win, React);
const { OnboardingPath } = win;

const html = (step, slot, idSubmitted = false) =>
  renderToStaticMarkup(React.createElement(OnboardingPath, { step, slot, idSubmitted })) || "";

const text = (step, slot, idSubmitted = false) =>
  html(step, slot, idSubmitted).replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();

const done = (step, sub) => text(step, "done", sub);
const ahead = (step, sub) => text(step, "ahead", sub);

describe("the path is all there, and quiet about it", () => {
  // v1.105.115 drew the whole route as legs and rows. Pete: "we don't want this to be a
  // catalogue in your face of how hard it is to sign up." v1.105.118 keeps every property and
  // strips the weight — finished work struck through at 11px, one open step, the rest a single
  // grey line of names.

  test("every one of the thirteen is readable on screen one", () => {
    // Property 1, and the reason the ahead line is NOT truncated: "…and 6 more" would be
    // quieter and would also reintroduce "there keeps being more steps".
    const t = ahead(1);
    expect(t).toContain("The paperwork");
    expect(t).toContain("A photo of your licence");
    expect(t).toContain("Where your pay lands");
    expect(t).toContain("Lock down your account");
    expect(t).not.toMatch(/more$/);
  });

  test("dashboard work is named in the wizard, not sprung afterwards", () => {
    // Property 4. She reads "The safety check" on screen one instead of meeting it after a
    // congratulations screen.
    expect(ahead(1)).toContain("The safety check");
  });

  test("it counts jobs, and there are thirteen of them", () => {
    expect(ahead(1)).toMatch(/13 things left/);
  });

  test("the count only ever goes down as she walks", () => {
    const left = (step) => Number(ahead(step).match(/(\d+) things? left/)[1]);
    let previous = Infinity;
    for (let step = 1; step <= 8; step++) {
      expect(left(step)).toBeLessThanOrEqual(previous);
      previous = left(step);
    }
    expect(left(8)).toBeLessThan(left(1));
  });

  test("nothing is finished on screen one, so nothing is struck through", () => {
    expect(html(1, "done")).toBe("");
  });

  test("finished work stays visible, struck through, on one line", () => {
    // Property 2: finished steps shrink, they do not vanish. This is what stops "I log in and
    // have to remember what I already did" — and it costs one line, not eight rows.
    const markup = html(4, "done");
    expect(markup).toContain("line-through");
    expect(markup).toContain("11px");
    const t = done(4);
    expect(t).toContain("Create your account");
    expect(t).toContain("The paperwork");
    expect(t).toContain("About you");
  });

  test("what she is doing right now is not listed among what is left", () => {
    // Sited by wizardStep, not by route.current: screen 4 collects safety-check details, and
    // the first thing she has LEFT is not what she is currently looking at.
    expect(ahead(6)).not.toContain("Your training programme");
    expect(ahead(6)).toContain("Documents");
  });

  test("a submitted ID is counted with us, and never among the things left", () => {
    // Since v1.105.112 this is every caregiver's normal case. Listing her own finished ID as
    // outstanding work is the sentence this whole track exists to delete.
    const t = ahead(8, true);
    expect(t).toMatch(/1 with us/);
    expect(t).not.toContain("A photo of your licence");
  });

  test("the animation is opt-out, and only the two path classes carry it", () => {
    const css = fs.readFileSync(path.join(__dirname, "..", "public", "css", "styles.css"), "utf8");
    expect(css).toMatch(/@keyframes ipPathStepIn/);
    expect(css).toMatch(/@keyframes ipPathDoneIn/);
    // A caregiver on a five-year-old Android should not pay for delight.
    const reduced = css.slice(css.indexOf("prefers-reduced-motion", css.indexOf("ipPathStepIn")));
    expect(reduced.slice(0, 200)).toMatch(/\.ip-path-step, \.ip-path-done \{ animation: none; \}/);
    // Class-scoped: a bare element rule here would reach every component in the app.
    expect(css).not.toMatch(/\n\s*div \{[^}]*ipPath/);
  });
});

describe("the wizard stops counting screens at her", () => {
  test("the nine-segment progress bar is gone", () => {
    expect(wizardCode).not.toMatch(/Array\.from\(\{ length: TOTAL_STEPS \}/);
  });

  test('no "Step 7 of 9"', () => {
    expect(wizardCode).not.toMatch(/Step \{step\} of \{TOTAL_STEPS\}/);
  });

  test("stepLabels still covers all nine screens", () => {
    // Regression guard for v1.105.112: it had eight keys for nine screens and the last screen
    // rendered "Step 9 of 9 — undefined".
    const block = wizardSrc.slice(wizardSrc.indexOf("const stepLabels = {"));
    const labels = block.slice(0, block.indexOf("};"));
    for (let n = 1; n <= 9; n++) expect(labels).toMatch(new RegExp("\\n\\s*" + n + ": '"));
  });
});

describe("the handoff replaces the finish line in the middle", () => {
  const step9 = wizardCode.slice(wizardCode.indexOf("{step === 9 &&"));

  test("no confetti, no 'Welcome to InPlace!'", () => {
    // The single screen that created the quest: a celebration, then a list of seven unnamed
    // things on the other side of the button.
    expect(step9).not.toContain("Welcome to InPlace!");
    expect(step9).not.toContain("&#127881;");
  });

  test("it names what is left, from the same route the header uses", () => {
    expect(step9).toMatch(/resolveRoute\(/);
    expect(step9).toMatch(/things left, all on your dashboard/);
    expect(step9).toMatch(/handoff\.legs\.filter\(\(leg\) => leg\.surface === 'hub'\)/);
  });

  test("the vague, and untrue, 'what happens next' list is gone", () => {
    // Payment setup and background checks were described as "available soon". They are
    // available immediately, and telling her to wait for them makes onboarding feel longer
    // than it is.
    expect(wizardCode).not.toContain("What happens next");
    expect(wizardCode).not.toContain("will be available soon");
  });
});

describe("the wizard never says she is verified", () => {
  test("because since v1.105.112 nothing verifies her but a person", () => {
    // The server has sent `pendingReview: true` and "never tell her she is verified" since
    // that release. This screen was the last surface still saying it — and she read it here,
    // then found the same step unfinished on her dashboard.
    expect(wizardCode).not.toContain("Identity verified!");
    expect(wizardCode).not.toContain("An admin will review and approve your identity");
  });

  test("what it says instead is warm, and the same for everyone", () => {
    // Pete: "Looking good (Julia)! Verification doesn't take long. Let's continue." She has
    // just photographed her own face; the answer to that should not be a status label.
    expect(wizardCode).toMatch(/Looking good\{form\.firstName/);
    expect(wizardCode).toMatch(/Verification doesn/);
    expect(wizardCode).toMatch(/s continue/);
  });

  test("the automated verdict does not change what she reads", () => {
    // v1.105.112 established that nothing gates on the AI recommendation. Branching the copy
    // on `matched` would put that verdict back in front of her by the back door, in the one
    // place she is least able to argue with it.
    const box = wizardCode.slice(wizardCode.indexOf("{idVerifyResult && ("));
    expect(box.slice(0, box.indexOf("{/* Buttons */}"))).not.toContain("idVerifyResult.matched");
  });

  test("the handoff still tells her where the ID went", () => {
    expect(wizardCode).toMatch(/Your ID is with us/);
    expect(wizardCode).toMatch(/we\\u2019ll review it and reach out if we have any questions/);
  });
});

describe("colour says where you are", () => {
  // Pete: "let's get a little color in there. too much grey. little green strike through or
  // something." Green behind you, teal now, one orange dot, grey ahead — so the shape of the
  // path is legible before a word of it is.

  test("finished work is struck through IN GREEN, not grey", () => {
    const markup = html(4, "done");
    expect(markup).toContain("var(--color-success)");
    expect(markup).toContain("line-through");
    expect(markup).not.toContain("var(--text-tertiary)");
  });

  test("it dims with opacity rather than a paler green", () => {
    // --color-success is a different hue in dark mode (#4caf50 vs #2e7d32), so a hardcoded
    // soft green would only be right in one of them.
    expect(html(4, "done")).toMatch(/opacity:0?\.62/);
  });

  test("what is ahead stays grey", () => {
    // The temptation is to colour this line too, and that is exactly what would turn it back
    // into a catalogue. Grey is doing real work here.
    expect(html(1, "ahead")).toContain("var(--text-muted)");
  });

  test("work sitting with us is teal, because it is live", () => {
    expect(html(8, "ahead", true)).toContain("var(--role-color)");
  });

  test("exactly one warm dot exists, and it is on the open step", () => {
    // One per screen is what lets it be the only warm colour on the page.
    const label = wizardCode.slice(wizardCode.indexOf('className="ip-path-step"'));
    expect(label.slice(0, 700)).toContain("var(--accent-color)");
    const dots = (wizardCode.match(/background: 'var\(--accent-color\)', flexShrink: 0/g) || []);
    expect(dots).toHaveLength(1);
  });
});

describe("the dashboard descriptions stop reading like system text", () => {
  const hub = read("public", "js", "components", "CaretakerHub.js");

  test("they say what she does, not what we record", () => {
    expect(hub).not.toContain("Connect your bank account to receive payments for care sessions");
    expect(hub).not.toContain("Set up two-factor authentication or biometrics");
    expect(hub).not.toContain("Your selections help us match you to compatible clients");
    expect(hub).toContain("Connect your bank so families can pay you");
    expect(hub).toContain("Face unlock, or a code from your phone");
  });

  test("they say how long it takes, when it is short", () => {
    // "About a minute" removes more dread than any reassurance does.
    expect(hub).toMatch(/About a minute/);
    expect(hub).toMatch(/About two minutes/);
  });

  test("the money sentence still says where the money goes", () => {
    expect(hub).toMatch(/InPlace never sees them/);
  });

  test("the safety check copy is untouched", () => {
    // v1.105.63 — the waived / not-waived branch is a legal-adjacent distinction, not a tone
    // choice. Someone whose fee was waived once read "one-time $30 fee" above a warning to act.
    expect(hub).toMatch(/The \$30 fee has been waived for you/);
    expect(hub).toMatch(/one-time \$30 fee that is refunded after 10 completed sessions/);
  });
});
