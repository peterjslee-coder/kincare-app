// v1.105.20 — Dev Rule #7 at the Stripe boundary.
//
// "NEVER trigger real payments from demo/seed data. Stripe is live with real keys."
//
// The rule was already enforced in one place — pollPaymentAuthorizations filters on
// users.is_demo — and on 7/31 that turned out to be both real and insufficient. The
// screenshot harness cleared is_demo to hide the demo persona bar, and the poller
// immediately began authorising seeded sessions. Nothing reached Stripe only because the
// keys happened to be blanked.
//
// Two lessons are pinned here: the check belongs at the function that talks to Stripe
// rather than at one of its callers, and it must not depend solely on a mutable flag.

const fs = require("fs");
const path = require("path");
const raw = fs.readFileSync(path.join(__dirname, "..", "src/routes/accountability.js"), "utf8");
const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

// Slice each Stripe-touching function from its declaration to the next one, so a guard on
// a neighbour cannot satisfy an assertion about this one.
const fnBody = (decl) => {
  const start = code.indexOf(decl);
  expect(start).toBeGreaterThan(-1);
  const next = code.indexOf("\nasync function ", start + decl.length);
  return code.slice(start, next === -1 ? code.length : next);
};

describe("every function that talks to Stripe refuses demo data", () => {
  for (const decl of [
    "async function authorizeSessionPayment(sessionId) {",
    "async function captureSessionPayment(sessionId, captureAmountCents = null) {",
    "async function voidSessionPayment(sessionId) {",
  ]) {
    test(`${decl.match(/function (\w+)/)[1]} is guarded`, () => {
      const body = fnBody(decl);
      expect(body).toMatch(/isDemoSession/);
      expect(body).toMatch(/demo_session_blocked/);
    });

    test(`${decl.match(/function (\w+)/)[1]} guards BEFORE it reaches Stripe`, () => {
      // A guard that runs after the API call is not a guard. Assert the demo check appears
      // before the first getStripe()/stripe. usage in the same function.
      const body = fnBody(decl);
      const guardAt = body.indexOf("isDemoSession");
      const stripeAt = body.search(/getStripe\(\)|stripe\.paymentIntents/);
      if (stripeAt !== -1) expect(guardAt).toBeLessThan(stripeAt);
    });
  }
});

describe("the check does not rest on a mutable flag alone", () => {
  test("is_demo is not the only signal", () => {
    // is_demo is a column any process can clear — that is exactly how this failed. The
    // seed's own email domain is the redundant signal, because nothing in the app rewrites
    // a user's email.
    expect(code).toMatch(/DEMO_EMAIL_DOMAIN/);
    expect(code).toMatch(/@inplace\.care/);
    expect(code).toMatch(/is_demo/);
  });

  test("an unknown session is refused, not allowed", () => {
    const guard = code.slice(code.indexOf("async function isDemoSession"));
    expect(guard.slice(0, 1200)).toMatch(/if \(!row\) return true/);
  });

  test("a failed lookup refuses too", () => {
    // A database blip must not become permission to charge a real card with fake data.
    const guard = code.slice(code.indexOf("async function isDemoSession"));
    const catchBlock = guard.slice(guard.indexOf("catch"));
    expect(catchBlock.slice(0, 400)).toMatch(/return true/);
  });

  test("both parties are checked, not just the family", () => {
    // A real family booking a demo caregiver, or the reverse, is still demo data reaching
    // live keys.
    const guard = code.slice(code.indexOf("async function isDemoSession"));
    expect(guard.slice(0, 1500)).toMatch(/fam_demo/);
    expect(guard.slice(0, 1500)).toMatch(/cg_demo/);
  });
});

describe("the original poller filter is still there", () => {
  test("pollPaymentAuthorizations still excludes demo users in SQL", () => {
    // Defence in depth: the boundary guard is the backstop, not a replacement. Keeping the
    // SQL filter means demo sessions are never even considered.
    const poller = code.slice(code.indexOf("async function pollPaymentAuthorizations"));
    expect(poller.slice(0, 1500)).toMatch(/u\.is_demo IS NULL OR u\.is_demo = 0/);
    expect(poller.slice(0, 1500)).toMatch(/cu\.is_demo IS NULL OR cu\.is_demo = 0/);
  });
});
