# calls-native — running task list (InPlace 1.3: the phone rings like a phone)

Branch `calls-native`. **Not on main, not on staging, never deployed** until 1.2 is approved and
live (Pete, 10/28: "keep the versions separate … they should sit in isolation until we're up and
running"). Version ledger: project doc `claude/InPlace_Version_Ledger.md`.

Background and the iOS rules this has to obey: `CallKit_VoIP_Plan_2026-09-01.md` (Working Folder).

## Done
- [x] **Server: call registry** — `src/utils/callRegistry.js`. Each ring is recorded
      (ringing → answered / declined / missed / ended; missed after 45 s) with a CallKit UUID and a
      signed `callToken` (one room, one person, 2 min) that native code uses without a login.
- [x] **Server: call devices** — own table `call_devices` (migration `078_call_devices` — was 075,
      renumbered 10/29 when main's 075–077 were merged in). `src/utils/callDevices.js`. Kept out of `push_subscriptions`
      so nothing the 1.2 build touches can see it. Cleared on account deletion (3 places).
- [x] **Server: the ring** — `apns.sendApnsVoip` (topic `.voip`, push-type voip, no alert, 45 s
      expiry); Android = data-only high-priority FCM `type: call_ring`. Demo accounts never rung.
- [x] **Server: call_invite** rings call devices first, still emits to open apps (with
      `ringingNatively`), and the ordinary push skips exactly the devices that rang
      (`sendPushToUser(…, { skipEndpoints })`). A native-ring failure is caught and the old ring
      still happens. Caller sees "It's ringing on Jane's phone."
- [x] **Server: /api/calls** — `POST/DELETE /devices` (login; skipped while impersonating);
      `GET /:room/status`, `POST /:room/answer`, `POST /:room/decline` (callToken only). Answer/
      decline reach the caller's app and stop the callee's other apps ringing.
- [x] **Socket accept/decline/hangup** keep the registry current; only the callee may answer or
      decline, only the two people on the call may end it; `call_answered_elsewhere`.
- [x] **Web bridge** — `public/js/nativeCalls.js` (`window.NativeCalls`). Does nothing unless the
      native `InPlaceCalls` plugin exists. Registers the device, takes an answer from the lock
      screen (live or cold start) and joins the room, tells native when the call ends.
      Messages: `acceptCall()`, no double banner when the phone is ringing natively, hang-up works
      with no conversation open (`remoteUserId`).
- [x] **Tests** — `tests/callsNative.test.js`; `callRinging.test.js` updated for the "phone" outcome.
      Unit 2871 ✓, integration 1143 ✓, all lints ✓, architecture doc regenerated.

- [x] **Merged main into this branch (10/29)** — main → calls-native only, never the other way.
      Generated files (bundle, sw.js, index.html, ARCHITECTURE.md) rebuilt from the merged source.
- [x] **iOS native — 1.3 (Build 11)**, `ios/App/App/`:
  - `CallManager.swift`: PushKit started from AppDelegate at every launch; each VoIP push is
    reported to CallKit at once, in Swift (stale/malformed ones reported then ended); 3 s status
    poll while ringing ends it as answered-elsewhere / declined-elsewhere / missed / caller hung up;
    Answer → `POST …/answer` and only joins if the server says this phone `won`; Decline →
    `POST …/decline`; End on the system screen → web hangs up; Mute → web really mutes; talks to
    the same server as the web view (`capacitor.config.json`). Not in Phone's Recents.
  - `InPlaceCallsPlugin.swift`: `getDeviceToken`, `getPendingAnswer`, `endCall`; events
    `callAnswered` (held until a listener exists), `callEnded`, `callMuted`, `tokenChanged`.
    Registered in `InPlaceViewController.capacitorDidLoad`.
  - Info.plist `UIBackgroundModes` = audio, voip (only). Xcode project: both files in the target;
    **MARKETING_VERSION 1.3, CURRENT_PROJECT_VERSION 11**.
  - Server: answer/decline return `won`. Web: End/Mute from the system screen reach the call.
  - Tests: `tests/callsNativeIos.test.js` (wiring, mutation-checked); store-build guards updated to
    1.3's exact facts. Unit 2887 ✓, integration 1161 ✓, lints ✓.

## Next — Claude
- [ ] **Android native** — FirebaseMessagingService handling `type=call_ring` without breaking
      the Capacitor push plugin's own service (one service must forward to the other);
      full-screen-intent call notification with Answer/Decline; same status poll and HTTP
      answer/decline; `USE_FULL_SCREEN_INTENT`, `POST_NOTIFICATIONS`.
- [ ] Integration test: register a call device → invite → the banner push skips that endpoint.
- [ ] What's New card for 1.3 ("Calls ring like a phone call"), with a drawn preview.
- [ ] Missed-call row in Activity when a native ring goes unanswered (today only the push wrote one).

## Next — Pete [NEEDS YOUR HANDS]
- [ ] Two-phone receive test on the 1.2 build (app open / backgrounded / locked). Write down what each did.
- [ ] Finish the key rotations calling depends on: APNs key and the Firebase service account.
- [ ] Decide: ring **every** device at once (recommended; first to answer stops the others — built
      that way) or only the most recent.
- [ ] Build 1.3 from its OWN folder (`kincare-1.3`, a separate clone on this branch — never the
      everyday `kincare-repo`). Background Modes are already in Info.plist; in Xcode just confirm
      Signing & Capabilities shows them. First goal: it compiles. Report any red errors verbatim.
- [ ] Watch for (the open questions only a phone answers): does Twilio audio flow when a call
      is answered on the LOCKED screen without opening the app? Does the caller's name show?
- [ ] Play Console, only after vc22 is approved: the full-screen intent declaration (Claude drafts).

## Release (after 1.2 is live)
- [ ] Rebase on main; renumber migration if needed; bump APP_VERSION; staging; then prod with Pete's OK.
- [ ] 1.3 test builds: TestFlight **Build 11+**, Play internal **vc23+**. Iterate until a locked phone rings.
- [ ] Submit 1.3 with reviewer notes explaining the calling.
