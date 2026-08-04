// ─── Family visits (v1.105.38) ───
//
// Pete: "how can i check in with mom… make a care session?" — he couldn't. Check-in is
// hard-gated to the assigned caregiver ("Only the assigned caregiver can check in"), and a
// session created with nobody assigned just sits as an open request. So the care a family
// actually gives was invisible to the record that feeds the doctor report and iPAi.
//
// A family visit is NOT a session. It carries no money, no caregiver, no check-in gate, no
// payout, and it must never reach a financial audit or a no-show poller. It is a record
// that someone was there and what they noticed.
//
// Access is via recipientAccess() from utils/access.js — the helper added in v1.105.35
// after the audit found six endpoints that were authenticated and nothing more. Every new
// route goes through it.

const express = require("express");
const { v4: uuid } = require("uuid");
const { getDb } = require("../models/database");
const { authenticate } = require("../middleware/auth");
const { recipientAccess } = require("../utils/access");
const { coarsenCoordinate, geofenceEvidence } = require("../utils/geocode");
const { captureException } = require("../utils/sentry");

const router = express.Router();
router.use(authenticate);

const MAX_SUMMARY = 5000;
const ACTIVITIES = ["meal", "medication_reminder", "errand", "appointment", "housework", "company"];

// Pete's straw man, approved Aug 4. "company" — just being there — is the one a
// caregiver-shaped form would leave out, and for family visits it may be the most common
// and most honest answer.
function cleanActivities(input) {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.filter((a) => ACTIVITIES.includes(a)))];
}

// ─── POST /api/family-visits ───
router.post("/", async (req, res) => {
  try {
    const db = await getDb();
    const {
      careRecipientId, summary, moodRating, activities,
      visitedAt, durationMinutes, latitude, longitude, loggedVia,
    } = req.body || {};

    if (!careRecipientId) return res.status(400).json({ error: "careRecipientId is required" });

    // 404 rather than 403: "not yours" and "not there" look identical to someone probing ids.
    const access = await recipientAccess(db, careRecipientId, req.user.id);
    if (!access) return res.status(404).json({ error: "Care recipient not found" });

    // Retroactive by design. Pete: "Peggy WILL NOT open the app at her house. she'll
    // probably write a long screed when she gets home." Backdating is the normal case, not
    // an edge case — but not the future, and not the distant past.
    let visited = visitedAt ? new Date(visitedAt) : new Date();
    if (isNaN(visited.getTime())) return res.status(400).json({ error: "That date doesn't look right" });
    const now = Date.now();
    if (visited.getTime() > now + 5 * 60000) {
      return res.status(400).json({ error: "A visit can't be in the future" });
    }
    if (visited.getTime() < now - 90 * 24 * 3600 * 1000) {
      return res.status(400).json({ error: "That's more than 90 days ago — please pick a closer date" });
    }

    const text = summary ? String(summary).slice(0, MAX_SUMMARY) : null;
    if (!text && !moodRating && cleanActivities(activities).length === 0) {
      return res.status(400).json({ error: "Add a note, a mood, or what you did — otherwise there's nothing to record" });
    }

    // Geofence evidence is computed at FULL precision and then discarded; only the
    // coarsened point is stored. Same contract as caregiver check-in (v1.105.23).
    let geo = { distanceFt: null, flag: "no_geo" };
    if (latitude != null && longitude != null) {
      const cr = await db.prepare(
        "SELECT latitude, longitude FROM care_recipients WHERE id = ?"
      ).get(careRecipientId);
      if (cr?.latitude != null && cr?.longitude != null) {
        geo = geofenceEvidence(latitude, longitude, cr.latitude, cr.longitude);
      }
    }

    const id = uuid();
    await db.prepare(`
      INSERT INTO family_visits
        (id, care_recipient_id, user_id, visited_at, duration_minutes, summary, mood_rating,
         activities, latitude, longitude, distance_ft, geo_flag, logged_via, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
    `).run(
      id, careRecipientId, req.user.id, visited.toISOString(),
      durationMinutes ? parseInt(durationMinutes, 10) : null,
      text, moodRating || null, JSON.stringify(cleanActivities(activities)),
      latitude != null ? coarsenCoordinate(latitude) : null,
      longitude != null ? coarsenCoordinate(longitude) : null,
      geo.distanceFt, geo.flag,
      loggedVia === "geo_prompt" ? "geo_prompt" : "manual",
    );

    notifyTeam(db, req, { id, careRecipientId }).catch(() => {});

    const row = await getOne(db, id);
    res.status(201).json({ visit: row });
  } catch (err) {
    console.error("Family visit create error:", err);
    captureException(err, { where: "familyVisits: create" });
    res.status(500).json({ error: "Could not save that visit — please try again" });
  }
});

