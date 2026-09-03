// The Activity card, after v1.105.182.
//
// Two defects were found REVIEWING this change rather than running it, and both are the kind
// that pass every test and fail in front of a user.

const { code } = require("./helpers/source");
const fs = require("fs");
const path = require("path");
const dash = code("public/js/components/Dashboard.js");
const route = fs.readFileSync(path.join(__dirname, "..", "src", "routes", "dashboard.js"), "utf8");

describe("an Activity row can be opened", () => {
  test("the client reads the field the server actually sends", () => {
    // The server sends `link`; the first draft read `it.metadata || it.meta`, neither of which
    // exists on that payload. The row would have become clickable and done nothing — the exact
    // dead end this change exists to remove.
    expect(dash).toMatch(/const md = it\.link \|\| it\.metadata \|\| it\.meta;/);
  });

  test("and the server sends only the deep-link keys, not the whole blob", () => {
    // Other writers put their own fields in metadata, and this renders on a dashboard.
    expect(route).toMatch(/link: meta\.type \? \{/);
    expect(route).toMatch(/noteId: meta\.noteId \|\| null, visitId: meta\.visitId \|\| null,/);
  });

  test("sessions keep the modal they already had", () => {
    expect(dash).toMatch(/if \(it\.sessionId\) return setVisitDetailSessionId\(it\.sessionId\);/);
  });

  test("routing goes through the one push router", () => {
    expect(dash).toMatch(/window\.__handlePushNavigate\(d\)/);
  });
});

describe("nothing appears in both halves of the card", () => {
  test("dedupe is on the note or visit, not on the wording", () => {
    // The rule at the top of that block is "nothing appears in both", enforced by comparing
    // TITLES. That only works while both writers phrase it the same way — and they deliberately
    // do not: the push is terse for a lock screen, the Activity row is descriptive. Under a
    // title comparison a fresh note was two different events and showed up twice.
    expect(dash).toMatch(/const unreadIds = new Set\(\);/);
    expect(dash).toMatch(/if \(d\?\.noteId\) unreadIds\.add\('note:' \+ d\.noteId\);/);
    expect(dash).toMatch(/if \(d\?\.visitId\) unreadIds\.add\('visit:' \+ d\.visitId\);/);
    expect(dash).toMatch(/if \(k && unreadIds\.has\(k\)\) return false;/);
  });

  test("the old title comparison is kept as well, not replaced", () => {
    // It still catches the writers that do phrase things identically.
    expect(dash).toMatch(/return !unreadKeys\.has\(\(a\.title \|\| ''\)\.trim\(\)\.toLowerCase\(\)\);/);
  });

  test("a malformed notification does not collapse the feed", () => {
    expect(dash).toMatch(/catch \{ \/\* a malformed row must not collapse the feed \*\/ \}/);
  });
});
