// lint:client's fourth check — functions that are written but never wired to anything.
//
// A handler no button calls and a feature nobody switched on look identical from the outside.
// v1.105.72 found 22 of them, including six on the caregiver's own home screen, and one that a
// previous release had carefully edited without noticing it could not run.
//
// These tests pin the gate itself, not the findings: that it stays narrow enough to trust, that
// its escapes are deliberate, and that its baseline stays empty.

const fs = require("fs");
const path = require("path");

const REPO = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(REPO, "scripts", "lint-client.js"), "utf8");

describe("the gate is wired up at all", () => {
  test("no-unused-vars is enabled, with args off so parameters don't count", () => {
    expect(source).toMatch(/"no-unused-vars":\s*\[\s*"error",\s*\{\s*args:\s*"none"/);
  });

  test("findings are narrowed to function-valued bindings", () => {
    // The whole-file rule reports 224; unused plain values are the noisy class and are
    // tracked in TASKS.md instead. Functions are the unambiguous case.
    expect(source).toMatch(/collectFunctionNames/);
    expect(source).toMatch(/if \(!fnNames\.has\(id\)\) return false;/);
  });

  test("it parses with the same parser ESLint used, rather than counting braces", () => {
    // An earlier attempt matched braces by hand and deleted single lines out of arrow
    // functions, because `async (a, b) =>` opens and closes a paren before the body starts.
    expect(source).toMatch(/espree\.parse/);
    expect(source).toMatch(/ArrowFunctionExpression/);
    expect(source).toMatch(/FunctionExpression/);
  });
});

describe("its escapes are deliberate and documented", () => {
  test("JSX-used names are excused, because ESLint cannot see JSX references", () => {
    expect(source).toMatch(/collectJsxUsedNames/);
    expect(source).toMatch(/if \(jsxUsed\.has\(id\)\) return false;/);
  });

  test("window exports are excused, because that is how files share code here", () => {
    expect(source).toMatch(/collectWindowExports/);
    expect(source).toMatch(/if \(winExports\.has\(id\)\) return false;/);
  });

  test("a parse failure reports nothing rather than guessing", () => {
    // A gate that cries wolf gets switched off, and then it protects nothing.
    expect(source).toMatch(/if \(fnNames === null\) return false;/);
  });
});

describe("the baseline stays empty", () => {
  test("no unreachable function is tolerated by name", () => {
    // The BASELINE in lint-client.js is for no-undef findings that need domain intent.
    // Nothing in it may excuse an unreachable function: the fix is always to wire it up or
    // delete it, and both are cheap.
    const m = source.match(/const BASELINE = \[([\s\S]*?)\];/);
    expect(m).not.toBeNull();
    expect(m[1]).not.toMatch(/no-unused-vars/);
  });
});

describe("the deletions actually happened", () => {
  const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8");

  test("CaretakerHub no longer defines handlers nothing calls", () => {
    const hub = read("public/js/components/CaretakerHub.js");
    for (const dead of [
      "const handleIdentityVerify",  // called STRIPE Identity — the system v1.105.64 established nothing gates on
      "const handleStripeOnboard",   // superseded by MyAccount.handleConnectStripe
      "const handleStripeDashboard", // superseded by MyAccount's
      "const handleCancelJob",       // superseded by FindWork's
      "const saveStoplight",         // superseded by MyAccount.handleSavePreferences
      "const handleSaveRule",        // superseded by FindWork's
      "const handleDeleteRule",
      "const startEditRule",
      "const handleDocUpload",       // superseded by MyAccount's account-documents upload
    ]) {
      expect(hub).not.toContain(dead);
    }
  });

  test("MyAccount no longer carries the dead twin of FindWork's rate save", () => {
    expect(read("public/js/components/MyAccount.js")).not.toContain("const handleSaveRates");
    expect(read("public/js/components/FindWork.js")).toContain("const handleSaveRates");
  });

  test("the live copies survived", () => {
    // The point was never to delete behaviour, only unreachable duplicates of it.
    expect(read("public/js/components/FindWork.js")).toContain("const handleSaveRule");
    expect(read("public/js/components/MyAccount.js")).toContain("const handleSavePreferences");
    expect(read("public/js/components/MyAccount.js")).toContain("const handleConnectStripe");
    expect(read("public/js/components/NotificationPrompt.js")).toContain("const handleSendTest");
  });
});
