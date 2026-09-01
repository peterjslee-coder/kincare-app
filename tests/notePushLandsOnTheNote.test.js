// A push about a note lands ON the note. (v1.105.163)
//
// Pete: "i get a notification that debbie left a note about betty. I click it. it opens the
// app, takes me to care team, drops me at top. I have to scroll past the care intel and tasks
// and figure out where notes are… If I hit the notification, I want it to open the note, or at
// least the page where the notes are, at the level the notes are at. I don't want a push and
// then anxiety of 'I wonder if I'll find it'."
//
// The push has carried `noteId` since v1.96.0 and the family's screen never read it. The
// CAREGIVER side got this in v1.105.153 — TeamNotes opens on the right person and marks the
// right note — and the screen he actually uses was left arriving at the top of a long page.

const { code } = require("./helpers/source");
const profile = code("public/js/components/CareProfile.js");
const app = code("public/js/app.js");
const notes = code("src/routes/notes.js");
const visits = code("src/routes/familyVisits.js");

describe("the push carries enough to find it", () => {
  test("a note push has always carried the note id", () => {
    expect(notes).toMatch(/data: \{ type: eventType, careRecipientId, noteId: id, page: "care-profile" \}/);
  });

  test("a visit push carries a visit id, and now becomes a focus of its own", () => {
    // Without this branch a visit push arrived with no focus at all — top of the page, go
    // hunting, which is the same complaint one object over.
    expect(visits).toMatch(/data: \{ type: "family_visit", careRecipientId, visitId: id/);
    expect(app).toMatch(/if \(d\.visitId && !d\.noteId && !d\.focus\) window\.__pendingFocus = `visit:\$\{d\.visitId\}`;/);
  });
});

describe("and the family's own screen now uses it", () => {
  test("it reads the focus", () => {
    expect(profile).toMatch(/const isVisit = f\.startsWith\('visit:'\);/);
    expect(profile).toMatch(/if \(!f\.startsWith\('note:'\) && !isVisit\) return;/);
  });

  test("three things, because any one alone still leaves you hunting", () => {
    // The section can be collapsed; the note can be past the five-note preview; and either
    // way it is somewhere below a screenful of care intelligence and tasks.
    // v1.105.171 — the section remembers whether he folded it, so opening it for a push has
    // to say "do not remember this". He followed a link to a note; that is the app unfolding
    // the section, not him choosing to keep it unfolded.
    expect(profile).toMatch(/setNotesOpen\(true, \{ remember: false \}\);/);
    expect(profile).toMatch(/if \(!isVisit && idx >= NOTES_PREVIEW\) setShowAllNotes\(true\);/);
    expect(profile).toMatch(/el\.scrollIntoView\(\{ behavior: 'smooth', block: 'center' \}\)/);
  });

  test("and it marks the one the phone buzzed about", () => {
    // Among a dozen notes, arriving in the right place is not the same as knowing which one.
    expect(profile).toMatch(/setHighlightNoteId\(id\);/);
    expect(profile).toMatch(/data-note-id=\{n\.id\}/);
    expect(profile).toMatch(/data-visit-id=\{v\.id\}/);
    expect(profile).toMatch(/setTimeout\(\(\) => setHighlightNoteId\(null\), 5000\)/);
  });

  test("a focus for something not on this screen is left alone", () => {
    // Another recipient's note, or one that has not loaded yet: consuming it here would mean
    // the screen that CAN show it never gets the chance.
    expect(profile).toMatch(/if \(idx === -1\) return; \/\/ not this recipient's/);
  });

  test("it falls back to the section when the row cannot be found", () => {
    // Better to land on the notes card than at the top of the page.
    expect(profile).toMatch(/document\.querySelector\(sel\) \|\| notesCardRef\.current/);
  });

  test("it re-runs when either list arrives", () => {
    // The push routinely wins the race against the fetch.
    expect(profile).toMatch(/\}, \[notes, familyVisits\]\);/);
  });
});
