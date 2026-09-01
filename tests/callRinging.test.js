// A call has to ring the person who is NOT looking at their phone. (v1.105.99)
//
// Pete: "Phone and video calls do not ring or notify the user until I push notification after
// the call." The signalling was socket-only:
//
//     const targetSockets = connectedUsers.get(data.targetUserId);
//     if (targetSockets) { ...emit call_incoming... }
//
// No else. A socket exists only while the app is open and foregrounded, so an incoming call
// reached exactly the person who did not need telling — and if the phone was locked or the app
// backgrounded, the invite went nowhere at all, silently. Which is every real call.

const fs = require("fs");
const path = require("path");
const REPO = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8");

const server = read("src/server.js");
const app = read("public/js/app.js");
const messages = read("public/js/components/Messages.js");

const inviteHandler = server.slice(
  server.indexOf('socket.on("call_invite"'),
  server.indexOf('socket.on("call_accept"')
);

describe("no live socket means push, not silence", () => {
  test("the socket-only branch has an else", () => {
    expect(inviteHandler).toMatch(/} else {/);
    expect(inviteHandler).toMatch(/sendPushToUser/);
  });

  test("an empty socket set counts as absent, not present", () => {
    // connectedUsers holds a Set; an entry can exist with zero sockets after a disconnect,
    // and `if (targetSockets)` would still be truthy for it.
    expect(inviteHandler).toMatch(/targetSockets && targetSockets\.size > 0/);
  });

  test("push carries what is needed to answer", () => {
    for (const field of ["roomName", "callType", "callerId", "callerName"]) {
      expect(inviteHandler).toMatch(new RegExp(field));
    }
    expect(inviteHandler).toMatch(/type: "call_incoming"/);
  });

  test("a failed push is reported, never swallowed", () => {
    // The difference between a ringing phone and nothing at all is not a silent catch.
    expect(inviteHandler).toMatch(/console\.error\("call_invite push failed:/);
    expect(inviteHandler).toMatch(/captureException/);
  });
});

describe("push only when they are away", () => {
  test("a live socket gets the socket event and NO push", () => {
    // Pete's other report (97783012): push while already in the app is noise. The socket is
    // the signal that they are here.
    const ifBranch = inviteHandler.slice(0, inviteHandler.indexOf("} else {"));
    expect(ifBranch).toMatch(/emit\("call_incoming"/);
    expect(ifBranch).not.toMatch(/sendPushToUser/);
  });
});

describe("tapping the call push actually answers", () => {
  test("app.js routes call_incoming to messages with the call parked", () => {
    expect(app).toMatch(/t === 'call_incoming'/);
    expect(app).toMatch(/window\.__pendingCall = \{/);
  });

  test("Messages picks it up on mount", () => {
    // Otherwise the tap lands her in Messages with no idea why she is there.
    expect(messages).toMatch(/window\.__pendingCall/);
    expect(messages).toMatch(/setIncomingCall\(window\.__pendingCall\)/);
  });
});

// ─── v1.105.131 — the buttons themselves ───
//
// The other half of this P0 as filed ("the call buttons have VANISHED from chat", e452db48
// + d378b267) was retracted by Pete during triage on 8/19: "no the buttons are there. i
// don't like the buttons...they're ugly, but their there." What was left was real, and
// small: two 36px outlined squares, under Apple's 44x44 minimum, with a hardcoded #1b6b5a
// border that ignored the theme and a hover written in JS.
describe("the call buttons are reachable, themed, and hard to lose", () => {
  const fs = require("fs");
  const path = require("path");
  const read = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");
  const msgs = read("public", "js", "components", "Messages.js");
  const css = read("public", "css", "styles.css");

  test("both are in the chat header, and nothing gates them", () => {
    expect(msgs).toMatch(/className="msg-call-btn"[\s\S]{0,200}handleStartCall\('voice'\)/);
    expect(msgs).toMatch(/className="msg-call-btn"[\s\S]{0,200}handleStartCall\('video'\)/);
  });

  test("they clear 44x44", () => {
    const rule = css.slice(css.indexOf(".msg-call-btn {"), css.indexOf(".msg-call-btn + .msg-call-btn"));
    expect(rule).toMatch(/width: 44px/);
    expect(rule).toMatch(/height: 44px/);
  });

  test("hover is CSS, not onMouseEnter — a tap is not a hover", () => {
    // On a touch screen onMouseEnter fires on TAP and onMouseLeave never does, so the button
    // you just called from stayed inverted until something else re-rendered it.
    const first = msgs.indexOf('className="msg-call-btn"');
    const last = msgs.lastIndexOf('className="msg-call-btn"');
    const buttons = msgs.slice(first, last + 900); // both buttons and nothing else
    expect(buttons).toMatch(/handleStartCall\('video'\)/); // the slice really does reach the second
    expect(buttons).not.toMatch(/onMouseEnter/);
    expect(buttons).not.toMatch(/onMouseLeave/);
    expect(css).toMatch(/@media \(hover: hover\) \{\s*\.msg-call-btn:hover/);
  });

  test("no hardcoded brand colour — dark mode gets the same button", () => {
    const rule = css.slice(css.indexOf(".msg-call-btn {"), css.indexOf(".msg-call-btn + .msg-call-btn"));
    expect(rule).not.toMatch(/#1b6b5a/);
    expect(rule).toMatch(/var\(--role-color\)/);
  });

  test("a long name cannot push them off a panel that clips", () => {
    // min-width:auto is a flex child's default, so the name block could not shrink; the
    // panel is overflow:hidden, so what it pushed out was simply gone.
    expect(msgs).toMatch(/flex: 1, minWidth: 0 \}\}>/);
  });
});

// ─── v1.105.131 → .132 — the keyboard was taking the header with it ───
//
// Pete, 8/24: "they show, but only at the very top of the chat...gotta scroll all the way up
// to find them. open the keyboard?...they gone to the top." Then, after .131: "still do not
// work… if I minimize the keyboard, the button is returned to the top of the screen where I
// would expect them to be all the time." So the buttons and the header are both fine; the
// keyboard moves them, and .131 did not stop it.
//
// MEASURED ON PRODUCTION at 500x701 before either attempt: the panel is bounded (646px), the
// header is sticky at top 0, and .msg-messages-area is the only scroller (508 of 779). The
// layout is right. What a desktop browser does not have is a keyboard.
//
// .131 got two things wrong, and both are worth keeping as tests:
//   1. It called window.scrollTo(0, 0) — but this component injects html,body{position:fixed}
//      on mobile, so the window cannot scroll and scrollY is always 0. Dead code that looked
//      like a fix.
//   2. It resized .msg-panel. The panel is not what is anchored: on mobile ALL of Messages
//      renders inside a position:fixed container pinned top:0 → bottom:safeBottom+55, laid
//      out against the LAYOUT viewport, while the keyboard changes the VISUAL one.
describe("the keyboard cannot push the header off screen", () => {
  const fs = require("fs");
  const path = require("path");
  const read = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");
  const msgs = read("public", "js", "components", "Messages.js");
  const css = read("public", "css", "styles.css");

  test("the FIXED CONTAINER follows the visible region — not the panel", () => {
    expect(msgs).toMatch(/top: vvBox \? vvBox\.top : 0,/);
    expect(msgs).toMatch(/height: \(kbOpen \? vvBox\.height : Math\.max\(0, vvBox\.height - safeBot - 55\)\) \+ 'px', bottom: 'auto'/);
  });

  test("the .131 attempt is gone — the part that was actually wrong", () => {
    // .131 sized `.msg-panel`, which is not what is anchored. That stays gone.
    expect(css).not.toMatch(/body\.msg-keyboard-open/);
    expect(msgs).not.toMatch(/msg-keyboard-open/);
    // Its scrollTo(0,0) is BACK, on purpose, in .136 — see below. It was dead code in .131
    // only because the body was position:fixed and could not scroll; .135 removed that.
    expect(msgs).toMatch(/window\.scrollTo\(0, 0\)/);
  });

  test("the nav's 55px is only reserved while the keyboard is DOWN", () => {
    // While typing the nav is behind the keyboard; holding its space is what pushed the
    // composer up into the conversation in his screenshot.
    const box = msgs.slice(msgs.indexOf("const kbOpen ="), msgs.indexOf("const kbOpen =") + 200);
    expect(box).toMatch(/vvShrunk \|\| \(inputFocused && hasSoftKeyboard\)/);
  });

  test("a WebView that shrinks the LAYOUT viewport is still detected", () => {
    // In that mode innerHeight, vv.height and vv.offsetTop all agree with each other and all
    // are wrong, so no measurement sees a keyboard. A focused composer is one in every mode.
    expect(msgs).toMatch(/onFocus=\{\(\) => \{ setInputFocused\(true\)/);
    expect(msgs).toMatch(/onBlur=\{\(\) => setInputFocused\(false\)\}/);
    // ...and only where focusing an input summons one. A 500px-wide desktop window is
    // `isMobile` by width and has no keyboard at all.
    expect(msgs).toMatch(/window\.matchMedia\('\(pointer: coarse\)'\)\.matches/);
  });

  test("neither a URL bar nor a bottom toolbar is a keyboard", () => {
    // This asserted `hidden > 120 || top > 0 || scrolled > 120` until v1.105.166. The 120px
    // threshold was meant to ignore a URL bar COLLAPSING — a change of ~50px. What it missed
    // is the URL bar and the bottom toolbar simply BEING THERE: in mobile Safari innerHeight
    // is the full layout viewport while visualViewport.height is the visible band, and the
    // difference is ~120-140px, over the threshold, with no keyboard anywhere. A false
    // "keyboard up" makes this container stop reserving the nav's 55px, and the composer
    // goes under a z-index-900 nav. Pete, on Debbie's screen: "there's no clear way to enter
    // text... you have to just click around on the bottom and it eventually brings up the new
    // message space" — clicking around collapses the chrome and the composer reappears.
    //
    // What is left are the two signals that are POSITIONS rather than sizes. Browser chrome
    // does not push the visual viewport down or scroll the document; a keyboard does.
    expect(msgs).toMatch(/setVvShrunk\(top > 0 \|\| scrolled > 120\);/);
    expect(msgs).not.toMatch(/setVvShrunk\([^)]*hidden/);
  });

  test("no visualViewport, no change in behaviour", () => {
    expect(msgs).toMatch(/if \(!vv\) return; \/\/ no API, no change in behaviour/);
    expect(msgs).toMatch(/: \{ bottom: \(safeBot \+ 55\) \+ 'px' \}\)/);
  });

  test("the document scroll is subtracted from the visual-viewport offset", () => {
    // v1.105.134. Pete's own readout, on a real iPhone, with the keyboard up:
    //     iH 568 · vv 499@344 · hid -275 · sy 344 · kb up·focus
    // window.scrollY is 344, so the document DID scroll (v1.105.131's "the window can never
    // scroll under position:fixed" was false on the device), and vv.offsetTop is exactly equal
    // to it — this engine reports the offset against the DOCUMENT. A position:fixed container
    // is laid out against the layout viewport, which that scroll has already moved, so .132
    // pushed it 344px down inside a 568px viewport and left 224px on screen: "a little tiny
    // window", plus a second scrollbar because the list had to scroll inside the band.
    expect(msgs).toMatch(/const scrolled = Math\.round\(window\.scrollY \|\| 0\);/);
    expect(msgs).toMatch(/const top = Math\.max\(0, Math\.round\(vv\.offsetTop \|\| 0\) - scrolled\);/);
  });

  test("`hidden` survives as a readout, not as a decision", () => {
    // iH 568 with vv 499@344 gave hidden = -275, so this half of the detection never fired
    // on the device at all — only the focused composer did. It went on firing on OTHER
    // devices, wrongly (see above), which is why v1.105.166 took it out of the decision. It
    // stays in the diagnostic line, where a number that is sometimes -275 is informative
    // rather than harmful.
    expect(msgs).toMatch(/const hidden = Math\.round\(window\.innerHeight - height\);/);
    expect(msgs).toMatch(/hidden,/); // still reported in kbDebug
  });

  test("the body is no longer pinned — the cause, not the symptom", () => {
    // v1.105.135. Pete's readout, keyboard up, on a body that is position:fixed AND
    // overflow:hidden — i.e. unscrollable:
    //     iH 499 · vv 499@413 · hid 0 · sy 413 · top 0 · kb up·focus
    // window.scrollY is 413. That is iOS scrolling the page to the focused input anyway, and
    // on a FIXED body it drags the page up while leaving fixed elements anchored where the
    // page used to be — so the container rendered 413px above the screen and only its bottom
    // edge was visible: the composer at the top, conversation below it.
    //
    // Three versions tried to compute that displacement back out. It cannot be done: the same
    // phone reported it two incompatible ways within a minute (iH 568 · vv 499@344, then
    // iH 499 · vv 499@413), because whether the LAYOUT viewport also shrinks is up to the
    // WebView. Removing position:fixed removes the thing being displaced.
    const lock = msgs.slice(msgs.indexOf("data-messages-lock"), msgs.indexOf("data-messages-lock") + 600);
    expect(lock).not.toMatch(/position:fixed/);
    expect(lock).toMatch(/overflow:hidden!important/);
    expect(lock).toMatch(/height:100%!important/);
    // ...and the rubber-banding that position:fixed was brought in for is handled properly.
    expect(lock).toMatch(/overscroll-behavior:none!important/);
  });

  test("the readout is OFF unless it is asked for", () => {
    // Pete: "note the coordinate display, which obviously can't be there in production."
    // Admin-only is not off — it was on for him, on every device, all the time.
    expect(msgs).not.toMatch(/currentUser\?\.is_admin && kbDebug/);
    expect(msgs).toMatch(/\{kbDebugOn && kbDebug && \(/);
    expect(msgs).toMatch(/localStorage\.getItem\('kbdebug'\) === '1'/);
    expect(msgs).toMatch(/if \(q === '0'\) localStorage\.removeItem\('kbdebug'\);/);
  });

  test("but the numbers are still there when asked for — and say which build", () => {
    for (const k of ["iH", "vvH", "vvT", "hidden", "sY", "top"]) {
      expect(msgs).toMatch(new RegExp(`kbDebug\\.${k}`));
    }
    // I could not tell from the server which build his PHONE was running — the
    // client-versions row is per user, and his Mac had already overwritten it. The readout
    // says so itself now.
    expect(msgs).toMatch(/v\{window\.APP_VERSION \|\| '\?'\}/);
  });

  test("the switch is reachable without typing a URL", () => {
    // Pete, told to load "yourinplace.com/?kbdebug=1": "i don't know what you mean by that."
    // Right twice: it is jargon, and he opens the app from his home screen, where there is no
    // address bar to type it into.
    const acct = read("public", "js", "components", "MyAccount.js");
    expect(acct).toMatch(/user\?\.is_admin && \(/);
    expect(acct).toMatch(/Keyboard diagnostics/);
    expect(acct).toMatch(/localStorage\.setItem\('kbdebug', '1'\)/);
    expect(acct).toMatch(/localStorage\.removeItem\('kbdebug'\)/);
  });

  test("the page is pulled back for as long as the keyboard takes to animate", () => {
    // v1.105.136. .131 called scrollTo(0,0) once on a position:fixed body and I later called
    // it dead code — right THEN. .135 unpinned the body, so the page can be scrolled by iOS
    // and put back by us. One call is still not enough: iOS scrolls to the focused input
    // while the keyboard is still animating, so a single reset fired first is undone a frame
    // later.
    expect(msgs).toMatch(/const pullPageBack = \(\) => \{/);
    expect(msgs).toMatch(/if \(\+\+n < 20\) requestAnimationFrame\(pullPageBack\);/);
    expect(msgs).toMatch(/if \(scrolled > 0\) settle\(\);/);
    expect(msgs).toMatch(/onFocus=\{\(\) => \{ setInputFocused\(true\); if \(settleRef\.current\) settleRef\.current\(\); \}\}/);
  });

});

// ─── v1.105.137 — what the keyboard fix broke on the way past ───
//
// Pete, on .136: "display looks good, but when I send a text it requires me to hit send again
// after it's dropped to the bottom. then when i try to enter another text, it hides the text I
// just sent."
//
// Both are consequences of the container now RESIZING when the keyboard moves — which is the
// fix working, and two things that were never right becoming visible.
describe("sending a message, with the keyboard doing what it does", () => {
  const fs = require("fs");
  const path = require("path");
  const read = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");
  const msgs = read("public", "js", "components", "Messages.js");

  test("Send does not blur the composer", () => {
    // Touching the button blurs the textarea, the keyboard starts to dismiss, the container
    // resizes — and by the time the CLICK resolves the button has moved out from under his
    // finger. The second tap works because the keyboard is already down and nothing moves.
    expect(msgs).toMatch(/className="msg-send-btn" onMouseDown=\{\(e\) => e\.preventDefault\(\)\} onClick=\{handleSendMessage\}/);
  });

  test("the list is pinned to the bottom when the BOX changes, not only when messages do", () => {
    // "it hides the text I just sent": the keyboard shrinks the container, the list keeps the
    // scroll offset it had while it was taller, and the newest message sits behind the
    // composer. `messages` did not change, so the existing effect never ran.
    expect(msgs).toMatch(/useEffect\(\(\) => \{ pinToBottom\(false\); \}, \[vvBox, kbOpen, pinToBottom\]\);/);
    // v1.105.145 — the messages effect now distinguishes opening a thread from receiving in
    // one (see messagesReadingAndTyping.test.js); the BOX effect is unchanged and is what
    // this test is about.
    expect(msgs).toMatch(/\}, \[messages, activeConvId, pinToBottom\]\);/);
  });

  test("pinning scrolls the LIST and can never scroll the page", () => {
    // scrollIntoView() scrolls every scrollable ANCESTOR too, including the document. That was
    // harmless while the body was position:fixed; .135 removed that pin, so it became a way to
    // reintroduce the exact displacement .135 and .136 exist to prevent.
    const code = msgs.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    expect(code).not.toMatch(/scrollIntoView/);
    expect(msgs).toMatch(/area\.scrollTop = top;/);
    expect(msgs).toMatch(/area\.scrollTo\(\{ top, behavior: 'smooth' \}\)/);
  });

  test("the sentinel it replaced is gone with it", () => {
    // An unused ref and an empty div at the end of every conversation is exactly the dead
    // code this repo's lint gate hunts.
    expect(msgs).not.toMatch(/messagesEndRef/);
  });
});

// ─── v1.105.139 — the call UI met the phone's own furniture ───
//
// Three feedback items in one evening, all "terrible" or "bad", all the same root cause: the
// call surfaces are laid out against the RAW viewport, so on an iPhone they end up underneath
// the status bar at the top and the home indicator at the bottom.
//
//   4edb6642  "Saw a call come through from Julia. Couldn't answer it because the button was
//             behind the top banner."
//   538d4d05  "Phone call in app looks terrible and hidden behind bottom row."
//   d149b793  "Video call froze the app had to close out and relaunch."
//
// The third is the same bug as the second, one step further on: the End Call button sat in the
// home-indicator strip, and a call you cannot hang up IS a frozen app — relaunching was the
// only exit available.
describe("a call fits on the phone it is ringing on", () => {
  const fs = require("fs");
  const path = require("path");
  const read = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");
  const msgs = read("public", "js", "components", "Messages.js");
  const overlay = read("public", "js", "components", "VideoCallOverlay.js");

  test("the incoming-call banner clears the notch", () => {
    // It was position:fixed top:0 with no inset, so Accept was under the status bar.
    expect(msgs).toMatch(/padding: '16px 24px', paddingTop: 'calc\(16px \+ var\(--sat, 0px\)\)'/);
  });

  test("Accept and Decline are 44px — you are answering a ringing phone", () => {
    const banner = msgs.slice(msgs.indexOf("const renderIncomingCallBanner"));
    const head = banner.slice(0, banner.indexOf("};"));
    expect((head.match(/minHeight: 44/g) || []).length).toBe(2);
  });

  test("the End Call button clears the home indicator", () => {
    // The one that made "hidden behind bottom row" into "had to close out and relaunch".
    expect(overlay).toMatch(/bottom: 'calc\(40px \+ var\(--sab, 0px\)\)'/);
  });

  test("so does everything else anchored to an edge", () => {
    expect(overlay).not.toMatch(/bottom: 115,/);
    expect(overlay).not.toMatch(/\n\s+top: 16,\n\s+right: 16,/);
    expect(overlay).toMatch(/top: 'calc\(20px \+ var\(--sat, 0px\)\)'/);
  });

  test("a connect that never answers gives up and says so", () => {
    // Twilio's connect has no deadline of its own. Without one, a hung call is a full-screen
    // black overlay reading "Connecting..." forever — which is the other half of "froze".
    expect(overlay).toMatch(/Promise\.race\(\[\s*\n\s*Video\.connect\(token, connectOptions\)/);
    expect(overlay).toMatch(/Couldn't connect the call\. Check your signal and try again\./);
  });

  test("ending a call works even when there is no room to leave", () => {
    // The escape hatch must not depend on the thing that failed.
    // Slice to the end of the function rather than a fixed number of characters: v1.105.173
    // added two lines to the top of it and pushed onEndCall past a 400-char window, failing a
    // test whose subject had not changed at all.
    const from = overlay.indexOf("function handleEndCall");
    const fn = overlay.slice(from, overlay.indexOf("\n  }", from));
    expect(fn).toMatch(/if \(roomRef\.current\)/);
    expect(fn).toMatch(/if \(onEndCall\) onEndCall/);
    // ...and the room's absence must not stop any of it.
    expect(fn.indexOf("if (onEndCall) onEndCall")).toBeGreaterThan(fn.indexOf("if (roomRef.current)"));
  });
});

// ─── v1.105.140 — two causes, one of them provable from the DOM ───
//
// Pete: "it tried to connect but still can't" and "the hang-up and mic button is better, but
// still hiding a little behind the bottom banner."
describe("a call is on top of the app, and says why when it fails", () => {
  const fs = require("fs");
  const path = require("path");
  const read = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");
  const msgs = read("public", "js", "components", "Messages.js");
  const overlay = read("public", "js", "components", "VideoCallOverlay.js");
  const css = read("public", "css", "styles.css");

  test("z-index 10000 inside a z-index 1 box loses to a nav at 900", () => {
    // The proof, not the theory: the mobile Messages container really does set zIndex 1, and
    // the nav really is 900 at the app level. Everything inside that container — the call
    // overlay's 10000, the incoming banner's 9999 — is resolved WITHIN a context worth 1.
    // The safe-area insets in .139 were real, and were treating a symptom.
    expect(msgs).toMatch(/zIndex: 1,/);
    expect(css).toMatch(/z-index: 900;/);
  });

  test("so both call surfaces are portalled out of it", () => {
    expect(msgs).toMatch(/ReactDOM\.createPortal\(node, document\.body\)/);
    expect(msgs).toMatch(/const callOverlay = toBody\(/);
    expect(msgs).toMatch(/return toBody\(\s*\n\s*<div style=\{\{\s*\n\s*position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,/);
  });

  test("and it degrades to the old behaviour if ReactDOM has no portal", () => {
    expect(msgs).toMatch(/typeof ReactDOM !== 'undefined' && ReactDOM\.createPortal/);
  });

  test("the microphone is asked for FIRST, so a refusal is legible", () => {
    // Probed production before writing this: /api/video/token returns a valid JWT, the
    // self-hosted SDK loads (2.28.1), and Video.connect with audio:false/video:false reached a
    // real Twilio room. Signalling, CSP and credentials are all fine. Local media is what the
    // probe skipped, and Twilio acquires it INSIDE connect(), where a refusal comes back as an
    // opaque connect failure — "tried to connect but still can't".
    expect(overlay).toMatch(/navigator\.mediaDevices\.getUserMedia\(\{/);
    const acquire = overlay.indexOf("navigator.mediaDevices.getUserMedia({");
    const connect = overlay.indexOf("const connectOptions = {");
    expect(acquire).toBeGreaterThan(-1);
    expect(acquire).toBeLessThan(connect); // first, not inside connect()
  });

  test("each refusal gets a sentence a person can act on", () => {
    expect(overlay).toMatch(/name === 'NotAllowedError' \|\| name === 'SecurityError'/);
    expect(overlay).toMatch(/Allow it in Settings/);
    expect(overlay).toMatch(/name === 'NotFoundError'/);
    expect(overlay).toMatch(/name === 'NotReadableError'/);
    // ...and a WebView with no capture API at all names itself rather than "failed".
    expect(overlay).toMatch(/won\\u2019t let InPlace use the microphone from here/);
  });

  test("the failure is reported, with the one field that is the diagnosis", () => {
    expect(overlay).toMatch(/mediaErrorName: name \|\| 'unknown'/);
    expect(overlay).toMatch(/standalone: !!\(window\.navigator\.standalone/);
    expect(overlay).toMatch(/capacitor: !!\(window\.Capacitor/);
  });

  test("we hand Twilio the tracks we already took, and nobody is asked twice", () => {
    expect(overlay).toMatch(/tracks: mediaTracks,/);
    expect(overlay).not.toMatch(/audio: true,\n\s+video: callState\.callType === 'video' \? \{\n\s+facingMode/);
  });

  test("and we give the microphone back on every exit", () => {
    // Twilio stops the tracks it creates; tracks handed to it are ours. A microphone still
    // lit after a call has ended is the worst bug a care app could ship.
    expect(overlay).toMatch(/function stopAcquiredTracks\(\)/);
    const ends = overlay.match(/acquiredTracksRef\.current = \[\];/g) || [];
    expect(ends.length).toBe(3); // end call, unmount, and a connect that failed
  });
});

// ─── v1.105.141 — "not sure if it rang on her side" ───
//
// Pete, after the first call that got as far as showing his own video: "Julia didn't pick up,
// not sure if it rang on her side or she's just not available."
//
// He could not have known. The caller's screen said "Ringing…" whether the invite reached her
// open app, went out as a push, or reached nothing at all — three very different facts wearing
// one word. And two of those branches were silent by construction.
describe("the caller is told what happened to the invite", () => {
  const fs = require("fs");
  const path = require("path");
  const read = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");
  const server = read("src", "server.js");
  const push = read("src", "routes", "push.js");
  const msgs = read("public", "js", "components", "Messages.js");
  const overlay = read("public", "js", "components", "VideoCallOverlay.js");

  test("every branch of call_invite answers the caller", () => {
    expect(server).toMatch(/socket\.emit\("call_ring_status", \{ roomName: data\.roomName, via, devices/);
    expect(server).toMatch(/ack\("app", targetSockets\.size\)/);
    expect(server).toMatch(/ack\(sent > 0 \? "push" : "nowhere", sent\)/);
    expect(server).toMatch(/ack\("nowhere", 0\)/); // the push threw
  });

  test("sendPushToUser stops returning into the void", () => {
    // For a digest, `return` is fine. For a call it is the difference between "her phone is
    // ringing" and "nothing happened anywhere" — and the caller saw "Ringing…" either way.
    expect(push).toMatch(/return \{ sent: 0, failed: 0, removed: 0, reason: "no_devices" \}/);
    expect(push).toMatch(/return \{ sent: 0, failed: 0, removed: 0, reason: "opted_out" \}/);
    expect(push).toMatch(/return \{ sent: 0, failed: 0, removed: 0, reason: "demo_user" \}/);
  });

  test("a CALL is not subject to the notification opt-out", () => {
    // sendPushToUser drops anything whose push_<eventType> preference is false, silently.
    // Right for a digest, wrong for a ringing phone: not wanting calls from someone is a
    // block, not a preference toggle. The call push passes no eventType.
    const invite = server.slice(server.indexOf('socket.on("call_invite"'), server.indexOf('socket.on("call_accept"'));
    expect(invite).toMatch(/const result = await sendPushToUser\(data\.targetUserId, \{/);
    expect(invite).not.toMatch(/\}, "call_incoming"\);/);
    // ...and the in-app record still lands, so a missed call is visible either way.
    expect(invite).toMatch(/type: "call_incoming"/);
  });

  test("the client listens, and resets per call", () => {
    expect(msgs).toMatch(/onSocketEvent\('call_ring_status'/);
    expect(msgs).toMatch(/setRingStatus\(null\); \/\/ this call's answer, not the last one's/);
    expect(msgs).toMatch(/ringStatus: ringStatus,/);
    expect(msgs).toMatch(/return \(\) => \{ cleanupRing\(\); cleanup\(\); cleanup2\(\); cleanup3\(\); \};/);
  });

  test("each outcome gets a sentence, not a status word", () => {
    expect(overlay).toMatch(/has InPlace open — it's ringing on their screen/);
    expect(overlay).toMatch(/isn't in the app\. We've sent a notification to their phone/);
    expect(overlay).toMatch(/has no device set up for notifications\. They'll see a missed call/);
  });

  test("it is for the caller only, and stops once someone answers", () => {
    // The person receiving a call does not need to be told how it reached them, and once it
    // is connected, how it rang stops mattering.
    expect(overlay).toMatch(/status === 'connected' \|\| callState\.callDirection !== 'outgoing'\) \? null/);
  });
});

// ─── v1.105.143 — "not sure it's actually ringing" ───
//
// Pete, with .141's honest line on screen: "says they aren't in the app but notifying their
// phone...but no one ever picks up. not sure it's actually ringing."
//
// It wasn't, in the sense he means. Two separate silences:
//   • App OPEN: the invite arrives over the socket and drew a silent green banner. Look away
//     for ten seconds and the call came and went with no sound at all.
//   • App CLOSED: the push arrived as the same banner every other notification uses —
//     Open / Dismiss, auto-dismissing, and held back entirely by any Focus mode.
describe("a call announces itself like a call", () => {
  const fs = require("fs");
  const path = require("path");
  const read = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");
  const msgs = read("public", "js", "components", "Messages.js");
  const sw = read("public", "sw.js");
  const apns = read("src", "utils", "apns.js");
  const app = read("public", "js", "app.js");

  test("the open app rings, on a cadence, for as long as it is ringing", () => {
    expect(msgs).toMatch(/const Ctx = window\.AudioContext \|\| window\.webkitAudioContext;/);
    expect(msgs).toMatch(/timer = setInterval\(burst, 3000\);/);
    // Synthesised: no asset to ship or cache, nothing for the CSP to block, works offline.
    expect(msgs).toMatch(/ctx\.createOscillator\(\)/);
  });

  test("and it stops — no ring outliving the banner", () => {
    const eff = msgs.slice(msgs.indexOf("make it actually ring"), msgs.indexOf("Typing indicator socket listener"));
    expect(eff).toMatch(/if \(timer\) clearInterval\(timer\);/);
    expect(eff).toMatch(/if \(ctx && ctx\.close\) ctx\.close\(\);/);
    expect(eff).toMatch(/\}, \[incomingCall\]\);/);
  });

  test("the notification stays on screen instead of scrolling away", () => {
    expect(sw).toMatch(/const isCall = pushData\.type === 'call_incoming';/);
    expect(sw).toMatch(/requireInteraction: isCall,/);
  });

  test("its buttons are the two answers a ringing phone has", () => {
    expect(sw).toMatch(/\{ action: 'answer', title: 'Answer' \}, \{ action: 'decline', title: 'Decline' \}/);
  });

  test("Decline from the lock screen actually declines", () => {
    // Otherwise the notification's own button silently does nothing and the caller stands
    // there listening to a call that will never be answered.
    expect(sw).toMatch(/client\.postMessage\(\{ type: 'CALL_DECLINE', data: d \}\)/);
    expect(app).toMatch(/window\._socket\.emit\('call_decline', \{ callerId: d\.callerId, roomName: d\.roomName \}\)/);
  });

  test("a second call never silently replaces the first", () => {
    // v1.105.126 was this exact collapse bug wearing a different hat: 23 notifications
    // stacked under one tag, so the last one looked like more of the same.
    expect(sw).toMatch(/tag: isCall \? `call-\$\{pushData\.roomName \|\| Date\.now\(\)\}`/);
  });

  test("iOS is told a call is time-sensitive, and ONLY a call", () => {
    // An ordinary alert is held back by Do Not Disturb and by every Focus the person has on.
    // time-sensitive is the level Apple defines for something that matters now and is
    // worthless later — and it stops being honoured if you use it for everything.
    expect(apns).toMatch(/payload\?\.data\?\.type === "call_incoming" \? \{ "interruption-level": "time-sensitive" \}/);
  });
});

// ─── v1.105.160 — "nothing happened when she hit it" ───
//
// Pete: "tried calling sara in the app. it showed her where to tap to accept the call but
// nothing happened when she hit it."
//
// Two faults, one experience. Her ringing banner did not clear when he gave up — call_ended
// cleared callState, which for someone who has not answered yet is already inactive, and left
// `incomingCall` untouched. So the banner sat there still offering Accept until the 30-second
// auto-dismiss. And if she tapped it, she joined a room he had already left and sat on
// "Connecting…" — genuinely connected, to nobody, with no end.
describe("a call that has been hung up stops offering to be answered", () => {
  const fs = require("fs");
  const path = require("path");
  const read = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");
  const msgs = read("public", "js", "components", "Messages.js");
  const overlay = read("public", "js", "components", "VideoCallOverlay.js");

  test("call_ended clears the ringing banner, not just the call", () => {
    expect(msgs).toMatch(/const clearRinging = \(reason\) => \{/);
    expect(msgs).toMatch(/setIncomingCall\(\(prev\) => \{/);
    expect(msgs).toMatch(/onSocketEvent\('call_ended', \(\) => clearRinging\('ended the call'\)\)/);
    expect(msgs).toMatch(/onSocketEvent\('call_declined', \(\) => clearRinging\('is not available'\)\)/);
  });

  test("and says why, rather than vanishing under a thumb", () => {
    expect(msgs).toMatch(/showToast\(`\$\{prev\.callerName \|\| 'They'\} \$\{reason\}`, 'info'\)/);
  });

  test("answering an empty room is 'gone', not 'not yet'", () => {
    // For an OUTGOING call an empty room is normal — you are waiting. For an INCOMING one the
    // caller should already be there.
    expect(overlay).toMatch(/\} else if \(callState\.callDirection === 'incoming'\) \{/);
    expect(overlay).toMatch(/already hung up\./);
    expect(overlay).toMatch(/\}, 8000\);/);
  });

  test("someone arriving cancels the verdict", () => {
    expect(overlay).toMatch(/clearEmptyRoomTimer\(\); \/\/ they are here after all/);
  });

  test("the timer cannot outlive the call", () => {
    // A stray timeout that fires after the overlay is gone would end a LATER call.
    expect(overlay).toMatch(/function handleEndCall\(\) \{\s*\n\s*clearEmptyRoomTimer\(\);/);
    expect(overlay).toMatch(/if \(emptyRoomTimer\.current\) \{ clearTimeout\(emptyRoomTimer\.current\); emptyRoomTimer\.current = null; \}\s*\n\s*if \(roomRef\.current\) \{/);
  });
});
