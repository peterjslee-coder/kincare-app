// ─── v1.156.0 — "Betty was up from about 2 to 5 AM" ───
//
// Pete, 11/24: "if she was awake from 2 to 5 AM that Tina should know that when she checks in.
// 'Betty was up for three hours in the middle of the night' so that Tina should expect her to
// nap." And it feeds her care notes as what the Hub noticed — plain times, never an AI's
// reading of them (iPAi cardinal rule: AI output is never ground truth for another AI document).
//
// Built from hub_awake periods (routes/dropIn.js POST /awake). Last night = from the Hub's night
// start yesterday (dimFrom, 9 PM) to its night end today (dimTo, 7 AM), in the care-location
// time zone. Periods less than 30 minutes apart read as one; under 15 minutes in all is not
// worth telling anyone.

const { zonedDateTimeToInstant, getTodayStringInZone } = require("./timezone");
const { addDaysToDateString, localTimeStringInZone } = require("./careEventUtils");

const MERGE_GAP_MIN = 30;
const MIN_TOTAL_MIN = 15;

const fmt = (date, tz) => {
  const [h, m] = localTimeStringInZone(date, tz).split(":").map(Number);
  const ap = h >= 12 ? "PM" : "AM";
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${ap}`;
};

/** Periods she was up last night, merged: [{ from: Date, to: Date, motion, voice }] */
async function lastNight(db, recipientId, tz, dimFrom = "21:00", dimTo = "07:00", todayStr = null) {
  const today = todayStr || getTodayStringInZone(tz);
  const start = zonedDateTimeToInstant(addDaysToDateString(today, -1), dimFrom, tz);
  const end = zonedDateTimeToInstant(today, dimTo, tz);
  const rows = await db.prepare(`
    SELECT started_at, ended_at, motion_minutes, voice_minutes FROM hub_awake
    WHERE care_recipient_id = ? AND ended_at > ? AND started_at < ? ORDER BY started_at
  `).all(recipientId, start.toISOString(), end.toISOString());
  const out = [];
  for (const r of rows) {
    const from = new Date(Math.max(new Date(r.started_at).getTime(), start.getTime()));
    const to = new Date(Math.min(new Date(r.ended_at).getTime(), end.getTime()));
    const last = out[out.length - 1];
    if (last && from.getTime() - last.to.getTime() <= MERGE_GAP_MIN * 60000) {
      last.to = to; last.motion += r.motion_minutes; last.voice += r.voice_minutes;
    } else out.push({ from, to, motion: r.motion_minutes, voice: r.voice_minutes });
  }
  return out;
}

/** One plain sentence, or null when there's nothing worth saying. */
function sentence(firstName, periods, tz) {
  const total = periods.reduce((n, p) => n + (p.to - p.from) / 60000, 0);
  if (!periods.length || total < MIN_TOTAL_MIN) return null;
  const parts = periods.map((p) => ((p.to - p.from) / 60000 < 20 ? `around ${fmt(p.from, tz)}` : `from about ${fmt(p.from, tz)} to ${fmt(p.to, tz)}`));
  const when = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  const hours = total >= 90 ? ` (about ${Math.round(total / 60)} hours)` : "";
  const motion = periods.some((p) => p.motion > 0), voice = periods.some((p) => p.voice > 0);
  const how = motion && voice ? "movement and talking" : motion ? "movement" : voice ? "talking" : "the screen being touched";
  return `${firstName || "They"} was up last night ${when}${hours}. The Hub noticed ${how}.`;
}

async function nightSummary(db, recipient) {
  const { parseSimpleMode } = require("./simpleMode");
  const { mayNotice } = require("./dropIn");
  if (!(await mayNotice(db, recipient.id))) return null;
  const hub = parseSimpleMode(recipient.simple_mode).hub || {};
  const tz = recipient.timezone || "America/New_York";
  const periods = await lastNight(db, recipient.id, tz, hub.dimFrom, hub.dimTo);
  return sentence(recipient.first_name, periods, tz);
}

/**
 * Once each morning (after the Hub's night ends), put last night into her care notes — where
 * iPAi and the team read them — as a plain note "from the Hub". note_type 'hub_night'; at most
 * one per care-location day. Authored by her own account: the Hub is her device.
 */
async function recordNightNote(db, recipient, linkedUserId) {
  if (!linkedUserId) return false;
  const { parseSimpleMode } = require("./simpleMode");
  const { getNowInZone } = require("./timezone");
  const hub = parseSimpleMode(recipient.simple_mode).hub || {};
  const tz = recipient.timezone || "America/New_York";
  const now = getNowInZone(tz);
  const [eh, em] = String(hub.dimTo || "07:00").split(":").map(Number);
  if (now.getHours() * 60 + now.getMinutes() < eh * 60 + em) return false; // the night isn't over
  const today = getTodayStringInZone(tz);
  const dayStart = zonedDateTimeToInstant(today, "00:00", tz);
  const done = await db.prepare(
    "SELECT 1 FROM recipient_notes WHERE care_recipient_id = ? AND note_type = 'hub_night' AND created_at >= ? LIMIT 1"
  ).get(recipient.id, dayStart.toISOString());
  if (done) return false;
  const line = await nightSummary(db, recipient);
  if (!line) return false;
  const { v4: uuid } = require("uuid");
  await db.prepare(
    "INSERT INTO recipient_notes (id, care_recipient_id, author_id, content, note_type) VALUES (?, ?, ?, ?, 'hub_night')"
  ).run(uuid(), recipient.id, linkedUserId, `From the InPlace Hub: ${line}`);
  return true;
}

module.exports = { lastNight, sentence, nightSummary, recordNightNote, MERGE_GAP_MIN, MIN_TOTAL_MIN };
