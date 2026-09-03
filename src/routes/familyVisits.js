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
const { attachReactions } = require("../utils/reactions"); // v1.105.170
const { coarsenCoordinate, geofenceEvidence } = require("../utils/geocode");
const { validateMagicBytes } = require("../utils/fileValidation");
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

// ─── The photo (v1.105.74) ───
//
// Same contract as a photo note (notes.js, v1.76.0): a base64 data URI, an image mime we
// actually accept, 5MB after decode, and magic bytes that agree with the claimed type — a
// declared mime is a claim by the uploader, not a fact. Returns an error string or null.
const PHOTO_MIMES = ["image/jpeg", "image/png", "image/webp"];
function validatePhoto(photo) {
  const m = typeof photo === "string" && photo.match(/^data:([^;]+);base64,(.+)$/s);
  if (!m) return "Photo must be a base64 data URI";
  const mime = m[1].toLowerCase();
  if (!PHOTO_MIMES.includes(mime)) return "Photo must be JPEG, PNG, or WebP";
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > 5 * 1024 * 1024) return "Photo too large (5MB max)";
  if (!validateMagicBytes(buf, mime).valid) return "Photo content does not match its type";
  return null;
}

// ─── The set of photos (v1.105.111) ───
//
// Pete, 40ad8896: the picker should take more than one picture.
//
// A cap on COUNT and a cap on TOTAL, not just per photo. `express.json` for this route is
// capped in server.js, and a body that exceeds it is rejected by middleware BEFORE this
// handler runs — which means a 413 with none of the wording below. So the count is kept low
// enough that the client's downscaled images cannot reach that ceiling in normal use, and
// the total is checked here so an oversized set gets an explanation rather than a bare 413.
const MAX_PHOTOS = 4;
const MAX_PHOTOS_BYTES = 8 * 1024 * 1024;

function validatePhotoSet(list) {
  if (!Array.isArray(list)) return { error: "Photos must be a list" };
  const clean = list.filter((p) => typeof p === "string" && p);
  if (clean.length > MAX_PHOTOS) {
    return { error: `Up to ${MAX_PHOTOS} photos per visit — you picked ${clean.length}` };
  }
  let bytes = 0;
  for (const p of clean) {
    const bad = validatePhoto(p);
    if (bad) return { error: bad };
    // base64 is 4 characters per 3 bytes; close enough to police a ceiling with.
    bytes += Math.floor((p.length - p.indexOf(",") - 1) * 0.75);
  }
  if (bytes > MAX_PHOTOS_BYTES) {
    return { error: "Those photos are too large together — try fewer, or retake them" };
  }
  return { photos: clean };
}

