/**
 * Which card or bank account do we charge? — one answer, for every money path. (v1.106.11)
 *
 * There are two places that move a family's money: the pre-authorization hold placed ~24h
 * before a shift (routes/accountability.js) and the auto-pay charge after it
 * (routes/payments.js). They resolved the payment method differently, and only one of them
 * was right.
 *
 * Auto-pay listed the customer's payment methods and passed the chosen one. Authorization
 * passed `payment_method: undefined` with the comment "will use customer's default" — which
 * is not a thing Stripe does. A PaymentIntent created with `confirm: true, off_session: true`
 * and no payment_method is rejected with:
 *
 *   "You cannot confirm this PaymentIntent because it's missing a payment method."
 *
 * So the hold never worked for anyone whose Stripe customer had no
 * `invoice_settings.default_payment_method` — which is everyone who added a card through our
 * own setup flow, because we never set that field. The charge after the shift worked, which
 * is why nobody noticed: the money arrived, just a day later than intended, and the
 * pre-authorization alarm fired every minute in between.
 *
 * That is the third time this file's own comments record two money paths disagreeing
 * (v1.105.124 fixed the payer lookup, then the identity gate). This is the resolver that
 * stops the fourth: both paths call it, so they cannot drift again.
 *
 * ACH first on purpose: 0.8% capped at $5 versus 2.9% + 30¢. On a $224 shift that is $1.79
 * instead of $6.80, and the difference comes out of the platform's 20%.
 */

/**
 * @returns {Promise<{id, type, last4, brand, raw} | null>}
 *          null means the customer genuinely has nothing saved — which is a message for the
 *          PAYER ("add a card"), never an error for an engineer.
 */
/**
 * The types we accept, in the order we prefer them.
 *
 * THIS LIST MUST MATCH THE BOOKING GATE. sessions.js lets a family book when they have a
 * card, a Link wallet OR a bank account — and auto-pay then looked only for a bank account
 * or a card. A family whose only saved method is Link passes the gate at booking and cannot
 * be charged afterwards, which is the funnel accepting a customer it will later fail.
 * Anything added to one list goes in the other.
 */
const ACCEPTED_TYPES = ["us_bank_account", "card", "link"];

async function resolvePaymentMethod(stripe, customerId) {
  if (!stripe || !customerId) return null;
  for (const type of ACCEPTED_TYPES) {
    let list;
    // Not every type is enabled on every account or API version; an unsupported type must
    // mean "keep looking", never "this customer has nothing".
    try { list = await stripe.paymentMethods.list({ customer: customerId, type, limit: 1 }); }
    catch { continue; }
    const pm = list?.data?.[0];
    if (pm) {
      const detail = pm[pm.type] || {};
      return {
        id: pm.id,
        type: pm.type,
        last4: detail.last4 || null,
        // What goes on the family's receipt: a card brand, or the bank's name.
        brand: detail.brand || detail.bank_name || pm.type,
        raw: pm,          // the untouched Stripe object, for anything else a caller needs
      };
    }
  }
  return null;
}

/** "ACH bank ending 6789" / "card ending 4242" — for a human, never a raw Stripe id. */
function describePaymentMethod(pm) {
  if (!pm) return "no saved payment method";
  const kind = pm.type === "us_bank_account" ? "ACH bank" : pm.type === "link" ? "Link" : "card";
  return pm.last4 ? `${kind} ending ${pm.last4}` : kind;
}

module.exports = { resolvePaymentMethod, describePaymentMethod, ACCEPTED_TYPES };
