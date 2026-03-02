const express = require("express");
const { v4: uuid } = require("uuid");
const { getDb } = require("../models/database");
const { authenticate, requireRole } = require("../middleware/auth");
const { geocodeAddress, buildAddressString, haversineDistance } = require("../utils/geocode");

const router = express.Router();
router.use(authenticate);

// ─── GET /api/caregivers ───
// Search/list available caregivers with optional location filtering
// Query params:
//   specialty  — filter by specialty string
//   available  — "true" to show only available
//   lat, lng   — center point for radius search
//   radius     — max distance in miles (default 25)
//   address    — address string to geocode (alternative to lat/lng)
//   limit      — max results (default 20)
router.get("/", async (req, res) => {
  const db = await getDb();
  const { specialty, available, limit = 20, lat, lng, radius = 25, address } = req.query;

  // Demo isolation: demo users see demo caregivers, real users see real caregivers
  const me = await db.prepare("SELECT is_demo FROM users WHERE id = ?").get(req.user.id);
  const isDemo = me && me.is_demo ? 1 : 0;

  let query = `
    SELECT cp.*, u.first_name, u.last_name, u.phone, u.avatar_url
    FROM caregiver_profiles cp
    JOIN users u ON cp.user_id = u.id
    WHERE COALESCE(u.is_active, 1) = 1 AND COALESCE(u.is_demo, 0) = ?
  `;
  const params = [isDemo];

  if (available === "true") {
    query += " AND cp.is_available = 1";
  }

  query += " ORDER BY cp.rating_avg DESC LIMIT ?";
  params.push(parseInt(limit));

  let caregivers = await db.prepare(query).all(...params);

  // Filter by specialty in JS (JSON field)
  if (specialty) {
    caregivers = caregivers.filter((c) => {
      const specs = JSON.parse(c.specialties || "[]");
      return specs.some((s) => s.toLowerCase().includes(specialty.toLowerCase()));
    });
  }

  // Resolve search center: explicit lat/lng, geocode address, or auto from care recipient/user location
  let searchLat = lat ? parseFloat(lat) : null;
  let searchLng = lng ? parseFloat(lng) : null;

  if (!searchLat && address) {
    const geo = await geocodeAddress(address);
    if (geo) {
      searchLat = geo.lat;
      searchLng = geo.lng;
    }
  }

  // Auto-resolve from care recipient location if no explicit search center
  if (!searchLat) {
    const recipient = await db.prepare(`
      SELECT latitude, longitude FROM care_recipients
      WHERE family_user_id = ? AND latitude IS NOT NULL AND longitude IS NOT NULL
      ORDER BY created_at ASC LIMIT 1
    `).get(req.user.id);
    if (recipient) {
      searchLat = parseFloat(recipient.latitude);
      searchLng = parseFloat(recipient.longitude);
    }
    // Fallback: check shared care recipients
    if (!searchLat) {
      const shared = await db.prepare(`
        SELECT cr.latitude, cr.longitude FROM care_recipient_shares crs
        JOIN care_recipients cr ON crs.care_recipient_id = cr.id
        WHERE crs.shared_with_user_id = ? AND cr.latitude IS NOT NULL AND cr.longitude IS NOT NULL
        LIMIT 1
      `).get(req.user.id);
      if (shared) {
        searchLat = parseFloat(shared.latitude);
        searchLng = parseFloat(shared.longitude);
      }
    }
  }

  // Hard cap: 100 miles max regardless of what's requested
  const maxRadius = Math.min(parseFloat(radius), 100);

  const result = caregivers.map((c) => {
    const entry = {
      id: c.id,
      name: `${c.first_name} ${c.last_name}`,
      bio: c.bio,
      yearsExperience: c.years_experience,
      hourlyRate: c.hourly_rate,
      rateDaytime: c.rate_daytime || c.hourly_rate,
      rateNighttime: c.rate_nighttime || c.hourly_rate,
      rateOvernight: c.rate_overnight || c.hourly_rate,
      specialties: JSON.parse(c.specialties || "[]"),
      certifications: JSON.parse(c.certifications || "[]"),
      rating: c.rating_avg,
      reviewCount: c.rating_count,
      isAvailable: !!c.is_available,
      isBackgroundChecked: !!c.is_background_checked,
      city: c.location_city,
      state: c.location_state,
      latitude: c.latitude,
      longitude: c.longitude,
      maxTravelMiles: c.max_travel_miles,
      profilePhoto: c.avatar_url || null,
    };

    // Calculate distance if search center is provided
    if (searchLat && searchLng && c.latitude && c.longitude) {
      entry.distance = Math.round(haversineDistance(searchLat, searchLng, c.latitude, c.longitude) * 10) / 10;
    }

    return entry;
  });

  // Filter by radius if search center is available; otherwise show all caregivers
  let filtered = result;
  if (searchLat && searchLng) {
    // Caregivers WITH location: filter by radius; WITHOUT location: include at end
    const withDist = result.filter((c) => c.distance !== undefined && c.distance <= maxRadius);
    const noDist = result.filter((c) => c.distance === undefined);
    filtered = [...withDist.sort((a, b) => a.distance - b.distance), ...noDist];
  } else {
    // No location available — still show all caregivers (sorted by rating)
    filtered = result.sort((a, b) => (b.rating || 0) - (a.rating || 0));
  }

  res.json({
    caregivers: filtered,
    searchCenter: searchLat ? { lat: searchLat, lng: searchLng } : null,
    radiusMiles: searchLat ? maxRadius : null,
    noLocation: !searchLat,
  });
});

