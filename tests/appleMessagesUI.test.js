// The messages screen, rebuilt to Apple's rules. (v1.105.158)
//
// Pete, with a screenshot: "can we work on the UI on the messages page. it's janky. I don't
// like it… if i could make it like anything, it would be like Apple messages' ui." Then:
// "give me the apple overlap. I'd like the option to carry this same thing over to people
// reacting to visits and care notes as well...socialize anywhere that we're leaving feedback."

const { code } = require("./helpers/source");
const fs = require("fs");
const path = require("path");
const msgs = code("public/js/components/Messages.js");
const bar = code("public/js/components/ReactionBar.js");
const css = fs.readFileSync(require("path").join(__dirname, "..", "public", "css", "styles.css"), "utf8");

// bubbleRadius is pure and self-contained — run it rather than grep it.
const src = fs.readFileSync(path.join(__dirname, "..", "public", "js", "components", "Messages.js"), "utf8");
const bubbleRadius = new Function(
  `${src.slice(src.indexOf("const MSG_R = 20;"), src.indexOf("const Messages = window.Messages"))}\nreturn bubbleRadius;`
)();

describe("bubbles tuck into runs", () => {
  test("a message on its own is round all the way", () => {
    expect(bubbleRadius(true, true, true)).toBe("20px 20px 20px 20px");
  });

  test("the middle of a run tucks on the sender's side, both ends", () => {
    // Three messages from one person should read as one person talking, not as three objects
    // with equal gaps.
    expect(bubbleRadius(true, false, false)).toBe("20px 6px 6px 20px");   // sent → right side
    expect(bubbleRadius(false, false, false)).toBe("6px 20px 20px 6px");  // received → left
  });

  test("only the LAST of a run keeps its tail corner", () => {
    expect(bubbleRadius(true, false, true)).toBe("20px 6px 20px 20px");
    expect(bubbleRadius(false, false, true)).toBe("6px 20px 20px 20px");
  });

  test("runs are decided by neighbours, not by the message itself", () => {
    expect(msgs).toMatch(/const sameRun = \(a, b\) => !!a && !!b && a\.sender_id === b\.sender_id && a\.type === b\.type;/);
    expect(msgs).toMatch(/const runStart = !sameRun\(prevMsg, m\);/);
    expect(msgs).toMatch(/const runEnd = !sameRun\(nextMsg, m\);/);
  });
});

describe("the things that made it read as cramped", () => {
  test("body text is 17px, Apple's size", () => {
    // The single biggest cause: everything else was in proportion to text two sizes too small.
    expect(msgs).toMatch(/fontSize: '17px', lineHeight: 1\.32, letterSpacing: '-0\.01em'/);
    expect(msgs).not.toMatch(/fontSize: '14px', lineHeight: 1\.45, wordWrap/);
  });

  test("a reply is a stacked dimmed bubble, not a bordered panel fused to the top", () => {
    expect(msgs).toMatch(/opacity: 0\.62,/);
    expect(msgs).toMatch(/borderRadius: 18,\s*\n\s*background: 'var\(--bubble-received-bg\)'/);
    // The panel it replaces: a coloured left border and a negative margin welding it on.
    expect(msgs).not.toMatch(/marginBottom: -6, borderRadius: isSent \? '12px 12px 0 0'/);
  });

  test("the sender's name is grey, not an avatar colour", () => {
    // getAvatarColor was being used as a TEXT colour, which is why "Rebecca Lee" came out
    // orange in his screenshot.
    expect(msgs).not.toMatch(/color: m\.senderLabel \? 'var\(--role-color\)' : getAvatarColor/);
    expect(msgs).toMatch(/: 'var\(--text-muted\)', fontWeight: 500/);
  });
});

