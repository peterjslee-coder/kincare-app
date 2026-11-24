// Tapping a thing is not doing it. (v1.105.123)
//
// The family dashboard's "Get Started" tiles were removed permanently by the TAP that opened
// them, recorded in localStorage. Open "Complete your profile", look at it, change your mind,
// and the only thing that would have reminded you is gone for good while the profile is still
// incomplete.
//
// Same family as the identity step that read "not done" while it was still loading
// (v1.105.112): a state we had not established, rendered as one we had.

const fs = require("fs");
const path = require("path");
const dash = fs.readFileSync(path.join(__dirname, "..", "public", "js", "components", "Dashboard.js"), "utf8");
const code = dash.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

describe("the discovery tiles", () => {
  test("a tap navigates and records nothing", () => {
    expect(code).toMatch(/const openItem = \(item\) => \{ onNavigate && onNavigate\(item\.target\); \};/);
    expect(code).not.toMatch(/const markClicked = /);
    expect(code).not.toMatch(/if \(!cur\.includes\(item\.id\)\)/);
  });

  test("what hides a tile is it being done, or the user saying so", () => {
    expect(code).toMatch(/const remaining = discoverItems\.filter\(d => !d\.done\);/);
    expect(code).toMatch(/localStorage\.setItem\('inplace_discover_dismissed', '1'\)/);
  });

  test("the profile tile knows whether the profile is complete", () => {
    // The one item here whose completion is actually observable.
    expect(code).toMatch(/target: 'account', done: hasProfile/);
  });

  test("the old per-item key is not read, so an abandoned tile comes back", () => {
    expect(code).not.toMatch(/getItem\('inplace_discovered'\)/);
  });

  test("'Dismiss all' still works, and is now the only way to hide them by hand", () => {
    expect(dash).toMatch(/Dismiss all/);
    expect(code).toMatch(/inplace_discover_dismissed/);
  });
});
