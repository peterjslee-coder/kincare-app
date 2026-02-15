const express = require("express");
const { v4: uuid } = require("uuid");
const { getDb } = require("../models/database");
const { authenticate, requireRole } = require("../middleware/auth");

const router = express.Router();
router.use(authenticate);

// ─── GET /api/caregivers ───
// Search/list available caregivers
router.get("/", async (req, res) => {
  const db = await getDb();
  const { specialty, available, limit = 20 } = req.query;

  let query = `
    SELECT cp.*, u.first_name, u.last_name, u.phone, u.avatar_url
    FROM caregiver_profiles cp
    JOIN users u ON cp.user_id = u.id
    WHERE u.is_active = 1
  `;
  const params = [];

  if (available === "true") {
    query += " AND cp.is_available = 1";
  }

  query += " ORDER BY cp.rating_avg DESC LIMIT ?";
  params.push(parseInt(limit));

  let caregivers = db.prepare(query).all(...params);

  // Filter by specialty in JS (JSON field)
  if (specialty) {
    caregivers = caregivers.filter((c) => {
      const specs = JSON.parse(c.specialties || "[]");
      return specs.some((s) => s.toLowerCase().includes(specialty.toLowerCase()));
    });
  }

  const result = caregivers.map((c) => ({
    id: c.id,
    name: `${c.first_name} ${c.last_name}`,
    bio: c.bio,
    yearsExperience: c.years_experience,
    hourlyRate: c.hourly_rate,
    specialties: JSON.parse(c.specialties || "[]"),
    certifications: JSON.parse(c.certifications || "[]"),
    rating: c.rating_avg,
    reviewCount: c.rating_count,
    isAvailable: !!c.is_available,
    isBackgroundChecked: !!c.is_background_checked,
    city: c.location_city,
    state: c.location_state,
  }));

  res.json({ caregivers: result });
});

// ─── GET /api/caregivers/:id ───
router.get("/:id", async (req, res) => {
  const db = await getDb();
  const cg = db.prepare(`
    SELECT cp.*, u.first_name, u.last_name, u.phone, u.avatar_url
    FROM caregiver_profiles cp
    JOIN users u ON cp.user_id = u.id
    WHERE cp.id = ?
  `).get(req.params.id);

  if (!cg) return res.status(404).json({ error: "Caregiver not found" });

  // Get recent reviews
  const reviews = db.prepare(`
    SELECT r.*, u.first_name || ' ' || u.last_name AS reviewer_name
    FROM reviews r
    JOIN users u ON r.family_user_id = u.id
    WHERE r.caregiver_id = ?
    ORDER BY r.created_at DESC LIMIT 10
  `).all(req.params.id);

  // Get completed session count
  const stats = db.prepare(`
    SELECT COUNT(*) as total_sessions,
           AVG(duration_hours) as avg_duration
    FROM care_sessions
    WHERE caregiver_id = ? AND status = 'completed'
  `).get(req.params.id);

  res.json({
    caregiver: {
      id: cg.id,
      name: `${cg.first_name} ${cg.last_name}`,
      bio: cg.bio,
      yearsExperience: cg.years_experience,
      hourlyRate: cg.hourly_rate,
      specialties: JSON.parse(cg.specialties || "[]"),
      certifications: JSON.parse(cg.certifications || "[]"),
      rating: cg.rating_avg,
      reviewCount: cg.rating_count,
      isAvailable: !!cg.is_available,
      isBackgroundChecked: !!cg.is_background_checked,
      city: cg.location_city,
      state: cg.location_state,
      totalSessions: stats.total_sessions,
      avgSessionDuration: stats.avg_duration,
    },
    reviews,
  });
});

// ─── POST /api/caregivers/profile ───
// Create or update caregiver profile (for caregiver users)
router.post("/profile", requireRole("caregiver"), async (req, res) => {
  const db = await getDb();
  const {
    bio, yearsExperience, hourlyRate, specialties,
    certifications, maxTravelMiles, city, state,
  } = req.body;

  if (!hourlyRate) {
    return res.status(400).json({ error: "hourlyRate is required" });
  }

  const existing = db.prepare(
    "SELECT id FROM caregiver_profiles WHERE user_id = ?"
  ).get(req.user.id);

  if (existing) {
    // Update
    db.prepare(`
      UPDATE caregiver_profiles SET
        bio = COALESCE(?, bio),
        years_experience = COALESCE(?, years_experience),
        hourly_rate = COALESCE(?, hourly_rate),
        specialties = COALESCE(?, specialties),
        certifications = COALESCE(?, certifications),
        max_travel_miles = COALESCE(?, max_travel_miles),
        location_city = COALESCE(?, location_city),
        location_state = COALESCE(?, location_state),
        updated_at = datetime('now')
      WHERE user_id = ?
    `).run(
      bio, yearsExperience, hourlyRate,
      specialties ? JSON.stringify(specialties) : null,
      certifications ? JSON.stringify(certifications) : null,
      maxTravelMiles, city, state,
      req.user.id
    );

    const updated = db.prepare("SELECT * FROM caregiver_profiles WHERE user_id = ?").get(req.user.id);
    return res.json({ profile: updated });
  }

  // Create
  const id = uuid();
  db.prepare(`
    INSERT INTO caregiver_profiles
    (id, user_id, bio, years_experience, hourly_rate, specialties,
     certifications, max_travel_miles, location_city, location_state)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, req.user.id, bio || null, yearsExperience || 0, hourlyRate,
    JSON.stringify(specialties || []),
    JSON.stringify(certifications || []),
    maxTravelMiles || 10, city || null, state || null
  );

  const profile = db.prepare("SELECT * FROM caregiver_profiles WHERE id = ?").get(id);
  res.status(201).json({ profile });
});

module.exports = router;
