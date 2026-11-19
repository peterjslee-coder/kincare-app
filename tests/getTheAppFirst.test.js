// Get the app first, and email links open the app (v1.134.0).
//
// Pete, 11/18: "What about prompting them to download the app before they start the whole
// process ... and from that point, when they click an email link it should open the app not
// chrome."

const fs = require("fs");
const path = require("path");
const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

const card = read("public/js/components/GetTheAppFirst.js");

function offer({ ua, native = false, continued = false }) {
  const store = new Map(continued ? [["inplace:continueInBrowser", "1"]] : []);
  const window = { Capacitor: native ? { isNativePlatform: () => true } : undefined };
  const navigator = { userAgent: ua };
  const sessionStorage = { getItem: (k) => store.get(k) || null, setItem: (k, v) => store.set(k, v) };
  const React = { useState: (f) => [typeof f === "function" ? f() : f, () => {}] };
  // The JSX half is not needed to answer "who"; run only the decision.
  const decide = card.slice(card.indexOf("const shouldOfferAndroidApp"), card.indexOf("const GetTheAppFirst"));
  new Function("window", "navigator", "sessionStorage", "React", decide)(window, navigator, sessionStorage, React);
  return window.shouldOfferAndroidApp();
}

const ANDROID = "Mozilla/5.0 (Linux; Android 14; SM-S918U) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";

describe("who is offered the app", () => {
  test("an Android phone in a browser", () => expect(offer({ ua: ANDROID })).toBe(true));
  test("not inside the app already", () => expect(offer({ ua: ANDROID, native: true })).toBe(false));
  test("not an iPhone — the App Store listing is not public yet", () => expect(offer({ ua: IPHONE })).toBe(false));
  test("not after she chose to continue in the browser", () => expect(offer({ ua: ANDROID, continued: true })).toBe(false));
});

describe("where it shows", () => {
  test("the public Play Store listing", () => {
    expect(card).toContain("https://play.google.com/store/apps/details?id=com.yourinplace.app");
  });
  test("the first screen of signup, and the care-team invite landing", () => {
    expect(read("public/js/components/CaregiverOnboarding.js")).toContain("{step === 1 && typeof GetTheAppFirst !== 'undefined' && <GetTheAppFirst />}");
    expect(read("public/js/components/InviteLandingPage.js")).toContain("<GetTheAppFirst />");
  });
  test("it is bundled before the screens that use it", () => {
    const b = read("scripts/build-client.js");
    expect(b.indexOf("GetTheAppFirst.js")).toBeGreaterThan(0);
    expect(b.indexOf("GetTheAppFirst.js")).toBeLessThan(b.indexOf("InviteLandingPage.js"));
  });
});

describe("links open in the app", () => {
  const manifest = read("android/app/src/main/AndroidManifest.xml");
  test("the Android app claims yourinplace.com links, verified", () => {
    expect(manifest).toMatch(/<intent-filter android:autoVerify="true">[\s\S]*android:host="yourinplace.com" android:path="\/"/);
  });
  test("but never /api — OAuth callbacks stay in the browser tab that started them", () => {
    expect(manifest).not.toMatch(/android:host="yourinplace.com"[^>]*pathPrefix="\/api/);
    expect(manifest).not.toMatch(/android:host="yourinplace.com"[^>]*pathPrefix="\/"/);
  });
  test("assetlinks lets the app handle the links", () => {
    const al = JSON.parse(read("public/.well-known/assetlinks.json"));
    expect(al[0].relation).toContain("delegate_permission/common.handle_all_urls");
    expect(al[0].target.package_name).toBe("com.yourinplace.app");
  });
  test("the app puts the WebView on the link — same origin only, once per link", () => {
    const app = read("public/js/app.js");
    expect(app).toContain("function openOwnLink(url)");
    expect(app).toMatch(/if \(host !== window\.location\.hostname\.replace/);
    expect(app).toContain("inplace:openedLink");
    expect(app).toContain("getLaunchUrl");
  });
});

describe("text size on Android", () => {
  const main = read("android/app/src/main/java/com/yourinplace/app/MainActivity.java");
  test("follows the phone's setting, capped at 130%", () => {
    expect(main).toContain("Math.min(Math.max(scale, 1.0f), 1.3f)");
    expect(main).toContain("setTextZoom(zoom)");
  });
});
