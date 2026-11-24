// Reactions on notes, as a client surface. (v1.105.170)
//
// Pete: "add the reactions into the notes section."
//
// On a message you react by holding it. A note has no gesture, so the way in has to be
// visible — which means ReactionBar (display) is not enough on its own, and ReactionRow
// (display + a way to leave one) is what notes and visits render.

const { code } = require("./helpers/source");
const fs = require("fs");
const path = require("path");
const bar = code("public/js/components/ReactionBar.js");
const profile = code("public/js/components/CareProfile.js");
const teamNotes = code("public/js/components/TeamNotes.js");

describe("the affordance exists where there is no gesture", () => {
  test("ReactionRow wraps the display component rather than reimplementing it", () => {
    expect(bar).toMatch(/const ReactionRow = window\.ReactionRow =/);
    expect(bar).toMatch(/<ReactionBar reactions=\{list\}[\s\S]{0,120}overlap=\{false\}/);
  });

  test("inline, not overlapped — a note is not a bubble", () => {
    // `overlap` hangs the cluster off a corner, which on a note row lands on the author line
    // or the photo thumbnail.
    expect(bar).toMatch(/overlap=\{false\}/);
  });

  test("the picker can be dismissed without picking", () => {
    // v1.105.159 shipped a strip on messages that a tap opened and nothing closed. Any
    // surface that opens a picker owes a way out that is not "choose an emoji you did not
    // want".
    expect(bar).toMatch(/position: 'fixed', inset: 0, zIndex: 9/);
    expect(bar).toMatch(/onTouchStart=\{\(e\) => \{ e\.stopPropagation\(\); setPicking\(false\); \}\}/);
  });

  test("it opts out of the global 44px button rule, like the badge", () => {
    // `@media (max-width:768px) { .btn, button { min-height:44px; min-width:44px } }` would
    // make a one-emoji control a 44px block in the middle of a note. See v1.105.168.
    expect(bar).toMatch(/width: 28, height: 28, minWidth: 28, minHeight: 28,/);
  });

  test("the client offers exactly the emoji the server accepts", () => {
    // A picker that offers a seventh emoji is a tap that comes back "Invalid emoji".
    const server = fs.readFileSync(path.join(__dirname, "..", "src", "utils", "reactions.js"), "utf8");
    const listOf = (src) => {
      const m = src.match(/\[\s*("|')❤️[\s\S]{0,120}?\]/);
      return m ? m[0].replace(/["'\s\[\]]/g, "").split(",").filter(Boolean) : null;
    };
    const clientList = listOf(bar);
    const serverList = listOf(server);
    expect(clientList).not.toBeNull();
    expect(serverList).not.toBeNull();
    expect(clientList).toEqual(serverList);
  });
});

describe("the way in is a control, not content", () => {
  test("it is not an emoji", () => {
    // Pete, the morning after v1.105.170 shipped: "Why does every entry now have the same
    // emoji on it". It was a ☺. An emoji on a row reads as content — and on a visit row it
    // lands beside the MOOD emoji from v1.105.164, which is content and means something.
    // Two smileys side by side, one of which is a button, is worse than no button.
    const row = bar.slice(bar.indexOf("const ReactionRow ="));
    const addButton = row.slice(row.indexOf("aria-label={mine ?"), row.indexOf("{picking && ("));
    expect(addButton).not.toMatch(/☺|🙂|😊/);
    expect(addButton).toMatch(/\\u002B/); // a plain +
  });

  test("and it looks like an affordance", () => {
    const row = bar.slice(bar.indexOf("const ReactionRow ="));
    const addButton = row.slice(row.indexOf("aria-label={mine ?"), row.indexOf("{picking && ("));
    expect(addButton).toMatch(/border: '1px dashed/);
    expect(addButton).toMatch(/background: 'none'/);
  });

  test("the PICKER still offers real emoji", () => {
    // Only the entry point changed. What you pick is unchanged.
    expect(bar).toMatch(/REACTION_EMOJIS\.map\(\(emoji\) =>/);
  });
});

describe("notes and visits both render it", () => {
  test("CareProfile puts one on every note and every visit", () => {
    expect(profile).toMatch(/onReact=\{\(emoji\) => handleReact\('note', n\.id, emoji\)\}/);
    expect(profile).toMatch(/onReact=\{\(emoji\) => handleReact\('family_visit', v\.id, emoji\)\}/);
  });

  test("TeamNotes does too — the caregiver's view of the same rows", () => {
    expect(teamNotes).toMatch(/onReact=\{\(emoji\) => handleReact\(item\.targetType, item\.targetId, emoji\)\}/);
  });

  test("TeamNotes posts the REAL row id, not its react key", () => {
    // A visit's key is `v-${id}` so it cannot collide with a note's. Posting that would 404
    // every time, on a screen where nothing else would look wrong.
    expect(teamNotes).toMatch(/kind: 'visit', id: `v-\$\{v\.id\}`/);
    expect(teamNotes).toMatch(/targetType: 'family_visit', targetId: v\.id/);
    expect(teamNotes).toMatch(/targetType: 'note', targetId: n\.id/);
  });

  test("both write the server's whole list, never a delta", () => {
    // A delta is only correct if the local copy was already correct, and someone else may
    // have reacted since the page loaded.
    for (const src of [profile, teamNotes]) {
      expect(src).toMatch(/\{ \.\.\.r, reactions: d\.reactions \}/);
    }
  });

  test("a failed write leaves the row telling the truth", () => {
    for (const src of [profile, teamNotes]) {
      expect(src).toMatch(/if \(!res\?\.ok\) return;/);
    }
  });
});

describe("no push", () => {
  test("the endpoint says so, and does not reach for sendPushToUser", () => {
    const route = fs.readFileSync(path.join(__dirname, "..", "src", "routes", "reactions.js"), "utf8");
    expect(route).not.toMatch(/sendPushToUser|sendPush\(/);
    // Pete, asked whether reacting should notify: "app only, yes."
    expect(route).toMatch(/app only, yes/);
  });
});
