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

// Build the single, final-state push from the reimbursement row. Returns null
// when there is nothing worth saying (still pending, or cancelled).
function composeDigest(r, actorFirstName) {
  const amt = `$${Number(r.amount).toFixed(2)}`;
  const who = actorFirstName || "The billing contact";
  const desc = r.description ? ` for "${r.description}"` : "";
  const base = { reimbursementId: r.id, careTeamId: r.care_team_id, page: "care-team", focus: `reimbursement:${r.id}` };

  if (r.status === "declined") {
    return {
      title: "Reimbursement declined",
      body: `${who} declined your ${amt} reimbursement${desc}${r.declined_reason ? ` — ${r.declined_reason}` : ""}.`,
      data: { ...base, type: "reimbursement_declined" },
    };
  }
  if (r.status === "paid") {
    if (r.paid_method === "ach_inplace") {
      if (r.payout_status === "succeeded") {
        return {
          title: "Reimbursement confirmed",
          body: `${who} approved and paid your ${amt}${desc} — it's confirmed and heading to your bank (usually a couple business days).`,
          data: { ...base, type: "reimbursement_paid" },
        };
      }
      return {
        title: "Reimbursement approved & paid",
        body: `${who} approved and paid your ${amt}${desc} through InPlace — on its way to your bank (1–3 business days).`,
        data: { ...base, type: "reimbursement_paid" },
      };
    }
    const method = r.paid_method === "bank" ? "bank transfer (ACH)" : (r.paid_method || "another method");
    return {
      title: "Reimbursement approved & paid",
      body: `${who} approved and paid your ${amt}${desc} via ${method}.`,
      data: { ...base, type: "reimbursement_paid" },
    };
  }
  if (r.status === "approved") {
    return {
      title: "Reimbursement approved",
      body: `${who} approved your ${amt}${desc} — awaiting payment.`,
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
      const r = await db.prepare("SELECT * FROM reimbursements WHERE id = ?").get(d.reimbursement_id);
      if (!r) continue;
      const actorId = r.paid_by || r.approved_by;
      let actor = null;
      if (actorId) actor = await db.prepare("SELECT first_name FROM users WHERE id = ?").get(actorId);
      const msg = composeDigest(r, actor && actor.first_name);
      if (!msg) continue;
      await sendPushToUser(d.user_id, { title: msg.title, body: msg.body, data: msg.data }, msg.data.type);
    } catch (e) {
      captureException(e, { where: "reimbursementDigest: sweep-item" });
    }
  }
  return claimed.length;
}

module.exports = { enqueueReimbursementDigest, sweepReimbursementDigests, composeDigest };
