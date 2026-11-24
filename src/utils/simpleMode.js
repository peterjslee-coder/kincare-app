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

// ─── v1.152.0 — InPlace Hub: the same screen on a tablet on the kitchen counter ───
//
// Pete, 11/23: a Galaxy Tab A11 on a 3D-printed stand, "a little TV that stays on the counter".
// "Almost look only...but should mimic/compliment what's on mom's app" — so the Hub is not a
// second set of settings for the buttons: it draws the Simple screen's buttons as they are, and
// adds the big date WITH the year, who is here, the week ahead, and faces with names ("Tina and
// a pic of her would be helpful to remind mom of who's who"). The leader turns it on and picks
// what it shows; the tablet shows it when it is held sideways and wide (see SimpleView).
// Lives inside simple_mode as `hub`, so it needs no column and goes with the record.
const HUB_DEFAULTS = Object.freeze({
  on: false,
  faces: true,   // "Who's who": faces and names
  week: true,    // the next seven days, not just today and tomorrow
  photos: true,  // v1.155.0 — photos the team chose to show on the screen
  dimFrom: "21:00", // the screen goes dark with a big clock after this...
  dimTo: "07:00",   // ...and brightens again at this
});
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
// v1.155.1 — Pete: "a 'call Peter' button at the bottom to split the 'text my family' button.
// With thumbnail photo." The Hub's own call buttons, chosen apart from the phone's (a tablet on
// the counter has no dialer, her phone does). Empty = use the phone's Call buttons.
const MAX_HUB_CALLS = 2;
function cleanHub(raw) {
  const out = { ...HUB_DEFAULTS, callUserIds: [] };
  if (raw && typeof raw === "object") {
    for (const k of ["on", "faces", "week", "photos"]) if (typeof raw[k] === "boolean") out[k] = raw[k];
    for (const k of ["dimFrom", "dimTo"]) if (typeof raw[k] === "string" && HHMM.test(raw[k])) out[k] = raw[k];
    if (Array.isArray(raw.callUserIds)) {
      out.callUserIds = [...new Set(raw.callUserIds.filter((x) => typeof x === "string" && x.length <= 64))].slice(0, MAX_HUB_CALLS);
    }
  }
  return out;
}

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
  // v1.153.0 — Call buttons ring the person's InPlace app (Twilio), voice unless the leader
  // picked video. They used to hand a number to the phone's dialer, which a Wi-Fi tablet does
  // not have and Assistive Access would not allow.
  const callType = v && v.callType === "video" ? "video" : "voice";
  return {
    on, callUserIds: [...new Set(ids)].slice(0, MAX_CALLS), show: cleanShow(v && v.show), clearedNoteId,
    textUserIds: [...new Set(tIds)].slice(0, MAX_TEXT), textConversationId,
    hub: cleanHub(v && v.hub),
    callType,
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
      .filter(Boolean)
      // v1.153.0 — an in-app call needs no phone number; `phone` stays for older clients.
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

  // v1.152.0 — the Hub's extra pieces only travel when the Hub is on.
  let hub = null;
  if (mode.hub.on) hub = await hubScreenFor(db, recipient, linkedUserId, todayStr, mode.hub);

  return { on: true, show, callContacts, callType: mode.callType, comingUp, noteForYou, lastSent, text, hub };
}

