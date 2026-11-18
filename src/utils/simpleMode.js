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
const MAX_TEXT = 6;
// v1.130.2 — Pete: "there's only three big buttons for now...if you pick two call buttons, you
// only get one text button." Each call button counts one; Text, Tell the family and Messages
// each count one when ticked.
const MAX_BUTTONS = 3;
function bigButtonCount({ show, callUserIds }) {
  return (show.calls ? callUserIds.length : 0) + (show.text ? 1 : 0) + (show.tellFamily ? 1 : 0) + (show.messages ? 1 : 0);
}

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
  // v1.130.2 — Pete: "I'd like to have a 'Text Button'... add me, sara, and daniel in a group.
  // In my app, I would see her messages in the group. she would only see what she sent, and
  // what the reply was. we would have the whole history."
  text: false,          // the big Text button: a group thread with the people picked
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
  const tIds = v && Array.isArray(v.textUserIds) ? v.textUserIds.filter((x) => typeof x === "string") : [];
  const textConversationId = v && typeof v.textConversationId === "string" ? v.textConversationId : null;
  return {
    on, callUserIds: [...new Set(ids)].slice(0, MAX_CALLS), show: cleanShow(v && v.show), clearedNoteId,
    textUserIds: [...new Set(tIds)].slice(0, MAX_TEXT), textConversationId,
  };
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

  let text = null;
  if (show.text && mode.textConversationId) text = await textScreenFor(db, mode, linkedUserId);

  return { on: true, show, callContacts, comingUp, noteForYou, lastSent, text };
}

// ─── v1.130.2 — the Text button ───
//
// The family sees the whole thread in their Messages. The person sees only their own last
// message and the replies to it — or, if someone in the group wrote first, the newest of that.
// It is one ordinary group conversation, so nothing here is a second copy of a message.
async function textScreenFor(db, mode, linkedUserId) {
  const convId = mode.textConversationId;
  const member = await db.prepare(
    "SELECT last_read_at FROM conversation_members WHERE conversation_id = ? AND user_id = ?"
  ).get(convId, linkedUserId);
  if (!member) return null;
  const people = await db.prepare(`
    SELECT u.id, u.first_name, ${photoSql()}
    FROM conversation_members cm JOIN users u ON u.id = cm.user_id
    WHERE cm.conversation_id = ? AND cm.user_id != ?
    ORDER BY u.first_name
  `).all(convId, linkedUserId);
  const to = people.map((u) => ({ userId: u.id, firstName: u.first_name, photo: photoUrl(u) }));
  const byId = new Map(to.map((t) => [t.userId, t]));

  const mine = await db.prepare(`
    SELECT id, content, created_at FROM messages
    WHERE conversation_id = ? AND sender_id = ? AND COALESCE(is_deleted, 0) = 0
    ORDER BY created_at DESC LIMIT 1
  `).get(convId, linkedUserId);
  const replies = await db.prepare(`
    SELECT id, sender_id, content, created_at FROM messages
    WHERE conversation_id = ? AND sender_id != ? AND COALESCE(is_deleted, 0) = 0
      AND created_at > ?
    ORDER BY created_at ASC LIMIT 6
  `).all(convId, linkedUserId, mine ? mine.created_at : new Date(0).toISOString());
  const shown = mine ? replies : replies.slice(-2);
  const lastRead = member.last_read_at ? new Date(member.last_read_at).getTime() : 0;
  const unread = shown.filter((r) => new Date(r.created_at).getTime() > lastRead).length;

  // v1.133.0 — Pete, 11/18: a message to her "sits on betty's screen until she acknowledges
  // it". Waiting = from someone else and not yet "Got it" (her tap, or her reply). Opening the
  // thread no longer clears it. Newest three, oldest first, so the card reads in order.
  const waitingRows = await db.prepare(`
    SELECT id, sender_id, content, created_at FROM messages
    WHERE conversation_id = ? AND sender_id != ? AND acknowledged_at IS NULL AND COALESCE(is_deleted, 0) = 0
    ORDER BY created_at DESC LIMIT 3
  `).all(convId, linkedUserId);
  const mineAt = mine ? new Date(mine.created_at).getTime() : 0;
  const waiting = waitingRows.reverse().map((r) => {
    const who = byId.get(r.sender_id);
    return {
      id: r.id, content: r.content, createdAt: r.created_at,
      from: who ? who.firstName : "Family", fromPhoto: who ? who.photo : null,
      // "Peter wrote back" only when it answers something she sent; otherwise "Message from Peter"
      isReply: !!mine && new Date(r.created_at).getTime() > mineAt,
    };
  });

  return {
    conversationId: convId,
    to,
    mine: mine ? { id: mine.id, content: mine.content, createdAt: mine.created_at } : null,
    replies: shown.map((r) => {
      const who = byId.get(r.sender_id);
      return { id: r.id, content: r.content, createdAt: r.created_at, from: who ? who.firstName : "Family", fromPhoto: who ? who.photo : null };
    }),
    unread,
    waiting,
  };
}

// Coming up — today and tomorrow only, soonest first. Pete, 11/17: "we don't need more than the
// next day's events... if she had an appointment, it would show like 'Haircut at Angies - 1PM'
// ... That way I can put Church pickup on there and she'll be reminded." Care-location dates and
// times are naive strings (CLAUDE.md timezone principle), so they compare as strings.
function nextDayStr(dateStr) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function comingUpFor(db, recipientId, todayStr) {
  const recipient = { id: recipientId };
  const tomorrowStr = nextDayStr(todayStr);
  const sessions = await db.prepare(`
    SELECT cs.id, cs.scheduled_date AS date, cs.scheduled_time AS time, cs.status,
           u.id AS who_id, u.first_name AS who, ${photoSql()}
    FROM care_sessions cs
    LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
    LEFT JOIN users u ON cp.user_id = u.id
    WHERE cs.care_recipient_id = ? AND cs.scheduled_date >= ? AND cs.scheduled_date <= ?
      AND cs.status IN ('confirmed', 'in_progress')
    ORDER BY cs.scheduled_date ASC, cs.scheduled_time ASC
    LIMIT 8
  `).all(recipient.id, todayStr, tomorrowStr);
  const events = await db.prepare(`
    SELECT id, title, event_date AS date, event_time AS time, location
    FROM care_events
    WHERE care_recipient_id = ? AND is_active = 1 AND event_date >= ? AND event_date <= ?
    ORDER BY event_date ASC, event_time ASC NULLS LAST
    LIMIT 8
  `).all(recipient.id, todayStr, tomorrowStr);
  return [
    ...sessions.map((s) => ({ kind: "visit", id: s.id, date: s.date, time: s.time || null, who: s.who || null, whoPhoto: s.who_id ? photoUrl({ id: s.who_id, has_photo: s.has_photo }) : null, inProgress: s.status === "in_progress" })),
    ...events.map((e) => ({ kind: "appointment", id: e.id, date: e.date, time: e.time || null, title: e.title, location: e.location || null })),
  ]
    .sort((a, b) => (a.date + (a.time || "99:99")).localeCompare(b.date + (b.time || "99:99")))
    .slice(0, 8);
}

module.exports = { MAX_CALLS, MAX_TEXT, MAX_BUTTONS, bigButtonCount, SECTIONS, parseSimpleMode, cleanShow, callCandidates, simpleScreenFor, telDigits };
