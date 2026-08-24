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

// ─── v1.105.131 — the keyboard was taking the header with it ───
//
// Pete, 8/24: "they show, but only at the very top of the chat...gotta scroll all the way up
// to find them. open the keyboard?...they gone to the top."
//
// MEASURED ON PRODUCTION FIRST, at 500x701, because the obvious suspect was wrong: the panel
// is bounded (646px = viewport - 55px nav), the header is sticky at top 0, and
// .msg-messages-area is the only scroller on the page (508 visible of 779). Nothing about the
// layout is broken. What a desktop browser does not have is a keyboard.
//
// On iOS the keyboard changes neither innerHeight nor 100dvh. It shrinks the VISUAL viewport
// and scrolls the LAYOUT viewport up to reveal the focused input, so a correctly-sized panel
// keeps its header at a top you can no longer see — and nothing puts the layout viewport back,
// which is the "scroll all the way up" half.
describe("the keyboard cannot push the header off screen", () => {
  const fs = require("fs");
  const path = require("path");
  const read = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");
  const msgs = read("public", "js", "components", "Messages.js");
  const css = read("public", "css", "styles.css");

  test("the panel is sized from visualViewport while the keyboard is up", () => {
    expect(msgs).toMatch(/window\.visualViewport/);
    expect(msgs).toMatch(/root\.style\.setProperty\('--msg-vvh'/);
    expect(css).toMatch(/body\.msg-keyboard-open \.msg-panel \{\s*height: var\(--msg-vvh/);
  });

  test("the layout viewport is put back when iOS moves it", () => {
    expect(msgs).toMatch(/if \(open && window\.scrollY !== 0\) window\.scrollTo\(0, 0\);/);
  });

  test("a URL bar collapsing is not a keyboard", () => {
    // Without a threshold this would fire on every Safari chrome animation and fight the user.
    expect(msgs).toMatch(/const open = hidden > 120;/);
  });

  test("no visualViewport, no change in behaviour", () => {
    // Every other browser and the older WebViews keep exactly what they have today.
    expect(msgs).toMatch(/if \(!vv\) return;/);
    expect(css).toMatch(/height: var\(--msg-vvh, calc\(100dvh - var\(--sab\) - 55px\)\)/);
  });

  test("it cleans up after itself", () => {
    // A body class left behind would size the panel to a keyboard that is no longer there.
    expect(msgs).toMatch(/document\.body\.classList\.remove\('msg-keyboard-open'\)/);
    expect(msgs).toMatch(/root\.style\.removeProperty\('--msg-vvh'\)/);
  });
});
