// ─── care_sessions.notifications_sent — one column, three writers, two formats ───
//
// This column is the only thing standing between a caregiver running ten minutes over and
// the family's phone buzzing once a minute until she checks out. On 2026-08-22 it failed,
// and Pete got 28 notifications for a single 90-minute visit: check_out_imminent five times
// (13:55–13:59) and overdue_check_out_family twenty-three times (14:15–14:37), one per
// minute, each one replacing the last on his lock screen. The "Session Complete" push he
// said he never received arrived at 14:38 — at the tail of that stream, carrying the same
// notification tag, indistinguishable from the twenty-three before it.
//
// The column was being written three different ways:
//
//   push.js  sendSessionReminders  JSON.stringify(["pre_check_in", ...])   ← JSON array
//   push.js  sendArrivalSms        COALESCE(...) || ' '  || 'arrival_sms_60'  ← space-joined
//   accountability.js              COALESCE(...) || ',checkin_nudge'          ← comma-joined
//
// The SQL guards are all `NOT LIKE '%token%'`, which does not care about the format. The
// JavaScript did: `JSON.parse(session.notifications_sent)` threw the moment any non-JSON
// writer had touched the row. That throw was caught by the function's own outer catch —
// AFTER the pushes had already gone out and BEFORE the line that records them as sent. So
// every poll re-sent, forever, and the only trace was a console line.
//
// The lesson is not "use JSON". It is that a value written by three places and parsed by
// one is a format negotiation nobody held. This module is that negotiation.
//
// Canonical write format is comma-joined, because that is what the existing
// `REPLACE(notifications_sent, ',no_show_flagged', '')` in admin/sessionOps.js expects and
// what the `|| ',token'` appends already produce. Reads accept anything.

/**
 * Every token recorded on a session, whatever shape it was written in.
 * Accepts a JSON array, a comma-joined string, a space-joined string, or any mixture.
 * Never throws — an unreadable value means "nothing recorded", which is the safe answer
 * for a caller deciding whether to send, and is what the old code MEANT to fall back to.
 */
function parseSent(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter(Boolean).map(String);

  const text = String(raw).trim();
  if (!text) return [];

  if (text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed.filter(Boolean).map(String);
    } catch {
      // fall through — a truncated or malformed array is still worth splitting
    }
  }

  return text
    .replace(/[[\]"']/g, " ")
    .split(/[,\s]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Has this token already been recorded? */
function hasSent(raw, token) {
  return parseSent(raw).includes(token);
}

/**
 * The column's new value with `token` recorded, in the canonical comma-joined form.
 * Idempotent: appending a token that is already present returns the normalised string
 * unchanged, so a retry cannot grow the column without bound.
 */
function appendSent(raw, token) {
  const tokens = parseSent(raw);
  if (token && !tokens.includes(token)) tokens.push(token);
  return tokens.join(",");
}

module.exports = { parseSent, hasSent, appendSent };
