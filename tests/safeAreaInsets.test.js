// The app must not invent a safe area. (v1.105.166)
//
// Pete, looking at Debbie's phone: "way too much void at the top of the screen."
//
// Measured on production in a 375x812 mobile viewport: `env(safe-area-inset-top)` resolved
// to 0px — correctly, because a browser does not put the page under the status bar — and
// this polyfill overrode it with 47px on the strength of the screen's ASPECT RATIO. The
// Messages container then drew a 47px spacer above the header, reserving the status bar a
// second time. Aspect ratio is not evidence about insets.
//
// env() reporting 0 is only ever wrong in one place: the Capacitor iOS WKWebView with
// contentInsetAdjustmentBehavior=never, which is the bug this polyfill was written for.
// These tests are what stops the guess creeping back out to every other surface.

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO = path.join(__dirname, "..");
const appSrc = fs.readFileSync(path.join(REPO, "public/js/app.js"), "utf8");

const END = "}catch(e){console.warn('safe-area polyfill error',e)}})();";
const polyfill = appSrc.slice(0, appSrc.indexOf(END) + END.length);

/**
 * Run the real polyfill against a fake surface.
 * @param envInsets  what env(safe-area-inset-*) resolves to, in px
 * @param platform   null for a browser, or 'ios' / 'android' inside Capacitor
 * @param screenPx   the physical screen, [long, short]
 */
function runPolyfill({ envInsets = { top: 0, bottom: 0 }, platform = null, screenPx = [812, 375] }) {
  const cssVars = {};
  const probes = new Map();
  const doc = {
    createElement: () => {
      const el = { style: {} };
      Object.defineProperty(el.style, "cssText", {
        set(v) {
          // Which inset is this probe asking about?
          if (v.includes("padding-top")) probes.set(el, "top");
          if (v.includes("padding-bottom")) probes.set(el, "bottom");
        },
        get() { return ""; },
      });
      return el;
    },
    body: { appendChild() {}, removeChild() {} },
    documentElement: {
      appendChild() {}, removeChild() {},
      style: { setProperty: (k, v) => { cssVars[k] = v; } },
    },
  };

  const win = {
    document: doc,
    screen: { height: screenPx[0], width: screenPx[1] },
    console: { warn() {} },
    getComputedStyle: (el) => ({
      paddingTop: probes.get(el) === "top" ? `${envInsets.top}px` : "0px",
      paddingBottom: probes.get(el) === "bottom" ? `${envInsets.bottom}px` : "0px",
    }),
  };
  if (platform) {
    win.Capacitor = { isNativePlatform: () => true, getPlatform: () => platform };
  }
  win.window = win;

  vm.createContext(win);
  vm.runInContext(polyfill, win);
  return { top: win.__safeAreaTop, bottom: win.__safeAreaBottom, cssVars };
}

describe("a real env() inset is always believed", () => {
  test("a home-screen PWA reporting 59/34 gets 59/34", () => {
    const r = runPolyfill({ envInsets: { top: 59, bottom: 34 } });
    expect(r.top).toBe(59);
    expect(r.bottom).toBe(34);
  });

  test("Capacitor iOS reporting a real inset uses it rather than the guess", () => {
    const r = runPolyfill({ envInsets: { top: 62, bottom: 34 }, platform: "ios" });
    expect(r.top).toBe(62);
  });
});

describe("env() reporting 0 is believed everywhere except the Capacitor iOS WebView", () => {
  test("a tall phone in a browser gets nothing — this is Debbie's void", () => {
    // 375x812 with env() at 0: the exact surface measured on production.
    const r = runPolyfill({ envInsets: { top: 0, bottom: 0 }, screenPx: [812, 375] });
    expect(r.top).toBe(0);
    expect(r.bottom).toBe(0);
    expect(r.cssVars["--sat"]).toBe("0px");
  });

  test("a very tall modern phone in a browser gets nothing", () => {
    expect(runPolyfill({ screenPx: [932, 430] }).top).toBe(0);
  });

  test("an ordinary 2560x1440 desktop monitor gets nothing", () => {
    // The old (h/w > 1.7) branch fired here — 1.78 — for a 20px band of empty page.
    expect(runPolyfill({ screenPx: [2560, 1440] }).top).toBe(0);
  });

  test("Capacitor ANDROID gets nothing — it does not draw under the status bar", () => {
    expect(runPolyfill({ platform: "android", screenPx: [915, 412] }).top).toBe(0);
  });

  test("Capacitor iOS is the one surface that still gets the guess", () => {
    const r = runPolyfill({ platform: "ios", screenPx: [852, 393] });
    expect(r.top).toBe(59);
    expect(r.bottom).toBe(34);
  });

  test("a shorter iPhone in Capacitor iOS gets the smaller notch", () => {
    expect(runPolyfill({ platform: "ios", screenPx: [812, 375] }).top).toBe(47);
  });
});

describe("no component re-guesses the insets after app.js has resolved them", () => {
  // A per-component `isNativePlatform() ? 59 : 0` fallback is the same bug one level down:
  // it fires on Android native, where nothing is covering the top of the page.
  for (const file of [
    "public/js/components/Messages.js",
    "public/js/components/FeedbackButton.js",
  ]) {
    test(`${path.basename(file)} reads the resolved value only`, () => {
      // Comments are allowed to describe the bug; only live code is checked.
      const src = fs
        .readFileSync(path.join(REPO, file), "utf8")
        .split("\n")
        .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
        .join("\n");
      expect(src).not.toMatch(/__safeAreaTop\s*\|\|\s*\(?\s*isCapNative/);
      expect(src).not.toMatch(/isNativePlatform\(\)\s*\?\s*59/);
    });
  }
});
