// v1.105.44 — the badge has to correct itself after you deal with something.
//
// Pete, 8/6: "Sara texted… it went back to 2. But I don't know what the two things are and
// now it won't clear."
//
// Going UP proved delivery works (v1.105.43 fixed that). Coming back DOWN was still broken,
// for a reason worth pinning hard because it is the third time the same shape of mistake
// has cost a day: the correction was wired to ONE PLACE instead of to the fact that the
// count changed.
//
//   • Only GET /api/push/attention triggered it. Tap a push, land in Messages, read the
//     thread — the dashboard card that calls that endpoint never mounts, so nothing asks.
//   • And when it did fire it ran inside authenticate(), BEFORE the route handler. Reading
//     a thread sets last_read_at in the handler, so the sync computed the pre-read count
//     and pushed the number already on the icon.
//
// The fix hangs the correction off every authenticated request, on `finish`. These tests
// pin the debounce (whose TRAILING edge is the whole point) and the wiring.

const { code } = require("./helpers/source");

jest.mock("../src/utils/apns", () => ({
  isConfigured: () => true,
  sendApnsBadge: jest.fn().mockResolvedValue({ success: true }),
}));

const mockAll = jest.fn().mockResolvedValue([]);
jest.mock("../src/models/database", () => ({
  getDb: async () => ({ prepare: () => ({ all: mockAll, run: jest.fn().mockResolvedValue({}) }) }),
}));

const mockCount = jest.fn().mockResolvedValue({ total: 0 });
jest.mock("../src/utils/attention", () => ({ attentionCountFor: (...a) => mockCount(...a) }));

const { touchBadge, syncBadgeToDevices, _reset, MIN_INTERVAL_MS } = require("../src/utils/badgeSync");

// _run is async and fire-and-forget; let its microtasks drain.
const settle = () => new Promise((r) => setImmediate(r));

beforeEach(() => {
  _reset();
  mockCount.mockClear();
  mockAll.mockClear();
});
afterEach(() => { _reset(); jest.useRealTimers(); });

describe("the debounce — the trailing edge is the point", () => {
  test("the first touch runs straight away", async () => {
    touchBadge("pete");
    await settle();
    expect(mockCount).toHaveBeenCalledWith(expect.anything(), "pete");
  });

  test("a burst does not run once per request", async () => {
    for (let i = 0; i < 5; i++) touchBadge("pete");
    await settle();
    expect(mockCount).toHaveBeenCalledTimes(1);
  });

  test("but the burst DOES get a final run, after the window", async () => {
    // This is the bug rebuilt if we get it wrong. "Load conversations, open thread, mark
    // read" is one burst; the read happens in the LAST request. A plain cooldown drops
    // exactly that one, and if the user then puts the phone down nothing ever corrects
    // the icon — which is precisely what Pete saw.
    jest.useFakeTimers();
    touchBadge("pete");          // leading — count still 2 here
    touchBadge("pete");          // during cooldown: books the trailing run
    touchBadge("pete");
    jest.advanceTimersByTime(MIN_INTERVAL_MS + 10);
    jest.useRealTimers();
    await settle();
    expect(mockCount).toHaveBeenCalledTimes(2); // leading + trailing
  });

  test("one trailing run is booked, not one per touch", async () => {
    jest.useFakeTimers();
    touchBadge("pete");
    for (let i = 0; i < 20; i++) touchBadge("pete");
    jest.advanceTimersByTime(MIN_INTERVAL_MS * 3);
    jest.useRealTimers();
    await settle();
    expect(mockCount).toHaveBeenCalledTimes(2);
  });

  test("users are debounced independently", async () => {
    touchBadge("pete");
    touchBadge("sara");
    await settle();
    expect(mockCount).toHaveBeenCalledTimes(2);
  });

  test("no user id does nothing at all", async () => {
    touchBadge(null);
    touchBadge(undefined);
    touchBadge("");
    await settle();
    expect(mockCount).not.toHaveBeenCalled();
  });

  test("a failing count never throws out of touchBadge", async () => {
    mockCount.mockRejectedValueOnce(new Error("db down"));
    expect(() => touchBadge("pete")).not.toThrow();
    await settle();
  });

  test("the timer never holds the process open", () => {
    // A badge must not keep a container alive, or stall jest.
    expect(code("src/utils/badgeSync.js")).toMatch(/s\.timer\.unref\(\)/);
  });
});