describe("reactions overlap the bubble, and belong to no one screen", () => {
  test("Messages renders the shared component, not its own chips", () => {
    expect(msgs).toMatch(/<ReactionBar reactions=\{reactions\} currentUserId=\{currentUser\?\.id\}/);
    expect(msgs).toMatch(/align=\{isSent \? 'right' : 'left'\}/);
    // The old inline row is gone.
    expect(msgs).not.toMatch(/borderRadius: 12, fontSize: 13, cursor: 'pointer', lineHeight: 1,/);
  });

  test("it hangs off the TOP corner — the bottom one is the timestamp's", () => {
    // v1.105.167. This asserted `bottom: -11` until Pete's screenshot showed "10:5..."
    // disappearing behind the badge: on a sent bubble the bottom corner already holds the
    // time and the read receipt. Apple hangs a Tapback off the top for that reason.
    expect(bar).toMatch(/position: 'absolute',\s*\n\s*top: -20,/);
    expect(bar).not.toMatch(/bottom: -11/);
  });

  test("no box — a Tapback is a mark on the message, not a chip beside it", () => {
    // Pete: "Also, no box around it." The white fill, the ring and the drop shadow together
    // read as a piece of UI parked next to the bubble. What keeps the emoji legible where it
    // straddles the bubble's edge is a shadow on the glyph, not a background behind it.
    // Scoped to ReactionBar itself: v1.105.170 added ReactionRow to the same file, and its
    // emoji PICKER is a popover, which legitimately has a shadow. The badge is what must not.
    const badge = bar.slice(bar.indexOf("const ReactionBar ="), bar.indexOf("const ReactionRow ="));
    expect(badge).toMatch(/background: 'none'/);
    expect(badge).toMatch(/border: 'none'/);
    expect(badge).not.toMatch(/boxShadow/);
    expect(badge).toMatch(/filter: 'drop-shadow\(/);
  });

  test("the space reserved for it moved with it", () => {
    // Reserving room BELOW a bubble for a badge that now sits above it is how one fix
    // becomes two bugs.
    expect(msgs).toMatch(/marginTop: reactions\.length > 0 \? '14px' : 0,/);
    expect(msgs).not.toMatch(/marginBottom: reactions\.length > 0/);
  });

  test("one pill per emoji with a count, not one per person", () => {
    expect(bar).toMatch(/\(acc\[r\.emoji\] = acc\[r\.emoji\] \|\| \[\]\)\.push\(r\)/);
    expect(bar).toMatch(/who\.length > 1 &&/);
  });

  test("it knows nothing about messages — notes and visits can use it as-is", () => {
    // "socialize anywhere that we're leaving feedback" only works if it is one feature rather
    // than three that rhyme.
    expect(bar).not.toMatch(/message|conversation/i);
    expect(bar).toMatch(/overlap = true/); // callers that cannot float a cluster can turn it off
  });

  test("it is in the bundle", () => {
    expect(code("scripts/build-client.js")).toMatch(/js\/components\/ReactionBar\.js/);
  });

  test("and Messages degrades if it is missing", () => {
    expect(msgs).toMatch(/typeof ReactionBar !== 'undefined' &&/);
  });
});

// ─── v1.105.159 — the gestures, and two things his screen recording caught ───
//
// Pete: "can we get swipe to reply treatment? I still dont like the press and hit reply…
// but i like when i hit and hold on messages and a few emojis pop up. right now it's a janky
// reply and one emoji." Then, watching it: "reaction looks too big and dominates the message,
// and the reply/emoji is stuck up high and won't cancel out."
describe("holding and swiping", () => {
  test("a hold opens the emoji row directly", () => {
    // It used to mean: long-press, aim at a small 😀 in a strip, then pick. Three steps for a
    // thumbs-up. The six emoji ARE the menu now.
    expect(msgs).toMatch(/msgSwipeRef\.current\.pressTimer = setTimeout\(/);
    expect(msgs).toMatch(/setShowEmojiFor\(msg\.id\);/);
    expect(msgs).toMatch(/\}, 420\);/);
  });

  test("moving cancels the hold, and swiping cancels the menu", () => {
    expect(msgs).toMatch(/if \(Math\.abs\(dx\) > 8 \|\| dy > 8\) clearLongPress\(\);/);
    expect(msgs).toMatch(/msgSwipeRef\.current\.locked = true;\s*\n\s*setShowEmojiFor\(null\);/);
  });

  test("the swipe claims the gesture so the list stops fighting it", () => {
    // Most of why swipe-to-reply never felt like it worked: the browser kept the touch and the
    // drag stuttered or died halfway.
    expect(msgs).toMatch(/if \(e\.cancelable\) e\.preventDefault\(\);/);
  });

  test("the commit reads the ref, not the state", () => {
    // touchmove fires faster than React re-renders, so the last pixels of a fast swipe were
    // not in msgSwipeOffset yet when touchend ran.
    expect(msgs).toMatch(/const travelled = msgSwipeRef\.current\.offset \|\| 0;/);
    expect(msgs).toMatch(/if \(travelled >= REPLY_TRIGGER_PX\)/);
  });

  test("it rubber-bands rather than stopping dead", () => {
    expect(msgs).toMatch(/REPLY_TRIGGER_PX \+ \(dx - REPLY_TRIGGER_PX\) \* 0\.35/);
  });

  test("haptics are optional and can never break the gesture", () => {
    expect(msgs).toMatch(/const tapHaptic = \(style\) =>/);
    expect(msgs).toMatch(/catch \{ \/\* never let feedback break the gesture \*\/ \}/);
  });
});

describe("the two faults in the recording", () => {
  test("the hover strip does not exist on a touch screen", () => {
    // onMouseEnter fires on TAP and onMouseLeave never fires, so one tap pinned it to the edge
    // of the screen, detached from any bubble, with no way to dismiss it.
    expect(msgs).toMatch(/\{!hasSoftKeyboard && \(\s*\n\s*<div className="msg-hover-actions"/);
  });

  test("the emoji row can be dismissed by tapping anywhere", () => {
    // Before this the only way out was to pick an emoji you did not want.
    expect(msgs).toMatch(/onClick=\{\(\) => setShowEmojiFor\(null\)\}\s*\n\s*onTouchStart=\{\(\) => setShowEmojiFor\(null\)\}/);
    expect(msgs).toMatch(/position: 'fixed', inset: 0, zIndex: 9/);
  });

  test("it is a pill, not a banner", () => {
    expect(msgs).toMatch(/borderRadius: 999,/);
    expect(msgs).toMatch(/fontSize: 17, lineHeight: 1, padding: '5px 6px'/);
    expect(msgs).not.toMatch(/cursor: 'pointer', fontSize: 20, padding: '4px'/);
  });

  test("and the reaction sits quietly on the corner", () => {
    // Was `fontSize: 11.5` — an 11.5px emoji inside 2px of border and 6px of padding, which
    // is a bigger object on the screen than a bare 15px emoji. v1.105.167 took the chrome
    // away, so the glyph can be the size a glyph should be.
    expect(bar).toMatch(/fontSize: 17, lineHeight: 1,/);
    // The size was never the font. `@media (max-width:768px) { .btn, button { min-height:44px;
    // min-width:44px } }` made a one-emoji badge a 44x44 block on every phone — the "box" in
    // the screenshot. A component that must not be 44px has to say so explicitly.
    expect(bar).toMatch(/width: 32, height: 32, minWidth: 32, minHeight: 32,/);
    expect(css).toMatch(/\.btn, button \{\s*\n\s*min-height: 44px;/); // the rule it is opting out of
    expect(bar).not.toMatch(/fontSize: 13, lineHeight: 1\.2/);
    expect(bar).not.toMatch(/padding: '1px 6px'/);
  });
});
