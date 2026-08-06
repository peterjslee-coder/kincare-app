// v1.105.41 — whose money is it?
//
// Pete, 8/6: "Sara approved Daniel's request for reimbursement. The push says she
// confirmed MY request for $655."
//
// notifyParties() fans every reimbursement event out to three people — the payee, the team
// leader, and the billing contact — and composeDigest() wrote a single body saying "your"
// to all of them. Pete is the leader on that team; Daniel is the payee. Pete was told he
// was owed $655 he never spent.
//
// The ledger's whole job is that a family can look at it later and agree who paid for
// what. A notification that misattributes a payment is the app arguing for the wrong
// answer, in the one place people read without opening it. So the sentence is built from
// the READER's relationship to the row, and that is what these tests pin.
//
// There were no tests on this file at all, which is why it shipped.

const { code } = require("./helpers/source");
const { composeDigest } = require("../src/services/reimbursementDigest");

const PETE = "u-pete", DANIEL = "u-daniel", SARA = "u-sara";

// Daniel's sink request, approved by Sara. The row Pete was looking at.
function sinkRow(over = {}) {
  return {
    id: "r-sink", care_team_id: "t-betty", amount: "655.00",
    description: "Plumber — replace kitchen sink",
    payee_user_id: DANIEL, approved_by: SARA, status: "approved",
    ...over,
  };
}

const asPete = { actorFirstName: "Sara", actorId: SARA, payeeFirstName: "Daniel", recipientUserId: PETE };
const asDaniel = { ...asPete, recipientUserId: DANIEL };

describe("the bug Pete reported", () => {
  test("Pete, who is neither payee nor approver, is told it is DANIEL'S money", () => {
    const msg = composeDigest(sinkRow(), asPete);
    expect(msg.body).toContain("Daniel's $655.00");
    expect(msg.body).not.toMatch(/\byour\b/i);
  });

  test("Daniel, who is owed it, still gets the second person", () => {
    const msg = composeDigest(sinkRow(), asDaniel);
    expect(msg.body).toContain("your $655.00");
    expect(msg.body).not.toContain("Daniel's");
  });

  test("the same row produces DIFFERENT bodies for the two readers", () => {
    // The regression in one line: one body for a three-person fan-out is the bug.
    expect(composeDigest(sinkRow(), asPete).body)
      .not.toBe(composeDigest(sinkRow(), asDaniel).body);
  });

  test("an unknown reader gets third person, never a guessed 'your'", () => {
    // Falling back to "your" is exactly how this shipped. If we don't know who is
    // reading, we must not claim the money is theirs.
    const msg = composeDigest(sinkRow(), { actorFirstName: "Sara", payeeFirstName: "Daniel" });
    expect(msg.body).toContain("Daniel's");
    expect(msg.body).not.toMatch(/\byour\b/i);
  });

  test("an unknown payee degrades to 'a team member's', not to 'your'", () => {
    const msg = composeDigest(sinkRow(), { actorFirstName: "Sara", recipientUserId: PETE });
    expect(msg.body).toContain("a team member's $655.00");
    expect(msg.body).not.toMatch(/\byour\b/i);
  });
});

describe("every status carries the attribution, not just 'approved'", () => {
  const cases = [
    ["approved", sinkRow()],
    ["declined", sinkRow({ status: "declined", declined_reason: "Already covered by Betty's card" })],
    ["paid by another method", sinkRow({ status: "paid", paid_method: "bank" })],
    ["paid in-app, processing", sinkRow({ status: "paid", paid_method: "ach_inplace" })],
    ["paid in-app, confirmed", sinkRow({ status: "paid", paid_method: "ach_inplace", payout_status: "succeeded" })],
  ];

  test.each(cases)("%s — Pete is never told it is his", (_label, row) => {
    const body = composeDigest(row, asPete).body;
    expect(body).toContain("Daniel's");
    expect(body).not.toMatch(/\byour\b/i);
  });

  test.each(cases)("%s — Daniel is told it is his", (_label, row) => {
    expect(composeDigest(row, asDaniel).body).toContain("your");
  });

  test("'heading to your bank' becomes 'their bank' for the onlooker", () => {
    const row = sinkRow({ status: "paid", paid_method: "ach_inplace", payout_status: "succeeded" });
    expect(composeDigest(row, asPete).body).toContain("heading to their bank");
    expect(composeDigest(row, asDaniel).body).toContain("heading to your bank");
  });
});

