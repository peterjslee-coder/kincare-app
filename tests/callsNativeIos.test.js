// calls-native (1.3) — the iOS half, checked from source.
//
// Swift can't be compiled here, so Xcode on Pete's Mac is the compile check. What CAN be held
// here is the wiring — the parts that, if they drift, fail silently on a phone:
//   - a VoIP push not reported to CallKit (iOS kills the app and stops delivering rings),
//   - PushKit not started at launch (a ring that wakes the app goes nowhere),
//   - a plugin the web half calls by a name or method the native half doesn't have,
//   - Swift files that exist on disk but aren't in the Xcode target (never compiled, no error).

const { raw, code } = require("./helpers/source");

const manager = code("ios/App/App/CallManager.swift");
const plugin = code("ios/App/App/InPlaceCallsPlugin.swift");
const web = code("public/js/nativeCalls.js");

describe("iOS native calling", () => {
  test("every VoIP push is reported to CallKit, in Swift, before anything else can fail", () => {
    const handler = manager.slice(manager.indexOf("didReceiveIncomingPushWith"));
    expect(handler).toMatch(/provider\.reportNewIncomingCall\(with: uuid/);
    // completion() must run on every path, including the reported-then-ended stale ring.
    expect(handler).toMatch(/defer \{ completion\(\) \}/);
    // A malformed or late ring is still reported, then ended — never silently dropped.
    expect(handler).toMatch(/if !valid \|\| stale \{[\s\S]*?reportCall\(with: uuid, endedAt: Date\(\)/);
  });

  test("PushKit starts at launch, not when the web app asks", () => {
    const delegate = code("ios/App/App/AppDelegate.swift");
    const launch = delegate.slice(delegate.indexOf("didFinishLaunchingWithOptions"), delegate.indexOf("return true"));
    expect(launch).toMatch(/CallManager\.shared\.start\(\)/);
    expect(delegate).toMatch(/CallManager\.shared\.setApnsToken\(deviceToken\)/);
    expect(manager).toMatch(/desiredPushTypes = \[\.voIP\]/);
  });

  test("the plugin is registered with the bridge and named what the web half asks for", () => {
    expect(code("ios/App/App/InPlaceViewController.swift")).toMatch(/registerPluginInstance\(InPlaceCallsPlugin\(\)\)/);
    expect(web).toMatch(/const PLUGIN = 'InPlaceCalls'/);
    expect(plugin).toMatch(/jsName = "InPlaceCalls"/);
    for (const m of ["getDeviceToken", "getPendingAnswer", "endCall"]) {
      expect(web).toMatch(new RegExp(`\\.${m}\\(`));
      expect(plugin).toMatch(new RegExp(`CAPPluginMethod\\(name: "${m}"`));
    }
    for (const ev of ["callAnswered", "callEnded", "callMuted", "tokenChanged"]) {
      expect(web).toMatch(new RegExp(`addListener\\('${ev}'`));
      expect(plugin).toMatch(new RegExp(`notifyListeners\\("${ev}"`));
    }
  });

  test("an answer only counts if the server says this phone won it", () => {
    const answer = manager.slice(manager.indexOf("perform action: CXAnswerCallAction"));
    expect(answer).toMatch(/request\(call, "answer", method: "POST"\)/);
    expect(answer).toMatch(/guard status == 200, state == "answered", won else/);
  });

  test("native talks to the same server the web view loads", () => {
    expect(manager).toMatch(/forResource: "capacitor\.config", withExtension: "json"/);
    expect(manager).toMatch(/X-Call-Token/);
  });

  test("both Swift files are compiled into the app target", () => {
    const proj = raw("ios/App/App.xcodeproj/project.pbxproj");
    for (const f of ["CallManager.swift", "InPlaceCallsPlugin.swift"]) {
      expect(proj).toMatch(new RegExp(`/\\* ${f} in Sources \\*/ = \\{isa = PBXBuildFile`));
      const sources = proj.slice(proj.indexOf("isa = PBXSourcesBuildPhase"));
      expect(sources.slice(0, sources.indexOf(");"))).toMatch(new RegExp(`${f} in Sources`));
    }
  });

  test("the system call screen's End and Mute reach the web call", () => {
    const overlay = code("public/js/components/VideoCallOverlay.js");
    expect(overlay).toMatch(/addEventListener\('inplace:native-call-ended'/);
    expect(overlay).toMatch(/addEventListener\('inplace:native-call-muted'/);
    expect(web).toMatch(/relay\('inplace:native-call-ended'\)/);
    expect(web).toMatch(/relay\('inplace:native-call-muted'\)/);
  });
});
