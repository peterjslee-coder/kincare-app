// ─── Change a whole series (v1.139.0) ───
//
// Pete, 11/18 (feedback 316aeee2): "I want the option to update details of a series of
// appointments, including pay offered. Would require sending a change to whoever had already
// accepted the appointment." And 11/20, when she says no: "She keeps it at the old rate."
//
// From one visit on, every later visit in the same recurrence group that hasn't started:
//   • nobody has taken it yet → changed now (it's still the family's own request);
//   • a caregiver has accepted it → ONE request to that caregiver for all of hers. She accepts
//     and they all change, or she keeps them exactly as they are — time, length and pay.
// What can change: start time, length, hourly pay, instructions. The day of the week is not
// here: moving days is "Change visit" one at a time, or cancel-and-rebook.
//
// Money follows the rules already in the codebase: the caregiver is paid rate × time, so a new
// rate or length rewrites agreed_rate/proposed_rate and estimated_cost (what the hold and the
// capture use — accountability.js, payments.js). A hold already placed at the old amount is
// released so the hold poller places a fresh one at the new amount the day before.

const OPEN = ["requested", "open", "pending"];
const TAKEN = ["confirmed"];

function money(n) {
  const v = Math.round(Number(n) * 100) / 100;
  return Number.isInteger(v) ? `$${v}` : `$${v.toFixed(2)}`;
}

function clock(hhmm) {
  const [h, m] = String(hhmm || "").split(":").map(Number);
  if (!Number.isFinite(h)) return String(hhmm || "");
  return `${h % 12 || 12}${m ? ":" + String(m).padStart(2, "0") : ""} ${h >= 12 ? "PM" : "AM"}`;
}

function hrs(n) {
  const v = Math.round(Number(n) * 100) / 100;
  return `${v} hr`;
}

/** The hourly pay a visit carries now. */
function currentRate(s) {
  if (Number(s.agreed_rate) > 0) return Number(s.agreed_rate);
  if (Number(s.proposed_rate) > 0) return Number(s.proposed_rate);
  const h = Number(s.duration_hours) || 0;
  const base = (Number(s.estimated_cost) || 0) - (Number(s.short_notice_surcharge) || 0);
  return h > 0 && base > 0 ? Math.round((base / h) * 100) / 100 : null;
}

/** Validate a request body into the changes it asks for. Returns {changes} or {error}. */
function normalizeChanges(body) {
  const b = body || {};
  const c = {};
  if (b.time != null && b.time !== "") {
    if (!/^\d{1,2}:\d{2}$/.test(String(b.time))) return { error: "Start time must be HH:MM" };
    const [h, m] = String(b.time).split(":").map(Number);
    if (h > 23 || m > 59) return { error: "Start time must be HH:MM" };
    c.time = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }
  if (b.durationHours != null && b.durationHours !== "") {
    const d = Number(b.durationHours);
    if (!Number.isFinite(d) || d < 0.5 || d > 24) return { error: "Length must be between 30 minutes and 24 hours" };
    c.durationHours = Math.round(d * 4) / 4;
  }
  if (b.rate != null && b.rate !== "") {
    const r = Number(b.rate);
    if (!Number.isFinite(r) || r < 10 || r > 200) return { error: "Hourly pay must be between $10 and $200" };
    c.rate = Math.round(r * 100) / 100;
  }
  if (b.instructions != null) {
    c.instructions = String(b.instructions).slice(0, 2000);
  }
  return { changes: c };
}

/** Drop changes that match what the visit already has. */
function effectiveChanges(changes, s) {
  const c = {};
  if (changes.time && changes.time !== String(s.scheduled_time || "").slice(0, 5)) c.time = changes.time;
  if (changes.durationHours != null && Math.abs(changes.durationHours - (Number(s.duration_hours) || 0)) > 0.001) c.durationHours = changes.durationHours;
  if (changes.rate != null) {
    const r = currentRate(s);
    if (r == null || Math.abs(changes.rate - r) > 0.004) c.rate = changes.rate;
  }
  if (changes.instructions != null && changes.instructions.trim() !== String(s.special_instructions || "").trim()) c.instructions = changes.instructions;
  return c;
}

/** Plain words for a change against a baseline visit: ["9 AM → 10 AM", "$25/hr → $28/hr", …]. */
function describe(changes, s) {
  const out = [];
  if (changes.time) out.push(`Starts ${clock(changes.time)} instead of ${clock(s.scheduled_time)}`);
  if (changes.durationHours != null) out.push(`${hrs(changes.durationHours)} instead of ${hrs(s.duration_hours)}`);
  if (changes.rate != null) {
    const r = currentRate(s);
    out.push(r != null ? `${money(changes.rate)}/hr instead of ${money(r)}/hr` : `${money(changes.rate)}/hr`);
  }
  if (changes.instructions != null) out.push("New instructions");
  return out;
}

