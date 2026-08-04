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
// v1.105.36 — strip the WHOLE FILE with the shared reader, then slice the handler out of
// the stripped text. Stripping a slice with a local regex is how the `/*` inside a string
// literal gets read as a comment opener.
const cancelCode = (() => {
  const stripped = require("./helpers/source").code("src/routes/sessions.js");
  const start = stripped.indexOf('router.put("/:id/cancel"');
  if (start === -1) throw new Error("cancel handler not found in stripped source");
  const rest = stripped.slice(start + 1);
  const end = rest.indexOf("\nrouter.");
  return stripped.slice(start, end === -1 ? undefined : start + 1 + end);
})();

describe("cancelling a session releases the payment hold", () => {
  test("the cancel handler voids the authorization", () => {
    expect(cancelHandler).toMatch(/voidSessionPayment/);
  });

  test("it only touches Stripe when there is something to settle", () => {
    // Calling void unconditionally would throw for the common case — a session cancelled
    // more than 25 hours out, which never had a PaymentIntent at all. The 'none' action
    // covers that case and the already-settled ones.
    expect(cancelCode).toMatch(/charge\.action !== "none"/);
  });

  test("the handler does NOT decide the charge itself", () => {
    // v1.105.15: the decision is a contract question, not a routing question. It lives in
    // cancellationFee.js next to the quoted clauses so the rule and its source stay
    // together. If someone reintroduces an inline `isLateCancel ? capture : void` here,
    // the contract asymmetry (only a CLIENT pays) is exactly what gets lost.
    expect(cancelCode).toMatch(/decideCancellationCharge/);
  });

  test("a Stripe failure does not abort the cancellation", () => {
    // The session must still cancel. Losing the cancel because Stripe hiccuped would leave
    // the caregiver expected at the door — strictly worse than a hold that expires by itself.
    const voidBlock = cancelHandler.slice(cancelHandler.indexOf("voidSessionPayment") - 400);
    expect(voidBlock).toMatch(/catch/);
    expect(voidBlock).toMatch(/captureException/);
  });

  test("a capture is DEFERRED, not taken on the spot", () => {
    // v1.105.19: the fee is the caregiver's lost wage, so the caregiver is the only party
    // with standing to forgive it. Capturing here would take the money before they were
    // asked. The handler records it and the poller settles after the 24-hour window.
    expect(cancelCode).toMatch(/cancel_fee_status = 'pending'/);
    expect(cancelCode).not.toMatch(/captureSessionPayment/);
  });

  test("a VOID is not deferred", () => {
    // Releasing a hold harms nobody and nobody needs a day to think about it. Deferring it
    // would park a pending charge on a family's card for 24h for no reason.
    expect(cancelCode).toMatch(/voidSessionPayment/);
  });

  test("the decision still comes from the contract", () => {
    // v1.105.14 asserted the opposite — that nothing could ever be captured here — because
    // at that point no stated policy existed to charge under. The published Client Services
    // Agreement does state one, so this now asserts the narrower and more useful thing:
    // capture is reachable, and only through decideCancellationCharge.
    expect(cancelCode).toMatch(/decideCancellationCharge/);
    expect(cancelCode).toMatch(/charge\.action === "capture"/);
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
