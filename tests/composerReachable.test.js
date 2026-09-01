// You must be able to see where to type. (v1.105.166)
//
// Pete, on Debbie's screen: "when she opens the app there's no clear way to enter text...
// you have to just click around on the bottom and it eventually brings up the new message
// space (which brings up the keyboard)."
//
// The composer was there the whole time — underneath the bottom nav. On mobile, Messages
// renders in a position:fixed container at z-index 1; the nav is a sibling at z-index 900.
// The container only stays clear of the nav because it subtracts the nav's 55px from its own
// height — and it stops subtracting when it believes the keyboard is up, since a keyboard
// covers the nav anyway.
//
// So "is the keyboard up?" decides whether the composer is visible. It was answered by
// `innerHeight - visualViewport.height > 120`, which mobile Safari's URL bar and bottom
// toolbar satisfy on their own. Tapping around collapses that chrome, the measurement drops
// under the threshold, and the composer appears — exactly the sequence Pete described.

const fs = require("fs");
const path = require("path");
const REPO = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8");

const messages = read("public/js/components/Messages.js");
const css = read("public/css/styles.css");

const liveCode = messages
  .split("\n")
  .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
  .join("\n");

describe("browser chrome is not a keyboard", () => {
  test("the shrink test does not use innerHeight - visualViewport.height", () => {
    const call = liveCode.match(/setVvShrunk\([^)]*\)/);
    expect(call).not.toBeNull();
    expect(call[0]).not.toMatch(/hidden/);
  });

  test("it still reacts to the things only a keyboard does", () => {
    // A pushed-down visual viewport, or a document iOS has scrolled to the focused input.
    const call = liveCode.match(/setVvShrunk\([^)]*\)/)[0];
    expect(call).toMatch(/top > 0/);
    expect(call).toMatch(/scrolled > 120/);
  });

  test("the focused composer is still a keyboard", () => {
    // Per v1.105.134 this is the signal that actually fires on the device; the measurement
    // half never did. It must not be dropped along with `hidden`.
    expect(liveCode).toMatch(/inputFocused && hasSoftKeyboard/);
  });
});

describe("if the keyboard call is wrong, the cost is the nav and not the composer", () => {
  test("Messages marks the body while it believes the keyboard is up", () => {
    expect(liveCode).toMatch(/classList\.toggle\(['"]msg-nav-hidden['"]/);
  });

  test("the mark is cleared when Messages unmounts", () => {
    expect(liveCode).toMatch(/classList\.remove\(['"]msg-nav-hidden['"]\)/);
  });

  test("the stylesheet takes the nav away rather than letting it cover the composer", () => {
    expect(css).toMatch(/body\.msg-nav-hidden \.bottom-nav\s*\{[^}]*display:\s*none/);
  });
});

describe("the nav reservation itself is unchanged", () => {
  test("with the keyboard down the container still leaves room for the nav", () => {
    expect(liveCode).toMatch(/vvBox\.height - safeBot - 55/);
  });
});
