/**
 * Care Events — situational awareness for the care team (v1.100.0).
 *
 * "Betty has cardiology with Dr. Patel Tuesday at 2pm." Sara books the
 * appointment; the team should just *know*. Events render inline in the
 * dashboard's Next Up (no digging), family members get a day-before and a
 * same-day nudge, and every event exports to the user's OWN calendar with
 * one tap (.ics / Google Calendar link).
 *
 * Deliberate non-goals (see Care_Events_Plan_2026-07-22.md):
 *  - NOT a calendar: no month grid, no recurrence (recurring = care_tasks),
 *    no Google/Apple sync. Next Up is the surface; export is the bridge.
 *  - NOT a task: no escalation, no "missed", no check-off. Awareness only.
 *
 * Phase 2 (email-forward-to-iPAi via Resend Inbound) writes into this same
 * table with source='email' — nothing here changes for it.
 */
const express = require("express");
const crypto = require("crypto");
const multer = require("multer");
const { v4: uuid } = require("uuid");
const { getDb } = require("../models/database");
const { authenticate } = require("../middleware/auth");
const { captureException } = require("../utils/sentry");
const { getTodayStringInZone } = require("../utils/timezone");
const { hasAccess, canManage, canScheduleEvents, accessibleRecipients, teamUserIds, isFamilyNotifiable } =
  require("./careTasks")._shared;
const {
  CATEGORIES, addDaysToDateString, eventStartInstant,
  validateEventInput, reminderStage, buildIcs,
} = require("../utils/careEventUtils");
const { MODEL_HAIKU, getAnthropic } = require("../utils/aiModels");
const { transcribeAudio, extractAppointmentNotes, TranscriptionError, MAX_AUDIO_BYTES } = require("../utils/transcription");

const router = express.Router();

const DEFAULT_TZ = "America/New_York";
const UPCOMING_DAYS = 14;

// ─── .ics signature (lets the export link work from a share sheet /
// calendar app fetch without a session cookie; event ids are UUIDs, the
// HMAC just closes the enumeration door) ───
function icsSig(eventId) {
  const secret = process.env.JWT_SECRET || process.env.jwt_secret || "inplace-dev-secret";
  return crypto.createHmac("sha256", secret).update(`care-event-ics:${eventId}`).digest("hex").slice(0, 32);
}

function serializeEvent(ev, extra = {}) {
  return {
    ...ev,
    all_day: !ev.event_time,
    ics_url: `/api/care-events/${ev.id}/ics?t=${icsSig(ev.id)}`,
    ...extra,
  };
}

// ─── v1.106.30 — who else is going ───
//
// Pete: "today I am going to the Dr. Lambert appointment, but Tina is also going. So I would
// like to be able to tag her so that she gets updates about that appointment as well."
//
// Tagging is bounded by the care team on purpose. Anyone you can tag is already someone who
// can see this person's record; the tag decides who gets TOLD, not who is allowed to know.
// Letting it reach further would make an appointment a way to disclose a health event to
// someone with no access to the person it is about.
/**
 * Everyone who can be put on an appointment for this person.
 *
 * v1.106.31 — this was teamUserIds() and it was the wrong set, which Pete found within the
 * hour: "Literally, the only two people not included for me to select as going to the meeting
 * are the two people that are here. Me and Tina." Both exclusions were mine.
 *
 * TINA. teamUserIds covers the family owner, care_team_members and shares. A caregiver who
 * works this person's visits is in none of those — the v1.105.153 note says so out loud
 * ("a caregiver who is only assigned to a session appears in none of those sets") and I read
 * it while writing the wrong query anyway. hasAccess() has always granted her "member"
 * through a confirmed session; the picker just asked a different question. So the set is now
 * "who has access", which is what the privacy rule was about all along: a tag decides who is
 * TOLD about a health event, never who is allowed to know. Nobody new can see anything.
 *
 * PETE. I excluded the caller as tidiness. He is standing in the waiting room — of course he
 * is on the appointment. Whoever is going is going, and that includes you.
 */