/** The new row values for one visit (pure). */
function newValues(s, changes) {
  const hours = changes.durationHours != null ? changes.durationHours : Number(s.duration_hours) || 0;
  const rate = changes.rate != null ? changes.rate : currentRate(s);
  const surcharge = Number(s.short_notice_surcharge) || 0;
  const priceMoves = changes.rate != null || changes.durationHours != null;
  const estimated = priceMoves && rate != null ? Math.round((rate * hours + surcharge) * 100) / 100 : (s.estimated_cost != null ? Number(s.estimated_cost) : null);
  return {
    scheduled_time: changes.time || s.scheduled_time,
    duration_hours: hours,
    special_instructions: changes.instructions != null ? changes.instructions : s.special_instructions,
    rate,
    estimated_cost: estimated,
    priceMoves,
  };
}

/** The series from this visit on, split into taken (by caregiver) and open. */
async function seriesTargets(db, session) {
  if (!session.recurrence_group_id) return { open: [], taken: [] };
  const rows = await db.prepare(`
    SELECT cs.*, cp.user_id AS caregiver_user_id, u.first_name AS caregiver_first, u.last_name AS caregiver_last
      FROM care_sessions cs
      LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
      LEFT JOIN users u ON cp.user_id = u.id
     WHERE cs.recurrence_group_id = ? AND cs.scheduled_date >= ?
       AND cs.status IN (${[...OPEN, ...TAKEN].map(() => "?").join(",")})
       AND NOT EXISTS (SELECT 1 FROM visit_logs vl WHERE vl.session_id = cs.id AND vl.check_in_time IS NOT NULL)
     ORDER BY cs.scheduled_date, cs.scheduled_time
  `).all(session.recurrence_group_id, String(session.scheduled_date).slice(0, 10), ...OPEN, ...TAKEN);
  return {
    open: rows.filter((r) => !r.caregiver_id && OPEN.includes(r.status)),
    taken: rows.filter((r) => r.caregiver_id && TAKEN.includes(r.status)),
  };
}

/** Write the change to visits (inside a transaction). Returns ids whose price moved with a hold to release. */
async function applyTo(tx, rows, changes, { taken }) {
  const releaseHold = [];
  for (const s of rows) {
    const eff = effectiveChanges(changes, s);
    if (!Object.keys(eff).length) continue;
    const v = newValues(s, eff);
    await tx.prepare(`
      UPDATE care_sessions SET
        scheduled_time = ?, duration_hours = ?, special_instructions = ?,
        ${eff.rate != null ? (taken ? "agreed_rate = ?," : "proposed_rate = ?,") : ""}
        estimated_cost = ?, notifications_sent = ${eff.time ? "NULL" : "notifications_sent"}, updated_at = NOW()
      WHERE id = ?
    `).run(...[
      v.scheduled_time, v.duration_hours, v.special_instructions,
      ...(eff.rate != null ? [eff.rate] : []),
      v.estimated_cost, s.id,
    ]);
    if (v.priceMoves && s.stripe_payment_intent_id && s.payment_status === "authorized" && !s.payment_captured_at) {
      releaseHold.push(s.id);
    }
  }
  return releaseHold;
}

/** Release holds placed at the old amount so the poller re-holds at the new one (outside the tx). */
async function releaseHolds(db, ids, captureException) {
  if (!ids.length) return;
  const { voidSessionPayment } = require("../routes/accountability"); // lazy: circular
  for (const id of ids) {
    try {
      const v = await voidSessionPayment(id);
      if (v && v.success) {
        await db.prepare(`
          UPDATE care_sessions SET stripe_payment_intent_id = NULL, payment_status = NULL,
            payment_voided_at = NULL, authorized_amount = NULL
          WHERE id = ? AND payment_status = 'voided'
        `).run(id);
      } else if (captureException) {
        captureException(new Error("series change: hold void failed"), { sessionId: id, error: v && v.error });
      }
    } catch (e) { if (captureException) captureException(e, { where: "series change: release hold", sessionId: id }); }
  }
}

module.exports = {
  OPEN, TAKEN, currentRate, normalizeChanges, effectiveChanges, describe, newValues,
  seriesTargets, applyTo, releaseHolds, clock, money,
};
