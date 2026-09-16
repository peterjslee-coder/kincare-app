// ─── The visit report (v1.108.0) ───
//
// Pete, 9/16: "Check out there needs to be more detail. I want to know meals eaten, bathed,
// appointment made, any mobility concerns etc. ... match the feedback to the notes ... 'Betty
// said she wasn't hungry yesterday, was she today?' ... It becomes one of those features that
// draw and keep people on app and earns the 20%."
//
// His decisions (9/16): four topic groups — meals & drinks, bathroom & hygiene, rest &
// mobility, meds & appointments. Every row needs a tap, and "Didn't come up" is a tap, so a
// blank is always deliberate. Follow-ups are chosen by RULES (anything flagged last visit);
// the AI only words them, and never advises.
//
// The form is built on the server for one visit, because what it asks depends on that visit:
// which meals fall inside the shift, which medication doses were due, which appointments
// overlapped, and whether the booking includes personal care. The client renders what it is
// given and sends back { topic, ref, value, note } per row.
//
// Records what the caregiver SAW. It is not an assessment, and nothing here generates advice
// (feedback_ai_medical_guidance_rule).

const { v4: uuid } = require("uuid");
const { zonedDateTimeToInstant } = require("./timezone");
const { duringShift } = require("./careEventUtils");

const NA = { value: "na", label: "Didn't come up" };

// concern: shown in red to the family and followed up next visit.
// watch:   not red, but worth asking about next visit.
const CATALOG = {
  meal: {
    group: "meals", label: (n, ref) => `How much did ${n} eat at ${ref}?`, short: (ref) => cap(ref),
    options: [
      { value: "all", label: "All of it" },
      { value: "most", label: "Most" },
      { value: "some", label: "Some", watch: true },
      { value: "little", label: "A little", concern: true },
      { value: "none", label: "Nothing", concern: true },
      { value: "refused", label: "Refused", concern: true },
      { value: "not_offered", label: "Not offered" },
    ],
  },
  fluids: {
    group: "meals", label: (n) => `Did ${n} drink enough?`, short: () => "Drinks",
    options: [
      { value: "good", label: "Drank well" },
      { value: "some", label: "Some", watch: true },
      { value: "little", label: "Very little", concern: true },
    ],
  },
  toileting: {
    group: "bathroom", label: () => "Bathroom", short: () => "Bathroom",
    options: [
      { value: "normal", label: "No issues" },
      { value: "help", label: "Needed help", watch: true },
      { value: "accident", label: "Accident", concern: true },
      { value: "concern", label: "Something to flag", concern: true },
    ],
  },
  bath: {
    group: "bathroom", personalCare: true, label: () => "Bath or shower", short: () => "Bath",
    options: [
      { value: "done", label: "Done" },
      { value: "declined", label: "Declined", watch: true },
      { value: "not_due", label: "Not today" },
    ],
  },
  dressed: {
    group: "bathroom", personalCare: true, label: () => "Getting dressed", short: () => "Dressed",
    options: [
      { value: "self", label: "On their own" },
      { value: "help", label: "With help" },
      { value: "declined", label: "Declined", watch: true },
    ],
  },
  teeth: {
    group: "bathroom", personalCare: true, label: () => "Teeth or dentures", short: () => "Teeth",
    options: [
      { value: "done", label: "Done" },
      { value: "declined", label: "Declined", watch: true },
      { value: "not_due", label: "Not today" },
    ],
  },
  arrival: {
    group: "rest", label: (n) => `When you arrived, ${n} was…`, short: () => "On arrival",
    options: [
      { value: "awake", label: "Awake" },
      { value: "asleep", label: "Asleep", watch: true },
    ],
  },
  nap: {
    group: "rest", label: () => "Rest during the visit", short: () => "Rest",
    options: [
      { value: "none", label: "No nap" },
      { value: "short", label: "Short nap" },
      { value: "long", label: "Long nap (1h+)", watch: true },
    ],
  },
  mobility: {
    group: "rest", label: (n) => `How did ${n} get around?`, short: () => "Getting around",
    options: [
      { value: "independent", label: "On their own" },
      { value: "help", label: "With help", watch: true },
      { value: "stayed", label: "Stayed seated or in bed", watch: true },
    ],
  },
  fall: {
    group: "rest", label: () => "Any falls?", short: () => "Falls",
    options: [
      { value: "none", label: "No falls" },
      { value: "near", label: "Near-fall", concern: true, safety: "medium" },
      { value: "fall", label: "Fell", concern: true, safety: "high" },
    ],
  },
  med: {
    group: "meds", label: (n, ref, row) => `${row.title}${row.time ? ` · ${row.time}` : ""}`, short: (ref, row) => row ? row.title : "Medication",
    options: [
      { value: "taken", label: "Taken" },
      { value: "refused", label: "Refused", concern: true },
      { value: "missed", label: "Didn't happen", concern: true },
    ],
  },
  appt: {
    group: "meds", label: (n, ref, row) => `${row.title}${row.time ? ` · ${row.time}` : ""}`, short: (ref, row) => row ? row.title : "Appointment",
    options: [
      { value: "went", label: "Went" },
      { value: "cancelled", label: "Cancelled", watch: true },
      { value: "moved", label: "Rescheduled" },
    ],
  },
};

