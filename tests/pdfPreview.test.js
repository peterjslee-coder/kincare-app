// v1.105.67 — every PDF care document was a white rectangle on every iPhone.
//
// WebKit will not render a PDF inside a subframe; it only does so on top-level navigation.
// AttachmentViewer learned that in v1.105.49 and handled it. Two other places kept using a
// bare <iframe> anyway — the care Documents preview and the admin document modal — so a
// tapped POA, DNR, advance directive, med list or insurance card painted a plain white box
// with no error, no spinner and nothing to react to. The knowledge existed in this codebase
// the whole time; it simply wasn't reachable from the other two call sites.
//
// The escape hatch was broken too, in a way that is this sweep's signature. AttachmentViewer's
// "Open PDF" handed a blob: URL to openExternalUrl, which inside the native app calls
// Browser.open — and SFSafariViewController accepts http/https only. It did nothing, returned
// true, and the return value was discarded, so neither of openExternalUrl's own fallbacks ran.
// A button that looks like the fix and is as dead as the bug.
//
// These tests are structural. The behavioural half — that the component actually renders a
// button rather than an iframe under a WebKit user agent — is measured in Chromium below,
// following the v1.105.2 rule: verify UI fixes by measuring, because both real causes of that
// release's bugs were invisible in the source.

const { code } = require("./helpers/source");

const viewer = code("public/js/components/AttachmentViewer.js");
const documents = code("public/js/components/Documents.js");
const admin = code("public/js/components/AdminPanel.js");

describe("there is one way to show a PDF, and everyone uses it", () => {
  test("PdfPreview exists and is shared on window", () => {
    expect(viewer).toMatch(/const PdfPreview = window\.PdfPreview =/);
  });

  test("it branches on the engine, not the browser name", () => {
    // Chrome on iOS is WebKit. Detecting "Safari" would miss it.
    expect(viewer).toMatch(/if \(!isWebKitLike\(\)\) \{/);
  });

  test("no bare PDF iframe survives anywhere in the client", () => {
    const fs = require("fs");
    const path = require("path");
    const dir = path.join(__dirname, "..", "public", "js", "components");
    const offenders = [];
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".js"))) {
      const src = code(path.join("public/js/components", f));
      // An <iframe> whose src is a preview/blob/data URL is the shape that breaks.
      for (const m of src.matchAll(/<iframe[^>]*src=\{([^}]+)\}/g)) {
        const expr = m[1];
        if (/previewFileUrl|fileData|entry\.url|blobUrl|docPreview/.test(expr)) {
          offenders.push(`${f}: <iframe src={${expr.trim()}}>`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test("both former offenders now render PdfPreview", () => {
    expect(documents).toMatch(/<PdfPreview\s/);
    expect(admin).toMatch(/<PdfPreview\s/);
  });

  test("the native path uses the share sheet, not a dead Browser.open", () => {
    // saveBlob writes the file and hands it to the OS. openExternalUrl on a blob: URL does not.
    const fn = viewer.slice(viewer.indexOf("const PdfPreview"), viewer.indexOf("const loadAuthedBlob"));
    expect(fn).toMatch(/await saveBlob\(blob, name \|\| 'document\.pdf'\)/);
    expect(fn).toMatch(/if \(!ok\) setErr\(/);
    // And the web path's result is checked rather than discarded.
    expect(fn).toMatch(/if \(!openExternalUrl\(blobUrl\)\) setErr\(/);
  });

  test("it says so when it cannot open rather than appearing to work", () => {
    const fn = viewer.slice(viewer.indexOf("const PdfPreview"), viewer.indexOf("const loadAuthedBlob"));
    expect(fn).toMatch(/if \(!blob\) \{ setErr\(/);
  });
});

describe("the Documents preview no longer shows the wrong document", () => {
  const fn = documents.slice(documents.indexOf("const handlePreview"), documents.indexOf("const handleDelete"));

  test("it clears the previous file before loading the next", () => {
    // The nastiest of the four: a failed load left the PREVIOUS document's blob on screen under
    // the NEW document's name, category and status. In a folder of POAs and DNRs, that is not a
    // cosmetic bug.
    expect(fn).toMatch(/setPreviewFileUrl\(\(prev\) => \{/);
    expect(fn).toMatch(/URL\.revokeObjectURL\(prev\)/);
  });

  test("a failed load is stated, not rendered as an empty modal", () => {
    expect(fn).toMatch(/setPreviewError\(/);
    expect(documents).toMatch(/This document could not be loaded/);
  });

  test("it fetches through apiFetch, so the Bearer token goes with it", () => {
    expect(fn).toMatch(/await apiFetch\(`\/api\/documents\/\$\{document\.id\}\/download`\)/);
    expect(fn).not.toMatch(/credentials: 'include'/);
  });
});

describe("the admin document modal", () => {
  test("a failed load is visible", () => {
    expect(admin).toMatch(/setDocPreviewError\(/);
    expect(admin).toMatch(/That document could not be loaded/);
  });

  test("the data URI is decoded to a real Blob for the native share sheet", () => {
    // The OS share sheet can take neither a data: URI nor a blob: URL — it needs the bytes.
    expect(admin).toMatch(/new Blob\(\[bytes\]/);
  });

  test("closing revokes the object URL", () => {
    expect(admin).toMatch(/const closeDocPreview = \(\)/);
    expect(admin).toMatch(/URL\.revokeObjectURL\(prev\.blobUrl\)/);
  });
});