// ─── POST /api/family-visits ───
router.post("/", async (req, res) => {
  try {
    const db = await getDb();
    const {
      careRecipientId, summary, moodRating, activities,
      visitedAt, durationMinutes, latitude, longitude, loggedVia, photo, photos,
    } = req.body || {};

    if (!careRecipientId) return res.status(400).json({ error: "careRecipientId is required" });

    // Validate before the access lookup: a malformed photo should not cost a DB round trip.
    //
    // v1.105.111 — `photos` is the list; `photo` is the single-photo shape every client
    // before today sent. Accept both, normalise to one list, and keep writing the first one
    // into `photo` so existing rows, `/:id/photo` and the feed's has_photo flag all keep
    // meaning exactly what they meant.
    let photoList = [];
    // A `photos` we cannot read is not the same as no photos. Falling through would save the
    // visit with the pictures silently dropped — the quiet-failure class this codebase keeps
    // paying for. Say so instead.
    if (photos != null && !Array.isArray(photos)) {
      return res.status(400).json({ error: "Photos must be a list" });
    }
    if (Array.isArray(photos) && photos.length) {
      const checked = validatePhotoSet(photos);
      if (checked.error) return res.status(400).json({ error: checked.error });
      photoList = checked.photos;
    } else if (photo) {
      const bad = validatePhoto(photo);
      if (bad) return res.status(400).json({ error: bad });
      photoList = [photo];
    }
    const photoData = photoList[0] || null;

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
    // v1.105.74 — a photo IS a record. Pete's ask was for the quick path, where a picture of
    // the fridge or the swollen ankle may be the whole point and typing is the friction.
    if (!text && !moodRating && cleanActivities(activities).length === 0 && !photoData) {
      return res.status(400).json({ error: "Add a note, a mood, a photo, or what you did — otherwise there's nothing to record" });
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

    // v1.105.46 — a retry after a lost response must not create a second visit.
    // The client now gives up at 25s, so the honest failure mode is "we don't know whether
    // it landed", and the natural human response is to tap Save again. Same person, same
    // recipient, same minute is one visit, not two.
    const dupe = await db.prepare(`
      SELECT id FROM family_visits
      WHERE care_recipient_id = ? AND user_id = ? AND visited_at = ?
        AND created_at > NOW() - INTERVAL '10 minutes'
      LIMIT 1
    `).get(careRecipientId, req.user.id, visited.toISOString());
    if (dupe) return res.status(201).json({ visit: await getOne(db, dupe.id) });

    const id = uuid();
    await db.prepare(`
      INSERT INTO family_visits
        (id, care_recipient_id, user_id, visited_at, duration_minutes, summary, mood_rating,
         activities, latitude, longitude, distance_ft, geo_flag, logged_via, photo, photos, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
    `).run(
      id, careRecipientId, req.user.id, visited.toISOString(),
      durationMinutes ? parseInt(durationMinutes, 10) : null,
      text, moodRating || null, JSON.stringify(cleanActivities(activities)),
      latitude != null ? coarsenCoordinate(latitude) : null,
      longitude != null ? coarsenCoordinate(longitude) : null,
      geo.distanceFt, geo.flag,
      loggedVia === "geo_prompt" ? "geo_prompt" : "manual",
      photoData,
      photoList.length > 1 ? JSON.stringify(photoList) : null,
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
             (fv.photo IS NOT NULL) AS has_photo,
             fv.photos,
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
    //
    // v1.105.170 — reactions come with the list, in ONE query for the whole page. Fetching
    // them per row would be a request per visit on a screen that shows fifty.
    res.json({ visits: await attachReactions(db, "family_visit", rows.map(shape)) });
  } catch (err) {
    console.error("Family visit list error:", err);
    captureException(err, { where: "familyVisits: list" });
    res.status(500).json({ error: "Could not load visits" });
  }
});

// ─── GET /api/family-visits/:id/photo — stream a visit photo ───
//
// Same access rule as the visit itself (recipientAccess), and a 404 rather than a 403 for
// "not yours", so probing ids tells you nothing. Mirrors notes.js /:id/photo.
//
// Route order is safe either way: GET /:careRecipientId is one path segment and this is two,
// so "/<id>/photo" can never fall through to the list route. Worth stating because the two
// params look alike and are NOT the same id — that one is a recipient, this one is a visit.
//
// v1.105.111 — `/:id/photo` is index 0 and keeps working untouched for every client and every
// row written before today; `/:id/photo/:idx` reaches the rest.
async function sendVisitPhoto(req, res, index) {
  try {
    const db = await getDb();
    const row = await db.prepare(
      "SELECT care_recipient_id, photo, photos FROM family_visits WHERE id = ?"
    ).get(req.params.id);
    if (!row) return res.status(404).json({ error: "Photo not found" });

    // A row written before the `photos` column existed has only `photo`, and reads as a
    // one-photo visit rather than as a broken one.
    let list = [];
    if (row.photos) { try { const a = JSON.parse(row.photos); if (Array.isArray(a)) list = a; } catch {} }
    if (!list.length && row.photo) list = [row.photo];

    const data = list[index];
    if (!data) return res.status(404).json({ error: "Photo not found" });

    // Access checked AFTER we know the photo exists but BEFORE we send it, and both failures
    // answer 404 — so probing ids cannot distinguish "not yours" from "not there".
    const access = await recipientAccess(db, row.care_recipient_id, req.user.id);
    if (!access) return res.status(404).json({ error: "Photo not found" });

    const m = data.match(/^data:([^;]+);base64,(.+)$/s);
    if (!m) return res.status(500).json({ error: "Stored photo is corrupt" });
    res.set("Content-Type", m[1]);
    res.set("Cache-Control", "private, max-age=86400");
    res.send(Buffer.from(m[2], "base64"));
  } catch (err) {
    console.error("Family visit photo error:", err);
    captureException(err, { where: "familyVisits: photo" });
    res.status(500).json({ error: "Could not load that photo" });
  }
}

router.get("/:id/photo", (req, res) => sendVisitPhoto(req, res, 0));

router.get("/:id/photo/:idx", (req, res) => {
  const idx = parseInt(req.params.idx, 10);
  if (!Number.isInteger(idx) || idx < 0 || idx >= MAX_PHOTOS) {
    return res.status(404).json({ error: "Photo not found" });
  }
  return sendVisitPhoto(req, res, idx);
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
    // v1.105.74 — the flag, never the blob. `photo` is a data URI up to 5MB and a list of 50
    // of them would be a quarter-gigabyte response; the client fetches /:id/photo on demand.
    hasPhoto: r.has_photo === true || r.has_photo === 1 || (r.photo != null && r.has_photo === undefined),
    // v1.105.111 — how MANY, so the feed can show every thumbnail rather than only the first.
    // Still the count and never the blobs, for the reason above: a list of 50 rows each
    // carrying four 5MB data URIs would be a response measured in gigabytes.
    photoCount: (() => {
      if (r.photos) { try { const a = JSON.parse(r.photos); if (Array.isArray(a)) return a.length; } catch {} }
      return (r.has_photo === true || r.has_photo === 1 || r.photo != null) ? 1 : 0;
    })(),
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

    // v1.105.81 — see notes.js: told only if you could go and read it. Someone who can log
    // a visit but not read the history does not need a push about somebody else's.
    // ─── v1.105.156 — the audience is back to everyone who may read it ───
    //
    // v1.105.154 narrowed this to people who could reach the family's care profile, because
    // Julia was being notified about visits she had nowhere to open. That was solving the
    // wrong half. Pete: "Julia is on the care team...she should be able to see the notes, or
    // I should be able to select it at least."
    //
    // He is right, and the capability already said so — READ_VISITS is granted to her by
    // membership, and GET /api/family-visits/:id has always authorized her. The missing piece
    // was a screen, and the answer to a missing screen is a screen, not a quieter app. Care
    // Notes shows visits now, so the push has somewhere to land again.
    //
    // If a family wants a particular person NOT to see visits, that is what withholding
    // READ_VISITS on the invitation is for — a decision they make, not one hard-coded here.
    // v1.105.182 — and a durable row, for the same reason notes now get one: the Activity card
    // shows unread notifications plus activity_feed, so anything that writes only a
    // notification disappears from Activity the moment it is read.
    const author = await db.prepare("SELECT first_name FROM users WHERE id = ?").get(req.user.id);
    try {
      await db.prepare(
        "INSERT INTO activity_feed (id, family_user_id, care_recipient_id, event_type, title, message, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(uuid(), cr.family_user_id, careRecipientId, "family_visit",
        `${author?.first_name || "Someone"} logged a visit with ${cr.first_name}`,
        null,
        JSON.stringify({ type: "family_visit", careRecipientId, visitId: id, page: "care-profile" })
      );
    } catch (e) { captureException(e, { where: "familyVisits: activity row" }); }

    const { usersWithCapability } = require("../utils/access");
    const { CAP } = require("../utils/capabilities");
    const ids = new Set(await usersWithCapability(db, careRecipientId, CAP.READ_VISITS));
    ids.delete(req.user.id); // never push your own visit back at you
    if (ids.size === 0) return;

    const { sendPushToUser } = require("./push");
    for (const userId of ids) {
      // ─── v1.105.182 — a visit is not a note ───
      //
      // This said "added a note about Betty" for a VISIT, and it has cost three rounds of the
      // same conversation. Julia has READ_VISITS and not READ_NOTES, so she correctly receives
      // visit pushes and correctly receives no note pushes — but the visit push called itself
      // a note, so every time she reported "I'm told about notes I can't read", she was
      // reporting exactly what the app said. Both fan-outs were right the whole time; the
      // WORD was wrong.
      sendPushToUser(userId, {
        title: `${author?.first_name || "Someone"} logged a visit with ${cr.first_name}`,
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
