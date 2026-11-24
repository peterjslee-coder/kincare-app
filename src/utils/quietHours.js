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

async function recordHeld(db, userId, notificationId = null) {
  await db.prepare(`
    INSERT INTO quiet_hours_held (user_id, held_count, first_held_at, last_held_at)
    VALUES (?, 1, NOW(), NOW())
    ON CONFLICT (user_id) DO UPDATE
      SET held_count = quiet_hours_held.held_count + 1, last_held_at = NOW()
  `).run(userId);
  // v1.119.1 — remember WHICH notification was held, not only that one was. Pete (0783ec12):
  // "I got a push notification that there was one update while I was away. I clicked on it…
  // I have no idea what it was." The count alone could say "1 update" and nothing more.
  if (notificationId) {
    await db.prepare(
      "UPDATE notifications SET quiet_held_at = NOW() WHERE id = ? AND user_id = ?"
    ).run(notificationId, userId);
  }
}

const SUMMARY_ITEMS_MAX = 20;  // listed in Activity
const SUMMARY_TITLES_SHOWN = 2; // named in the push body before "and N more"

function parseData(raw) {
  if (!raw) return null;
  if (typeof raw === "object") return raw;
  try { return JSON.parse(raw); } catch { return null; }
}

/**
 * The summary push for one person, from the notifications that were held for them.
 *
 * Only TITLES are repeated. Every push title already passes the no-PHI-on-lock-screens gate
 * (v1.105.39) because each of these was about to be shown on that same lock screen; bodies
 * are not, so they stay out. One held item: the push opens that item, as the original would
 * have. Several: it opens Home, where Activity lists them (`inAppData.items`).
 *
 * @param {Array<{id,title,type,data,created_at}>} items held notifications, oldest first
 * @param {number} heldCount how many were held, which can exceed items.length if an in-app
 *   row failed to write
 */
function buildQuietSummary(items, heldCount) {
  const list = (items || []).filter((i) => i && i.title);
  const n = Math.max(Number(heldCount) || 0, list.length);
  const tag = "quiet-hours-summary";
  const title = "While you were away";
  if (list.length === 0) {
    return {
      title, tag,
      body: n === 1 ? "1 update came in during quiet hours." : `${n} updates came in during quiet hours.`,
      data: { type: "quiet_hours_summary", page: "dashboard" },
      inAppData: { type: "quiet_hours_summary", page: "dashboard", items: [] },
    };
  }
  const titles = list.map((i) => String(i.title).trim());
  let body;
  if (n === 1) body = titles[0];
  else if (titles.length <= 3 && titles.length === n) body = `${n} updates: ${titles.join(" · ")}`;
  else {
    const named = titles.slice(0, SUMMARY_TITLES_SHOWN);
    body = `${n} updates: ${named.join(" · ")} · and ${n - named.length} more`;
  }

  const shown = list.slice(-SUMMARY_ITEMS_MAX).map((i) => ({
    id: i.id, title: i.title, type: i.type || "general",
    data: parseData(i.data), at: i.created_at || null,
  }));
  const single = n === 1 ? shown[0] : null;
  const data = single
    ? { ...(single.data || {}), type: (single.data && single.data.type) || single.type }
    : { type: "quiet_hours_summary", page: "dashboard" };
  return { title, tag, body, data, inAppData: { type: "quiet_hours_summary", page: "dashboard", items: shown } };
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
    // Claim the held rows for this summary. A push held in the instant between the delete and
    // this claim is listed here AND counted toward the next summary; the next one then falls
    // back to the count-only wording for it. Listing a thing once too often beats losing it.
    let items = [];
    try {
      items = await db.prepare(`
        UPDATE notifications SET quiet_summarized_at = NOW()
         WHERE user_id = ? AND quiet_held_at IS NOT NULL AND quiet_summarized_at IS NULL
        RETURNING id, title, type, data, created_at
      `).all(r.user_id);
      items.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    } catch { items = []; } // the count-only summary is still better than none
    const s = buildQuietSummary(items, n);
    await pushFn(r.user_id, {
      title: s.title, body: s.body, tag: s.tag, data: s.data, inAppData: s.inAppData,
    }, "quiet_hours_summary");
    sent++;
  }
  return sent;
}

module.exports = { EXEMPT, parseQuietHours, isQuietNow, isExempt, shouldHold, recordHeld, buildQuietSummary, sendQuietHourSummaries };
