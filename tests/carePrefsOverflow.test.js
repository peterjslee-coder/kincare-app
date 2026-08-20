// A row cannot grow past the screen. (v1.105.107)
//
// Tyler, 5eba31dd, iPhone 17 Pro: "the items go in a box that extends beyond my phone screen
// and i can't see the full text." And, in the same breath, 93a017e2: the scroll bar above the
// tabs "feels out of place."
//
// Both came from the same place. In the Care Preferences row —
//   [icon 24px] [label flex:1] [three rating buttons, flexShrink:0]
// — a flex child defaults to `min-width: auto`, so the label could not shrink below its
// longest word, and the button group refused to shrink at all. Nothing in the row could give,
// so the row grew past the viewport instead. Same hard-floor family as v1.105.2's
// `minmax(220px, 1fr)`.
//
// NOTE ON METHOD: the codebase rule is to MEASURE these in headless Chromium against the real
// styles.css, because the causes are usually invisible in source. That was not possible here —
// the sandbox has no browser and cannot download one. So the fix is deliberately STRUCTURAL
// rather than tuned: `min-width: 0` plus `flex-wrap` means the row cannot overflow at any
// width, font size or text-size accessibility setting, and there is no threshold to get wrong.
// These tests pin the structure. A measurement on a real device is still worth doing.

const fs = require("fs");
const path = require("path");
const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
const account = read("public/js/components/MyAccount.js");
const css = read("public/css/styles.css");

const prefsRow = account.slice(
  account.indexOf("{CG_PREFS_LIST.map(pref => {"),
  account.indexOf("<button onClick={handleSavePreferences}")
);

describe("the preference row can always fit", () => {
  test("the label may shrink below its longest word", () => {
    // Without minWidth: 0 a flex child's implicit `min-width: auto` is the hard floor.
    expect(prefsRow).toMatch(/minWidth: 0/);
    expect(prefsRow).toMatch(/overflowWrap: 'anywhere'/);
  });

  test("the label has a flex-basis it can grow and shrink from", () => {
    expect(prefsRow).toMatch(/flex: '1 1 140px'/);
  });

  test("the row wraps when even that is not enough", () => {
    expect(prefsRow).toMatch(/padding: '10px 12px', flexWrap: 'wrap'/);
  });

  test("the rating buttons keep their size but may wrap among themselves", () => {
    // They must not squash to unreadable — they drop to their own line instead.
    expect(prefsRow).toMatch(/flexShrink: 0, marginLeft: 'auto', flexWrap: 'wrap'/);
  });

  test("nothing here relies on a pixel threshold", () => {
    // A tuned breakpoint is a guess about someone else's phone.
    expect(prefsRow).not.toMatch(/@media|maxWidth: \d|minWidth: [1-9]/);
  });
});

describe("the tab strip", () => {
  test("the long tab label is now one word like the others", () => {
    // Profile / Settings / Payments / Documents / Preferences.
    expect(account).toMatch(/\{ id: 'preferences', label: 'Preferences' \}/);
    expect(account).not.toMatch(/label: 'Care Preferences' \}/);
  });

  test("it still scrolls, but does not draw a bar to say so", () => {
    expect(account).toMatch(/<div className="scroll-x-quiet" style=\{\{ display: 'flex', borderBottom/);
    expect(account).not.toMatch(/marginBottom: 20, overflowX: 'auto' \}\}/);
  });

  test("the utility is scoped, not a broad rule", () => {
    // A bare `::-webkit-scrollbar { display: none }` would silently strip the scroll bar off
    // every scrollable panel in the app — the clobbering class from v1.105.2.
    expect(css).toMatch(/\.scroll-x-quiet::-webkit-scrollbar \{ display: none; \}/);
    expect(css).toMatch(/\.scroll-x-quiet \{[\s\S]*?scrollbar-width: none;/);
    expect(css).not.toMatch(/^::-webkit-scrollbar\s*\{\s*display:\s*none/m);
  });
});
