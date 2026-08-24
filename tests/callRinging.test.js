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

  test("a URL bar collapsing is not a keyboard", () => {
    // 120px, on whichever of the three signals the engine actually gives us.
    expect(msgs).toMatch(/hidden > 120 \|\| top > 0 \|\| scrolled > 120/);
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

  test("a shrinking layout viewport cannot make `hidden` negative", () => {
    // iH 568 with vv 499@344 gave hidden = -275 under the old arithmetic, so the measurement
    // half of the detection never fired at all — only the focused composer did.
    expect(msgs).toMatch(/const hidden = Math\.round\(window\.innerHeight - height\);/);
    expect(msgs).toMatch(/setVvShrunk\(hidden > 120 \|\| top > 0 \|\| scrolled > 120\);/);
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
    expect(msgs).toMatch(/useEffect\(\(\) => \{ pinToBottom\(true\); \}, \[messages, pinToBottom\]\);/);
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
