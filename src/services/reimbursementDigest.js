// ─── Reimbursement push coalescing (v1.98.15) ───
// When the approver approves, pays, and the charge confirms in one sitting, the
// requester used to get three separate pushes (approved / paid / confirmed).
// Instead we enqueue a per-(recipient, reimbursement) digest with a rolling
// ~2-minute fire time (debounce): each new event pushes the fire time out, so a
// burst collapses into ONE push that reflects the reimbursement's FINAL state.
// A background sweeper (server.js) sends due digests. Durable across restarts —
// the pending row lives in the DB, not an in-memory timer.
const { v4: uuid } = require("uuid");
const { captureException } = require("../utils/sentry");

const DIGEST_WINDOW = "2 minutes"; // Postgres interval literal

// Enqueue or extend the digest for one recipient + reimbursement. Rolling
// debounce: fire_at is always pushed to now + window on each event.
async function enqueueReimbursementDigest(db, { userId, reimbursementId, careTeamId }) {
  if (!userId || !reimbursementId) return;
  try {
    await db.prepare(`
      INSERT INTO reimbursement_push_digests (id, user_id, reimbursement_id, care_team_id, fire_at)
      VALUES (?, ?, ?, ?, NOW() + INTERVAL '${DIGEST_WINDOW}')
      ON CONFLICT (user_id, reimbursement_id) WHERE sent = 0
      DO UPDATE SET
        fire_at = NOW() + INTERVAL '${DIGEST_WINDOW}',
        care_team_id = COALESCE(EXCLUDED.care_team_id, reimbursement_push_digests.care_team_id)
    `).run(uuid(), userId, reimbursementId, careTeamId || null);
  } catch (e) {
    captureException(e, { where: "reimbursementDigest: enqueue" });
  }
}

// ─── Whose money is it? (v1.105.41) ───
//
// Pete, 8/6: "Sara approved Daniel's request for reimbursement. The push says she
// confirmed MY request for $655."
//
// notifyParties() fans every reimbursement event out to THREE people — the payee, the
// team leader, and the billing contact — but composeDigest() wrote one body that says
// "your" to all of them. Only one of the three is ever the payee. Pete is the leader on
// that team, so he was told he was owed $655 he had never spent.
//
// This is worse than a typo. The whole point of the money ledger is that a family can
// look at it later and agree on who paid for what; a notification that misattributes a
// payment is the app arguing for the wrong answer. So the sentence is now built from the
// reader's relationship to the row, and there are only two cases: you are the payee, or
// you are watching someone else be paid.
//
// AP style: a name already ending in s takes a bare apostrophe.
function possessive(name) {
  if (!name) return "a team member's";
  return /s$/i.test(name) ? `${name}'` : `${name}'s`;
}

// Build the single, final-state push from the reimbursement row, ADDRESSED TO ONE READER.
// Returns null when there is nothing worth saying (still pending, cancelled, or the
// reader is the person who acted).
//
// No description, no decline reason — see v1.105.39. These bodies render on a locked
// phone, and a reimbursement description is routinely "pharmacy — memantine refill".
// Pete's rule: a push says who and what kind, never what. The amount stays, because the
// amount is what makes it worth unlocking for, and money is not PHI.
function composeDigest(r, opts = {}) {
  const { actorFirstName, actorId, payeeFirstName, recipientUserId } = opts;

  // A digest row enqueued by someone else's earlier event can come due AFTER this reader
  // becomes the actor. Telling Sara that Sara approved something is noise at best.
  if (recipientUserId && actorId && recipientUserId === actorId) return null;

  const amt = `$${Number(r.amount).toFixed(2)}`;
  const who = actorFirstName || "The billing contact";
  // The reader is the payee unless we know otherwise. Falling back to "your" would
  // reintroduce exactly the bug above, so an unknown reader gets the third-person form.
  const isPayee = !!recipientUserId && recipientUserId === r.payee_user_id;
  const whose = isPayee ? "your" : possessive(payeeFirstName);
  const theirBank = isPayee ? "your bank" : "their bank";
  const base = { reimbursementId: r.id, careTeamId: r.care_team_id, page: "care-team", focus: `reimbursement:${r.id}` };

  if (r.status === "declined") {
    return {
      title: "Reimbursement declined",
      body: `${who} declined ${whose} ${amt} reimbursement. Tap for details.`,
      data: { ...base, type: "reimbursement_declined" },
    };
  }
  if (r.status === "paid") {
    if (r.paid_method === "ach_inplace") {
      if (r.payout_status === "succeeded") {
        return {
          title: "Reimbursement confirmed",
          body: `${who} approved and paid ${whose} ${amt} — it's confirmed and heading to ${theirBank} (usually a couple business days).`,
          data: { ...base, type: "reimbursement_paid" },
        };
      }
      return {
        title: "Reimbursement approved & paid",
        body: `${who} approved and paid ${whose} ${amt} through InPlace — on its way to ${theirBank} (1–3 business days).`,
        data: { ...base, type: "reimbursement_paid" },
      };
    }
    const method = r.paid_method === "bank" ? "bank transfer (ACH)" : (r.paid_method || "another method");
    return {
      title: "Reimbursement approved & paid",
      body: `${who} approved and paid ${whose} ${amt} via ${method}.`,
      data: { ...base, type: "reimbursement_paid" },
    };
  }
  if (r.status === "approved") {
    return {
      title: "Reimbursement approved",
      body: `${who} approved ${whose} ${amt} — awaiting payment.`,
      data: { ...base, type: "reimbursement_approved" },
    };
  }
  return null; // pending / cancelled — nothing to notify
}

// Sweep due digests and send one coalesced push each. Atomically claims rows
// (UPDATE ... RETURNING) so overlapping sweeps can't double-send.
async function sweepReimbursementDigests() {
  const { getDb } = require("../models/database");
  const { sendPushToUser } = require("../routes/push");
  const db = await getDb();

  const claimed = await db.prepare(`
    UPDATE reimbursement_push_digests SET sent = 1, sent_at = NOW()
    WHERE id IN (
      SELECT id FROM reimbursement_push_digests
      WHERE sent = 0 AND fire_at <= NOW()
      ORDER BY fire_at
      LIMIT 200
    )
    RETURNING *
  `).all();

  for (const d of claimed) {
    try {
      // v1.105.41 — the payee's name comes back with the row, because the body now has
      // to say whose money it is rather than assuming it is the reader's.
      const r = await db.prepare(`
        SELECT rb.*, pu.first_name AS payee_first_name
        FROM reimbursements rb
        LEFT JOIN users pu ON pu.id = rb.payee_user_id
        WHERE rb.id = ?
      `).get(d.reimbursement_id);
      if (!r) continue;
      const actorId = r.paid_by || r.approved_by;
      let actor = null;
      if (actorId) actor = await db.prepare("SELECT first_name FROM users WHERE id = ?").get(actorId);
      const msg = composeDigest(r, {
        actorFirstName: actor && actor.first_name,
        actorId,
        payeeFirstName: r.payee_first_name,
        recipientUserId: d.user_id,
      });
      if (!msg) continue;
      await sendPushToUser(d.user_id, { title: msg.title, body: msg.body, data: msg.data }, msg.data.type);
    } catch (e) {
      captureException(e, { where: "reimbursementDigest: sweep-item" });
    }
  }
  return claimed.length;
}

module.exports = { enqueueReimbursementDigest, sweepReimbursementDigests, composeDigest };
