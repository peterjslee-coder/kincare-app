// The classifier that decides which messages were the platform and which were a person.
// (v1.105.104 — scripts/repair-support-dm-split.js)
//
// Pete: "i just want her to see my messages from my personal account as Peter...not admin".
//
// I told him this was guesswork. It is not: `messages.sender_label` already records it.
// admin/safety.js stamps 'InPlace Support' on everything sent AS the platform; every ordinary
// send path leaves it NULL. The only genuinely unlabelled case is the other party's replies,
// which follow whatever they were replying to.

const path = require("path");
const SCRIPT = path.join(__dirname, "..", "scripts", "repair-support-dm-split.js");

// The script runs main() on require, so pull the function out by reading it rather than
// importing the module. (It is one pure function; this keeps the script single-file.)
const fs = require("fs");
const src = fs.readFileSync(SCRIPT, "utf8");
const body = src.slice(src.indexOf("function classify"), src.indexOf("async function main"));
// eslint-disable-next-line no-new-func
const classify = new Function(`const SUPPORT = "InPlace Support"; ${body}; return classify;`)();

const ADMIN = "pete", PARTNER = "julia";
const msg = (sender, label, i) => ({ id: `m${i}`, sender_id: sender, sender_label: label });
const sides = (ms) => classify(ms, ADMIN).map((m) => m.side);

describe("a thread the platform never spoke in", () => {
  test("is entirely personal", () => {
    expect(sides([
      msg(ADMIN, null, 1),
      msg(PARTNER, null, 2),
      msg(ADMIN, null, 3),
    ])).toEqual(["personal", "personal", "personal"]);
  });
});

describe("a thread that is only support", () => {
  test("is entirely support, replies included", () => {
    expect(sides([
      msg(ADMIN, "InPlace Support", 1),
      msg(PARTNER, null, 2),           // her reply to the platform
      msg(ADMIN, "InPlace Support", 3),
    ])).toEqual(["support", "support", "support"]);
  });
});

describe("a mixed thread", () => {
  test("a reply follows whatever it is replying to", () => {
    expect(sides([
      msg(ADMIN, "InPlace Support", 1),
      msg(PARTNER, null, 2),           // replying to support
      msg(ADMIN, null, 3),             // Pete, as himself
      msg(PARTNER, null, 4),           // replying to Pete
    ])).toEqual(["support", "support", "personal", "personal"]);
  });

  test("the platform speaking again pulls the thread back", () => {
    expect(sides([
      msg(ADMIN, null, 1),
      msg(PARTNER, null, 2),
      msg(ADMIN, "InPlace Support", 3),
      msg(PARTNER, null, 4),
    ])).toEqual(["personal", "personal", "support", "support"]);
  });

  test("an unlabelled admin message is always personal", () => {
    // The platform labels itself. An unlabelled message from Pete is Pete.
    expect(sides([
      msg(ADMIN, "InPlace Support", 1),
      msg(ADMIN, null, 2),
    ])).toEqual(["support", "personal"]);
  });

  test("a thread that opens unlabelled was not opened by the platform", () => {
    expect(sides([msg(PARTNER, null, 1)])).toEqual(["personal"]);
  });
});

describe("the script's own safeguards", () => {
  test("it does nothing without --apply", () => {
    expect(src).toMatch(/const APPLY = process\.argv\.includes\("--apply"\)/);
    expect(src).toMatch(/if \(!APPLY\) \{ split\+\+; continue; \}/);
  });

  test("it back-dates the destination so the history cut cannot hide what it moved", () => {
    // A thread's visible history starts at COALESCE(cm.joined_at, c.created_at) — v1.105.92.
    // Moving an old message into a newer thread would deliver it into the invisible half.
    expect(src).toMatch(/UPDATE conversation_members SET joined_at = LEAST\(joined_at, \?\)/);
    expect(src).toMatch(/UPDATE conversations SET created_at = LEAST\(created_at, \?\)/);
    expect(src).toMatch(/INSERT INTO conversation_members[\s\S]{0,120}joined_at\) VALUES \(\?, \?, \?, 'member', \?\)/);
  });

  test("it only ever looks for an UNNAMED destination", () => {
    // Moving personal messages into another system thread would repeat the original bug.
    expect(src).toMatch(/WHERE c\.type = 'direct' AND c\.name IS NULL/);
  });

  test("it refuses anything that is not a two-person admin/user thread", () => {
    expect(src).toMatch(/if \(!admin \|\| !partner \|\| members\.length !== 2\)/);
  });

  test("no message is ever deleted", () => {
    expect(src).not.toMatch(/DELETE FROM messages/);
  });
});
