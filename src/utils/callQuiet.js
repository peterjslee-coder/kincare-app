// ─── v1.163.0 — call through her quiet hours (Pete, 11/25) ───
//
// "let's put a call through feature on. if I call during quiet hours twice within a minute, it
// rings through."
//
// Whose quiet hours: a person who is someone's care recipient (her account is linked to a care
// record). Two windows count, and either one is enough:
//   • her Hub's night hours (Hub on; "the screen goes dark after…" in Hub settings), read in the
//     care location's time zone, and
//   • her own quiet hours (users.notification_prefs.quiet_hours, utils/quietHours.js).
// During them a call to her rings nowhere: no phone, no Hub, no push. The caller is told so,
// and that a second call from them within a minute rings through. A drop-in is not a call and
// is not changed here.
//
// The memory of "first try" is in this process, like the call registry and the rate limit:
// one Railway replica (CLAUDE.md, known limitation 7). A restart forgets a first try, which
// only means the next call is a first try again.

const { parseQuietHours, isQuietNow } = require("./quietHours");

const RING_THROUGH_MS = 60 * 1000;
const firstTries = new Map(); // `${callerId}:${targetId}` -> ms of the held call

/** Is `targetUserId` in quiet hours now? → { quiet, until } (until = "HH:MM" local, for words). */
async function quietFor(db, targetUserId, now = new Date()) {
  const { recipientForLinkedUser } = require("./linkedAccount");
  const cr = await recipientForLinkedUser(db, targetUserId, "cr.id, cr.simple_mode, cr.timezone");
  if (!cr) return { quiet: false };
  const { parseSimpleMode } = require("./simpleMode");
  const hub = parseSimpleMode(cr.simple_mode).hub;
  if (hub && hub.on) {
    const q = { start: hub.dimFrom, end: hub.dimTo, tz: cr.timezone || "America/New_York" };
    if (q.start !== q.end && isQuietNow(q, now)) return { quiet: true, until: q.end };
  }
  const u = await db.prepare("SELECT notification_prefs FROM users WHERE id = ?").get(targetUserId);
  let prefs = u && u.notification_prefs;
  if (typeof prefs === "string") { try { prefs = JSON.parse(prefs); } catch { prefs = null; } }
  const own = parseQuietHours(prefs);
  if (own && isQuietNow(own, now)) return { quiet: true, until: own.end };
  return { quiet: false };
}

/**
 * During quiet hours: the first call from this caller is held ("hold"); a second one within a
 * minute rings through ("through") and the slate is wiped, so a third call starts over.
 */
function ringThrough(callerId, targetUserId, nowMs = Date.now()) {
  for (const [k, t] of firstTries) if (nowMs - t > RING_THROUGH_MS) firstTries.delete(k);
  const key = `${callerId}:${targetUserId}`;
  const first = firstTries.get(key);
  if (first && nowMs - first <= RING_THROUGH_MS) { firstTries.delete(key); return "through"; }
  firstTries.set(key, nowMs);
  return "hold";
}

const _reset = () => firstTries.clear();

module.exports = { quietFor, ringThrough, RING_THROUGH_MS, _reset };
