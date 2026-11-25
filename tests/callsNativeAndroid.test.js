// calls-native (1.3) — the Android half, and the Hub kiosk, checked from source.
//
// Java can't be compiled here (no Android SDK in CI), so Android Studio on Pete's Mac is the
// compile check. What CAN be held here is the wiring that fails silently on a phone:
//   - two Firebase messaging services (FCM picks one; ordinary pushes or rings vanish),
//   - a ring that never reaches CallRinger, or ordinary pushes that stop reaching Capacitor,
//   - plugins the web half calls by a name the native half doesn't register,
//   - kiosk code that could ever lock a phone that isn't a Hub tablet,
//   - InPlace offered as a launcher on every phone.

const { raw, code } = require("./helpers/source");

const A = "android/app/src/main/";
const J = A + "java/com/yourinplace/app/";
const manifest = raw(A + "AndroidManifest.xml");
const main = code(J + "MainActivity.java");
const service = code(J + "CallMessagingService.java");
const ringer = code(J + "CallRinger.java");
const calls = code(J + "InPlaceCallsPlugin.java");
const kiosk = code(J + "Kiosk.java");
const kioskPlugin = code(J + "InPlaceKioskPlugin.java");
const web = code("public/js/nativeCalls.js");
const phone = code("public/js/components/RecipientPhone.js");

