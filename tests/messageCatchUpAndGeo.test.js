// Two reports from the same feedback pull, both about the app quietly showing stale truth.
// (v1.105.148)
//
//   befaf875  "There's some sort of lag in the messages. Sometimes replies don't show up
//              until all at once."
//   4c87911b  "It says last check I was 2.3 miles away, but I don't know when that was. I'm
//              definitely inside of 1000 feet from her house… but it still doesn't say that
//              I'm at her location."

const { code } = require("./helpers/source");
const msgs = code("public/js/components/Messages.js");
const visit = code("public/js/components/FamilyVisitLog.js");

describe("messages: it is a gap, not a lag", () => {
  // New messages arrive on ONE path: a `new_message` socket event. Socket.io reconnects by
  // itself but does NOT replay what it missed, so every message sent while the socket was down
  // — phone asleep, app backgrounded, wifi handing to cellular in a hospital corridor — was
  // never delivered to this client. The thread sat stale until something happened to re-read
  // it, and then they all appeared together.

  test("it re-reads on reconnect", () => {
    expect(msgs).toMatch(/const offConnect = onSocketEvent\('connect', catchUp\);/);
  });

  test("and on coming back to the foreground", () => {
    expect(msgs).toMatch(/if \(document\.visibilityState === 'visible'\) catchUp\(\);/);
  });

  test("it catches up the thread AND the list", () => {
    // The conversation list carries the unread counts and the previews; a thread that caught
    // up while the list did not is a different kind of wrong.
    expect(msgs).toMatch(/const catchUp = \(\) => \{\s*\n\s*fetchMessages\(activeConvId\);\s*\n\s*fetchConversations\(\);/);
  });

  test("an unchanged thread does not re-render", () => {
    // Without this the catch-up would hand React a new array on every reconnect and every
    // foreground, re-running the scroll effect and pulling a reader who is halfway up the
    // history back down to the bottom for nothing.
    expect(msgs).toMatch(/if \(prev\.length === next\.length && prev\.length > 0/);
    expect(msgs).toMatch(/prev\[prev\.length - 1\]\?\.id === next\[next\.length - 1\]\?\.id\) return prev;/);
  });

  test("it unsubscribes", () => {
    expect(msgs).toMatch(/if \(typeof offConnect === 'function'\) offConnect\(\);/);
    expect(msgs).toMatch(/document\.removeEventListener\('visibilitychange', onVisible\);/);
  });
});

describe("geo: the distance line is retired (v1.144.0)", () => {
  // Pete, 11/22: "I need the distance from Betty's banner at the top that was there for a test
  // months ago to be gone." The status line, its pin-here repair and its ago label are deleted.
  test("nothing on Home says how far away the house is", () => {
    const visit = require("./helpers/source").code("public/js/components/FamilyVisitLog.js");
    expect(visit).not.toMatch(/const VisitGeoStatus/);
    expect(visit).not.toMatch(/miles from|pin here|check now'/);
  });
});
