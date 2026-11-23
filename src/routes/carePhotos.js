// ─── Care photos from Messages (v1.137.0) ───
//
// Feedback 2012ed0b / 03cc8526. Pete, 11/20: a photo Tina sends in Messages ("scratched her
// lip on the cabinet") never reached Betty's care photos, because the Home strip only read
// visit_photos. Now any family member on the team can hold a message photo and "Save to care
// photos", with a visit or on its own; it shows in the Home strip and can be moved or deleted
// from there.
//
// Who sees it (Pete: "Family only"): family on the loved one's team — anyone who can read her
// visits and is not acting as a caregiver. A caregiver sees a saved photo only when it is on her
// own visit. Failed checks answer 404, the codebase-wide convention.
//
// The bytes are COPIED into their own stored object (prefix "care-photo"), not shared with the
// message, so deleting one never breaks the other — and never base64 in Postgres when R2 is on.

const express = require("express");
const { v4: uuid } = require("uuid");
const { getDb } = require("../models/database");
const { authenticate } = require("../middleware/auth");
const { sendStoredFile, IMAGE_MIMES } = require("../utils/serveMedia");
const storage = require("../utils/storage");
const { captureException } = require("../utils/sentry");

const router = express.Router();
router.use(authenticate);

const CAPTION_MAX = 200;
const VISIT_WINDOW_DAYS = 14;

function activeRole(user) { return user.activeRole || user.role; }

/** The loved ones this user is family for (not as a caregiver). */
async function familyRecipients(db, user) {
  if (activeRole(user) === "caregiver") return [];
  const { recipientsWithCapabilityFor } = require("../utils/access");
  const { CAP } = require("../utils/capabilities");
  return recipientsWithCapabilityFor(db, user.id, CAP.READ_VISITS);
}

/** The message, if this user is in its conversation and it carries a photo. */
async function messagePhoto(db, messageId, userId) {
  if (!messageId) return null;
  const msg = await db.prepare(
    "SELECT id, conversation_id, sender_id, recipient_id, metadata, created_at FROM messages WHERE id = ? AND COALESCE(is_deleted, 0) = 0"
  ).get(messageId);
  if (!msg) return null;
  let allowed = false;
  if (msg.conversation_id) {
    allowed = !!(await db.prepare(
      "SELECT id FROM conversation_members WHERE conversation_id = ? AND user_id = ?"
    ).get(msg.conversation_id, userId));
  } else {
    allowed = msg.sender_id === userId || msg.recipient_id === userId;
  }
  if (!allowed) return null;
  let meta = null;
  try { meta = msg.metadata ? JSON.parse(msg.metadata) : null; } catch { meta = null; }
  if (!meta || !meta.photoUrl) return null;
  return { ...msg, photoRef: String(meta.photoUrl), caption: meta.caption || null };
}

/** Recent visits for these recipients, newest first, for "Put it with". */
async function recentVisits(db, recipientIds) {
  if (recipientIds.length === 0) return [];
  const since = new Date(Date.now() - VISIT_WINDOW_DAYS * 86400000).toISOString().slice(0, 10);
  const until = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  return db.prepare(`
    SELECT cs.id, cs.care_recipient_id, cs.scheduled_date, cs.scheduled_time, cs.duration_hours, cs.status,
           cp.user_id AS caregiver_user_id, u.first_name AS caregiver_first, u.last_name AS caregiver_last
      FROM care_sessions cs
      LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
      LEFT JOIN users u ON cp.user_id = u.id
     WHERE cs.care_recipient_id IN (${recipientIds.map(() => "?").join(",")})
       AND cs.scheduled_date >= ? AND cs.scheduled_date <= ?
       AND cs.caregiver_id IS NOT NULL
       AND cs.status NOT IN ('cancelled', 'declined', 'expired')
     ORDER BY cs.scheduled_date DESC, cs.scheduled_time DESC
     LIMIT 30
  `).all(...recipientIds, since, until);
}