const GROUPS = [
  { id: "meals", label: "Meals & drinks" },
  { id: "bathroom", label: "Bathroom & hygiene" },
  { id: "rest", label: "Rest & getting around" },
  { id: "meds", label: "Medications & appointments" },
];

// Meal windows in the person's local time. A meal is asked about when the shift overlaps it.
const MEALS = [
  { ref: "breakfast", from: "06:00", to: "10:00" },
  { ref: "lunch", from: "11:00", to: "14:00" },
  { ref: "dinner", from: "17:00", to: "20:00" },
];

// Follow-up priority: the most important thing to ask about first.
const FOLLOW_ORDER = ["fall", "med", "meal", "fluids", "toileting", "arrival", "mobility", "nap", "bath", "dressed", "teeth", "appt"];
const MAX_FOLLOW_UPS = 3;

function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }
const rowKey = (topic, ref) => `${topic}|${ref || ""}`;
function optionOf(topic, value) {
  if (value === NA.value) return NA;
  return (CATALOG[topic]?.options || []).find((o) => o.value === value) || null;
}
function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function hm(date, tz) {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(date);
}
function localHHMM(date, tz) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
}

/** The visit, and the window it covers as real instants. */
async function loadVisit(db, sessionId) {
  const s = await db.prepare(`
    SELECT cs.id, cs.care_recipient_id, cs.status, cs.service_type, cs.scheduled_date, cs.scheduled_time,
           cs.duration_hours, cs.completed_at, cr.first_name AS recipient_first_name,
           COALESCE(cr.timezone, 'America/New_York') AS tz,
           vl.check_in_time, vl.check_out_time
      FROM care_sessions cs
      JOIN care_recipients cr ON cr.id = cs.care_recipient_id
      LEFT JOIN visit_logs vl ON vl.session_id = cs.id
     WHERE cs.id = ?
  `).get(sessionId);
  if (!s) return null;
  const date = String(s.scheduled_date).slice(0, 10);
  const start = zonedDateTimeToInstant(date, String(s.scheduled_time || "09:00").slice(0, 5), s.tz);
  let end = new Date(start.getTime() + (parseFloat(s.duration_hours) || 0) * 3600000);
  if (s.status === "in_progress" && Date.now() > end.getTime()) end = new Date();
  if (s.check_out_time && new Date(s.check_out_time) > end) end = new Date(s.check_out_time);
  return { ...s, date, start, end };
}

