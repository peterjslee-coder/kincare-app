// ─── App Store / Play review invariants (v1.105.5) ───
//
// These pin requirements that are invisible at runtime and only surface as a store
// REJECTION weeks later — the same silent-failure shape as the lazy requires and the
// dead CSS. Cheap to assert, expensive to rediscover.
//
// Full context: Store_Review_Plan_2026-07-30.md in the Working Folder.

const fs = require("fs");
const path = require("path");

const repo = (p) => path.join(__dirname, "..", p);
const read = (p) => fs.readFileSync(repo(p), "utf8");

describe("Sign in with Apple", () => {
  const oauth = read("src/routes/oauth.js");

  test("Hide My Email addresses are NOT blocked", () => {
    // Apple REQUIRES supporting @privaterelay.appleid.com. Blocking it — or telling the
    // user to come back with a real address — is App Review guideline 4.8 / 5.1.1(v)
    // territory and would very likely be a rejection. It also only broke NEW signups,
    // exactly the path a reviewer walks.
    expect(oauth).not.toMatch(/failTo\(\s*["']apple_hidden_email["']\s*\)/);
  });

  test("account lookup keys on Apple's stable sub, not the email", () => {
    // Apple sends `email` only on the FIRST authorization. Keying on email would break
    // every subsequent sign-in, and would break Hide My Email users permanently.
    expect(oauth).toMatch(/provider\s*=\s*'apple'\s+AND\s+provider_user_id\s*=\s*\?/);
  });

  test("Apple sign-in is reachable from the login UI, not just the server", () => {
    // Guideline 4.8: offering Google sign-in obliges an equivalent privacy-preserving
    // option. A server route with no button does not satisfy it.
    const login = read("public/js/components/LoginPage.js");
    expect(login).toMatch(/\/api\/oauth\/apple/);
    expect(login).toMatch(/Sign in with Apple/);
  });
});

describe("iOS configuration", () => {
  const plist = read("ios/App/App/Info.plist");
  const pbxproj = read("ios/App/App.xcodeproj/project.pbxproj");

  test("iPhone-only for the first submission", () => {
    // Deliberate scope decision (7/30): declaring iPad ("1,2") obliges a separate iPad
    // screenshot set and an iPad-quality layout, and reviewers do test it. Change this
    // ONLY together with doing that work.
    expect(pbxproj).toMatch(/TARGETED_DEVICE_FAMILY = 1;/);
    expect(pbxproj).not.toMatch(/TARGETED_DEVICE_FAMILY = "1,2"/);
  });

  test("no dead ~ipad keys left behind", () => {
    expect(plist).not.toMatch(/~ipad/);
  });

  test("every capability the app uses has a usage string", () => {
    // A missing usage string for a capability that IS exercised doesn't degrade — iOS
    // terminates the process.
    for (const key of [
      "NSCameraUsageDescription",
      "NSPhotoLibraryUsageDescription",
      "NSMicrophoneUsageDescription",
    ]) {
      expect(plist).toContain(key);
    }
  });

  test("usage strings say what the data is for, not just that it's needed", () => {
    // Vague strings ("needed for the app to work") are a documented rejection reason.
    const strings = [...plist.matchAll(/UsageDescription<\/key>\s*<string>([^<]*)</g)].map((m) => m[1]);
    expect(strings.length).toBeGreaterThanOrEqual(3);
    for (const s of strings) expect(s.length).toBeGreaterThan(40);
  });

  test("a privacy manifest exists and is well-formed", () => {
    // Required-reason API declarations are mandatory since 2024-05-01; a missing manifest is
    // what triggers the ITMS-91053 "Missing API declaration" email after upload. Note that
    // @capacitor/ios ships two manifests of its own but both declare EMPTY arrays, so they
    // cover nothing — the app needs its own.
    const manifest = read("ios/App/App/PrivacyInfo.xcprivacy");
    expect(manifest).toContain("NSPrivacyAccessedAPICategoryUserDefaults");
    expect(manifest).toContain("CA92.1");
    expect(manifest).toContain("NSPrivacyCollectedDataTypeHealth");
    expect(manifest).toMatch(/<key>NSPrivacyTracking<\/key>\s*<false\/>/);
  });

  // Done in Xcode 2026-07-30 and verified against the real project file.
  // A manifest sitting in the folder is NOT shipped — it has to be a member of the App
  // target's Copy Bundle Resources phase, or the upload still gets ITMS-91053. So assert on
  // the PBXBuildFile "in Resources" entry, NOT merely on a PBXFileReference: a file can sit
  // in the project navigator and still never reach the bundle, which is exactly the silent
  // failure this whole file exists to catch.
  test("privacy manifest is a member of the App target's Copy Bundle Resources", () => {
    expect(pbxproj).toMatch(/PrivacyInfo\.xcprivacy in Resources \*\/ = \{isa = PBXBuildFile/);
    const resourcesPhase = pbxproj.slice(
      pbxproj.indexOf("Begin PBXResourcesBuildPhase"),
      pbxproj.indexOf("End PBXResourcesBuildPhase")
    );
    expect(resourcesPhase).toContain("PrivacyInfo.xcprivacy");
  });

  // v1.105.7 — Pete's decision: DECLARE location. It's core to the app's safety claim
  // (check-in/out evidences that the caregiver was at the home). Until this existed,
  // calling navigator.geolocation on iOS terminated the app.
  test("location usage string is declared, and foreground-only", () => {
    expect(plist).toContain("NSLocationWhenInUseUsageDescription");
    // Deliberately NOT requesting Always/background: no background mode, no Always key.
    // Both would invite much heavier review scrutiny for no feature benefit.
    // Assert on the <key> form, not the bare name — the file's own comments mention these
    // names, and a substring check would match the prose rather than a real declaration.
    expect(plist).not.toMatch(/<key>NSLocationAlwaysAndWhenInUseUsageDescription<\/key>/);
    expect(plist).not.toMatch(/<key>UIBackgroundModes<\/key>/);
  });

  test("the location usage string explains the safety purpose, not just the need", () => {
    const m = plist.match(/NSLocationWhenInUseUsageDescription<\/key>\s*<string>([^<]*)</);
    expect(m).toBeTruthy();
    expect(m[1].length).toBeGreaterThan(80);
    expect(m[1]).toMatch(/check in|check out|visit/i);
  });

  // v1.105.12 — without this key App Store Connect halts every upload on the export
  // compliance question, and an unanswered build can't ship to TestFlight or review.
  test("export compliance is declared, and declared as exempt", () => {
    expect(plist).toMatch(/<key>ITSAppUsesNonExemptEncryption<\/key>\s*<false\/>/);
    // Guard the opposite mistake too: <true/> here obliges a CCATS / self-classification
    // report and year-end reporting. If someone flips it, that must be a deliberate act
    // accompanied by the paperwork — not a silent edit.
    expect(plist).not.toMatch(/<key>ITSAppUsesNonExemptEncryption<\/key>\s*<true\/>/);
  });

  test("location is declared in the privacy manifest too", () => {
    // The plist string, the privacy manifest, the App Store Connect labels and the published
    // Privacy Policy all have to say the same thing. This pins the two that live in the repo.
    expect(read("ios/App/App/PrivacyInfo.xcprivacy")).toContain("NSPrivacyCollectedDataTypePreciseLocation");
  });
});

describe("Android configuration", () => {
  const manifest = read("android/app/src/main/AndroidManifest.xml");

  test("location permissions are declared", () => {
    // Capacitor's BridgeWebChromeClient bridges the WebView's navigator.geolocation to a
    // runtime permission request — but it can only request what's DECLARED here. Without
    // these, the WebView call simply failed.
    expect(manifest).toContain("android.permission.ACCESS_COARSE_LOCATION");
    expect(manifest).toContain("android.permission.ACCESS_FINE_LOCATION");
  });

  test("no background location", () => {
    // Match a real declaration, not the word appearing in a comment.
    expect(manifest).not.toMatch(/<uses-permission[^>]*ACCESS_BACKGROUND_LOCATION/);
  });

  test("GPS hardware is not marked required", () => {
    // Marking it required removes the app from Play for any device without GPS. Coarse
    // location is enough to confirm arrival.
    expect(manifest).toMatch(/android\.hardware\.location\.gps"\s+android:required="false"/);
  });
});

describe("hard store requirements that already pass", () => {
  test("account deletion exists and is reachable in the UI", () => {
    // Apple rejects outright if in-app account deletion is missing.
    expect(read("src/routes/auth.js")).toMatch(/router\.delete\(\s*["']\/me["']/);
    expect(read("public/js/components/MyAccount.js")).toMatch(/DeleteAccountSection/);
  });

  test("policy pages are served from the published legal documents, not the SPA", () => {
    // /terms used to return 200 while serving the SPA shell — a reviewer pasting the URL
    // saw the app, not the terms.
    const server = read("src/server.js");
    expect(server).toMatch(/routes\/publicLegal/);
    expect(fs.existsSync(repo("public/privacy.html"))).toBe(false); // the April 2026 stub
  });

  test("deep-link association files exist", () => {
    expect(fs.existsSync(repo("public/.well-known/apple-app-site-association"))).toBe(true);
    expect(fs.existsSync(repo("public/.well-known/assetlinks.json"))).toBe(true);
  });
});
