/**
 * Stored files must not be able to execute (v1.106.3).
 *
 * Three write paths stored whatever string arrived in `photo`, and five read paths echoed the
 * stored mime straight back as the Content-Type. So `data:text/html;base64,<script>...` came
 * back as executable HTML from our own origin, where the CSP allows inline script — and
 * same-origin script can read the CSRF cookie, act as whoever opened the link, and lift an
 * admin's impersonation token out of sessionStorage. The SVG route to the same place was open
 * too: two upload filters took any `image/*`, and `image/svg+xml` has no magic-byte signature,
 * so the validator returned "valid" for it.
 *
 * These are behaviour tests: they call the real functions with the real payloads.
 */
const { validateMagicBytes } = require("../src/utils/fileValidation");
const { sendStoredFile, validateImageDataUrl, IMAGE_MIMES } = require("../src/utils/serveMedia");
const { code } = require("./helpers/source");

const b64 = (s) => Buffer.from(s).toString("base64");
const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 1),
]);
const REAL_PNG = `data:image/png;base64,${PNG_BYTES.toString("base64")}`;
const HTML_PAYLOAD = `data:text/html;base64,${b64("<html><script>alert(document.cookie)</script></html>   ")}`;
const SVG_PAYLOAD = `data:image/svg+xml;base64,${b64('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')}`;
const HTML_AS_PNG = `data:image/png;base64,${b64("<html><script>alert(1)</script></html>   ")}`;

function stubRes() {
  const res = {
    statusCode: 200, headers: {}, body: null, ended: false,
    status(c) { this.statusCode = c; return this; },
    set(k, v) { this.headers[k.toLowerCase()] = v; return this; },
    send(b) { this.body = b; return this; },
    end() { this.ended = true; return this; },
  };
  return res;
}

describe("the write side refuses anything that is not a verifiable image", () => {
  test("a text/html payload is rejected", () => {
    const r = validateImageDataUrl(HTML_PAYLOAD);
    expect(r.ok).toBe(false);
  });

  test("an SVG is rejected — it is a script container, not a picture", () => {
    expect(validateImageDataUrl(SVG_PAYLOAD).ok).toBe(false);
    expect(IMAGE_MIMES).not.toContain("image/svg+xml");
  });

  test("HTML wearing an image/png label is rejected on its bytes", () => {
    expect(validateImageDataUrl(HTML_AS_PNG).ok).toBe(false);
  });

  test("a plain string, a remote URL, and an empty body are all rejected", () => {
    for (const bad of ["", "not a data url", "https://evil.example/x.png", null, undefined, 42]) {
      expect(validateImageDataUrl(bad).ok).toBe(false);
    }
  });

  test("a real PNG is accepted", () => {
    const r = validateImageDataUrl(REAL_PNG);
    expect(r.ok).toBe(true);
    expect(r.mime).toBe("image/png");
  });

  test("oversize images are rejected", () => {
    const big = `data:image/png;base64,${Buffer.concat([PNG_BYTES, Buffer.alloc(3 * 1024 * 1024)]).toString("base64")}`;
    expect(validateImageDataUrl(big, { maxBytes: 1024 }).ok).toBe(false);
  });
});

describe("the read side is the backstop for rows written before the write side was fixed", () => {
  test("a stored text/html payload is not served", () => {
    const res = stubRes();
    sendStoredFile(res, HTML_PAYLOAD);
    expect(res.statusCode).toBe(404);
    expect(res.body).toBeNull();
  });

  test("a stored SVG is not served", () => {
    const res = stubRes();
    sendStoredFile(res, SVG_PAYLOAD);
    expect(res.statusCode).toBe(404);
  });

  test("a stored remote URL is not redirected to — that was an authenticated open redirect", () => {
    const res = stubRes();
    sendStoredFile(res, "https://evil.example/tracker.png");
    expect(res.statusCode).toBe(404);
    expect(res.headers.location).toBeUndefined();
  });

  test("a real PNG is served, with the mime from OUR allowlist", () => {
    const res = stubRes();
    sendStoredFile(res, REAL_PNG);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(Buffer.isBuffer(res.body)).toBe(true);
  });

  test("what is served is inert even if something unexpected gets through", () => {
    const res = stubRes();
    sendStoredFile(res, REAL_PNG);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-security-policy"]).toMatch(/default-src 'none'; sandbox/);
    expect(res.headers["content-disposition"]).toMatch(/^inline/);
  });

  test("the filename in Content-Disposition cannot carry a quote or a newline out", () => {
    const res = stubRes();
    sendStoredFile(res, REAL_PNG, { filename: 'evil"; x=\n<script>' });
    const header = res.headers["content-disposition"];
    // the header legitimately wraps the value in quotes — it is the VALUE that must be clean,
    // so that a crafted file_name cannot close the quote and inject another header parameter
    const value = header.match(/^inline; filename="(.*)"$/s)[1];
    expect(value).not.toMatch(/[\n\r"<>;]/);
  });
});

describe("magic-byte validation fails closed", () => {
  test("an unknown mime is no longer waved through", () => {
    expect(validateMagicBytes(Buffer.alloc(32, 9), "application/x-newfangled").valid).toBe(false);
  });

  test("mime casing and parameters cannot dodge the check", () => {
    expect(validateMagicBytes(PNG_BYTES, "IMAGE/PNG").valid).toBe(true);
    expect(validateMagicBytes(PNG_BYTES, "image/png; charset=binary").valid).toBe(true);
  });
});

describe("no stored-file route hand-rolls its own Content-Type any more", () => {
  const ROUTES = [
    "src/routes/media.js",
    "src/routes/messages.js",
    "src/routes/notes.js",
    "src/routes/familyVisits.js",
    "src/routes/reimbursements.js",
  ];
  for (const f of ROUTES) {
    test(`${f} serves through sendStoredFile`, () => {
      const src = code(f);
      expect(src).toMatch(/sendStoredFile\(/);
      // the old shape: echoing the mime captured out of the stored data URI
      expect(src).not.toMatch(/res\.set\("Content-Type", m\[1\]\)/);
      expect(src).not.toMatch(/res\.set\("Content-Type", receipt\.mime_type/);
    });
  }
});

describe("impersonation cannot happen without a verified passkey", () => {
  const src = code("src/routes/admin/access.js");

  test("an admin with no passkey is refused, not waved through", () => {
    expect(src).toMatch(/allPasskeys\.length === 0/);
    expect(src).toMatch(/needsPasskey/);
    expect(src).not.toMatch(/bypass: true/);
    expect(src).not.toMatch(/noPasskey: true/);
  });

  test("there is no branch that skips verification", () => {
    expect(src).not.toMatch(/if \(!stored\.bypass\)/);
  });

  test("the client no longer skips the passkey step either", () => {
    expect(code("public/js/app.js")).not.toMatch(/if \(!challengeData\.noPasskey\)/);
  });
});