async function peopleWithAccess(db, recipientId) {
  return db.prepare(`
    SELECT DISTINCT u.id, u.first_name, u.last_name, u.role, u.roles
    FROM users u
    WHERE u.id IN (
      SELECT family_user_id FROM care_recipients WHERE id = ?
      UNION
      SELECT ctm.user_id FROM care_team_members ctm
      JOIN care_teams ct ON ctm.care_team_id = ct.id
      WHERE ct.care_recipient_id = ?
      UNION
      SELECT shared_with_user_id FROM care_recipient_shares WHERE care_recipient_id = ?
      UNION
      -- A caregiver who works this person's visits. Booked OR already worked: the roster
      -- relationship is what matters, not whether today happens to have a session on it.
      SELECT cp.user_id FROM care_sessions cs
      JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
      WHERE cs.care_recipient_id = ?
        AND cs.status IN ('confirmed', 'in_progress', 'completed')
      UNION
      -- And one the family has assigned but who has no session yet.
      SELECT cp2.user_id FROM caregiver_assignments ca
      JOIN caregiver_profiles cp2 ON ca.caregiver_profile_id = cp2.id
      WHERE ca.care_recipient_id = ? AND ca.is_active = 1
    ) AND COALESCE(u.is_active, 1) = 1
    ORDER BY u.first_name
  `).all(recipientId, recipientId, recipientId, recipientId, recipientId);
}

async function attendeesFor(db, eventId) {
  return db.prepare(`
    SELECT a.user_id, u.first_name, u.last_name
    FROM care_event_attendees a
    JOIN users u ON u.id = a.user_id
    WHERE a.care_event_id = ?
    ORDER BY u.first_name
  `).all(eventId);
}

/**
 * Replace an event's attendee list, returning who is NEW so only they are notified.
 * Re-saving an appointment must not re-announce it to everyone already on it.
 */
async function setAttendees(db, ev, userIds, addedBy) {
  // The SAME set the picker offers. Two different answers here is how a name gets shown,
  // ticked, saved, and silently dropped.
  const allowed = new Set((await peopleWithAccess(db, ev.care_recipient_id)).map((u) => u.id));
  const wanted = [...new Set((userIds || []).filter((id) => allowed.has(id)))];

  const existing = (await db.prepare(
    "SELECT user_id FROM care_event_attendees WHERE care_event_id = ?"
  ).all(ev.id)).map((r) => r.user_id);
  const existingSet = new Set(existing);

  const added = wanted.filter((id) => !existingSet.has(id));
  const removed = existing.filter((id) => !wanted.includes(id));

  await db.transaction(async (tx) => {
    for (const id of removed) {
      await tx.prepare("DELETE FROM care_event_attendees WHERE care_event_id = ? AND user_id = ?")
        .run(ev.id, id);
    }
    for (const id of added) {
      await tx.prepare(`
        INSERT INTO care_event_attendees (id, care_event_id, user_id, added_by)
        VALUES (?, ?, ?, ?)
        ON CONFLICT (care_event_id, user_id) DO NOTHING
      `).run(uuid(), ev.id, id, addedBy);
    }
  });

  return { added, removed, current: wanted };
}

/** Tell the people just tagged that they are on an appointment. */
async function notifyTagged(db, req, ev, userIds) {
  if (!userIds || userIds.length === 0) return;
  const cr = await db.prepare("SELECT first_name FROM care_recipients WHERE id = ?")
    .get(ev.care_recipient_id);
  const who = cr?.first_name || "your loved one";
  const when = ev.event_time ? `${ev.event_date} at ${ev.event_time}` : ev.event_date;
  const emitToUser = req.app.get("emitToUser");
  const { sendPushToUser } = require("./push");

  for (const userId of userIds) {
    // Never notify the person doing the tagging about their own action.
    if (userId === req.user.id) continue;
    if (emitToUser) emitToUser(userId, "care_event_update", { eventId: ev.id });
    // NO TITLE. I wrote "title only" here and shipped the appointment title into the body,
    // which tests/pushPhi.test.js caught: the title IS the health information — "Dr. Lambert"
    // names the clinician, "Oncology follow-up" names the condition. v1.105.39 settled this
    // for the reminder push already ("no phi on lock screens"), and this is the same screen.
    //
    // First name and when. That is enough to act on; the rest is one tap away behind auth.
    sendPushToUser(userId, {
      title: "You're on an appointment",
      body: `For ${who} — ${when}. Tap for details.`,
      data: { type: "care_event_tagged", eventId: ev.id, page: "dashboard" },
    }, "care_event_tagged").catch(() => {});
  }
}

