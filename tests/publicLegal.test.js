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

// ─── Route-level tests with a stubbed DB ───
// staging's `legal_documents` table is EMPTY (the schema creates it but seed.js
// never populates it — documents only exist where an admin published them, i.e.
// prod). So the render path can't be exercised on staging, and these pages are
// store-facing and legally visible. Stub the DB and test the wiring here rather
// than discovering a problem on production.

describe("public legal routes", () => {
  const DOC = {
    doc_type: "privacy",
    version: "2026-07-07",
    title: "Privacy Policy",
    published_at: "2026-07-07T00:00:00.000Z",
    content: "PRIVACY POLICY\n\nCedar Rock Holdings, LLC\n\nWe use <Stripe> for payments.",
  };

  function appWith(rows) {
    jest.resetModules();
    jest.doMock("../src/models/database", () => ({
      getDb: async () => ({ prepare: () => ({ all: async () => rows, get: async () => rows[0] }) }),
    }));
    jest.doMock("../src/utils/sentry", () => ({ captureException: () => {} }));
    const express = require("express");
    const app = express();
    app.use(require("../src/routes/publicLegal"));
    app.get("*", (req, res) => res.status(200).send("SPA_SHELL"));
    return app;
  }

  const request = require("supertest");

  test("renders the active document, with no login", async () => {
    const res = await request(appWith([DOC])).get("/privacy");
    expect(res.status).toBe(200);
    expect(res.text).toContain("<h1>Privacy Policy</h1>");
    expect(res.text).toContain("Version 2026-07-07");
    expect(res.text).toContain("<h2>PRIVACY POLICY</h2>");
    expect(res.text).not.toContain("SPA_SHELL");
  });

  test("document content is escaped, not injected", async () => {
    const res = await request(appWith([DOC])).get("/privacy");
    expect(res.text).toContain("&lt;Stripe&gt;");
    expect(res.text).not.toContain("<Stripe>");
  });

  test("a type with no active document falls through to the app, not an empty page", async () => {
    // This is exactly what staging does today, and what prod did for /liability.
    const res = await request(appWith([DOC])).get("/liability");
    expect(res.status).toBe(200);
    expect(res.text).toBe("SPA_SHELL");
  });

  test("an empty table falls through for every slug (staging's real state)", async () => {
    const app = appWith([]);
    for (const slug of ["/terms", "/privacy", "/caregiver-agreement", "/client-services", "/legal"]) {
      const res = await request(app).get(slug);
      expect(res.text).toBe("SPA_SHELL");
    }
  });

  test("/legal indexes what is published and links to it", async () => {
    const res = await request(appWith([DOC, { ...DOC, doc_type: "terms", title: "Terms of Use" }])).get("/legal");
    expect(res.status).toBe(200);
    expect(res.text).toContain('href="/privacy"');
    expect(res.text).toContain('href="/terms"');
  });

  test("pages are cacheable but not for long (policies change)", async () => {
    const res = await request(appWith([DOC])).get("/privacy");
    expect(res.headers["cache-control"]).toMatch(/max-age=300/);
  });
});

// v1.114.4 — carriers reject A2P campaigns whose public terms lack these. Each line here is a
// registration requirement, so a later edit can't quietly drop one.
describe("/sms text messaging terms", () => {
  const { SMS_TERMS } = _internals;
  test.each([
    [/Cedar Rock Holdings, LLC/],
    [/InPlace Care/],
    [/\(540\) 274-1412/],
    [/\(540\) 835-5987/],
    [/How you opt in/],
    [/Message and data rates may apply/],
    [/Reply <strong>STOP<\/strong>/],
    [/Reply <strong>HELP<\/strong>/],
    [/No mobile information will be shared with third parties or affiliates for marketing or promotional purposes/],
    [/opt-in data and consent will not be shared with any third parties/],
    [/href="\/privacy"/],
  ])("says %s", (re) => expect(SMS_TERMS).toMatch(re));
});

