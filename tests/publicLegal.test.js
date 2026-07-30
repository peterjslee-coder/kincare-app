// v1.105.4 — the public legal pages render lawyer-approved text into HTML, so the
// renderer must never let document content become markup, and must not mangle the
// plain-text structure the documents are actually stored in.

const { _internals } = require("../src/routes/publicLegal");
const { renderBody, escapeHtml, SLUGS } = _internals;

describe("escapeHtml", () => {
  test("neutralises tags and quotes", () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;"
    );
  });
  test("escapes ampersands first so entities aren't double-broken", () => {
    expect(escapeHtml("Tom & Jerry")).toBe("Tom &amp; Jerry");
  });
});

describe("renderBody", () => {
  test("blank-line-separated blocks become paragraphs", () => {
    const html = renderBody("First para.\n\nSecond para.");
    expect(html).toContain("<p>First para.</p>");
    expect(html).toContain("<p>Second para.</p>");
  });

  test("a short ALL-CAPS line becomes a heading", () => {
    expect(renderBody("INFORMATION WE COLLECT")).toBe("<h2>INFORMATION WE COLLECT</h2>");
  });

  test("a long ALL-CAPS block stays a paragraph (legalese disclaimers are shouty)", () => {
    const shouty =
      "THE SERVICES ARE PROVIDED AS IS WITHOUT WARRANTY OF ANY KIND EITHER EXPRESS OR IMPLIED INCLUDING BUT NOT LIMITED TO THE IMPLIED WARRANTIES OF MERCHANTABILITY.";
    const html = renderBody(shouty);
    expect(html.startsWith("<p>")).toBe(true);
    expect(html).not.toContain("<h2>");
  });

  test("single newlines inside a block are preserved as <br>, not collapsed", () => {
    expect(renderBody("Line one\nLine two")).toBe("<p>Line one<br>Line two</p>");
  });

  test("document content can never inject markup", () => {
    const html = renderBody('<img src=x onerror="alert(1)">\n\nplain');
    expect(html).not.toMatch(/<img/);
    expect(html).toContain("&lt;img");
  });

  test("CRLF input does not produce stray blank paragraphs", () => {
    const html = renderBody("A.\r\n\r\nB.");
    expect(html).toBe("<p>A.</p>\n<p>B.</p>");
    expect(html).not.toContain("<p></p>");
  });

  test("leading/trailing whitespace and empty blocks are dropped", () => {
    expect(renderBody("\n\n  A.  \n\n\n\n")).toBe("<p>A.</p>");
  });
});

describe("slug map", () => {
  test("covers exactly the doc types routes/legal.js accepts", () => {
    // Keep in sync with validTypes in src/routes/legal.js — a type published by an
    // admin but missing here would have no public URL, which is the bug this whole
    // module exists to fix.
    expect(new Set(Object.values(SLUGS))).toEqual(
      new Set(["terms", "privacy", "liability", "disclaimer", "caregiver_agreement", "client_services"])
    );
  });

  test("the two store-critical URLs are the plain ones reviewers expect", () => {
    expect(SLUGS["privacy"]).toBe("privacy");
    expect(SLUGS["terms"]).toBe("terms");
  });
});
