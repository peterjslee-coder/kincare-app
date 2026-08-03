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

  test("the UI offers ASK only when you are not the one who could attach it", () => {
    // v1.105.30 restructured this: if you can attach (requester, payee or approver) you get
    // "Attach receipt"; otherwise you get "Ask for it". The two must be exclusive, or the
    // approver ends up nudging themselves.
    const ui = strip(read("public/js/components/Reimbursements.js"));
    expect(ui).toMatch(/it\.requested_by === myUserId \|\| it\.payee_user_id === myUserId \|\| meta\.isApprover/);
    expect(ui).toMatch(/request-receipt/);
    // ask sits in the else branch, after the attach branch
    expect(ui.indexOf("Attach receipt")).toBeLessThan(ui.indexOf("Ask for it"));
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


// ─── v1.105.30 — the person asked can actually act on it ───
//
// "Ask for it" is theatre unless the requester can attach one afterwards. They could not:
// PUT /:id never touched receipts, and the client deleted them from the edit payload.
describe("receipts can be attached to a request that already exists", () => {
  const routes = strip(read("src/routes/reimbursements.js"));
  const handler = routes.slice(
    routes.indexOf('router.post("/:id/receipts"'),
    routes.indexOf('router.post("/:id/request-receipt"')
  );

  test("the endpoint exists and is team-gated", () => {
    expect(routes).toMatch(/router\.post\("\/:id\/receipts"/);
    expect(handler).toMatch(/teamAccess\(db, row\.care_team_id, req\.user\.id\)/);
  });

  test("it is ADD-ONLY — nothing deletes or replaces a receipt", () => {
    // Receipts are evidence for money someone else approves. Editable evidence is worse
    // than none: it looks complete while being changeable after the fact.
    expect(handler).not.toMatch(/DELETE FROM reimbursement_receipts/);
    expect(handler).not.toMatch(/UPDATE reimbursement_receipts/);
    expect(handler).toMatch(/INSERT INTO reimbursement_receipts/);
  });

  test("it works past 'pending', unlike editing", () => {
    // Changing the AMOUNT after approval changes what was agreed; attaching a receipt does
    // not. Only closed states are refused.
    expect(handler).toMatch(/\["cancelled", "declined"\]\.includes\(row\.status\)/);
    expect(handler).not.toMatch(/status !== "pending"/);
  });

  test("the per-request cap counts what is already stored", () => {
    // A per-upload cap would let five uploads of five quietly store twenty-five.
    expect(handler).toMatch(/SELECT COUNT\(\*\) AS n FROM reimbursement_receipts WHERE reimbursement_id/);
    expect(handler).toMatch(/> MAX_RECEIPTS/);
  });

  test("provenance is recorded — uploaded_by is the person who attached it", () => {
    // The approver may attach a photo the requester texted them. Who filed the request and
    // who supplied the paperwork are different facts and both are worth keeping.
    expect(handler).toMatch(/uploaded_by\) VALUES[\s\S]{0,200}req\.user\.id/);
  });

  test("it goes through the same validation as a new request", () => {
    // parseReceipts enforces MIME allow-list, size cap AND magic-byte check. Skipping it
    // here would make this endpoint the soft way in.
    expect(handler).toMatch(/parseReceipts\(req\.body\.receipts\)/);
  });

  test("it is audited", () => {
    expect(handler).toMatch(/audit\(req, "reimbursement_receipts_added"/);
  });
});

describe("the client can actually attach one", () => {
  const ui = strip(read("public/js/components/Reimbursements.js"));

  test("rows offer an attach control", () => {
    expect(ui).toMatch(/Attach receipt/);
    expect(ui).toMatch(/reimbursements\/\$\{id\}\/receipts/);
  });

  test("photos are resized before upload, same as the new-request form", () => {
    // A raw modern-phone photo would blow the 5MB server cap on exactly the device most
    // likely to be taking the picture.
    const h = ui.slice(ui.indexOf("const onAttachPicked"));
    expect(h.slice(0, 1600)).toMatch(/processFile\(f\)/);
  });

  test("the picker resets so a failed file can be retried", () => {
    const h = ui.slice(ui.indexOf("const onAttachPicked"));
    expect(h.slice(0, 800)).toMatch(/e\.target\.value = ''/);
  });

  test("attach stays available once a receipt exists", () => {
    // A till roll and the card slip are commonly two photos.
    expect(ui).toMatch(/Add another/);
  });
});
