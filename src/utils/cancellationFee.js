// ─── Late-cancellation fee (v1.105.15) ───
//
// The published Client Services Agreement at yourinplace.com/client-services says:
//
//   >24h, either party cancels        → "Client shall be entitled to a full refund"
//   <24h, CLIENT cancels              → "Client shall be charged a cancellation fee at the
//                                        then-current rate posted on IPC's platform at the
//                                        time of cancellation"
//   <24h, CAREGIVER cancels or no-shows → "Client shall be entitled to a full refund"
//
// Two things follow from the exact wording, and both shape this file.
//
// FIRST: the contract does not say "the client has paid for the visit". It says a
// cancellation FEE at a rate POSTED ON THE PLATFORM. The charge is defined by reference to
// something external, so charging any amount that has never been posted is not supported
// by the agreement the client signed — including charging 100%. That makes the posted rate
// a real dependency, not a config nicety, which is why the rate lives in platform_settings
// (a value an admin can set and the app can display) rather than as a constant in code.
//
// SECOND: the asymmetry is the whole point. Only a CLIENT cancelling late pays. A caregiver
// cancelling late — or simply not turning up — owes the client a full refund. Any code that
// treats "late cancellation" as one condition without asking who did it gets this exactly
// backwards for the party the clause is written to protect.
//
// Mechanically this is a partial capture, not a charge-then-refund. Nobody pre-pays: the
// hold is placed 23-25h before the visit with capture_method:'manual'. So a late cancel is
// "capture part of the hold, release the rest", which Stripe does natively — and which is
// why the 24h contractual boundary and the 25h authorization window nearly coincide.

const DEFAULT_FEE_PERCENT = 0;

/**
 * The posted cancellation fee percentage.
 *
 * Defaults to ZERO, deliberately, even though the intended business policy is higher.
 * Until a rate is actually posted there is no "then-current rate posted on IPC's platform"
 * for the contract to point at, and charging a card under a clause whose operative number
 * does not exist is the one outcome worse than not charging at all. An admin setting the
 * value is what makes the clause enforceable; this default is what keeps a silent
 * mis-charge impossible before then.
 */
async function getCancellationFeePercent(db) {
  try {
    const row = await db.prepare(
      "SELECT value FROM platform_settings WHERE key = 'cancellation_fee_percent'"
    ).get();
    if (!row) return DEFAULT_FEE_PERCENT;
    const pct = Number(row.value);
    if (!Number.isFinite(pct) || pct < 0) return DEFAULT_FEE_PERCENT;
    // Cap at 100: a fee above the authorized amount cannot be captured from the hold
    // anyway, and Stripe would reject the capture outright — turning a config typo into a
    // failed cancellation rather than an overcharge.
    return Math.min(pct, 100);
  } catch (e) {
    console.error("[cancellationFee] lookup failed, defaulting to no fee:", e.message);
    return DEFAULT_FEE_PERCENT;
  }
}

/**
 * What to do with the hold when a session is cancelled.
 *
 * Returns { action: 'none' | 'void' | 'capture', amountCents?, feePercent, reason }.
 * Pure apart from the settings read, so the decision is testable without Stripe.
 */
async function decideCancellationCharge(db, {
  cancelledBy,            // 'family' | 'caregiver'
  isLateCancel,           // <24h AND a caregiver was assigned
  paymentIntentId,
  paymentStatus,          // care_sessions.payment_status
  authorizedAmountCents,
}) {
  // No hold exists — most cancellations, since the authorization is only placed inside the
  // final ~25 hours. Nothing to void, nothing to capture.
  if (!paymentIntentId || paymentStatus !== "authorized") {
    return { action: "none", feePercent: 0, reason: "no_hold" };
  }

  // Caregiver cancelled, at any notice: "Client shall be entitled to a full refund."
  if (cancelledBy !== "family") {
    return { action: "void", feePercent: 0, reason: "caregiver_cancelled" };
  }

  // Client cancelled with more than 24h notice: full refund.
  if (!isLateCancel) {
    return { action: "void", feePercent: 0, reason: "outside_window" };
  }

  const feePercent = await getCancellationFeePercent(db);
  if (feePercent <= 0) {
    return { action: "void", feePercent: 0, reason: "no_posted_rate" };
  }

  const amountCents = Math.round((authorizedAmountCents || 0) * (feePercent / 100));
  // Stripe rejects a zero-amount capture. A fee that rounds to nothing is a release.
  if (!amountCents) {
    return { action: "void", feePercent, reason: "fee_rounds_to_zero" };
  }

  return { action: "capture", amountCents, feePercent, reason: "late_client_cancel" };
}

module.exports = { DEFAULT_FEE_PERCENT, getCancellationFeePercent, decideCancellationCharge };
