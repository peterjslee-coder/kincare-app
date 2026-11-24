// A web call has to survive a minute on an iPhone. (v1.105.173)
//
// Sara called Pete on voice: "it worked for a minute but then went quiet." She is on the WEB
// app — her client reports platform "web", Safari on iOS 18.7 — and an iPhone's Auto-Lock is
// 30 seconds or a minute. When an iOS web page is backgrounded or the screen locks, Safari
// suspends it and WebRTC media stops dead. The native app can hold a call in the background;
// a page cannot, unless it asks the screen to stay awake.
//
// Four things were wrong, and none of them would have shown up as an error anywhere.

const { code } = require("./helpers/source");
const overlay = code("public/js/components/VideoCallOverlay.js");

describe("the screen stays awake for the length of the call", () => {
  test("a wake lock is requested", () => {
    expect(overlay).toMatch(/navigator\.wakeLock\.request\('screen'\)/);
  });

  test("it is taken when we join the room, not when someone answers", () => {
    // A phone that locks while it is still ringing has the same problem.
    const join = overlay.slice(overlay.indexOf("setRoom(twilioRoom);"), overlay.indexOf("// Attach local tracks"));
    expect(join).toMatch(/requestWakeLock\(\)/);
  });

  test("and re-taken every time the page comes back", () => {
    // The browser releases the lock whenever the page is hidden, so asking once covers the
    // first minute only.
    expect(overlay).toMatch(/addEventListener\('visibilitychange', onVisible\)/);
    const handler = overlay.slice(overlay.indexOf("const onVisible = () =>"), overlay.indexOf("document.addEventListener('visibilitychange'"));
    expect(handler).toMatch(/requestWakeLock\(\)/);
    expect(handler).toMatch(/resumeAudio\(\)/);
  });

  test("it is released when the call ends, and on unmount", () => {
    // A screen that never sleeps again is a worse bug than the one being fixed.
    expect(overlay).toMatch(/function handleEndCall\(\) \{[\s\S]{0,120}releaseWakeLock\(\)/);
    expect(overlay).toMatch(/cancelled = true;\s*\n\s*releaseWakeLock\(\)/);
    expect(overlay).toMatch(/twilioRoom\.on\('disconnected'[\s\S]{0,160}releaseWakeLock\(\)/);
  });

  test("a browser without the API still makes calls", () => {
    expect(overlay).toMatch(/if \(!navigator\.wakeLock \|\| wakeLockRef\.current\) return;/);
  });
});

describe("a dropped connection is not a finished call", () => {
  test("the SDK's own reconnect events are handled", () => {
    // Twilio retries on its own; nothing listened, so the screen kept showing a running timer
    // over a call that had gone silent.
    expect(overlay).toMatch(/twilioRoom\.on\('reconnecting'/);
    expect(overlay).toMatch(/twilioRoom\.on\('reconnected'/);
  });

  test("the remote side's reconnect is handled too — the common case on a phone", () => {
    expect(overlay).toMatch(/participant\.on\('reconnecting'/);
    expect(overlay).toMatch(/participant\.on\('reconnected'/);
  });

  test("'Reconnecting…' outranks the duration on both call types", () => {
    // A running timer over a dead call is a lie, and it is the reason nobody knows to hang up.
    expect((overlay.match(/reconnecting \? 'Reconnecting\\u2026'/g) || [])).toHaveLength(2);
  });
});

describe("audio that the browser refused to play says so", () => {
  test("play() is called and its rejection is caught", () => {
    // `play()` returns a promise that REJECTS on an autoplay block. Ignoring it is how a call
    // goes silent with no error anywhere.
    expect(overlay).toMatch(/const r = el\.play\(\);/);
    expect(overlay).toMatch(/\.catch\(\(\) => setAudioBlocked\(true\)\)/);
  });

  test("every remote audio element is played, not just created", () => {
    const attach = overlay.slice(overlay.indexOf("function attachTrack"), overlay.indexOf("function detachTrack"));
    expect(attach).toMatch(/playRemoteAudio\(audioEl\)/);
    expect(attach).toMatch(/setAttribute\('playsinline', 'true'\)/);
  });

  test("a reconnect re-asks the audio to play", () => {
    // The tracks survive a reconnect; their elements may have been suspended by iOS while the
    // page was hidden.
    expect(overlay).toMatch(/twilioRoom\.on\('reconnected'[\s\S]{0,400}resumeAudio\(\)/);
  });

  test("and there is a way out that is a user gesture", () => {
    // One tap is all iOS wanted. Both call types offer it.
    expect((overlay.match(/onClick: resumeAudio/g) || [])).toHaveLength(2);
    expect(overlay).toMatch(/Tap to hear them/);
  });
});

describe("a blip is not a hang-up", () => {
  test("a vanished remote gets a grace period, not 1.5 seconds", () => {
    // A remote who disappears might have hung up, or might be a phone moving from wifi to
    // cellular in a hallway. Ending the call in a second and a half made those the same thing.
    expect(overlay).not.toMatch(/setTimeout\(\(\) => \{\s*\n\s*handleEndCall\(\);\s*\n\s*\}, 1500\)/);
    expect(overlay).toMatch(/remoteGraceTimer\.current = setTimeout\([\s\S]{0,320}\}, 12000\)/);
  });

  test("coming back cancels it", () => {
    expect(overlay).toMatch(/clearRemoteGrace\(\);\s*\/\/ \.\.\.or back after all/);
  });

  test("and it only gives up if the room really is empty", () => {
    // Not "the timer fired", but "they are still not here".
    expect(overlay).toMatch(/if \(room && room\.participants\.size === 0\) handleEndCall\(\);/);
  });

  test("the grace timer is cleared on end and on unmount", () => {
    expect(overlay).toMatch(/function handleEndCall\(\) \{[\s\S]{0,120}clearRemoteGrace\(\)/);
    expect(overlay).toMatch(/if \(remoteGraceTimer\.current\) \{ clearTimeout\(remoteGraceTimer\.current\)/);
  });
});
