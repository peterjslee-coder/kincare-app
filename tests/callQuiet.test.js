// v1.163.0 — Pete, 11/25: "if I call during quiet hours twice within a minute, it rings through."
const cq = require("../src/utils/callQuiet");
const { code } = require("./helpers/source");

const fakeDb = (cr, prefs) => ({
  prepare: (sql) => ({
    get: async () => (/care_recipients/.test(sql) ? cr : { notification_prefs: prefs }),
  }),
});
const hubOn = (from = "21:00", to = "06:00") => JSON.stringify({ on: true, hub: { on: true, dimFrom: from, dimTo: to } });
// 2026-11-26 03:00 UTC = 10:00 PM Eastern on the 25th; 17:00 UTC = noon Eastern.
const NIGHT = new Date("2026-11-26T03:00:00Z");
const NOON = new Date("2026-11-26T17:00:00Z");

describe("whose quiet hours", () => {
  test("her Hub's night hours, in the care location's zone", async () => {
    const db = fakeDb({ id: "cr", simple_mode: hubOn(), timezone: "America/New_York" }, null);
    expect(await cq.quietFor(db, "betty", NIGHT)).toEqual({ quiet: true, until: "06:00" });
    expect(await cq.quietFor(db, "betty", NOON)).toEqual({ quiet: false });
  });
  test("her own quiet hours count too, Hub or no Hub", async () => {
    const db = fakeDb({ id: "cr", simple_mode: JSON.stringify({ on: true }), timezone: "America/New_York" },
      JSON.stringify({ quiet_hours: { enabled: true, start: "21:30", end: "07:00", tz: "America/New_York" } }));
    expect(await cq.quietFor(db, "betty", NIGHT)).toEqual({ quiet: true, until: "07:00" });
  });
  test("someone who isn't a care recipient is never held here", async () => {
    const db = fakeDb(undefined, JSON.stringify({ quiet_hours: { enabled: true, start: "21:00", end: "07:00" } }));
    expect(await cq.quietFor(db, "pete", NIGHT)).toEqual({ quiet: false });
  });
  test("a Hub that is off adds no quiet hours", async () => {
    const db = fakeDb({ id: "cr", simple_mode: JSON.stringify({ on: true, hub: { on: false } }), timezone: "America/New_York" }, null);
    expect(await cq.quietFor(db, "betty", NIGHT)).toEqual({ quiet: false });
  });
});

describe("twice within a minute rings through", () => {
  beforeEach(() => cq._reset());
  test("first held, second within 60 s rings, third starts over", () => {
    expect(cq.ringThrough("pete", "betty", 1000)).toBe("hold");
    expect(cq.ringThrough("pete", "betty", 1000 + 59000)).toBe("through");
    expect(cq.ringThrough("pete", "betty", 1000 + 61000)).toBe("hold");
  });
  test("more than a minute apart is two first tries", () => {
    expect(cq.ringThrough("pete", "betty", 0)).toBe("hold");
    expect(cq.ringThrough("pete", "betty", 61000)).toBe("hold");
  });
  test("one caller's first try doesn't let another caller through", () => {
    expect(cq.ringThrough("pete", "betty", 0)).toBe("hold");
    expect(cq.ringThrough("sara", "betty", 10000)).toBe("hold");
  });
});

describe("wiring", () => {
  const server = code("src/server.js");
  test("the held call rings nowhere and tells the caller; the second skips the push hold", () => {
    expect(server).toMatch(/if \(cq\.ringThrough\(userId, data\.targetUserId\) === "hold"\) \{[\s\S]{0,400}via: "quiet"[\s\S]{0,120}return;/);
    expect(server).toMatch(/\{ skipEndpoints, skipKinds, bypassQuietHours: throughQuiet \}/);
    // Checked before anything rings natively.
    expect(server.indexOf('require("./utils/callQuiet")')).toBeLessThan(server.indexOf('require("./utils/callDevices")'));
    expect(code("src/routes/push.js")).toMatch(/if \(!\(opts && opts\.bypassQuietHours\) && shouldHold\(/);
  });
  test("the caller is told how to get through", () => {
    expect(code("public/js/components/VideoCallOverlay.js")).toMatch(/ringStatus === 'quiet' \?/);
  });
});
