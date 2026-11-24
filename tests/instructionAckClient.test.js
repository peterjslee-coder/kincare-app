// v1.109.6 — the caregiver's check-in acknowledges the family's instructions on their own, and
// the family's Edit box replaces rather than appends. Source-level pins; the server behaviour is
// in tests/integration/instructionAcks.itest.js.
const fs = require("fs");
const path = require("path");
const read = (f) => fs.readFileSync(path.join(__dirname, "..", "public/js/components", f), "utf8");
const { instructionsNeedAck, sameInstructions } = require("../src/utils/instructionAck");

describe("check-in wizard", () => {
  const src = read("CaretakerHub.js");
  test("Continue is gated on the instructions checkbox, not only the briefing", () => {
    expect(src).toMatch(/const briefingReady = briefingAcked && \(!wizardHasInstructions \|\| instructionsAcked\)/);
    expect(src).toMatch(/if \(!briefingReady\) \{/);
  });
  test("the check-in sends the exact text she checked off", () => {
    expect(src).toMatch(/acknowledgedInstructions: wizardInstructions/);
  });
  test("the checkbox resets each time the wizard opens", () => {
    expect(src).toMatch(/setBriefingAcked\(false\);\s*setInstructionsAcked\(false\);/);
  });
  test("an instructions change mid-visit reloads her dashboard", () => {
    expect(src).toMatch(/'instructions_updated',\s*\]\.map\(ev => onSocketEvent\(ev, reload\)\)/);
  });
});

describe("family visit detail", () => {
  const src = read("VisitDetailModal.js");
  test("Edit sends mode: 'replace'", () => {
    expect(src).toMatch(/specialInstructions: instructionsText, mode: 'replace'/);
  });
});

describe("instructionsNeedAck", () => {
  test("no text, nothing to acknowledge", () => {
    expect(instructionsNeedAck({ special_instructions: "  " })).toBe(false);
  });
  test("text never acknowledged", () => {
    expect(instructionsNeedAck({ special_instructions: "x" })).toBe(true);
  });
  test("acknowledged, then changed", () => {
    expect(instructionsNeedAck({ special_instructions: "x", instructions_acknowledged_at: "2026-09-28T13:00:00Z", instructions_updated_at: "2026-09-28T13:05:00Z" })).toBe(true);
    expect(instructionsNeedAck({ special_instructions: "x", instructions_acknowledged_at: "2026-09-28T13:05:00Z", instructions_updated_at: "2026-09-28T13:00:00Z" })).toBe(false);
  });
  test("whitespace and line endings do not count as a change", () => {
    expect(sameInstructions("a\r\nb ", "a\nb")).toBe(true);
  });
});