// ─── GET /api/caregivers/nearby ───
// Get caregivers near a specific care recipient
router.get("/nearby/:careRecipientId", async (req, res) => {
  const db = await getDb();
  const { radius = 25 } = req.query;

  // Demo isolation
  const me = await db.prepare("SELECT is_demo FROM users WHERE id = ?").get(req.user.id);
  const isDemo = me && me.is_demo ? 1 : 0;

  const recipient = await db.prepare(
    "SELECT latitude, longitude, location_city, location_state FROM care_recipients WHERE id = ?"
  ).get(req.params.careRecipientId);

  if (!recipient) return res.status(404).json({ error: "Care recipient not found" });

  if (!recipient.latitude || !recipient.longitude) {
    return res.status(400).json({ error: "Care recipient has no location set" });
  }

  const allCaregivers = await db.prepare(`
    SELECT cp.*, u.first_name, u.last_name, u.avatar_url
    FROM caregiver_profiles cp
    JOIN users u ON cp.user_id = u.id
    WHERE COALESCE(u.is_active, 1) = 1 AND cp.is_available = 1
      AND cp.latitude IS NOT NULL AND cp.longitude IS NOT NULL
      AND COALESCE(u.is_demo, 0) = ?
  `).all(isDemo);

  const maxRadius = parseFloat(radius);

  const nearby = allCaregivers
    .map((c) => ({
      id: c.id,
      name: `${c.first_name} ${c.last_name}`,
      bio: c.bio,
      yearsExperience: c.years_experience,
      hourlyRate: c.hourly_rate,
      rateDaytime: c.rate_daytime || c.hourly_rate,
      rateNighttime: c.rate_nighttime || c.hourly_rate,
      rateOvernight: c.rate_overnight || c.hourly_rate,
      specialties: JSON.parse(c.specialties || "[]"),
      certifications: JSON.parse(c.certifications || "[]"),
      rating: c.rating_avg,
      reviewCount: c.rating_count,
      isBackgroundChecked: !!c.is_background_checked,
      city: c.location_city,
      state: c.location_state,
      latitude: c.latitude,
      longitude: c.longitude,
      maxTravelMiles: c.max_travel_miles,
      profilePhoto: c.avatar_url || null,
      distance: Math.round(
        haversineDistance(recipient.latitude, recipient.longitude, c.latitude, c.longitude) * 10
      ) / 10,
    }))
    .filter((c) => c.distance <= maxRadius)
    .sort((a, b) => a.distance - b.distance);

  res.json({
    caregivers: nearby,
    searchCenter: { lat: recipient.latitude, lng: recipient.longitude },
    radiusMiles: maxRadius,
    recipientLocation: `${recipient.location_city}, ${recipient.location_state}`,
  });
});