// ─── GET /api/family-visits/:careRecipientId ───
router.get("/:careRecipientId", async (req, res) => {
  try {
    const db = await getDb();
    const access = await recipientAccess(db, req.params.careRecipientId, req.user.id);
    if (!access) return res.status(404).json({ error: "Care recipient not found" });

    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const rows = await db.prepare(`
      SELECT fv.id, fv.care_recipient_id, fv.user_id, fv.visited_at, fv.duration_minutes,
             fv.summary, fv.mood_rating, fv.activities, fv.created_at,
             u.first_name AS author_first_name, u.last_name AS author_last_name
      FROM family_visits fv
      JOIN users u ON u.id = fv.user_id
      WHERE fv.care_recipient_id = ?
      ORDER BY fv.visited_at DESC
      LIMIT ?
    `).all(req.params.careRecipientId, limit);

    // logged_via, coordinates, distance and geo_flag are deliberately NOT returned. The
    // team sees "Pete logged a visit", never "Pete was detected at Betty's house" — that
    // line is the whole difference between a nudge and surveillance.
    res.json({ visits: rows.map(shape) });
  } catch (err) {
    console.error("Family visit list error:", err);
    captureException(err, { where: "familyVisits: list" });
    res.status(500).json({ error: "Could not load visits" });
  }
});

// ─── DELETE /api/family-visits/:id — author only ───
router.delete("/:id", async (req, res) => {
  try {
    const db = await getDb();
    const row = await db.prepare("SELECT * FROM family_visits WHERE id = ?").get(req.params.id);
    if (!row) return res.status(404).json({ error: "Visit not found" });
    if (row.user_id !== req.user.id) {
      // Your own account of your own visit. Nobody else edits it, including a team leader.
      return res.status(403).json({ error: "Only the person who logged a visit can remove it" });
    }
    await db.prepare("DELETE FROM family_visits WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error("Family visit delete error:", err);
    captureException(err, { where: "familyVisits: delete" });
    res.status(500).json({ error: "Could not remove that visit" });
  }
});

async function getOne(db, id) {
  const row = await db.prepare(`
    SELECT fv.*, u.first_name AS author_first_name, u.last_name AS author_last_name
    FROM family_visits fv JOIN users u ON u.id = fv.user_id WHERE fv.id = ?
  `).get(id);
  return row ? shape(row) : null;
}

function shape(r) {
  let activities = [];
  try { activities = r.activities ? JSON.parse(r.activities) : []; } catch { activities = []; }
  return {
    id: r.id,
    careRecipientId: r.care_recipient_id,
    userId: r.user_id,
    authorName: `${r.author_first_name || ""} ${r.author_last_name || ""}`.trim(),
    authorFirstName: r.author_first_name,
    visitedAt: r.visited_at,
    durationMinutes: r.duration_minutes,
    summary: r.summary,
    moodRating: r.mood_rating,
    activities,
    createdAt: r.created_at,
  };
}

// ─── The nudge back into the app ───
//
// Pete: "a nudge to return to the app and see what Pete had to say."
//
// The push deliberately does NOT carry the note. Two reasons that happen to agree:
// summary is PHI and would otherwise sit on every team member's lock screen readable by
// anyone holding the phone; and a push that already tells you what he said is a WORSE
// nudge, because there's nothing left to come back for.
//
// Family-only, matching the Care Tasks precedent Pete set (caregiver-side surface parked).
// Whether the assigned caregiver should see family visits is still an open question — the
// answer is probably "visible in the app on arrival", not "buzzed at dinner".
async function notifyTeam(db, req, { id, careRecipientId }) {
  try {
    const cr = await db.prepare(
      "SELECT first_name, family_user_id FROM care_recipients WHERE id = ?"
    ).get(careRecipientId);
    if (!cr) return;

    const members = await db.prepare(`
      SELECT DISTINCT ctm.user_id AS id
      FROM care_team_members ctm
      JOIN care_teams ct ON ct.id = ctm.care_team_id
      WHERE ct.care_recipient_id = ?
    `).all(careRecipientId);

    const ids = new Set(members.map((m) => m.id));
    if (cr.family_user_id) ids.add(cr.family_user_id);
    ids.delete(req.user.id); // never push your own visit back at you
    if (ids.size === 0) return;

    const author = await db.prepare("SELECT first_name FROM users WHERE id = ?").get(req.user.id);
    const { sendPushToUser } = require("./push");
    for (const userId of ids) {
      sendPushToUser(userId, {
        title: `${author?.first_name || "Someone"} added a note about ${cr.first_name}`,
        body: "Tap to read",
        tag: `family-visit-${id.slice(0, 8)}`,
        data: { type: "family_visit", careRecipientId, visitId: id, page: "care-profile" },
      }, "family_visit").catch(() => {});
    }
  } catch (e) {
    captureException(e, { where: "familyVisits: notify" });
  }
}

module.exports = router;