// "10:00" + 2.5 h → "12:30". Care-location wall-clock arithmetic on naive strings; a visit that
// runs past midnight just reads as the next morning's time, which is what a clock would say.
function addHours(timeStr, hours) {
  if (!/^\d{1,2}:\d{2}/.test(String(timeStr || ""))) return null;
  const [h, m] = String(timeStr).split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(Number(hours))) return null;
  const total = ((h * 60 + (m || 0) + Math.round(Number(hours) * 60)) % 1440 + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_LONG = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
/** The days a caregiver comes, from their upcoming visits: "Wednesdays", "Mon and Thu", "Mon, Wed, Fri". */
function weekdayLabel(dates) {
  const days = [...new Set(dates.map((d) => new Date(`${d}T12:00:00Z`).getUTCDay()))];
  // Monday first: a week on a kitchen calendar starts on Monday.
  days.sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  if (days.length === 0) return null;
  // v1.153.1 — "Mon, Tue, We…" was cut off on the tablet. Past four days, say it plainly.
  if (days.length === 7) return "Every day";
  if (days.length >= 5) return "Most days";
  if (days.length === 1) return WEEKDAY_LONG[days[0]];
  const short = days.map((d) => WEEKDAY_SHORT[d]);
  if (short.length === 2) return `${short[0]} and ${short[1]}`;
  return short.join(", ");
}

/** When someone comes next, from a care-location date: "Today", "Tomorrow", or the weekday. */
function nextVisitLabel(dateStr, todayStr) {
  if (!dateStr) return "your caregiver";
  if (dateStr === todayStr) return "Today";
  if (dateStr === addDays(todayStr, 1)) return "Tomorrow";
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][new Date(`${dateStr}T12:00:00Z`).getUTCDay()];
}

/** "son" → "your son"; anything longer than a word is shown as the leader wrote it. */
function relationLabel(label) {
  const t = String(label || "").trim();
  if (!t) return null;
  return /^[A-Za-z-]+$/.test(t) ? `your ${t.toLowerCase()}` : t;
}

