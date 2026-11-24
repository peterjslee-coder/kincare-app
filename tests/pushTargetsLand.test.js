/**
 * v1.121.0 (Batch 2 step 4) — the release check Pete asked for when reimbursements moved:
 * "there's a bunch of hot links out there that may get broken when we fix this page."
 *
 * Every push, Needs-you card and in-app notification is {page, focus}. This pins that
 *   1. every focus token the server sends has a client screen that reads it, and
 *   2. every page the server names is one the app draws (or falls back to Home on purpose),
 *   3. a reimbursement link — new or already sitting on someone's phone with page "care-team"
 *      — lands on the loved one's page, through every door a tap comes in by.
 */
const fs = require("fs");
const path = require("path");
const babel = require("@babel/core");
const { raw, code } = require("./helpers/source");

const ROOT = path.join(__dirname, "..");
function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!["node_modules", "js-compiled", "vendor"].includes(e.name)) yield* walk(p); }
    else if (e.name.endsWith(".js")) yield p;
  }
}
const serverSrc = [...walk(path.join(ROOT, "src"))].map((f) => fs.readFileSync(f, "utf8")).join("\n");
const clientSrc = [...walk(path.join(ROOT, "public/js"))].map((f) => fs.readFileSync(f, "utf8")).join("\n");