describe("nobody is told about their own action", () => {
  test("a digest that comes due after Sara acts is not sent to Sara", () => {
    // Real sequence: Daniel edits his request (enqueues a digest for Pete AND Sara), then
    // Sara approves within the window. notifyParties drops Sara from the NEW event, but her
    // row from Daniel's edit is still pending — and would have told her what she just did.
    expect(composeDigest(sinkRow(), { ...asPete, recipientUserId: SARA })).toBeNull();
  });

  test("a paid row credits the payer as the actor", () => {
    const row = sinkRow({ status: "paid", paid_method: "bank", paid_by: SARA });
    expect(composeDigest(row, { ...asPete, actorId: SARA })).not.toBeNull();
    expect(composeDigest(row, { ...asPete, actorId: SARA, recipientUserId: SARA })).toBeNull();
  });

  test("still nothing to say about a pending or cancelled row", () => {
    expect(composeDigest(sinkRow({ status: "pending" }), asPete)).toBeNull();
    expect(composeDigest(sinkRow({ status: "cancelled" }), asPete)).toBeNull();
  });
});

describe("possessives read like English", () => {
  test("a name ending in s takes a bare apostrophe", () => {
    const msg = composeDigest(sinkRow({ payee_user_id: "u-chris" }),
      { actorFirstName: "Sara", payeeFirstName: "Chris", recipientUserId: PETE });
    expect(msg.body).toContain("Chris' $655.00");
    expect(msg.body).not.toContain("Chris's");
  });
});

describe("and it still respects 'no phi on lock screens'", () => {
  const src = code("src/services/reimbursementDigest.js");

  test("the description never reaches the body", () => {
    // A reimbursement description is routinely "pharmacy — memantine refill". This file was
    // missed by the v1.105.39 sweep because the gate only knew about `body:` keys.
    for (const [, row] of [["a", sinkRow()], ["b", sinkRow({ status: "paid", paid_method: "bank" })]]) {
      expect(composeDigest(row, asPete).body).not.toContain("sink");
      expect(composeDigest(row, asPete).body).not.toContain("Plumber");
    }
    expect(src).not.toMatch(/\$\{[^}]*\bdescription\b/);
  });

  test("the decline reason is dropped too — it is free text about a person's spending", () => {
    const row = sinkRow({ status: "declined", declined_reason: "Already covered by Betty's card" });
    expect(composeDigest(row, asPete).body).not.toContain("Betty");
    expect(src).not.toMatch(/\$\{[^}]*\bdeclined_reason\b/);
  });

  test("the amount stays — money is not PHI, and it is what makes it worth unlocking for", () => {
    expect(composeDigest(sinkRow(), asPete).body).toContain("$655.00");
  });
});

describe("the sweeper hands composeDigest what it now needs", () => {
  const src = code("src/services/reimbursementDigest.js");

  test("it looks up the payee's name", () => {
    // Without this the body says "a team member's" for every reader forever — technically
    // correct, uselessly vague, and it would have hidden the bug rather than fixed it.
    expect(src).toMatch(/payee_first_name/);
    expect(src).toMatch(/LEFT JOIN users pu ON pu\.id = rb\.payee_user_id/);
  });

  test("it passes the reader and the actor through", () => {
    expect(src).toMatch(/recipientUserId: d\.user_id/);
    expect(src).toMatch(/actorId,/);
  });
});
