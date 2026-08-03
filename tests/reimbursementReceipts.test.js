// v1.105.29 — a missing receipt must read as missing.
//
// Reported 7/31: "Daniel has a request for $655, but I don't know what is on that receipt."
//
// The plumbing was already right — receipt metadata comes back on every row and
// GET /receipt/:id streams the file, gated to the team. The failure was quieter than a
// broken endpoint: receipts are OPTIONAL, and the row rendered nothing at all when the list
// was empty. Nothing is indistinguishable from a permissions problem. An approver looking
// at $655 could not tell "they didn't attach one" from "the app won't show me", and the
// only recourse was to go ask in a different app.

const fs = require("fs");
const path = require("path");
const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

describe("an absent receipt is stated, not implied by silence", () => {
  test("the reimbursement list says so", () => {
    expect(read("public/js/components/Reimbursements.js")).toMatch(/No receipt attached/);
  });

  test("the money ledger says so too", () => {
    // Two surfaces show the same rows. Fixing one and not the other just moves the
    // ambiguity to whichever screen the person happens to open.
    expect(read("public/js/components/MoneyView.js")).toMatch(/No receipt attached/);
  });

  test("the empty case is a real branch, not a conditional that renders nothing", () => {
    const src = strip(read("public/js/components/Reimbursements.js"));
    // The old shape was `{it.receipts.length > 0 && (...)}` — truthy-guard, empty otherwise.
    expect(src).not.toMatch(/\{it\.receipts\.length > 0 && \(/);
    expect(src).toMatch(/it\.receipts\.length > 0 \?/);
  });
});

describe("you can ask for the missing receipt from inside the app", () => {
  const routes = strip(read("src/routes/reimbursements.js"));
  const handler = routes.slice(
    routes.indexOf('router.post("/:id/request-receipt"'),
    routes.indexOf('router.post("/:id/approve"')
  );

  test("the endpoint exists", () => {
    expect(routes).toMatch(/router\.post\("\/:id\/request-receipt"/);
  });

  test("it is gated to the care team", () => {
    // Reimbursements expose what a family spent on a vulnerable person's care. Team only.
    expect(handler).toMatch(/teamAccess\(db, row\.care_team_id, req\.user\.id\)/);
    expect(handler).toMatch(/canView/);
  });

  test("ANY team member can ask, not only the approver", () => {
    // A sibling watching the family's money is often the one who notices a bare number.
    // If this ever gains an isApprover check, that intent has been lost.
    expect(handler).not.toMatch(/isApprover/);
  });

  test("you cannot nudge yourself", () => {
    expect(handler).toMatch(/req\.user\.id === row\.requested_by/);
  });

  test("it notifies the person who filed it, and nobody else", () => {
    expect(handler).toMatch(/notify\(req, row\.requested_by/);
    expect((handler.match(/notify\(/g) || []).length).toBe(1);
  });

  test("it is audited", () => {
    // It is a nudge about someone else's money; the trail should show who asked.
    expect(handler).toMatch(/audit\(req, "reimbursement_receipt_requested"/);
  });

  test("the UI offers it only on requests that are not yours", () => {
    const ui = strip(read("public/js/components/Reimbursements.js"));
    expect(ui).toMatch(/it\.requested_by !== myUserId/);
    expect(ui).toMatch(/request-receipt/);
  });
});

describe("receipts remain optional", () => {
  test("nothing blocks a request without one", () => {
    // Deliberate: someone reimbursing $6 of parking should not be stopped. The fix is
    // making the absence legible and actionable, not adding a gate.
    //
    // Pete confirmed this explicitly on 2026-07-31, when asked whether a receipt should
    // become mandatory above some dollar threshold: "It remains optional." Recorded here
    // so the question is not re-opened as if it were an oversight — a large request with
    // no receipt is a known, accepted state, answered by the nudge rather than a block.
    const routes = strip(read("src/routes/reimbursements.js"));
    const create = routes.slice(routes.indexOf('router.post("/", async'), routes.indexOf('router.post("/record"'));
    expect(create).not.toMatch(/receipts\.length === 0/);
    expect(create).not.toMatch(/Receipt (is )?required/i);
  });
});
