/**
 * v1.131.0 — no background-check claim without Checkr's word for it.
 *
 * Pete, 11/18: "It currently says her report has been submitted and we are awaiting results.
 * Like what evidence do we have that that was ever happening. ... Not just vibes."
 *
 * Three things made that happen, and each is pinned here so it cannot come back:
 *   1. 'pending' (the old column default) and 'initiated' (written before Checkr sends anything)
 *      were classified as IN PROGRESS.
 *   2. The hub's banner branched on checkrStatus === 'pending' → "in progress".
 *   3. The in-app Checkr embed could not load under the site CSP, and the paid-fee path called our
 *      own /initiate over HTTP with a header cookie sessions do not carry — so nobody was ever
 *      sent to Checkr, and every screen guessed.
 * The integration side (signed webhooks, the admin send, evidence rows) is
 * tests/integration/checkrEvidence.itest.js.
 */
const { code, raw } = require("./helpers/source");
const C = require("../src/constants/checkrStatus");
const { summarise } = require("../src/utils/checkrEvidence");

describe("a status we wrote ourselves is not progress", () => {
  test.each(["pending", "initiated", null])("'%s' is not started", (s) => {
    expect(C.phaseFor(s, false)).toBe(C.PHASE.NOT_STARTED);
  });
  test("only 'processing' — which only Checkr's webhooks or API write — is in progress", () => {
    expect(C.IN_PROGRESS).toEqual(["processing"]);
  });
});

describe("evidence is read from what Checkr sent, in the right slots", () => {
  const rows = [
    { event_type: "invitation.created", received_at: "2026-11-18T12:00:00Z" },
    { event_type: "invitation.completed", received_at: "2026-11-18T13:00:00Z" },
    { event_type: "report.completed", result: "clear", report_id: "r1", received_at: "2026-11-20T09:00:00Z" },
  ];
  test("sent / submitted / result", () => {
    const e = summarise(rows);
    expect(e.sentAt).toBe(rows[0].received_at);
    expect(e.submittedAt).toBe(rows[1].received_at);
    expect(e.resultAt).toBe(rows[2].received_at);
    expect(e.result).toBe("clear");
  });
  test("nothing from Checkr → every claim is null", () => {
    expect(summarise([])).toMatchObject({ sentAt: null, submittedAt: null, resultAt: null, result: null });
  });
  test("a sent form is not a submitted one", () => {
    expect(summarise(rows.slice(0, 1)).submittedAt).toBeNull();
  });
});

describe("the screens", () => {
  test("the hub no longer treats 'pending' as in progress", () => {
    expect(code("public/js/components/CaretakerHub.js")).not.toMatch(/checkrStatus === 'pending'\) return/);
    expect(code("public/js/components/CaretakerHub.js")).not.toMatch(/checkrStatus !== 'pending' && profile\.checkrStatus !== 'not_initiated'/);
  });
  test("Account no longer mounts the Checkr embed the CSP blocks; it offers the emailed form", () => {
    const src = code("public/js/components/MyAccount.js");
    expect(src).not.toMatch(/createElement\(CheckrEmbed/);
    expect(src).toMatch(/<CheckrEmailStart/);
    expect(src).toMatch(/<CheckrFormWaiting/);
  });
  test("the email form says plainly it is a separate form she has to fill in", () => {
    expect(raw("public/js/components/CheckrEmailStart.js")).toMatch(/does not start until you fill that form in/);
  });
  test("nothing defaults a missing status to 'pending' any more", () => {
    expect(code("src/routes/checkr.js")).not.toMatch(/checkr_status \|\| "pending"/);
    expect(code("src/routes/dashboard.js")).not.toMatch(/checkr_status \|\| 'pending'/);
  });
});

describe("sending the form", () => {
  test("the paid-fee path calls sendInvitation directly, not our own HTTP route", () => {
    const pay = code("src/routes/payments.js");
    expect(pay).not.toMatch(/\/api\/checkr\/initiate/);
    expect(pay).toMatch(/sendInvitation\(db, req\.user\.id/);
  });
  test("admins can send it, through the same function", () => {
    const src = code("src/routes/checkr.js");
    expect(src).toMatch(/router\.post\("\/admin\/send-invitation\/:userId"/);
    expect(src).toMatch(/sendInvitation\(db, target\.id, \{ actor: "admin" \}\)/);
  });
  test("the package is pinned — never 'the first one on the account'", () => {
    const src = code("src/routes/checkr.js");
    expect(src).not.toMatch(/packages\[0\]\?\.slug/);
    expect(src).not.toMatch(/nodePackages\[0\]/);
    expect(src).toMatch(/Refusing to order a different one/);
  });
  test("every verified webhook is recorded as evidence before it is handled", () => {
    const src = code("src/routes/checkr.js");
    const rec = src.indexOf('source: "webhook"');
    const sw = src.indexOf("switch (type)");
    expect(rec).toBeGreaterThan(0);
    expect(rec).toBeLessThan(sw);
  });
});
