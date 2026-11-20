process.env.JWT_SECRET = process.env.JWT_SECRET || "unit-test-secret";
const { raw, code } = require("./helpers/source");
const { _test: { suggestVisit } } = require("../src/routes/carePhotos");

describe("v1.137.0 — Betty card B", () => {
  const dash = code("public/js/components/Dashboard.js");
  const card = dash.slice(dash.indexOf('data-testid="betty-card"'), dash.indexOf("careTeams.length > 0 && (() =>", dash.indexOf('data-testid="betty-card"')));
  test("the viewer's own relationship label is not on the card", () => {
    expect(card.length).toBeGreaterThan(100);
    expect(card).not.toMatch(/relationship_label/);
    expect(card).not.toMatch(/Living in/);
  });
  test("the care team still sits under a divider", () => {
    expect(dash).toMatch(/borderTop: '1px solid rgba\(255,255,255,0\.15\)'/);
  });
});

describe("v1.137.0 — Save to care photos", () => {
  test("Messages offers it on a photo, family only", () => {
    const m = raw("public/js/components/Messages.js");
    expect(m).toMatch(/data-testid="save-to-care-photos"/);
    expect(m).toMatch(/m\.message_type === 'photo' && !m\.is_deleted && canSaveCarePhotos/);
  });
  test("the route is mounted", () => {
    expect(raw("src/server.js")).toMatch(/app\.use\("\/api\/care-photos", require\("\.\/routes\/carePhotos"\)\)/);
  });
  test("suggests the sender's visit nearest the message, and nothing for someone else's", () => {
    const visits = [
      { id: "a", caregiver_user_id: "tina", scheduled_date: "2026-11-20" },
      { id: "b", caregiver_user_id: "tina", scheduled_date: "2026-11-18" },
      { id: "c", caregiver_user_id: "kay", scheduled_date: "2026-11-20" },
    ];
    expect(suggestVisit(visits, "tina", "2026-11-20T15:14:00Z")).toBe("a");
    expect(suggestVisit(visits, "tina", "2026-11-18T15:14:00Z")).toBe("b");
    expect(suggestVisit(visits, "pete", "2026-11-20T15:14:00Z")).toBe(null);
    expect(suggestVisit(visits, "tina", "2026-11-10T15:14:00Z")).toBe(null);
  });
});

describe("v1.138.1 — the meds line stays after a dose is checked off", () => {
  test("done doses are not filtered out of the line, they get a check", () => {
    const src = code("public/js/components/CareTasks.js");
    const line = src.slice(src.indexOf("const MedsLine"), src.indexOf("const CareTaskNextUpRow"));
    expect(line).not.toMatch(/o\.status === 'done' \|\| o\.status === 'skipped'\) continue/);
    expect(line).toMatch(/\\u2713/);
  });
});
