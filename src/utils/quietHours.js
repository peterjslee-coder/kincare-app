// ─── Quiet hours (v1.107.3) ───
//
// Pete, Sep 16: "Need a quiet hours option to prevent notifications selectable by
// user/family." His decisions:
//   • each person sets their own window, in the time zone of the phone that set it;
//   • still delivered during it: safety flags, visit problems (late / no-show, missed
//     check-in or check-out), and payment action needed;
//   • everything else — incoming video calls included — is held;
//   • held pushes become ONE summary push when the window ends. The in-app Activity record
//     is still written as each thing happens; only the buzz is held.
//
// Stored on users.notification_prefs as:
//   quiet_hours: { enabled: true, start: "22:00", end: "07:00", tz: "America/New_York" }

// What still gets through. Matched against the push's eventType AND its data.type, because
// several senders pass only one of the two.
const EXEMPT = new Set([
  // safety
  "safety_flag", "observation_attention", "content_report", "block_request",
  // visit problems
  "caregiver_no_show", "no_show_cancelled",
  "overdue_check_in", "overdue_check_in_family",
  "overdue_check_out", "overdue_check_out_family",
  "checkin_nudge",
  // payment action needed
  "payment_authorization_failed", "payment_method_needed", "payment_hold",
  "payment_auth_required", "payment_failed", "payment_needed",
]);

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

function parseQuietHours(prefs) {
  const q = prefs && prefs.quiet_hours;
  if (!q || !q.enabled) return null;
  if (!HHMM.test(String(q.start)) || !HHMM.test(String(q.end))) return null;
  if (q.start === q.end) return null; // a zero-length window is "off", not "always"
  let tz = typeof q.tz === "string" && q.tz ? q.tz : "America/New_York";
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); } catch { tz = "America/New_York"; }
  return { start: q.start, end: q.end, tz };
}

const toMinutes = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };

/** Minutes past local midnight in `tz` at instant `now`. */
function localMinutes(now, tz) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === "hour").value);
  const m = Number(parts.find((p) => p.type === "minute").value);
  return (h % 24) * 60 + m;
}

/** Is `now` inside the window? Handles windows that cross midnight (22:00–07:00). */
function isQuietNow(q, now = new Date()) {
  if (!q) return false;
  const t = localMinutes(now, q.tz);
  const s = toMinutes(q.start);
  const e = toMinutes(q.end);
  return s < e ? (t >= s && t < e) : (t >= s || t < e);
}

function isExempt(eventType, payload) {
  const t = payload && payload.data && payload.data.type;
  return EXEMPT.has(eventType) || (t && EXEMPT.has(t));
}

/** Should this push be held for this user right now? */
function shouldHold(prefsRaw, eventType, payload, now = new Date()) {
  let prefs = prefsRaw;
  if (typeof prefsRaw === "string") { try { prefs = JSON.parse(prefsRaw); } catch { return false; } }
  const q = parseQuietHours(prefs);
  if (!q || !isQuietNow(q, now)) return false;
  return !isExempt(eventType, payload);
}

async function recordHeld(db, userId) {
  await db.prepare(`
    INSERT INTO quiet_hours_held (user_id, held_count, first_held_at, last_held_at)
    VALUES (?, 1, NOW(), NOW())
    ON CONFLICT (user_id) DO UPDATE
      SET held_count = quiet_hours_held.held_count + 1, last_held_at = NOW()
  `).run(userId);
}

/**
 * Send one summary to everyone whose window has ended and who has something waiting.
 * Poller 114. A row is deleted only with the count it was read with, so a push held between
 * the read and the delete stays for the next summary instead of vanishing.
 */
async function sendQuietHourSummaries(db, pushFn, now = new Date()) {
  const rows = await db.prepare(`
    SELECT q.user_id, q.held_count, u.notification_prefs
      FROM quiet_hours_held q JOIN users u ON u.id = q.user_id
     WHERE q.held_count > 0
  `).all();
  let sent = 0;
  for (const r of rows) {
    let prefs = null;
    try { prefs = r.notification_prefs ? JSON.parse(r.notification_prefs) : null; } catch { prefs = null; }
    if (isQuietNow(parseQuietHours(prefs), now)) continue; // still quiet — keep waiting
    const n = Number(r.held_count);
    const gone = await db.prepare(
      "DELETE FROM quiet_hours_held WHERE user_id = ? AND held_count = ?"
    ).run(r.user_id, n);
    if (!gone || gone.changes !== 1) continue;
    await pushFn(r.user_id, {
      title: "While you were away",
      body: n === 1 ? "1 update came in during quiet hours." : `${n} updates came in during quiet hours.`,
      tag: "quiet-hours-summary",
      data: { type: "quiet_hours_summary", page: "dashboard" },
    }, "quiet_hours_summary");
    sent++;
  }
  return sent;
}

module.exports = { EXEMPT, parseQuietHours, isQuietNow, isExempt, shouldHold, recordHeld, sendQuietHourSummaries };
