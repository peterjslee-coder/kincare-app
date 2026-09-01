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

describe("visits share the screen", () => {
  // v1.105.156. Pete: "Julia is on the care team...she should be able to see the notes, or I
  // should be able to select it at least." She may read visits too — the missing piece was
  // never permission, it was a place to look.
  test("they are fetched only where the capability allows", () => {
    expect(view).toMatch(/if \(!rec\?\.canReadVisits\) return;/);
    expect(notes).toMatch(/recipientsWithCapabilityFor\(db, req\.user\.id, CAP\.READ_VISITS\)/);
  });

  test("notes and visits are one timeline, newest first", () => {
    // A caregiver arriving at the house wants "what has happened with her recently", not two
    // lists to reconcile by date.
    expect(view).toMatch(/const timeline = notes === null \? null : \[/);
    expect(view).toMatch(/\.sort\(\(a, b\) => String\(b\.at \|\| ''\)\.localeCompare\(String\(a\.at \|\| ''\)\)\)/);
  });

  test("a visit says it is a visit", () => {
    expect(view).toMatch(/👣 Visit/);
  });

  test("a missing visit history does not blank the notes", () => {
    expect(view).toMatch(/catch \{ \/\* a missing visit history must not blank the notes \*\/ \}/);
  });

  test("and the visit push lands here too", () => {
    expect(app).toMatch(/t === 'team_note' \|\| t === 'observation_attention' \|\| t === 'family_visit'/);
  });
});

describe("what the page will and will not do", () => {
  test("it never changes anyone's care record", () => {
    // Writing, editing or deleting a note goes in someone's care record and pushes the whole
    // team. The places to do that exist already, with their own framing. This screen is for
    // reading.
    expect(view).not.toMatch(/method: 'DELETE'/);
    expect(view).not.toMatch(/method: 'PUT'/);
    expect(view).not.toMatch(/apiFetch\('\/api\/notes'/);
  });

  test("the ONE thing it may write is a reaction", () => {
    // v1.105.170. Pete: "socialize anywhere that we're leaving feedback." A reaction does not
    // alter the note, does not appear in the record as content, and does not push anybody —
    // so it is the one write that belongs on a read-only screen. This test exists to keep
    // that list at one: the assertion above became narrower, and this is what took its place.
    const posts = [...view.matchAll(/apiFetch\(`([^`]+)`,\s*\{\s*\n?\s*method: 'POST'/g)].map((m) => m[1]);
    expect(posts).toEqual(["/api/reactions/${targetType}/${targetId}"]);
  });

  test("nothing shared is an honest empty state, not an error", () => {
    expect(view).toMatch(/No care notes shared with you/);
  });

  test("a missing bundle entry cannot white-screen the app", () => {
    expect(app).toMatch(/typeof TeamNotes !== 'undefined'/);
    expect(code("scripts/build-client.js")).toMatch(/js\/components\/TeamNotes\.js/);
  });

  test("long histories fold, like every other list we fixed today", () => {
    // v1.105.156 — the count is the merged timeline now, notes plus visits.
    expect(view).toMatch(/Show all \$\{timeline\.length\}/);
  });
});

// ─── v1.105.164 — the mood, and a bug it exposed in my own code ───
//
// Pete: "there's no way to see the emoji (sad to happy) on notes and visits. a little emoji
// next to 'family visit' to show would be helpful and not require it to all be expandable."
describe("how she seemed, at a glance", () => {
  const visitLog = code("public/js/components/FamilyVisitLog.js");
  const profile = code("public/js/components/CareProfile.js");

  test("the mood map is exported, not copied", () => {
    // The family profile and the care team's Care Notes both show visits. A second copy of
    // this map is a second chance for 😐 to mean two different things.
    expect(visitLog).toMatch(/const visitMoodEmoji = window\.visitMoodEmoji =/);
    expect(visitLog).toMatch(/const visitMoodLabel = window\.visitMoodLabel =/);
  });

  test("every mood has words as well as a face", () => {
    // A bare glyph in a care record is a guess. Title and aria-label both get the words.
    expect(visitLog).toMatch(/\{ id: 'great', emoji: '😀', label: 'seemed great' \}/);
    expect(visitLog).toMatch(/\{ id: 'poor', emoji: '😟', label: 'seemed poor' \}/);
  });

  test("it shows on the family's own visit list", () => {
    expect(profile).toMatch(/visitMoodEmoji\(v\.moodRating\)/);
    expect(profile).toMatch(/aria-label=\{visitMoodLabel\(v\.moodRating\)\}/);
  });

  test("and on the care team's", () => {
    expect(view).toMatch(/mood: v\.moodRating \|\| null,/);
    expect(view).toMatch(/visitMoodEmoji\(item\.mood\)/);
  });

  test("it degrades if the helper is not in the bundle", () => {
    expect(profile).toMatch(/typeof visitMoodEmoji === 'function' &&/);
    expect(view).toMatch(/typeof visitMoodEmoji === 'function' &&/);
  });
});

describe("the visit fields TeamNotes reads are the ones the API sends", () => {
  test("camelCase, because shape() in familyVisits.js emits camelCase", () => {
    // v1.105.164 — found while adding the mood. My own v1.105.156 read v.visited_at,
    // v.author_first_name and v.duration_minutes off an endpoint that returns visitedAt,
    // authorName and durationMinutes. Every one was undefined, so a visit in Julia's Care
    // Notes had no date, no author and no duration — and none of it threw, because reading a
    // missing property is silent. The mood row is what made it visible.
    expect(view).toMatch(/at: v\.visitedAt \|\| v\.createdAt/);
    expect(view).toMatch(/who: v\.authorName \|\| v\.authorFirstName/);
    expect(view).toMatch(/minutes: v\.durationMinutes \|\| null/);
    expect(view).not.toMatch(/v\.visited_at|v\.author_first_name|v\.duration_minutes/);
  });

  test("notes stay snake_case, because THAT endpoint returns raw rows", () => {
    // Not an inconsistency to tidy: two endpoints, two shapes, and the client must match each.
    expect(view).toMatch(/n\.created_at/);
    expect(view).toMatch(/n\.author_first_name/);
  });
});
