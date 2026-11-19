// A tip shows on the visit's cost card (v1.135.4). Pete, 11/19: "why doesn't the tip i left tina
// show up here? it was $50." The tip is charged after the visit (ledger kind 'tip'); the card
// showed only the estimate.
const { raw } = require("./helpers/source");
const m = raw("public/js/components/VisitDetailModal.js");
test("the cost card reads succeeded tips from the receipt", () => {
  expect(m).toContain("e.kind === 'tip' && e.status === 'succeeded'");
});
test("family total includes the tip and its card fee; caregiver total includes the tip", () => {
  expect(m).toContain("((cost.familyTotal || cost.total) + tipAmount + tipCardFee).toFixed(2)");
  expect(m).toContain("((cost.caregiverPayout || cost.total) + tipAmount).toFixed(2)");
});
