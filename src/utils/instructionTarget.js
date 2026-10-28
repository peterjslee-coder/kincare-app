// ─── Which visit does a texted instruction belong to? (v1.125.2) ───
//
// Pete, 10/28 (bba0e539): "when I texted Tina an instruction iPAi asked me if I wanted to add it
// to the caregiver instructions. However, it's showing up as an instruction for today, not
// yesterday. So maybe that feature needs to be smarter on what day specifically the
// instructions need to pin on."
//
// POST /api/ipai/detect-instructions asked the model to pick a visit from a list, and three
// things about that list made the wrong answer the likely one:
//
//   1. The model was never told what day it is. "Tonight", "today", "Tuesday" were resolved
//      against nothing, and the dates carried no weekday.
//   2. The list was filtered by `scheduled_date >= CURRENT_DATE` — the DATABASE's date, which
//      is UTC. From 8pm Eastern on, UTC is already tomorrow, so the visit happening that
//      evening was not on the list at all. The model could only pick the next one.
//   3. `in_progress` was not an allowed status, so a visit Tina was AT was also missing.
//
// And the label the family saw ("For: …") was the model's own wording, so a wrong pick looked
// as authoritative as a right one. The label is now built here from the visit itself, the
// model's id must be one we offered, and the family gets the other candidate visits to switch
// to before anything is saved.

const { getTodayStringInZone, getNowInZone, DEFAULT_TIMEZONE } = require("./timezone");

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const dateOnly = (d) => String(d || "").split("T")[0];

/** "Tue Oct 27" for a YYYY-MM-DD string. Calendar arithmetic only — no time zone involved. */
function dayLabel(dateStr) {
  const [y, m, d] = dateOnly(dateStr).split("-").map(Number);
  if (!y || !m || !d) return String(dateStr || "");
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${DAYS[wd]} ${MONTHS[m - 1]} ${d}`;
}

/** Whole days from `fromStr` to `toStr`, both YYYY-MM-DD. */
function daysBetween(fromStr, toStr) {
  const a = dateOnly(fromStr).split("-").map(Number);
  const b = dateOnly(toStr).split("-").map(Number);
  return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 86400000);
}

function timeLabel(t) {
  if (!t) return "";
  const [h, m] = String(t).split(":").map(Number);
  if (!Number.isFinite(h)) return String(t);
  const ap = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m ? `${h12}:${String(m).padStart(2, "0")}${ap}` : `${h12}${ap}`;
}

/** "today", "tomorrow", "in progress now" — relative to the CARE LOCATION's today. */
function whenWord(visit, todayStr) {
  if (visit.status === "in_progress") return "in progress now";
  const n = daysBetween(todayStr, visit.scheduled_date);
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  return "";
}

/** What the family sees on the card: "Tina — Tue Oct 27, 5pm · today". Built from the row. */
function visitLabel(visit, todayStr) {
  const who = visit.cg_first ? visit.cg_first : "Unassigned visit";
  const t = timeLabel(visit.scheduled_time);
  const w = whenWord(visit, todayStr);
  return `${who} — ${dayLabel(visit.scheduled_date)}${t ? `, ${t}` : ""}${w ? ` · ${w}` : ""}`;
}

/**
 * The visits an instruction could be for: this family's visits from TODAY (care-location
 * time) on, including one underway. When the message was sent in a conversation with a
 * caregiver, only that caregiver's visits — Pete texting Tina is about Tina's visit.
 */
async function candidateVisits(db, userId, { conversationId = null } = {}) {
  // A day of slack on the SQL side (UTC vs Eastern), then the real cut per care time zone.
  const rows = await db.prepare(`
    SELECT cs.id, cs.scheduled_date, cs.scheduled_time, cs.duration_hours, cs.status,
      cs.special_instructions, cs.caregiver_id, cp.user_id AS cg_user_id,
      u_cg.first_name AS cg_first, u_cg.last_name AS cg_last,
      cr.first_name AS cr_first, cr.last_name AS cr_last, cr.timezone AS care_timezone
    FROM care_sessions cs
    LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
    LEFT JOIN users u_cg ON cp.user_id = u_cg.id
    LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
    WHERE cs.family_user_id = ?
      AND cs.status IN ('confirmed', 'pending', 'open', 'requested', 'in_progress')
      AND cs.scheduled_date >= to_char(CURRENT_DATE - 1, 'YYYY-MM-DD')
    ORDER BY cs.scheduled_date ASC, cs.scheduled_time ASC
    LIMIT 30
  `).all(userId);

  let visits = rows.filter((v) => {
    const today = getTodayStringInZone(v.care_timezone || DEFAULT_TIMEZONE);
    return v.status === "in_progress" || dateOnly(v.scheduled_date) >= today;
  });

  if (conversationId) {
    // Only a conversation the sender is IN can narrow the list — an id from anywhere else is
    // ignored, never used to learn who is in someone else's conversation.
    const member = await db.prepare(
      "SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ? LIMIT 1"
    ).get(conversationId, userId);
    if (member) {
      const others = (await db.prepare(
        "SELECT user_id FROM conversation_members WHERE conversation_id = ? AND user_id <> ?"
      ).all(conversationId, userId)).map((r) => r.user_id);
      const theirs = visits.filter((v) => v.cg_user_id && others.includes(v.cg_user_id));
      if (theirs.length) visits = theirs;
    }
  }
  return visits.slice(0, 10);
}

/** The prompt block: today's date stated outright, every visit with its weekday and when-word. */
function describeForModel(visits) {
  const tz = (visits[0] && visits[0].care_timezone) || DEFAULT_TIMEZONE;
  const today = getTodayStringInZone(tz);
  const now = getNowInZone(tz);
  const nowTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const lines = visits.map((v) => {
    const cg = v.cg_first ? `${v.cg_first} ${v.cg_last || ""}`.trim() : "Unassigned";
    const w = whenWord(v, today);
    return `- Session ${v.id}: ${cg} with ${v.cr_first} ${v.cr_last} on ${dayLabel(v.scheduled_date)} (${dateOnly(v.scheduled_date)}) at ${v.scheduled_time || "TBD"}${w ? ` — ${w.toUpperCase()}` : ""} (${v.status})`;
  });
  return {
    today,
    header: `TODAY is ${dayLabel(today)} (${today}), and it is ${nowTime} where the care happens.`,
    list: lines.join("\n"),
  };
}

/**
 * Turn the model's answer into what the client is allowed to see: an id we offered (anything
 * else is dropped), a label built from the row, and the other visits to switch to.
 */
function buildSuggestion(visits, parsed) {
  if (!parsed || !parsed.hasInstructions || !parsed.instructionSummary) return null;
  const pick = visits.find((v) => v.id === parsed.matchedSessionId);
  if (!pick) return null;
  const today = getTodayStringInZone(pick.care_timezone || DEFAULT_TIMEZONE);
  return {
    sessionId: pick.id,
    sessionLabel: visitLabel(pick, today),
    summary: String(parsed.instructionSummary),
    alternatives: visits.slice(0, 6).map((v) => ({
      sessionId: v.id,
      label: visitLabel(v, getTodayStringInZone(v.care_timezone || DEFAULT_TIMEZONE)),
    })),
  };
}

module.exports = { candidateVisits, describeForModel, buildSuggestion, visitLabel, dayLabel, whenWord, daysBetween };
