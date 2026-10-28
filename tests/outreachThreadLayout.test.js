/**
 * v1.125.1 — the outreach conversation on a phone. Pete, 10/28:
 *   "the texting portion is locked at the bottom of the screen. I can't see what I text. I can't
 *    edit it. I can't scroll through it"  ·  "the top of the screen blocks the view"
 *   10/24: "I can't go back a screen without exiting Admin to move to the next person."
 *
 * Structural guarantees, read from source (rule 8: raw for presence, code() for absence).
 */
const { raw, code } = require("./helpers/source");

const src = raw("public/js/components/AdminOutreach.js");
const thread = src.slice(src.indexOf("const OutreachThread"), src.indexOf("const AdminOutreachTab"));
const app = code("public/js/app.js");

describe("one scroll region holds the details AND the conversation", () => {
  const scrollAt = thread.indexOf('className="outreach-thread-scroll"');
  const composerAt = thread.indexOf("ref={draftRef}");
  test("the scroll region exists and the composer sits after it, outside it", () => {
    expect(scrollAt).toBeGreaterThan(-1);
    expect(composerAt).toBeGreaterThan(scrollAt);
  });
  test("progress, journey and the notes box live INSIDE the scroll region, not above it", () => {
    for (const marker of ["<OutProgress", "<OutJourney", 'placeholder="Notes', "data.messages.map"]) {
      const at = thread.indexOf(marker);
      expect(at).toBeGreaterThan(scrollAt);
      expect(at).toBeLessThan(composerAt);
    }
  });
  test("the scroll region can shrink (minHeight 0) — a flex child without it never scrolls", () => {
    const line = thread.slice(scrollAt, thread.indexOf("\n", scrollAt));
    expect(line).toMatch(/minHeight: 0/);
    expect(line).toMatch(/overflowY: 'auto'/);
  });
  test("details fold away by default once there is a conversation", () => {
    expect(thread).toMatch(/showDetails !== null \? showDetails : !\(data && data\.messages\.length > 0\)/);
  });
});

describe("the header stays on screen", () => {
  test("the panel is sized to the visual viewport (what the keyboard leaves)", () => {
    expect(thread).toMatch(/window\.visualViewport/);
    expect(thread).toMatch(/\.\.\.panelBox/);
  });
  test("every text box in the thread is at least 16px, so iOS never zooms the page", () => {
    expect(thread).toMatch(/const field = \{[^}]*fontSize: 16/);
    expect(thread).not.toMatch(/\.\.\.field, [^}]*fontSize: 1[0-5]\b/);
  });
});

describe("Back closes the conversation, not Admin", () => {
  test("the thread pushes its own history entry and registers a back handler", () => {
    expect(thread).toMatch(/history\.pushState\(\{ modal: 'outreach-thread' \}/);
    expect(thread).toMatch(/window\.__modalBackHandler = close/);
  });
  test("app.js hands Back to that handler BEFORE the page router runs", () => {
    const fnAt = app.indexOf("const handlePopState = (e) => {");
    const handlerAt = app.indexOf("window.__modalBackHandler", fnAt);
    const routerAt = app.indexOf("navHistoryRef.current.pop()", fnAt);
    expect(handlerAt).toBeGreaterThan(fnAt);
    expect(handlerAt).toBeLessThan(routerAt);
  });
  test("there is a visible way back on the screen itself", () => {
    expect(thread).toMatch(/aria-label="Back to everyone"/);
  });
});

describe("+ Add person", () => {
  test("posts to the add route and opens the person it returns", () => {
    expect(src).toMatch(/apiFetch\('\/api\/admin\/outreach\/contacts', \{ method: 'POST'/);
    expect(src).toMatch(/setOpenId\(d\.id\)/);
  });
  test("phone goes through formatPhone (Dev Rule 1) after dropping a +1", () => {
    expect(src).toMatch(/formatPhone\(outUsDigits\(e\.target\.value\)\)/);
  });
  test("the Contacts button only appears where the browser has a contact picker", () => {
    expect(src).toMatch(/\{canPickContact && \(/);
  });
});

describe("nothing in the app can paint over the conversation (v1.125.2)", () => {
  test("the thread renders to document.body, out of Admin's stacking context", () => {
    expect(src).toMatch(/ReactDOM\.createPortal\(node, document\.body\)/);
    expect(thread).toMatch(/return outToBody\(\n\s*<div onClick=\{closeByButton\}/);
  });
});

describe("recording a verbal OK from a call (v1.125.3)", () => {
  test("the thread can record one — from the footer, from Details, and one tap from a call iPAi read", () => {
    expect(thread).toMatch(/Record OK from the call/);
    expect(thread).toMatch(/patch\(\{ textsOk: true, evidence, callMessageId: callMessageId \|\| undefined \}/);
    expect(src).toMatch(/onUseConsent\(m\.id, notes\.consentQuote\)/);
  });
  test("nothing is saved without their words", () => {
    expect(thread).toMatch(/disabled=\{consentDraft\.trim\(\)\.length < 3\}/);
  });
});

describe("first-text starting points (v1.125.4)", () => {
  test("the server sends them and the thread offers them when the box is empty", () => {
    expect(raw("src/routes/outreach.js")).toMatch(/firstTexts: O\.FIRST_TEXTS/);
    expect(src).toMatch(/firstTexts=\{data && data\.firstTexts\}/);
    expect(thread).toMatch(/c\.texts_ok_at && !draft && Array\.isArray\(firstTexts\)/);
    expect(thread).toMatch(/setDraft\(String\(t\.body\)\.replace\(\/\\\{first\\\}\/gi, outGreeting\(c\)\)/);
  });
});

describe("calling through your own cell (v1.125.5)", () => {
  test("the Call button rings your cell; the browser call is the fallback under Details", () => {
    expect(thread).toMatch(/<button onClick=\{startCellCall\}/);
    expect(thread).toMatch(/\/call-via-cell`, \{ method: 'POST'/);
    expect(thread).toMatch(/onClick=\{startCall\}[\s\S]{0,200}Call from this browser instead/);
  });
  test("the script stays on screen for a cell call", () => {
    // the script panel keys on `call` alone, so a cell call shows it too
    expect(thread).toMatch(/\{call && Array\.isArray\(callScript\) && \(/);
  });
});
