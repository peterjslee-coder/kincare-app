const express = require("express");
const { v4: uuid } = require("uuid");
const { getDb } = require("../models/database");
const { authenticate, requireRole } = require("../middleware/auth");

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// ─── GET /api/care-recipients ───
// List care recipients for the logged-in family user
router.get("/", requireRole("family", "admin"), async (req, res) => {
  const db = await getDb();
  const recipients = await db.prepare(
    "SELECT * FROM care_recipients WHERE family_user_id = ? ORDER BY created_at DESC"
  ).all(req.user.id);

  // Parse JSON fields
  const parsed = recipients.map((r) => ({
    ...r,
    healthConditions: JSON.parse(r.health_conditions || "[]"),
    medications: JSON.parse(r.medications || "[]"),
  }));

  res.json({ careRecipients: parsed });
});

// ─── POST /api/care-recipients ───
// Add a new care recipient (parent)
router.post("/", requireRole("family"), async (req, res) => {
  const {
    firstName, lastName, age, address, city, state, zip,
    healthConditions, medications, preferences,
    emergencyContactName, emergencyContactPhone,
  } = req.body;

  if (!firstName || !lastName) {
    return res.status(400).json({ error: "firstName and lastName required" });
  }

  const db = await getDb();
  const id = uuid();

  await db.prepare(`
    INSERT INTO care_recipients
    (id, family_user_id, first_name, last_name, age,
     location_address, location_city, location_state, location_zip,
     health_conditions, medications, preferences,
     emergency_contact_name, emergency_contact_phone)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, req.user.id, firstName, lastName, age || null,
    address || null, city || null, state || null, zip || null,
    JSON.stringify(healthConditions || []),
    JSON.stringify(medications || []),
    preferences || null,
    emergencyContactName || null, emergencyContactPhone || null
  );

  const recipient = await db.prepare("SELECT * FROM care_recipients WHERE id = ?").get(id);
  res.status(201).json({ careRecipient: recipient });
});

// ─── GET /api/care-recipients/:id ───
router.get("/:id", requireRole("family", "admin"), async (req, res) => {
  const db = await getDb();
  const recipient = await db.prepare(
    "SELECT * FROM care_recipients WHERE id = ? AND family_user_id = ?"
  ).get(req.params.id, req.user.id);

  if (!recipient) return res.status(404).json({ error: "Care recipient not found" });

  res.json({
    careRecipient: {
      ...recipient,
      healthConditions: JSON.parse(recipient.health_conditions || "[]"),
      medications: JSON.parse(recipient.medications || "[]"),
    },
  });
});

// ─── PUT /api/care-recipients/:id ───
router.put("/:id", requireRole("family"), async (req, res) => {
  const db = await getDb();
  const existing = await db.prepare(
    "SELECT * FROM care_recipients WHERE id = ? AND family_user_id = ?"
  ).get(req.params.id, req.user.id);

  if (!existing) return res.status(404).json({ error: "Care recipient not found" });

  const {
    firstName, lastName, age, address, city, state, zip,
    healthConditions, medications, preferences,
    emergencyContactName, emergencyContactPhone,
  } = req.body;

  await db.prepare(`
    UPDATE care_recipients SET
      first_name = COALESCE(?, first_name),
      last_name = COALESCE(?, last_name),
      age = COALESCE(?, age),
      location_address = COALESCE(?, location_address),
      location_city = COALESCE(?, location_city),
      location_state = COALESCE(?, location_state),
      location_zip = COALESCE(?, location_zip),
      health_conditions = COALESCE(?, health_conditions),
      medications = COALESCE(?, medications),
      preferences = COALESCE(?, preferences),
      emergency_contact_name = COALESCE(?, emergency_contact_name),
      emergency_contact_phone = COALESCE(?, emergency_contact_phone),
      updated_at = NOW()
    WHERE id = ?
  `).run(
    firstName, lastName, age,
    address, city, state, zip,
    healthConditions ? JSON.stringify(healthConditions) : null,
    medications ? JSON.stringify(medications) : null,
    preferences,
    emergencyContactName, emergencyContactPhone,
    req.params.id
  );

  const updated = await db.prepare("SELECT * FROM care_recipients WHERE id = ?").get(req.params.id);
  res.json({ careRecipient: updated });
});

module.exports = router;
