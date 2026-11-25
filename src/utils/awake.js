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

// ─── v1.159.0 — when the Hub was watching, and the last 24 hours as a timeline ───
// Pete, 11/25: "I need a better way of knowing when it stopped detecting her, like when she
// went to sleep and when it started detecting her again." hub_awake only holds the minutes she
// was noticed. A quiet stretch means asleep ONLY if the Hub was watching then; hub_watch holds
// those stretches, built from the Hub's 2-minute reports.
const WATCH_JOIN_MIN = 6; // three missed 2-minute reports start a new span

async function recordWatching(db, recipientId) {
  const { v4: uuid } = require("uuid");
  const last = await db.prepare("SELECT id, ended_at FROM hub_watch WHERE care_recipient_id = ? ORDER BY ended_at DESC LIMIT 1").get(recipientId);
  if (last && Date.now() - new Date(last.ended_at).getTime() <= WATCH_JOIN_MIN * 60000) {
    await db.prepare("UPDATE hub_watch SET ended_at = NOW() WHERE id = ?").run(last.id);
  } else {
    await db.prepare("INSERT INTO hub_watch (id, care_recipient_id, started_at, ended_at) VALUES (?, ?, NOW() - INTERVAL '2 minutes', NOW())").run(uuid(), recipientId);
  }
}

/**
 * The last `hours`, oldest first, as one list a person can read down:
 *   { kind: 'up',  from, to, fromLabel, toLabel, motion, talking, touches }
 *   { kind: 'quiet', ... }      — watching, nothing noticed (asleep, or out of the room)
 *   { kind: 'notWatching', ... } — the Hub wasn't watching (no report): unknown
 * Labels are care-location times (CLAUDE.md timezone principle).
 */
async function timeline(db, recipientId, tz, hours = 24, now = new Date()) {
  const since = new Date(now.getTime() - hours * 3600000);
  const ups = await db.prepare(`SELECT started_at, ended_at, motion_minutes, voice_minutes, touches, person_minutes FROM hub_awake
    WHERE care_recipient_id = ? AND ended_at > ? ORDER BY started_at`).all(recipientId, since.toISOString());
  const watches = await db.prepare(`SELECT started_at, ended_at FROM hub_watch
    WHERE care_recipient_id = ? AND ended_at > ? ORDER BY started_at`).all(recipientId, since.toISOString());
  const clip = (d) => new Date(Math.max(since.getTime(), Math.min(now.getTime(), new Date(d).getTime())));
  const out = [];
  const push = (kind, from, to, extra = {}) => {
    if (to.getTime() - from.getTime() < 60000) return; // under a minute is noise
    out.push({ kind, from: from.toISOString(), to: to.toISOString(), fromLabel: fmt(from, tz), toLabel: fmt(to, tz), ...extra });
  };
  // Walk the watched stretches; inside each, split into "up" and "quiet". Between them: not watching.
  let cursor = since;
  const upList = ups.map((u) => ({ from: clip(u.started_at), to: clip(u.ended_at), person: (u.person_minutes || 0) > 0, motion: u.motion_minutes > 0, talking: u.voice_minutes > 0, touches: u.touches > 0 }));
  for (const w of watches) {
    const wf = clip(w.started_at); const wt = clip(w.ended_at);
    if (wf > cursor) push("notWatching", cursor, wf);
    let c = wf > cursor ? wf : cursor;
    for (const u of upList) {
      if (u.to <= c || u.from >= wt) continue;
      const uf = u.from < c ? c : u.from;
      const ut = u.to > wt ? wt : u.to;
      if (uf > c) push("quiet", c, uf);
      push("up", uf, ut, { person: u.person, motion: u.motion, talking: u.talking, touches: u.touches });
      c = ut;
    }
    if (wt > c) push("quiet", c, wt);
    if (wt > cursor) cursor = wt;
  }
  // Noticed while no report said watching (reports started after this shipped): still show it.
  for (const u of upList) {
    const covered = out.some((e) => e.kind === "up" && new Date(e.from) <= u.from && new Date(e.to) >= u.to);
    if (!covered && !watches.some((w) => clip(w.started_at) <= u.from && clip(w.ended_at) >= u.to)) {
      push("up", u.from, u.to, { person: u.person, motion: u.motion, talking: u.talking, touches: u.touches });
    }
  }
  if (now > cursor && watches.length) push("notWatching", cursor, now);
  out.sort((a, b) => a.from.localeCompare(b.from));
  return out;
}

// ─── v1.159.0 — last night in one plain sentence, for the family ───
// Pete, 11/25: 'A simple "Betty was awake until 11 PM and then again from about 4 AM to 6 AM
// last night" is the info I need.' The evening (from 6 PM) through now, stretches less than
// 45 minutes apart joined, times rounded to the quarter hour so it reads like a person said it.
const STORY_JOIN_MIN = 45;
const round15 = (d) => new Date(Math.round(d.getTime() / 900000) * 900000);

async function nightStory(db, recipientId, firstName, tz, now = new Date()) {
  const today = getTodayStringInZone(tz);
  const [hh] = localTimeStringInZone(now, tz).split(":").map(Number);
  const startDay = hh < 18 ? addDaysToDateString(today, -1) : today;
  const start = zonedDateTimeToInstant(startDay, "18:00", tz);
  const rows = await db.prepare(`SELECT started_at, ended_at FROM hub_awake
    WHERE care_recipient_id = ? AND ended_at > ? ORDER BY started_at`).all(recipientId, start.toISOString());
  const ps = [];
  for (const r of rows) {
    const from = new Date(Math.max(new Date(r.started_at).getTime(), start.getTime()));
    const to = new Date(r.ended_at);
    const last = ps[ps.length - 1];
    if (last && from.getTime() - last.to.getTime() <= STORY_JOIN_MIN * 60000) { if (to > last.to) last.to = to; } else ps.push({ from, to });
  }
  const who = firstName || "She";
  if (!ps.length) return `The Hub hasn't noticed ${who} up since 6 PM.`;
  const t = (d) => fmt(round15(d), tz).replace(":00 ", " ");
  const midnight = zonedDateTimeToInstant(addDaysToDateString(startDay, 1), "00:00", tz);
  const was = [];
  let since = null;
  ps.forEach((p, i) => {
    const ongoing = i === ps.length - 1 && now.getTime() - p.to.getTime() < 10 * 60000;
    const evening = i === 0 && p.from < midnight && p.to <= new Date(midnight.getTime() + 3 * 3600000);
    if (ongoing) since = p.from;
    else if (evening) was.push(`awake until about ${t(p.to)}`);
    else was.push(`${was.length ? "up again" : "up"} from about ${t(p.from)} to ${t(p.to)}`);
  });
  const nowBit = since ? `has been up since about ${t(since)}` : "";
  if (!was.length) return `${who} ${nowBit}.`;
  return `${who} was ${was.join(", then ")}${nowBit ? `, and ${nowBit}` : ""}.`;
}

module.exports = { lastNight, sentence, nightSummary, recordNightNote, recordWatching, timeline, nightStory, MERGE_GAP_MIN, MIN_TOTAL_MIN, WATCH_JOIN_MIN };