/** Rows for one visit, without follow-ups. */
async function buildRows(db, v) {
  const name = v.recipient_first_name || "them";
  const rows = [];
  const push = (topic, ref, extra = {}) => {
    const def = CATALOG[topic];
    rows.push({
      key: rowKey(topic, ref), topic, ref: ref || "", group: def.group,
      label: def.label(name, ref, extra), short: def.short(ref, extra),
      options: [...def.options.map(({ value, label, concern, watch }) => ({ value, label, concern: !!concern, watch: !!watch })), NA],
      ...extra,
    });
  };

  // Meals — every day the shift touches (an overnight reaches the next breakfast).
  const lastDate = addDays(v.date, Math.max(0, Math.round((v.end - v.start) / 86400000)));
  for (let d = v.date; d <= lastDate; d = addDays(d, 1)) {
    for (const m of MEALS) {
      const a = zonedDateTimeToInstant(d, m.from, v.tz);
      const b = zonedDateTimeToInstant(d, m.to, v.tz);
      if (a < v.end && b > v.start && !rows.some((r) => r.topic === "meal" && r.ref === m.ref)) push("meal", m.ref);
    }
  }
  push("fluids", "");
  push("toileting", "");
  if (String(v.service_type || "") === "personal_care") {
    push("bath", ""); push("dressed", ""); push("teeth", "");
  }
  push("arrival", "");
  push("nap", "");
  push("mobility", "");
  push("fall", "");

  // Medication doses due inside the visit (half an hour of grace before it starts).
  const meds = await db.prepare(`
    SELECT o.id, o.task_id, o.slot_index, o.due_at, o.status, o.completed_by_user_id, t.title
      FROM care_task_occurrences o
      JOIN care_tasks t ON t.id = o.task_id
     WHERE t.care_recipient_id = ? AND t.task_type = 'medication'
       AND o.due_at >= ? AND o.due_at <= ?
     ORDER BY o.due_at ASC
  `).all(v.care_recipient_id, new Date(v.start.getTime() - 30 * 60000).toISOString(), v.end.toISOString());
  for (const m of meds) {
    const prefill = m.status === "done" ? "taken" : m.status === "skipped" ? "refused" : null;
    push("med", `${m.task_id}:${Number(m.slot_index) || 0}`, {
      title: m.title, time: hm(new Date(m.due_at), v.tz), occurrenceId: m.id, prefill,
      alreadyRecorded: m.status === "done" || m.status === "skipped",
    });
  }

  // Appointments that overlap the shift.
  const events = await db.prepare(`
    SELECT id, title, event_date, event_time, end_time
      FROM care_events
     WHERE care_recipient_id = ? AND is_active = 1 AND event_date >= ? AND event_date <= ?
     ORDER BY event_date ASC, event_time ASC NULLS FIRST
  `).all(v.care_recipient_id, v.date, lastDate);
  const shift = [{
    date: v.date, time: localHHMM(v.start, v.tz),
    durationHours: (v.end - v.start) / 3600000, status: "confirmed",
  }];
  for (const e of events) {
    if (!duringShift(e, shift, v.date, v.tz)) continue;
    push("appt", e.id, { title: e.title, time: e.event_time ? String(e.event_time).slice(0, 5) : null, eventId: e.id });
  }
  return rows;
}

/** A follow-up key for matching across visits: a dose is the same dose on another day. */
const followKey = (topic, ref) => rowKey(topic, ref);

/** What was flagged on the most recent earlier report for this person. */
async function previousFlags(db, v, before = new Date()) {
  const last = await db.prepare(`
    SELECT a.session_id, MAX(a.created_at) AS at
      FROM visit_report_answers a
     WHERE a.care_recipient_id = ? AND a.session_id <> ?
     GROUP BY a.session_id
    HAVING MAX(a.created_at) < ?
     ORDER BY at DESC
     LIMIT 1
  `).get(v.care_recipient_id, v.id, before.toISOString());
  if (!last) return null;
  const answers = await db.prepare(
    "SELECT topic, ref, value, note FROM visit_report_answers WHERE session_id = ?"
  ).all(last.session_id);
  const flagged = answers.filter((a) => {
    const o = optionOf(a.topic, a.value);
    return o && (o.concern || o.watch);
  });
  return { sessionId: last.session_id, at: new Date(last.at), answers, flagged };
}

