// v1.105.187 — app updates apply themselves at a safe moment, behind an "App updated" card.
//
// Pete, Sep 9 2026: a deploy landed while the app was closed; the next open ran the old bundle
// against the new server and every screen switch spun for a minute, with "Update ready — tap
// to refresh" sitting on screen the whole time. Auto-reload on arrival is what broke dashboards
// pre-v1.57.14, so this is auto-reload at a PAUSE, never mid-work. The logic lives in
// index.html on purpose — the React bundle is the stale thing — so these tests run the inline
// script's functions against a small fake DOM rather than a real one.

const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");
const start = html.indexOf("var swApplying = false;");
const end = html.indexOf("window.addEventListener('load', async function() {");
expect(start).toBeGreaterThan(-1);
expect(end).toBeGreaterThan(start);
const script = html.slice(start, end);

// A minimal DOM: querySelector for modals, querySelectorAll for fields, plus enough of
// document/body for the card to be appended.
function makeDom({ modal = false, fields = [] } = {}) {
  const appended = [];
  const byId = {};
  const el = (attrs) => Object.assign({
    disabled: false, readOnly: false, isContentEditable: false, value: "", textContent: "",
    getAttribute: (k) => (k === "type" ? attrs.type || null : null),
  }, attrs);
  const document = {
    querySelector: (sel) => (modal && /modal-overlay/.test(sel) ? {} : null),
    querySelectorAll: () => fields.map(el),
    getElementById: (id) => byId[id] || null,
    createElement: () => {
      const node = { style: {}, remove() {}, setAttribute(k, v) { this[k] = v; }, set id(v) { this._id = v; byId[v] = this; }, get id() { return this._id; } };
      return node;
    },
    body: { appendChild: (n) => appended.push(n) },
  };
  return { document, appended, byId };
}

function load(dom) {
  const w = { location: { reload: jest.fn() } };
  const timers = [];
  const fn = new Function("window", "document", "setTimeout", "swReloaded",
    script + "\nreturn { swIsSafeMoment, swApplyUpdate, swShowUpdatePill, swShowUpdateScreen };");
  const api = fn(w, dom.document, (cb, ms) => timers.push({ cb, ms }), false);
  return { api, w, timers };
}

const waitingReg = () => ({ waiting: { postMessage: jest.fn() } });

describe("a safe moment", () => {
  test("is when nothing is typed and no modal is open", () => {
    const { api } = load(makeDom({ fields: [{ type: "text", value: "" }, { type: "checkbox" }] }));
    expect(api.swIsSafeMoment()).toBe(true);
  });
  test("is not while a form has text in it", () => {
    const { api } = load(makeDom({ fields: [{ type: "text", value: "Carol Wh" }] }));
    expect(api.swIsSafeMoment()).toBe(false);
  });
  test("is not while someone is writing a message", () => {
    const { api } = load(makeDom({ fields: [{ isContentEditable: true, textContent: "on my way" }] }));
    expect(api.swIsSafeMoment()).toBe(false);
  });
  test("is not while a modal is open — a booking half-made is work", () => {
    const { api } = load(makeDom({ modal: true }));
    expect(api.swIsSafeMoment()).toBe(false);
  });
  test("ignores fields that cannot hold the user's work", () => {
    const { api } = load(makeDom({ fields: [
      { type: "hidden", value: "csrf" }, { type: "text", value: "prefilled", disabled: true },
      { type: "search", value: "", }, { type: "range", value: "50" },
    ] }));
    expect(api.swIsSafeMoment()).toBe(true);
  });
});

describe("applying an update", () => {
  test("shows the card, tells the waiting worker to take over, and has a fallback reload", () => {
    const dom = makeDom();
    const { api, w, timers } = load(dom);
    const reg = waitingReg();
    expect(api.swApplyUpdate(reg)).toBe(true);
    expect(reg.waiting.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    const card = dom.appended.find((n) => n.id === "sw-update-screen");
    expect(card).toBeTruthy();
    expect(card.innerHTML).toContain("App updated");
    expect(card.innerHTML).toContain("back in a sec");
    // If controllerchange never fires, reload anyway rather than leave the card up forever.
    const fallback = timers.find((t) => t.ms === 8000);
    expect(fallback).toBeTruthy();
    fallback.cb();
    expect(w.location.reload).toHaveBeenCalled();
  });
  test("does nothing without a waiting worker, and never twice", () => {
    const dom = makeDom();
    const { api } = load(dom);
    expect(api.swApplyUpdate({ waiting: null })).toBe(false);
    const reg = waitingReg();
    expect(api.swApplyUpdate(reg)).toBe(true);
    expect(api.swApplyUpdate(reg)).toBe(false);
    expect(reg.waiting.postMessage).toHaveBeenCalledTimes(1);
  });
  test("the screen-change hook applies a pending update only at a safe moment", () => {
    const busy = load(makeDom({ fields: [{ type: "text", value: "typing" }] }));
    const reg = waitingReg();
    busy.api.swShowUpdatePill(reg); // records the pending registration
    expect(busy.w.__swApplyPendingUpdate()).toBe(false);
    expect(reg.waiting.postMessage).not.toHaveBeenCalled();

    const idle = load(makeDom());
    const reg2 = waitingReg();
    idle.api.swShowUpdatePill(reg2);
    expect(idle.w.__swApplyPendingUpdate()).toBe(true);
    expect(reg2.waiting.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
  });
});

describe("the three cases are wired", () => {
  test("waiting at open → apply now; lands while open → pill; foreground return → apply if safe", () => {
    const boot = html.slice(html.indexOf("window.addEventListener('load', async function() {"));
    expect(boot).toContain("if (reg.waiting) { swApplyUpdate(reg); } else { swShowUpdatePill(reg); }");
    expect(boot).toContain("if (reg.waiting && swIsSafeMoment()) { swApplyUpdate(reg); return; }");
    // While open: the installed worker shows the pill; it does NOT apply on arrival.
    const installed = boot.slice(boot.indexOf("nw.state === 'installed'"), boot.indexOf("visibilitychange"));
    expect(installed).toContain("swShowUpdatePill(reg)");
    expect(installed).not.toContain("swApplyUpdate(");
  });
  test("the bundle asks on every screen change", () => {
    const app = fs.readFileSync(path.join(__dirname, "..", "public", "js", "app.js"), "utf8");
    expect(app).toMatch(/window\.__swApplyPendingUpdate\(\);[^\n]*\n?[^\n]*\[currentPage\]/);
  });
  test("the worker still only skips waiting when told", () => {
    const sw = fs.readFileSync(path.join(__dirname, "..", "public", "sw.js"), "utf8");
    const installBlock = sw.slice(sw.indexOf("addEventListener('install'"), sw.indexOf("addEventListener('activate'"));
    expect(installBlock).not.toMatch(/^\s*self\.skipWaiting\(\)/m);
    expect(sw).toContain("if (event.data?.type === 'SKIP_WAITING')");
  });
});
