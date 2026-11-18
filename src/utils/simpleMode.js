// ─── The care recipient's simple phone screen (v1.130.0) ───
//
// Pete, 11/17: "simple, accessibility mode accessed things like 'call peter' and reminders that
// appointments are coming up, or notes from me on app like 'I will be there at 10. Stay in the
// house'." He also asked that it conform to the roles the managing family member has set.
//
// The setting lives on the care RECORD (care_recipients.simple_mode), written only by the care
// team leader, so the person cannot switch it off from their own phone and nothing on their
// account (accessibility_prefs, which they can edit) can undo it.
//
// Shape: { on: boolean, callUserIds: string[] } — up to MAX_CALLS people, each of whom must be
// on the care team (or own the record) when the screen is drawn. Someone removed from the team
// silently drops off the call buttons; a stale id is never dialled.

const MAX_CALLS = 3;

function parseSimpleMode(text) {
  let v = null;
  try { v = text ? JSON.parse(text) : null; } catch { v = null; }
  const on = !!(v && v.on === true);
  const ids = v && Array.isArray(v.callUserIds) ? v.callUserIds.filter((x) => typeof x === "string") : [];
  return { on, callUserIds: [...new Set(ids)].slice(0, MAX_CALLS) };
}

/** People who may be a call button: the record's owner and its care team, minus the person. */
async function callCandidates(db, recipientId, excludeUserId) {
  const rows = await db.prepare(`
    SELECT DISTINCT u.id, u.first_name, u.last_name, u.phone
    FROM users u
    WHERE COALESCE(u.is_active, 1) = 1 AND u.id IN (
      SELECT family_user_id FROM care_recipients WHERE id = ?
      UNION
      SELECT ctm.user_id FROM care_team_members ctm
      JOIN care_teams ct ON ctm.care_team_id = ct.id
      WHERE ct.care_recipient_id = ?
    )
  `).all(recipientId, recipientId);
  return rows
    .filter((r) => r.id !== excludeUserId)
    .map((r) => ({
      userId: r.id,
      firstName: r.first_name,
      lastName: r.last_name,
      phone: telDigits(r.phone),
    }));
}

/** A dialable string: digits, with a leading + kept. Null when there is nothing to dial. */
function telDigits(phone) {
  if (!phone) return null;
  const s = String(phone).trim();
  const plus = s.startsWith("+");
  const d = s.replace(/\D/g, "");
  if (d.length < 7) return null;
  return (plus ? "+" : "") + d;
}

/**
 * Everything the simple screen draws, for the linked person.
 * @param recipient  the care_recipients row (needs id, simple_mode, timezone)
 * @param linkedUserId  the person's own account
 * @param todayStr  YYYY-MM-DD in the care location's zone
 */
async function simpleScreenFor(db, recipient, linkedUserId, todayStr) {
  const mode = parseSimpleMode(recipient.simple_mode);
  if (!mode.on) return { on: false };

  const candidates = await callCandidates(db, recipient.id, linkedUserId);
  const byId = new Map(candidates.map((c) => [c.userId, c]));
  const callContacts = mode.callUserIds
    .map((id) => byId.get(id))
    .filter((c) => c && c.phone)
    .map((c) => ({ userId: c.userId, firstName: c.firstName, phone: c.phone }));

  // Coming up — the next few visits and appointments, soonest first. Care-location dates and
  // times are naive strings (CLAUDE.md timezone principle), so they sort as strings.
  const sessions = await db.prepare(`
    SELECT cs.id, cs.scheduled_date AS date, cs.scheduled_time AS time, cs.status,
           u.first_name AS who
    FROM care_sessions cs
    LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
    LEFT JOIN users u ON cp.user_id = u.id
    WHERE cs.care_recipient_id = ? AND cs.scheduled_date >= ?
      AND cs.status IN ('confirmed', 'in_progress')
    ORDER BY cs.scheduled_date ASC, cs.scheduled_time ASC
    LIMIT 4
  `).all(recipient.id, todayStr);
  const events = await db.prepare(`
    SELECT id, title, event_date AS date, event_time AS time, location
    FROM care_events
    WHERE care_recipient_id = ? AND is_active = 1 AND event_date >= ?
    ORDER BY event_date ASC, event_time ASC NULLS LAST
    LIMIT 4
  `).all(recipient.id, todayStr);
  const comingUp = [
    ...sessions.map((s) => ({ kind: "visit", id: s.id, date: s.date, time: s.time || null, who: s.who || null, inProgress: s.status === "in_progress" })),
    ...events.map((e) => ({ kind: "appointment", id: e.id, date: e.date, time: e.time || null, title: e.title, location: e.location || null })),
  ]
    .sort((a, b) => (a.date + (a.time || "99:99")).localeCompare(b.date + (b.time || "99:99")))
    .slice(0, 3);

  const note = await db.prepare(`
    SELECT rn.id, rn.content, rn.created_at, u.first_name AS author_first_name
    FROM recipient_notes rn JOIN users u ON rn.author_id = u.id
    WHERE rn.care_recipient_id = ? AND rn.note_type = 'for_recipient'
    ORDER BY rn.created_at DESC LIMIT 1
  `).get(recipient.id);

  return {
    on: true,
    callContacts,
    comingUp,
    noteForYou: note ? { id: note.id, content: note.content, createdAt: note.created_at, from: note.author_first_name } : null,
  };
}

module.exports = { MAX_CALLS, parseSimpleMode, callCandidates, simpleScreenFor, telDigits };
