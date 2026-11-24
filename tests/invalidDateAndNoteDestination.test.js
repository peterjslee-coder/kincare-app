// Two reports, one shipped fix each. (v1.105.152)
//
//   54249195  "Due invalid date"
//   Pete      "Julia sees my notes but when she clicks on the notification it says 'no care
//              recipient found'. Is it because she has limited access?"

const { code } = require("./helpers/source");
const fs = require("fs");
const path = require("path");

const tzSrc = fs.readFileSync(
  path.join(__dirname, "..", "public", "js", "components", "TimezoneHelper.js"), "utf8"
);
const card = code("public/js/components/AttentionCard.js");
const profile = code("public/js/components/CareProfile.js");
const notes = code("src/routes/notes.js");

// getDateLabel is lifted out and run for real rather than grepped — the bug was in what it
// COMPUTED, and a source match would have passed against the broken version too.
// It leans on getNow/getToday from further up the file, so those come with it.
const getDateLabel = (() => {
  const start = tzSrc.indexOf("function getNow(");
  const end = tzSrc.indexOf("/**", tzSrc.indexOf("function getDateLabel"));
  return new Function(`${tzSrc.slice(start, end)}\nreturn getDateLabel;`)();
})();

describe("a date label never renders the words 'Invalid Date'", () => {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());

  test("the exact value from the report — a space-separated timestamptz", () => {
    // Postgres timestamptz arrives from our db wrapper as "2026-08-30 22:00:00+00", not ISO.
    // Splitting on "T" alone kept the whole string, the day parsed as
    // Number("30 22:00:00+00") = NaN, and new Date(2026, 7, NaN).toLocaleDateString() is
    // literally "Invalid Date" — shown to a person, on a medication reminder.
    expect(getDateLabel("2026-08-30 22:00:00+00", "America/New_York")).not.toMatch(/Invalid/);
    expect(getDateLabel("2026-08-30 22:00:00+00", "America/New_York")).toMatch(/Aug 30|Today|Tomorrow/);
  });

  test("ISO still works, and so does a plain date", () => {
    expect(getDateLabel("2026-08-30T22:00:00.000Z", "America/New_York")).not.toMatch(/Invalid/);
    expect(getDateLabel("2026-08-30", "America/New_York")).not.toMatch(/Invalid/);
  });

  test("today and tomorrow are still named, not dated", () => {
    expect(getDateLabel(today, "America/New_York")).toBe("Today");
  });

  test("garbage returns the value itself, not the words", () => {
    // The raw value is not pretty, but it is true, and it says WHICH value is wrong.
    expect(getDateLabel("not-a-date", "America/New_York")).toBe("not-a-date");
    expect(getDateLabel("", "America/New_York")).not.toMatch(/Invalid/);
  });

  test("the card stops the bad value reaching the helper at all", () => {
    expect(card).toMatch(/String\(dateStr\)\.split\(\/\[T \]\/\)\[0\]/);
  });
});

describe("a caregiver tapping a note is not told she has no loved one", () => {
  test("she IS allowed to read it — the push is capability-gated", () => {
    // This is the answer to "should she not get the push, or should she see the notes?".
    // The server already decided: only users with READ_NOTES are notified (v1.105.81), and
    // GET /api/notes/:id authorizes any team member. The notification is correct.
    expect(notes).toMatch(/usersWithCapability\(db, careRecipientId, CAP\.READ_NOTES\)/);
    expect(notes).toMatch(/notifyIds\.delete\(req\.user\.id\)/);
  });

  test("so the bug is the destination, and it no longer lies to her", () => {
    // The page loads GET /api/care-recipients, which is family/admin/care_for only. For a
    // caregiver that returns nothing, and the empty state told her there was no care
    // recipient and offered to add one.
    expect(profile).toMatch(/const isFamilyOwner = \(window\.__currentRole \|\| 'family'\) === 'family';/);
    expect(profile).toMatch(/This page belongs to the family/);
  });

  test("the family's own empty state is untouched", () => {
    expect(profile).toMatch(/title="No care recipient found" text="Add a care recipient to get started\."/);
  });
});
