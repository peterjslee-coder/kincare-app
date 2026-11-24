/**
 * v1.106.27 — a link someone typed should be a link. (f6e02c59)
 *
 * Pete: "I texted a link and it came through plain Tex. I want it to be a clickable link."
 *
 * Everything here runs the real shipped function. A URL regex is exactly the kind of code
 * that looks right and is wrong at the edges — the end of a sentence, a bracket, a scheme
 * nobody should be able to inject — so the edges are what is asserted.
 */
const fs = require("fs");
const path = require("path");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

const linkify = (() => {
  const src = fs.readFileSync(path.join(__dirname, "..", "public/js/utils.js"), "utf8");
  const i0 = src.indexOf("const LINKIFY_RE =");
  const i1 = src.indexOf("// ─── v1.106.24 — a recurring offer");
  if (i0 === -1 || i1 === -1 || i1 < i0) throw new Error("linkify block not found in utils.js");
  const win = {};
  // eslint-disable-next-line no-new-func
  return new Function("React", "window", src.slice(i0, i1) + "\nreturn linkify;")(React, win);
})();

const html = (nodes) => renderToStaticMarkup(React.createElement("div", null, nodes));
// Hrefs are read back out of rendered markup, so entities have to be decoded — an `&` in a
// query string renders as `&amp;`, which is correct output and a false failure here.
const unescape = (v) => v
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#x27;/g, "'");
const hrefs = (nodes) => [...html(nodes).matchAll(/href="([^"]*)"/g)].map((m) => unescape(m[1]));
const texts = (nodes) => [...html(nodes).matchAll(/>([^<]*)<\/a>/g)].map((m) => m[1]);

describe("what becomes a link", () => {
  test("an https URL", () => {
    expect(hrefs(linkify("see https://example.com/x for details"))).toEqual(["https://example.com/x"]);
  });

  test("an http URL", () => {
    expect(hrefs(linkify("http://example.com"))).toEqual(["http://example.com"]);
  });

  test("a bare www., promoted to https — never left relative", () => {
    // "www.example.com" as an href resolves INSIDE the app: yourinplace.com/www.example.com.
    // The user taps a link to a pharmacy and lands on a 404 of ours.
    expect(hrefs(linkify("try www.example.com"))).toEqual(["https://www.example.com"]);
    expect(texts(linkify("try www.example.com"))).toEqual(["www.example.com"]);
  });

  test("an email address becomes mailto:", () => {
    expect(hrefs(linkify("email betty@example.com please"))).toEqual(["mailto:betty@example.com"]);
  });

  test("several in one message", () => {
    const n = linkify("https://a.com and https://b.com and c@d.com");
    expect(hrefs(n)).toEqual(["https://a.com", "https://b.com", "mailto:c@d.com"]);
  });

  test("text with no link comes back as the plain string, unchanged", () => {
    // Callers render the return value directly. A string in, a string out — no wrapper, no
    // behaviour change on the overwhelmingly common case.
    expect(linkify("just a normal message")).toBe("just a normal message");
  });

  test("the surrounding words survive", () => {
    expect(html(linkify("see https://x.com now"))).toContain("see ");
    expect(html(linkify("see https://x.com now"))).toContain(" now");
  });
});

describe("the edges a URL regex gets wrong", () => {
  test("a full stop at the end of a sentence is not part of the URL", () => {
    expect(hrefs(linkify("go to https://example.com/page."))).toEqual(["https://example.com/page"]);
  });

  test("so are a comma, a semicolon and a question mark", () => {
    expect(hrefs(linkify("https://a.com, https://b.com; https://c.com?"))).toEqual([
      "https://a.com", "https://b.com", "https://c.com",
    ]);
  });

  test("a balanced bracket inside a URL is kept — Wikipedia and Maps use them", () => {
    const u = "https://en.wikipedia.org/wiki/Care_(disambiguation)";
    expect(hrefs(linkify(`see ${u}`))).toEqual([u]);
  });

  test("an unbalanced closing bracket is dropped", () => {
    expect(hrefs(linkify("(see https://example.com/x)"))).toEqual(["https://example.com/x"]);
  });

  test("a trailing exclamation is dropped but a query string is not", () => {
    expect(hrefs(linkify("https://example.com/s?q=1&r=2!"))).toEqual(["https://example.com/s?q=1&r=2"]);
  });

  test("the ampersand is escaped in the rendered href, not left raw", () => {
    // Reading hrefs back out of markup hid this at first. It is correct output and worth
    // stating: React escapes the attribute, so a query string cannot break out of it.
    expect(html(linkify("https://example.com/s?q=1&r=2"))).toContain("q=1&amp;r=2");
  });
});