// v1.120.2 — carriers rejected both campaigns: "no proof provided for behind the login opt in".
describe("/sms/opt-in shows the behind-login opt-ins publicly", () => {
  const fs = require("fs");
  const path = require("path");
  const { SMS_OPTIN } = _internals;
  const SC = require("../src/utils/smsConsent");
  test("both screenshots are on the page and exist on disk", () => {
    for (const f of ["account-text-alerts.png", "care-team-reminders-v2.png"]) {
      expect(SMS_OPTIN).toContain(`/img/sms-optin/${f}`);
      expect(fs.existsSync(path.join(__dirname, "..", "public", "img", "sms-optin", f))).toBe(true);
    }
  });
  test("the wording shown is the wording the app uses", () => {
    expect(SMS_OPTIN).toContain(_internals.escapeHtml(SC.ACCOUNT_CONSENT_TEXT));
    expect(SMS_OPTIN).toContain(_internals.escapeHtml(SC.RECIPIENT_CONFIRMED_TEXT));
    expect(SMS_OPTIN).toMatch(/reply YES/);
    expect(SMS_OPTIN).toMatch(/text <strong>JOIN<\/strong> to \(540\) 835-5987|texting <strong>JOIN<\/strong> to \(540\) 835-5987/);
  });
  test("/sms links to it", () => expect(_internals.SMS_TERMS).toContain('href="/sms/opt-in"'));
  test("/work carries the JOIN keyword with its disclosure", () => {
    const html = fs.readFileSync(path.join(__dirname, "..", "public", "landing", "caregiver.html"), "utf8");
    expect(html).toMatch(/text <strong>JOIN<\/strong>/);
    expect(html).toMatch(/By texting JOIN you agree to receive texts from InPlace Care.*Msg &amp; data rates may apply.*STOP.*HELP/s);
  });
});

describe("v1.122.0 — the call opt-in is published from the same code that runs it", () => {
  const { SMS_OPTIN, SMS_TERMS, escapeHtml } = _internals;
  const CN = require("../src/utils/outreachCallNotes");
  test("the consent question, the recording announcement and the script are on /sms/opt-in", () => {
    expect(SMS_OPTIN).toContain(`<strong>${escapeHtml(CN.JOIN_ASK)}</strong>`);
    expect(SMS_OPTIN).not.toMatch(/they first hear/);
    expect(SMS_OPTIN).toMatch(/Nobody is texted from this number until they text it first/);
    expect(SMS_OPTIN).toMatch(/the call itself never opens texting/);
  });
  test("/sms describes both ways in for the outreach number", () => {
    expect(SMS_TERMS).toMatch(/text <strong>JOIN<\/strong>/);
    expect(SMS_TERMS).toMatch(/We don't text anyone who hasn't texted us first/);
    expect(SMS_TERMS).toMatch(/one person at a time, never a robocall or prerecorded message/);
  });
});

test("v1.122.4 — the call opt-in is described as a live call by a person, never a robocall", () => {
  expect(_internals.SMS_OPTIN).toMatch(/live conversations, never robocalls or prerecorded messages/);
  expect(_internals.SMS_OPTIN).toMatch(/one person at a time/);
  expect(_internals.SMS_OPTIN).not.toMatch(/recorded phone call<\/h3>/);
});

test("v1.124.1 — the home page footer carries the JOIN keyword with its disclosure", () => {
  const fs = require("fs"), path = require("path");
  const splash = fs.readFileSync(path.join(__dirname, "..", "public", "js", "components", "SplashPage.js"), "utf8");
  expect(splash).toMatch(/Looking for caregiving work\? Text <strong>JOIN<\/strong>/);
  expect(splash).toMatch(/By texting JOIN you agree to receive texts from InPlace Care about caregiving work\. Msg &amp; data rates may apply\. Msg frequency varies\. Reply STOP to opt out, HELP for help\./);
});
