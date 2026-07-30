// ─── Late-cancellation fee (v1.105.17) ───
//
// The published Client Services Agreement and Caregiver Agreement now say:
//
//   >24h, either party cancels          → Client entitled to a full refund
//   <24h, CLIENT cancels                → Client charged 100% of the amount AUTHORIZED for
//                                          that appointment; Caregiver receives the same
//                                          share they would have had the visit happened,
//                                          net of the Platform Fee
//   <24h, CAREGIVER cancels or no-shows → Client entitled to a full refund
//
// v1.105.15 read an earlier draft that charged "a cancellation fee at the then-current rate
// posted on IPC's platform", which defined the charge by reference to a rate that had never
// been posted anywhere — so this file defaulted to 0 and released every hold. The agreements
// now state the number outright, so the default states it too. The platform_settings
// override remains for changing the rate later without a contract amendment, which the
// clause expressly permits (prospectively only).
//
// TWO THINGS THE WORDING STILL DICTATES.
//
// The asymmetry. Only a CLIENT cancelling late pays. A caregiver cancelling late — or simply
// not turning up — owes the client a full refund. Code that treats "late cancellation" as one
// condition without asking WHO did it charges the family for the caregiver's no-show, which
// is exactly backwards from what the clause protects against.
//
// "Of the amount AUTHORIZED", not of the session price. Those differ: the authorization
// includes any short-notice surcharge and excludes anything added at check-out. The
// authorized amount is also the only figure that can actually be captured, so pinning the fee
// to it keeps the contract and the mechanism describing the same number.
//
// Mechanically this is a capture of the existing hold, not a charge-then-refund. Nobody
// pre-pays: the hold is placed 23-25h out with capture_method:'manual', which is why the 24h
// contractual boundary and the 25h authorization window nearly coincide.
//
// ⚠️ PARTIAL captures are not safe yet. accountability.js sets application_fee_amount at
// AUTHORIZATION time against the full amount, and Stripe does not prorate it on a partial
// capture — so capturing 50% would take the platform's whole fee out of half the money and
// short the caregiver's contractual share. At 100% the arithmetic is unchanged, which is why
// only 100 is safe to post today. Prorate the application fee before posting anything lower.

const DEFAULT_FEE_PERCENT = 100;

/**
 * The posted cancellation fee percentage.
 *
 * Defaults to the rate written into the agreements (100). An admin can post a different rate
 * in platform_settings, which the clause permits — but see the partial-capture warning above
 * before posting anything below 100.
 */
async function getCancellationFeePercent(db) {
  try {
    const row = await db.prepare(
      "SELECT value FROM platform_settings WHERE key = 'cancellation_fee_percent'"
    ).get();
    if (!row) return DEFAULT_FEE_PERCENT;
    // A blank value is corruption, not a decision. Number("") is 0 and Number(" ") is 0,
    // both finite — so without this check an empty settings row would silently switch
    // late-cancel charging off and look exactly like a deliberate 0.
    const raw = String(row.value ?? "").trim();
    if (!raw) return DEFAULT_FEE_PERCENT;
    const pct = Number(raw);
    if (!Number.isFinite(pct) || pct < 0) return DEFAULT_FEE_PERCENT;
    // Cap at 100: a fee above the authorized amount cannot be captured from the hold
    // anyway, and Stripe would reject the capture outright — turning a config typo into a
    // failed cancellation rather than an overcharge.
    return Math.min(pct, 100);
  } catch (e) {
    console.error("[cancellationFee] lookup failed, falling back to the agreement rate:", e.message);
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
  // An admin can still post 0 to switch late-cancel charging off without a code change.
  if (feePercent <= 0) {
    return { action: "void", feePercent: 0, reason: "rate_set_to_zero" };
  }

  const amountCents = Math.round((authorizedAmountCents || 0) * (feePercent / 100));
  // Stripe rejects a zero-amount capture. A fee that rounds to nothing is a release.
  if (!amountCents) {
    return { action: "void", feePercent, reason: "fee_rounds_to_zero" };
  }

  return { action: "capture", amountCents, feePercent, reason: "late_client_cancel" };
}

module.exports = { DEFAULT_FEE_PERCENT, getCancellationFeePercent, decideCancellationCharge };
