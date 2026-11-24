// A note has to still be in Activity tomorrow. (v1.105.176)
//
// Pete: "i get notifications for debbie leaving a note, and the deep link takes me right
// there. but I don't see her note in the activity. why not? is that a design or oversight?"
//
// Oversight, and it is arithmetic. The endpoint returned the N most recent notifications of
// every kind and the Activity card asks for ten. On his account that is 103 message
// notifications against 5 about a note — so Debbie's three notes from the day before sat at
// positions 10, 11 and 12, one place past the cut, and never reached the client at all.
//
// Messages are the only kind that arrive in bursts, and the only kind with a whole screen of
// their own plus an unread badge. So they group; nothing else does.

const { groupNotifications } = require("../src/utils/notificationGroups");
const { code } = require("./helpers/source");
const dashboard = code("public/js/components/Dashboard.js");

const msg = (id, convId, at, read = 0) => ({
  id, type: "message", title: "InPlace", body: "Sara Huber sent a message",
  data: JSON.stringify({ type: "message", conversationId: convId }), read, created_at: at,
});
const note = (id, at) => ({
  id, type: "family_visit", title: "Deborah added a note about Betty", body: "Tap to read",
  data: JSON.stringify({ type: "family_visit", careRecipientId: "betty" }), read: 0, created_at: at,
});

describe("a burst of messages takes one slot, not five", () => {
  test("same conversation collapses", () => {
    const rows = [msg("m5", "c1", "5"), msg("m4", "c1", "4"), msg("m3", "c1", "3"), msg("m2", "c1", "2"), msg("m1", "c1", "1")];
    const out = groupNotifications(rows, 10);
    expect(out).toHaveLength(1);
    expect(out[0].count).toBe(5);
    expect(out[0].ids).toEqual(["m5", "m4", "m3", "m2", "m1"]);
  });

  test("the group keeps the NEWEST row's timestamp and deep link", () => {
    // It is one row standing for several; it should behave like the most recent of them.
    const out = groupNotifications([msg("m2", "c1", "2026-09-02"), msg("m1", "c1", "2026-09-01")], 10);
    expect(out[0].id).toBe("m2");
    expect(out[0].created_at).toBe("2026-09-02");
  });

  test("different conversations stay separate", () => {
    const out = groupNotifications([msg("a", "c1", "3"), msg("b", "c2", "2"), msg("c", "c1", "1")], 10);
    expect(out).toHaveLength(2);
    expect(out.map((n) => n.count)).toEqual([2, 1]);
  });

  test("a group with one unread message in it is unread", () => {
    const out = groupNotifications([msg("a", "c1", "3", 1), msg("b", "c1", "2", 0)], 10);
    expect(out[0].read).toBe(0);
  });

  test("a message with no conversation id is left alone", () => {
    // Grouping on a missing key would fold unrelated rows into one.
    const orphan = { id: "x", type: "message", body: "hi", data: null, read: 0, created_at: "1" };
    const out = groupNotifications([orphan, msg("m", "c1", "0")], 10);
    expect(out).toHaveLength(2);
  });

  test("malformed data does not take the whole feed down", () => {
    const bad = { id: "x", type: "message", body: "hi", data: "{not json", read: 0, created_at: "1" };
    expect(() => groupNotifications([bad], 10)).not.toThrow();
    expect(groupNotifications([bad], 10)).toHaveLength(1);
  });
});

describe("everything that is not a message passes through untouched", () => {
  test("two notes are two rows, never one", () => {
    // Collapsing these would hide the very thing this endpoint exists to show.
    const out = groupNotifications([note("n2", "2"), note("n1", "1")], 10);
    expect(out).toHaveLength(2);
    expect(out.every((n) => n.count === 1)).toBe(true);
  });

  test("and every row carries ids, so the client never has to test for it", () => {
    const out = groupNotifications([note("n1", "1")], 10);
    expect(out[0].ids).toEqual(["n1"]);
  });
});

describe("Pete's actual feed", () => {
  test("the note survives a day of messages", () => {
    // Reconstructed from production: 9 messages newer than the note, the note beneath them.
    const rows = [];
    for (let i = 9; i >= 1; i--) rows.push(msg(`m${i}`, i > 4 ? "c1" : "c2", `t${i + 10}`));
    rows.push(note("debbie", "t5"));
    const out = groupNotifications(rows, 10);
    // Nine messages become two rows, so the note is now third rather than tenth.
    expect(out.map((n) => n.type)).toEqual(["message", "message", "family_visit"]);
    const noteRow = out.find((n) => n.type === "family_visit");
    expect(out.indexOf(noteRow)).toBeLessThan(3); // inside the collapsed card, not just the fetch
  });
});

describe("the client clears every notification a row stands for", () => {
  test("opening a group marks all of its ids read", () => {
    // Marking only the row's own id would leave the badge counting messages just shown.
    expect(dashboard).toMatch(/markNotificationsRead\(n\.ids \|\| \[n\.id\]\)/);
  });

  test("so does Mark all read", () => {
    expect(dashboard).toMatch(/markNotificationsRead\(unread\.flatMap\(n => n\.ids \|\| \[n\.id\]\)\)/);
  });
});
