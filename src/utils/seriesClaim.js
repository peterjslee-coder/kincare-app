/**
 * Confirm some visits of a recurring series and release the rest, all or nothing. (v1.106.24)
 *
 * Extracted from the route so it can be tested for the thing that matters, which is what it
 * does when a write LOSES. The route-level test can prove the stale-list check (a visit that
 * was already gone when she loaded the card) because that state can be set up in advance. It
 * cannot stage the narrower case — a visit taken between this function's read and its write —
 * without a trigger that deadlocks the pool. Here it is one call, so the losing state can
 * simply be arranged and the rollback observed.
 *
 * The rule: a family told "the month is covered" when only three of four visits are is worse
 * off than a family told to try again. So a single lost write unwinds every confirm AND every
 * release in the same transaction.
 *
 * Throws { status, userMessage } on a lost write; the caller hands those to res.
 */
const CLAIMABLE_SQL = "('requested', 'open', 'pending')";

async function applySeriesClaim(db, { caregiverProfileId, confirmIds, releaseIds = [] }) {
  await db.transaction(async (tx) => {
    for (const id of confirmIds) {
      const applied = await tx.prepare(`
        UPDATE care_sessions
        SET caregiver_id = ?, status = 'confirmed', updated_at = NOW()
        WHERE id = ? AND status IN ${CLAIMABLE_SQL}
      `).run(caregiverProfileId, id);

      // Someone else took it between the caller's read and this write. Conditional UPDATE
      // rather than a re-SELECT: the check and the write are then the same statement, so
      // there is no window between them to lose.
      if (applied.changes === 0) {
        throw Object.assign(new Error("session taken"), {
          status: 409,
          userMessage: "Someone accepted one of those visits just now. Refresh and try again.",
        });
      }
    }

    // The dates she did not pick go back to the open pool now, not when the exclusive window
    // lapses. The family still needs those days covered and their clock to find someone else
    // should start immediately.
    for (const id of releaseIds) {
      await tx.prepare(`
        UPDATE care_sessions
        SET offered_to_caregiver_id = NULL, exclusive_until = NULL, status = 'open', updated_at = NOW()
        WHERE id = ? AND status IN ${CLAIMABLE_SQL}
      `).run(id);
    }
  });
}

module.exports = { applySeriesClaim };
