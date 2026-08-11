// v1.105.54 — everything that has been waiting on a native build, wired in one place.
//
// Pete: "do we have everything batched for the TestFlight build that will fix this?"
//
// The answer was no, so this is the batching. Four Capacitor plugins' worth of behaviour
// has accumulated over the week, each one blocked on a build. Every call site now
// feature-detects the plugin and falls back to what it does today, so installing the four
// packages and shipping ONE build turns all of them on with no further code from me.
//
// The diagnostic that settled the geolocation question is worth keeping in view:
//
//     web:ceiling:timeout → watch:ceiling:timeout in 42s
//
// "ceiling" is our own outer deadline, twice — meaning neither the success nor the error
// callback was ever invoked. A denial reads as denied(1); a real failure as timeout(3).
// Nothing came back at all. That is a stub, not a permission problem, and it is why three
// successive guesses about "indoors" and "Location Services" were all wrong.

const { code } = require("./helpers/source");

const utils = code("public/js/utils.js");
const hub = code("public/js/components/CaretakerHub.js");
const areaMap = code("public/js/components/AreaMap.js");
const caregivers = code("public/js/components/Caregivers.js");
const visitLog = code("public/js/components/FamilyVisitLog.js");

describe("one way to ask this phone where it is", () => {
  test("the helper prefers the plugin, then falls back to the browser", () => {
    expect(utils).toMatch(/const getDeviceLocation/);
    const fn = utils.slice(utils.indexOf("const getDeviceLocation"), utils.indexOf("const canAskLocation") + 400);
    expect(utils).toMatch(/const _geoNative = async/);
    expect(utils).toMatch(/_capPlugin\('Geolocation'\)/);
    const flow = utils.slice(utils.indexOf("const getDeviceLocation"));
    expect(flow.indexOf("_geoNative")).toBeLessThan(flow.indexOf("_geoWeb"));
  });

  test("it always settles, and says which stage answered", () => {
    expect(utils).toMatch(/stage: `\$\{stage\}:ceiling`/);
    expect(utils).toMatch(/tried\.push\(/);
    expect(utils).toMatch(/elapsedMs: Date\.now\(\) - started/);
  });

  test("a denial is not retried — re-asking only re-reports the same no", () => {
    const flow = utils.slice(utils.indexOf("const getDeviceLocation"));
    expect(flow).toMatch(/if \(n\.pos \|\| n\.reason === 'denied'\) return n;/);
  });

  test("EVERY call site goes through it — no raw navigator.geolocation left", () => {
    // Check-in and check-out called the browser API directly, so the evidence that a
    // caregiver was actually at the home has never been captured on an iPhone. It sat at
    // null with no error, which is exactly why nobody noticed.
    for (const [name, src] of [["CaretakerHub", hub], ["AreaMap", areaMap], ["Caregivers", caregivers], ["FamilyVisitLog", visitLog]]) {
      expect([name, /navigator\.geolocation\.(getCurrentPosition|watchPosition)/.test(src)]).toEqual([name, false]);
      expect(src).toMatch(/getDeviceLocation\(|canAskLocation\(/);
    }
  });

  test("capability is asked about the plugin too, not just the stub", () => {
    // `navigator.geolocation` EXISTS in the native webview — it is the thing that never
    // answers. A bare presence check proves nothing, and a plugin build could answer
    // without it.
    expect(utils).toMatch(/const canAskLocation = window\.canAskLocation = \(\) =>\s*\n?\s*!!\(_capPlugin\('Geolocation'\) \|\|/);
    expect(visitLog).toMatch(/!canAskLocation\(\)/);
  });

  test("check-in tells the caregiver when location failed, and still lets them check in", () => {
    expect(hub).toMatch(/Couldn't get your location\. You can still check in\./);
    expect(hub).toMatch(/Location is off for InPlace/);
  });
});

describe("the other three things waiting on a build", () => {
  test("the app icon clears itself on open, once @capacitor/badge exists", () => {
    // The half of the badge fix that has been waiting since v1.105.42: set the icon
    // directly on open/resume instead of depending on a push arriving to correct it.
    const fn = utils.slice(utils.indexOf("const refreshAppBadge"), utils.indexOf("const checkPushHealth"));
    expect(fn).toMatch(/_capPlugin\('Badge'\)/);
    expect(fn).toMatch(/badgePlugin\.set\(\{ count: n \}\)/);
    expect(fn).toMatch(/badgePlugin\.clear\(\)/);
    // ...and the web path is still there for an installed PWA.
    expect(fn).toMatch(/navigator\.setAppBadge\(n\)/);
  });

  test("an incoming call can ring on iOS, once @capacitor/local-notifications exists", () => {
    // v1.105.49 moved these to the service worker because `new Notification` throws on iOS.
    // But a WKWebView may have no usable service-worker notification path either, so a call
    // could still arrive silently. This is the one that definitely works.
    const fn = utils.slice(utils.indexOf("const showLocalNotification"), utils.indexOf("const closeLocalNotification"));
    expect(fn).toMatch(/_capPlugin\('LocalNotifications'\)/);
    expect(fn).toMatch(/ln\.schedule/);
    // v1.105.57 — and it checks authorization first: iOS accepts schedule() from an
    // unauthorized app and displays nothing, so a resolved promise is not proof of a
    // notification. Returning true off it would be the "Exported!" toast all over again.
    expect(fn).toMatch(/const perm = await ln\.checkPermissions\(\);/);
    expect(fn).toMatch(/if \(perm\?\.display !== 'granted'\) return false;/);
    expect(fn.indexOf("_capPlugin('LocalNotifications')")).toBeLessThan(fn.indexOf("reg?.showNotification"));
  });

  test("Save and Export write a real file, once Filesystem + Share exist", () => {
    // `<a download>` is a no-op in WKWebView; the Web Share API fallback may or may not
    // accept a file. This writes the bytes and hands the OS a URL.
    const fn = utils.slice(utils.indexOf("const saveBlob"), utils.indexOf("const reportClientError"));
    expect(fn).toMatch(/_capPlugin\('Filesystem'\)/);
    expect(fn).toMatch(/_capPlugin\('Share'\)/);
    expect(fn).toMatch(/fs\.writeFile\(\{ path: filename, data: b64, directory: 'CACHE' \}\)/);
    expect(fn).toMatch(/share\.share\(\{ title: filename, url: written\?\.uri/);
    // A cancelled share sheet is not a failure to report.
    expect(fn).toMatch(/if \(e\?\.message && \/cancel\/i\.test\(e\.message\)\) return false;/);
  });
});

describe("the plugins the build actually installs", () => {
  const pkg = JSON.parse(require("fs").readFileSync(
    require("path").join(__dirname, "..", "package.json"), "utf8"
  ));

  test("all five are dependencies, so `npx cap sync` finds them", () => {
    for (const dep of [
      "@capacitor/geolocation",
      "@capacitor/local-notifications",
      "@capacitor/filesystem",
      "@capacitor/share",
      "@capawesome/capacitor-badge", // there is no official @capacitor/badge
    ]) {
      expect([dep, !!pkg.dependencies[dep]]).toEqual([dep, true]);
    }
  });

  test("the badge package registers under the name the code asks for", () => {
    // The community plugin registers as 'Badge'; _capPlugin('Badge') has to match it, and
    // a mismatch would fail exactly the way everything else this week did — silently.
    const src = require("fs").readFileSync(
      require("path").join(__dirname, "..", "node_modules", "@capawesome", "capacitor-badge", "dist", "esm", "index.js"), "utf8"
    );
    expect(src).toMatch(/registerPlugin\('Badge'/);
    expect(utils).toMatch(/_capPlugin\('Badge'\)/);
  });

  test("the iOS project lists every plugin", () => {
    const swift = require("fs").readFileSync(
      require("path").join(__dirname, "..", "ios", "App", "CapApp-SPM", "Package.swift"), "utf8"
    );
    for (const name of [
      "CapacitorGeolocation", "CapacitorLocalNotifications",
      "CapacitorFilesystem", "CapacitorShare", "CapawesomeCapacitorBadge",
    ]) {
      expect([name, swift.includes(name)]).toEqual([name, true]);
    }
  });

  test("the build number moved — TestFlight rejects a repeat", () => {
    const proj = require("fs").readFileSync(
      require("path").join(__dirname, "..", "ios", "App", "App.xcodeproj", "project.pbxproj"), "utf8"
    );
    expect(proj).not.toMatch(/CURRENT_PROJECT_VERSION = 7;/);
    expect(proj).toMatch(/CURRENT_PROJECT_VERSION = 8;/);
  });
});

describe("nothing here breaks the build that exists today", () => {
  test("every plugin call is feature-detected, never assumed", () => {
    // These four packages are NOT installed. Until they are, _capPlugin returns null and
    // each path falls through to current behaviour — so this ships safely right now.
    const calls = utils.match(/_capPlugin\('(\w+)'\)/g) || [];
    expect(calls.length).toBeGreaterThanOrEqual(5);
    expect(utils).toMatch(/if \(!window\.Capacitor\?\.isNativePlatform\?\.\(\)\) return null;/);
    expect(utils).toMatch(/return window\.Capacitor\?\.Plugins\?\.\[name\] \|\| null;/);
  });

  test("a plugin that throws falls back rather than taking the feature down", () => {
    expect(utils).toMatch(/catch \{ \/\* fall through to the web API \*\/ \}/);
    expect(utils).toMatch(/catch \{ \/\* fall through \*\/ \}/);
  });
});
