const express = require("express");
const { v4: uuid } = require("uuid");
const { getDb } = require("../models/database");
const { authenticate, requireRole } = require("../middleware/auth");

const router = express.Router();
router.use(authenticate);

// ─── GET /api/care-recipients/:recipientId/emergency-contacts ───
router.get("/:recipientId/emergency-contacts", requireRole("family"), async (req, res) => {
  const db = await getDb();
  // Verify ownership
  const recipient = db.prepare(
    "SELECT id FROM care_recipients WHERE id = ? AND family_user_id = ?"
  ).get(req.params.recipientId, req.user.id);
  if (!recipient) return res.status(404).json({ error: "Care recipient not found" });

  const contacts = db.prepare(
    "SELECT * FROM emergency_contacts WHERE care_recipient_id = ? ORDER BY is_primary DESC, sort_order ASC"
  ).all(req.params.recipientId);

  res.json({ contacts });
});

// ─── POST /api/care-recipients/:recipientId/emergency-contacts ───
router.post("/:recipientId/emergency-contacts", requireRole("family"), async (req, res) => {
  const db = await getDb();
  const recipient = db.prepare(
    "SELECT id FROM care_recipients WHERE id = ? AND family_user_id = ?"
  ).get(req.params.recipientId, req.user.id);
  if (!recipient) return res.status(404).json({ error: "Care recipient not found" });

  const { name, relationship, phone, email, isPrimary } = req.body;
  if (!name) return res.status(400).json({ error: "name is required" });

  // Count existing contacts for sort_order
  const existing = db.prepare(
    "SELECT COUNT(*) as cnt FROM emergency_contacts WHERE care_recipient_id = ?"
  ).get(req.params.recipientId);

  const id = uuid();
  db.prepare(`
    INSERT INTO emergency_contacts (id, care_recipient_id, name, relationship, phone, email, is_primary, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.params.recipientId, name, relationship || null, phone || null, email || null, isPrimary ? 1 : 0, existing.cnt);

  const contact = db.prepare("SELECT * FROM emergency_contacts WHERE id = ?").get(id);
  res.status(201).json({ contact });
});

// ─── PUT /api/care-recipients/:recipientId/emergency-contacts/:id ───
router.put("/:recipientId/emergency-contacts/:id", requireRole("family"), async (req, res) => {
  const db = await getDb();
  const recipient = db.prepare(
    "SELECT id FROM care_recipients WHERE id = ? AND family_user_id = ?"
  ).get(req.params.recipientId, req.user.id);
  if (!recipient) return res.status(404).json({ error: "Care recipient not found" });

  const existing = db.prepare(
    "SELECT * FROM emergency_contacts WHERE id = ? AND care_recipient_id = ?"
  ).get(req.params.id, req.params.recipientId);
  if (!existing) return res.status(404).json({ error: "Contact not found" });

  const { name, relationship, phone, email, isPrimary } = req.body;
  db.prepare(`
    UPDATE emergency_contacts SET
      name = COALESCE(?, name),
      relationship = COALESCE(?, relationship),
      phone = COALESCE(?, phone),
      email = COALESCE(?, email),
      is_primary = COALESCE(?, is_primary)
    WHERE id = ?
  `).run(name, relationship, phone, email, isPrimary !== undefined ? (isPrimary ? 1 : 0) : null, req.params.id);

  const contact = db.prepare("SELECT * FROM emergency_contacts WHERE id = ?").get(req.params.id);
  res.json({ contact });
});

// ─── DELETE /api/care-recipients/:recipientId/emergency-contacts/:id ───
router.delete("/:recipientId/emergency-contacts/:id", requireRole("family"), async (req, res) => {
  const db = await getDb();
  const recipient = db.prepare(
    "SELECT id FROM care_recipients WHERE id = ? AND family_user_id = ?"
  ).get(req.params.recipientId, req.user.id);
  if (!recipient) return res.status(404).json({ error: "Care recipient not found" });

  const result = db.prepare(
    "DELETE FROM emergency_contacts WHERE id = ? AND care_recipient_id = ?"
  ).run(req.params.id, req.params.recipientId);

  if (result.changes === 0) return res.status(404).json({ error: "Contact not found" });
  res.json({ success: true });
});

module.exports = router;
