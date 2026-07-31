// v1.105.18 — App Review guideline 1.2 invariants.
//
// Structural, like storeReview.test.js and for the same reason: these are properties that
// are invisible at runtime and only surface as a rejection, or — worse for the report path —
// as harm to a user. Assertions run against comment-stripped source so the files' own
// explanatory prose cannot satisfy or break them.

const fs = require("fs");
const path = require("path");
const raw = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
const code = (p) =>
  raw(p).replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

describe("guideline 1.2: both mechanisms exist and are reachable", () => {
  const safety = code("src/routes/safety.js");

  test("a user can report content", () => {
    expect(safety).toMatch(/router\.post\("\/report"/);
  });

  test("a user can block and unblock", () => {
    expect(safety).toMatch(/router\.post\("\/block"/);
    expect(safety).toMatch(/router\.delete\("\/block\/:userId"/);
  });

  test("the routes are actually mounted", () => {
    // A route file nobody mounts satisfies nothing. This is the whole feature failing
    // silently in exactly the way a reviewer would catch and a test suite would not.
    expect(code("src/server.js")).toMatch(/app\.use\("\/api\/safety"/);
  });

  test("report and block are reachable from the messaging UI", () => {
    const ui = code("public/js/components/Messages.js");
    expect(ui).toMatch(/\/api\/safety\/report/);
    expect(ui).toMatch(/\/api\/safety\/block/);
  });

  test("the 24-hour review commitment is stated to the reporter", () => {
    expect(raw("src/routes/safety.js")).toMatch(/within 24 hours/i);
  });
});

describe("reporting is SILENT — the property that keeps people safe", () => {
  const safety = code("src/routes/safety.js");
  // Isolate the report handler: a push call elsewhere in the file (the block path sends
  // several, by design) must not be read as the report path notifying anyone.
  const reportHandler = safety.slice(
    safety.indexOf('router.post("/report"'),
    safety.indexOf('router.get("/block-preview')
  );

  test("the reported person is never notified", () => {
    // Telling an abuser they were reported is how someone gets hurt. The report path may
    // notify ADMINS and nobody else.
    expect(reportHandler).not.toMatch(/sendPushToUser/);
    expect(reportHandler).toMatch(/notifyAdmins/);
  });

  test("the reporter is told they will not be exposed", () => {
    expect(raw("src/routes/safety.js")).toMatch(/not told that you reported them/i);
  });

  test("the report UI repeats that reassurance", () => {
    // It belongs at the moment of decision, not only in the response. Someone frightened of
    // a caregiver in their home decides whether to report BEFORE they see any response.
    expect(raw("public/js/components/Messages.js")).toMatch(/will not be told that you reported them/i);
  });

  test("content is snapshotted at report time", () => {
    // Messages support soft deletion, so a reported message can vanish before an admin
    // reads it — leaving an empty thread and an unactionable report.
    expect(reportHandler).toMatch(/content_snapshot/);
  });
});

describe("blocking is DISCLOSED and reversible", () => {
  const safety = code("src/routes/safety.js");

  test("the blocked person is told", () => {
    // Pete's rule (7/30). Also forced: blocking cancels their visits, so they find out
    // regardless. Disclosure just stops the app pretending otherwise.
    expect(safety).toMatch(/You've been blocked/);
  });

  test("blocking cancels shared future visits", () => {
    expect(safety).toMatch(/futureSessionsBetween/);
    expect(safety).toMatch(/UPDATE care_sessions SET status = 'cancelled'/);
  });

  test("a block is never treated as a late cancellation", () => {
    // Someone removing themselves from an unwanted or unsafe situation must not be charged
    // a cancellation fee for it.
    expect(safety).toMatch(/isLateCancel: false/);
    expect(safety).not.toMatch(/captureSessionPayment/);
  });

  test("InPlace Support cannot be blocked", () => {
    // The support thread is how a blocked or frightened person reaches a human. Letting
    // someone sever it — impulsively, or under pressure from an abuser — removes the only
    // channel that can actually help.
    expect(safety).toMatch(/is_admin/);
  });

  test("unblocking exists and takes no confirmation", () => {
    // Undoing an impulsive block must be strictly easier than making one: the cancelled
    // visits do not come back, so the least this can do is not obstruct the repair.
    expect(safety).toMatch(/router\.delete\("\/block\/:userId"/);
    expect(safety).toMatch(/router\.get\("\/blocks"/);
  });

  test("the confirmation states consequences computed by the server", () => {
    // Prose in the client drifts from the facts. How many visits get cancelled is a fact
    // about this pair of people.
    expect(safety).toMatch(/block-preview/);
    expect(code("public/js/components/Messages.js")).toMatch(/block-preview/);
  });
});

describe("blocks are actually honoured in messaging", () => {
  const messages = code("src/routes/messages.js");

  test("the conversation list filters blocked people", () => {
    expect(messages).toMatch(/getBlockedIds/);
  });

  test("sending into a blocked thread is REFUSED, not merely hidden", () => {
    // Hiding is not preventing. A stale conversation id or a retry would otherwise still
    // deliver — and delivery fires the push, which is the part that reaches a blocked
    // person's lock screen.
    expect(messages).toMatch(/isBlockedBetween/);
    expect(messages).toMatch(/blocked: true/);
  });

  test("group and care-team threads survive a block", () => {
    // A block is between two people. Silently ejecting someone from their family's care
    // coordination is a far bigger act than they asked for.
    expect(messages).toMatch(/others\.length !== 1/);
  });
});


// ─── v1.105.21 — the queue that makes the 24-hour promise real ───
describe("admin report queue", () => {
  const admin = code("src/routes/admin/safety.js");

  test("reports can be listed and decided", () => {
    expect(admin).toMatch(/router\.get\("\/content-reports"/);
    expect(admin).toMatch(/router\.put\("\/content-reports\/:id"/);
  });

  test("it is admin-gated like every other safety route", () => {
    const q = admin.slice(admin.indexOf('router.get("/content-reports"'));
    expect(q.slice(0, 200)).toMatch(/authenticate, checkAdmin, requireAdmin/);
  });

  test("the queue is OLDEST first", () => {
    // The 24-hour commitment is what is being measured, so the report closest to breaching
    // it must be on top. Newest-first hides exactly the item that matters.
    const q = admin.slice(admin.indexOf('router.get("/content-reports"'));
    expect(q.slice(0, 2000)).toMatch(/ORDER BY cr\.created_at ASC/);
  });

  test("it counts what is already past 24 hours", () => {
    expect(admin).toMatch(/INTERVAL '24 hours'/);
  });

  test("deciding a report still notifies nobody", () => {
    // Reporting is silent end to end. Telling someone an admin actioned a report identifies
    // the reporter as surely as naming them.
    const d = admin.slice(admin.indexOf('router.put("/content-reports/:id"'));
    const body = d.slice(0, d.indexOf("});"));
    expect(body).not.toMatch(/sendPushToUser/);
  });

  test("the UI shows the snapshot, not the live message", () => {
    // A reported message can be soft-deleted, and the person reported has an obvious motive.
    const ui = raw("public/js/components/ContentReportsTab.js");
    expect(ui).toMatch(/captured at report time/i);
    expect(ui).toMatch(/snapshot/);
  });

  test("the tab is in the admin bundle and rendered", () => {
    expect(code("scripts/build-client.js")).toMatch(/ContentReportsTab\.js/);
    expect(code("public/js/components/AdminPanel.js")).toMatch(/ContentReportsTab/);
  });
});


describe("report/block is reachable without a right-click", () => {
  const ui = raw("public/js/components/Messages.js");

  test("there is a chat-header overflow menu", () => {
    // The desktop context menu is invoked by onContextMenu — a phone has no right-click, so
    // on an iPhone-only submission that path is unreachable. A reviewer checking 1.2 opens
    // a conversation and looks for an overflow control.
    expect(ui).toMatch(/headerMenu/);
    expect(ui).toMatch(/aria-label="More options"/);
  });

  test("the header menu offers BOTH report and block", () => {
    const menu = ui.slice(ui.indexOf("{headerMenu && activeConv"));
    expect(menu.slice(0, 2500)).toMatch(/setReportFor/);
    expect(menu.slice(0, 2500)).toMatch(/handleBlock/);
  });

  test("it only appears on one-to-one threads", () => {
    // A block is between two people; offering it on a care-team thread implies something
    // the feature cannot do.
    expect(ui).toMatch(/activeConv && soloPartner\(activeConv\)/);
  });
});
