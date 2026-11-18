/**
 * What Checkr has actually told us — the evidence behind every background-check claim. (v1.131.0)
 *
 * Pete, 11/18: "It currently says her report has been submitted and we are awaiting results.
 * Like what evidence do we have that that was ever happening. ... I want webhooks that fire that
 * confirm things to be true before we claim reports are submitted or have come back clear or
 * whatever. Not just vibes."
 *
 * He was right: Faith's profile carried checkr_status = 'pending' — the column default — and
 * the hub read 'pending' as "in progress". Checkr had never heard of her.
 *
 * The rule this file enforces: a background-check step is shown as done only when there is a row
 * here, and a row is written only for something that came FROM Checkr:
 *
 *   source 'webhook'  a POST to /api/checkr/webhook whose HMAC signature verified
 *   source 'api'      Checkr's own API answering us — the invitation it created (with its id),
 *                     or a report we read back from GET /reports/:id
 *
 * Statuses InPlace writes on its own ('initiated', the old 'pending') never produce a row.
 *
 * The three facts screens are allowed to claim, and what each one needs:
 *
 *   sent       Checkr created an invitation (API response with an id, or invitation.created)
 *   submitted  she filled the form in (invitation.completed or report.created webhook)
 *   result     a report finished (report.completed webhook, or the report read from the API)
 */
const { v4: uuid } = require("uuid");

const SENT_TYPES = ["invitation.created"];
const SUBMITTED_TYPES = ["invitation.completed", "report.created"];
const RESULT_TYPES = ["report.completed"];

/**
 * Record one thing Checkr told us. Idempotent on Checkr's own event id (Checkr retries webhooks).
 * Resolves the InPlace user from whichever Checkr id it can. Never throws — a failure to write
 * evidence must not take down the webhook that is reporting it — but it is logged loudly.
 */
async function recordCheckrEvent(db, ev) {
  try {
    let userId = ev.userId || null;
    if (!userId && (ev.candidateId || ev.invitationId || ev.reportId)) {
      const row = await db.prepare(
        `SELECT user_id FROM caregiver_profiles
          WHERE (checkr_candidate_id IS NOT NULL AND checkr_candidate_id = ?)
             OR (checkr_invitation_id IS NOT NULL AND checkr_invitation_id = ?)
             OR (checkr_report_id IS NOT NULL AND checkr_report_id = ?)
          LIMIT 1`
      ).get(ev.candidateId || "", ev.invitationId || "", ev.reportId || "");
      userId = row ? row.user_id : null;
    }
    const res = await db.prepare(
      `INSERT INTO checkr_events
         (id, source, event_type, checkr_event_id, user_id, candidate_id, invitation_id, report_id, object_status, result)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT DO NOTHING`
    ).run(
      uuid(), ev.source, ev.type, ev.eventId || null, userId,
      ev.candidateId || null, ev.invitationId || null, ev.reportId || null,
      ev.status || null, ev.result || null
    );
    return { recorded: (res && res.changes) > 0, userId };
  } catch (e) {
    console.error("[checkr-evidence] failed to record", ev.type, e.message);
    return { recorded: false, userId: ev.userId || null };
  }
}

/** The earliest row of any of these types, or null. */
function firstOf(rows, types) {
  const hit = rows.filter((r) => types.includes(r.event_type));
  if (!hit.length) return null;
  hit.sort((a, b) => new Date(a.received_at) - new Date(b.received_at));
  return hit[0];
}

/** The latest row of any of these types, or null. */
function lastOf(rows, types) {
  const hit = rows.filter((r) => types.includes(r.event_type));
  if (!hit.length) return null;
  hit.sort((a, b) => new Date(b.received_at) - new Date(a.received_at));
  return hit[0];
}

/**
 * Summarise the evidence for one caregiver.
 * @returns {{ sentAt, submittedAt, resultAt, result, reportId, events: Array }}
 *   Each *At is a timestamp from a row Checkr gave us, or null when Checkr has not confirmed it.
 */
async function evidenceFor(db, userId) {
  const rows = await db.prepare(
    `SELECT source, event_type, invitation_id, report_id, object_status, result, received_at
       FROM checkr_events WHERE user_id = ? ORDER BY received_at ASC LIMIT 200`
  ).all(userId);
  return summarise(rows);
}

function summarise(rows) {
  const sent = firstOf(rows, SENT_TYPES);
  const submitted = firstOf(rows, SUBMITTED_TYPES);
  const done = lastOf(rows, RESULT_TYPES);
  return {
    sentAt: sent ? sent.received_at : null,
    submittedAt: submitted ? submitted.received_at : null,
    resultAt: done ? done.received_at : null,
    result: done ? (done.result || done.object_status || null) : null,
    reportId: done ? done.report_id : null,
    events: rows.map((r) => ({
      type: r.event_type, source: r.source, at: r.received_at,
      status: r.object_status || null, result: r.result || null,
    })),
  };
}

/** Evidence for many caregivers in one query (admin list, outreach ladder). Map userId → summary. */
async function evidenceForMany(db, userIds) {
  const out = new Map();
  if (!userIds.length) return out;
  const ph = userIds.map(() => "?").join(",");
  const rows = await db.prepare(
    `SELECT user_id, source, event_type, invitation_id, report_id, object_status, result, received_at
       FROM checkr_events WHERE user_id IN (${ph}) ORDER BY received_at ASC`
  ).all(...userIds);
  const by = new Map();
  for (const r of rows) {
    if (!by.has(r.user_id)) by.set(r.user_id, []);
    by.get(r.user_id).push(r);
  }
  for (const id of userIds) out.set(id, summarise(by.get(id) || []));
  return out;
}

/**
 * Tell every real admin — activity feed (names allowed: it is behind the unlock) and a push
 * (no names: tests/pushPhi.test.js — a background check is nobody's business on a lock screen).
 * Never throws.
 */
async function notifyAdmins(db, { eventType, title, message, pushTitle, pushBody, metadata }) {
  try {
    const admins = await db.prepare(
      "SELECT id FROM users WHERE is_admin = 1 AND COALESCE(is_demo, 0) = 0"
    ).all();
    for (const admin of admins) {
      await db.prepare(
        "INSERT INTO activity_feed (id, family_user_id, event_type, title, message, metadata) VALUES (?, ?, ?, ?, ?, ?)"
      ).run(uuid(), admin.id, eventType, title, message, JSON.stringify(metadata || {}));
    }
    const { sendPushToUser } = require("./push");
    for (const admin of admins) {
      await sendPushToUser(db, admin.id, pushTitle, pushBody, { type: eventType, page: "admin" }).catch(() => {});
    }
  } catch (e) {
    console.error("[checkr-evidence] admin notify failed:", e.message);
  }
}

module.exports = {
  recordCheckrEvent, evidenceFor, evidenceForMany, summarise, notifyAdmins,
  SENT_TYPES, SUBMITTED_TYPES, RESULT_TYPES,
};
