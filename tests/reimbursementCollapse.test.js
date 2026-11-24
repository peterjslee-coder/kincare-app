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
    expect(ui).toMatch(/const SETTLED_STATUSES = \['paid', 'declined', 'cancelled'\]/);
  });

  test("pending and approved rows are never in the collapsible group", () => {
    // 'approved' means agreed but NOT yet paid — someone is still owed money. It stays.
    const m = ui.match(/const SETTLED_STATUSES = \[([^\]]*)\]/);
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

// v1.105.32 — "no one is going to look for it at the bottom of the long list." (Pete)
// The bottom control is still the right thing where it sits, but it only exists after every
// row has rendered, so finding it requires scrolling past the exact clutter it removes.
describe("the same control, in the card header where it can be found", () => {
  test("the header carries a toggle", () => {
    // v1.105.171 — the title is now a collapse control, so it is no longer a bare
    // `<span>💵 Reimbursements</span>`. The slice still means "the header row".
    const header = ui.slice(ui.indexOf('💵 Reimbursements'), ui.indexOf('Fronted money for'));
    expect(header).toMatch(/onClick=\{toggleSettled\}/);
  });

  test("both controls drive ONE piece of state — they can never disagree", () => {
    // The failure mode worth pinning: a second control with its own useState, so the header
    // says "collapsed" while the list is expanded. There is exactly one setter and one key.
    expect(ui.match(/const \[showSettled, setShowSettled\]/g) || []).toHaveLength(1);
    expect(ui.match(/inplace\.reimb\.showSettled/g) || []).toHaveLength(2); // one get, one set
    expect(ui.match(/const toggleSettled = /g) || []).toHaveLength(1);
    expect(ui.match(/onClick=\{toggleSettled\}/g) || []).toHaveLength(2);
  });

  test("the header count is computed the same way the list partitions", () => {
    // Counting straight off `items` would include the approver's pending/approved to-dos,
    // which are lifted out above and are never part of the tail. The header would then
    // offer to collapse rows the list never collapses.
    const summary = ui.slice(ui.indexOf("const settledSummary"), ui.indexOf("const attachInputRef"));
    expect(summary).toMatch(/meta\.isApprover \? items\.filter\(\(x\) => !\['pending', 'approved'\]/);
    expect(summary).toMatch(/SETTLED_STATUSES\.includes\(x\.status\)/);
  });

  test("it hides itself when there is nothing settled, and while the form is open", () => {
    expect(ui).toMatch(/!showForm && settledSummary\.count > 0/);
  });

  test("the arrow states the direction, and says so to a screen reader", () => {
    expect(ui).toMatch(/aria-expanded=\{showSettled\}/);
    expect(ui).toMatch(/\{showSettled \? '▾' : '▸'\} \{settledSummary\.count\} settled/);
  });
});
