// The app-level banner has a way out. (v1.105.101)
//
// Tyler, brand new, reported "Welcome to InPlace!" would not go away "at all or when navigating
// to new screens."
//
// It is not a modal. It is the verifyMessage banner in app.js, rendered above renderPage(), so
// it is app-level state and no page change touches it. It gets set the instant he accepts the
// legal docs — which happens BEHIND the full-screen DisclaimerModal, so he never saw it appear.
//
// And the only dismissal was a bare 16px "×" with no padding: roughly a 10x18px tap target
// against Apple's 44x44 minimum. "Does not go away at all" was literally true. He was tapping
// it and missing.

const fs = require("fs");
const path = require("path");
const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
const app = read("public/js/app.js");
const login = read("public/js/components/LoginPage.js");

describe("a success banner clears itself", () => {
  test("there is a timer, and it only fires for success", () => {
    const eff = app.slice(app.indexOf("if (!verifyMessage || verifyMessage.type !== 'success'"));
    expect(eff.slice(0, 300)).toMatch(/setTimeout\(\(\) => setVerifyMessage\(null\), 6000\)/);
  });

  test("an error banner is never auto-cleared", () => {
    // An error is the only thing on screen telling the user what went wrong.
    expect(app).toMatch(/verifyMessage\.type !== 'success'/);
    expect(app).not.toMatch(/verifyMessage\.type === 'error'[^\n]*setTimeout/);
  });

  test("it does not fire on the login page", () => {
    // "Email verified! Sign in to continue." is an instruction they may still be reading.
    expect(app).toMatch(/appState !== 'app'\) return;\n    const t = setTimeout/);
  });

  test("the timer is cleaned up", () => {
    const eff = app.slice(app.indexOf("if (!verifyMessage || verifyMessage.type !== 'success'"));
    expect(eff.slice(0, 400)).toMatch(/return \(\) => clearTimeout\(t\)/);
  });

  test("the effect is declared above every early return", () => {
    // v1.105.87: a hook after a conditional return white-screens the app.
    const hook = app.indexOf("if (!verifyMessage || verifyMessage.type !== 'success'");
    const firstEarlyReturn = app.indexOf("if (appState === 'platform-onboarding'");
    expect(hook).toBeGreaterThan(0);
    expect(hook).toBeLessThan(firstEarlyReturn);
  });
});

describe("the dismiss button can actually be hit", () => {
  test("the in-app banner's × meets the 44x44 minimum", () => {
    const btn = app.slice(app.indexOf("onClick={() => setVerifyMessage(null)} aria-label"));
    expect(btn.slice(0, 400)).toMatch(/minWidth: '44px', minHeight: '44px'/);
  });

  test("the login banner's × meets it too", () => {
    const btn = login.slice(login.indexOf("onClick={onDismissBanner} aria-label"));
    expect(btn.slice(0, 400)).toMatch(/minWidth: '44px', minHeight: '44px'/);
  });

  test("both are labelled for screen readers", () => {
    expect(app).toMatch(/setVerifyMessage\(null\)\} aria-label="Dismiss"/);
    expect(login).toMatch(/onClick=\{onDismissBanner\} aria-label="Dismiss"/);
  });

  test("no bare-× dismiss survives on either banner", () => {
    // The exact shape that failed: fontSize 16 with no min tap size.
    expect(app).not.toMatch(/setVerifyMessage\(null\)\} style=\{\{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px'/);
    expect(login).not.toMatch(/onDismissBanner\} style=\{\{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px'/);
  });
});
