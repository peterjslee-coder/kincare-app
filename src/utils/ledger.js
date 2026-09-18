// ─── The ledger (v1.109.0) ───
//
// Pete (9/18): "def need payment records with breakdown of all costs and adjustments."
//
// One row per movement of money, written where the money moves, never edited afterwards. The
// `payments` table stayed as it is — it is still written by the two paths that write it today
// — but nothing reads it as the source of truth any more.
//
// `breakdown` is the arithmetic, frozen. It has to be captured at the moment of the charge:
// check-out OVERWRITES estimated_cost and duration_hours with the adjusted values, so a minute
// later there is no way to say what the visit was quoted at, what the breaks took off, or what
// the overtime added.
//
// Every write is best-effort and idempotent: a ledger row must never fail a charge that has
// already happened, and a retried charge (same PaymentIntent) must not produce two rows.
const { v4: uuid } = require("uuid");

const KINDS = ["authorization", "capture", "remainder", "cancel_fee", "tip", "checkout", "autopay", "refund"];

/**
 * @param {object} db    a db or tx handle
 * @param {object} entry {sessionId, careRecipientId, kind, status, familyUserId, caregiverId,
 *                        familyCents, caregiverCents, platformCents, cardFeeCents,
 *                        stripePaymentIntent, breakdown}
 */
async function record(db, entry) {
  try {
    if (!entry || !KINDS.includes(entry.kind)) return null;
    const id = uuid();
    await db.prepare(`
      INSERT INTO ledger_entries
        (id, session_id, care_recipient_id, kind, status, family_user_id, caregiver_id,
         family_cents, caregiver_cents, platform_cents, card_fee_cents, stripe_payment_intent, breakdown)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT DO NOTHING
    `).run(
      id, entry.sessionId || null, entry.careRecipientId || null, entry.kind,
      entry.status || "succeeded", entry.familyUserId || null, entry.caregiverId || null,
      Math.round(entry.familyCents || 0), Math.round(entry.caregiverCents || 0),
      Math.round(entry.platformCents || 0), Math.round(entry.cardFeeCents || 0),
      entry.stripePaymentIntent || null,
      entry.breakdown ? JSON.stringify(entry.breakdown) : null,
    );
    return id;
  } catch (e) {
    try { require("./sentry").captureException(e, { where: "ledger: record", kind: entry && entry.kind }); } catch { /* ignore */ }
    return null;
  }
}

/** The parties on a session, for rows written from paths that only hold an id. */
async function partiesFor(db, sessionId) {
  try {
    const s = await db.prepare(`
      SELECT cs.family_user_id, cs.caregiver_id, cs.care_recipient_id,
             (SELECT ct.billing_user_id FROM care_teams ct
               WHERE ct.care_recipient_id = cs.care_recipient_id AND ct.billing_user_id IS NOT NULL LIMIT 1) AS billing_user_id
        FROM care_sessions cs WHERE cs.id = ?
    `).get(sessionId);
    if (!s) return {};
    return {
      familyUserId: s.billing_user_id || s.family_user_id,
      caregiverId: s.caregiver_id,
      careRecipientId: s.care_recipient_id,
    };
  } catch { return {}; }
}

const money = (cents) => Math.round(cents || 0) / 100;

/**
 * What the family reads: every charge on a visit, itemised, plus the totals.
 * Amounts are dollars, because this is what a receipt renders.
 */
function describe(row) {
  let b = null;
  try { b = row.breakdown ? JSON.parse(row.breakdown) : null; } catch { b = null; }
  const LABELS = {
    authorization: "Hold placed",
    capture: "Visit",
    remainder: "Visit balance",
    cancel_fee: "Late cancellation fee",
    tip: "Tip",
    checkout: "Visit",
    autopay: "Visit",
    refund: "Refund",
  };
  const lines = [];
  if (b) {
    if (b.baseCents) {
      lines.push({
        label: b.hours ? `Care — ${b.hours} h at $${(b.hourlyCents / 100).toFixed(2)}/h` : "Care",
        amount: money(b.baseCents),
      });
    }
    if (b.overtimeCents) lines.push({ label: `Overtime — ${b.overtimeMinutes} min`, amount: money(b.overtimeCents) });
    if (b.breakDeductionCents) lines.push({ label: `Unpaid breaks — ${b.breakMinutes} min`, amount: -money(b.breakDeductionCents) });
    if (b.earlyDepartureCents) lines.push({ label: `Left ${b.earlyMinutes} min early`, amount: -money(b.earlyDepartureCents) });
    if (b.surchargeCents) {
      lines.push({ label: "Short-notice booking", amount: money(b.surchargeCents) });
      if (b.surchargeToCaregiverCents != null) {
        lines.push({ label: `— of which to the caregiver (80%)`, amount: money(b.surchargeToCaregiverCents), sub: true });
      }
    }
    if (b.platformFeeCents) lines.push({ label: `InPlace fee${b.feePercent ? ` (${b.feePercent}%)` : ""}`, amount: money(b.platformFeeCents) });
    if (b.cardFeeCents) lines.push({ label: "Card processing fee", amount: money(b.cardFeeCents) });
    if (b.tipCents) lines.push({ label: "Tip", amount: money(b.tipCents) });
  }
  return {
    id: row.id,
    sessionId: row.session_id,
    kind: row.kind,
    label: LABELS[row.kind] || row.kind,
    status: row.status,
    charged: money(row.family_cents),
    toCaregiver: money(row.caregiver_cents),
    toInPlace: money(row.platform_cents),
    cardFee: money(row.card_fee_cents),
    at: row.created_at,
    lines,
    breakdown: b,
  };
}

/** Every charge on one visit, itemised, with what each party ended up with. */
async function forSession(db, sessionId) {
  const rows = await db.prepare(
    "SELECT * FROM ledger_entries WHERE session_id = ? ORDER BY created_at ASC"
  ).all(sessionId);
  const charges = rows.filter((r) => r.kind !== "authorization" && r.status === "succeeded");
  return {
    entries: rows.map(describe),
    totals: {
      charged: money(charges.reduce((n, r) => n + (r.family_cents || 0), 0)),
      toCaregiver: money(charges.reduce((n, r) => n + (r.caregiver_cents || 0), 0)),
      toInPlace: money(charges.reduce((n, r) => n + (r.platform_cents || 0), 0)),
      cardFees: money(charges.reduce((n, r) => n + (r.card_fee_cents || 0), 0)),
    },
  };
}

module.exports = { record, partiesFor, forSession, describe, KINDS };
