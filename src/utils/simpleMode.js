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

// v1.130.1 — Pete: "put the thumbnails from the care team next to Sara and Daniel and
// Peter...Same with Tina etc. Faces and names reminders are important." Lazy require: media.js
// is a router module.
const photoSql = () => require("../routes/media").hasPhotoSql("u");
const photoUrl = (u) => require("../routes/media").userPhotoUrl(u);

// ─── v1.130.1 — the leader ticks what is on the screen ───
//
// Pete, 11/17: "I want to be able to tick off what she can see from the care team page. So, I
// can let her have messages (or not). This would be a great place to allow her to leave notes
// about things like feeling shoulder pain, or being hungry."
//
// Defaults are what v1.130.0 showed, so turning this on changes nothing for anyone already on
// it. Messages and Tell-the-family are opt-in: each lets the person reach other people.
const SECTIONS = Object.freeze({
  // Off by default (Pete, 11/17): inside iPhone Assistive Access an app cannot hand a number to
  // the Phone app, so the buttons do nothing there. Back on once the native build can call.
  calls: false,         // the big Call buttons
  comingUp: true,       // visits and appointments
  notesFromFamily: true, // the latest note written TO them
  messages: false,      // their message threads
  tellFamily: false,    // "I'm hungry", "My shoulder hurts" — a note FROM them to the team
});

function parseSimpleMode(text) {
  let v = null;
  try { v = text ? JSON.parse(text) : null; } catch { v = null; }
  const on = !!(v && v.on === true);
  const ids = v && Array.isArray(v.callUserIds) ? v.callUserIds.filter((x) => typeof x === "string") : [];
  // v1.130.1 — Pete: "The note that I leave betty...there's no way to clear it. it just stays
  // there." Clearing records the newest note id it cleared; a NEWER note shows again.
  const clearedNoteId = v && typeof v.clearedNoteId === "string" ? v.clearedNoteId : null;
  return { on, callUserIds: [...new Set(ids)].slice(0, MAX_CALLS), show: cleanShow(v && v.show), clearedNoteId };
}

/** Known section keys only, booleans only; anything missing takes its default. */
function cleanShow(raw) {
  const out = {};
  for (const [k, def] of Object.entries(SECTIONS)) {
    out[k] = raw && typeof raw[k] === "boolean" ? raw[k] : def;
  }
  return out;
}

/** People who may be a call button: the record's owner and its care team, minus the person. */
async function callCandidates(db, recipientId, excludeUserId) {
  const rows = await db.prepare(`
    SELECT DISTINCT u.id, u.first_name, u.last_name, u.phone, ${photoSql()}
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
      photo: photoUrl(r),
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

  const show = mode.show;
  // A section that is ticked off is not just hidden on the phone — its data never leaves the
  // server, so nothing the leader turned off is sitting in the payload.
  let callContacts = [];
  if (show.calls) {
    const candidates = await callCandidates(db, recipient.id, linkedUserId);
    const byId = new Map(candidates.map((c) => [c.userId, c]));
    callContacts = mode.callUserIds
      .map((id) => byId.get(id))
      .filter((c) => c && c.phone)
      .map((c) => ({ userId: c.userId, firstName: c.firstName, phone: c.phone, photo: c.photo }));
  }

  let comingUp = [];
  if (show.comingUp) comingUp = await comingUpFor(db, recipient.id, todayStr);

  let noteForYou = null;
  if (show.notesFromFamily) {
    const note = await db.prepare(`
      SELECT rn.id, rn.content, rn.created_at, rn.read_at, u.id AS author_id, u.first_name AS author_first_name, ${photoSql()}
      FROM recipient_notes rn JOIN users u ON rn.author_id = u.id
      WHERE rn.care_recipient_id = ? AND rn.note_type = 'for_recipient'
      ORDER BY rn.created_at DESC LIMIT 1
    `).get(recipient.id);
    // v1.130.1 — Pete: "just have her click on the message to clear it." Tapping I read it
    // takes it off her screen; the leader still sees when it was read.
    if (note && note.id !== mode.clearedNoteId && !note.read_at) {
      noteForYou = { id: note.id, content: note.content, createdAt: note.created_at, from: note.author_first_name, fromPhoto: photoUrl({ id: note.author_id, has_photo: note.has_photo }) };
    }
  }

  let lastSent = null;
  if (show.tellFamily) {
    const mine = await db.prepare(`
      SELECT id, content, created_at FROM recipient_notes
      WHERE care_recipient_id = ? AND note_type = 'from_recipient' AND author_id = ?
      ORDER BY created_at DESC LIMIT 1
    `).get(recipient.id, linkedUserId);
    if (mine) lastSent = { id: mine.id, content: mine.content, createdAt: mine.created_at };
  }

  return { on: true, show, callContacts, comingUp, noteForYou, lastSent };
}

// Coming up — the next few visits and appointments, soonest first. Care-location dates and
// times are naive strings (CLAUDE.md timezone principle), so they sort as strings.
async function comingUpFor(db, recipientId, todayStr) {
  const recipient = { id: recipientId };
  const sessions = await db.prepare(`
    SELECT cs.id, cs.scheduled_date AS date, cs.scheduled_time AS time, cs.status,
           u.id AS who_id, u.first_name AS who, ${photoSql()}
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
  return [
    ...sessions.map((s) => ({ kind: "visit", id: s.id, date: s.date, time: s.time || null, who: s.who || null, whoPhoto: s.who_id ? photoUrl({ id: s.who_id, has_photo: s.has_photo }) : null, inProgress: s.status === "in_progress" })),
    ...events.map((e) => ({ kind: "appointment", id: e.id, date: e.date, time: e.time || null, title: e.title, location: e.location || null })),
  ]
    .sort((a, b) => (a.date + (a.time || "99:99")).localeCompare(b.date + (b.time || "99:99")))
    .slice(0, 3);
}

module.exports = { MAX_CALLS, SECTIONS, parseSimpleMode, cleanShow, callCandidates, simpleScreenFor, telDigits };
