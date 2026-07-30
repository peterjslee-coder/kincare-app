// v1.105.14 — cancellation side effects.
//
// These are structural assertions on src/routes/sessions.js rather than behavioural tests,
// and that is a deliberate trade: exercising this handler for real needs Stripe, and Dev
// Rule #7 forbids letting test data anywhere near live keys. What these pin is that the
// two calls exist at all — which is exactly what was wrong before. Both failures were
// silent absences, not bugs in present code: voidSessionPayment existed and was never
// called from here, and sendPushToUser was IMPORTED at the top of the file and never
// called in the cancel handler. A structural test catches a deletion; it does not claim
// to prove the runtime behaviour.

const fs = require("fs");
const path = require("path");

const sessions = fs.readFileSync(path.join(__dirname, "..", "src/routes/sessions.js"), "utf8");

// Isolate the cancel handler so a matching call elsewhere in this 2700-line file (the
// check-out capture, for instance) cannot satisfy these assertions by accident.
const cancelHandler = (() => {
  const start = sessions.indexOf('router.put("/:id/cancel"');
  expect(start).toBeGreaterThan(-1);
  const end = sessions.indexOf("router.", start + 50);
  return sessions.slice(start, end === -1 ? sessions.length : end);
})();

// Comments stripped. Any assertion of the form "this name must NOT appear" has to run
// against code only — the handler's own explanatory comments mention the very identifiers
// those assertions forbid, so matching raw source makes the test fail on its own prose.
// This has now bitten twice (the Android background-location assertion was the first), so
// it gets fixed once, here, rather than patched per line.
const cancelCode = cancelHandler
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .filter((l) => !l.trim().startsWith("//"))
  .join("\n");

describe("cancelling a session releases the payment hold", () => {
  test("the cancel handler voids the authorization", () => {
    expect(cancelHandler).toMatch(/voidSessionPayment/);
  });

  test("it only voids when a hold actually exists", () => {
    // Calling void unconditionally would throw for the common case — a session cancelled
    // more than 25 hours out, which never had a PaymentIntent at all.
    expect(cancelHandler).toMatch(/stripe_payment_intent_id\s*&&\s*session\.payment_status === "authorized"/);
  });

  test("a Stripe failure does not abort the cancellation", () => {
    // The session must still cancel. Losing the cancel because Stripe hiccuped would leave
    // the caregiver expected at the door — strictly worse than a hold that expires by itself.
    const voidBlock = cancelHandler.slice(cancelHandler.indexOf("voidSessionPayment") - 400);
    expect(voidBlock).toMatch(/catch/);
    expect(voidBlock).toMatch(/captureException/);
  });

  test("nothing is charged on a late cancel", () => {
    // There is a 24h late-cancel rule here, but no stated policy behind it. Until there is,
    // the hold is released for everyone. If this ever becomes a partial capture, that must
    // be a deliberate change with a policy attached — not a quiet edit.
    expect(cancelCode).not.toMatch(/captureSessionPayment/);
  });
});

describe("cancelling a session notifies the other party by push", () => {
  test("the cancel handler sends a push", () => {
    // This is the safety-critical one. Before v1.105.14 the handler wrote an activity-feed
    // row and emitted a websocket event and stopped. The socket only reaches someone with
    // the app open, so a caregiver already driving got nothing and arrived at the home of a
    // vulnerable person who was not expecting them.
    expect(cancelHandler).toMatch(/sendPushToUser/);
  });

  test("the push is not nested inside the websocket guard", () => {
    // If it sits inside `if (emitToUser)` it inherits the exact limitation it exists to
    // work around. Assert the push call is not within the emitToUser block.
    const emitIdx = cancelHandler.indexOf("const emitToUser");
    const pushIdx = cancelHandler.indexOf("sendPushToUser");
    expect(pushIdx).toBeGreaterThan(-1);
    const between = cancelHandler.slice(emitIdx, pushIdx);
    // The emitToUser block must have closed before the push call.
    expect(between).toMatch(/\n    }\n/);
  });

  test("the caregiver is told not to travel, not merely that it was cancelled", () => {
    // A notice that states only a fact leaves the reader to infer the action. When the
    // action is "turn the car around", say it.
    expect(cancelHandler).toMatch(/do not travel/i);
  });

  test("it goes to the party who did NOT cancel", () => {
    expect(cancelHandler).toMatch(/cancelledBy === "caregiver" \? session\.family_user_id : session\.caregiver_user_id/);
  });

  test("a push failure never breaks the cancel", () => {
    const pushCall = cancelHandler.slice(cancelHandler.indexOf("sendPushToUser"));
    expect(pushCall).toMatch(/\.catch\(\(\) => \{\}\)/);
  });
});

describe("the advisory late-cancel fields stay advisory", () => {
  test("chargeApplies is still returned but is documented as non-binding", () => {
    // Kept so the client can say "this is a late cancellation". NOT a claim that money is
    // owed. The comment is the guard — someone wiring a charge to this should have to
    // delete a warning to do it.
    expect(cancelHandler).toMatch(/chargeApplies/);
    expect(cancelHandler).toMatch(/ADVISORY ONLY/);
  });
});
