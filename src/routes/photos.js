const express = require("express");
const multer = require("multer");
const { v4: uuid } = require("uuid");
const { getDb } = require("../models/database");
const { authenticate, requireRole } = require("../middleware/auth");
const { validateMagicBytes } = require("../utils/fileValidation");

const router = express.Router();
router.use(authenticate);

// Check if user is on the care team for a given care recipient
async function isCareTeamMember(db, careRecipientId, userId) {
  if (!careRecipientId || !userId) return false;
  const row = await db.prepare(`
    SELECT 1 FROM care_team_members ctm
    JOIN care_teams ct ON ctm.care_team_id = ct.id
    WHERE ct.care_recipient_id = ? AND ctm.user_id = ?
  `).get(careRecipientId, userId);
  return !!row;
}

// Store uploads in memory (convert to base64 for DB storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed"));
    }
  },
});

// ─── POST /api/photos/visit/:visitLogId ───
// Upload photos for a visit log (caregiver only)
router.post(
  "/visit/:visitLogId",
  requireRole("caregiver"),
  upload.array("photos", 5),
  async (req, res) => {
    const db = await getDb();
    const { visitLogId } = req.params;
    const captions = req.body.captions
      ? JSON.parse(req.body.captions)
      : [];

    // Verify the visit log belongs to this caregiver
    const profile = await db
      .prepare("SELECT id FROM caregiver_profiles WHERE user_id = ?")
      .get(req.user.id);
    if (!profile)
      return res.status(404).json({ error: "Caregiver profile not found" });

    const visitLog = await db
      .prepare(
        "SELECT * FROM visit_logs WHERE id = ? AND caregiver_id = ?"
      )
      .get(visitLogId, profile.id);
    if (!visitLog)
      return res.status(404).json({ error: "Visit log not found" });

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "No photos provided" });
    }

    const photos = [];
    for (let i = 0; i < req.files.length; i++) {
      const file = req.files[i];
      // Validate magic bytes match claimed MIME type
      const magicCheck = validateMagicBytes(file.buffer, file.mimetype);
      if (!magicCheck.valid) {
        return res.status(400).json({ error: `Photo ${i + 1}: file content doesn't match its claimed type` });
      }
      const base64 = `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;
      const id = uuid();

      await db
        .prepare(
          "INSERT INTO visit_photos (id, visit_log_id, photo_url, caption) VALUES (?, ?, ?, ?)"
        )
        .run(id, visitLogId, base64, captions[i] || null);

      photos.push({ id, visitLogId, photoUrl: base64, caption: captions[i] || null });
    }

    // Real-time: notify family that photos were added
    const session = await db
      .prepare(
        "SELECT cs.family_user_id, u.first_name || ' ' || u.last_name AS caregiver_name FROM care_sessions cs JOIN visit_logs vl ON vl.session_id = cs.id JOIN caregiver_profiles cp ON vl.caregiver_id = cp.id JOIN users u ON cp.user_id = u.id WHERE vl.id = ?"
      )
      .get(visitLogId);
    if (session) {
      const emitToUser = req.app.get("emitToUser");
      if (emitToUser) {
        emitToUser(session.family_user_id, "visit_photos", {
          visitLogId,
          photoCount: photos.length,
        });
      }
      // Push notification so family knows photos arrived
      try {
        const { sendPushToUser } = require("../utils/push");
        if (sendPushToUser) {
          await sendPushToUser(
            db,
            session.family_user_id,
            `${session.caregiver_name} added photos`,
            `${photos.length} visit photo${photos.length > 1 ? 's' : ''} uploaded`,
            { type: 'visit_photos', visitLogId }
          );
        }
      } catch {}
    }

    res.status(201).json({ photos, count: photos.length });
  }
);

// ─── GET /api/photos/visit/:visitLogId ───
// Get photos for a visit log (if user is session participant, care team member, or admin)
router.get("/visit/:visitLogId", async (req, res) => {
  const db = await getDb();
  // Verify user is involved in the session this visit log belongs to
  const visitLog = await db.prepare(
    "SELECT vl.id, cs.family_user_id, cs.caregiver_id, cs.care_recipient_id FROM visit_logs vl JOIN care_sessions cs ON vl.session_id = cs.id WHERE vl.id = ?"
  ).get(req.params.visitLogId);
  if (!visitLog) return res.json({ photos: [] });
  const isParticipant = visitLog.family_user_id === req.user.id || visitLog.caregiver_id === req.user.id;
  const isAdmin = req.user.isAdmin || req.user.is_admin;
  if (!isParticipant && !isAdmin && !(await isCareTeamMember(db, visitLog.care_recipient_id, req.user.id))) {
    return res.status(403).json({ error: "Not authorized to view these photos" });
  }
  const photos = await db
    .prepare(
      "SELECT id, visit_log_id, photo_url, caption, created_at FROM visit_photos WHERE visit_log_id = ? ORDER BY created_at ASC"
    )
    .all(req.params.visitLogId);

  res.json({ photos });
});

// ─── POST /api/photos/session/:sessionId ───
// Upload photos for a session (auto-creates visit_log if needed)
// Allows both caregivers and family members to upload photos
router.post(
  "/session/:sessionId",
  upload.array("photos", 5),
  async (req, res) => {
    const db = await getDb();
    const { sessionId } = req.params;
    const captions = req.body.captions ? JSON.parse(req.body.captions) : [];

    // Verify user is involved in this session
    const session = await db.prepare(
      "SELECT cs.*, cp.id AS caregiver_profile_id FROM care_sessions cs LEFT JOIN caregiver_profiles cp ON cp.user_id = ? WHERE cs.id = ?"
    ).get(req.user.id, sessionId);
    if (!session) return res.status(404).json({ error: "Session not found" });

    const isFamily = session.family_user_id === req.user.id;
    const isCaregiver = session.caregiver_profile_id && session.caregiver_id === session.caregiver_profile_id;
    const isAdmin = req.user.isAdmin || req.user.is_admin;
    if (!isFamily && !isCaregiver && !isAdmin) {
      return res.status(403).json({ error: "Not authorized to upload photos for this session" });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "No photos provided" });
    }

    // Find or create visit_log for this session
    let visitLog = await db.prepare("SELECT * FROM visit_logs WHERE session_id = ?").get(sessionId);
    if (!visitLog) {
      const vlId = uuid();
      await db.prepare(
        "INSERT INTO visit_logs (id, session_id, caregiver_id, notes) VALUES (?, ?, ?, ?)"
      ).run(vlId, sessionId, session.caregiver_id || null, 'Photo upload');
      visitLog = { id: vlId };
    }

    const photos = [];
    for (let i = 0; i < req.files.length; i++) {
      const file = req.files[i];
      const magicCheck = validateMagicBytes(file.buffer, file.mimetype);
      if (!magicCheck.valid) {
        return res.status(400).json({ error: `Photo ${i + 1}: file content doesn't match its claimed type` });
      }
      const base64 = `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;
      const id = uuid();
      await db.prepare(
        "INSERT INTO visit_photos (id, visit_log_id, photo_url, caption) VALUES (?, ?, ?, ?)"
      ).run(id, visitLog.id, base64, captions[i] || null);
      photos.push({ id, visitLogId: visitLog.id, photoUrl: base64, caption: captions[i] || null });
    }

    // Real-time notify the other party
    const emitToUser = req.app.get("emitToUser");
    if (emitToUser) {
      const notifyUserId = isFamily ? null : session.family_user_id;
      if (notifyUserId) {
        emitToUser(notifyUserId, "visit_photos", { sessionId, photoCount: photos.length });
      }
    }

    res.status(201).json({ photos, count: photos.length, visitLogId: visitLog.id });
  }
);

// ─── GET /api/photos/session/:sessionId ───
// Get all photos for a care session (if user is participant, care team member, or admin)
router.get("/session/:sessionId", async (req, res) => {
  const db = await getDb();
  // Verify user is involved in this session
  const session = await db.prepare(
    "SELECT id, family_user_id, caregiver_id, care_recipient_id FROM care_sessions WHERE id = ?"
  ).get(req.params.sessionId);
  if (!session) return res.json({ photos: [] });
  const isParticipant = session.family_user_id === req.user.id || session.caregiver_id === req.user.id;
  const isAdmin = req.user.isAdmin || req.user.is_admin;
  if (!isParticipant && !isAdmin && !(await isCareTeamMember(db, session.care_recipient_id, req.user.id))) {
    return res.status(403).json({ error: "Not authorized to view these photos" });
  }

  const visitLog = await db
    .prepare("SELECT id FROM visit_logs WHERE session_id = ?")
    .get(req.params.sessionId);

  if (!visitLog) return res.json({ photos: [] });

  const photos = await db
    .prepare(
      "SELECT id, visit_log_id, photo_url, caption, created_at FROM visit_photos WHERE visit_log_id = ? ORDER BY created_at ASC"
    )
    .all(visitLog.id);

  res.json({ photos });
});

// ─── DELETE /api/photos/:photoId ───
// Delete a visit photo — allowed for any care team member, session participant, or admin
router.delete("/:photoId", async (req, res) => {
  const db = await getDb();
  const { photoId } = req.params;

  // Find the photo and its associated session
  const photo = await db.prepare(`
    SELECT vp.id, vp.visit_log_id, vl.session_id, cs.family_user_id, cs.caregiver_id, cs.care_recipient_id
    FROM visit_photos vp
    JOIN visit_logs vl ON vp.visit_log_id = vl.id
    JOIN care_sessions cs ON vl.session_id = cs.id
    WHERE vp.id = ?
  `).get(photoId);

  if (!photo) return res.status(404).json({ error: "Photo not found" });

  // Check authorization: session participant, care team member, or admin
  const isParticipant = photo.family_user_id === req.user.id || photo.caregiver_id === req.user.id;
  const isAdmin = req.user.isAdmin || req.user.is_admin;
  if (!isParticipant && !isAdmin && !(await isCareTeamMember(db, photo.care_recipient_id, req.user.id))) {
    return res.status(403).json({ error: "Not authorized to delete this photo" });
  }

  await db.prepare("DELETE FROM visit_photos WHERE id = ?").run(photoId);
  res.json({ success: true, deletedId: photoId });
});

// Error handler for multer
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "File too large (max 5MB)" });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err.message === "Only image files are allowed") {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

module.exports = router;
