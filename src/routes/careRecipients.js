const express = require("express");
const { v4: uuid } = require("uuid");
const { getDb } = require("../models/database");
const { authenticate, requireRole } = require("../middleware/auth");
const { geocodeAddress, buildAddressString } = require("../utils/geocode");

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// ─── GET /api/care-recipients ───
// List care recipients for the logged-in family user (owned + shared)
router.get("/", requireRole("family", "admin"), async (req, res) => {
  const db = await getDb();

  // Own recipients
  const owned = await db.prepare(
    "SELECT *, 'owner' AS access_level FROM care_recipients WHERE family_user_id = ? ORDER BY created_at DESC"
  ).all(req.user.id);

  // Shared with me
  const shared = await db.prepare(`
    SELECT cr.*, crs.permission AS access_level
    FROM care_recipient_shares crs
    JOIN care_recipients cr ON crs.care_recipient_id = cr.id
    WHERE crs.shared_with_user_id = ?
    ORDER BY cr.created_at DESC
  `).all(req.user.id);

  // Merge and deduplicate (owner takes precedence)
  const ownedIds = new Set(owned.map(r => r.id));
  const all = [...owned, ...shared.filter(r => !ownedIds.has(r.id))];

  // Parse JSON fields
  const parsed = all.map((r) => ({
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
    phone, email,
    healthConditions, medications, preferences,
    emergencyContactName, emergencyContactPhone, emoji,
    authorizationTier,
  } = req.body;

  if (!firstName || !lastName) {
    return res.status(400).json({ error: "firstName and lastName required" });
  }

  const db = await getDb();
  const id = uuid();

  // Auto-geocode address
  let lat = null, lng = null;
  if (address || city) {
    const geo = await geocodeAddress(buildAddressString({ address, city, state, zip }));
    if (geo) { lat = geo.lat; lng = geo.lng; }
  }

  // Determine consent status based on authorization tier
  const tier = ['tier1', 'tier2', 'tier3'].includes(authorizationTier) ? authorizationTier : 'tier3';
  const consentStatus = tier === 'tier1' ? 'verified' : 'pending';
  const consentMethod = tier === 'tier1' ? 'self_signup' : null;
  const consentVerifiedAt = tier === 'tier1' ? new Date().toISOString() : null;

  await db.prepare(`
    INSERT INTO care_recipients
    (id, family_user_id, first_name, last_name, age,
     location_address, location_city, location_state, location_zip,
     latitude, longitude,
     health_conditions, medications, preferences,
     emergency_contact_name, emergency_contact_phone, emoji,
     sms_phone, email,
     authorization_tier, consent_status, consent_method, consent_verified_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, req.user.id, firstName, lastName, age || null,
    address || null, city || null, state || null, zip || null,
    lat, lng,
    JSON.stringify(healthConditions || []),
    JSON.stringify(medications || []),
    preferences || null,
    emergencyContactName || null, emergencyContactPhone || null,
    emoji || null,
    phone || null, email || null,
    tier, consentStatus, consentMethod, consentVerifiedAt
  );

  const recipient = await db.prepare("SELECT * FROM care_recipients WHERE id = ?").get(id);

  // Auto-create a care team for this recipient
  const teamId = uuid();
  const teamName = `${firstName} ${lastName}'s Care Team`;
  await db.prepare(
    "INSERT INTO care_teams (id, name, care_recipient_id, created_by) VALUES (?, ?, ?, ?)"
  ).run(teamId, teamName, id, req.user.id);

  // Add the creator as the team leader
  await db.prepare(
    "INSERT INTO care_team_members (id, care_team_id, user_id, role, invited_by) VALUES (?, ?, ?, 'leader', ?)"
  ).run(uuid(), teamId, req.user.id, req.user.id);

  // Auto-create a care team conversation
  const convId = uuid();
  await db.prepare(
    "INSERT INTO conversations (id, type, name, care_team_id, created_by) VALUES (?, 'care_team', ?, ?, ?)"
  ).run(convId, teamName, teamId, req.user.id);
  await db.prepare(
    "INSERT INTO conversation_members (id, conversation_id, user_id, role) VALUES (?, ?, ?, 'admin')"
  ).run(uuid(), convId, req.user.id);

  res.status(201).json({ careRecipient: recipient, careTeamId: teamId });
});

// ─── Helper: check if user has access to a care recipient ───
async function hasAccess(db, recipientId, userId) {
  // Check owner
  const owned = await db.prepare(
    "SELECT id FROM care_recipients WHERE id = ? AND family_user_id = ?"
  ).get(recipientId, userId);
  if (owned) return "owner";
  // Check shared
  const shared = await db.prepare(
    "SELECT permission FROM care_recipient_shares WHERE care_recipient_id = ? AND shared_with_user_id = ?"
  ).get(recipientId, userId);
  return shared ? shared.permission : null;
}

// ─── GET /api/care-recipients/:id ───
router.get("/:id", requireRole("family", "admin"), async (req, res) => {
  const db = await getDb();
  const access = await hasAccess(db, req.params.id, req.user.id);
  if (!access) return res.status(404).json({ error: "Care recipient not found" });

  const recipient = await db.prepare("SELECT * FROM care_recipients WHERE id = ?").get(req.params.id);
  if (!recipient) return res.status(404).json({ error: "Care recipient not found" });

  // Get sharing info if owner
  let sharedWith = [];
  if (access === "owner") {
    sharedWith = await db.prepare(`
      SELECT crs.id AS share_id, crs.permission, crs.created_at,
        u.id AS user_id, u.first_name, u.last_name, u.email
      FROM care_recipient_shares crs
      JOIN users u ON crs.shared_with_user_id = u.id
      WHERE crs.care_recipient_id = ?
    `).all(req.params.id);
  }

  res.json({
    careRecipient: {
      ...recipient,
      healthConditions: JSON.parse(recipient.health_conditions || "[]"),
      medications: JSON.parse(recipient.medications || "[]"),
      accessLevel: access,
      sharedWith: sharedWith.map(s => ({
        shareId: s.share_id,
        userId: s.user_id,
        name: `${s.first_name} ${s.last_name}`,
        email: s.email,
        permission: s.permission,
      })),
    },
  });
});

// ─── PUT /api/care-recipients/:id ───
router.put("/:id", requireRole("family", "admin"), async (req, res) => {
  const db = await getDb();
  const isAdmin = req.isAdmin === true;
  const access = isAdmin ? "owner" : await hasAccess(db, req.params.id, req.user.id);
  if (!access) return res.status(404).json({ error: "Care recipient not found" });
  if (access === "view") return res.status(403).json({ error: "You have view-only access to this care recipient" });

  const existing = await db.prepare("SELECT * FROM care_recipients WHERE id = ?").get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Care recipient not found" });

  const {
    firstName, lastName, age, address, city, state, zip,
    healthConditions, medications, preferences,
    emergencyContactName, emergencyContactPhone, emoji,
    aiCareSummary, phone, email,
  } = req.body;

  // Re-geocode if address changed
  let lat = null, lng = null;
  if (address || city) {
    const addrStr = buildAddressString({
      address: address || existing.location_address,
      city: city || existing.location_city,
      state: state || existing.location_state,
      zip: zip || existing.location_zip,
    });
    const geo = await geocodeAddress(addrStr);
    if (geo) { lat = geo.lat; lng = geo.lng; }
  }

  await db.prepare(`
    UPDATE care_recipients SET
      first_name = COALESCE(?, first_name),
      last_name = COALESCE(?, last_name),
      age = COALESCE(?, age),
      location_address = COALESCE(?, location_address),
      location_city = COALESCE(?, location_city),
      location_state = COALESCE(?, location_state),
      location_zip = COALESCE(?, location_zip),
      latitude = COALESCE(?, latitude),
      longitude = COALESCE(?, longitude),
      health_conditions = COALESCE(?, health_conditions),
      medications = COALESCE(?, medications),
      preferences = COALESCE(?, preferences),
      emergency_contact_name = COALESCE(?, emergency_contact_name),
      emergency_contact_phone = COALESCE(?, emergency_contact_phone),
      sms_phone = COALESCE(?, sms_phone),
      email = COALESCE(?, email),
      emoji = ${('emoji' in req.body) ? '?' : 'emoji'},
      ai_care_summary = ${('aiCareSummary' in req.body) ? '?' : 'ai_care_summary'},
      ai_care_summary_updated_at = ${('aiCareSummary' in req.body) ? 'NOW()' : 'ai_care_summary_updated_at'},
      caregiver_briefing = ${('caregiverBriefing' in req.body) ? '?' : 'caregiver_briefing'},
      caregiver_briefing_updated_at = ${('caregiverBriefing' in req.body) ? 'NOW()' : 'caregiver_briefing_updated_at'},
      updated_at = NOW()
    WHERE id = ?
  `).run(
    firstName, lastName, age,
    address, city, state, zip,
    lat, lng,
    healthConditions ? JSON.stringify(healthConditions) : null,
    medications ? JSON.stringify(medications) : null,
    preferences,
    emergencyContactName, emergencyContactPhone,
    phone || null, email || null,
    ...('emoji' in req.body ? [emoji || null] : []),
    ...('aiCareSummary' in req.body ? [aiCareSummary] : []),
    ...('caregiverBriefing' in req.body ? [req.body.caregiverBriefing] : []),
    req.params.id
  );

  const updated = await db.prepare("SELECT * FROM care_recipients WHERE id = ?").get(req.params.id);
  res.json({ careRecipient: updated });
});

// ─── POST /api/care-recipients/:id/share ───
// Share a care recipient with another family user
router.post("/:id/share", requireRole("family"), async (req, res) => {
  const db = await getDb();
  const { email, permission = "edit" } = req.body;

  if (!email) return res.status(400).json({ error: "Email of user to share with is required" });

  // Only the owner can share
  const recipient = await db.prepare(
    "SELECT * FROM care_recipients WHERE id = ? AND family_user_id = ?"
  ).get(req.params.id, req.user.id);
  if (!recipient) return res.status(404).json({ error: "Care recipient not found or you are not the owner" });

  // Find the target user
  const targetUser = await db.prepare(
    "SELECT id, first_name, last_name, email, role FROM users WHERE email = ? AND role = 'family'"
  ).get(email);
  if (!targetUser) return res.status(404).json({ error: "Family user not found with that email" });
  if (targetUser.id === req.user.id) return res.status(400).json({ error: "Cannot share with yourself" });

  // Check if already shared
  const existing = await db.prepare(
    "SELECT id FROM care_recipient_shares WHERE care_recipient_id = ? AND shared_with_user_id = ?"
  ).get(req.params.id, targetUser.id);
  if (existing) {
    // Update permission
    await db.prepare("UPDATE care_recipient_shares SET permission = ? WHERE id = ?").run(permission, existing.id);
    return res.json({ success: true, message: `Updated sharing with ${targetUser.first_name}` });
  }

  const id = uuid();
  await db.prepare(
    "INSERT INTO care_recipient_shares (id, care_recipient_id, shared_with_user_id, permission, shared_by_user_id) VALUES (?, ?, ?, ?, ?)"
  ).run(id, req.params.id, targetUser.id, permission, req.user.id);

  res.status(201).json({
    success: true,
    share: {
      shareId: id,
      userId: targetUser.id,
      name: `${targetUser.first_name} ${targetUser.last_name}`,
      email: targetUser.email,
      permission,
    },
  });
});

// ─── DELETE /api/care-recipients/:id/share/:shareId ───
// Remove sharing for a care recipient
router.delete("/:id/share/:shareId", requireRole("family"), async (req, res) => {
  const db = await getDb();

  // Only the owner can unshare
  const recipient = await db.prepare(
    "SELECT * FROM care_recipients WHERE id = ? AND family_user_id = ?"
  ).get(req.params.id, req.user.id);
  if (!recipient) return res.status(404).json({ error: "Care recipient not found or you are not the owner" });

  await db.prepare(
    "DELETE FROM care_recipient_shares WHERE id = ? AND care_recipient_id = ?"
  ).run(req.params.shareId, req.params.id);

  res.json({ success: true });
});

// ─── PUT /api/care-recipients/:id/photo ─── Upload care recipient photo (base64)
router.put("/:id/photo", requireRole("family"), async (req, res) => {
  try {
    const db = await getDb();
    const access = await hasAccess(db, req.params.id, req.user.id);
    if (!access || access === "view") return res.status(403).json({ error: "No edit access" });

    const { photo } = req.body; // base64 data URL
    if (!photo) return res.status(400).json({ error: "No photo provided" });
    if (photo.length > 2 * 1024 * 1024) return res.status(400).json({ error: "Photo too large (max 1.5MB)" });

    await db.prepare("UPDATE care_recipients SET photo = ?, updated_at = NOW() WHERE id = ?").run(photo, req.params.id);
    res.json({ message: "Photo updated", photoUrl: photo });
  } catch (err) {
    console.error("Care recipient photo upload error:", err);
    res.status(500).json({ error: "Failed to upload photo" });
  }
});

// ─── DELETE /api/care-recipients/:id/photo ─── Remove care recipient photo
router.delete("/:id/photo", requireRole("family"), async (req, res) => {
  try {
    const db = await getDb();
    const access = await hasAccess(db, req.params.id, req.user.id);
    if (!access || access === "view") return res.status(403).json({ error: "No edit access" });

    await db.prepare("UPDATE care_recipients SET photo = NULL, updated_at = NOW() WHERE id = ?").run(req.params.id);
    res.json({ message: "Photo removed" });
  } catch (err) {
    console.error("Care recipient photo delete error:", err);
    res.status(500).json({ error: "Failed to remove photo" });
  }
});

// ─── PUT /api/care-recipients/:id/permissions ───
// Update permission tier and visibility settings for a care recipient
router.put("/:id/permissions", requireRole("family"), async (req, res) => {
  const db = await getDb();

  // Verify ownership
  const recipient = await db.prepare("SELECT * FROM care_recipients WHERE id = ?").get(req.params.id);
  if (!recipient) return res.status(404).json({ error: "Care recipient not found" });
  if (recipient.family_user_id !== req.user.id) {
    return res.status(403).json({ error: "Only the care team owner can change permissions" });
  }

  const { permissionTier, visibilitySettings } = req.body;

  const validTiers = ["full", "collaborative", "managed"];
  if (permissionTier && !validTiers.includes(permissionTier)) {
    return res.status(400).json({ error: "Permission tier must be: full, collaborative, or managed" });
  }

  // Validate visibility settings shape
  const validSections = ["calendar", "healthConditions", "medications", "allergies", "preferences", "pets", "emergencyContact", "notes"];
  if (visibilitySettings) {
    const keys = Object.keys(visibilitySettings);
    const invalid = keys.filter(k => !validSections.includes(k));
    if (invalid.length > 0) {
      return res.status(400).json({ error: `Invalid visibility sections: ${invalid.join(", ")}` });
    }
  }

  try {
    const previousTier = recipient.permission_tier || 'full';

    if (permissionTier) {
      await db.prepare("UPDATE care_recipients SET permission_tier = ?, updated_at = NOW() WHERE id = ?").run(permissionTier, req.params.id);

      // Set managed_by fields if transitioning into managed/collaborative mode
      if ((permissionTier === 'managed' || permissionTier === 'collaborative') && previousTier === 'full') {
        await db.prepare(
          "UPDATE care_recipients SET managed_by_user_id = ?, managed_reason = ?, managed_at = NOW() WHERE id = ?"
        ).run(req.user.id, req.body.managedReason || 'Permission tier changed', req.params.id);
      }
      // Clear managed_by if going back to full
      if (permissionTier === 'full' && previousTier !== 'full') {
        await db.prepare(
          "UPDATE care_recipients SET managed_by_user_id = NULL, managed_reason = NULL, managed_at = NULL WHERE id = ?"
        ).run(req.params.id);
      }

      // Consent audit log
      try {
        const { logConsentAudit } = require("./documents");
        const user = await db.prepare("SELECT first_name, last_name FROM users WHERE id = ?").get(req.user.id);
        const uName = user ? `${user.first_name} ${user.last_name}`.trim() : "Unknown";
        const rName = `${recipient.first_name} ${recipient.last_name}`.trim();
        const eventType = permissionTier === 'full' ? 'managed_mode_deactivated' : 'participation_level_changed';
        await logConsentAudit(db, {
          careRecipientId: req.params.id, actorId: req.user.id, actorRole: "family",
          eventType,
          description: `${uName} changed ${rName}'s participation from '${previousTier}' to '${permissionTier}'`,
          metadata: { previousTier, newTier: permissionTier, reason: req.body.managedReason },
        });
      } catch (auditErr) { console.error("Permission change audit error:", auditErr.message); }

      // Notify care recipient if they have a linked account
      if (recipient.linked_user_id) {
        try {
          const emitToUser = req.app.get("emitToUser");
          const uName2 = (await db.prepare("SELECT first_name FROM users WHERE id = ?").get(req.user.id))?.first_name || "Your care team";
          const title = permissionTier === 'full'
            ? `Your account has been restored to full access`
            : `Your account participation level has changed`;
          const message = permissionTier === 'full'
            ? `${uName2} has restored your full account access. You can now manage your own care sessions.`
            : `${uName2} has changed your participation level to '${permissionTier}'.${permissionTier === 'managed' ? ' Your care team is now managing your sessions.' : ' Some actions may require care team approval.'}`;
          await db.prepare(
            "INSERT INTO activity_feed (id, family_user_id, care_recipient_id, event_type, title, message) VALUES (?, ?, ?, 'participation_changed', ?, ?)"
          ).run(require("uuid").v4(), recipient.linked_user_id, req.params.id, title, message);
          if (emitToUser) emitToUser(recipient.linked_user_id, "activity_update", { title, message });
        } catch (notifErr) { console.error("Participation notification error:", notifErr.message); }
      }
    }
    if (visibilitySettings !== undefined) {
      await db.prepare("UPDATE care_recipients SET visibility_settings = ? WHERE id = ?").run(
        JSON.stringify(visibilitySettings), req.params.id
      );
    }

    const updated = await db.prepare("SELECT permission_tier, visibility_settings, managed_by_user_id, managed_reason, managed_at FROM care_recipients WHERE id = ?").get(req.params.id);
    res.json({
      permissionTier: updated.permission_tier,
      visibilitySettings: updated.visibility_settings ? JSON.parse(updated.visibility_settings) : null,
      managedByUserId: updated.managed_by_user_id,
      managedReason: updated.managed_reason,
      managedAt: updated.managed_at,
    });
  } catch (err) {
    console.error("Update permissions error:", err);
    res.status(500).json({ error: "Failed to update permissions" });
  }
});

// ─── PUT /api/care-recipients/:id/preferences ───
// Save care preference ratings and follow-up details
router.put("/:id/preferences", async (req, res) => {
  try {
    const db = await getDb();
    const recipient = await db.prepare("SELECT * FROM care_recipients WHERE id = ?").get(req.params.id);
    if (!recipient) return res.status(404).json({ error: "Care recipient not found" });
    if (recipient.family_user_id !== req.user.id) return res.status(403).json({ error: "Not authorized" });

    const { preferences, details } = req.body;
    if (!preferences || typeof preferences !== 'object') return res.status(400).json({ error: "preferences object required" });

    await db.prepare(
      "UPDATE care_recipients SET care_preferences = ?, care_preference_details = ? WHERE id = ?"
    ).run(JSON.stringify(preferences), JSON.stringify(details || {}), req.params.id);

    res.json({ success: true });
  } catch (err) {
    console.error("Save care preferences error:", err);
    res.status(500).json({ error: "Failed to save care preferences" });
  }
});

// ─── POST /api/care-recipients/:id/generate-summary ───
// Generate AI care summary using Anthropic Claude
// Rate-limited: after first generation, requires at least 1 completed visit since last generation
router.post("/:id/generate-summary", async (req, res) => {
  try {
    const db = await getDb();
    const recipient = await db.prepare("SELECT * FROM care_recipients WHERE id = ?").get(req.params.id);
    if (!recipient) return res.status(404).json({ error: "Care recipient not found" });
    if (recipient.family_user_id !== req.user.id) return res.status(403).json({ error: "Not authorized" });

    // Rate limit: if summary already exists, require at least 1 completed visit since last generation
    if (recipient.ai_care_summary && recipient.ai_care_summary_updated_at) {
      const completedSince = await db.prepare(`
        SELECT COUNT(*) as cnt FROM care_sessions cs
        JOIN visit_logs vl ON vl.session_id = cs.id
        WHERE cs.care_recipient_id = ? AND cs.status = 'completed'
          AND vl.check_out_time > ?
      `).get(req.params.id, recipient.ai_care_summary_updated_at);
      if (!completedSince || completedSince.cnt === 0) {
        return res.status(429).json({ error: "No new completed visits since last summary. Complete a visit first to regenerate." });
      }
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "AI service not configured" });

    const Anthropic = require("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey });

    // Gather all context about the care recipient
    const name = `${recipient.first_name} ${recipient.last_name}`.trim();
    const firstName = recipient.first_name || 'the care recipient';
    const age = recipient.age || 'unknown age';
    const location = [recipient.location_city, recipient.location_state].filter(Boolean).join(', ') || 'location not specified';

    let healthConditions = [];
    try { healthConditions = JSON.parse(recipient.health_conditions || '[]'); } catch { healthConditions = []; }

    let medications = [];
    try { medications = JSON.parse(recipient.medications || '[]'); } catch { medications = []; }

    let preferences = {};
    try { preferences = JSON.parse(recipient.care_preferences || '{}'); } catch { preferences = {}; }

    let details = {};
    try { details = JSON.parse(recipient.care_preference_details || '{}'); } catch { details = {}; }

    const prefLabels = {
      meal_prep: 'Meal preparation & cooking',
      housekeeping: 'Light housekeeping',
      errands: 'Grocery shopping & errands',
      med_reminders: 'Medication reminders (reminders only)',
      bathing: 'Help with bathing, grooming & dressing',
      fall_prevention: 'Fall prevention & mobility assistance',
      transportation: 'Transportation to appointments',
      overnight: 'Overnight or evening supervision',
      wandering: 'Wandering prevention',
      vitals: 'Vital signs monitoring',
      exercise: 'Exercise & physical therapy support',
      companionship: 'Companionship & conversation',
      hobbies: 'Engaging in hobbies & activities together',
      social_outings: 'Social outing accompaniment',
      patience: 'Patience with repetition & confusion',
      daily_updates: 'Daily updates & photos sent to family',
      consistent_caregiver: 'Consistent same-caregiver scheduling',
      condition_experience: 'Experience with specific conditions',
      pets: 'Comfortable with pets in the home',
      gardening: 'Gardening or light yard work',
      outdoor_walks: 'Outdoor walks & fresh air time',
      socializing_out: 'Socializing away from home',
      tech_help: 'Technology help',
      spiritual: 'Spiritual or religious practice support',
    };

    const ratingLabels = { 0: 'Not needed', 1: 'Nice to have', 2: 'Important', 3: 'Must have' };

    // Build preference summary for the prompt
    const prefLines = Object.entries(preferences)
      .filter(([, v]) => v > 0)
      .sort(([, a], [, b]) => b - a)
      .map(([key, val]) => {
        const label = prefLabels[key] || key;
        const rating = ratingLabels[val] || val;
        const detail = details[key] ? ` — Family notes: "${details[key]}"` : '';
        return `- ${label}: ${rating}${detail}`;
      }).join('\n');

    const profileContext = `
CARE RECIPIENT: ${name}
AGE: ${age}
LOCATION: ${location}
HEALTH CONDITIONS: ${healthConditions.length > 0 ? healthConditions.join(', ') : 'None listed'}
MEDICATIONS: ${medications.length > 0 ? medications.join(', ') : 'None listed'}
PETS: ${recipient.pets || 'Not specified'}
FOOD ALLERGIES: ${recipient.food_allergies || 'None listed'}
FREE-TEXT PREFERENCES: ${recipient.preferences || 'None'}

CARE PREFERENCE RATINGS (from family):
${prefLines || 'No preferences rated yet'}
`.trim();

    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 800,
      system: `You are iPAi — inPlace's care intelligence assistant. You help families introduce their loved one to caregivers in a way that feels personal, warm, and human.

Write a profile for this person that a caregiver would read before their first visit. This isn't a medical chart — it's about helping someone connect with a real person. Use their first name throughout.

TONE: Like a family member describing their mom to a trusted friend who's coming to help. Warm, specific, honest about challenges but always respectful.

FORMAT:
- Start with 2-3 sentences about who this person IS — their personality, what they enjoy, what makes them smile. Not their diagnosis.
- Then naturally weave in what caregivers should know: what help they need, what to be mindful of, what works well
- Include practical tips based on the conditions and family details — but frame them as "what works for [name]" not "patient requires"
- Keep it under 300 words
- Do NOT use clinical headers like "Care Needs Summary" or "Primary Needs" — use warm headers if any, like "Getting to Know [Name]" or "What Works Best"
- IMPORTANT: InPlace is NOT a medical service. Medication mentions should be about reminders, not administration.
- End warmly — something like "[Name]'s family updates this profile as things change, so you always have the latest."`,
      messages: [
        { role: "user", content: `Write a warm, personal care profile for this person:\n\n${profileContext}` }
      ],
    });

    const summary = message.content[0]?.text || 'Unable to generate summary';

    // Save to database
    await db.prepare(
      "UPDATE care_recipients SET ai_care_summary = ?, ai_care_summary_updated_at = NOW() WHERE id = ?"
    ).run(summary, req.params.id);

    res.json({ summary, generatedAt: new Date().toISOString() });
  } catch (err) {
    console.error("Generate AI summary error:", err);
    res.status(500).json({ error: "Failed to generate care summary" });
  }
});

module.exports = router;
