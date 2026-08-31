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

  test("it hangs off the corner — that is what 'overlap' means", () => {
    expect(bar).toMatch(/position: 'absolute',\s*\n\s*bottom: -13,/);
    expect(bar).toMatch(/border: '2px solid var\(--bg-primary\)'/); // the ring that lifts it off
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