function templateFollowUp(v, prevAt, a, row) {
  const day = new Intl.DateTimeFormat("en-US", { timeZone: v.tz, weekday: "long" }).format(prevAt);
  const o = optionOf(a.topic, a.value);
  const what = row ? row.short : CATALOG[a.topic].short(a.ref);
  return `Last visit (${day}): ${what} — “${o ? o.label : a.value}”${a.note ? ` (${a.note})` : ""}. How about today?`;
}

/**
 * Rules pick what to ask; the AI, if available, only rewords. It gets the facts and must return
 * one short question per fact, with no advice. Any failure falls back to the template.
 */
async function phraseFollowUps(items, name) {
  if (!items.length) return items;
  let client = null;
  try { client = require("./aiModels").getAnthropic(); } catch { client = null; }
  if (!client) return items;
  try {
    const { MODEL_HAIKU } = require("./aiModels");
    const facts = items.map((it, i) => `${i + 1}. ${it.text}`).join("\n");
    const ask = client.messages.create({
      model: MODEL_HAIKU,
      max_tokens: 300,
      system: "You rewrite short check-out prompts for a home caregiver. Each input line is a fact from the previous visit. "
        + "Rewrite each as ONE warm, plain question (under 20 words) asking how that same thing went today. "
        + "Keep the facts exactly; add nothing. Never give medical, health or care advice, never suggest causes or actions. "
        + "Reply with the questions only, one per line, numbered the same way.",
      messages: [{ role: "user", content: `The person is ${name}.\n${facts}` }],
    });
    const res = await Promise.race([ask, new Promise((_, rej) => setTimeout(() => rej(new Error("slow")), 2500))]);
    const text = (res.content || []).map((c) => c.text || "").join("\n");
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    return items.map((it, i) => {
      const line = lines.find((l) => l.startsWith(`${i + 1}.`));
      const q = line ? line.replace(/^\d+\.\s*/, "").trim() : "";
      return q && q.length <= 160 ? { ...it, text: q } : it;
    });
  } catch {
    return items;
  }
}

/** The whole form: rows, grouped, with follow-ups attached to the rows they are about. */
async function buildReportForm(db, sessionId, { phrase = true } = {}) {
  const v = await loadVisit(db, sessionId);
  if (!v) return null;
  const rows = await buildRows(db, v);
  const prev = await previousFlags(db, v);
  let followUps = [];
  if (prev) {
    const byKey = new Map(rows.map((r) => [followKey(r.topic, r.ref), r]));
    const picked = prev.flagged
      .map((a) => ({ a, row: byKey.get(followKey(a.topic, a.ref)) }))
      .filter((x) => x.row)
      .sort((x, y) => {
        const cx = optionOf(x.a.topic, x.a.value)?.concern ? 0 : 1;
        const cy = optionOf(y.a.topic, y.a.value)?.concern ? 0 : 1;
        return cx - cy || FOLLOW_ORDER.indexOf(x.a.topic) - FOLLOW_ORDER.indexOf(y.a.topic);
      })
      .slice(0, MAX_FOLLOW_UPS);
    followUps = picked.map(({ a, row }) => ({ key: row.key, text: templateFollowUp(v, prev.at, a, row) }));
    if (phrase) followUps = await phraseFollowUps(followUps, v.recipient_first_name || "them");
    for (const f of followUps) {
      const row = rows.find((r) => r.key === f.key);
      if (row) row.followUp = f.text;
    }
  }
  return {
    sessionId: v.id,
    recipientFirstName: v.recipient_first_name,
    groups: GROUPS.map((g) => ({ ...g, rows: rows.filter((r) => r.group === g.id) })).filter((g) => g.rows.length),
    followUps,
    rowCount: rows.length,
  };
}

/**
 * Check a submission against the form. Every row needs a known value; notes are trimmed.
 * Returns { ok, missing: [labels], clean: [{topic, ref, value, note, row}] }.
 */