// ─── GET /api/care-events/:id/ics ── UNAUTHENTICATED (HMAC-signed URL) ───
// Registered before the auth middleware on purpose: calendar apps and the
// iOS share sheet fetch this URL with no InPlace session.
router.get("/:id/ics", async (req, res) => {
  try {
    const db = await getDb();
    const ev = await db.prepare("SELECT * FROM care_events WHERE id = ?").get(req.params.id);
    if (!ev || !req.query.t || req.query.t !== icsSig(ev.id)) {
      return res.status(403).json({ error: "Invalid calendar link" });
    }
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="inplace-event.ics"`);
    return res.send(buildIcs(ev));
  } catch (err) {
    captureException(err);
    return res.status(500).json({ error: "Failed to build calendar file" });
  }
});

router.use(authenticate);

// ─── GET /api/care-events/upcoming ───
// Events in the next 14 days (including all of today) across every recipient
// the user can access — the dashboard's Next Up merge reads this.
router.get("/upcoming", async (req, res) => {
  try {
    const db = await getDb();
    const recipients = await accessibleRecipients(db, req.user.id);
    const events = [];
    for (const cr of recipients) {
      const tz = cr.timezone || DEFAULT_TZ;
      const today = getTodayStringInZone(tz);
      const horizon = addDaysToDateString(today, UPCOMING_DAYS);
      const access = await hasAccess(db, cr.id, req.user.id);
      const rows = await db.prepare(`
        SELECT e.*, cu.first_name AS created_by_first_name
        FROM care_events e
        LEFT JOIN users cu ON e.created_by = cu.id
        WHERE e.care_recipient_id = ? AND e.is_active = 1
          AND e.event_date >= ? AND e.event_date <= ?
        ORDER BY e.event_date ASC, e.event_time ASC NULLS FIRST
      `).all(cr.id, today, horizon);
      // v1.106.30 — attendees for the whole page in ONE query. Per-event would be a round
      // trip per card on the screen someone opens most.
      const byEvent = new Map();
      if (rows.length) {
        const placeholders = rows.map(() => "?").join(",");
        const att = await db.prepare(`
          SELECT a.care_event_id, a.user_id, u.first_name, u.last_name
          FROM care_event_attendees a
          JOIN users u ON u.id = a.user_id
          WHERE a.care_event_id IN (${placeholders})
          ORDER BY u.first_name
        `).all(...rows.map((r) => r.id));
        for (const a of att) {
          if (!byEvent.has(a.care_event_id)) byEvent.set(a.care_event_id, []);
          byEvent.get(a.care_event_id).push({ user_id: a.user_id, first_name: a.first_name, last_name: a.last_name });
        }
      }
      for (const ev of rows) {
        events.push(serializeEvent(ev, {
          recipientFirstName: cr.first_name,
          recipientName: `${cr.first_name} ${cr.last_name}`.trim(),
          timezone: tz,
          canManage: canScheduleEvents(access),
          attendees: byEvent.get(ev.id) || [],
        }));
      }
    }
    events.sort((a, b) => `${a.event_date}${a.event_time || ""}`.localeCompare(`${b.event_date}${b.event_time || ""}`));
    return res.json({ events });
  } catch (err) {
    captureException(err);
    console.error("Care events /upcoming error:", err.message);
    return res.status(500).json({ error: "Failed to load events" });
  }
});

// ─── GET /api/care-events/recipient/:recipientId ───
// Upcoming + recent past events for one recipient (profile card).
router.get("/recipient/:recipientId", async (req, res) => {
  try {
    const db = await getDb();
    const access = await hasAccess(db, req.params.recipientId, req.user.id);
    if (!access) return res.status(403).json({ error: "Access denied" });
    const cr = await db.prepare("SELECT timezone, first_name FROM care_recipients WHERE id = ?").get(req.params.recipientId);
    const tz = cr?.timezone || DEFAULT_TZ;
    const today = getTodayStringInZone(tz);
    const rows = await db.prepare(`
      SELECT e.*, cu.first_name AS created_by_first_name
      FROM care_events e
      LEFT JOIN users cu ON e.created_by = cu.id
      WHERE e.care_recipient_id = ? AND e.is_active = 1 AND e.event_date >= ?
      ORDER BY e.event_date ASC, e.event_time ASC NULLS FIRST
      LIMIT 50
    `).all(req.params.recipientId, addDaysToDateString(today, -7));
    const byEvent = new Map();
    if (rows.length) {
      const placeholders = rows.map(() => "?").join(",");
      const att = await db.prepare(`
        SELECT a.care_event_id, a.user_id, u.first_name, u.last_name
        FROM care_event_attendees a
        JOIN users u ON u.id = a.user_id
        WHERE a.care_event_id IN (${placeholders})
        ORDER BY u.first_name
      `).all(...rows.map((r) => r.id));
      for (const a of att) {
        if (!byEvent.has(a.care_event_id)) byEvent.set(a.care_event_id, []);
        byEvent.get(a.care_event_id).push({ user_id: a.user_id, first_name: a.first_name, last_name: a.last_name });
      }
    }
    return res.json({
      events: rows.map((ev) => serializeEvent(ev, { timezone: tz, attendees: byEvent.get(ev.id) || [] })),
      today,
      canManage: canManage(access),
    });
  } catch (err) {
    captureException(err);
    console.error("Care events list error:", err.message);
    return res.status(500).json({ error: "Failed to load events" });
  }
});

// ─── GET /api/care-events/taggable/:recipientId ───
//
// v1.106.30 — who can be put on an appointment for this person. The care team, minus
// yourself. Deliberately the same set setAttendees will accept, so the picker cannot offer a
// name the save will then silently drop.
router.get("/taggable/:recipientId", async (req, res) => {
  try {
    const db = await getDb();
    const access = await hasAccess(db, req.params.recipientId, req.user.id);
    if (!access) return res.status(403).json({ error: "Not authorized for this care recipient" });
    const team = await peopleWithAccess(db, req.params.recipientId);
    return res.json({
      people: team
        .map((u) => ({
          isYou: u.id === req.user.id,
          user_id: u.id,
          first_name: u.first_name,
          last_name: u.last_name,
          isCaregiver: (() => {
            try { return (JSON.parse(u.roles || "[]") || []).includes("caregiver"); }
            catch { return u.role === "caregiver"; }
          })(),
        })),
    });
  } catch (err) {
    captureException(err);
    return res.status(500).json({ error: "Failed to load people" });
  }
});

// ─── POST /api/care-events/:id/transcribe ───
//
// v1.106.32 — Pete, twice: "smart transcription feature that could record and put notes in
// automatically" / "AI transcription of the meeting to add salient points". He chose record →
// transcribe → delete the audio.
//
// THE AUDIO IS NEVER WRITTEN. memoryStorage, straight to the transcriber, buffer out of
// scope. Not "deleted after" — never stored, so there is no row, no object, no temp file and
// nothing to purge or hand over. A recording of a medical consultation is the most sensitive
// thing this product could hold.
//
// CONSENT IS RECORDED, NOT ASSUMED. The client must send consent_confirmed, and who confirmed
// it and when goes into the note's own text. Virginia is one-party, but the family travels
// and a practice can refuse recording regardless of state law — so the app asks every time
// and writes down that it asked.
//
// What lands is a care note against this appointment: the same recipient_notes row any other
// note is, so iPAi files it and the team sees it. The transcript is kept in the note body
// because the extraction can be wrong and the words actually said are the record.
const uploadAudio = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_AUDIO_BYTES, files: 1 },
});

router.post("/:id/transcribe", uploadAudio.single("audio"), async (req, res) => {
  try {
    const db = await getDb();
    const ev = await db.prepare("SELECT * FROM care_events WHERE id = ?").get(req.params.id);
    if (!ev) return res.status(404).json({ error: "Appointment not found" });

    // Anyone with access may record — the caregiver at the visit most of all. Recording is
    // not a management act; it is writing down what happened, which canCheckOff already
    // covers everywhere else.
    const access = await hasAccess(db, ev.care_recipient_id, req.user.id);
    if (!access) return res.status(403).json({ error: "Not authorized for this appointment" });

    if (String(req.body.consent_confirmed) !== "true") {
      return res.status(400).json({ error: "Recording needs the consent step first." });
    }
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: "No audio received." });
    }

    const cr = await db.prepare("SELECT first_name FROM care_recipients WHERE id = ?")
      .get(ev.care_recipient_id);

    let transcript;
    try {
      transcript = await transcribeAudio(req.file.buffer, req.file.mimetype, req.file.originalname || "appointment.webm");
    } catch (e) {
      // Only OUR error type is safe to show. `e.status || 502` with `e.message` would echo
      // any internal failure straight to the user — and a transcription path is exactly
      // where a stray message could carry a fragment of what was said.
      if (e instanceof TranscriptionError) {
        return res.status(e.status || 502).json({ error: e.message });
      }
      throw e; // to the handler's own catch: Sentry, and a generic 500
    }

    const extracted = await extractAppointmentNotes(transcript.text, {
      recipientFirstName: cr?.first_name || "the patient",
    });

    const me = await db.prepare("SELECT first_name, last_name FROM users WHERE id = ?").get(req.user.id);
    const who = `${me?.first_name || ""} ${me?.last_name || ""}`.trim() || "A care team member";

    const lines = [];
    if (extracted?.summary) lines.push(extracted.summary);
    if (extracted?.items?.length) {
      const LABEL = { medication: "Medication", follow_up: "Follow-up", instruction: "Instruction", observation: "Noted" };
      lines.push("");
      for (const it of extracted.items) lines.push(`• ${LABEL[it.kind]}: ${it.text}`);
    }
    lines.push("");
    lines.push("— Transcript —");
    lines.push(transcript.text);
    lines.push("");
    lines.push(`Recorded by ${who}, who confirmed consent to record. Audio was not kept.`);

    const noteId = uuid();
    await db.prepare(`
      INSERT INTO recipient_notes (id, care_recipient_id, author_id, content, note_type, care_event_id, created_at)
      VALUES (?, ?, ?, ?, 'visit_summary', ?, NOW())
    `).run(noteId, ev.care_recipient_id, req.user.id, lines.join("\n").slice(0, 5000), ev.id);

    return res.json({
      note_id: noteId,
      summary: extracted?.summary || null,
      items: extracted?.items || [],
      transcript: transcript.text,
      speakers: transcript.speakers,
      extracted: !!extracted,
    });
  } catch (err) {
    captureException(err, { where: "careEvents: transcribe" });
    console.error("Transcribe error:", err.message);
    return res.status(500).json({ error: "Could not transcribe that recording." });
  }
});

// ─── GET /api/care-events/:id/notes ───
//
// v1.106.30 — Pete: "Appointments need to be [editable] with notes as well... Otherwise, the
// only thing that Kitay knows is that an appointment happened."
//
// These are recipient_notes carrying this event's id, NOT a column on care_events. The care
// record is one place: it already pushes the whole team, already feeds iPAi's categoriser,
// and is already what every other surface reads. A second store for "what the doctor said"
// would be a second place to look for someone's health history.
router.get("/:id/notes", async (req, res) => {
  try {
    const db = await getDb();
    const ev = await db.prepare("SELECT * FROM care_events WHERE id = ?").get(req.params.id);
    if (!ev) return res.status(404).json({ error: "Event not found" });
    const access = await hasAccess(db, ev.care_recipient_id, req.user.id);
    if (!access) return res.status(403).json({ error: "Not authorized for this appointment" });

    const notes = await db.prepare(`
      SELECT n.id, n.content, n.note_type, n.needs_attention, n.created_at,
             u.first_name AS author_first_name, u.last_name AS author_last_name,
             (n.photo IS NOT NULL) AS has_photo
      FROM recipient_notes n
      LEFT JOIN users u ON u.id = n.author_id
      WHERE n.care_event_id = ?
      ORDER BY n.created_at ASC
    `).all(ev.id);
    return res.json({ notes });
  } catch (err) {
    captureException(err);
    return res.status(500).json({ error: "Failed to load appointment notes" });
  }
});

// ─── POST /api/care-events/parse ───
// One-field natural-language quick-add: "Dr. Patel cardiology Tuesday 2pm,
// Carilion Radford" → structured fields for the confirm card. Never guesses:
// no confident date → date comes back null and the client asks.
router.post("/parse", async (req, res) => {
  try {
    const text = String(req.body?.text || "").trim().slice(0, 500);
    if (!text) return res.status(400).json({ error: "Nothing to parse" });
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(503).json({ parsed: null, reason: "ai_unavailable" });

    const tz = String(req.body?.tz || DEFAULT_TZ);
    const today = getTodayStringInZone(tz);
    const weekday = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long" }).format(new Date());

    const client = getAnthropic(apiKey);
    const result = await client.messages.create({
      model: MODEL_HAIKU,
      max_tokens: 300,
      system: [
        "You extract calendar-event fields from one short line typed by a family caregiver coordinating care for a loved one.",
        `Today is ${weekday}, ${today}, timezone ${tz}.`,
        'Reply with ONLY a JSON object, no prose: {"title": string, "category": "medical"|"social"|"transport"|"other", "date": "YYYY-MM-DD" or null, "time": "HH:MM" 24-hour or null, "end_time": "HH:MM" or null, "location": string or null, "details": string or null}.',
        "Resolve relative dates (\"Tuesday\" = the next Tuesday, counting today). Doctor/dentist/therapy/lab = medical.",
        "NEVER invent a date or time that isn't clearly implied — use null. Title should be short and human (\"Cardiology — Dr. Patel\"), not the raw text.",
      ].join(" "),
      messages: [{ role: "user", content: text }],
    });
    const raw = (result.content?.[0]?.text || "").replace(/^```(json)?|```$/g, "").trim();
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch { /* model went off-script */ }
    if (!parsed || typeof parsed !== "object") return res.json({ parsed: null });
    // Sanitize — the model proposes, the server disposes.
    const clean = {
      title: String(parsed.title || "").slice(0, 200) || null,
      category: CATEGORIES.includes(parsed.category) ? parsed.category : "other",
      date: /^\d{4}-\d{2}-\d{2}$/.test(parsed.date || "") ? parsed.date : null,
      time: /^\d{2}:\d{2}$/.test(parsed.time || "") ? parsed.time : null,
      end_time: /^\d{2}:\d{2}$/.test(parsed.end_time || "") ? parsed.end_time : null,
      location: parsed.location ? String(parsed.location).slice(0, 200) : null,
      details: parsed.details ? String(parsed.details).slice(0, 1000) : null,
    };
    return res.json({ parsed: clean });
  } catch (err) {
    captureException(err);
    console.error("Care events parse error:", err.message);
    return res.status(502).json({ parsed: null, reason: "ai_error" });
  }
});

// ─── POST /api/care-events ─── create
router.post("/", async (req, res) => {
  try {
    const db = await getDb();
    const { care_recipient_id } = req.body || {};
    if (!care_recipient_id) return res.status(400).json({ error: "care_recipient_id required" });
    const access = await hasAccess(db, care_recipient_id, req.user.id);
    // v1.105.165 — SCHEDULE_EVENTS, not MANAGE. See canScheduleEvents in careTasks.js.
    if (!canScheduleEvents(access)) return res.status(403).json({ error: "You don't have permission to add appointments for this person" });

    const { errors, category } = validateEventInput(req.body);
    if (errors.length) return res.status(400).json({ error: errors[0], errors });

    const cr = await db.prepare("SELECT timezone FROM care_recipients WHERE id = ?").get(care_recipient_id);
    const tz = cr?.timezone || DEFAULT_TZ;
    const eventTime = req.body.event_time || null;
    const startsAt = eventStartInstant({ event_date: req.body.event_date, event_time: eventTime, tz });

    const id = uuid();
    await db.prepare(`
      INSERT INTO care_events (id, care_recipient_id, created_by, title, category,
        event_date, event_time, end_time, tz, starts_at, location, details, source, source_meta)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, care_recipient_id, req.user.id, String(req.body.title).trim(), category,
      req.body.event_date, eventTime, req.body.end_time || null, tz, startsAt.toISOString(),
      req.body.location ? String(req.body.location).trim().slice(0, 200) : null,
      req.body.details ? String(req.body.details).trim().slice(0, 1000) : null,
      "manual", null
    );

    // Timeline visibility for the family owner.
    try {
      const crFull = await db.prepare("SELECT family_user_id, first_name FROM care_recipients WHERE id = ?").get(care_recipient_id);
      const u = await db.prepare("SELECT first_name FROM users WHERE id = ?").get(req.user.id);
      await db.prepare(`
        INSERT INTO activity_feed (id, family_user_id, care_recipient_id, event_type, title, message, metadata)
        VALUES (?, ?, ?, 'care_event', ?, ?, ?)
      `).run(uuid(), crFull.family_user_id, care_recipient_id,
        `📅 ${String(req.body.title).trim()}`,
        `${u?.first_name || "Someone"} added this for ${crFull.first_name} — ${req.body.event_date}${eventTime ? ` at ${eventTime}` : ""}.`,
        JSON.stringify({ eventId: id }));
    } catch (feedErr) { /* non-critical */ }

    const ev = await db.prepare("SELECT * FROM care_events WHERE id = ?").get(id);

    // v1.106.30 — who else is going.
    let attendees = [];
    if (Array.isArray(req.body.attendee_user_ids)) {
      const { added } = await setAttendees(db, ev, req.body.attendee_user_ids, req.user.id);
      await notifyTagged(db, req, ev, added);
      attendees = await attendeesFor(db, ev.id);
    }

    return res.status(201).json({ event: serializeEvent(ev, { attendees }) });
  } catch (err) {
    captureException(err);
    console.error("Care event create error:", err.message);
    return res.status(500).json({ error: "Failed to add event" });
  }
});

