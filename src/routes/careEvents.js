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
const { v4: uuid } = require("uuid");
const { getDb } = require("../models/database");
const { authenticate } = require("../middleware/auth");
const { captureException } = require("../utils/sentry");
const { getTodayStringInZone } = require("../utils/timezone");
const { hasAccess, canManage, accessibleRecipients, teamUserIds, isFamilyNotifiable } =
  require("./careTasks")._shared;
const {
  CATEGORIES, addDaysToDateString, eventStartInstant,
  validateEventInput, reminderStage, buildIcs,
} = require("../utils/careEventUtils");
const { MODEL_HAIKU } = require("../utils/aiModels");

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
      for (const ev of rows) {
        events.push(serializeEvent(ev, {
          recipientFirstName: cr.first_name,
          recipientName: `${cr.first_name} ${cr.last_name}`.trim(),
          timezone: tz,
          canManage: canManage(access),
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
    return res.json({
      events: rows.map((ev) => serializeEvent(ev, { timezone: tz })),
      today,
      canManage: canManage(access),
    });
  } catch (err) {
    captureException(err);
    console.error("Care events list error:", err.message);
    return res.status(500).json({ error: "Failed to load events" });
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

    const Anthropic = require("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey });
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
    if (!canManage(access)) return res.status(403).json({ error: "Only the family owner or care team leaders can add events" });

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
    return res.status(201).json({ event: serializeEvent(ev) });
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
    if (!canManage(access)) return res.status(403).json({ error: "Only the family owner or care team leaders can edit events" });

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
    return res.json({ event: serializeEvent(updated) });
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
    if (!canManage(access)) return res.status(403).json({ error: "Only the family owner or care team leaders can remove events" });
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

      const team = await teamUserIds(db, ev.care_recipient_id);
      const notifiable = team.filter(isFamilyNotifiable); // family-only (Pete's 7/22 rule)
      const timeLabel = ev.event_time
        ? new Date(ev.starts_at).toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" })
        : null;
      const where = ev.location ? ` · ${ev.location}` : "";
      const title = stage === "day_before" ? `Tomorrow: ${ev.title}` : `Today: ${ev.title}`;
      const body = ev.event_time
        ? `${stage === "day_before" ? "Tomorrow" : "Today"} at ${timeLabel} for ${ev.recipient_first_name}${where}.`
        : `${stage === "day_before" ? "Tomorrow" : "Today"} for ${ev.recipient_first_name}${where}.`;

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
