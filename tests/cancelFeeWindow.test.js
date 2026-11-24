// v1.105.19 — the 24-hour reconcile window.
//
// "24 hours to reconcile or escalate, otherwise handled by the rules. Silence is consent."
// The invariants worth pinning are about WHO may do WHAT, and which direction each timer
// fails in. Structural assertions: exercising this end to end needs Stripe, and Dev Rule #7
// keeps test data away from live keys.

const fs = require("fs");
const path = require("path");
// v1.105.36 — reads source through tests/helpers/source.js. The hand-rolled strip this
// replaces used a GLOBAL /* … */ regex, which reads the `/*` inside a string literal as a
// comment opener: on src/server.js the `https://*.tile.openstreetmap.org` entry in the CSP
// swallowed 1,184 characters of real config, and on src/models/database.js it lost 770.
// A positive assertion fails loudly when that happens; a NEGATIVE one passes silently,
// having verified nothing.
const { raw, code } = require("./helpers/source");

const sessions = code("src/routes/sessions.js");
const acct = code("src/routes/accountability.js");

describe("who may act on a pending fee", () => {
  test("only the caregiver can waive", () => {
    // The fee is their lost wage. An admin waiving it would be InPlace giving away someone
    // else's money — exactly the discretion the agreements do not grant.
    expect(sessions).toMatch(/Only the caregiver can waive their own cancellation fee/);
  });

  test("a waive that fails to release the money does NOT mark itself waived", () => {
    // Otherwise a caregiver is told they forgave a charge the family still pays.
    const w = sessions.slice(sessions.indexOf('router.post("/:id/cancel-fee/waive"'));
    expect(w).toMatch(/voided\?\.error/);
    expect(w).toMatch(/502/);
  });

  test("only the family can dispute, and a dispute needs a reason", () => {
    const d = sessions.slice(sessions.indexOf('router.post("/:id/cancel-fee/dispute"'));
    expect(d).toMatch(/family_user_id/);
    expect(d).toMatch(/reason\.length < 5/);
  });

  test("a dispute pauses rather than cancels the charge", () => {
    const d = sessions.slice(sessions.indexOf('router.post("/:id/cancel-fee/dispute"'));
    expect(d).toMatch(/cancel_fee_status = 'disputed'/);
    expect(d).toMatch(/notifyAdmins/);
  });
});

describe("silence is consent, and the timers fail in opposite directions", () => {
  test("a pending fee past its deadline is CAPTURED", () => {
    expect(acct).toMatch(/cancel_fee_status = 'pending' AND cancel_fee_deadline <= NOW\(\)/);
    expect(acct).toMatch(/captureSessionPayment/);
  });

  test("a capture failure leaves it pending for the next tick, never marks it charged", () => {
    const p = acct.slice(acct.indexOf("async function pollCancellationFees"));
    expect(p).toMatch(/continue;/);
  });

  test("a dispute we never reviewed is VOIDED, not charged", () => {
    // If InPlace could not review a dispute in five days, the family should not pay for
    // that. Failing toward not charging is the only defensible direction when we are late.
    const p = acct.slice(acct.indexOf("async function pollCancellationFees"));
    expect(p).toMatch(/cancel_fee_status = 'disputed'/);
    expect(p).toMatch(/voidSessionPayment/);
    expect(p).toMatch(/cancel_fee_status = 'dropped'/);
  });

  test("the whole window closes well inside Stripe's authorization lifetime", () => {
    // The hold dies at ~7 days. A window that outlived it would silently lose the money.
    const { CANCEL_FEE_WINDOW_HOURS, DISPUTE_BACKSTOP_HOURS } = require("../src/utils/cancellationFee");
    expect(CANCEL_FEE_WINDOW_HOURS).toBe(24);
    expect(DISPUTE_BACKSTOP_HOURS).toBeLessThan(7 * 24);
  });

  test("the poller is actually registered", () => {
    expect(code("src/server.js")).toMatch(/await pollCancellationFees\(\)/);
  });
});

describe("one cancellation policy, not two", () => {
  test("the time-change decline routes through the contract decision", () => {
    // It used to compute cancel_fee_hours x hourly_rate, show "you'll be compensated $X",
    // and never call Stripe. Caregivers were shown a figure and paid nothing since March.
    const tc = sessions.slice(sessions.indexOf('proposal.proposed_by === "family" && isResponderCaregiver'));
    expect(tc.slice(0, 3000)).toMatch(/decideCancellationCharge/);
  });

  test("the caregiver UI no longer promises a bespoke amount", () => {
    const hub = raw("public/js/components/CaretakerHub.js");
    expect(hub).not.toMatch(/Cancel \+ Collect Fee/);
    expect(hub).not.toMatch(/you'll be compensated for/);
  });
});

describe("grace cancellation is gone", () => {
  test("caregiver onboarding no longer promises a mechanism that does not exist", () => {
    const ob = raw("public/js/components/CaregiverOnboarding.js");
    expect(ob).not.toMatch(/grace cancellation/i);
    // and states the real rule, including the caregiver's own right to waive
    expect(ob).toMatch(/paid in full for that visit/);
    expect(ob).toMatch(/waive/i);
  });
});
