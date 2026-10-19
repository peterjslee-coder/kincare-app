/**
 * v1.112.4 — the What's New registry (src/whatsNew/entries.js). Pete: "this should be part of the
 * future rollouts too." These checks keep a careless entry from shipping a blank card, a picture
 * that doesn't exist, or a splash that greets a brand-new user with a month of history.
 */
const { raw } = require("./helpers/source");
const { ENTRIES, WINDOW_DAYS, entriesFor, publicEntry } = require("../src/whatsNew/entries");

const ROLES = new Set(["family", "caregiver", "care_for", "helper"]);
const client = raw("public/js/components/WhatsNew.js");

describe("every entry is complete", () => {
  test("ids are unique", () => {
    const ids = ENTRIES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  test.each(ENTRIES.map((e) => [e.id, e]))("%s", (_id, e) => {
    expect(e.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(e.title.length).toBeGreaterThan(3);
    expect(e.title.length).toBeLessThanOrEqual(60);
    expect(e.body.length).toBeGreaterThan(20);
    expect(Array.isArray(e.howTo) && e.howTo.length >= 1 && e.howTo.length <= 4).toBe(true);
    expect(e.audience.length).toBeGreaterThan(0);
    for (const r of e.audience) expect(ROLES.has(r)).toBe(true);
    // the picture must exist in the client's PREVIEWS map
    expect(client).toMatch(new RegExp(`\\n  ${e.preview}: \\(\\) =>`));
    if (e.action) expect(typeof e.action.page).toBe("string");
  });
  test("the JSON sent to the client carries no functions", () => {
    for (const e of ENTRIES) expect(Object.values(publicEntry(e)).some((v) => typeof v === "function")).toBe(false);
  });
});

describe("who sees what", () => {
  const now = new Date("2026-10-14T12:00:00Z");
  const ids = (p) => entriesFor({ now, ...p }).map((e) => e.id);

  test("a family member who joined before sees the family entries, not the caregiver one", () => {
    const got = ids({ roles: ["family"], createdAt: "2026-01-01" });
    expect(got).toEqual(expect.arrayContaining(["todos-next-visit", "documents-center", "todos-on-arrival"]));
    expect(got).not.toContain("todos-caregiver");
  });
  test("a caregiver sees the caregiver one", () => {
    expect(ids({ roles: ["caregiver"], createdAt: "2026-01-01" }).sort()).toEqual(["calendar-whole-month", "quiet-hours-what-happened", "time-change-in-words", "todos-caregiver", "todos-folded-bar"]);
  });
  test("seen entries do not come back, and a second entry on the same day still does", () => {
    const got = ids({ roles: ["family"], createdAt: "2026-01-01", seenIds: ["todos-next-visit"] });
    expect(got).not.toContain("todos-next-visit");
    expect(got).toContain("todos-on-arrival");
  });
  test("an account made after an entry shipped never sees it", () => {
    expect(ids({ roles: ["family"], createdAt: "2026-10-13T08:00:00Z" })).not.toContain("documents-center");
    expect(ids({ roles: ["family"], createdAt: "2026-10-13T08:00:00Z" })).toContain("todos-on-arrival");
  });
  test(`nothing older than ${WINDOW_DAYS} days`, () => {
    // From the NEWEST entry, not the fixed `now`: an entry dated after `now` is still inside
    // the window measured from `now` (v1.123.0's entry, dated 10/19, broke the fixed version).
    const newest = Math.max(now.getTime(), ...ENTRIES.map((e) => Date.parse(e.date + "T12:00:00Z")));
    const later = new Date(newest + (WINDOW_DAYS + 2) * 86400000);
    expect(entriesFor({ roles: ["family"], createdAt: "2026-01-01", now: later })).toEqual([]);
  });
  test("the ID entry only for someone still in their grace period", () => {
    expect(ids({ roles: ["family"], createdAt: "2026-01-01", careAccess: { status: "verified" } })).not.toContain("id-verification");
    expect(ids({ roles: ["family"], createdAt: "2026-01-01", careAccess: { status: "grace" } })).toContain("id-verification");
  });
});

test("CLAUDE.md carries the rule that every visible release ships an entry", () => {
  expect(raw("CLAUDE.md")).toMatch(/Every release a user can see ships with a What's New entry/);
});
