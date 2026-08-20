// A work item is silenced by being FINISHED, never by being LOOKED AT. (v1.105.113)
//
// Pete, Aug 19, after Julia's ID had sat unreviewed for days:
//   "I couldn't see where to review Julie's ID. I didn't get a push notification. I log into
//    the Admin page and there's no demand for my attention, I even went into Doc view and BG
//    checks and there's nothing there for me to review."
//
// Three separate failures stacked, and each one alone would have hidden it:
//
//   1. The document was status='approved' (the AI decided) — so it was not in Doc Review at
//      all. Fixed by v1.105.112.
//   2. `aiApprovedIdentity` DID count it — and then the alert bell subtracted a "last seen"
//      snapshot that app.js writes the moment the admin page is opened. Seen once, silent
//      forever, while the work stayed undone.
//   3. The Overview "Needs attention" list — the screen an admin actually opens — never
//      mentioned identity at all. loadAlerts fetched the counts and threw them away.

const fs = require("fs");
const path = require("path");
const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
const overview = read("src/routes/admin/overview.js");
const app = read("public/js/app.js");
const panel = read("public/js/components/AdminPanel.js");

describe("news and work are different things", () => {
  test("the classes are declared once, in one place", () => {
    expect(overview).toMatch(/const WORK_ALERTS = \["pendingUsers", "pendingConsent", "safetyFlags", "pendingIdentity", "aiApprovedIdentity"\]/);
  });

  test("work is reported raw; news is reported as a delta", () => {
    expect(overview).toMatch(/delta\[key\] = WORK_ALERTS\.includes\(key\)\s*\n\s*\? counts\[key\]/);
    expect(overview).toMatch(/: Math\.max\(0, counts\[key\] - \(seen\[key\] \|\| 0\)\)/);
  });

  test("the list is short on purpose", () => {
    // A badge that never goes quiet gets ignored, and then it protects nothing — the same
    // failure arrived at from the other side.
    const m = /const WORK_ALERTS = \[([^\]]*)\]/.exec(overview);
    expect(m[1].split(",").length).toBeLessThanOrEqual(6);
  });

  test("feedback and referrals stay news", () => {
    const m = /const WORK_ALERTS = \[([^\]]*)\]/.exec(overview);
    expect(m[1]).not.toMatch(/newFeedback|recentReferrals|recentMilestones|checkrAlerts/);
  });
});

describe("dismissing cannot bury work", () => {
  test("the snapshot endpoint strips work keys before storing", () => {
    expect(overview).toMatch(/Object\.fromEntries\(Object\.entries\(incoming\)\.filter\(\(\[k\]\) => !WORK_ALERTS\.includes\(k\)\)\)/);
  });

  test("opening the admin page no longer zeroes the badge on the spot", () => {
    const handler = app.slice(app.indexOf("if (page === 'admin' && adminAlertCount > 0"));
    expect(handler.slice(0, 900)).not.toMatch(/setAdminAlertCount\(0\)/);
  });

  test("it re-asks instead of assuming", () => {
    expect(app).toMatch(/window\.__refetchAdminAlerts = fetchAlerts/);
    expect(app).toMatch(/if \(typeof window\.__refetchAdminAlerts === 'function'\) window\.__refetchAdminAlerts\(\)/);
  });
});

describe("the screen an admin actually opens says so", () => {
  test("loadAlerts keeps the identity counts instead of discarding them", () => {
    // They have been in the payload since v1.105.68/.70 and this loader dropped them —
    // the discarded-value class from v1.105.72, on the one number that mattered most.
    expect(panel).toMatch(/setIdentityAlerts\(\{ pending: d\.pendingIdentity \|\| 0, aiApproved: d\.aiApprovedIdentity \|\| 0 \}\)/);
  });

  test("identity appears in the Needs-attention list", () => {
    expect(panel).toMatch(/if \(identityAlerts\.pending > 0\) attentionItems\.push\(\{/);
    expect(panel).toMatch(/if \(identityAlerts\.aiApproved > 0\) attentionItems\.push\(\{/);
  });

  test("it is pushed BEFORE the other attention items", () => {
    // It blocks a person from working at all; everything else is slower than that.
    const identityAt = panel.indexOf("if (identityAlerts.pending > 0) attentionItems.push({");
    const safetyAt = panel.indexOf("if (safetyFlagCount > 0) attentionItems.push({");
    const feedbackAt = panel.indexOf("if (newFeedbackCount > 0) attentionItems.push({");
    expect(identityAt).toBeGreaterThan(0);
    expect(identityAt).toBeLessThan(safetyAt);
    expect(identityAt).toBeLessThan(feedbackAt);
  });

  test("it says what the consequence is, not just a count", () => {
    expect(panel).toMatch(/cannot finish onboarding until you look at it/);
  });

  test("and it goes somewhere you can act", () => {
    const block = panel.slice(panel.indexOf("if (identityAlerts.pending > 0)"), panel.indexOf("if (safetyFlagCount > 0)"));
    expect((block.match(/setActiveTab\('docreview'\)/g) || []).length).toBe(2);
  });
});

describe("the Doc Review queue itself", () => {
  const docs = read("src/routes/documents.js");

  test("pending identity documents are in it", () => {
    // Before v1.105.112 they were written 'approved', so they were never listed — which is
    // why "I even went into Doc view and there's nothing there for me to review" was true.
    expect(docs).toMatch(/WHERE vd\.status IN \('ai_review', 'pending', 'ai_flagged'\)/);
    expect(docs).toMatch(/WHERE status IN \('ai_review', 'pending', 'ai_flagged'\)/);
  });

  test("the badge count loads on mount, not only when you open the tab", () => {
    const mount = panel.slice(panel.indexOf("    loadStats();"), panel.indexOf("    loadStats();") + 600);
    expect(mount).toMatch(/loadPendingDocsCount\(\);/);
  });
});
