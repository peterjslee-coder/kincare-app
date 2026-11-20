// ─── Meds follow the caregiver on shift (v1.138.0) ───
//
// Pete, 11/20 (feedback 3ba9c4f5): "Based on what time I have the meds assigned, I would like it
// to become assigned to a caregiver who was scheduled at that time. So if it's at noon on Monday,
// it's Tina's. If it's at noon on Saturday, it's Kay's." And when nobody is on shift: "it either
// goes unassigned or someone takes it. it just needs to be highlighted that we either have to
// change the meds time where someone can cover, or it goes unassigned."
//
// Derived at READ time, never written: move a visit and the dose moves with it. Precedence:
//   1. a person picked for that one dose (care_task_occurrences.assigned_user_id) — "tonight's person"
//   2. the caregiver on shift at the dose's time
//   3. the task's default person (care_tasks.assigned_user_id)
// All times are care-location times (CLAUDE.md): scheduled_date/scheduled_time are naive text in
// her zone, and so are a task's due times, so they compare directly as minutes.

const COVERING = ["confirmed", "accepted", "in_progress", "completed"];

function toMin(hhmm) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || ""));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function dayDiff(a, b) {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);
}

/**
 * Pure: the session covering `timeStr` on `dateStr`, or null. Sessions may start the day
 * before (an overnight). When two overlap, the one that started later is the one there now.
 */
function coveringSession(sessions, dateStr, timeStr) {
  const t = toMin(timeStr);
  if (t == null) return null;
  let best = null;
  let bestStart = -Infinity;
  for (const s of sessions || []) {
    if (!s.caregiver_user_id) continue;
    if (s.status && !COVERING.includes(s.status)) continue;
    const st = toMin(s.scheduled_time);
    if (st == null) continue;
    const start = st - dayDiff(dateStr, s.scheduled_date) * 1440;
    const end = start + Math.round((Number(s.duration_hours) || 0) * 60);
    if (t >= start && t < end && start > bestStart) { best = s; bestStart = start; }
  }
  return best;
}

function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Visits with a caregiver for one recipient over [from - 1 day, to]. */
async function shiftSessions(db, recipientId, fromDate, toDate = fromDate) {
  return db.prepare(`
    SELECT cs.id, cs.scheduled_date, cs.scheduled_time, cs.duration_hours, cs.status,
           cp.user_id AS caregiver_user_id, u.first_name AS caregiver_first
      FROM care_sessions cs
      JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
      JOIN users u ON u.id = cp.user_id
     WHERE cs.care_recipient_id = ?
       AND cs.scheduled_date >= ? AND cs.scheduled_date <= ?
       AND cs.status IN (${COVERING.map(() => "?").join(",")})
  `).all(recipientId, addDays(fromDate, -1), toDate, ...COVERING);
}

/**
 * Apply rule 2 to a list of occurrence rows (the /today shape: occ_assigned_user_id is the
 * per-dose pick, task_assigned_user_id the default, occ_time the dose's time). Only medication.
 */
function applyShift(occurrences, sessions, dateStr) {
  return (occurrences || []).map((o) => {
    if (o.task_type !== "medication" || o.occ_assigned_user_id) return o;
    const s = coveringSession(sessions, o.due_date || dateStr, o.occ_time);
    if (!s) return { ...o, on_shift: false };
    return {
      ...o,
      assigned_user_id: s.caregiver_user_id,
      assignee_first_name: s.caregiver_first,
      on_shift: true,
      shift_session_id: s.id,
    };
  });
}

module.exports = { coveringSession, applyShift, shiftSessions, addDays, toMin, COVERING };
