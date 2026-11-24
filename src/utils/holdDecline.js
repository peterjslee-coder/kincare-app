// ─── When the card hold is declined (v1.117.0) ───
//
// Oct 5, 7:00 AM: the 24-hour hold for Tina's Oct 6 visit with Betty was declined — Sara's
// debit card, insufficient funds. Three things went wrong after that, and only luck kept Tina
// from working an unpaid shift:
//
//  1. Nobody who could fix it was told. A decline alerted admins only (one push; the email was
//     off by default), and the payer heard nothing — the payer was only ever told when there
//     was NO card at all. Pete: "i don't recall seeing any warnings or notifications".
//  2. Retrying could not work. The poller re-ran every minute with the SAME idempotency key, and
//     Stripe replays a cached decline for 24 hours. Had Sara moved money in that afternoon,
//     nothing would have changed until the key expired the next morning — two hours before the
//     visit, which is when it happened to go through.
//  3. The only fix on offer anywhere was "add a payment method".
//
// Pete, 10/14: "the most likely course of action will be sara checks her debit card, transfers
// money in, and then we try again. so the fix can't just be 'add another card' there needs to
// be a 'try that card again' option."
//
// So: a decline is recorded on the visit (which card, why, when), the payer and the person who
// booked are told once in plain words with "Try the card again" one tap away, and every real
// retry gets a fresh idempotency key — but only a DECLINE advances it. A timeout or a network
// error keeps the old key, so a hold Stripe placed but we never heard about is replayed, never
// doubled.
//
// Card networks penalise hammering a declined card (Visa allows 15 retries per 30 days), so
// the automatic retry is every AUTO_RETRY_MS and capped; a person tapping "Try again" is not
// capped, only spaced by MANUAL_GAP_MS so a double tap is one attempt.

const AUTO_RETRY_MS = 3 * 60 * 60 * 1000;   // the poller retries the same card every 3 hours
const AUTO_RETRY_CAP = 6;                    // …at most this many declines before it stops trying on its own
const MANUAL_GAP_MS = 60 * 1000;             // "Try again" is one attempt per minute

/** What the bank said, in words a family member would use. Never Stripe's prose. */
function declineReason(code) {
  switch (code) {
    case "insufficient_funds":
      return "there wasn't enough money on it";
    case "expired_card":
      return "the card has expired";
    case "card_velocity_exceeded":
    case "withdrawal_count_limit_exceeded":
      return "it's over its spending limit";
    case "authentication_required":
      return "the bank wants to confirm the charge first";
    case "lost_card":
    case "stolen_card":
    case "pickup_card":
    case "restricted_card":
      return "the bank has blocked this card";
    case "incorrect_cvc":
    case "incorrect_number":
    case "invalid_cvc":
    case "invalid_expiry_month":
    case "invalid_expiry_year":
      return "the card details don't match the bank's";
    default:
      return "the bank declined it";
  }
}

/** Whether trying the same card again could ever work. */
function retryCanHelp(code) {
  return !["expired_card", "lost_card", "stolen_card", "pickup_card", "restricted_card",
    "incorrect_cvc", "incorrect_number", "invalid_cvc", "invalid_expiry_month", "invalid_expiry_year"].includes(code);
}

/** "Visa ending 2293" / "bank account ending 6789". */
function cardLabel(pm) {
  if (!pm) return "the card on file";
  if (pm.type === "us_bank_account") return pm.last4 ? `bank account ending ${pm.last4}` : "the bank account on file";
  if (pm.type === "link") return "the Link wallet on file";
  const brand = pm.brand && pm.brand !== "card"
    ? String(pm.brand).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
    : "Card";
  return pm.last4 ? `${brand} ending ${pm.last4}` : `${brand} on file`;
}

/** A Stripe error that is the bank saying no — the only kind that may advance the key. */
function isDecline(err) {
  return !!err && (err.type === "StripeCardError" || err.rawType === "card_error" || err.code === "card_declined");
}

/** The decline code Stripe gives, most specific first. */
function declineCode(err) {
  return (err && (err.decline_code || (err.raw && err.raw.decline_code) || err.code)) || "card_declined";
}

