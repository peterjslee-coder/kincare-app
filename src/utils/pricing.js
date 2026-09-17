/**
 * One pricing rule for a care visit (v1.107.0).
 *
 * Pete's rule, verbatim from the fee decision: the caregiver is paid rate × time. The family
 * pays that plus the platform fee (20% by default). Stripe's processing cost comes out of the
 * platform fee — it is never added on top for the family.
 *
 *   caregiverCents  — what the caregiver must receive, exactly
 *   platformFeeCents = round(caregiverCents × feePercent / 100)
 *   familyTotalCents = caregiverCents + platformFeeCents
 *
 * Why this file exists: until v1.107.0 the pre-shift hold (accountability.js) priced a visit
 * fee-INSIDE — it held rate × time and took the 20% out of that — while auto-pay and checkout
 * (payments.js) priced it fee-ON-TOP. The same visit settled two different ways, and on a
 * partial capture Stripe kept the full hold-time fee, so the caregiver lost more than 20%.
 * It happened on a real visit: Sep 14, $176 captured, $38.40 fee, $137.60 to the caregiver.
 *
 * Deliberately pure apart from the fee-percent read, so it can be tested without Stripe.
 */
const { getPlatformFeePercent } = require("./platformFee");

function priceFromCaregiverCents(caregiverCents, feePercent) {
  const cg = Math.max(0, Math.round(Number(caregiverCents) || 0));
  const pct = Number.isFinite(Number(feePercent)) ? Number(feePercent) : 0;
  const platformFeeCents = Math.round(cg * pct / 100);
  return { caregiverCents: cg, platformFeeCents, familyTotalCents: cg + platformFeeCents, feePercent: pct };
}

async function familyChargeFor(db, caregiverCents) {
  const feePercent = await getPlatformFeePercent(db);
  return priceFromCaregiverCents(caregiverCents, feePercent);
}

/**
 * How to settle a visit against an existing authorization hold.
 *
 * The hold may be smaller than what is now owed — overtime, or a hold placed before v1.107.0
 * that did not include the fee. The caregiver must still receive exactly `caregiverCents`.
 *
 *   captureCents        — taken from the hold (never more than was authorized)
 *   captureFeeCents     — application fee on that capture = whatever of it is not hers
 *   remainderCents      — still owed by the family, charged as a second PaymentIntent
 *   remainderToCaregiver— the part of the remainder that is hers (hold was short of her pay)
 */
function planCapture({ caregiverCents, platformFeeCents, authorizedCents }) {
  const familyTotal = caregiverCents + platformFeeCents;
  const authorized = Math.max(0, Math.round(Number(authorizedCents) || 0));
  const captureCents = Math.min(familyTotal, authorized);
  const captureFeeCents = Math.max(0, captureCents - caregiverCents);
  const remainderCents = familyTotal - captureCents;
  const remainderToCaregiver = Math.max(0, caregiverCents - captureCents);
  return { captureCents, captureFeeCents, remainderCents, remainderToCaregiver };
}

/**
 * v1.108.1 — a tip after the visit is paid. Pete (9/17): "Tip + Stripe fee only" — the
 * caregiver receives the whole tip, the family also covers the card fee, and InPlace keeps
 * nothing. Grossed up so that after Stripe's 2.9% + 30¢ on the total, what is left is the tip:
 *   total = ceil((tip + 30) / (1 − 0.029));  fee = total − tip
 * The client shows the same total (Dashboard.js tipCardTotal); a test pins the two together.
 */
const CARD_PCT = 0.029;
const CARD_FIXED_CENTS = 30;
function tipWithCardFee(tipCents) {
  const tip = Math.max(0, Math.round(Number(tipCents) || 0));
  if (!tip) return { tipCents: 0, feeCents: 0, totalCents: 0 };
  const totalCents = Math.ceil((tip + CARD_FIXED_CENTS) / (1 - CARD_PCT));
  return { tipCents: tip, feeCents: totalCents - tip, totalCents };
}

module.exports = { priceFromCaregiverCents, familyChargeFor, planCapture, tipWithCardFee };
