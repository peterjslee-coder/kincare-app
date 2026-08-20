// Trust decides what she may SEE. Stripe decides whether she can be PAID. (v1.105.107)
//
// Julia, 7d94657c: the Find Work card said "Care Recipient". She is about to spend an
// afternoon with a person, not a role.
//
// The name was not missing, it was withheld: dashboard.js gated every personal detail on
// `stripe_onboard_complete && (is_background_checked || vouched-by-this-family)`. So a
// caregiver personally vouched for by a family still saw nothing about them until she had set
// up a bank account.
//
// And it was backwards in practice. The Stripe gate on ACCEPTING a job is commented out in
// sessions.js ("skipped for now — not live yet"), so Stripe blocked the information and not
// the action: Julia could take a job for Pete's mother while the card still called her
// "Care Recipient".

const { maySeeRecipientDetails, isTrustedCaregiver } = require("../src/utils/caregiverTrust");
const fs = require("fs");
const path = require("path");
const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

const LOWES = "family-lowe";
const HUBERS = "family-huber";

describe("who may see a name", () => {
  test("a background-checked caregiver sees any family's", () => {
    expect(maySeeRecipientDetails({ is_background_checked: 1 }, new Set(), LOWES)).toBe(true);
  });

  test("a vouch shows that family's, and only that family's", () => {
    // A vouch is scoped to one family (v1.64.0). Being trusted by the Lowes says nothing
    // about the Hubers.
    const vouched = new Set([LOWES]);
    expect(maySeeRecipientDetails({}, vouched, LOWES)).toBe(true);
    expect(maySeeRecipientDetails({}, vouched, HUBERS)).toBe(false);
  });

  test("neither check, no name", () => {
    expect(maySeeRecipientDetails({}, new Set(), LOWES)).toBe(false);
  });

  test("Stripe is not part of the answer, in either direction", () => {
    // Julia's case: vouched, no bank account yet. She sees the name.
    expect(maySeeRecipientDetails({ stripe_onboard_complete: 0 }, new Set([LOWES]), LOWES)).toBe(true);
    // And a finished Stripe account does not buy trust it hasn't earned.
    expect(maySeeRecipientDetails({ stripe_onboard_complete: 1 }, new Set(), LOWES)).toBe(false);
  });

  test("a missing profile is never trusted", () => {
    expect(maySeeRecipientDetails(null, new Set([LOWES]), LOWES)).toBe(false);
    expect(maySeeRecipientDetails(undefined, undefined, undefined)).toBe(false);
  });

  test("a vouch with no family in scope decides nothing", () => {
    expect(maySeeRecipientDetails({}, new Set([LOWES]), undefined)).toBe(false);
  });
});

describe("the platform-wide form", () => {
  test("trusted by anyone is enough for a capability flag", () => {
    expect(isTrustedCaregiver({}, new Set([LOWES]))).toBe(true);
    expect(isTrustedCaregiver({ is_background_checked: 1 }, new Set())).toBe(true);
    expect(isTrustedCaregiver({}, new Set())).toBe(false);
    expect(isTrustedCaregiver(null, new Set([LOWES]))).toBe(false);
  });

  test("but it is NOT the per-job answer", () => {
    // isTrustedCaregiver says "somebody vouched"; maySeeRecipientDetails says "THIS family
    // did". Collapsing them would leak the Hubers' details to someone the Lowes vouched for.
    const vouched = new Set([LOWES]);
    expect(isTrustedCaregiver({}, vouched)).toBe(true);
    expect(maySeeRecipientDetails({}, vouched, HUBERS)).toBe(false);
  });
});

describe("the callers", () => {
  const dash = read("src/routes/dashboard.js");

  test("dashboard.js has one definition of each, not its own copy", () => {
    expect(dash).toMatch(/const \{ maySeeRecipientDetails, isTrustedCaregiver \} = require\("\.\.\/utils\/caregiverTrust"\)/);
    expect(dash).toMatch(/const bgCleared = maySeeRecipientDetails\(profile, vouchedFamilyIds, s\.family_user_id\)/);
    expect(dash).toMatch(/caregiverCleared: isTrustedCaregiver\(profile, vouchedFamilyIds\)/);
  });

  test("no disclosure decision reads stripe_onboard_complete any more", () => {
    // It may still be REPORTED — the client needs to know whether to show the payment step.
    const decisions = dash.split("\n").filter((l) =>
      l.includes("stripe_onboard_complete") &&
      !/stripe(Connected|OnboardComplete):/.test(l) &&
      !l.trim().startsWith("//")            // the comment recording why it left
    );
    expect(decisions).toEqual([]);
  });

  test("a withheld name says it is withheld", () => {
    // "Care Recipient" read like the app had forgotten who she was.
    const fw = read("public/js/components/FindWork.js");
    const code = fw.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    expect((code.match(/Name shared once you\\u2019re cleared/g) || []).length).toBe(2);
  });
});
