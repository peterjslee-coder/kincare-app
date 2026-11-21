const { raw, code } = require("./helpers/source");

describe("v1.140.0 — the day card stays until midnight", () => {
  const spine = code("public/js/components/ComingUpSpine.js");
  const dash = code("public/js/components/Dashboard.js");
  const ev = code("public/js/components/CareEvents.js");
  test("today's events stay imminent after they start", () => {
    expect(dash).toMatch(/=== TimezoneHelper\.getToday\(tz\) && msUntil <= 0\) ids\.add\(ev\.id\)/);
  });
  test("v1.141.0 — once nothing is left today, the day folds and the next day leads", () => {
    expect(dash).toMatch(/if \(!todayLeft\) \{/);
    expect(dash).toMatch(/<DayFoldCard today=\{\{ items: todayItems \}\} next=\{next\}/);
    expect(dash).not.toMatch(/isDone: true/); // the finished visit no longer squats on the card
  });
  test("NOW marker, progress, done rows and the notes line", () => {
    expect(spine).toMatch(/kind: 'now'/);
    expect(spine).toMatch(/data-testid="spine-progress"/);
    expect(spine).toMatch(/data-testid="spine-notes"/);
    expect(spine).toMatch(/data-testid="spine-done-line"/);
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

describe("v1.141.0 — the next day's rows: overlaps and gaps", () => {
  const src = raw("public/js/components/ComingUpSpine.js");
  const body = src.slice(src.indexOf("function nextDayRows"), src.indexOf("window.nextDayRows"));
  // eslint-disable-next-line no-new-func
  const nextDayRows = new Function(`${body}; return nextDayRows;`)();
  test("Sunday: Ryan 8–2, Kay 1:30–5:30 — both there 1:30–2", () => {
    const rows = nextDayRows([
      { id: "k", name: "Kay Altes", start: 810, end: 1050 },
      { id: "r", name: "Ryan Huber", start: 480, end: 840 },
    ], []);
    expect(rows.map((r) => r.kind)).toEqual(["visit", "overlap", "visit"]);
    expect(rows[1]).toMatchObject({ from: 810, to: 840 });
    expect(rows[0].v.id).toBe("r");
  });
  test("Saturday: Kay 9–3 then Ryan 3–9 — no band; pizza at 6 rides on Ryan", () => {
    const pizza = { ev: { id: "p" }, at: 1080 };
    const rows = nextDayRows([
      { id: "k", start: 540, end: 900 }, { id: "r", start: 900, end: 1260 },
    ], [pizza]);
    expect(rows.map((r) => r.kind)).toEqual(["visit", "visit"]);
    expect(rows[1].riders).toEqual([pizza]);
  });
  test("a gap says nobody is there; an event outside every visit gets its own row", () => {
    const rows = nextDayRows([
      { id: "a", start: 480, end: 720 }, { id: "b", start: 780, end: 900 },
    ], [{ ev: { id: "x" }, at: 1140 }]);
    expect(rows.map((r) => r.kind)).toEqual(["visit", "gap", "visit", "event"]);
    expect(rows[1]).toMatchObject({ from: 720, to: 780 });
  });
});

test("v1.141.1 — no escape sequence sits in bare JSX text (it renders as the six characters)", () => {
  const src = raw("public/js/components/ComingUpSpine.js");
  expect(src).not.toMatch(/\}\\u00b7 \{today/);
});