// ─── GET /api/caregivers/:id ───
router.get("/:id", async (req, res) => {
  const db = await getDb();
  const cg = await db.prepare(`
    SELECT cp.*, u.first_name, u.last_name, u.phone, u.avatar_url
    FROM caregiver_profiles cp
    JOIN users u ON cp.user_id = u.id
    WHERE cp.id = ?
  `).get(req.params.id);

  if (!cg) return res.status(404).json({ error: "Caregiver not found" });

  // Get recent reviews
  const reviews = await db.prepare(`
    SELECT r.*, u.first_name || ' ' || u.last_name AS reviewer_name
    FROM reviews r
    JOIN users u ON r.family_user_id = u.id
    WHERE r.caregiver_id = ?
    ORDER BY r.created_at DESC LIMIT 10
  `).all(req.params.id);

  // Get completed session count
  const stats = await db.prepare(`
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
      rateDaytime: cg.rate_daytime || cg.hourly_rate,
      rateNighttime: cg.rate_nighttime || cg.hourly_rate,
      rateOvernight: cg.rate_overnight || cg.hourly_rate,
      specialties: JSON.parse(cg.specialties || "[]"),
      certifications: JSON.parse(cg.certifications || "[]"),
      rating: cg.rating_avg,
      reviewCount: cg.rating_count,
      isAvailable: !!cg.is_available,
      isBackgroundChecked: !!cg.is_background_checked,
      city: cg.location_city,
      state: cg.location_state,
      latitude: cg.latitude,
      longitude: cg.longitude,
      maxTravelMiles: cg.max_travel_miles,
      totalSessions: stats.total_sessions,
      avgSessionDuration: stats.avg_duration,
    },
    reviews,
  });
});

// ─── GET /api/caregivers/me ───
// Get the current caregiver's own profile (for map centering, etc.)
router.get("/me", requireRole("caregiver"), async (req, res) => {
  const db = await getDb();
  const profile = await db.prepare(`
    SELECT cp.*, u.first_name, u.last_name, u.email, u.phone, u.avatar_url
    FROM caregiver_profiles cp
    JOIN users u ON cp.user_id = u.id
    WHERE cp.user_id = ?
  `).get(req.user.id);

  if (!profile) return res.status(404).json({ error: "Caregiver profile not found" });

  res.json({ profile });
});

// ─── PUT /api/caregivers/me ───
// Update caregiver's own profile fields (care preferences, rates, etc.)
router.put("/me", requireRole("caregiver"), async (req, res) => {
  const db = await getDb();
  const profile = await db.prepare("SELECT id FROM caregiver_profiles WHERE user_id = ?").get(req.user.id);
  if (!profile) return res.status(404).json({ error: "Caregiver profile not found" });

  const { care_preferences, rateDaytime, rateNighttime, rateOvernight } = req.body;
  const updates = [];
  const params = [];

  if (care_preferences !== undefined) { updates.push("care_preferences = ?"); params.push(care_preferences); }
  if (rateDaytime !== undefined) { updates.push("rate_daytime = ?"); params.push(parseFloat(rateDaytime) || null); }
  if (rateNighttime !== undefined) { updates.push("rate_nighttime = ?"); params.push(parseFloat(rateNighttime) || null); }
  if (rateOvernight !== undefined) { updates.push("rate_overnight = ?"); params.push(parseFloat(rateOvernight) || null); }
  if (rateDaytime !== undefined) { updates.push("hourly_rate = ?"); params.push(parseFloat(rateDaytime) || null); }

  if (updates.length === 0) return res.json({ ok: true });

  params.push(profile.id);
  await db.prepare(`UPDATE caregiver_profiles SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  res.json({ ok: true });
});

// ─── POST /api/caregivers/profile ───
// Create or update caregiver profile (for caregiver users)
router.post("/profile", requireRole("caregiver"), async (req, res) => {
  try {
    const db = await getDb();
    const {
      bio, yearsExperience, hourlyRate, specialties,
      certifications, maxTravelMiles, city, state, address,
      // Checkr / onboarding fields
      legalFirstName, legalLastName, dateOfBirth, ssnLast4,
      addressLine1, addressLine2, zip, dlNumber, dlState,
      backgroundCheckConsent,
      // v1.5.0 — work location, stoplight, terms
      workLocationAddress, travelRadius, careStoplight,
      termsAcceptedAt, termsVersion,
      // v1.13.2 — academic program tracking
      academicProgram, academicProgramYear, needsHourReports,
      // v1.29.1 — tiered rates from onboarding
      rateDaytime, rateNighttime, rateOvernight,
      // v1.34.55 — interview openness
      openToInterview,
    } = req.body;

    // Auto-geocode if city/state/zip provided
    let lat = null;
    let lng = null;
    if (city || address || zip) {
      const addrStr = buildAddressString({ address, city, state, zip });
      console.log(`  [caregiver-profile] Geocoding: "${addrStr}"`);
      const geo = await geocodeAddress(addrStr);
      if (geo) {
        lat = geo.lat;
        lng = geo.lng;
        console.log(`  [caregiver-profile] Geocoded to: ${lat}, ${lng}`);
      } else {
        console.log(`  [caregiver-profile] Geocoding failed for: "${addrStr}"`);
      }
    }

    const existing = await db.prepare(
      "SELECT id FROM caregiver_profiles WHERE user_id = ?"
    ).get(req.user.id);

    if (existing) {
      // Update
      await db.prepare(`
        UPDATE caregiver_profiles SET
          bio = COALESCE(?, bio),
          years_experience = COALESCE(?, years_experience),
          hourly_rate = COALESCE(?, hourly_rate),
          specialties = COALESCE(?, specialties),
          certifications = COALESCE(?, certifications),
          max_travel_miles = COALESCE(?, max_travel_miles),
          location_city = COALESCE(?, location_city),
          location_state = COALESCE(?, location_state),
          latitude = COALESCE(?, latitude),
          longitude = COALESCE(?, longitude),
          legal_first_name = COALESCE(?, legal_first_name),
          legal_last_name = COALESCE(?, legal_last_name),
          date_of_birth = COALESCE(?, date_of_birth),
          ssn_last4 = COALESCE(?, ssn_last4),
          address_line1 = COALESCE(?, address_line1),
          address_line2 = COALESCE(?, address_line2),
          zip = COALESCE(?, zip),
          dl_number = COALESCE(?, dl_number),
          dl_state = COALESCE(?, dl_state),
          background_check_consent = COALESCE(?, background_check_consent),
          background_check_consent_at = CASE WHEN ? = 1 THEN NOW() ELSE background_check_consent_at END,
          work_location_address = COALESCE(?, work_location_address),
          care_stoplight = COALESCE(?, care_stoplight),
          terms_accepted_at = COALESCE(?, terms_accepted_at),
          terms_version = COALESCE(?, terms_version),
          academic_program = COALESCE(?, academic_program),
          academic_program_year = COALESCE(?, academic_program_year),
          needs_hour_reports = COALESCE(?, needs_hour_reports),
          open_to_interview = COALESCE(?, open_to_interview),
          updated_at = NOW()
        WHERE user_id = ?
      `).run(
        bio, yearsExperience, hourlyRate,
        specialties ? JSON.stringify(specialties) : null,
        certifications ? JSON.stringify(certifications) : null,
        travelRadius || maxTravelMiles, city, state,
        lat, lng,
        legalFirstName || null, legalLastName || null,
        dateOfBirth || null, ssnLast4 || null,
        addressLine1 || null, addressLine2 || null, zip || null,
        dlNumber || null, dlState || null,
        backgroundCheckConsent ? 1 : null, backgroundCheckConsent ? 1 : 0,
        workLocationAddress || null,
        careStoplight ? JSON.stringify(careStoplight) : null,
        termsAcceptedAt || null, termsVersion || null,
        academicProgram || null, academicProgramYear || null,
        needsHourReports != null ? (needsHourReports ? 1 : 0) : null,
        openToInterview === true ? 1 : openToInterview === false ? 0 : null,
        req.user.id
      );

      // Backfill tiered rates from hourly_rate if they're still NULL
      if (hourlyRate) {
        await db.prepare(`
          UPDATE caregiver_profiles SET
            rate_daytime = COALESCE(rate_daytime, ?),
            rate_nighttime = COALESCE(rate_nighttime, ?),
            rate_overnight = COALESCE(rate_overnight, ?)
          WHERE user_id = ? AND (rate_daytime IS NULL OR rate_nighttime IS NULL OR rate_overnight IS NULL)
        `).run(hourlyRate, hourlyRate, hourlyRate, req.user.id);
      }

      const updated = await db.prepare("SELECT * FROM caregiver_profiles WHERE user_id = ?").get(req.user.id);
      console.log(`  [caregiver-profile] Updated profile for user=${req.user.id} (${req.user.email})`);
      return res.json({ profile: updated });
    }

    // Create — hourlyRate required for new profiles
    if (!hourlyRate) {
      return res.status(400).json({ error: "hourlyRate is required" });
    }
    const id = uuid();
    await db.prepare(`
      INSERT INTO caregiver_profiles
      (id, user_id, bio, years_experience, hourly_rate, rate_daytime, rate_nighttime, rate_overnight,
       specialties, certifications, max_travel_miles, location_city, location_state,
       latitude, longitude, legal_first_name, legal_last_name,
       date_of_birth, ssn_last4, address_line1, address_line2, zip,
       dl_number, dl_state, background_check_consent, background_check_consent_at,
       work_location_address, care_stoplight, terms_accepted_at, terms_version,
       academic_program, academic_program_year, needs_hour_reports, open_to_interview)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${backgroundCheckConsent ? "NOW()" : "NULL"},
       ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, req.user.id, bio || null, yearsExperience || 0, hourlyRate,
      rateDaytime || hourlyRate, rateNighttime || hourlyRate, rateOvernight || hourlyRate,
      JSON.stringify(specialties || []),
      JSON.stringify(certifications || []),
      maxTravelMiles || 10, city || null, state || null,
      lat, lng,
      legalFirstName || null, legalLastName || null,
      dateOfBirth || null, ssnLast4 || null,
      addressLine1 || null, addressLine2 || null, zip || null,
      dlNumber || null, dlState || null,
      backgroundCheckConsent ? 1 : 0,
      workLocationAddress || null,
      careStoplight ? JSON.stringify(careStoplight) : null,
      termsAcceptedAt || null, termsVersion || null,
      academicProgram || null, academicProgramYear || null,
      needsHourReports ? 1 : 0,
      openToInterview === true ? 1 : openToInterview === false ? 0 : null
    );

    const profile = await db.prepare("SELECT * FROM caregiver_profiles WHERE id = ?").get(id);
    console.log(`  [caregiver-profile] Created new profile id=${id} for user=${req.user.id} (${req.user.email})`);
    res.status(201).json({ profile });
  } catch (err) {
    console.error(`  [caregiver-profile] ❌ Error for user=${req.user?.id} (${req.user?.email}):`, err.message);
    res.status(500).json({ error: "Failed to save caregiver profile. Please try again." });
  }
});

// ─── PUT /api/caregivers/rates ───
// Update tiered rates (daytime / nighttime / overnight)
router.put("/rates", requireRole("caregiver"), async (req, res) => {
  const { rateDaytime, rateNighttime, rateOvernight } = req.body;

  // Validate
  const rates = [rateDaytime, rateNighttime, rateOvernight];
  for (const r of rates) {
    if (r !== undefined && r !== null) {
      if (typeof r !== 'number' || r <= 0 || r > 500) {
        return res.status(400).json({ error: "Rates must be between $0.01 and $500/hr" });
      }
    }
  }

  if (!rateDaytime && !rateNighttime && !rateOvernight) {
    return res.status(400).json({ error: "At least one rate is required" });
  }

  const db = await getDb();
  const profile = await db.prepare("SELECT id FROM caregiver_profiles WHERE user_id = ?").get(req.user.id);
  if (!profile) return res.status(404).json({ error: "Caregiver profile not found" });

  await db.prepare(`
    UPDATE caregiver_profiles SET
      rate_daytime = COALESCE(?, rate_daytime),
      rate_nighttime = COALESCE(?, rate_nighttime),
      rate_overnight = COALESCE(?, rate_overnight),
      hourly_rate = COALESCE(?, hourly_rate),
      updated_at = NOW()
    WHERE user_id = ?
  `).run(rateDaytime || null, rateNighttime || null, rateOvernight || null, rateDaytime || null, req.user.id);

  const updated = await db.prepare("SELECT * FROM caregiver_profiles WHERE user_id = ?").get(req.user.id);
  res.json({
    rates: {
      daytime: updated.rate_daytime,
      nighttime: updated.rate_nighttime,
      overnight: updated.rate_overnight,
      base: updated.hourly_rate,
    }
  });
});

// ─── PUT /api/caregivers/mark-onboarding-complete ───
// Verify all 6 onboarding steps are done, then set onboarding_complete = 1
router.put("/mark-onboarding-complete", async (req, res) => {
  if (req.user.role !== "caregiver") {
    return res.status(403).json({ error: "Caregiver role required" });
  }

  const db = await getDb();
  const profile = await db.prepare(`
    SELECT cp.*, u.avatar_url
    FROM caregiver_profiles cp
    JOIN users u ON cp.user_id = u.id
    WHERE cp.user_id = ?
  `).get(req.user.id);

  if (!profile) {
    return res.status(404).json({ error: "Caregiver profile not found" });
  }

  // Check availability rules
  const availRules = await db.prepare("SELECT id FROM availability WHERE user_id = ?").all(req.user.id);

  // Verify all 6 criteria
  const missing = [];
  if (!profile.bio || !profile.hourly_rate) missing.push("Profile (bio & hourly rate)");
  if (!availRules || availRules.length === 0) missing.push("Availability");
  if (!profile.care_stoplight) missing.push("Care preferences");
  if (!profile.avatar_url) missing.push("Profile photo");
  if (!profile.stripe_onboard_complete) missing.push("Stripe payments");
  if (!profile.background_check_paid && !profile.is_background_checked) missing.push("Background check");

  if (missing.length > 0) {
    return res.status(400).json({ error: "Incomplete onboarding", missing });
  }

  await db.prepare("UPDATE caregiver_profiles SET onboarding_complete = 1 WHERE user_id = ?").run(req.user.id);

  res.json({ onboarding_complete: 1, message: "Onboarding complete! You're ready to accept care requests." });
});

module.exports = router;
