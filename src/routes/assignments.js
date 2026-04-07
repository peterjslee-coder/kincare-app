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
        cp.rate_daytime, cp.rate_nighttime, cp.rate_overnight,
        cp.specialties, cp.certifications, cp.open_to_interview,
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
  } else if (activeRole === "care_for") {
    // care_for users see assignments for their own linked care_recipient
    const recipient = await db.prepare(
      "SELECT id FROM care_recipients WHERE linked_user_id = ? LIMIT 1"
    ).get(req.user.id);
    if (!recipient) return res.json({ assignments: [] });
    query = `
      SELECT ca.*, cp.user_id AS caregiver_user_id,
        u.first_name, u.last_name, cp.rating_avg, cp.hourly_rate,
        cp.rate_daytime, cp.rate_nighttime, cp.rate_overnight,
        cp.specialties, cp.certifications, cp.open_to_interview,
        cr.first_name AS recipient_first_name, cr.last_name AS recipient_last_name
      FROM caregiver_assignments ca
      JOIN caregiver_profiles cp ON ca.caregiver_profile_id = cp.id
      JOIN users u ON cp.user_id = u.id
      JOIN care_recipients cr ON ca.care_recipient_id = cr.id
      WHERE ca.care_recipient_id = ? AND ca.is_active = 1
    `;
    params = [recipient.id];
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

// ─── GET /api/assignments/suggestions?careRecipientId=X ───
// Smart caregiver suggestions for the Request Care modal.
// Combines: (1) past caregivers for this recipient (session history),
//           (2) assigned caregivers, (3) nearby available caregivers.
// Returns a unified list with source labels and relevance signals.
router.get("/suggestions", async (req, res) => {
  try {
    const db = await getDb();
    const { careRecipientId } = req.query;
    const userId = req.user.id;
    const activeRole = req.user.activeRole || req.user.role;

    // Resolve care recipient: explicit param, or auto from role
    let recipientId = careRecipientId;
    if (!recipientId && activeRole === 'care_for') {
      const r = await db.prepare("SELECT id FROM care_recipients WHERE linked_user_id = ? LIMIT 1").get(userId);
      if (r) recipientId = r.id;
    }

    // Demo isolation
    const me = await db.prepare("SELECT is_demo FROM users WHERE id = ?").get(userId);
    const isDemo = me && me.is_demo ? 1 : 0;

    // 1) Caregivers from session history + assignments for this recipient
    //    This catches both formally assigned AND anyone who has cared for this person before
    const knownCaregivers = recipientId ? await db.prepare(`
      SELECT cp.id AS caregiver_profile_id, cp.user_id AS caregiver_user_id,
        u.first_name, u.last_name,
        cp.hourly_rate, cp.rate_daytime, cp.rate_nighttime, cp.rate_overnight,
        cp.specialties, cp.certifications, cp.open_to_interview,
        cp.rating_avg, cp.rating_count, cp.is_available,
        cp.location_city, cp.location_state,
        COUNT(DISTINCT cs.id) AS visit_count,
        MAX(cs.scheduled_date) AS last_visit,
        COALESCE(MAX(CASE WHEN ca.is_active = 1 THEN 1 ELSE 0 END), 0) AS is_assigned,
        COALESCE(MAX(CASE WHEN ca.is_favorite = 1 THEN 1 ELSE 0 END), 0) AS is_favorite,
        COALESCE(AVG(CASE WHEN r.rating IS NOT NULL THEN r.rating END), 0) AS avg_family_rating
      FROM caregiver_profiles cp
      JOIN users u ON cp.user_id = u.id
      LEFT JOIN care_sessions cs ON cs.caregiver_id = cp.id
        AND cs.care_recipient_id = ? AND cs.status IN ('completed', 'in_progress', 'confirmed')
      LEFT JOIN caregiver_assignments ca ON ca.caregiver_profile_id = cp.id
        AND ca.care_recipient_id = ? AND ca.family_user_id = ?
      LEFT JOIN reviews r ON r.caregiver_id = cp.id AND r.family_user_id = ?
      WHERE (cs.id IS NOT NULL OR (ca.id IS NOT NULL AND ca.is_active = 1))
        AND COALESCE(u.is_active, 1) = 1
        AND COALESCE(u.is_demo, 0) = ?
        AND COALESCE(cp.account_paused, 0) = 0
      GROUP BY cp.id, cp.user_id, u.first_name, u.last_name,
        cp.hourly_rate, cp.rate_daytime, cp.rate_nighttime, cp.rate_overnight,
        cp.specialties, cp.certifications, cp.open_to_interview,
        cp.rating_avg, cp.rating_count, cp.is_available,
        cp.location_city, cp.location_state
      ORDER BY
        COALESCE(MAX(CASE WHEN ca.is_favorite = 1 THEN 1 ELSE 0 END), 0) DESC,
        COUNT(DISTINCT cs.id) DESC,
        MAX(cs.scheduled_date) DESC
    `).all(recipientId, recipientId, userId, userId, isDemo) : [];

    const knownIds = new Set(knownCaregivers.map(c => c.caregiver_profile_id));

    // 2) Nearby available caregivers not already in the known list
    //    Use care recipient's location as center
    let nearbyCaregivers = [];
    if (recipientId) {
      const recipient = await db.prepare(
        "SELECT latitude, longitude FROM care_recipients WHERE id = ?"
      ).get(recipientId);

      if (recipient?.latitude && recipient?.longitude) {
        const lat = parseFloat(recipient.latitude);
        const lng = parseFloat(recipient.longitude);
        // Simple distance approximation (good enough for <50mi)
        const nearby = await db.prepare(`
          SELECT cp.id AS caregiver_profile_id, cp.user_id AS caregiver_user_id,
            u.first_name, u.last_name,
            cp.hourly_rate, cp.rate_daytime, cp.rate_nighttime, cp.rate_overnight,
            cp.specialties, cp.certifications, cp.open_to_interview,
            cp.rating_avg, cp.rating_count, cp.is_available,
            cp.location_city, cp.location_state, cp.latitude, cp.longitude
          FROM caregiver_profiles cp
          JOIN users u ON cp.user_id = u.id
          WHERE cp.is_available = 1
            AND COALESCE(u.is_active, 1) = 1
            AND COALESCE(u.is_demo, 0) = ?
            AND COALESCE(cp.account_paused, 0) = 0
            AND cp.onboarding_complete = 1
            AND cp.latitude IS NOT NULL AND cp.longitude IS NOT NULL
          ORDER BY cp.rating_avg DESC
          LIMIT 20
        `).all(isDemo);

        // Filter by distance in JS (haversine)
        const toRad = (d) => d * Math.PI / 180;
        const haversine = (lat1, lon1, lat2, lon2) => {
          const R = 3959; // miles
          const dLat = toRad(lat2 - lat1);
          const dLon = toRad(lon2 - lon1);
          const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2;
          return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        };

        for (const c of nearby) {
          if (knownIds.has(c.caregiver_profile_id)) continue;
          const dist = haversine(lat, lng, parseFloat(c.latitude), parseFloat(c.longitude));
          if (dist <= 25) {
            nearbyCaregivers.push({
              ...c,
              distance: Math.round(dist * 10) / 10,
              visit_count: 0, last_visit: null, is_assigned: 0, is_favorite: 0,
              specialties: c.specialties ? JSON.parse(c.specialties) : [],
              certifications: c.certifications ? JSON.parse(c.certifications) : [],
            });
          }
        }
        nearbyCaregivers.sort((a, b) => a.distance - b.distance);
        nearbyCaregivers = nearbyCaregivers.slice(0, 10);
      }
    }

    // Format known caregivers
    const formatKnown = knownCaregivers.map(c => ({
      ...c,
      specialties: c.specialties ? JSON.parse(c.specialties) : [],
      certifications: c.certifications ? JSON.parse(c.certifications) : [],
      source: c.visit_count > 0 ? 'history' : 'assigned',
      distance: null,
    }));

    res.json({
      suggestions: [
        ...formatKnown.map(c => ({ ...c, source: c.visit_count > 0 ? 'history' : 'assigned' })),
        ...nearbyCaregivers.map(c => ({ ...c, source: 'nearby' })),
      ],
    });
  } catch (err) {
    console.error("Caregiver suggestions error:", err);
    res.status(500).json({ error: "Failed to get suggestions" });
  }
});

module.exports = router;
