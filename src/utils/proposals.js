/**
 * The proposal lifecycle. (v1.106.16)
 *
 * Lived inside routes/sessions.js — a 4,056-line Express router with 33 routes — and was
 * required OUT of it by dashboard.js and server.js. Sweeping expired proposals therefore
 * meant loading the entire sessions router and everything it pulls in, to call one function
 * that touches two tables and takes no request.
 *
 * See utils/retention.js for the same shape done right. Behaviour is unchanged; only the
 * address is.
 */
async function expireStaleProposals(db, emitToUser, sendPushToUserFn) {
  try {
    const expired = await db.prepare(`
      SELECT tp.id, tp.session_id, tp.caregiver_user_id, tp.proposed_date, tp.proposed_time,
        cs.family_user_id, cr.first_name AS recipient_first_name,
        u.first_name AS cg_first_name, u.last_name AS cg_last_name
      FROM time_proposals tp
      JOIN care_sessions cs ON tp.session_id = cs.id
      LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
      LEFT JOIN users u ON tp.caregiver_user_id = u.id
      WHERE tp.status = 'pending' AND tp.expires_at IS NOT NULL AND tp.expires_at < NOW()
      LIMIT 20
    `).all();

    for (const p of expired) {
      await db.prepare("UPDATE time_proposals SET status = 'expired', responded_at = NOW() WHERE id = ?").run(p.id);

      // Notify caregiver that their proposal expired
      const caregiverName = `${p.cg_first_name} ${p.cg_last_name}`;
      if (emitToUser) {
        emitToUser(p.caregiver_user_id, "proposal_expired", { sessionId: p.session_id, proposalId: p.id });
      }
      if (sendPushToUserFn) {
        sendPushToUserFn(p.caregiver_user_id, {
          title: "Time proposal expired",
          body: `Your proposal for ${p.recipient_first_name || 'a care visit'} wasn't responded to in time. The job is back in the open pool.`,
          data: { type: "proposal_expired", sessionId: p.session_id },
        }, "proposal_expired").catch(() => {});
      }
    }
    // Also clean up proposals whose sessions are already confirmed with the proposing caregiver
    // (e.g. family accepted via a different path, or proposal accept partially succeeded)
    const orphaned = await db.prepare(`
      SELECT tp.id, tp.session_id, tp.caregiver_user_id
      FROM time_proposals tp
      JOIN care_sessions cs ON tp.session_id = cs.id
      JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id AND cp.user_id = tp.caregiver_user_id
      WHERE tp.status = 'pending'
        AND cs.status IN ('confirmed', 'in_progress', 'completed')
      LIMIT 20
    `).all();

    for (const p of orphaned) {
      await db.prepare("UPDATE time_proposals SET status = 'accepted', responded_at = NOW() WHERE id = ?").run(p.id);
    }

    // ─── v1.106.13 — the OTHER proposal table, which nothing swept ───
    //
    // time_change_proposals is a request to move an already-booked visit. It had no deadline
    // and no sweeper, and care_sessions.pending_time_change_id was cleared only by an explicit
    // answer. An ignored request therefore blocked every future time change on that session
    // permanently and left an unclearable card in the other party's Needs You feed.
    //
    // Both halves are one transaction for the same reason the propose handler is: expiring the
    // proposal without clearing the pointer leaves the session just as stuck, and clearing the
    // pointer without expiring the proposal orphans a 'pending' row the UI can no longer reach.
    //
    // Terminal sessions are swept too, without waiting for the deadline — there is nothing to
    // answer about a cancelled visit.
    const staleChanges = await db.prepare(`
      SELECT tcp.id, tcp.session_id, tcp.proposed_by, tcp.proposed_by_user_id,
             cs.family_user_id, cp.user_id AS caregiver_user_id,
             cr.first_name AS recipient_first_name
        FROM time_change_proposals tcp
        JOIN care_sessions cs ON cs.id = tcp.session_id
        LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
        LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
       WHERE tcp.status = 'pending'
         AND ((tcp.expires_at IS NOT NULL AND tcp.expires_at < NOW())
              OR cs.status IN ('cancelled', 'completed'))
       LIMIT 20
    `).all();

    for (const c of staleChanges) {
      await db.transaction(async (tx) => {
        await tx.prepare(
          "UPDATE time_change_proposals SET status = 'expired', acknowledged_at = NOW() WHERE id = ? AND status = 'pending'"
        ).run(c.id);
        await tx.prepare(
          "UPDATE care_sessions SET pending_time_change_id = NULL, updated_at = NOW() WHERE id = ? AND pending_time_change_id = ?"
        ).run(c.session_id, c.id);
      });

      // Tell the proposer, so "nothing happened" is not the only signal they get. The visit
      // is unchanged and still on the calendar — say that, because the alternative reading
      // (the visit is off) is the dangerous one.
      if (emitToUser) {
        emitToUser(c.proposed_by_user_id, "time_change_expired", { sessionId: c.session_id, proposalId: c.id });
      }
      if (sendPushToUserFn) {
        sendPushToUserFn(c.proposed_by_user_id, {
          title: "Time change expired",
          body: `Your request to move ${c.recipient_first_name || "the"}'s visit wasn't answered. The visit is unchanged, at its original time.`,
          data: { type: "time_change_expired", sessionId: c.session_id },
        }, "time_change").catch(() => {});
      }
    }

    return expired.length + orphaned.length + staleChanges.length;
  } catch (e) {
    console.log("expireStaleProposals skipped:", e.message);
    return 0;
  }
}

module.exports = { expireStaleProposals };
