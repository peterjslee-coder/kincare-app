// The cancellation-fee push lands on the fee. (v1.109.9, feedback 9d286a8a)
//
// Pete: "I tapped on the push notification and it just brought me to the homepage. No
// explanation or no indication that there's a place for me to indicate something is wrong."
// The payload had no `page`, __handlePushNavigate had no branch, so `target` stayed null and the
// tap did nothing. These run the REAL router and the REAL service-worker click handler.

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

const appSrc = read("public/js/app.js");
const swSrc = read("public/sw.js");
const sessions = read("src/routes/sessions.js");
const sheet = read("public/js/components/CancelFeeSheet.js");

/** Pull `window.__handlePushNavigate = (d) => { ... };` out of app.js and run it in a sandbox. */
function loadRouter() {
  const start = appSrc.indexOf("window.__handlePushNavigate = (d) => {");
  expect(start).toBeGreaterThan(0);
  const end = appSrc.indexOf("\n    };\n  }, []);", start);
  const fnSrc = appSrc.slice(start, end + "\n    };".length);
  const pages = [];
  const events = [];
  const win = { dispatchEvent: (e) => events.push(e.type) };
  const ctx = {
    window: win,
    setCurrentPage: (p) => pages.push(p),
    setSelectedCareTeamId: () => {},
    setInterval: () => 0, clearInterval: () => {},
    setTimeout: (fn) => fn(),
    Event: function Event(type) { this.type = type; },
    String,
  };
  vm.runInNewContext(fnSrc, ctx);
  return { nav: win.__handlePushNavigate, win, pages, events };
}

describe("a warm tap opens the fee sheet", () => {
  test.each(["cancel_fee_notice", "cancel_fee_pending", "cancel_fee_waived"])("%s", (type) => {
    const r = loadRouter();
    r.nav({ type, sessionId: "s-1", amountCents: 5000 });
    expect(r.pages[0]).toBe("dashboard");
    expect(r.win.__pendingFocus).toBe("cancelFee:s-1");
    expect(r.events).toContain("inplace:focus");
  });

  test("an OLD payload (no page, no focus — what Pete's phone got) still lands", () => {
    const r = loadRouter();
    r.nav({ type: "cancel_fee_notice", sessionId: "s-2" });
    expect(r.win.__pendingFocus).toBe("cancelFee:s-2");
  });

  test("any other session-bearing push with no branch opens its visit instead of nothing", () => {
    // v1.105.126 set the focus for these and left target null, so they returned early.
    const r = loadRouter();
    r.nav({ type: "session_cancelled", sessionId: "s-3" });
    expect(r.pages[0]).toBe("dashboard");
    expect(r.win.__pendingFocus).toBe("session:s-3");
  });

  test("a push with nothing to open still does nothing", () => {
    const r = loadRouter();
    r.nav({ type: "something_new" });
    expect(r.pages).toEqual([]);
  });
});

describe("a cold tap (no window open) carries the fee through the URL", () => {
  function click(data) {
    const handlers = {};
    let opened = null;
    const ctx = {
      self: {
        addEventListener: (ev, fn) => { handlers[ev] = fn; },
        location: { origin: "https://app.test" },
        registration: { showNotification: () => Promise.resolve() },
        skipWaiting: () => Promise.resolve(),
        clients: { claim: () => Promise.resolve() },
      },
      clients: {
        matchAll: () => Promise.resolve([]),
        openWindow: (u) => { opened = u; return Promise.resolve(); },
      },
      caches: { open: () => Promise.resolve({ addAll: () => Promise.resolve(), put: () => Promise.resolve() }), keys: () => Promise.resolve([]), match: () => Promise.resolve(null), delete: () => Promise.resolve() },
      fetch: () => Promise.resolve({}),
      console, URL, Promise, Date, Response: function () {}, Request: function () {},
      setTimeout, clearTimeout, indexedDB: undefined, importScripts: () => {},
    };
    vm.runInNewContext(swSrc, ctx);
    let wait = null;
    handlers.notificationclick({
      action: undefined,
      notification: { data, close: () => {} },
      waitUntil: (p) => { wait = p; },
    });
    return wait.then(() => opened);
  }

  test("the fee push carries its page and focus", async () => {
    const url = await click({ type: "cancel_fee_notice", sessionId: "s-9", page: "dashboard", focus: "cancelFee:s-9" });
    expect(url).toBe(`/?page=dashboard&focus=${encodeURIComponent("cancelFee:s-9")}`);
  });

  test("and so does one sent before the payload had them", async () => {
    const url = await click({ type: "cancel_fee_pending", sessionId: "s-8" });
    expect(url).toBe(`/?page=dashboard&focus=${encodeURIComponent("cancelFee:s-8")}`);
  });

  test("a session push with no page opens its visit", async () => {
    const url = await click({ type: "no_show_cancelled", sessionId: "s-7" });
    expect(url).toBe(`/?page=dashboard&focus=${encodeURIComponent("session:s-7")}`);
  });
});

describe("the server payloads say where to go", () => {
  test.each(["cancel_fee_notice", "cancel_fee_pending", "cancel_fee_waived"])("%s", (type) => {
    const line = sessions.split("\n").find((l) => l.includes(`type: "${type}"`));
    expect(line).toMatch(/page: "dashboard"/);
    expect(line).toMatch(/focus: `cancelFee:\$\{req\.params\.id\}`/);
  });
});

describe("the sheet is reachable from anywhere", () => {
  test("it is in the bundle and mounted at the app root", () => {
    expect(read("scripts/build-client.js")).toMatch(/js\/components\/CancelFeeSheet\.js/);
    expect(appSrc).toMatch(/typeof CancelFeeSheet !== 'undefined' && <CancelFeeSheet \/>/);
  });

  test("it claims its own focus, clears it, and listens for the warm path", () => {
    expect(sheet).toMatch(/f\.startsWith\('cancelFee:'\)/);
    expect(sheet).toMatch(/window\.__pendingFocus = null;/);
    expect(sheet).toMatch(/window\.addEventListener\('inplace:focus', claim\)/);
    expect(sheet).toMatch(/window\.removeEventListener\('inplace:focus', claim\)/);
  });

  test("it calls the endpoints that had no caller, and says when a Needs-you row is answered", () => {
    expect(sheet).toMatch(/\/cancel-fee\/dispute/);
    expect(sheet).toMatch(/\/cancel-fee\/waive/);
    expect(sheet).toMatch(/\/cancel-fee`\)/);
    expect(sheet).toMatch(/new Event\('inplace:attention-stale'\)/);
    // 409 is "already answered", not a failure.
    expect(sheet).toMatch(/res\?\.status === 409/);
  });

  test("the caregiver's home draws her fee row, and only that", () => {
    expect(read("public/js/components/CaretakerHub.js")).toMatch(/<AttentionCard only=\{\['cancelFee'\]\}/);
  });
});
