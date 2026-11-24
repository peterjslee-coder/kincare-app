// ─── Keeping the app icon honest (v1.105.44) ───
//
// Pete, 8/6: "Sara texted… it went back to 2. But I don't know what the two things are and
// now it won't clear."
//
// The number going UP proved delivery works. It not coming back DOWN was a plumbing bug
// with two halves, and both are the same mistake: the correction was attached to one
// specific place instead of to the fact that the count changed.
//
//   1. The only trigger was GET /api/push/attention. On iOS that endpoint was never
//      called: refreshAppBadge() bailed out at `typeof navigator.setAppBadge !== 'function'`
//      BEFORE fetching, and WKWebView has no setAppBadge. The dashboard's AttentionCard
//      called it, which is why the 78 cleared at all — but tap a push and you land in
//      Messages, never mounting that card, so nothing ever asked.
//
//   2. Even when it did fire, it ran inside `authenticate` — i.e. BEFORE the route
//      handler. Reading a thread sets last_read_at in the handler, so the sync saw the
//      pre-read count and pushed the number that was already on the icon.
//
// So the correction now hangs off every authenticated request, on `finish` — after the
// handler has done whatever it did. Whatever you just cleared, the next request corrects
// the icon, from any screen, with no component involved.
//
// Debounced per user, leading + trailing. The trailing edge matters more than the leading
// one: a burst of "load conversations, open thread, mark read" must end with a sync that
// sees the FINAL state, and a plain cooldown would drop exactly that one and leave the
// badge stale until the next request — which, if the user just put the phone down, is
// never. That is the bug above, rebuilt.

const MIN_INTERVAL_MS = 10000;
const MAX_TRACKED = 5000;

const state = new Map(); // userId → { last: epochMs, timer: Timeout|null }

// ─── Push the true badge to a user's iOS devices ───
// Silent and badge-only: no alert, no sound, nothing on the lock screen — iOS just applies
// the number. Web-push subscriptions are skipped; the service worker sets their badge from
// the page. Sends only when the number CHANGED (push_subscriptions.last_badge), because
// Apple throttles background pushes and a push per request would deserve it.
async function syncBadgeToDevices(db, userId, total) {
  const apns = require("./apns");
  if (!apns.isConfigured()) return;
  const n = Math.max(0, Number(total) || 0);

  const subs = await db.prepare(
    "SELECT id, subscription_json, last_badge FROM push_subscriptions WHERE user_id = ?"
  ).all(userId);

  for (const sub of subs) {
    try {
      const subObj = JSON.parse(sub.subscription_json);
      if (subObj.type !== "native" || subObj.platform !== "ios") continue;
      if (sub.last_badge === n) continue; // device already shows the right number
      await apns.sendApnsBadge(subObj.token, n);
      await db.prepare("UPDATE push_subscriptions SET last_badge = ? WHERE id = ?").run(n, sub.id);
    } catch (e) {
      if (e && e.statusCode === 410) {
        try { await db.prepare("DELETE FROM push_subscriptions WHERE id = ?").run(sub.id); } catch {}
      }
      // Otherwise swallow: a badge is never worth a failed request.
    }
  }
}

async function _run(userId) {
  try {
    const apns = require("./apns");
    // Defensive: under jest's module registry this can be a partial/mocked object.
    if (typeof apns.isConfigured !== "function" || !apns.isConfigured()) return;
    const { getDb } = require("../models/database");
    const { attentionCountFor } = require("./attention");
    const db = await getDb();
    const { total } = await attentionCountFor(db, userId);
    await syncBadgeToDevices(db, userId, total);
  } catch (e) {
    console.log("[badgeSync] non-blocking failure:", e.message);
  }
}

function _prune() {
  if (state.size <= MAX_TRACKED) return;
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [id, s] of state) {
    if (!s.timer && s.last < cutoff) state.delete(id);
  }
}

/**
 * Note that this user's attention count may have changed. Fire-and-forget; never awaited,
 * never throws, never touches the response.
 */
function touchBadge(userId) {
  if (!userId) return;
  const now = Date.now();
  let s = state.get(userId);
  if (!s) { s = { last: 0, timer: null }; state.set(userId, s); _prune(); }

  if (now - s.last >= MIN_INTERVAL_MS) {
    s.last = now;
    _run(userId);
    return;
  }
  if (s.timer) return; // a trailing run is already booked
  s.timer = setTimeout(() => {
    s.timer = null;
    s.last = Date.now();
    _run(userId);
  }, MIN_INTERVAL_MS - (now - s.last));
  if (s.timer.unref) s.timer.unref(); // never hold the process open for a badge
}

// For tests
function _reset() {
  for (const s of state.values()) if (s.timer) clearTimeout(s.timer);
  state.clear();
}

module.exports = { touchBadge, syncBadgeToDevices, _reset, MIN_INTERVAL_MS };
