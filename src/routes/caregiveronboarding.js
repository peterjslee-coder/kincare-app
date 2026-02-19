const express = require("express");
const multer = require("multer");
const { v4: uuid } = require("uuid");
const { getDb } = require("../models/database");
const { authenticate } = require("../middleware/auth");

const router = express.Router();

// Multer config — same as photos.js (memory storage, 5MB, images only)
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

// All routes require authentication
router.use(authenticate);

// ─── POST /api/caregiver-onboarding/documents ───
// Upload identity/certification documents (DL front, DL back, cert images)
router.post("/documents", upload.array("documents", 10), async (req, res) => {
  try {
    const db = await getDb();

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "No files uploaded" });
    }

    // Parse document types and metadata from form data
    const types = req.body.types ? JSON.parse(req.body.types) : [];
    const metadata = req.body.metadata ? JSON.parse(req.body.metadata) : [];

    const savedDocs = [];
    for (let i = 0; i < req.files.length; i++) {
      const file = req.files[i];
      const base64 = `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;
      const docType = types[i] || "other";
      const docMeta = metadata[i] ? JSON.stringify(metadata[i]) : null;
      const docId = uuid();

      await db.prepare(`
        INSERT INTO caregiver_documents (id, user_id, document_type, file_data, file_name, metadata)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(docId, req.user.id, docType, base64, file.originalname, docMeta);

      savedDocs.push({
        id: docId,
        documentType: docType,
        fileName: file.originalname,
        metadata: metadata[i] || null,
      });
    }

    res.status(201).json({ documents: savedDocs, message: `${savedDocs.length} document(s) uploaded` });
  } catch (err) {
    console.error("Document upload error:", err);
    res.status(500).json({ error: "Failed to upload documents" });
  }
});

// ─── GET /api/caregiver-onboarding/documents ───
// Get documents for the authenticated user (or admin can query by userId)
router.get("/documents", async (req, res) => {
  try {
    const db = await getDb();
    const userId = req.query.userId || req.user.id;

    // Only admin can view other users' documents
    if (userId !== req.user.id) {
      const admin = await db.prepare("SELECT is_admin FROM users WHERE id = ?").get(req.user.id);
      if (!admin || !admin.is_admin) {
        return res.status(403).json({ error: "Not authorized" });
      }
    }

    const docs = await db.prepare(`
      SELECT id, document_type, file_name, metadata, created_at
      FROM caregiver_documents WHERE user_id = ?
      ORDER BY created_at ASC
    `).all(userId);

    res.json({ documents: docs });
  } catch (err) {
    console.error("Get documents error:", err);
    res.status(500).json({ error: "Failed to get documents" });
  }
});

// ─── GET /api/caregiver-onboarding/documents/:id/image ───
// Get the actual image data for a document
router.get("/documents/:id/image", async (req, res) => {
  try {
    const db = await getDb();
    const doc = await db.prepare(
      "SELECT file_data, user_id FROM caregiver_documents WHERE id = ?"
    ).get(req.params.id);

    if (!doc) return res.status(404).json({ error: "Document not found" });

    // Only owner or admin
    if (doc.user_id !== req.user.id) {
      const admin = await db.prepare("SELECT is_admin FROM users WHERE id = ?").get(req.user.id);
      if (!admin || !admin.is_admin) {
        return res.status(403).json({ error: "Not authorized" });
      }
    }

    res.json({ fileData: doc.file_data });
  } catch (err) {
    console.error("Get document image error:", err);
    res.status(500).json({ error: "Failed to get document" });
  }
});

// ─── DELETE /api/caregiver-onboarding/documents/:id ───
// Delete a document (owner only, during onboarding)
router.delete("/documents/:id", async (req, res) => {
  try {
    const db = await getDb();
    const doc = await db.prepare(
      "SELECT user_id FROM caregiver_documents WHERE id = ?"
    ).get(req.params.id);

    if (!doc) return res.status(404).json({ error: "Document not found" });
    if (doc.user_id !== req.user.id) {
      return res.status(403).json({ error: "Not authorized" });
    }

    await db.prepare("DELETE FROM caregiver_documents WHERE id = ?").run(req.params.id);
    res.json({ message: "Document deleted" });
  } catch (err) {
    console.error("Delete document error:", err);
    res.status(500).json({ error: "Failed to delete document" });
  }
});

module.exports = router;
