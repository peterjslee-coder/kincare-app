// v1.159.0 — the last 24 hours as up / quiet / not watching (utils/awake.js timeline).
// Pete, 11/25: "when it stopped detecting her, like when she went to sleep and when it started
// detecting her again." A quiet stretch only means asleep if the Hub was watching then.
const { timeline } = require("../src/utils/awake");

const fakeDb = (ups, watches) => ({
  prepare: (sql) => ({
    all: async () => (sql.includes("FROM hub_awake") ? ups : watches),
  }),
});
const T = (hhmm) => new Date(`2026-11-25T${hhmm}:00Z`).toISOString(); // UTC; tz below is UTC

test("watching all night with two wake-ups reads up / quiet / up / quiet", async () => {
  const db = fakeDb(
    [{ started_at: T("02:04"), ended_at: T("02:40"), motion_minutes: 20, voice_minutes: 3, touches: 0 },
     { started_at: T("06:51"), ended_at: T("07:03"), motion_minutes: 10, voice_minutes: 0, touches: 2 }],
    [{ started_at: T("00:00"), ended_at: T("07:05") }],
  );
  const out = await timeline(db, "cr1", "UTC", 8, new Date(T("07:05")));
  // The window opens at 11:05 PM, before the Hub's first report at midnight: not watching.
  expect(out.map((e) => e.kind)).toEqual(["notWatching", "quiet", "up", "quiet", "up", "quiet"]);
  expect(out[0]).toMatchObject({ fromLabel: "11:05 PM", toLabel: "12:00 AM" });
  expect(out[2]).toMatchObject({ fromLabel: "2:04 AM", toLabel: "2:40 AM", motion: true, talking: true, touches: false });
  expect(out[4]).toMatchObject({ fromLabel: "6:51 AM", toLabel: "7:03 AM", touches: true });
});

test("a gap in the Hub's reports reads as not watching, never as asleep", async () => {
  const db = fakeDb([], [{ started_at: T("00:00"), ended_at: T("02:00") }, { started_at: T("03:00"), ended_at: T("05:00") }]);
  const out = await timeline(db, "cr1", "UTC", 6, new Date(T("05:00")));
  expect(out.map((e) => e.kind)).toEqual(["notWatching", "quiet", "notWatching", "quiet"]);
  expect(out[2]).toMatchObject({ fromLabel: "2:00 AM", toLabel: "3:00 AM" });
});

test("before any watch reports exist, noticed periods still show", async () => {
  const db = fakeDb([{ started_at: T("06:51"), ended_at: T("07:03"), motion_minutes: 10, voice_minutes: 0, touches: 0 }], []);
  const out = await timeline(db, "cr1", "UTC", 24, new Date(T("07:10")));
  expect(out).toHaveLength(1);
  expect(out[0]).toMatchObject({ kind: "up", fromLabel: "6:51 AM", toLabel: "7:03 AM" });
});

describe("nightStory — last night in one sentence (Pete, 11/25)", () => {
  const { nightStory } = require("../src/utils/awake");
  const db = (rows) => ({ prepare: () => ({ all: async () => rows }) });
  // America/New_York in late November is UTC-5.
  const E = (local) => { const [d, hm] = local.split(" "); return new Date(`${d}T${hm}:00-05:00`).toISOString(); };
  test("awake until 11 PM, then again from 4 to 6 AM", async () => {
    const rows = [
      { started_at: E("2026-11-24 19:00"), ended_at: E("2026-11-24 20:10") },
      { started_at: E("2026-11-24 20:30"), ended_at: E("2026-11-24 22:58") }, // joins (20 min gap)
      { started_at: E("2026-11-25 04:02"), ended_at: E("2026-11-25 05:56") },
    ];
    const s = await nightStory(db(rows), "cr", "Betty", "America/New_York", new Date(E("2026-11-25 07:08")));
    expect(s).toBe("Betty was awake until about 11 PM, then up again from about 4 AM to 6 AM.");
  });
  test("still up now", async () => {
    const rows = [{ started_at: E("2026-11-25 06:51"), ended_at: E("2026-11-25 07:05") }];
    const s = await nightStory(db(rows), "cr", "Betty", "America/New_York", new Date(E("2026-11-25 07:08")));
    expect(s).toBe("Betty has been up since about 6:45 AM.");
  });
  test("all three together", async () => {
    const rows = [
      { started_at: E("2026-11-24 21:00"), ended_at: E("2026-11-24 23:02") },
      { started_at: E("2026-11-25 03:50"), ended_at: E("2026-11-25 05:10") },
      { started_at: E("2026-11-25 06:50"), ended_at: E("2026-11-25 07:06") },
    ];
    const s = await nightStory(db(rows), "cr", "Betty", "America/New_York", new Date(E("2026-11-25 07:08")));
    expect(s).toBe("Betty was awake until about 11 PM, then up again from about 3:45 AM to 5:15 AM, and has been up since about 6:45 AM.");
  });
  test("nothing noticed", async () => {
    expect(await nightStory(db([]), "cr", "Betty", "America/New_York", new Date(E("2026-11-25 07:08")))).toBe("The Hub hasn't noticed Betty up since 6 PM.");
  });
});
