/**
 * v1.149.1 — a note or visit push lands on the RIGHT PERSON and the right item.
 *
 * Found testing the Got it button on staging: with two people cared for, "Deborah left a
 * note" about the second opened the family page on the first, so the note never appeared and
 * the jump to it waited forever. And when the page (or Home, for "Session Complete") was
 * already open, the tap re-rendered nothing at all, because setCurrentPage to the page you are
 * on does not remount it.
 */
const vm = require("vm");
const { raw, code } = require("./helpers/source");

describe("pickLovedOne honours the person a note push is about", () => {
  const src = raw("public/js/components/LovedOneGuide.js");
  const start = src.indexOf("const pickLovedOne = window.pickLovedOne");
  const end = src.indexOf("\n};", start) + 3;
  const fnSrc = src.slice(start, end);

  function load(win) {
    const ctx = { window: win, apiFetch: async () => ({ ok: false }) };
    vm.createContext(ctx);
    vm.runInContext(fnSrc, ctx);
    return win.pickLovedOne;
  }

  test("opens on the named person, not the first, and claims the request", async () => {
    const win = { __pendingNoteRecipientId: "b", __pendingFocus: "note:n1" };
    const pick = load(win);
    const got = await pick([{ id: "a" }, { id: "b" }]);
    expect(got.id).toBe("b");
    expect(win.__pendingNoteRecipientId).toBe(null);
    // The note focus itself is left for the notes section to claim.
    expect(win.__pendingFocus).toBe("note:n1");
  });

  test("a stale id for someone not on the list falls back to the first", async () => {
    const pick = load({ __pendingNoteRecipientId: "zzz" });
    expect((await pick([{ id: "a" }, { id: "b" }])).id).toBe("a");
  });
});

describe("a tap while the page is already open still reaches it", () => {
  const app = code("public/js/app.js");

  test("the note/visit branch and the Session Complete branch both announce inplace:focus", () => {
    const noteBranch = app.slice(app.indexOf("t === 'team_note' || t === 'observation_attention'"));
    expect(noteBranch.slice(0, 2500)).toMatch(/dispatchEvent\(new Event\('inplace:focus'\)\)/);
    const sessBranch = app.slice(app.indexOf("t === 'session_in_progress' || t === 'session_complete'"));
    expect(sessBranch.slice(0, 600)).toMatch(/dispatchEvent\(new Event\('inplace:focus'\)\)/);
  });

  test("Betty's page and Care Notes both listen for it", () => {
    for (const f of ["public/js/components/CareProfile.js", "public/js/components/TeamNotes.js"]) {
      expect(code(f)).toMatch(/addEventListener\('inplace:focus'/);
    }
  });
});
