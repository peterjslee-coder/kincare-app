const express = require("express");
const { v4: uuid } = require("uuid");
const { getDb } = require("../models/database");
const { authenticate, requireRole } = require("../middleware/auth");

const router = express.Router();
router.use(authenticate);

// GET /api/assignments — list caregiver assignments for a care recipient
router.get("/", async (req, res) => {
  const db = await getDb();
  const { careRecipientId } = req.query;

  let query, params;
  const activeRole = req.user.activeRole || req.user.role;
  if (activeRole === "family") {
    query = `
      SELECT ca.*, cp.user_id AS caregiver_user_id,
        u.first_name, u.last_name, cp.rating_avg, cp.hourly_rate,
        cp.specialties, cp.certifications,
        cr.first_name AS recipient_first_name, cr.last_name AS recipient_last_name
      FROM caregiver_assignments ca
      JOIN caregiver_profiles cp ON ca.caregiver_profile_id = cp.id
      JOIN users u ON cp.user_id = u.id
      JOIN care_recipients cr ON ca.care_recipient_id = cr.id
      WHERE ca.family_user_id = ? AND ca.is_active = 1
    `;
    params = [req.user.id];
    if (careRecipientId) {
      query += " AND ca.care_recipient_id = ?";
      params.push(careRecipientId);
    }
  } else if (activeRole === "caregiver") {
    const profile = await db.prepare("SELECT id FROM caregiver_profiles WHERE user_id = ?").get(req.user.id);
    if (!profile) return res.status(404).json({ error: "Caregiver profile not found" });
    query = `
      SELECT ca.*, cr.first_name AS recipient_first_name, cr.last_name AS recipient_last_name,
        cr.location_address, cr.location_city, cr.location_state, cr.latitude, cr.longitude,
        fu.first_name AS family_first_name, fu.last_name AS family_last_name
      FROM caregiver_assignments ca
      JOIN care_recipients cr ON ca.care_recipient_id = cr.id
      JOIN users fu ON ca.family_user_id = fu.id
      WHERE ca.caregiver_profile_id = ? AND ca.is_active = 1
    `;
    params = [profile.id];
  } else {
    return res.json({ assignments: [] });
  }

  const assignments = await db.prepare(query).all(...params);
  res.json({
    assignments: assignments.map(a => ({
      ...a,
      specialties: a.specialties ? JSON.parse(a.specialties) : undefined,
      certifications: a.certifications ? JSON.parse(a.certifications) : undefined,
    }))
  });
});

// POST /api/assignments — assign a caregiver to a care recipient
router.post("/", requireRole("family"), async (req, res) => {
  const db = await getDb();
  const { careRecipientId, caregiverProfileId, isFavorite = false } = req.body;

  if (!careRecipientId || !caregiverProfileId) {
    return res.status(400).json({ error: "careRecipientId and caregiverProfileId required" });
  }

  // Check not already assigned
  const existing = await db.prepare(`
    SELECT id FROM caregiver_assignments
    WHERE care_recipient_id = ? AND caregiver_profile_id = ? AND family_user_id = ? AND is_active = 1
  `).get(careRecipientId, caregiverProfileId, req.user.id);

  if (existing) return res.status(409).json({ error: "Caregiver already assigned" });

  const id = uuid();
  await db.prepare(`
    INSERT INTO caregiver_assignments (id, care_recipient_id, family_user_id, caregiver_profile_id, is_favorite)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, careRecipientId, req.user.id, caregiverProfileId, isFavorite ? 1 : 0);

  res.status(201).json({ assignment: { id, careRecipientId, caregiverProfileId, isFavorite } });
});

// DELETE /api/assignments/:id — unassign a caregiver
router.delete("/:id", requireRole("family"), async (req, res) => {
  const db = await getDb();
  await db.prepare("UPDATE caregiver_assignments SET is_active = 0 WHERE id = ? AND family_user_id = ?")
    .run(req.params.id, req.user.id);
  res.json({ success: true });
});

// PUT /api/assignments/:id/favorite — toggle favorite status
router.put("/:id/favorite", requireRole("family"), async (req, res) => {
  const db = await getDb();
  // Toggle: flip current value
  const current = await db.prepare("SELECT is_favorite FROM caregiver_assignments WHERE id = ? AND family_user_id = ?")
    .get(req.params.id, req.user.id);
  const newVal = current && current.is_favorite ? 0 : 1;
  await db.prepare("UPDATE caregiver_assignments SET is_favorite = ? WHERE id = ? AND family_user_id = ?")
    .run(newVal, req.params.id, req.user.id);
  res.json({ success: true, isFavorite: !!newVal });
});

module.exports = router;
