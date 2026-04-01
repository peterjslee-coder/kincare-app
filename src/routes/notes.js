const express = require("express");
const { v4: uuid } = require("uuid");
const { getDb } = require("../models/database");
const { authenticate } = require("../middleware/auth");

const router = express.Router();
router.use(authenticate);

// ─── Access control (same pattern as careRecipients.js) ───
async function hasAccess(db, recipientId, userId) {
  // Admin bypasses all checks
  const user = await db.prepare("SELECT is_admin FROM users WHERE id = ?").get(userId);
  if (user?.is_admin) return "admin";
  // Owner
  const owned = await db.prepare(
    "SELECT id FROM care_recipients WHERE id = ? AND family_user_id = ?"
  ).get(recipientId, userId);
  if (owned) return "owner";
  // Shared
  const shared = await db.prepare(
    "SELECT permission FROM care_recipient_shares WHERE care_recipient_id = ? AND shared_with_user_id = ?"
  ).get(recipientId, userId);
  if (shared) return shared.permission;
  // Care team membership
  const teamMember = await db.prepare(`
    SELECT ctm.role FROM care_team_members ctm
    JOIN care_teams ct ON ctm.care_team_id = ct.id
    WHERE ct.care_recipient_id = ? AND ctm.user_id = ?
  `).get(recipientId, userId);
  if (teamMember) return teamMember.role === 'leader' ? 'edit' : 'view';
  // Assigned caregiver (has an active/confirmed session)
  const assignedCg = await db.prepare(`
    SELECT cs.id FROM care_sessions cs
    JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
    WHERE cs.care_recipient_id = ? AND cp.user_id = ?
      AND cs.status IN ('confirmed', 'in_progress')
    LIMIT 1
  `).get(recipientId, userId);
  if (assignedCg) return "view";
  return null;
}

// GET /api/notes/:careRecipientId — get notes for a care recipient
// Accessible by: family (owner), shared users, care team members, assigned caregivers, admins
router.get("/:careRecipientId", async (req, res) => {
  const db = await getDb();
  const recipientId = req.params.careRecipientId;

  const access = await hasAccess(db, recipientId, req.user.id);
  if (!access) {
    return res.status(403).json({ error: "Not authorized to view notes for this care recipient" });
  }

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
  const { careRecipientId, content, noteType = "general", offlineTimestamp, offlineSync } = req.body;

  if (!careRecipientId || !content) {
    return res.status(400).json({ error: "careRecipientId and content required" });
  }

  // Access check — must have at least view access to add notes
  const access = await hasAccess(db, careRecipientId, req.user.id);
  if (!access) {
    return res.status(403).json({ error: "Not authorized to add notes for this care recipient" });
  }

  // Use offline timestamp if provided (caregiver was offline and recorded locally)
  const isOfflineSync = !!offlineSync;
  if (isOfflineSync) {
    console.log(`[notes] Offline sync — original time: ${offlineTimestamp}, recipient ${careRecipientId.slice(0, 8)}`);
  }

  const id = uuid();
  const createdAtSQL = isOfflineSync && offlineTimestamp
    ? `'${new Date(offlineTimestamp).toISOString()}'`
    : 'NOW()';
  await db.prepare(`
    INSERT INTO recipient_notes (id, care_recipient_id, author_id, content, note_type, created_at)
    VALUES (?, ?, ?, ?, ?, ${createdAtSQL})
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
  if (existing.author_id !== req.user.id && !(req.user.roles || [req.user.role]).includes("family")) {
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

  if (existing.author_id !== req.user.id && !(req.user.roles || [req.user.role]).includes("family")) {
    return res.status(403).json({ error: "Not authorized" });
  }

  await db.prepare("DELETE FROM recipient_notes WHERE id = ?").run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