/** Pure: which visit the photo most likely belongs to — the sender's visit closest to when it was sent. */
function suggestVisit(visits, senderId, sentAt) {
  const sentMs = new Date(sentAt || Date.now()).getTime();
  let best = null;
  let bestGap = Infinity;
  for (const v of visits || []) {
    if (!v.caregiver_user_id || v.caregiver_user_id !== senderId) continue;
    // Date-level is enough: within a day of the visit's date, nearest wins.
    const gap = Math.abs(new Date(`${v.scheduled_date}T12:00:00Z`).getTime() - sentMs);
    if (gap < 1.5 * 86400000 && gap < bestGap) { best = v; bestGap = gap; }
  }
  return best ? best.id : null;
}

function visitOption(v) {
  return {
    id: v.id,
    careRecipientId: v.care_recipient_id,
    date: v.scheduled_date,
    time: v.scheduled_time,
    hours: v.duration_hours,
    caregiverName: [v.caregiver_first, v.caregiver_last].filter(Boolean).join(" ") || null,
  };
}

/** May this user see this care photo? Returns the row or null. */
async function mayView(db, photoId, user) {
  const row = await db.prepare(`
    SELECT p.*, cp.user_id AS visit_caregiver_user_id
      FROM care_photos p
      LEFT JOIN care_sessions cs ON p.session_id = cs.id
      LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
     WHERE p.id = ? AND p.deleted_at IS NULL
  `).get(photoId);
  if (!row) return null;
  if (row.visit_caregiver_user_id && row.visit_caregiver_user_id === user.id) return { row, family: false };
  const fam = await familyRecipients(db, user);
  if (fam.some((r) => r.id === row.care_recipient_id)) return { row, family: true };
  return null;
}

// GET /api/care-photos/options?messageId=… — what the save sheet offers
router.get("/options", async (req, res) => {
  try {
    const db = await getDb();
    const msg = await messagePhoto(db, req.query.messageId, req.user.id);
    if (!msg) return res.status(404).json({ error: "Photo not found" });
    const recipients = await familyRecipients(db, req.user);
    if (recipients.length === 0) return res.status(403).json({ error: "Care photos are for family on the care team." });
    const visits = await recentVisits(db, recipients.map((r) => r.id));
    const already = await db.prepare(
      "SELECT id FROM care_photos WHERE source_message_id = ? AND deleted_at IS NULL LIMIT 1"
    ).get(msg.id);
    res.json({
      recipients: recipients.map((r) => ({ id: r.id, name: [r.first_name, r.last_name].filter(Boolean).join(" ") })),
      visits: visits.map(visitOption),
      suggestedSessionId: suggestVisit(visits, msg.sender_id, msg.created_at),
      caption: msg.caption,
      alreadySavedId: already ? already.id : null,
    });
  } catch (err) {
    captureException(err, { where: "carePhotos: options" });
    res.status(500).json({ error: "Could not load that" });
  }
});