test("every focus token the server sends is read by some screen", () => {
  const tokens = new Set();
  for (const m of serverSrc.matchAll(/focus:\s*[`'"]([a-zA-Z]+)(:|[`'"])/g)) tokens.add(m[1] + (m[2] === ":" ? ":" : ""));
  expect(tokens.size).toBeGreaterThan(5); // the scan found the senders at all
  // Known and reported, not yet fixed: the admin "approval:<userId>" focus (new-signup approvals)
  // opens the Admin panel but no admin screen scrolls to the person. Remove from this list
  // when the admin panel reads it.
  const KNOWN_UNREAD = new Set(["approval:"]);
  const unread = [...tokens].filter((t) => !KNOWN_UNREAD.has(t)
    && !clientSrc.includes(`'${t}'`) && !clientSrc.includes(`"${t}"`) && !clientSrc.includes(`\`${t}`));
  expect(unread).toEqual([]);
});

test("every page the server names is drawn by the app, or knowingly falls back to Home", () => {
  const app = code("public/js/app.js");
  const pages = new Set([...serverSrc.matchAll(/\bpage:\s*['"]([a-z-]+)['"]/g)].map((m) => m[1]));
  // Not drawn by name; the render's last line sends them to Home (Dashboard), which is where
  // payment and earnings pushes are meant to land.
  const HOME_ALIASES = new Set(["home", "sessions", "earnings"]);
  const missing = [...pages].filter((p) => !HOME_ALIASES.has(p) && !app.includes(`currentPage === '${p}'`));
  expect(missing).toEqual([]);
  expect(app).toMatch(/return <Dashboard key=\{pageKey\} onNavigate=\{setCurrentPage\} \/>;\s*\n\s*\};?/);
});

describe("reimbursement links land on the loved one's page", () => {
  const src = fs.readFileSync(path.join(ROOT, "public/js/components/LovedOneGuide.js"), "utf8");
  const compiled = babel.transformSync(src, { presets: [["@babel/preset-react"]], configFile: false }).code;
  const load = (role) => {
    const win = { __currentRole: role };
    new Function("window", "React", "apiFetch", compiled)(win, require("react"), async () => ({ ok: false }));
    return win;
  };

  test("care-team + reimbursement focus → care-profile, remembering the team", () => {
    const w = load("family");
    expect(w.lovedOneRoute("care-team", "reimbursement:abc", "team-1")).toBe("care-profile");
    expect(w.__pendingLovedOneTeamId).toBe("team-1");
  });
  test("everything else is left alone", () => {
    const w = load("family");
    expect(w.lovedOneRoute("care-team", "schedule:s1")).toBe("care-profile");
    expect(w.lovedOneRoute("care-team", "session:1")).toBe("care-team");
    expect(w.lovedOneRoute("care-team", null)).toBe("care-team");
    expect(w.lovedOneRoute("dashboard", "reimbursement:abc")).toBe("dashboard");
    expect(load("helper").lovedOneRoute("care-team", "reimbursement:abc")).toBe("care-team");
  });

  test("all three doors ask: push/in-app tap, cold deep link, Needs-you card", () => {
    const app = code("public/js/app.js");
    expect(app).toContain("target = lovedOneRoute(target, window.__pendingFocus, d.careTeamId)");
    expect(app).toContain("deepPage = lovedOneRoute(deepPage, deepFocus, deepTeam)");
    // The route is decided before the page is stashed and re-asserted, never after.
    expect(app.indexOf("target = lovedOneRoute(")).toBeLessThan(app.indexOf("window.__pendingPage = target;"));
    expect(code("public/js/components/AttentionCard.js")).toContain("lovedOneRoute(item.page, item.focus)");
  });

  test("the ledger is on the loved one's page and the Care Team page points to it", () => {
    expect(code("public/js/components/CareProfile.js")).toContain("<LovedOneReimbursements key={profile.id} recipientId={profile.id} />");
    expect(code("public/js/components/CareProfile.js")).toContain("await pickLovedOne(data.careRecipients)");
    const team = code("public/js/components/CareTeamManage.js");
    expect(team).toContain('data-testid="reimbursements-moved"');
    expect(team).toContain("window.__pendingFocus = 'lovedOne:money'");
    expect(raw("public/js/components/CareTeamManage.js")).toContain("under Money &amp; legal");
    expect(code("public/js/components/CareTeamPage.js")).toContain("onNavigate={onNavigate}");
  });

  test("a deep link opens a folded ledger, for this visit only", () => {
    expect(code("public/js/components/Reimbursements.js")).toContain("if (!sectionOpen) setSectionOpen(true, { remember: false });");
  });
});

// ─── step 5 (lives with the other LovedOneGuide.js checks) ───
describe("lovedOneVisitBuckets — Calendar on the loved one's page", () => {
  const src = fs.readFileSync(path.join(ROOT, "public/js/components/LovedOneGuide.js"), "utf8");
  const compiled = babel.transformSync(src, { presets: [["@babel/preset-react"]], configFile: false }).code;
  const win = {};
  new Function("window", "React", "apiFetch", compiled)(win, require("react"), async () => ({ ok: false }));
  const NOW = Date.parse("2026-10-15T16:00:00Z");
  const H = 3600e3;
  const v = (id, hoursFromNow, status = "confirmed", extra = {}) => ({ id, care_recipient_id: "r1", status, duration_hours: 3, __start: NOW + hoursFromNow * H, ...extra });
  const startOf = (s) => s.__start;
  const ids = (xs) => xs.map((x) => x.s.id);

  test("next 24h, this week, recent; other people's and cancelled visits are left out", () => {
    const b = win.lovedOneVisitBuckets([
      v("tonight", 5), v("tomorrowLate", 30), v("nextWeek", 24 * 9), v("now", -1, "in_progress"),
      v("done", -48, "completed"), v("old", -24 * 10, "completed"), v("cxl", 3, "cancelled"),
      v("other", 2, "confirmed", { care_recipient_id: "r2" }), v("asked", 20, "requested"),
    ], "r1", NOW, startOf);
    expect(ids(b.next24)).toEqual(["now", "tonight", "asked"]);
    expect(ids(b.week)).toEqual(["tomorrowLate"]);
    expect(ids(b.recent)).toEqual(["done"]);
  });

  test("recent is newest first and capped at three", () => {
    const b = win.lovedOneVisitBuckets([1, 2, 3, 4].map((d) => v(`d${d}`, -24 * d, "completed")), "r1", NOW, startOf);
    expect(ids(b.recent)).toEqual(["d1", "d2", "d3"]);
  });

  test("a visit that's over isn't 'next'; one that started and hasn't ended still is", () => {
    // Staging, 10/15: yesterday's 8-hour visit (never checked out) sat under "Next 24 hours".
    const b = win.lovedOneVisitBuckets([
      v("yesterday", -23.5, "confirmed", { duration_hours: 8 }), v("stale", -30, "requested"),
      v("midway", -2, "confirmed", { duration_hours: 4 }),
    ], "r1", NOW, startOf);
    expect(ids(b.next24)).toEqual(["midway"]);
  });
});
