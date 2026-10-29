/**
 * v1.117.0 — journey tracking: the privacy lines, held in code.
 * Pete, 10/14: "it can't drastically alter the legal framework or privacy policy."
 * The integration suite (tests/integration/journeyTracking.itest.js) proves the behaviour;
 * this file proves the edges that must never move.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || "unit-test-secret";
const fs = require("fs");
const path = require("path");
const { raw, code } = require("./helpers/source");
const T = require("../src/utils/tracking");
const O = require("../src/utils/outreach");

describe("what the server will store", () => {
  test("screen names only — ids, paths and sentences are refused", () => {
    expect(T.cleanPage("splash")).toBe("splash");
    expect(T.cleanPage("care-notes")).toBe("care-notes");
    expect(T.cleanPage("care-notes/8f3e2c1a")).toBeNull();
    expect(T.cleanPage("8f3e2c1a-0000-4000-8000-000000000000")).toBeNull();
    expect(T.cleanPage("She refused her pill")).toBeNull();
    expect(T.cleanPage("x".repeat(41))).toBeNull();
    expect(T.cleanPage({})).toBeNull();
  });

  test("a referrer is kept as a bare host, never the page", () => {
    expect(T.refHost("https://m.facebook.com/groups/1/posts/2?ref=x")).toBe("facebook.com");
    expect(T.refHost("https://l.facebook.com/l.php?u=secret")).toBe("facebook.com");
    expect(T.refHost("https://www.google.com/search?q=mom+dementia+care")).toBe("google.com");
    expect(T.refHost("https://yourinplace.com/anything")).toBeNull();
    expect(T.refHost("android-app://com.google.android.gm")).toBe("com.google.android.gm"); // "from the Gmail app"
    expect(T.refHost("javascript:alert(1)")).toBeNull();
    expect(T.refHost("garbage")).toBeNull();
  });

  test("ad click ids are kept by name only, and only the known names", () => {
    expect(T.cleanClickId("fbclid")).toBe("fbclid");
    expect(T.cleanClickId("gclid")).toBe("gclid");
    expect(T.cleanClickId("IwAR3xYzValue")).toBeNull();
  });

  test("campaign tags are short plain tokens or nothing", () => {
    expect(T.cleanUtm({ source: "Facebook", campaign: "Oct Push" })).toMatchObject({ source: "facebook", campaign: "oct_push" });
    expect(T.cleanUtm({ source: "<script>" }).source).toBeNull();
    expect(T.cleanUtm(null)).toMatchObject({ source: null, medium: null });
  });

  test("link codes are short, unambiguous, and validated", () => {
    const c = T.makeCode();
    expect(c).toMatch(/^[A-Za-z0-9]{6}$/);
    expect(c).not.toMatch(/[0O1lI]/);
    expect(T.isCode("abc")).toBe(false);
    expect(T.isCode("../etc")).toBe(false);
    expect(T.smsLink("Ab3xYz", "https://yourinplace.com")).toBe("yourinplace.com/i/Ab3xYz");
  });
});

describe("outreach {link}", () => {
  test("renders the personal link, and falls back to the site when there isn't one", () => {
    const c = { first_name: "Jane" };
    expect(O.renderTemplate("Hi {first}, {link}", c, "yourinplace.com/i/Ab3xYz")).toBe("Hi Jane, yourinplace.com/i/Ab3xYz");
    expect(O.renderTemplate("Hi {first}, {link}", c)).toBe("Hi Jane, yourinplace.com");
    expect(O.hasLinkToken("see {LINK}")).toBe(true);
    expect(O.hasLinkToken("see yourinplace.com")).toBe(false);
  });
});

describe("no third-party analytics", () => {
  test("index.html loads no analytics script", () => {
    const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8").replace(/<!--[\s\S]*?-->/g, "");
    expect(html).not.toMatch(/plausible|cloudflareinsights|googletagmanager|google-analytics|connect\.facebook\.net|fbq\(/i);
  });

  test("the Content-Security-Policy allows none", () => {
    const s = code("src/server.js");
    const csp = s.slice(s.indexOf("directives:"), s.indexOf("directives:") + 3000);
    expect(csp).not.toMatch(/plausible\.io|cloudflareinsights|googletagmanager|google-analytics|facebook\.net/);
  });

  test("the privacy policy in force no longer names Plausible, and describes what we do", () => {
    const db = raw("src/models/database.js");
    const files = [...db.matchAll(/file: "(privacy_[^"]+\.txt)"/g)].map((m) => m[1]);
    const latest = files[files.length - 1];
    expect(latest).toBe("privacy_2026-10-29.txt");
    const text = fs.readFileSync(path.join(__dirname, "../src/legal", latest), "utf8");
    expect(text).not.toMatch(/plausible/i);
    expect(text).toMatch(/We do not use third-party analytics/);
    expect(text).toMatch(/Visit identifier/);
    expect(text).toMatch(/ElevenLabs/);
  });
});

describe("the beacon's guard rails", () => {
  test("CSRF exemption is the exact path, not a prefix (/api/tasks must stay protected)", () => {
    const a = code("src/middleware/auth.js");
    expect(a).toMatch(/fullPath === "\/api\/t"/);
    expect(a).not.toMatch(/startsWith\("\/api\/t"\)/);
  });

  test("the short link writes nothing (link previews would count as clicks)", () => {
    const r = code("src/routes/track.js");
    const handler = r.slice(r.indexOf('publicRouter.get("/i/:code"'), r.indexOf("function whoIsAsking"));
    expect(handler).not.toMatch(/INSERT|UPDATE/);
  });

  test("the client sends only these event fields", () => {
    const j = code("public/js/journey.js");
    const pushes = [...j.matchAll(/queue\.push\(\{([^}]*(?:\{[^}]*\}[^}]*)*)\}\)/g)].map((m) => m[1]);
    expect(pushes.length).toBe(3);
    for (const p of pushes) {
      const keys = [...p.matchAll(/(\w+):/g)].map((m) => m[1]);
      for (const k of keys) expect(["k", "p", "ms", "l", "utm", "cid", "ref"]).toContain(k);
    }
  });

  test("app.js never records while an admin is viewing as someone", () => {
    const a = code("public/js/app.js");
    const block = a.slice(a.indexOf("InPlaceJourney?.page") - 300, a.indexOf("InPlaceJourney?.identify") + 50);
    expect(block).toMatch(/if \(impersonating/);
  });
});

describe("the link landing pages stay hidden (Pete, 10/14: not up front for the main page)", () => {
  const files = ["caregiver.html", "family.html", "care-for.html"];
  const read = (f) => fs.readFileSync(path.join(__dirname, "../public/landing", f), "utf8");

  test("each is noindex, loads no third-party anything, and reports its own screen name", () => {
    for (const f of files) {
      const html = read(f).replace(/<!--[\s\S]*?-->/g, "");
      expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
      expect(html).not.toMatch(/https?:\/\/(?!yourinplace)/); // no outside fonts, scripts, images
      expect(html).toMatch(/InPlaceJourney\.page\('land-[a-z-]+'\)/);
    }
  });

  test("nothing on the site links to them", () => {
    const sources = [raw("public/index.html"), raw("public/business.html"), raw("public/js/components/SplashPage.js"), raw("public/js/app.js")];
    for (const src of sources) expect(src).not.toMatch(/["'(]\/(work|help|home)(\?|["')])/);
  });

  test("an audience maps to its page, and a link for anyone goes home", () => {
    expect(T.destinationFor({ code: "Ab3xYz", audience: "caregiver" })).toBe("/work?l=Ab3xYz");
    expect(T.destinationFor({ code: "Ab3xYz", audience: "family" })).toBe("/help?l=Ab3xYz");
    expect(T.destinationFor({ code: "Ab3xYz", audience: "care_for" })).toBe("/home?l=Ab3xYz");
    expect(T.destinationFor({ code: "Ab3xYz", audience: null })).toBe("/?l=Ab3xYz");
  });
});