describe("what actually reaches the device", () => {
  test("only iOS native subscriptions, and only when the number changed", async () => {
    const rows = [
      { id: "web", subscription_json: JSON.stringify({ endpoint: "https://fcm/x" }), last_badge: null },
      { id: "ios-same", subscription_json: JSON.stringify({ type: "native", platform: "ios", token: "t1" }), last_badge: 3 },
      { id: "ios-stale", subscription_json: JSON.stringify({ type: "native", platform: "ios", token: "t2" }), last_badge: 0 },
      { id: "android", subscription_json: JSON.stringify({ type: "native", platform: "android", token: "t3" }), last_badge: 0 },
    ];
    const sent = [];
    const apns = require("../src/utils/apns");
    apns.sendApnsBadge.mockClear();
    apns.sendApnsBadge.mockImplementation(async (token, n) => { sent.push([token, n]); return { success: true }; });

    const db = { prepare: () => ({ all: async () => rows, run: async () => ({}) }) };
    await syncBadgeToDevices(db, "pete", 3);

    expect(sent).toEqual([["t2", 3]]); // web skipped, android skipped, ios-same already right
  });

  test("a negative or junk total lands as 0, never as NaN", async () => {
    const apns = require("../src/utils/apns");
    apns.sendApnsBadge.mockClear();
    const rows = [{ id: "a", subscription_json: JSON.stringify({ type: "native", platform: "ios", token: "t" }), last_badge: 9 }];
    const db = { prepare: () => ({ all: async () => rows, run: async () => ({}) }) };
    await syncBadgeToDevices(db, "pete", undefined);
    expect(apns.sendApnsBadge).toHaveBeenCalledWith("t", 0);
  });
});

describe("the wiring — where the correction hangs from", () => {
  const auth = code("src/middleware/auth.js");
  const push = code("src/routes/push.js");
  const utils = code("public/js/utils.js");

  test("every authenticated request corrects the badge", () => {
    expect(auth).toMatch(/const \{ touchBadge \} = require\("\.\.\/utils\/badgeSync"\)/);
    expect(auth).toMatch(/touchBadge\(decoded\.id\)/);
  });

  test("it runs on finish, AFTER the handler — not before it", () => {
    // Running before the handler is why reading a thread pushed the stale number back.
    expect(auth).toMatch(/res\.on\("finish", \(\) => touchBadge\(decoded\.id\)\)/);
    const at = auth.indexOf("touchBadge");
    expect(auth.slice(0, at)).toMatch(/req\.user = decoded;/);
  });

  test("a badge failure can never 401 someone", () => {
    const block = auth.slice(auth.indexOf("req.user = decoded;"), auth.indexOf("next();", auth.indexOf("req.user = decoded;")));
    expect(block).toMatch(/try \{/);
    expect(block).toMatch(/catch/);
  });

  test("the endpoint is no longer the only trigger", () => {
    expect(push).toMatch(/require\("\.\.\/utils\/badgeSync"\)/);
    expect(push).not.toMatch(/async function syncBadgeToDevices/);
  });

  test("the client asks the server BEFORE checking whether it can draw a badge", () => {
    // WKWebView has no setAppBadge. Guarding the fetch behind it disabled the one platform
    // that has an app icon to badge — the fetch is what tells the server the app is open.
    const fn = utils.slice(utils.indexOf("const refreshAppBadge"), utils.indexOf("const checkPushHealth"));
    expect(fn.indexOf("apiFetch('/api/push/attention')")).toBeLessThan(fn.indexOf("navigator.setAppBadge"));
  });

  test("the foreground listener is registered unconditionally, and covers Capacitor resume", () => {
    expect(utils).toMatch(/if \(typeof document !== 'undefined'\) \{/);
    expect(utils).toMatch(/addEventListener\('resume'/);
  });
});