function checkAnswers(form, answers) {
  const byKey = new Map();
  for (const a of Array.isArray(answers) ? answers : []) {
    if (!a || typeof a !== "object") continue;
    byKey.set(rowKey(String(a.topic || ""), String(a.ref || "")), a);
  }
  const missing = [];
  const clean = [];
  for (const g of form.groups) {
    for (const row of g.rows) {
      const a = byKey.get(row.key);
      const value = a && typeof a.value === "string" ? a.value : null;
      if (!value || !row.options.some((o) => o.value === value)) { missing.push(row.short || row.label); continue; }
      const note = a.note ? String(a.note).trim().slice(0, 500) : null;
      clean.push({ topic: row.topic, ref: row.ref, value, note: note || null, row });
    }
  }
  return { ok: missing.length === 0, missing, clean };
}

/** Store the answers. Called inside the check-out transaction. */
async function saveAnswers(tx, { sessionId, careRecipientId, userId, clean }) {
  for (const c of clean) {
    await tx.prepare(`
      INSERT INTO visit_report_answers (id, session_id, care_recipient_id, topic, ref, value, note, answered_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (session_id, topic, ref) DO UPDATE SET value = EXCLUDED.value, note = EXCLUDED.note
    `).run(uuid(), sessionId, careRecipientId, c.topic, c.ref, c.value, c.note, userId);
  }
}

/**
 * What the answers set in motion, after the visit has closed. Never throws.
 *  · a dose marked taken or refused closes its task occurrence (only if still pending — history
 *    is never rewritten);
 *  · a fall or near-fall becomes a needs-attention note for the team and a safety flag for Pete.
 */
async function applySideEffects(db, { sessionId, careRecipientId, userId, clean, caregiverName, recipientFirstName }) {
  const out = { tasksClosed: 0, flagged: false };
  for (const c of clean) {
    if (c.topic !== "med" || !c.row.occurrenceId) continue;
    if (c.value !== "taken" && c.value !== "refused") continue;
    try {
      const r = await db.prepare(`
        UPDATE care_task_occurrences
           SET status = ?, completed_at = NOW(), recorded_by = ?, completed_by_user_id = ?, note = COALESCE(note, ?)
         WHERE id = ? AND status = 'pending'
      `).run(c.value === "taken" ? "done" : "skipped", userId, userId,
        c.value === "refused" ? `Refused (visit report)${c.note ? `: ${c.note}` : ""}` : c.note, c.row.occurrenceId);
      if (r && r.changes === 1) out.tasksClosed += 1;
    } catch (e) { report(e, "close task"); }
  }

  const fall = clean.find((c) => c.topic === "fall" && (c.value === "fall" || c.value === "near"));
  if (fall) {
    out.flagged = true;
    const what = fall.value === "fall" ? "a fall" : "a near-fall";
    const content = `${caregiverName} reported ${what} during today's visit.${fall.note ? ` ${fall.note}` : ""}`;
    try {
      const noteId = uuid();
      await db.prepare(`
        INSERT INTO recipient_notes (id, care_recipient_id, author_id, content, note_type, needs_attention)
        VALUES (?, ?, ?, ?, 'observation', 1)
      `).run(noteId, careRecipientId, userId, content);
      const cr = await db.prepare("SELECT family_user_id FROM care_recipients WHERE id = ?").get(careRecipientId);
      await db.prepare(
        "INSERT INTO activity_feed (id, family_user_id, care_recipient_id, event_type, title, message, metadata) VALUES (?, ?, ?, 'observation_attention', ?, NULL, ?)"
      ).run(uuid(), cr ? cr.family_user_id : null, careRecipientId,
        `⚠️ ${caregiverName} flagged something about ${recipientFirstName}`,
        JSON.stringify({ type: "observation_attention", careRecipientId, noteId, sessionId, page: "care-profile" }));
      const { usersWithCapability } = require("./access");
      const { CAP } = require("./capabilities");
      const { sendPushToUser } = require("../routes/push");
      const ids = new Set(await usersWithCapability(db, careRecipientId, CAP.READ_NOTES));
      ids.delete(userId);
      for (const id of ids) {
        // No PHI on the lock screen: the word "fall" stays inside the app.
        sendPushToUser(id, {
          title: `⚠️ Needs attention — ${recipientFirstName}`,
          body: `${caregiverName} — tap to read`,
          tag: `note-${noteId.slice(0, 8)}`,
          data: { type: "observation_attention", careRecipientId, noteId, page: "care-profile" },
        }, "observation_attention").catch(() => {});
      }
    } catch (e) { report(e, "fall note"); }
    try {
      const flagId = uuid();
      await db.prepare(`
        INSERT INTO safety_flags (id, user_id, flag_type, user_message, status, severity, created_at)
        VALUES (?, ?, 'visit_report_fall', ?, 'pending', ?, NOW())
      `).run(flagId, userId, `[VISIT REPORT] ${content} (session ${String(sessionId).slice(0, 8)})`.slice(0, 2000),
        fall.value === "fall" ? "high" : "medium");
      const { notifyAdmins } = require("../routes/push");
      notifyAdmins("safety_flag", {
        title: "🚨 Visit report flagged",
        body: `${caregiverName} reported something that needs review. Tap to see.`,
        data: { type: "safety_flag", flagId },
      });
    } catch (e) { report(e, "fall flag"); }
  }
  return out;
}

