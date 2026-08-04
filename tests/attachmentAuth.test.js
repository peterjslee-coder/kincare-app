// v1.105.34 — attachments must be fetched, never navigated to.
//
// Pete, Aug 4: clicking the receipt for a $600 sink opened a tab reading "Authentication
// required". The Railway log said exactly why:
//
//   [Auth 401] No token — path: /api/reimbursements/receipt/2c1c…, hasBearerHeader: false,
//              hasCookie: false, cookieKeys:
//
// An empty cookie jar on a same-origin path. The auth cookie is httpOnly/SameSite=Lax on
// path "/", so a tab in the app would have sent it — which means the link was not opened in
// the app at all. `target="_blank"` inside the Capacitor WebView hands the URL to the system
// browser, which has its own jar and no session.
//
// This is a WHOLE-CLASS bug, not one link: any `<a href="/api/…">` is an unauthenticated
// request. There were three (two receipt lists and the care-note photo). This test exists so
// a fourth cannot be added quietly.

const fs = require("fs");
const path = require("path");
const { code } = require("./helpers/source");

const CLIENT_DIR = path.join(__dirname, "..", "public", "js");

function clientFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "js-compiled" ? [] : clientFiles(full);
    return e.name.endsWith(".js") ? [full] : [];
  });
}

describe("no client code navigates the browser to an authenticated API path", () => {
  test("there are no raw <a href> or window.open calls pointing at /api/", () => {
    const offenders = [];
    for (const file of clientFiles(CLIENT_DIR)) {
      const rel = path.relative(path.join(__dirname, "..", "public"), file);
      const src = code(path.join("public", rel));
      // href={`/api/…`}, href="/api/…", href={'/api/…'}, and window.open('/api/…')
      const patterns = [
        /href=\{`\/api\//,
        /href="\/api\//,
        /href=\{'\/api\//,
        /window\.open\(\s*[`'"]\/api\//,
      ];
      if (patterns.some((p) => p.test(src))) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });
});

describe("the viewer fetches through apiFetch", () => {
  const viewer = code("public/js/components/AttachmentViewer.js");

  test("it uses apiFetch, which carries the Bearer token and the cookie", () => {
    expect(viewer).toMatch(/const res = await apiFetch\(path\)/);
  });

  test("it renders a blob URL, so Save works without credentials", () => {
    expect(viewer).toMatch(/URL\.createObjectURL\(blob\)/);
    expect(viewer).toMatch(/href=\{entry\.url\} download=/);
  });

  test("object URLs are revoked — a cache that never evicts is a leak", () => {
    expect(viewer).toMatch(/URL\.revokeObjectURL/);
    expect(viewer).toMatch(/__attachmentBlobCache\.size > ATTACHMENT_CACHE_LIMIT/);
  });

  test("thumbnails load lazily, so a long ledger is not a burst of megabyte fetches", () => {
    expect(viewer).toMatch(/new IntersectionObserver/);
    // …and still work where the API is missing, rather than showing nothing forever.
    expect(viewer).toMatch(/typeof IntersectionObserver === 'undefined'/);
  });

  test("pinch, double-tap and wheel all zoom, and the browser does not steal the gesture", () => {
    expect(viewer).toMatch(/onTouchStart=\{onTouchStart\}/);
    expect(viewer).toMatch(/touchAction: 'none'/);
    expect(viewer).toMatch(/now - g\.lastTap < 300/); // double-tap
    expect(viewer).toMatch(/onWheel=\{onWheel\}/);
  });

  test("zoom is anchored to the fingers, not the corner", () => {
    // Without this the image lurches away from whatever you were trying to read.
    expect(viewer).toMatch(/x: cx - \(cx - v\.x\) \* ratio, y: cy - \(cy - v\.y\) \* ratio/);
  });

  test("PDFs render inline rather than falling back to a download", () => {
    expect(viewer).toMatch(/<iframe title=\{current\.name\} src=\{entry\.url\}/);
  });
});

describe("one state, one name", () => {
  test("a reimbursement awaiting its approver reads the same everywhere", () => {
    // Pete saw his own requests as "Pending approval" and Dan's as "Awaiting approval" and
    // reasonably assumed they were different states. Same state, three surfaces, three names.
    const reimb = code("public/js/components/Reimbursements.js");
    const money = code("public/js/components/MoneyView.js");
    expect(reimb).toMatch(/pending:\s*\{ label: 'Awaiting approval'/);
    expect(reimb).toMatch(/pending_approval: \{ t: 'Awaiting approval'/);
    expect(money).toMatch(/return 'Awaiting approval'/);
    expect(reimb).not.toMatch(/'Pending approval'/);
  });
});