async function hubScreenFor(db, recipient, linkedUserId, todayStr, hubCfg) {
  const out = { on: true, faces: hubCfg.faces, week: hubCfg.week, showPhotos: hubCfg.photos !== false, photos: [], dimFrom: hubCfg.dimFrom, dimTo: hubCfg.dimTo, today: todayStr, here: null, days: [], people: [] };

  // Who is here right now: a visit in progress today.
  const here = await db.prepare(`
    SELECT cs.scheduled_time, cs.duration_hours, u.id AS who_id, u.first_name AS who, ${photoSql()}
    FROM care_sessions cs
    JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
    JOIN users u ON cp.user_id = u.id
    WHERE cs.care_recipient_id = ? AND cs.status = 'in_progress' AND cs.scheduled_date = ?
    ORDER BY cs.scheduled_time ASC LIMIT 1
  `).get(recipient.id, todayStr);
  if (here) {
    out.here = { firstName: here.who, photo: photoUrl({ id: here.who_id, has_photo: here.has_photo }), until: addHours(here.scheduled_time, here.duration_hours) };
  }

  // Today plus the next six days when "week" is ticked; today and tomorrow otherwise.
  out.days = await comingUpFor(db, recipient.id, todayStr, hubCfg.week ? 7 : 2, 24);

  if (hubCfg.faces) {
    // v1.153.1 — Pete, on the real tablet: "i don't know why Ryan, Peter, and Daniel are there."
    // Who's who is the caregivers coming THIS week (today and the next six days), and nobody
    // else: she knows her sons, and a caregiver with no visit coming is a stranger's face.
    const cgRows = await db.prepare(`
      SELECT u.id, u.first_name, cs.scheduled_date, ${photoSql()}
      FROM care_sessions cs
      JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
      JOIN users u ON cp.user_id = u.id
      WHERE cs.care_recipient_id = ? AND cs.status IN ('confirmed', 'in_progress')
        AND cs.scheduled_date >= ? AND cs.scheduled_date <= ?
      ORDER BY cs.scheduled_date ASC, cs.scheduled_time ASC
    `).all(recipient.id, todayStr, addDays(todayStr, 6));
    const cg = new Map();
    for (const r of cgRows) {
      if (r.id === linkedUserId) continue;
      if (!cg.has(r.id)) cg.set(r.id, { userId: r.id, firstName: r.first_name, photo: photoUrl(r), dates: [], today: false });
      const c = cg.get(r.id);
      c.dates.push(r.scheduled_date);
      if (r.scheduled_date === todayStr) c.today = true;
    }
    // Today's first, then whoever comes most — the order the faces are most likely needed in.
    out.people = [...cg.values()]
      .sort((a, b) => (b.today - a.today) || (b.dates.length - a.dates.length))
      .slice(0, 4)
      // v1.153.2 — the label is when they come NEXT ("Today", "Tomorrow", "Thursday"): short
      // enough for the tablet (a list of weekdays was cut off), and the more useful thing to know.
      .map((c) => ({ userId: c.userId, firstName: c.firstName, photo: c.photo, label: nextVisitLabel(c.dates[0], todayStr), today: c.today }));
  }
  // v1.155.1 — the Hub's own Call buttons, if the leader chose any (care team only, as on the phone).
  out.calls = [];
  if ((hubCfg.callUserIds || []).length) {
    const byId = new Map((await callCandidates(db, recipient.id, linkedUserId)).map((c) => [c.userId, c]));
    out.calls = hubCfg.callUserIds.map((id) => byId.get(id)).filter(Boolean)
      .map((c) => ({ userId: c.userId, firstName: c.firstName, photo: c.photo }));
  }
  // v1.155.0 — photos the team flagged for her screen (utils/hubPhotos.js), newest first.
  if (out.showPhotos) {
    const { hubPhotosFor } = require("./hubPhotos");
    out.photos = await hubPhotosFor(db, recipient.id);
  }
  return out;
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
async function comingUpFor(db, recipientId, todayStr, days = 2, limit = 8) {
  const recipient = { id: recipientId };
  // v1.152.0 — the Hub asks for seven days; the phone keeps today and tomorrow.
  const tomorrowStr = addDays(todayStr, days - 1);
  const sessions = await db.prepare(`
    SELECT cs.id, cs.scheduled_date AS date, cs.scheduled_time AS time, cs.status,
           u.id AS who_id, u.first_name AS who, ${photoSql()}
    FROM care_sessions cs
    LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
    LEFT JOIN users u ON cp.user_id = u.id
    WHERE cs.care_recipient_id = ? AND cs.scheduled_date >= ? AND cs.scheduled_date <= ?
      AND cs.status IN ('confirmed', 'in_progress')
    ORDER BY cs.scheduled_date ASC, cs.scheduled_time ASC
    LIMIT ${Number(limit) | 0}
  `).all(recipient.id, todayStr, tomorrowStr);
  const events = await db.prepare(`
    SELECT id, title, event_date AS date, event_time AS time, location
    FROM care_events
    WHERE care_recipient_id = ? AND is_active = 1 AND event_date >= ? AND event_date <= ?
    ORDER BY event_date ASC, event_time ASC NULLS LAST
    LIMIT ${Number(limit) | 0}
  `).all(recipient.id, todayStr, tomorrowStr);
  return [
    ...sessions.map((s) => ({ kind: "visit", id: s.id, date: s.date, time: s.time || null, who: s.who || null, whoPhoto: s.who_id ? photoUrl({ id: s.who_id, has_photo: s.has_photo }) : null, inProgress: s.status === "in_progress" })),
    ...events.map((e) => ({ kind: "appointment", id: e.id, date: e.date, time: e.time || null, title: e.title, location: e.location || null })),
  ]
    .sort((a, b) => (a.date + (a.time || "99:99")).localeCompare(b.date + (b.time || "99:99")))
    .slice(0, limit);
}

module.exports = { HUB_DEFAULTS, MAX_HUB_CALLS, cleanHub, addHours, weekdayLabel, nextVisitLabel, relationLabel, MAX_CALLS, MAX_TEXT, MAX_BUTTONS, bigButtonCount, SECTIONS, parseSimpleMode, cleanShow, callCandidates, simpleScreenFor, telDigits };