// ─── PUT /api/care-events/:id ─── edit
router.put("/:id", async (req, res) => {
  try {
    const db = await getDb();
    const ev = await db.prepare("SELECT * FROM care_events WHERE id = ?").get(req.params.id);
    if (!ev) return res.status(404).json({ error: "Event not found" });
    const access = await hasAccess(db, ev.care_recipient_id, req.user.id);
    if (!canScheduleEvents(access)) return res.status(403).json({ error: "You don't have permission to change appointments for this person" });

    const merged = { ...ev, ...req.body };
    // Client may clear the time (switch to all-day) with event_time: null
    if (req.body.event_time === null || req.body.event_time === "") merged.event_time = null;
    const { errors, category } = validateEventInput(merged);
    if (errors.length) return res.status(400).json({ error: errors[0], errors });

    const tz = ev.tz || DEFAULT_TZ;
    const startsAt = eventStartInstant({ event_date: merged.event_date, event_time: merged.event_time, tz });
    const dateChanged = merged.event_date !== ev.event_date || merged.event_time !== ev.event_time;

    await db.prepare(`
      UPDATE care_events SET title = ?, category = ?, event_date = ?, event_time = ?,
        end_time = ?, starts_at = ?, location = ?, details = ?,
        reminders_sent = ?, updated_at = NOW()
      WHERE id = ?
    `).run(
      String(merged.title).trim(), category, merged.event_date, merged.event_time || null,
      merged.end_time || null, startsAt.toISOString(),
      merged.location ? String(merged.location).trim().slice(0, 200) : null,
      merged.details ? String(merged.details).trim().slice(0, 1000) : null,
      // Rescheduled → reminders fire again for the new date/time.
      dateChanged ? "" : ev.reminders_sent,
      ev.id
    );
    const updated = await db.prepare("SELECT * FROM care_events WHERE id = ?").get(ev.id);

    // v1.106.30 — only the NEWLY tagged hear about it. Re-saving an appointment to fix a
    // typo must not re-announce it to everyone already on it.
    let attendees = await attendeesFor(db, ev.id);
    if (Array.isArray(req.body.attendee_user_ids)) {
      const { added } = await setAttendees(db, updated, req.body.attendee_user_ids, req.user.id);
      await notifyTagged(db, req, updated, added);
      attendees = await attendeesFor(db, ev.id);
    }

    return res.json({ event: serializeEvent(updated, { attendees }) });
  } catch (err) {
    captureException(err);
    console.error("Care event update error:", err.message);
    return res.status(500).json({ error: "Failed to update event" });
  }
});

