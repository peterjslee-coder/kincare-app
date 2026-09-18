// ─── Taking the money for a finished visit (v1.106.47) ───
//
// Extracted from the check-out handler, unchanged, because a second way to end a visit now
// exists: a care-team member releasing the caregiver with full pay. Two copies of a Stripe
// capture with two copies of the retry-and-alert logic is how the second one quietly stops
// retrying six months from now — and this particular block was itself written to fix exactly
// that shape of silence (v1.105.48, below).
//
// v1.105.48, kept verbatim because it is the reason this is careful:
//
//   A failed capture used to end its life in a console.warn. Not failing check-out over a
//   payment problem is right — the visit happened, and the caregiver should not be held at
//   the door by Stripe. But the session then kept payment_status = 'authorized', and NOTHING
//   retries that state: the auto-pay sweeper takes only NULL or 'pending' (payments.js), and
//   the family lockout banner fires only on 'failed'. So the money never moved — caregiver
//   never paid, family never charged, no dunning, no banner, nothing in Sentry — and the
//   authorization quietly expired about a week later. Nobody was positioned to notice.
//
// So a failure hands the session to the retry path AND raises an alert, and never blocks the
// caller. Dev Rule #7: test mode captures nothing and waives instead, because Stripe is live.
const { captureException } = require("./sentry");

/**
 * @param {string} where     tag for the log and for Sentry — "checkout" or "release"
 * @param {boolean} testMode true while an admin is impersonating; captures nothing
 * @returns {Promise<{captured: boolean, waived?: boolean, error?: string}>}
 */
async function captureForSession(db, sessionId, amountCents, { where, testMode, settlement }) {
  if (testMode) {
    console.log(`[${where}] TEST MODE — skipping payment capture for session ${sessionId.slice(0, 8)}`);
    // Waive payment and review for test sessions so they don't trigger lockout banners.
    await db.prepare(
      "UPDATE care_sessions SET payment_status = 'waived', review_required = 0, payment_due_at = NULL WHERE id = ?"
    ).run(sessionId);
    return { captured: false, waived: true };
  }

  const failCapture = async (why) => {
    try {
      await db.prepare(`
        UPDATE care_sessions SET payment_status = 'pending'
        WHERE id = ? AND (payment_status = 'authorized' OR payment_status IS NULL)
      `).run(sessionId);
    } catch (e) {
      captureException(e, { where: `${where}: mark capture for retry`, sessionId });
    }
    captureException(new Error(`Session payment capture failed: ${why}`), {
      where: `${where}: capture`, sessionId,
    });
  };

  try {
    // v1.107.0 — amountCents is what the CAREGIVER is owed. captureSessionPay adds the
    // platform fee on top and sets it at capture (utils/pricing), per Pete's fee rule.
    const { captureSessionPay } = require("../routes/accountability");
    const cents = Math.round(amountCents);
    if (cents <= 0) return { captured: false };
    const result = await captureSessionPay(sessionId, cents, settlement || {});
    if (result && result.error === "demo_session_blocked") {
      // v1.107.1 — Dev Rule #7 working as intended, not a failure to retry. Marking it
      // 'pending' handed a demo visit to the auto-pay sweep.
      return { captured: false, error: result.error };
    }
    if (result && result.error) {
      console.warn(`[${where}] Payment capture skipped: ${result.error}`);
      await failCapture(result.error);
      return { captured: false, error: result.error };
    }
    return { captured: true };
  } catch (err) {
    // Still non-blocking for the caller — but no longer invisible.
    console.error(`[${where}] Payment capture error (non-blocking):`, err.message);
    await failCapture(err.message);
    return { captured: false, error: err.message };
  }
}

module.exports = { captureForSession };
