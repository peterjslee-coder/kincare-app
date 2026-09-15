// ─── "How is she?" — asked once she has had a chance to look (v1.106.48) ───
//
// Pete: "There needs to be a mechanism to have the caregiver leave feedback on found condition
// 15 minutes after start. We're asking them to declare how the patient is doing before they've
// had a chance to interact when they start their day. A trigger 15 minutes later to ask them
// to return to check-in would be ideal."
//
// He is right that the old question was unanswerable. A caregiver taps check in at the door,
// and the app immediately shows her eight faces and asks which one Betty is — before she has
// taken her coat off. Whatever she picks is a guess, and a guess recorded as an observation is
// worse than no observation, because the family reads it as one.
//
// So the question moves. Check-in asks nothing; fifteen minutes later she is asked once.
//
// The delay lives here alone, because it is the kind of number that gets tuned.
const SETTLED_MINUTES = 15;

/**
 * Visits that should be asked now: checked in, still open, long enough ago, and not yet asked.
 *
 * `condition_prompt_sent_at IS NULL` is what stops a poller running every minute from asking
 * every minute — and it is set whether or not the push succeeds, because the alternative is a
 * caregiver whose phone is off being asked sixty times when she turns it on.
 */
async function visitsDueConditionRead(db, { minutes = SETTLED_MINUTES, limit = 200 } = {}) {
  return db.prepare(`
    SELECT vl.id AS visit_log_id, vl.session_id, vl.check_in_time,
           cs.care_recipient_id, cs.family_user_id,
           cp.user_id AS caregiver_user_id,
           cr.first_name AS recipient_first_name
      FROM visit_logs vl
      JOIN care_sessions cs ON cs.id = vl.session_id
      LEFT JOIN caregiver_profiles cp ON cp.id = vl.caregiver_id
      LEFT JOIN care_recipients cr ON cr.id = cs.care_recipient_id
     WHERE vl.check_out_time IS NULL
       AND vl.condition_prompt_sent_at IS NULL
       AND vl.arrival_mood IS NULL
       AND vl.check_in_time IS NOT NULL
       AND vl.check_in_time <= NOW() - ($1 || ' minutes')::interval
       AND cs.status = 'in_progress'
       -- A test check-in (an admin impersonating) is not a real visit and must not buzz anyone.
       AND COALESCE(vl.is_test, 0) = 0
     ORDER BY vl.check_in_time ASC
     LIMIT $2
  `).all(String(minutes), limit);
}

/**
 * Should the caregiver's own screen be showing her the question right now?
 *
 * Deliberately a different question from the one above, and computed from the same two facts:
 * the push is sent once, but the card must keep offering until she actually answers. A
 * caregiver who swiped the notification away still needs somewhere to say how Betty is.
 */
function conditionReadDue(row, { minutes = SETTLED_MINUTES, now = new Date() } = {}) {
  if (!row || !row.check_in_time) return false;
  if (row.arrival_mood) return false;              // already answered
  if (row.check_out_time) return false;            // visit is over; the check-out asks its own
  const since = (now - new Date(row.check_in_time)) / 60000;
  return Number.isFinite(since) && since >= minutes;
}

module.exports = { SETTLED_MINUTES, visitsDueConditionRead, conditionReadDue };