describe("what must never become a link", () => {
  test("javascript: is not matched at all", () => {
    const n = linkify("javascript:alert(1)");
    expect(hrefs(n)).toEqual([]);
    expect(html(n)).not.toContain("<a");
  });

  test("data: is not matched", () => {
    expect(hrefs(linkify("data:text/html;base64,PHNjcmlwdD4="))).toEqual([]);
  });

  test("a javascript: scheme hidden after a real URL does not leak into the href", () => {
    const n = linkify("https://ok.com javascript:alert(1)");
    expect(hrefs(n)).toEqual(["https://ok.com"]);
  });

  test("markup in the message is escaped, not rendered", () => {
    // The reason this returns React nodes rather than an HTML string. Message bodies are
    // user input in a thread a family and a stranger both read.
    const out = html(linkify("<script>alert(1)</script> https://x.com"));
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
  });

  test("markup INSIDE the link text is escaped too", () => {
    const out = html(linkify("https://x.com/<img onerror=alert(1)>"));
    expect(out).not.toContain("<img");
  });

  test("every link opens safely", () => {
    const out = html(linkify("https://x.com"));
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain('target="_blank"');
  });
});

describe("it never throws on odd input", () => {
  test.each([null, undefined, "", 0, false, 42, {}])("%p", (v) => {
    expect(() => linkify(v)).not.toThrow();
  });

  test("a long message with many links does not stall", () => {
    const big = Array.from({ length: 300 }, (_, i) => `https://e${i}.com`).join(" ");
    const started = Date.now();
    expect(hrefs(linkify(big))).toHaveLength(300);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  test("calling it twice gives the same answer — the regex is stateful and /g remembers", () => {
    // LINKIFY_RE is a module-level /g regex. lastIndex persists between calls, so a missing
    // reset makes every other call return the plain string. This is the bug that would have
    // shipped as "links work but only sometimes".
    const a = hrefs(linkify("https://x.com"));
    const b = hrefs(linkify("https://x.com"));
    expect(a).toEqual(b);
    expect(a).toEqual(["https://x.com"]);
  });
});

describe("wired in wherever people type", () => {
  const { code } = require("./helpers/source");

  // One helper, applied at every render site. Six copies of a URL regex is six places for
  // the javascript: case to be forgotten in — the reason this went into utils.js and not
  // into Messages.js where the request came from.
  const SITES = [
    ["public/js/components/Messages.js", "linkify(content)"],
    ["public/js/components/TeamNotes.js", "linkify(item.body)"],
    ["public/js/components/CareProfile.js", "linkify(n.content)"],
    ["public/js/components/VisitDetailModal.js", "linkify(s.special_instructions)"],
    ["public/js/components/CaretakerHub.js", "linkify(s.specialInstructions)"],
    ["public/js/components/Schedule.js", "linkify(s.special_instructions)"],
    ["public/js/components/CaredForView.js", "linkify(s.specialInstructions)"],
    ["public/js/components/CaregiverCalendar.js", "linkify(s.specialInstructions || s.special_instructions)"],
  ];

  test.each(SITES)("%s calls it", (file, call) => {
    expect(code(file)).toContain(call);
  });

  test("the Meet-only regex is gone — it was the reason everything else stayed text", () => {
    expect(code("public/js/components/Messages.js")).not.toContain("meet\\.google\\.com");
    expect(code("public/js/components/Messages.js")).not.toContain("meetLinkRegex");
  });

  test("nobody hand-rolled a second one", () => {
    // Six copies of a URL regex is six places for the javascript: case to be forgotten in.
    // The detector looks for a regex literal mentioning http in a component that does not
    // call linkify — and it was checked by PLANTING one, because the first version of this
    // test had its escaping wrong, matched nothing anywhere, and passed on an empty list.
    // An empty result only means something once you know the scan can produce a non-empty one.
    const fs = require("fs");
    const path = require("path");
    const dir = path.join(__dirname, "..", "public/js/components");
    const URL_REGEX_LINE = /\\\/.*http|http.*\\\//i;

    const scan = () => {
      const out = [];
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith(".js")) continue;
        const src = code(`public/js/components/${f}`);
        if (/linkify/.test(src)) continue;
        if (src.split("\n").some((l) => URL_REGEX_LINE.test(l))) out.push(f);
      }
      return out;
    };

    expect(scan()).toEqual([]);

    // Prove the scan can fail.
    const probe = path.join(dir, "__linkifyProbe.js");
    fs.writeFileSync(probe, "const r = /https?:\\/\\/\\S+/g;\n");
    try {
      expect(scan()).toContain("__linkifyProbe.js");
    } finally {
      fs.unlinkSync(probe);
    }
  });
});
