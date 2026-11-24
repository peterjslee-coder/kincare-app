/**
 * v1.119.1 — the quiet-hours summary says what was held (feedback 0783ec12).
 */
const { buildQuietSummary } = require("../src/utils/quietHours");

const item = (title, data, type = "team_note") => ({ id: title, title, type, data: data ? JSON.stringify(data) : null, created_at: "2026-10-15T10:00:00Z" });

describe("buildQuietSummary", () => {
  test("one item: the body is its title and the push opens it", () => {
    const s = buildQuietSummary([item("New message from Sam", { type: "message", conversationId: "c1" }, "message")], 1);
    expect(s.body).toBe("New message from Sam");
    expect(s.data).toEqual({ type: "message", conversationId: "c1" });
    expect(s.inAppData.items).toHaveLength(1);
  });

  test("an item with no data still opens as its own type", () => {
    const s = buildQuietSummary([item("Visit update", null, "check_in")], 1);
    expect(s.data).toEqual({ type: "check_in" });
  });

  test("two or three: all named", () => {
    expect(buildQuietSummary([item("A"), item("B")], 2).body).toBe("2 updates: A · B");
    expect(buildQuietSummary([item("A"), item("B"), item("C")], 3).body).toBe("3 updates: A · B · C");
  });

  test("more than three: two named and the rest counted", () => {
    const s = buildQuietSummary([item("A"), item("B"), item("C"), item("D"), item("E")], 5);
    expect(s.body).toBe("5 updates: A · B · and 3 more");
    expect(s.data).toEqual({ type: "quiet_hours_summary", page: "dashboard" });
    expect(s.inAppData.items.map((i) => i.title)).toEqual(["A", "B", "C", "D", "E"]);
  });

  test("count higher than the rows found (an in-app row failed): never claims fewer", () => {
    expect(buildQuietSummary([item("A")], 3).body).toBe("3 updates: A · and 2 more");
  });

  test("no rows at all: the count-only wording", () => {
    expect(buildQuietSummary([], 1).body).toBe("1 update came in during quiet hours.");
    expect(buildQuietSummary([], 4).body).toBe("4 updates came in during quiet hours.");
  });

  test("bodies are never repeated — only titles reach the lock screen", () => {
    const s = buildQuietSummary([{ ...item("New note — Jane"), body: "she fell" }], 1);
    expect(JSON.stringify({ b: s.body, d: s.data })).not.toContain("fell");
  });
});
