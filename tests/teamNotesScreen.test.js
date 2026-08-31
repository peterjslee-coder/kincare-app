// The screen the note notification finally has somewhere to point at. (v1.105.153)
//
// Pete: "Julia sees my notes but when she clicks on the notification it says 'no care
// recipient found'." Then the rule: "not all caregivers should get it...it's just that Julia
// IS on Betty's care team AND she's a caregiver" / "not all caregivers will be on the care
// team."
//
// Everything below is that rule: the page, the tab and the deep link are driven by what the
// server says this person may read, never by the word "caregiver".

const { code } = require("./helpers/source");
const app = code("public/js/app.js");
const view = code("public/js/components/TeamNotes.js");
const notes = code("src/routes/notes.js");
const access = code("src/utils/access.js");

describe("who the page is for", () => {
  test("the list comes from a capability, over membership — not from a role", () => {
    expect(access).toMatch(/async function recipientsWithCapabilityFor\(db, userId, cap\)/);
    // The same three sources usersWithCapability walks, read from the other end.
    expect(access).toMatch(/WHERE cr\.family_user_id = \? OR ctm\.user_id IS NOT NULL OR s\.id IS NOT NULL/);
    expect(notes).toMatch(/recipientsWithCapabilityFor\(db, req\.user\.id, CAP\.READ_NOTES\)/);
  });

  test("the tab does not exist for someone with nothing shared", () => {
    // A caregiver with no shared record never sees a tab, rather than seeing one that opens
    // and explains why it is empty.
    expect(app).toMatch(/if \(sharedNotesRecipients > 0\) \{/);
    expect(app).toMatch(/\{ id: 'care-notes', icon: '📝', label: 'Care Notes' \}/);
  });

  test("a failed lookup hides the tab rather than showing a broken one", () => {
    expect(app).toMatch(/catch \{ \/\* no tab, rather than a broken one \*\/ \}/);
  });

  test("the family is not asked — they already have the full profile", () => {
    expect(app).toMatch(/if \(!currentUser \|\| \(currentUser\.role \|\| 'family'\) === 'family'\) \{ setSharedNotesRecipients\(0\); return; \}/);
  });
});

describe("the notification lands on it", () => {
  test("a note push routes on who is looking", () => {
    expect(app).toMatch(/t === 'team_note' \|\| t === 'observation_attention'/);
    expect(app).toMatch(/target = \(window\.__currentRole \|\| 'family'\) === 'family' \? 'care-profile' : 'care-notes';/);
  });

  test("it carries which recipient and which note", () => {
    expect(app).toMatch(/window\.__pendingNoteRecipientId = d\.careRecipientId/);
    expect(app).toMatch(/window\.__pendingFocus = `note:\$\{d\.noteId\}`/);
  });

  test("the page opens on that recipient and marks that note", () => {
    expect(view).toMatch(/const wanted = window\.__pendingNoteRecipientId;/);
    expect(view).toMatch(/f\.startsWith\('note:'\)/);
    expect(view).toMatch(/setHighlightId\(id\)/);
    // It may be past the preview cut — a notification that scrolls you to nothing is no better
    // than the dead end it replaced.
    expect(view).toMatch(/setShowAll\(true\);/);
  });

  test("the focus is cleared once claimed", () => {
    expect(view).toMatch(/window\.__pendingFocus = null;/);
    expect(view).toMatch(/window\.__pendingNoteRecipientId = null;/);
  });
});

describe("what the page will and will not do", () => {
  test("it reads; it never writes", () => {
    // Writing a note goes in someone's care record and pushes the whole team. The places to
    // do that exist already, with their own framing.
    expect(view).not.toMatch(/method: 'POST'/);
    expect(view).not.toMatch(/method: 'DELETE'/);
    expect(view).not.toMatch(/method: 'PUT'/);
  });

  test("nothing shared is an honest empty state, not an error", () => {
    expect(view).toMatch(/No care notes shared with you/);
  });

  test("a missing bundle entry cannot white-screen the app", () => {
    expect(app).toMatch(/typeof TeamNotes !== 'undefined'/);
    expect(code("scripts/build-client.js")).toMatch(/js\/components\/TeamNotes\.js/);
  });

  test("long histories fold, like every other list we fixed today", () => {
    expect(view).toMatch(/Show all \$\{notes\.length\} notes/);
  });
});