// POST /api/care-photos { messageId, careRecipientId, sessionId?, caption? }
router.post("/", async (req, res) => {
  try {
    const db = await getDb();
    const { messageId, careRecipientId, sessionId } = req.body || {};
    const caption = String((req.body && req.body.caption) || "").trim().slice(0, CAPTION_MAX) || null;
    const msg = await messagePhoto(db, messageId, req.user.id);
    if (!msg) return res.status(404).json({ error: "Photo not found" });
    const recipients = await familyRecipients(db, req.user);
    const recipient = recipients.find((r) => r.id === careRecipientId) || (recipients.length === 1 && !careRecipientId ? recipients[0] : null);
    if (!recipient) return res.status(403).json({ error: "Care photos are for family on the care team." });
    let visitId = null;
    if (sessionId) {
      const s = await db.prepare("SELECT id, care_recipient_id FROM care_sessions WHERE id = ?").get(sessionId);
      if (!s || s.care_recipient_id !== recipient.id) return res.status(400).json({ error: "That visit isn't for this loved one." });
      visitId = s.id;
    }
    const dup = await db.prepare(
      "SELECT id FROM care_photos WHERE source_message_id = ? AND care_recipient_id = ? AND deleted_at IS NULL"
    ).get(msg.id, recipient.id);
    if (dup) return res.json({ id: dup.id, already: true });

    // Copy the bytes into their own object.
    const data = await storage.resolveFileData(msg.photoRef);
    if (!data) return res.status(404).json({ error: "That photo can't be read anymore." });
    const stored = await storage.storeFileData("care-photo", data);
    const id = uuid();
    await db.prepare(`
      INSERT INTO care_photos (id, care_recipient_id, session_id, source_message_id, photo_url, caption, added_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, recipient.id, visitId, msg.id, stored, caption, req.user.id);
    res.json({ id, photoUrl: `/api/care-photos/${id}/image` });
  } catch (err) {
    captureException(err, { where: "carePhotos: save" });
    res.status(500).json({ error: "Could not save that photo" });
  }
});

// ─── v1.155.0 — photos on the InPlace Hub ───
// See utils/hubPhotos.js. Family can now add a care photo directly (not only from Messages),
// and flag any care photo or visit photo to show on the person's screen.
const multer = require("multer");
const { uploadQuota } = require("../utils/usageLimits");
const { validateMagicBytes } = require("../utils/fileValidation");
const hubPhotos = require("../utils/hubPhotos");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const mime = String(file.mimetype || "").split(";")[0].trim().toLowerCase();
    if (IMAGE_MIMES.includes(mime)) cb(null, true);
    else cb(new Error("Photos must be JPEG, PNG, WebP, GIF or HEIC"));
  },
});
const truthy = (v) => v === true || v === 1 || v === "1" || v === "true";

// POST /api/care-photos/upload (multipart: photo, careRecipientId, caption?, showOnHub?)
router.post("/upload", uploadQuota(), (req, res, next) => {
  upload.single("photo")(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || "That photo couldn't be read" });
    next();
  });
}, async (req, res) => {
  try {
    const db = await getDb();
    const careRecipientId = String((req.body && req.body.careRecipientId) || "");
    if (!(await hubPhotos.isFamilyFor(db, careRecipientId, req.user))) {
      return res.status(403).json({ error: "Care photos are for family on the care team." });
    }
    const file = req.file;
    if (!file) return res.status(400).json({ error: "No photo provided" });
    if (!validateMagicBytes(file.buffer, file.mimetype).valid) {
      return res.status(400).json({ error: "That file isn't the picture it says it is" });
    }
    const caption = String((req.body && req.body.caption) || "").trim().slice(0, CAPTION_MAX) || null;
    const showOnHub = truthy(req.body && req.body.showOnHub) ? 1 : 0;
    const stored = await storage.storeFileData("care-photo", `data:${file.mimetype};base64,${file.buffer.toString("base64")}`);
    const id = uuid();
    await db.prepare(`
      INSERT INTO care_photos (id, care_recipient_id, session_id, source_message_id, photo_url, caption, added_by, show_on_hub)
      VALUES (?, ?, NULL, NULL, ?, ?, ?, ?)
    `).run(id, careRecipientId, stored, caption, req.user.id, showOnHub);
    res.status(201).json({ id, photoUrl: `/api/care-photos/${id}/image`, showOnHub: !!showOnHub });
  } catch (err) {
    captureException(err, { where: "carePhotos: upload" });
    res.status(500).json({ error: "Could not save that photo" });
  }
});

// PATCH /api/care-photos/hub/:kind/:id { showOnHub } — family on her team, either kind of photo
router.patch("/hub/:kind/:id", async (req, res) => {
  try {
    const db = await getDb();
    const { kind, id } = req.params;
    const row = await hubPhotos.hubPhotoRow(db, kind, id);
    if (!row || !(await hubPhotos.isFamilyFor(db, row.care_recipient_id, req.user))) {
      return res.status(404).json({ error: "Photo not found" });
    }
    const on = truthy(req.body && req.body.showOnHub) ? 1 : 0;
    const table = kind === "care" ? "care_photos" : "visit_photos";
    await db.prepare(`UPDATE ${table} SET show_on_hub = ? WHERE id = ?`).run(on, id);
    res.json({ id, kind, showOnHub: !!on });
  } catch (err) {
    captureException(err, { where: "carePhotos: hub toggle" });
    res.status(500).json({ error: "Could not change that photo" });
  }
});

// GET /api/care-photos/hub/:kind/:id/image — her own account (flagged photos only) or family
router.get("/hub/:kind/:id/image", async (req, res) => {
  try {
    const db = await getDb();
    const row = await hubPhotos.hubPhotoForViewer(db, req.params.kind, req.params.id, req.user);
    if (!row) return res.status(404).json({ error: "Photo not found" });
    return await sendStoredFile(res, row.photo_url, { allow: IMAGE_MIMES, filename: `photo-${row.id}.jpg` });
  } catch (err) {
    captureException(err, { where: "carePhotos: hub image" });
    res.status(500).json({ error: "Failed to load photo" });
  }
});

// GET /api/care-photos/:id/image
router.get("/:id/image", async (req, res) => {
  try {
    const db = await getDb();
    const v = await mayView(db, req.params.id, req.user);
    if (!v) return res.status(404).json({ error: "Photo not found" });
    return await sendStoredFile(res, v.row.photo_url, { allow: IMAGE_MIMES, filename: `care-photo-${v.row.id}.jpg` });
  } catch (err) {
    captureException(err, { where: "carePhotos: image" });
    res.status(500).json({ error: "Failed to load photo" });
  }
});

// PATCH /api/care-photos/:id { sessionId: id|null, caption? } — move to a visit / off one
router.patch("/:id", async (req, res) => {
  try {
    const db = await getDb();
    const v = await mayView(db, req.params.id, req.user);
    if (!v || !v.family) return res.status(404).json({ error: "Photo not found" });
    const body = req.body || {};
    let sessionId = v.row.session_id;
    if (Object.prototype.hasOwnProperty.call(body, "sessionId")) {
      if (body.sessionId) {
        const s = await db.prepare("SELECT id, care_recipient_id FROM care_sessions WHERE id = ?").get(body.sessionId);
        if (!s || s.care_recipient_id !== v.row.care_recipient_id) return res.status(400).json({ error: "That visit isn't for this loved one." });
        sessionId = s.id;
      } else sessionId = null;
    }
    const caption = Object.prototype.hasOwnProperty.call(body, "caption")
      ? (String(body.caption || "").trim().slice(0, CAPTION_MAX) || null)
      : v.row.caption;
    await db.prepare("UPDATE care_photos SET session_id = ?, caption = ? WHERE id = ?").run(sessionId, caption, v.row.id);
    res.json({ id: v.row.id, sessionId, caption });
  } catch (err) {
    captureException(err, { where: "carePhotos: move" });
    res.status(500).json({ error: "Could not change that photo" });
  }
});

// GET /api/care-photos/:id/visits — visits it could move to
router.get("/:id/visits", async (req, res) => {
  try {
    const db = await getDb();
    const v = await mayView(db, req.params.id, req.user);
    if (!v || !v.family) return res.status(404).json({ error: "Photo not found" });
    const visits = await recentVisits(db, [v.row.care_recipient_id]);
    res.json({ visits: visits.map(visitOption), current: v.row.session_id });
  } catch (err) {
    captureException(err, { where: "carePhotos: visits" });
    res.status(500).json({ error: "Could not load visits" });
  }
});

// DELETE /api/care-photos/:id — family only; the message keeps its own copy
router.delete("/:id", async (req, res) => {
  try {
    const db = await getDb();
    const v = await mayView(db, req.params.id, req.user);
    if (!v || !v.family) return res.status(404).json({ error: "Photo not found" });
    await db.prepare("UPDATE care_photos SET deleted_at = NOW(), deleted_by = ? WHERE id = ?").run(req.user.id, v.row.id);
    storage.deleteFileData(v.row.photo_url).catch(() => {});
    res.json({ success: true, deletedId: v.row.id });
  } catch (err) {
    captureException(err, { where: "carePhotos: delete" });
    res.status(500).json({ error: "Could not delete that photo" });
  }
});

module.exports = router;
module.exports._test = { suggestVisit, visitOption };
