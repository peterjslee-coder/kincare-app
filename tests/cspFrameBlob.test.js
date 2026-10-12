// v1.110.4 — Pete: "i uploaded a medical file and can't view." Chrome: "This content is blocked."
// Every in-app PDF preview is a same-origin blob: URL in an iframe (PdfPreview on non-WebKit),
// and the CSP frame-src allowed only Stripe — so every one was blocked on desktop, since v1.39.
const fs = require("fs");
const path = require("path");

const server = fs.readFileSync(path.join(__dirname, "..", "src", "server.js"), "utf8");
const dc = fs.readFileSync(path.join(__dirname, "..", "public", "js", "components", "DocumentsCenter.js"), "utf8");

test("CSP frame-src allows blob: (PDF previews) and still allows Stripe", () => {
  const line = server.split("\n").find((l) => /^\s*frameSrc:/.test(l));
  expect(line).toBeTruthy();
  expect(line).toContain('"blob:"');
  expect(line).toContain("https://js.stripe.com");
});

test("the Documents Center shows PDFs through PdfPreview, not a bare iframe", () => {
  expect(dc).toContain("<PdfPreview");
  expect(dc).not.toMatch(/<iframe\s+src=\{/);
});
