// v1.105.189 — the family's Observations & Notes card is one timeline, in time order.
//
// Pete, Sep 11 2026, from his phone: "Daniel's notes are waaaay out of date order?" Both
// lists WERE ordered — the API returns notes newest-first and visits newest-first — and the
// card rendered every visit, then every note. Daniel's note from that morning sat under a
// week of older visits. Verified against Pete's real record before changing anything: three
// notes from Sep 11 rendered below visits from Sep 10, 9, 8, 7, 5, 4 …
//
// Same shape the caregiver view fixed in v1.105.156. Same answer, and the same care about
// labels: a visit still says FAMILY VISIT, because a doctor report that lets a son's visit
// read as a nurse's observation is the v1.93 failure.

const { code } = require("./helpers/source");
const src = code("public/js/components/CareProfile.js");

describe("one timeline", () => {
  test("visits and notes are merged and sorted newest-first before render", () => {
    expect(src).toContain("const noteTimeline = [");
    expect(src).toMatch(/familyVisits\.map\(\(v\) => \(\{ kind: 'visit', id: v\.id, at: v\.visitedAt \|\| v\.createdAt, row: v \}\)\)/);
    expect(src).toMatch(/notes\.map\(\(n\) => \(\{ kind: 'note', id: n\.id, at: n\.created_at, row: n \}\)\)/);
    expect(src).toMatch(/\.sort\(\(a, b\) => String\(b\.at \|\| ''\)\.localeCompare\(String\(a\.at \|\| ''\)\)\)/);
  });

  test("the card renders the merged list, not two lists stacked", () => {
    // The old shape: every visit, then the notes.
    expect(src).not.toMatch(/\{familyVisits\.map\(\(v\) =>/);
    expect(src).not.toMatch(/\(showAllNotes \? notes : notes\.slice\(0, NOTES_PREVIEW\)\)\.map/);
    expect(src).toContain("shown.map((t) => (t.kind === 'visit' ? renderVisit(t.row) : renderNote(t.row)))");
  });

  test("the sort key is a real instant, and the two kinds share a format", () => {
    // Both arrive as Postgres timestamptz strings ("2026-09-11 14:37:15.828128+00") — the pg
    // type parser returns them unparsed on purpose — so a string compare IS a time compare.
    // A visit's visitedAt is the time the family member chose, not when they typed it.
    const db = code("src/models/database.js");
    expect(db).toContain("pg.types.setTypeParser(1184, (str) => str)");
    const fv = code("src/routes/familyVisits.js");
    expect(fv).toContain("visitedAt: r.visited_at");
  });

  test("'newest few, then ask' counts the merged list; the deep-link expander uses the same index", () => {
    expect(src).toContain("const shown = showAllNotes ? noteTimeline : noteTimeline.slice(0, NOTES_PREVIEW);");
    expect(src).toContain("noteTimeline.length > NOTES_PREVIEW");
    expect(src).toContain("`Show all ${noteTimeline.length}`");
    expect(src).toContain("const idx = noteTimeline.findIndex((t) => t.id === id && t.kind === (isVisit ? 'visit' : 'note'));");
    expect(src).toContain("if (idx >= NOTES_PREVIEW) setShowAllNotes(true);");
  });

  test("a visit keeps its label — interleaved, never blended", () => {
    expect(src).toMatch(/FAMILY VISIT/);
    expect(src).toContain("data-visit-id={v.id}");
    expect(src).toContain("data-note-id={n.id}");
  });
});

describe("a note saves once", () => {
  // Daniel's 14:27 observation exists twice in Betty's record, one second apart: Enter and the
  // button, or Enter twice, before `addingNote` state had re-rendered the disabled button.
  test("the handler is locked by a ref, not by state", () => {
    expect(src).toContain("const addingNoteRef = React.useRef(false);");
    expect(src).toMatch(/const handleAddNote = async \(\) => \{\s*if \(addingNoteRef\.current\) return;\s*addingNoteRef\.current = true;/);
    expect(src).toMatch(/finally \{ addingNoteRef\.current = false; \}/);
  });
});
