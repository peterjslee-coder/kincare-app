// Every "Needs you" row goes somewhere that exists, and does something when it gets there.
// (v1.105.105)
//
// Pete, 917f3787: five unread messages showed in the tile and should not — "I wanted to show
// up as the notifications over the message pill" — while the one thing that DID need him,
// Julia's time-change request, "doesn't do anything. It is a dead end."
//
// The dead end was literal. The row's target page was 'sessions'. app.js has no such page, so
// renderPage fell through to its `return <Dashboard/>` default and re-rendered the screen he
// was already looking at. A page name that does not exist fails as a page name that does.
//
// The second half is the same silent-absence class as v1.105.72: `window.__pendingFocus` was
// SET in four places in app.js and READ in exactly one component. Every `session:<id>` focus —
// including the ones a push tap writes — was discarded.

const fs = require("fs");
const path = require("path");
const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
const app = read("public/js/app.js");
const card = read("public/js/components/AttentionCard.js");
const attention = read("src/utils/attention.js");
const dashboard = read("public/js/components/Dashboard.js");
const hub = read("public/js/components/CaretakerHub.js");

/** Page names app.js actually renders, plus its documented fallback. */
const realPages = new Set(
  [...app.matchAll(/currentPage === '([a-z-]+)'/g)].map((m) => m[1])
);

describe("every row points at a page that exists", () => {
  const targets = [...card.matchAll(/page: '([a-z-]+)'/g)].map((m) => m[1]);

  test("there are rows to check", () => {
    expect(targets.length).toBeGreaterThan(0);
  });

  test.each(targets)("'%s' is a page app.js renders", (page) => {
    expect(realPages.has(page)).toBe(true);
  });

  test("'sessions' — the one that broke — is confirmed NOT a page", () => {
    // Guards the test itself: if 'sessions' ever becomes real, this reminder can go.
    expect(realPages.has("sessions")).toBe(false);
  });
});

describe("unread messages are not in this tile", () => {
  test("no messages row", () => {
    expect(card).not.toMatch(/key: 'messages'/);
  });

  test("and they are not in the total either", () => {
    // The card and the app icon both read `total`. Dropping the row but not the total would
    // leave the icon permanently higher than the list that is supposed to itemise it — the
    // one disagreement this card exists to prevent.
    expect(attention).toMatch(/total: reimbursements \+ timeChanges \+ careTasks,/);
  });

  test("the count is still reported, just not counted", () => {
    expect(attention).toMatch(/^\s+messages,$/m);
  });

  test("the message pill still carries them", () => {
    expect(app).toMatch(/item\.id === 'messages' && unreadMsgCount > 0/);
  });
});

describe("the time-change row opens the actual visit", () => {
  test("the server says which visit", () => {
    expect(attention).toMatch(/timeChangeSessionId/);
    expect(attention).toMatch(/ORDER BY cs\.scheduled_date, cs\.scheduled_time\n\s+LIMIT 1/);
  });

  test("an id is never coerced to a count", () => {
    // safe() turns anything non-finite into 0, which would make a session id the number zero.
    expect(attention).toMatch(/async function safeId\(/);
    expect(attention).toMatch(/await safeId\("timeChangeSession"/);
  });

  test("the row writes the focus and announces it", () => {
    expect(card).toMatch(/window\.__pendingFocus = `\$\{r\.focusPrefix\}:\$\{id\}`/);
    expect(card).toMatch(/dispatchEvent\(new Event\('inplace:focus'\)\)/);
  });

  test("both dashboards claim it", () => {
    for (const [name, src] of [["Dashboard", dashboard], ["CaretakerHub", hub]]) {
      expect(src).toMatch(/f\.startsWith\('session:'\)/);
      expect(src).toMatch(/window\.addEventListener\('inplace:focus', claim\)/);
      expect(src).toMatch(/window\.removeEventListener\('inplace:focus', claim\)/);
      expect(name && src).toMatch(/setVisitDetailSessionId\(id\)/);
    }
  });

  test("the focus is cleared once claimed", () => {
    // Otherwise a later remount reopens a modal the person already closed.
    for (const src of [dashboard, hub]) {
      const eff = src.slice(src.indexOf("const claim = () =>"));
      expect(eff.slice(0, 500)).toMatch(/window\.__pendingFocus = null;\n\s+setVisitDetailSessionId\(id\)/);
    }
  });
});
