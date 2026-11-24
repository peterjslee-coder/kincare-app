// ─── One row per conversation, not one per message (v1.105.176) ───
//
// Pete: "i get notifications for debbie leaving a note, and the deep link takes me right
// there. but I don't see her note in the activity. why not? is that a design or oversight?"
//
// Oversight, and it is arithmetic. /api/push/notifications returned the N most recent
// notifications of every kind, and the Activity card asks for ten. On his account that is 103
// message notifications against 5 about a note — so Debbie's three notes from the previous day
// sat at positions 10, 11 and 12, one place past the cut, and never reached the client at all.
// A note was visible in Activity for about as long as it took the next few messages to arrive.
//
// Messages are the only kind that arrive in bursts, and the only kind that already have a whole
// screen of their own and an unread badge. So they group and nothing else does.
//
// In its own module, not inside routes/push.js, for the reason utils/presence.js gives: that
// file cannot be required under jest (it pulls in the auth middleware, which needs a secret),
// and a rule that can only be source-matched is a rule nobody has actually run.

// video_call notifications are message-shaped — same conversation, same burstiness.
const MESSAGE_TYPES = new Set(["message", "video_call"]);

/**
 * Collapse message notifications by conversation, leaving everything else alone.
 *
 * Every returned row carries `ids` (all the notifications it stands for) and `count`, so the
 * client never has to test whether a row is a group — marking one read clears all of them.
 *
 * @param {Array} rows notifications, newest first
 * @param {number} limit how many rows to return after grouping
 */
function groupNotifications(rows, limit) {
  const out = [];
  const groupIndex = new Map(); // "type:conversationId" -> index in `out`

  for (const n of rows || []) {
    let data = null;
    try {
      data = n.data ? (typeof n.data === "string" ? JSON.parse(n.data) : n.data) : null;
    } catch {
      data = null; // one malformed row must not take down the whole feed
    }
    const convId = data && data.conversationId;

    // A note, a visit, a reimbursement — each is its own event, and collapsing them would hide
    // exactly the thing this endpoint exists to show.
    if (!MESSAGE_TYPES.has(n.type) || !convId) {
      out.push({ ...n, ids: [n.id], count: 1 });
      continue;
    }

    const key = `${n.type}:${convId}`;
    const at = groupIndex.get(key);
    if (at === undefined) {
      // The newest row leads, so the group keeps its real timestamp and its deep link.
      groupIndex.set(key, out.length);
      out.push({ ...n, ids: [n.id], count: 1 });
    } else {
      const g = out[at];
      g.ids.push(n.id);
      g.count += 1;
      if (!n.read) g.read = 0; // a group holding one unread message is unread
      g.body = `${g.count} messages`;
    }
  }

  return out.slice(0, limit);
}

module.exports = { groupNotifications, MESSAGE_TYPES };
