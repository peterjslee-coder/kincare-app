/**
 * Housekeeping for direct ("Just for You") offers. (v1.106.25)
 *
 * Extracted from poller 102 in server.js so it can be tested against a real database. The two
 * statements decide when a caregiver stops holding work, which for a recurring series is
 * twelve visits at once, and neither had a test — a poller that quietly stops running looks
 * exactly like a poller that has nothing to do.
 *
 * THE SERIES PROPERTY
 *
 * A recurring direct offer writes one row per occurrence, each with its own exclusive_until.
 * They must expire TOGETHER: a series where week 7 goes public while the caregiver is still
 * deciding about week 1 is a standing arrangement quietly turning into a scramble, and
 * nobody is told. That holds today because sessions.js writes the rows inside one
 * db.transaction and Postgres NOW() is the transaction timestamp, so every row gets the
 * identical value — but it holds by ACCIDENT of where the loop sits. Move the inserts out of
 * the transaction and the rows drift apart by however long the loop takes, which is a
 * millisecond in test and could be a second under load, which is enough for one poller tick
 * to take half a series. tests/integration/exclusiveOfferExpiry.itest.js pins it.
 */

/**
 * Private-only requests never open to anyone else; when their date passes they are simply
 * over. Without this they sit "pending" forever on the caregiver's screen.
 */
async function cancelPassedPrivateOffers(db) {
  const r = await db.prepare(`
    UPDATE care_sessions
    SET status = 'cancelled', cancelled_at = NOW(), cancel_reason = 'Private request expired - scheduled date passed'
    WHERE offered_to_caregiver_id IS NOT NULL
      AND COALESCE(private_only, 0) = 1
      AND scheduled_date::date < CURRENT_DATE
      AND status IN ('pending', 'open', 'requested')
  `).run();
  return r.changes || 0;
}

/**
 * A non-private direct offer whose window has passed goes back to the open pool.
 *
 * One statement, so every row of a series that shares an expiry crosses over in the same
 * transaction — there is no tick in which half of it is public and half is not.
 */
async function releaseExpiredExclusiveOffers(db) {
  const r = await db.prepare(`
    UPDATE care_sessions
    SET offered_to_caregiver_id = NULL, exclusive_until = NULL, status = 'open'
    WHERE offered_to_caregiver_id IS NOT NULL
      AND exclusive_until IS NOT NULL
      AND exclusive_until < NOW()
      AND COALESCE(private_only, 0) = 0
      AND status IN ('pending', 'open', 'requested')
  `).run();
  return r.changes || 0;
}

module.exports = { cancelPassedPrivateOffers, releaseExpiredExclusiveOffers };
