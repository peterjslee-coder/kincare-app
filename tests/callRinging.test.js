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