function report(e, where) {
  try { require("./sentry").captureException(e, { where: `visitReport: ${where}` }); } catch { /* ignore */ }
}

/**
 * The report as the family reads it: answered rows with labels, what is a concern, and what
 * changed since the previous report for this person.
 */
async function reportForDisplay(db, sessionId) {
  const answers = await db.prepare(
    "SELECT topic, ref, value, note FROM visit_report_answers WHERE session_id = ?"
  ).all(sessionId);
  if (!answers.length) return null;
  const v = await loadVisit(db, sessionId);
  const firstAt = await db.prepare("SELECT MIN(created_at) AS at FROM visit_report_answers WHERE session_id = ?").get(sessionId);
  const prev = v ? await previousFlags(db, v, new Date(firstAt.at)).catch(() => null) : null;
  // Titles for meds and appointments come from their own tables.
  const taskIds = [...new Set(answers.filter((a) => a.topic === "med").map((a) => a.ref.split(":")[0]))];
  const eventIds = answers.filter((a) => a.topic === "appt").map((a) => a.ref);
  const titles = new Map();
  if (taskIds.length) {
    for (const t of await db.prepare(`SELECT id, title FROM care_tasks WHERE id IN (${taskIds.map(() => "?").join(",")})`).all(...taskIds)) titles.set(`med|${t.id}`, t.title);
  }
  if (eventIds.length) {
    for (const e of await db.prepare(`SELECT id, title FROM care_events WHERE id IN (${eventIds.map(() => "?").join(",")})`).all(...eventIds)) titles.set(`appt|${e.id}`, e.title);
  }
  const prevByKey = new Map((prev ? prev.answers : []).map((a) => [rowKey(a.topic, a.ref), a.value]));
  const items = answers.map((a) => {
    const def = CATALOG[a.topic];
    const o = optionOf(a.topic, a.value);
    const title = a.topic === "med" ? titles.get(`med|${a.ref.split(":")[0]}`)
      : a.topic === "appt" ? titles.get(`appt|${a.ref}`) : null;
    const label = def ? (title || def.short(a.ref, title ? { title } : null)) : a.topic;
    const before = prevByKey.get(rowKey(a.topic, a.ref));
    return {
      topic: a.topic, ref: a.ref, group: def ? def.group : "other", label,
      value: a.value, answer: o ? o.label : a.value, note: a.note || null,
      concern: !!(o && o.concern), watch: !!(o && o.watch),
      skipped: a.value === NA.value,
      changedFrom: before && before !== a.value ? (optionOf(a.topic, before)?.label || before) : null,
    };
  });
  const order = (x) => FOLLOW_ORDER.indexOf(x.topic);
  return {
    groups: GROUPS.map((g) => ({ ...g, items: items.filter((i) => i.group === g.id).sort((a, b) => order(a) - order(b)) }))
      .filter((g) => g.items.length),
    concerns: items.filter((i) => i.concern).length,
  };
}

module.exports = {
  CATALOG, GROUPS, NA,
  buildReportForm, checkAnswers, saveAnswers, applySideEffects, reportForDisplay,
  _internal: { loadVisit, buildRows, previousFlags, optionOf, rowKey },
};
