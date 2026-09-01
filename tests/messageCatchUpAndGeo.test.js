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

describe("geo: the distance now says when, and the house can be wrong", () => {
  test("the timestamp was always stored — now it is shown", () => {
    // recordLastCheck has written `at` since the feature shipped. A reading from three days
    // ago and one from ten seconds ago looked identical on screen.
    expect(visit).toMatch(/lsSet\(VISIT_GEO_LAST_KEY, JSON\.stringify\(\{ ft, name, at: Date\.now\(\) \}\)\)/);
    expect(visit).toMatch(/const agoLabel = \(ts\) =>/);
    // v1.105.169 — the line is one line now, so "checked 3 hours ago" lost the word
    // "checked" and became a middot-separated clause. The timestamp is still shown, which
    // is what this test is about.
    expect(visit).toMatch(/when \? ` · \$\{when\}` : ''/);
  });

  test("ago reads in the units a person would use", () => {
    const agoLabel = new Function(`${visit.slice(visit.indexOf("const agoLabel"), visit.indexOf("const VisitGeoStatus"))}\nreturn agoLabel;`)();
    expect(agoLabel(Date.now())).toBe("just now");
    expect(agoLabel(Date.now() - 5 * 60000)).toBe("5 min ago");
    expect(agoLabel(Date.now() - 3 * 3600 * 1000)).toBe("3 hours ago");
    expect(agoLabel(Date.now() - 50 * 3600 * 1000)).toBe("2 days ago");
    // No timestamp is not "a long time ago", it is "we do not know" — Number(null) is 0, which
    // dated the reading to 1970 and printed "20695 days ago" with total confidence. The line
    // falls back to "at last check" on null.
    expect(agoLabel(null)).toBe(null);
    expect(agoLabel(undefined)).toBe(null);
    expect(agoLabel(Date.now() + 60000)).toBe(null); // a clock skewed forward claims nothing
  });

  test("the OTHER half of the subtraction can be repaired", () => {
    // Every fix so far assumed the phone was wrong. The home point comes from geocoding an
    // address, which can land on a street or ZIP centroid — and then no GPS accuracy will ever
    // close the gap. A stable, confident 2.3 miles while standing in the kitchen is that shape
    // of wrong.
    expect(visit).toMatch(/apiFetch\(`\/api\/care-recipients\/\$\{target\.id\}`, \{\s*\n\s*method: 'PUT', body: JSON\.stringify\(\{ latitude, longitude \}\)/);
  });

  test("it is only offered when the reading says you are far away", () => {
    expect(visit).toMatch(/const looksWrong = last && last\.ft > 1000 && pinState !== 'done';/);
  });

  test("and never on one tap — it moves where someone's mother lives", () => {
    expect(visit).toMatch(/pinState === 'confirming'/);
    // The confirm survived the one-line rewrite; it just fits on the line now, and names the
    // person so you know which house you are about to move.
    expect(visit).toMatch(/Standing at \{last \? `\$\{last\.name\}'s` : 'the house'\} right now\?/);
    expect(visit).toMatch(/>yes, pin it</);
  });

  test("it is one line, and the actions are what survives a narrow screen", () => {
    // Pete: "takes up critical space. make it one line." It was three: the distance, a
    // sentence explaining when the nudge fires, and "Standing at the house and this looks
    // wrong? Pin it here". The explanation is gone and the pin is a word.
    expect(visit).not.toMatch(/the nudge appears within 1,000 ft\.`/);
    expect(visit).not.toMatch(/Standing at the house and this looks wrong\? Pin it here/);
    // whiteSpace: nowrap on its own would just clip; the text must be the part that gives
    // way, or an ellipsised "check now" is one line and useless.
    expect(visit).toMatch(/flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'/);
    expect(visit).toMatch(/flexShrink: 0,[\s\S]{0,220}whiteSpace: 'nowrap'/);
    // A note replaces the line rather than being added under it, or "one line" lasts until
    // the first time anything happens.
    expect(visit).toMatch(/if \(pinNote\) \{\s*\n\s*return \(/);
  });

  test("and only the admin sees it while the distance is still wrong", () => {
    // Pete: "make it just for me. no one else should see it. it's distracting." A line that
    // explains a feature which does not yet do what it says is worse than no line at all on
    // a family member's dashboard.
    expect(visit).toMatch(/const adminOnly = !!\(window\.__isAdmin\);/);
    expect(visit).toMatch(/if \(!adminOnly\) return null;/);
    // The gate sits AFTER every hook — an early return between hooks is the late-hooks lint.
    const body = visit.slice(visit.indexOf("const VisitGeoStatus"), visit.indexOf("const VisitNudgeCard"));
    expect(body.indexOf("useState(readLastCheck)")).toBeLessThan(body.indexOf("if (!adminOnly) return null;"));
    expect(body.indexOf("useState(null); // idle")).toBeLessThan(body.indexOf("if (!adminOnly) return null;"));
    // ...and the flag is actually published by the app.
    const app = require("./helpers/source").code("public/js/app.js");
    expect(app).toMatch(/window\.__isAdmin = !!\(currentUser\?\.is_admin \|\| currentUser\?\.isAdmin\);/);
  });

  test("a failure says so instead of looking saved", () => {
    expect(visit).toMatch(/setPinNote\(d\.error \|\| "Couldn't save that\."\)/);
  });
});
