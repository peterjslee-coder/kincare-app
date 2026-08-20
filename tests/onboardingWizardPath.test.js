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
const { OnboardingRouteHeader } = win;

const html = (step, idSubmitted = false) =>
  renderToStaticMarkup(React.createElement(OnboardingRouteHeader, { step, idSubmitted }));

const text = (step, idSubmitted = false) =>
  html(step, idSubmitted).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

describe("the header draws the whole route, not this wizard's share of it", () => {
  test("all three legs are visible from the very first screen", () => {
    // Property 1: you can see the end from the beginning. On screen one she could previously
    // see nine dashes and no hint that a second list existed.
    const t = text(1);
    expect(t).toContain("Who you are");
    expect(t).toContain("What you bring");
    expect(t).toContain("How you work");
  });

  test("it counts jobs, and there are thirteen of them", () => {
    expect(text(1)).toMatch(/13 things in all/);
  });

  test("the count only ever goes down as she walks", () => {
    const left = (step) => Number(text(step).match(/(\d+) left/)[1]);
    let previous = Infinity;
    for (let step = 1; step <= 8; step++) {
      expect(left(step)).toBeLessThanOrEqual(previous);
      previous = left(step);
    }
    expect(left(8)).toBeLessThan(left(1));
  });

  test("dashboard work is named in the wizard, not sprung afterwards", () => {
    // Property 4. "Where your pay lands" and "The safety check" live on the dashboard, and she
    // now reads them on screen one instead of meeting them after a congratulations screen.
    const t = text(1);
    expect(t).toContain("Where your pay lands");
    expect(t).toContain("The safety check");
  });

  test("the leg she is in opens; the others stay named but collapsed", () => {
    // Property 3 at the leg level: one leg open at a time. A collapsed leg still NAMES its
    // items — on one dim line, joined — because a leg showing only a count tells her how many
    // surprises are coming rather than what they are.
    const joined = "Certifications · Your training programme";
    expect(text(1)).toContain(joined);
    expect(text(6)).not.toContain(joined);
    expect(text(6)).toContain("Certifications");
  });

  test("finished items stay on screen, ticked", () => {
    // Property 2: finished steps shrink, they do not vanish. This is what stops "I log in and
    // have to remember what I already did".
    const t = text(3);
    expect(t).toContain("Create your account");
    expect(t).toContain("The paperwork");
    expect(html(3)).toMatch(/✓/);
  });

  test("screen 4 stays in leg 1 even though it feeds a leg 3 job", () => {
    // It collects legal name, DOB and SSN-4 for the safety check. Jumping the header to "How
    // you work" and then walking back to "What you bring" is exactly the quest feeling.
    const t = text(4);
    expect(t).toContain("About you");
    // Still leg 1: leg 2 is collapsed to its one joined line, not opened.
    expect(t).toContain("Certifications · Your training programme");
    expect(text(5)).not.toContain("Certifications · Your training programme");
  });

  test("a submitted ID reads as with us, not as unfinished", () => {
    // Since v1.105.112 this is every caregiver's normal case, and the wizard is where she
    // first meets it.
    expect(text(8, true)).toMatch(/A photo of your licence — with us now/);
  });
});

describe("the wizard stops counting screens at her", () => {
  test("the nine-segment progress bar is gone", () => {
    expect(wizardCode).not.toMatch(/Array\.from\(\{ length: TOTAL_STEPS \}/);
  });

  test('no "Step 7 of 9"', () => {
    expect(wizardSrc).not.toMatch(/Step \{step\} of \{TOTAL_STEPS\}/);
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