/**
 * Should the hold be attempted now? `session` carries the hold_* columns; `pmId` is the
 * payment method the resolver picked. A different card than the one declined always goes.
 * @returns {null | "wait" | "too_soon"}  null = go ahead
 */
function retryBlock(session, pmId, { manual = false, now = Date.now() } = {}) {
  if (!session || !session.hold_failed_at) return null;
  if (session.hold_failed_pm && pmId && session.hold_failed_pm !== pmId) return null;
  const last = session.hold_last_attempt_at ? new Date(session.hold_last_attempt_at).getTime() : 0;
  const since = now - last;
  if (manual) return since < MANUAL_GAP_MS ? "too_soon" : null;
  if (!retryCanHelp(session.hold_failure_code)) return "wait";
  if ((Number(session.hold_attempts) || 0) >= AUTO_RETRY_CAP) return "wait";
  return since < AUTO_RETRY_MS ? "wait" : null;
}

/** The sentence a person reads when a hold is declined. */
function declineSentence({ card, code }) {
  const why = declineReason(code);
  const next = retryCanHelp(code)
    ? "Once that's sorted, try it again — or use a different card."
    : "Please use a different card.";
  return `${card ? card.charAt(0).toUpperCase() + card.slice(1) : "The card"} was declined — ${why}. ${next}`;
}

/**
 * Tell the payer, and whoever booked the visit if that is someone else, once per visit.
 * Push + email: a declined card is money, and money is not left to a push nobody saw.
 */
async function notifyHoldDeclined(db, s, { card, code, hoursUntil }) {
  const { sendPushToUser } = require("../routes/push");
  const who = s.caregiver_first || "Your caregiver";
  const forWhom = s.recipient_first_name ? ` with ${s.recipient_first_name}` : "";
  const when = hoursUntil != null
    ? (hoursUntil < 1 ? "in under an hour" : hoursUntil < 20 ? `in about ${Math.round(hoursUntil)} hours` : "tomorrow")
    : "soon";
  const why = declineReason(code);
  const body = `${who}'s visit${forWhom} is ${when}, and ${card} was declined — ${why}. `
    + (retryCanHelp(code) ? "Once that's sorted, tap to try it again." : "Tap to use a different card.");
  const recipients = [...new Set([s.billing_user_id || s.family_user_id, s.family_user_id].filter(Boolean))];
  for (const userId of recipients) {
    sendPushToUser(userId, {
      title: "Card declined — visit not paid for yet",
      body,
      data: { type: "hold_declined", sessionId: s.id, focus: `holdDeclined:${s.id}`, page: "dashboard" },
    }, "payment_hold").catch(() => {});
  }
  try {
    const { sendEmail, brandedHtml } = require("./email");
    const users = await db.prepare(
      `SELECT id, email, first_name FROM users WHERE id IN (${recipients.map(() => "?").join(", ")}) AND COALESCE(is_demo, 0) = 0`
    ).all(...recipients);
    for (const u of users) {
      if (!u.email) continue;
      sendEmail({
        to: u.email,
        subject: "Card declined — your InPlace visit isn't paid for yet",
        html: brandedHtml({
          title: "Card declined",
          greeting: `Hi ${u.first_name || "there"},`,
          body: `${body.replace("tap to", "open InPlace to")} Nothing has been charged. The visit stays booked, but it can't start until the card goes through.`,
          ctaUrl: `https://yourinplace.com/?page=dashboard&focus=${encodeURIComponent(`holdDeclined:${s.id}`)}`,
          ctaText: retryCanHelp(code) ? "Try the card again" : "Use a different card",
        }),
      }).catch(() => {});
    }
  } catch (e) {
    try { require("./sentry").captureException(e, { where: "holdDecline: email", sessionId: s.id }); } catch { /* ignore */ }
  }
}

module.exports = {
  AUTO_RETRY_MS, AUTO_RETRY_CAP, MANUAL_GAP_MS,
  declineReason, retryCanHelp, cardLabel, isDecline, declineCode, retryBlock, declineSentence,
  notifyHoldDeclined,
};
