const { raw, code } = require("./helpers/source");

describe("v1.140.0 — the day card stays until midnight", () => {
  const spine = code("public/js/components/ComingUpSpine.js");
  const dash = code("public/js/components/Dashboard.js");
  const ev = code("public/js/components/CareEvents.js");
  test("today's events stay imminent after they start", () => {
    expect(dash).toMatch(/=== TimezoneHelper\.getToday\(tz\) && msUntil <= 0\) ids\.add\(ev\.id\)/);
  });
  test("a visit done today stays as the card's visit", () => {
    expect(dash).toMatch(/isDone: true/);
    expect(dash).toMatch(/data\?\.recentlyCompleted/);
  });
  test("NOW marker, progress, done rows and the notes line", () => {
    expect(spine).toMatch(/kind: 'now'/);
    expect(spine).toMatch(/data-testid="spine-progress"/);
    expect(spine).toMatch(/data-testid="spine-notes"/);
    expect(spine).toMatch(/\\u2713 done/);
  });
  test("the sheet says it's filed; the add-note button only appears with text", () => {
    expect(ev).toMatch(/data-testid="event-notes-filed"/);
    expect(ev).toMatch(/\{!!newNote\.trim\(\) && <button onClick=\{addNote\}/);
    expect(raw("public/js/components/CareEvents.js")).toMatch(/Read the full transcript/);
  });
  test("her page has Coming up | Past", () => {
    expect(ev).toMatch(/data-testid="events-past-tab"/);
  });
});
