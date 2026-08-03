// v1.105.31 — collapsing the settled tail.
//
// "Give an option to collapse reimbursement please. Too many now."
//
// The ledger grows without bound because finished business never leaves it, and finished
// business is exactly what nobody needs to look at. So the collapse is by STATUS, not by
// date and not a blanket hide-the-list.
//
// The property that matters more than the tidiness: collapsing must never hide something
// someone is waiting on. A screen that is tidier because it swallowed an approval you owe
// your brother is worse than the cluttered one.

// Shared source reader — see tests/helpers/source.js for why a naive
// block-comment strip silently deletes real code (and makes negative assertions vacuous).
// Uses the shared reader, NOT the obvious one-liner. Writing this test is what surfaced the
// bug in that one-liner: replacing /* ... */ globally reads the `/*` inside
// accept="image/*,application/pdf" as a comment opener and deletes ~9,000 characters of real
// code — including the constant asserted on below. See tests/helpers/source.js.
const { code } = require("./helpers/source");

const ui = code("public/js/components/Reimbursements.js");

describe("only finished business collapses", () => {
  test("the settled set is paid, declined and cancelled — nothing else", () => {
    expect(ui).toMatch(/const SETTLED = \['paid', 'declined', 'cancelled'\]/);
  });

  test("pending and approved rows are never in the collapsible group", () => {
    // 'approved' means agreed but NOT yet paid — someone is still owed money. It stays.
    const m = ui.match(/const SETTLED = \[([^\]]*)\]/);
    expect(m[1]).not.toMatch(/pending/);
    expect(m[1]).not.toMatch(/approved/);
  });

  test("live rows render regardless of the toggle", () => {
    // `live` is unconditional in the ordered array; only `settled` is gated on showSettled.
    expect(ui).toMatch(/const ordered = \[\.\.\.needsAction, \.\.\.live, \.\.\.\(showSettled \? settled : \[\]\)\]/);
  });

  test("the approver's needs-attention rows are still first and never gated", () => {
    expect(ui).toMatch(/\.\.\.needsAction, \.\.\.live/);
  });
});

describe("the control itself", () => {
  test("it only appears when there is a tail to collapse", () => {
    expect(ui).toMatch(/\{settled\.length > 0 && \(/);
  });

  test("it names the count and the money, so collapsing hides no totals", () => {
    expect(ui).toMatch(/settled\.length === 1 \? 'request' : 'requests'/);
    expect(ui).toMatch(/settled\.reduce\(\(t, x\) => t \+ Number\(x\.amount \|\| 0\), 0\)/);
  });

  test("the choice survives a refresh, per care team", () => {
    // A preference you re-make every visit is not much of a preference. Keyed by team so
    // two families do not share one setting.
    expect(ui).toMatch(/localStorage\.getItem\(`inplace\.reimb\.showSettled\.\$\{careTeamId\}`\)/);
    expect(ui).toMatch(/localStorage\.setItem\(`inplace\.reimb\.showSettled\.\$\{careTeamId\}`/);
  });

  test("storage failures do not break the list", () => {
    // Private browsing and locked-down webviews throw on localStorage. A ledger that will
    // not render because a preference could not be read is a bad trade.
    const init = ui.slice(ui.indexOf("const [showSettled"));
    expect(init.slice(0, 400)).toMatch(/catch \{ return true; \}/);
    expect(ui).toMatch(/setItem\([^)]*\); \} catch \{\}/);
  });

  test("it defaults to EXPANDED", () => {
    // Absent a stored choice, show everything. Defaulting to collapsed would hide history
    // from someone who has never been offered the control.
    const init = ui.slice(ui.indexOf("const [showSettled"));
    expect(init.slice(0, 400)).toMatch(/!== '0'/);
  });
});