describe("Android native calling", () => {
  test("ONE messaging service: ours replaces Capacitor's and hands everything but a ring back to it", () => {
    expect(manifest).toMatch(/android:name="\.CallMessagingService"[\s\S]*?com\.google\.firebase\.MESSAGING_EVENT/);
    expect(manifest).toMatch(/com\.capacitorjs\.plugins\.pushnotifications\.MessagingService"\s+tools:node="remove"/);
    expect(service).toMatch(/extends MessagingService/);
    expect(service).toMatch(/"call_ring"\.equals\(data\.get\("type"\)\)[\s\S]*?CallRinger\.ring\(this, data\);\s*return;/);
    expect(service).toMatch(/super\.onMessageReceived\(remoteMessage\)/);
    expect(service).toMatch(/super\.onNewToken\(token\)/);
  });

  test("the ring is full-screen, insistent, and stops on its own", () => {
    expect(ringer).toMatch(/setFullScreenIntent\(full, true\)/);
    expect(ringer).toMatch(/CallStyle\.forIncomingCall/);
    expect(ringer).toMatch(/FLAG_INSISTENT/);
    expect(ringer).toMatch(/setTimeoutAfter\(timeout\)/);
    expect(manifest).toMatch(/android\.permission\.USE_FULL_SCREEN_INTENT/);
    expect(manifest).toMatch(/android:name="\.IncomingCallActivity"[\s\S]*?android:showWhenLocked="true"/);
  });

  test("answer and decline go to the server with the call's pass, and only the winner joins", () => {
    expect(ringer).toMatch(/"\/api\/calls\/" \+ URLEncoder\.encode\(call\.roomName, "UTF-8"\) \+ "\/" \+ path/);
    expect(ringer).toMatch(/setRequestProperty\("X-Call-Token", call\.callToken\)/);
    expect(ringer).toMatch(/json\.optBoolean\("won", false\)/);
    expect(ringer).toMatch(/if \(won\) deliverAnswer\(call\.asAnswer\(\)\)/);
    // Status poll: anything but "ringing" ends the ring here.
    expect(ringer).toMatch(/!"ringing"\.equals\(state\)/);
  });

  test("the plugin is registered and named what nativeCalls.js asks for", () => {
    expect(main).toMatch(/registerPlugin\(InPlaceCallsPlugin\.class\);[\s\S]*?super\.onCreate\(savedInstanceState\)/);
    expect(calls).toMatch(/@CapacitorPlugin\(name = "InPlaceCalls"\)/);
    expect(web).toMatch(/const PLUGIN = 'InPlaceCalls'/);
    for (const m of ["getDeviceToken", "getPendingAnswer", "endCall"]) {
      expect(web).toMatch(new RegExp(`\\.${m}\\(`));
      expect(calls).toMatch(new RegExp(`public void ${m}\\(PluginCall call\\)`));
    }
    expect(calls).toMatch(/o\.put\("platform", "android"\)/);
    expect(calls).toMatch(/notifyListeners\("callAnswered", toJS\(answer\), true\)/);
  });

  test("ONE way to answer: InPlace on screen rings in the app, otherwise the phone rings", () => {
    // Pete, 11/24: the Hub showed its big card AND a ringing notification; neither answered.
    expect(ringer).toMatch(/if \(MainActivity\.inFront\) \{[\s\S]*?return;/);
    expect(main).toMatch(/inFront = false;[\s\S]*?super\.onPause\(\)/);
    expect(main).toMatch(/super\.onResume\(\);\s*inFront = true;/);
    // The web side makes the same decision: iOS always rings natively; Android only when hidden.
    expect(web).toMatch(/if \(platform === 'ios'\) return true;\s*return typeof document !== 'undefined' && document\.hidden === true;/);
    for (const f of ["public/js/app.js", "public/js/components/Messages.js", "public/js/components/RecipientPhone.js"]) {
      expect(code(f)).toMatch(/window\.NativeCalls\.ringsHere\(d(ata)?\)\) return;/);
      expect(code(f)).not.toMatch(/ringingNatively && window\.NativeCalls && window\.NativeCalls\.available\(\)\) return/);
    }
    // And a call answered on the phone's own screen is joined by the Hub, not offered again.
    expect(phone).toMatch(/if \(pc && pc\.answeredNatively\) \{ window\.__pendingCall = null; joinRef\.current\(pc\); return; \}/);
    expect(phone).toMatch(/addEventListener\('inplace:native-call-answered', pickUp\)/);
  });

  test("camera is declared, but not required (camera-less devices stay on Play)", () => {
    expect(manifest).toMatch(/android\.permission\.CAMERA/);
    expect(manifest).toMatch(/android\.hardware\.camera"\s+android:required="false"/);
  });
});

describe("Hub kiosk", () => {
  test("nothing happens unless this app is the tablet's device owner", () => {
    const apply = kiosk.slice(kiosk.indexOf("static void apply("), kiosk.indexOf("private static void enter("));
    expect(apply).toMatch(/if \(!isDeviceOwner\(ctx\)\) return;/);
    expect(kiosk).toMatch(/isDeviceOwnerApp\(ctx\.getPackageName\(\)\)/);
    const pause = kiosk.slice(kiosk.indexOf("static void pause("));
    expect(pause).toMatch(/if \(!isDeviceOwner\(ctx\) \|\| !wanted\(ctx\)\) return;/);
  });

  test("InPlace is never offered as a launcher on an ordinary phone", () => {
    expect(manifest).toMatch(/android:name="\.KioskHome"[\s\S]*?android:enabled="false"[\s\S]*?android\.intent\.category\.HOME/);
    // MainActivity itself has no HOME filter.
    const mainAct = manifest.slice(manifest.indexOf('android:name=".MainActivity"'), manifest.indexOf("</activity>"));
    expect(mainAct).not.toMatch(/category\.HOME/);
  });

  test("the power menu stays, so the tablet can always be restarted", () => {
    expect(kiosk).toMatch(/LOCK_TASK_FEATURE_GLOBAL_ACTIONS/);
  });

  test("there are ways out: the family's switch, and five taps in the corner at the tablet", () => {
    expect(kiosk).toMatch(/if \(wanted\(ctx\) && !paused\(ctx\)\) enter\(activity\); else exit\(activity\);/);
    expect(main).toMatch(/if \(\+\+cornerTaps >= 5\)[\s\S]*?Kiosk\.pause\(this\)/);
    // Five taps again locks at once; the family's switch cancels a corner-tap unlock.
    expect(main).toMatch(/if \(Kiosk\.paused\(this\)\) \{\s*Kiosk\.resume\(this\);/);
    expect(kiosk).toMatch(/putBoolean\(KEY_ON, on\)\.putLong\(KEY_PAUSED_UNTIL, 0\)/);
    expect(main).toMatch(/Kiosk\.apply\(this\)/);
    expect(kioskPlugin).toMatch(/@CapacitorPlugin\(name = "InPlaceKiosk"\)/);
    expect(phone).toMatch(/isPluginAvailable\('InPlaceKiosk'\)/);
    expect(phone).toMatch(/<HubKiosk on=\{s\.hub\.kiosk !== false\} \/>/);
    expect(phone).toMatch(/data-testid="hub-kiosk-setting"/);
  });

  test("the device-owner receiver exists for the one adb command", () => {
    expect(manifest).toMatch(/android:name="\.KioskAdminReceiver"[\s\S]*?android:permission="android\.permission\.BIND_DEVICE_ADMIN"[\s\S]*?@xml\/device_admin/);
  });
});

describe("the hub setting", () => {
  const sm = require("../src/utils/simpleMode");
  test("kiosk is on unless turned off, and only a boolean changes it", () => {
    expect(sm.cleanHub({}).kiosk).toBe(true);
    expect(sm.cleanHub({ kiosk: false }).kiosk).toBe(false);
    expect(sm.cleanHub({ kiosk: "no" }).kiosk).toBe(true);
  });
});

describe("drop-in", () => {
  const server = code("src/server.js");
  const invite = server.slice(server.indexOf("async function ringTarget"), server.indexOf("let nativeRang = 0;"));
  test("checked server-side every time, before anything reaches the Hub", () => {
    expect(invite).toMatch(/if \(data\.dropIn === true\)/);
    const check = invite.indexOf("dropIn.mayDropIn(db, cr.id, userId)");
    const emit = invite.indexOf('io.to(sid).emit("call_incoming"');
    expect(check).toBeGreaterThan(0);
    expect(emit).toBeGreaterThan(check);
    expect(invite).toMatch(/if \(!recipientId \|\| !hubSockets \|\| !hubSockets\.size\) \{[\s\S]*?return ack\("nowhere", 0\);/);
  });
  test("a refused drop-in is never turned into an ordinary call", () => {
    // Every path out of the drop-in block returns.
    const block = invite.slice(invite.indexOf("if (data.dropIn === true)"));
    expect(block).not.toMatch(/ringCallDevices|sendPushToUser/);
    expect((block.match(/return ack\(/g) || []).length).toBeGreaterThanOrEqual(3);
  });
  test("the Hub chimes, says who, then answers by itself", () => {
    expect(phone).toMatch(/if \(!incoming \|\| !incoming\.dropIn\) return undefined;[\s\S]*?playDoorbell\(\)[\s\S]*?setTimeout\(\(\) => answerRef\.current\(\), DROP_IN_ANSWER_MS\)/);
    expect(phone).toMatch(/is checking in/);
    // Only offered to someone the server says may drop in.
    expect(phone).toMatch(/onDropIn && v\.mayDropIn && v\.hubUserId/);
  });
});
