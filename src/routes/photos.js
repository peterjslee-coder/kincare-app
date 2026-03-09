const express = require("express");
const multer = require("multer");
const { v4: uuid } = require("uuid");
const { getDb } = require("../models/database");
const { authenticate, requireRole } = require("../middleware/auth");
const { validateMagicBytes } = require("../utils/fileValidation");

const router = express.Router();
router.use(authenticate);

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
        "SELECT cs.family_user_id FROM care_sessions cs JOIN visit_logs vl ON vl.session_id = cs.id WHERE vl.id = ?"
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
    }

    res.status(201).json({ photos, count: photos.length });
  }
);

// ─── GET /api/photos/visit/:visitLogId ───
// Get photos for a visit log (only if user is involved in the session)
router.get("/visit/:visitLogId", async (req, res) => {
  const db = await getDb();
  // Verify user is involved in the session this visit log belongs to
  const visitLog = await db.prepare(
    "SELECT vl.id, cs.family_user_id, cs.caregiver_id FROM visit_logs vl JOIN care_sessions cs ON vl.session_id = cs.id WHERE vl.id = ?"
  ).get(req.params.visitLogId);
  if (!visitLog) return res.json({ photos: [] });
  if (visitLog.family_user_id !== req.user.id && visitLog.caregiver_id !== req.user.id && !req.user.isAdmin) {
    return res.status(403).json({ error: "Not authorized to view these photos" });
  }
  const photos = await db
    .prepare(
      "SELECT id, visit_log_id, photo_url, caption, created_at FROM visit_photos WHERE visit_log_id = ? ORDER BY created_at ASC"
    )
    .all(req.params.visitLogId);

  res.json({ photos });
});

// ─── GET /api/photos/session/:sessionId ───
// Get all photos for a care session (only if user is involved)
router.get("/session/:sessionId", async (req, res) => {
  const db = await getDb();
  // Verify user is involved in this session
  const session = await db.prepare(
    "SELECT id, family_user_id, caregiver_id FROM care_sessions WHERE id = ?"
  ).get(req.params.sessionId);
  if (!session) return res.json({ photos: [] });
  if (session.family_user_id !== req.user.id && session.caregiver_id !== req.user.id && !req.user.isAdmin) {
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
