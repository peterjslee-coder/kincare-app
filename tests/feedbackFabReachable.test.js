// The feedback button cannot strand itself where you can't tap it. (v1.105.138)
//
// Pete, 8/24: "the floating feedback lightbulb flew up to the top and I can no longer
// reach/open it."
//
// The FAB is draggable and remembers where you put it, as absolute coordinates in
// localStorage. Two things conspired:
//
//   • the drag clamped with Math.max(0, …), so the top of the allowed range was y = 0 —
//     under the status bar and the notch, which in a home-screen app is not tappable at all;
//   • nothing re-checked the saved value afterwards. A position saved while the viewport was
//     a different shape is where the button lives from then on, on every screen, forever —
//     and during the keyboard work this same phone reported innerHeight as anything from 499
//     to 912 while the page was displaced by up to 413px.
//
// The band is the SAFE area now, and it is re-applied on load, so a stranded button rescues
// itself the next time the app opens. That last property is the one that matters: the person
// who most needs the feedback button is the one whose app is misbehaving.

const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(
  path.join(__dirname, "..", "public", "js", "components", "FeedbackButton.js"), "utf8"
);

// The three helpers are self-contained and sit at the top of the file, above the component.
const helpers = src.slice(0, src.indexOf("// ─── Floating Feedback Button ───"));

function load({ innerWidth = 390, innerHeight = 844, safeTop = 59, safeBottom = 34 } = {}) {
  const win = { innerWidth, innerHeight, __safeAreaTop: safeTop, __safeAreaBottom: safeBottom };
  return new Function("window", `${helpers}\nreturn { clampFabPos, fabSafeBand, FAB_SIZE };`)(win);
}

describe("the saved position is forced back into reach", () => {
  test("a button under the notch comes back below it", () => {
    const { clampFabPos } = load();
    expect(clampFabPos({ x: 16, y: 0 })).toEqual({ x: 16, y: 67 }); // 59 safe + 8
  });

  test("a negative position — the stranded case — is recovered", () => {
    const { clampFabPos } = load();
    expect(clampFabPos({ x: -200, y: -80 }).y).toBe(67);
    expect(clampFabPos({ x: -200, y: -80 }).x).toBe(8);
  });

  test("a button below the home indicator comes back above it", () => {
    const { clampFabPos } = load({ innerHeight: 844, safeBottom: 34 });
    // 844 - 34 - 48 - 8
    expect(clampFabPos({ x: 16, y: 2000 }).y).toBe(754);
  });

  test("a position that is already fine is left exactly alone", () => {
    const { clampFabPos } = load();
    expect(clampFabPos({ x: 16, y: 400 })).toEqual({ x: 16, y: 400 });
  });

  test("nothing saved stays nothing — the default CSS position still wins", () => {
    const { clampFabPos } = load();
    expect(clampFabPos(null)).toBe(null);
    expect(clampFabPos({})).toBe(null);        // a half-written localStorage entry
    expect(clampFabPos({ x: 1 })).toBe(null);
  });

  test("a viewport shrunk by a keyboard still leaves a usable band", () => {
    // innerHeight 499 was real, measured on Pete's phone with the keyboard up.
    const { clampFabPos, fabSafeBand } = load({ innerHeight: 499 });
    const b = fabSafeBand();
    expect(b.bottom).toBeGreaterThan(b.top);
    expect(clampFabPos({ x: 16, y: 480 }).y).toBe(409);
  });
});

describe("the wiring, not just the arithmetic", () => {
  test("it clamps what it reads out of localStorage", () => {
    expect(src).toMatch(/if \(saved\) return clampFabPos\(JSON\.parse\(saved\)\);/);
  });

  test("it clamps while dragging, to the safe band and not to zero", () => {
    expect(src).not.toMatch(/Math\.max\(0, Math\.min\(window\.innerHeight - 48/);
    expect(src).toMatch(/setPos\(clampFabPos\(\{ x: dragRef\.current\.startPosX \+ dx, y: dragRef\.current\.startPosY \+ dy \}\)\);/);
  });

  test("it rescues on load and on rotation, and remembers the rescue", () => {
    expect(src).toMatch(/window\.addEventListener\('orientationchange', rescueFab\)/);
    expect(src).toMatch(/localStorage\.setItem\('inplace_fab_pos', JSON\.stringify\(next\)\)/);
  });

  test("it does NOT re-clamp on every resize", () => {
    // A keyboard opening is a resize. Re-clamping to a viewport that is temporarily 400px
    // shorter would walk the button up the screen every time someone types.
    const effect = src.slice(src.indexOf("const rescueFab"), src.indexOf("// Attach global move/end listeners"));
    expect(effect).not.toMatch(/addEventListener\('resize'/);
  });
});
