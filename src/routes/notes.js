const express = require("express");
const { v4: uuid } = require("uuid");
const { getDb } = require("../models/database");
const { authenticate } = require("../middleware/auth");

const router = express.Router();
router.use(authenticate);

// GET /api/notes/:careRecipientId — get notes for a care recipient
// Accessible by: family (owner), caregiver (assigned), care_for (self)
router.get("/:careRecipientId", async (req, res) => {
  const db = await getDb();
  const recipientId = req.params.careRecipientId;

  const notes = await db.prepare(`
    SELECT rn.*, u.first_name AS author_first_name, u.last_name AS author_last_name, u.role AS author_role
    FROM recipient_notes rn
    JOIN users u ON rn.author_id = u.id
    WHERE rn.care_recipient_id = ?
    ORDER BY rn.created_at DESC
  `).all(recipientId);

  res.json({ notes });
});

// POST /api/notes — create a note
router.post("/", async (req, res) => {
  const db = await getDb();
  const { careRecipientId, content, noteType = "general" } = req.body;

  if (!careRecipientId || !content) {
    return res.status(400).json({ error: "careRecipientId and content required" });
  }

  const id = uuid();
  await db.prepare(`
    INSERT INTO recipient_notes (id, care_recipient_id, author_id, content, note_type)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, careRecipientId, req.user.id, content, noteType);

  const note = await db.prepare(`
    SELECT rn.*, u.first_name AS author_first_name, u.last_name AS author_last_name, u.role AS author_role
    FROM recipient_notes rn JOIN users u ON rn.author_id = u.id WHERE rn.id = ?
  `).get(id);
  res.status(201).json({ note });
});

// PUT /api/notes/:id — edit a note (author or family owner can edit)
router.put("/:id", async (req, res) => {
  const db = await getDb();
  const { content, noteType } = req.body;

  const existing = await db.prepare("SELECT * FROM recipient_notes WHERE id = ?").get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Note not found" });

  // Author can edit their own, family can edit any (for spelling/clarity)
  if (existing.author_id !== req.user.id && req.user.role !== "family") {
    return res.status(403).json({ error: "Not authorized to edit this note" });
  }

  await db.prepare(`
    UPDATE recipient_notes SET content = COALESCE(?, content), note_type = COALESCE(?, note_type), updated_at = NOW()
    WHERE id = ?
  `).run(content, noteType, req.params.id);

  const note = await db.prepare(`
    SELECT rn.*, u.first_name AS author_first_name, u.last_name AS author_last_name, u.role AS author_role
    FROM recipient_notes rn JOIN users u ON rn.author_id = u.id WHERE rn.id = ?
  `).get(req.params.id);
  res.json({ note });
});

// DELETE /api/notes/:id — delete a note
router.delete("/:id", async (req, res) => {
  const db = await getDb();
  const existing = await db.prepare("SELECT * FROM recipient_notes WHERE id = ?").get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Note not found" });

  if (existing.author_id !== req.user.id && req.user.role !== "family") {
    return res.status(403).json({ error: "Not authorized" });
  }

  await db.prepare("DELETE FROM recipient_notes WHERE id = ?").run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