// ─── DELETE /api/care-events/:id ─── soft delete
router.delete("/:id", async (req, res) => {
  try {
    const db = await getDb();
    const ev = await db.prepare("SELECT * FROM care_events WHERE id = ?").get(req.params.id);
    if (!ev) return res.status(404).json({ error: "Event not found" });
    const access = await hasAccess(db, ev.care_recipient_id, req.user.id);
    if (!canScheduleEvents(access)) return res.status(403).json({ error: "You don't have permission to remove appointments for this person" });
    await db.prepare("UPDATE care_events SET is_active = 0, updated_at = NOW() WHERE id = ?").run(ev.id);
    return res.json({ success: true });
  } catch (err) {
    captureException(err);
    console.error("Care event delete error:", err.message);
    return res.status(500).json({ error: "Failed to remove event" });
  }
});

// ─── Poller tick (called from server.js under guardedPoller lock 108) ───
// Family-only reminder pushes: day-before (evening) + same-day. Nothing
// escalates and nothing goes missed — events are awareness, not obligations.
async function pollCareEvents(sendPushToUser) {
  const db = await getDb();
  const nowMs = Date.now();
  // Only rows that could possibly need a notice: active, not long past.
  const events = await db.prepare(`
    SELECT e.*, cr.timezone AS recipient_tz, cr.first_name AS recipient_first_name,
           u.is_demo AS owner_is_demo
    FROM care_events e
    JOIN care_recipients cr ON e.care_recipient_id = cr.id
    LEFT JOIN users u ON cr.family_user_id = u.id
    WHERE e.is_active = 1 AND e.starts_at > NOW() - INTERVAL '1 day'
      AND e.starts_at < NOW() + INTERVAL '3 days'
      AND (e.reminders_sent NOT LIKE '%same_day%')
  `).all();

  for (const ev of events) {
    try {
      if (ev.owner_is_demo) continue; // demo hygiene, belt & braces
      const tz = ev.tz || ev.recipient_tz || DEFAULT_TZ;
      const stage = reminderStage({ ...ev, tz }, nowMs);
      if (!stage) continue;

      // v1.106.31 — peopleWithAccess, not teamUserIds: a tagged caregiver is not on the
      // care team and was therefore never in the list the reminder iterated.
      const team = await peopleWithAccess(db, ev.care_recipient_id);
      // v1.99.2 kept event reminders FAMILY-ONLY (Pete's 7/22 rule) because no caregiver had
      // asked to be on one. v1.106.30 — being tagged IS that ask, and it is the whole point
      // of tagging: "Tina is also going... so that she gets updates about that appointment as
      // well." So the recipients are the notifiable family PLUS anyone tagged, whatever their
      // role. setAttendees only admits people already on the care team, so this widens who is
      // TOLD and never who is allowed to know.
      const tagged = new Set((await db.prepare(
        "SELECT user_id FROM care_event_attendees WHERE care_event_id = ?"
      ).all(ev.id)).map((r) => r.user_id));
      const notifiable = team.filter((m) => isFamilyNotifiable(m) || tagged.has(m.id));
      const timeLabel = ev.event_time
        ? new Date(ev.starts_at).toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" })
        : null;
      // v1.105.39 — an event title is usually the appointment ("Dr. Patel — neurology")
      // and the location names the clinic. Both were on the lock screen. Time and first
      // name are enough to act on; the rest is one tap away. Pete: "no phi on lock screens."
      const title = stage === "day_before" ? "Appointment tomorrow" : "Appointment today";
      const body = ev.event_time
        ? `${stage === "day_before" ? "Tomorrow" : "Today"} at ${timeLabel} for ${ev.recipient_first_name}. Tap for details.`
        : `${stage === "day_before" ? "Tomorrow" : "Today"} for ${ev.recipient_first_name}. Tap for details.`;

      for (const m of notifiable) {
        sendPushToUser(m.id, {
          title,
          body,
          data: { type: "care_event", page: "dashboard", eventId: ev.id, careRecipientId: ev.care_recipient_id },
        }, "care_event").catch(() => {});
      }
      const sent = ev.reminders_sent || "";
      await db.prepare("UPDATE care_events SET reminders_sent = ? WHERE id = ?")
        .run(sent ? `${sent},${stage}` : stage, ev.id);
    } catch (evErr) {
      console.error(`  Care events poller error (event ${ev.id}):`, evErr.message);
    }
  }
}

module.exports = router;
module.exports.pollCareEvents = pollCareEvents;
module.exports._icsSig = icsSig; // for tests
