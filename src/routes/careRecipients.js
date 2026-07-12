const express = require("express");
const { v4: uuid } = require("uuid");
const { getDb } = require("../models/database");
const { authenticate, requireRole } = require("../middleware/auth");
const { geocodeAddress, buildAddressString } = require("../utils/geocode");

const { MODEL_SONNET, MODEL_HAIKU } = require("../utils/aiModels");
const { captureException } = require("../utils/sentry");
const router = express.Router();

// All routes require authentication
router.use(authenticate);

// ─── GET /api/care-recipients ───
// List care recipients for the logged-in family user (owned + shared)
// care_for users get their own linked record only
router.get("/", requireRole("family", "admin", "care_for"), async (req, res) => {
  const db = await getDb();
  const activeRole = req.user.activeRole || req.user.role;

  // care_for users: return their own linked care_recipient
  if (activeRole === "care_for") {
    const self = await db.prepare(
      "SELECT *, 'self' AS access_level FROM care_recipients WHERE linked_user_id = ?"
    ).get(req.user.id);
    const parsed = self ? [{
      ...self,
      name: self.called_by || [self.first_name, self.last_name].filter(Boolean).join(' ') || 'Unknown',
      healthConditions: JSON.parse(self.health_conditions || "[]"),
      observedConcerns: JSON.parse(self.observed_concerns || "[]"),
      medications: JSON.parse(self.medications || "[]"),
    }] : [];
    return res.json({ careRecipients: parsed });
  }

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

  // Care team recipients
  let teamRecipients = [];
  try {
    teamRecipients = await db.prepare(`
      SELECT cr.*, ctm.role AS team_role,
        CASE WHEN ctm.role = 'leader' THEN 'edit' ELSE 'view' END AS access_level
      FROM care_team_members ctm
      JOIN care_teams ct ON ctm.care_team_id = ct.id
      JOIN care_recipients cr ON ct.care_recipient_id = cr.id
      WHERE ctm.user_id = ?
      ORDER BY cr.created_at DESC
    `).all(req.user.id);
  } catch (e) { captureException(e, { where: "careRecipients: list team memberships" }); }

  // Merge and deduplicate (owner takes precedence, then shared, then team)
  const ownedIds = new Set(owned.map(r => r.id));
  const sharedFiltered = shared.filter(r => !ownedIds.has(r.id));
  const seenIds = new Set([...ownedIds, ...sharedFiltered.map(r => r.id)]);
  const teamFiltered = teamRecipients.filter(r => !seenIds.has(r.id));
  const all = [...owned, ...sharedFiltered, ...teamFiltered];

  // Parse JSON fields + compute display name
  const parsed = all.map((r) => ({
    ...r,
    name: r.called_by || [r.first_name, r.last_name].filter(Boolean).join(' ') || 'Unknown',
    healthConditions: JSON.parse(r.health_conditions || "[]"),
    observedConcerns: JSON.parse(r.observed_concerns || "[]"),
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
    healthConditions, observedConcerns, medications, preferences,
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
     health_conditions, observed_concerns, medications, preferences,
     emergency_contact_name, emergency_contact_phone, emoji,
     sms_phone, email,
     authorization_tier, consent_status, consent_method, consent_verified_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, req.user.id, firstName, lastName, age || null,
    address || null, city || null, state || null, zip || null,
    lat, lng,
    JSON.stringify(healthConditions || []),
    JSON.stringify(observedConcerns || []),
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
  if (shared) return shared.permission;
  // Check care team membership
  const teamMember = await db.prepare(`
    SELECT ctm.role FROM care_team_members ctm
    JOIN care_teams ct ON ctm.care_team_id = ct.id
    WHERE ct.care_recipient_id = ? AND ctm.user_id = ?
  `).get(recipientId, userId);
  if (teamMember) return teamMember.role === 'leader' ? 'edit' : 'view';
  return null;
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
      observedConcerns: JSON.parse(recipient.observed_concerns || "[]"),
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
      observed_concerns = COALESCE(?, observed_concerns),
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
      called_by = ${('called_by' in req.body) ? '?' : 'called_by'},
      updated_at = NOW()
    WHERE id = ?
  `).run(
    firstName, lastName, age,
    address, city, state, zip,
    lat, lng,
    healthConditions ? JSON.stringify(healthConditions) : null,
    req.body.observedConcerns ? JSON.stringify(req.body.observedConcerns) : null,
    medications ? JSON.stringify(medications) : null,
    preferences,
    emergencyContactName, emergencyContactPhone,
    phone || null, email || null,
    ...('emoji' in req.body ? [emoji || null] : []),
    ...('aiCareSummary' in req.body ? [aiCareSummary] : []),
    ...('caregiverBriefing' in req.body ? [req.body.caregiverBriefing] : []),
    ...('called_by' in req.body ? [req.body.called_by || null] : []),
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

    // Demo accounts can't use AI features
    const me = await db.prepare("SELECT is_demo FROM users WHERE id = ?").get(req.user.id);
    if (me?.is_demo) return res.status(403).json({ error: "AI care summaries are not available in demo mode. Sign up for a free account to try this feature!" });

    // Rate limit: if summary already exists, require at least 1 completed visit since last generation
    if (recipient.ai_care_summary && recipient.ai_care_summary_updated_at) {
      const completedSince = await db.prepare(`
        SELECT COUNT(*) as cnt FROM care_sessions cs
        JOIN visit_logs vl ON vl.session_id = cs.id
        WHERE cs.care_recipient_id = ? AND cs.status = 'completed'
          AND vl.check_out_time > ?
      `).get(req.params.id, recipient.ai_care_summary_updated_at);
      if (!completedSince || completedSince.cnt === 0) {
        // v1.77.1 — new notes/observations are also new information worth a regenerate
        const newNotes = await db.prepare(
          "SELECT 1 FROM recipient_notes WHERE care_recipient_id = ? AND created_at > ? LIMIT 1"
        ).get(req.params.id, recipient.ai_care_summary_updated_at);
        if (!newNotes) {
          return res.status(429).json({ error: "Nothing new since the last summary. Add an observation or complete a visit first." });
        }
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
    let observedConcerns = [];
    try { observedConcerns = JSON.parse(recipient.observed_concerns || '[]'); } catch { observedConcerns = []; }

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

    // v1.77.1 — the summary used to see ONLY profile fields + preference ratings,
    // so it invented personality ("sharp sense of humor") and sanitized needs
    // ("help her with cooking") that the notes contradict. Give it the notes.
    let notesContext = '';
    try {
      const recentNotes = await db.prepare(`
        SELECT rn.content, rn.note_type, rn.created_at, u.first_name AS author
        FROM recipient_notes rn JOIN users u ON rn.author_id = u.id
        WHERE rn.care_recipient_id = ?
        ORDER BY rn.created_at DESC LIMIT 15
      `).all(req.params.id);
      if (recentNotes.length) {
        notesContext = '\n\nRECENT NOTES & FAMILY OBSERVATIONS (newest first — this is the ground truth of how care actually goes):\n' +
          recentNotes.map(n => `${String(n.created_at).substring(0, 10)} (${n.author}): "${(n.content || '').substring(0, 400)}"`).join('\n');
      }
    } catch (e) { console.warn('[generate-summary] notes fetch failed:', e.message); }

    const profileContext = `
CARE RECIPIENT: ${name}
AGE: ${age}
LOCATION: ${location}
DIAGNOSED CONDITIONS (formal medical diagnoses): ${healthConditions.length > 0 ? healthConditions.join(', ') : 'None listed'}
OBSERVED CONCERNS (family observations — NOT diagnoses): ${observedConcerns.length > 0 ? observedConcerns.join(', ') : 'None listed'}
MEDICATIONS: ${medications.length > 0 ? medications.join(', ') : 'None listed'}
PETS: ${recipient.pets || 'Not specified'}
FOOD ALLERGIES: ${recipient.food_allergies || 'None listed'}
FREE-TEXT PREFERENCES: ${recipient.preferences || 'None'}

CARE PREFERENCE RATINGS (from family):
${prefLines || 'No preferences rated yet'}${notesContext}
`.trim();

    const message = await client.messages.create({
      model: MODEL_HAIKU,
      max_tokens: 800,
      system: `You are iPAi — inPlace's care intelligence assistant. You help families introduce their loved one to caregivers.

Write a short personal profile that a caregiver reads before their first visit. Plain text only — NO markdown, NO bold, NO headers, NO bullet points, NO asterisks, NO dashes as list markers. Just clean paragraphs.

TONE: A family member telling a trusted friend about their mom. Warm, real, specific.

STRUCTURE (all in flowing paragraphs, no formatting):
Paragraph 1: Who this person is — personality, what they enjoy, what makes them light up. Lead with the person, not the diagnosis.
Paragraph 2: What caregivers should know — the care needs, what to be mindful of, what works well. Frame as "what works for [name]."
Paragraph 3: Practical tips — medication reminders (not administration), daily routine preferences, things to avoid.
Close with one line: "[Name]'s family keeps this updated so you always have the latest."

Rules: Under 250 words. No markdown symbols of any kind. No headers. No bullet lists. Just warm, clean paragraphs. InPlace is NOT a medical service.

ACCURACY over flattery:
- Never attribute personality traits (sense of humor, conversational skill, sharpness) unless the notes actually show them. If the notes show repetition and difficulty holding a thread, say that warmly instead of inventing charm. A caregiver who expects "good conversation" and meets constant repetition was set up to fail.
- When the notes show she RESISTS a kind of help, say so plainly and give the workaround — "she needs help clearing spoiled food and preparing safe meals, but she's defensive about accepting it; bringing food or eating together works better than cleaning for her" beats "help her with cooking." Technically-true-but-sanitized guidance is a disservice to both of them.
- Prefer what the notes show over what the ratings imply, when they differ.
- Never state a lifestyle status the notes don't document. If a note shows she drove somewhere and the family was concerned, "the family is concerned about her driving" is right; "she doesn't drive anymore" is an invention that other documents will inherit as fact.
- Never invent agency or arrangements. If a note says a friend brings dinner every night, say exactly that — do not write that a family member "arranged" it unless a note says someone did.
- DIAGNOSED CONDITIONS are the only things you may call a diagnosis. OBSERVED CONCERNS are the family's observations — describe the behavior itself ("she has real memory lapses and gets confused about recent events") rather than naming a disease the family only suspects.
SAFETY: a caregiver reads this. Never mention financial or security vulnerabilities — trouble managing money, cash or valuables in the home, who pays for things, entry codes. State care-relevant behavior neutrally without exploitable detail. Never state events or lifestyle facts (driving, falls, history) that are not in the provided profile.`,
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

// ─── POST /api/care-recipients/:id/doctor-report/questions ───
// v1.94.0 — BEFORE drafting, iPAi asks the family up to 3 targeted questions
// about gaps in the record (frequency/current-status facts the notes are too
// sparse to establish). Rationale: home notes capture exceptions, not routines
// — "drove to Kroger once in April" was really "drives every day", and no
// prompt can conjure the missing fact. Asking the human can.
router.post("/:id/doctor-report/questions", async (req, res) => {
  try {
    const db = await getDb();
    const recipient = await db.prepare("SELECT * FROM care_recipients WHERE id = ?").get(req.params.id);
    if (!recipient) return res.status(404).json({ error: "Care recipient not found" });
    if (recipient.family_user_id !== req.user.id) return res.status(403).json({ error: "Not authorized" });

    const me = await db.prepare("SELECT is_demo FROM users WHERE id = ?").get(req.user.id);
    if (me?.is_demo) return res.status(403).json({ error: "AI doctor reports are not available in demo mode." });

    const { appointmentType, appointmentDetails } = req.body;
    if (!appointmentType || !appointmentType.trim()) return res.status(400).json({ error: "Appointment type is required" });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "AI service not configured" });

    const firstName = recipient.first_name || 'the patient';
    const notes = await db.prepare(`
      SELECT rn.content, rn.created_at, u.first_name AS author_first
      FROM recipient_notes rn JOIN users u ON rn.author_id = u.id
      WHERE rn.care_recipient_id = ?
      ORDER BY rn.created_at DESC LIMIT 20
    `).all(req.params.id);
    const noteSummaries = notes.map(n => {
      const date = n.created_at ? new Date(n.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
      return `[${date} — ${n.author_first || ''}] ${(n.content || '').substring(0, 500)}`;
    }).join('\n');

    const Anthropic = require("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey });
    const msg = await client.messages.create({
      model: MODEL_HAIKU,
      max_tokens: 500,
      messages: [{ role: "user", content: `A family is preparing a report for ${firstName}'s doctor. Before drafting, identify AT MOST 3 questions to ask the family — ONLY where the home observations below are too sparse or ambiguous to characterize something the report needs, and only where the answer materially affects THIS appointment.

The best questions ask about the frequency or CURRENT status of things the notes mention only once or long ago (e.g. "A note from April mentions ${firstName} driving herself once — how often does she currently drive?"), or about what has changed since a prior assessment referenced in the appointment details. Home notes record exceptions, not routines — your job is to find where that bias would mislead the report.

Do NOT ask about things the notes already establish. Do NOT ask generic intake questions the doctor will ask. If the observations are sufficient, return zero questions.

APPOINTMENT TYPE: ${appointmentType.trim()}
${appointmentDetails ? `APPOINTMENT DETAILS (family's stated purpose): ${String(appointmentDetails).trim()}` : ''}

HOME OBSERVATIONS (newest first):
${noteSummaries || 'No notes recorded yet.'}

Respond with ONLY valid JSON, no markdown: {"questions": ["...", "..."]}` }],
    });
    const text = msg.content[0]?.text || '{}';
    let questions = [];
    try {
      const m = text.match(/\{[\s\S]*\}/);
      const parsed = m ? JSON.parse(m[0]) : {};
      if (Array.isArray(parsed.questions)) {
        questions = parsed.questions.filter(q => typeof q === 'string' && q.trim()).slice(0, 3);
      }
    } catch { /* unparseable → no questions, fall through to drafting */ }
    res.json({ questions });
  } catch (err) {
    console.error("Doctor report questions error:", err);
    // Never block drafting on this step — return no questions on failure.
    res.json({ questions: [] });
  }
});

// ─── POST /api/care-recipients/:id/doctor-report ───
// AI-generated, appointment-specific report for a healthcare provider
router.post("/:id/doctor-report", async (req, res) => {
  try {
    const db = await getDb();
    const recipient = await db.prepare("SELECT * FROM care_recipients WHERE id = ?").get(req.params.id);
    if (!recipient) return res.status(404).json({ error: "Care recipient not found" });
    if (recipient.family_user_id !== req.user.id) return res.status(403).json({ error: "Not authorized" });

    // Demo accounts can't use AI features (costs real API credits)
    const me = await db.prepare("SELECT is_demo FROM users WHERE id = ?").get(req.user.id);
    if (me?.is_demo) return res.status(403).json({ error: "AI doctor reports are not available in demo mode. Sign up for a free account to try this feature!" });

    const { appointmentType, appointmentDetails, doctorEmail } = req.body;
    if (!appointmentType || !appointmentType.trim()) return res.status(400).json({ error: "Appointment type is required" });

    // v1.94.0 — answers to iPAi's pre-draft questions. Authoritative, current
    // ground truth from the family; also saved back into the record below so
    // the record itself gets less gappy over time.
    let clarifications = [];
    if (Array.isArray(req.body.clarifications)) {
      clarifications = req.body.clarifications
        .filter(c => c && typeof c.question === 'string' && typeof c.answer === 'string' && c.answer.trim())
        .slice(0, 3)
        .map(c => ({ question: c.question.trim().slice(0, 500), answer: c.answer.trim().slice(0, 1000) }));
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "AI service not configured" });

    // ── Gather all data ──
    const name = `${recipient.first_name || ''} ${recipient.last_name || ''}`.trim() || 'Care Recipient';
    const firstName = recipient.first_name || 'the patient';
    const age = recipient.age || 'unknown age';

    let healthConditions = [];
    try { healthConditions = JSON.parse(recipient.health_conditions || '[]'); } catch { healthConditions = []; }
    let observedConcerns = [];
    try { observedConcerns = JSON.parse(recipient.observed_concerns || '[]'); } catch { observedConcerns = []; }
    let medications = [];
    try { medications = JSON.parse(recipient.medications || '[]'); } catch { medications = []; }
    let preferences = {};
    try { preferences = JSON.parse(recipient.care_preferences || '{}'); } catch { preferences = {}; }
    let details = {};
    try { details = JSON.parse(recipient.care_preference_details || '{}'); } catch { details = {}; }

    const prefLabels = {
      meal_prep: 'Meal preparation & cooking', housekeeping: 'Light housekeeping',
      errands: 'Grocery shopping & errands', med_reminders: 'Medication reminders',
      bathing: 'Help with bathing/grooming/dressing', fall_prevention: 'Fall prevention & mobility assistance',
      transportation: 'Transportation to appointments', overnight: 'Overnight supervision',
      wandering: 'Wandering prevention', vitals: 'Vital signs monitoring',
      exercise: 'Exercise & physical therapy support', companionship: 'Companionship & conversation',
      hobbies: 'Hobbies & activities', social_outings: 'Social outing accompaniment',
      patience: 'Patience with repetition & confusion', daily_updates: 'Daily updates to family',
      consistent_caregiver: 'Consistent caregiver scheduling', condition_experience: 'Condition-specific experience',
      pets: 'Comfortable with pets', gardening: 'Gardening or yard work',
      outdoor_walks: 'Outdoor walks', socializing_out: 'Socializing away from home',
      tech_help: 'Technology help', spiritual: 'Spiritual/religious practice support',
    };
    const ratingLabels = { 0: 'Not needed', 1: 'Nice to have', 2: 'Important', 3: 'Must have' };

    // Visits (last 30 for deeper pattern analysis)
    const visits = await db.prepare(`
      SELECT vl.*, cs.scheduled_date, u.first_name AS cg_first, u.last_name AS cg_last
      FROM visit_logs vl
      JOIN care_sessions cs ON vl.session_id = cs.id
      JOIN users u ON vl.caregiver_id = u.id
      WHERE cs.care_recipient_id = ? AND vl.check_out_time IS NOT NULL
      ORDER BY vl.check_in_time DESC LIMIT 30
    `).all(req.params.id);

    // Notes (last 20)
    const notes = await db.prepare(`
      SELECT rn.*, u.first_name AS author_first, u.last_name AS author_last
      FROM recipient_notes rn
      JOIN users u ON rn.author_id = u.id
      WHERE rn.care_recipient_id = ?
      ORDER BY rn.created_at DESC LIMIT 20
    `).all(req.params.id);

    // Build context for AI
    const prefLines = Object.entries(preferences).filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a)
      .map(([key, val]) => {
        const label = prefLabels[key] || key;
        const rating = ratingLabels[val] || val;
        const detail = details[key] ? ` — "${details[key]}"` : '';
        return `- ${label}: ${rating}${detail}`;
      }).join('\n');

    const visitSummaries = visits.map(v => {
      const date = v.check_in_time ? new Date(v.check_in_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '?';
      const caregiver = `${v.cg_first || ''} ${v.cg_last || ''}`.trim();
      let tags = [];
      try { tags = JSON.parse(v.condition_tags || '[]'); } catch {} // expected: tolerated parse fallback
      return `[${date} — ${caregiver}] Mood: ${v.arrival_mood || '?'} → ${v.departure_mood || '?'}. ${v.summary || ''} ${v.notes || ''} ${tags.length > 0 ? 'Tags: ' + tags.join(', ') : ''}`.trim();
    }).join('\n');

    const noteSummaries = notes.map(n => {
      const date = n.created_at ? new Date(n.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
      const author = `${n.author_first || ''} ${n.author_last || ''}`.trim();
      return `[${date} — ${author}] ${n.content}`;
    }).join('\n');

    const familyUser = await db.prepare("SELECT first_name, last_name, phone, email FROM users WHERE id = ?").get(recipient.family_user_id);
    const familyName = familyUser ? `${familyUser.first_name} ${familyUser.last_name}` : 'Family member';
    const familyPhone = familyUser?.phone || '';
    const familyEmail = familyUser?.email || '';

    const Anthropic = require("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey });

    // v1.93.0 — the AI care profile (recipient.ai_care_summary) is deliberately NOT
    // fed to this prompt: it is itself AI-derived and has carried interpolations
    // ("doesn't drive anymore", "her son arranged...") that this report then
    // escalated into stated fact ("no longer drives legally"). Raw notes and visit
    // logs are the only ground truth a doctor-facing document may draw from.
    const message = await client.messages.create({
      model: MODEL_SONNET,
      max_tokens: 1200,
      system: `You are a clinical communication specialist helping families share relevant home observations with healthcare providers. You write the SHORT, change-focused briefing a busy physician can absorb before a 10-minute appointment.

The doctor already has the patient's medical records. Your job is ONLY what the chart doesn't show: what family and caregivers are seeing at home, what has CHANGED recently, and what the family wants addressed. You are NOT diagnosing.

TRUTH — absolute rules. A single unsupported claim destroys the family's credibility with the doctor and taints every other observation in the report:
- Every factual statement must trace to a specific observation in the data below. If it is not in the data, it does not go in the report, no matter how plausible it sounds.
- NEVER upgrade a family concern into a fact, or into a legal or medical status. "The family is concerned about her driving and wants guidance" is correct; "she no longer drives legally" is a fabrication unless a documented license status appears in the data.
- NEVER invent agency or arrangements. If a note says a friend brings dinner every night, do not write that anyone "arranged" it — say the friend brings dinner every night.
- The family's beliefs and interpretations stay labeled as such: "the family's understanding is...", "the family is concerned that...", "her son believes...".
- A single dated observation is ONE data point. NEVER generalize it into a frequency, habit, trajectory, or status — no "no longer", "still", "always", "rarely", "has stopped", "continues to". Report it as what it is: "on [date], [observer] documented [event]." If the family needs the doctor to know how often something happens, that is for the family to say — not for you to infer.
- Absence of notes about something is NOT evidence it doesn't happen. Home notes capture exceptions and incidents, not daily routines. Never write that the patient "doesn't" or "no longer" does something based only on the notes being quiet about it.
- Care-need ratings (e.g. "transportation: must have") describe what help the family WANTS — they are not evidence about what the patient does or can do. Never derive ability or lifestyle status from them.
- DIAGNOSED vs OBSERVED is sacred. Only items listed under DIAGNOSED CONDITIONS may be written as diagnoses. Items under OBSERVED CONCERNS are family observations — present them exactly that way, and where it matters, state the distinction plainly: "There is no formal dementia diagnosis; the family observes recurring memory lapses and confusion that suggest cognitive decline." A doctor reads calibrated language as credible; inflated language as noise.

RELEVANCE — the appointment type and details STEER everything:
- Select observations for what THIS clinician can act on. A podiatrist: foot issues, gait, fall risk, footwear, circulation/sensation signals — not a cognitive history. A neurologist or memory specialist: cognitive patterns, confusion episodes, sleep, mood. A primary care doctor: the broadest picture, still change-focused.
- The condition context others need in one line only: a specialist should still learn, in a single sentence, anything that changes how they examine or advise (e.g., "Betty has early-stage dementia and may not reliably report pain or follow home-care instructions — she could not say whether the protruding toe hurt"). One sentence, tied to their specialty; no more.
- APPOINTMENT DETAILS is the family's own statement of purpose and concerns. Treat every concern or question the family raises there as a first-class item: address it in the body if the data speaks to it, and carry it into the questions section. Do not let a family-stated concern go unaddressed.
- If the observations contain little that is relevant to this specialty, say so briefly and honestly rather than padding with off-topic material.

STRUCTURE (plain text; ALL CAPS section titles on their own line; no markdown, no bullets, no asterisks):
1. Three-line header: patient name and age, appointment type/purpose, primary family contact.
2. WHAT THE FAMILY IS SEEING AT HOME — the 3 to 5 most clinically relevant patterns for THIS appointment type, one tight paragraph each, most significant or most changed first, each anchored by 1-2 dated examples. If the appointment follows a prior assessment (per the appointment details), emphasize what has changed since then.
3. QUESTIONS FOR THE DOCTOR — 2 to 4 specific questions built from the family's actual documented concerns, starting with any the family raised in the appointment details.
4. One closing line: prepared via InPlace from non-clinical family/caregiver observations; not a clinical assessment.

LENGTH — HARD LIMIT: 350 words of body. The doctor has the chart. Do not restate diagnosis history, do not list what is NOT documented, do not pad sections that have nothing new. Shorter is better.`,
      messages: [{ role: "user", content: `Generate a doctor visit report for the following appointment:

APPOINTMENT TYPE: ${appointmentType.trim()}
${appointmentDetails ? `APPOINTMENT DETAILS: ${appointmentDetails.trim()}` : ''}

PATIENT: ${name}, age ${age}
DIAGNOSED CONDITIONS (formal medical diagnoses, as reported by the family): ${healthConditions.length > 0 ? healthConditions.join(', ') : 'None listed'}
OBSERVED CONCERNS (family/caregiver observations — NOT diagnoses): ${observedConcerns.length > 0 ? observedConcerns.join(', ') : 'None listed'}
MEDICATIONS: ${medications.length > 0 ? medications.join(', ') : 'None listed'}
ALLERGIES: Food: ${recipient.food_allergies || 'None'}. Pet: ${recipient.pet_allergies || 'None'}.
EMERGENCY CONTACT: ${recipient.emergency_contact_name || 'Not listed'} ${recipient.emergency_contact_phone || ''}

FAMILY-RATED CARE NEEDS (context only — do not recite these in the report):
${prefLines || 'No preferences rated'}

RECENT CAREGIVER VISIT OBSERVATIONS (most recent first — ground truth):
${visitSummaries || 'No visit logs recorded yet'}

FAMILY AND CAREGIVER NOTES (ground truth):
${noteSummaries || 'No notes recorded yet'}
${clarifications.length ? `
FAMILY CLARIFICATIONS (provided by the family JUST NOW for this report — authoritative, current ground truth; these override anything the older notes imply):
${clarifications.map(c => `Q: ${c.question}\nA: ${c.answer}`).join('\n')}` : ''}

FAMILY CONTACT: ${familyName}, ${familyPhone}, ${familyEmail}` }],
    });

    const report = message.content[0]?.text || 'Unable to generate report';

    // v1.94.0 — persist answered clarifications as observations so the record
    // improves permanently (deduped: skip if identical content already saved).
    if (clarifications.length) {
      const { categorizeObservation } = require("../utils/careIntelligence");
      for (const c of clarifications) {
        try {
          const content = `[Answered for ${appointmentType.trim()} doctor report] ${c.question} — ${c.answer}`;
          const dupe = await db.prepare(
            "SELECT 1 FROM recipient_notes WHERE care_recipient_id = ? AND content = ? LIMIT 1"
          ).get(req.params.id, content);
          if (dupe) continue;
          const noteId = uuid();
          await db.prepare(
            "INSERT INTO recipient_notes (id, care_recipient_id, author_id, content, note_type) VALUES (?, ?, ?, ?, 'observation')"
          ).run(noteId, req.params.id, req.user.id, content);
          categorizeObservation(noteId).catch(() => {}); // non-blocking, same as regular observations
        } catch (saveErr) {
          console.warn("doctor-report: clarification save failed (non-blocking):", saveErr.message);
        }
      }
    }

    // v1.93.0 — generation NEVER emails anymore. The family reviews (and can edit)
    // the draft, then explicitly sends via POST /:id/doctor-report/send with an
    // acknowledgment. A fabricated claim that reaches a doctor unreviewed damages
    // the family's credibility — the sender must get the chance to catch it.
    res.json({ report });
  } catch (err) {
    console.error("Generate doctor report error:", err);
    res.status(500).json({ error: "Failed to generate report" });
  }
});

// ─── POST /api/care-recipients/:id/doctor-report/send ───
// Sends a REVIEWED (and possibly family-edited) report to the doctor.
// Requires explicit acknowledgment that the sender reviewed the content and
// takes responsibility for it — the report is drafted with iPAi, but the
// family owns what leaves the platform.
router.post("/:id/doctor-report/send", async (req, res) => {
  try {
    const db = await getDb();
    const recipient = await db.prepare("SELECT * FROM care_recipients WHERE id = ?").get(req.params.id);
    if (!recipient) return res.status(404).json({ error: "Care recipient not found" });
    if (recipient.family_user_id !== req.user.id) return res.status(403).json({ error: "Not authorized" });

    const me = await db.prepare("SELECT is_demo FROM users WHERE id = ?").get(req.user.id);
    if (me?.is_demo) return res.status(403).json({ error: "Emailing doctor reports is not available in demo mode." });

    const { reportText, appointmentType, doctorEmail, acknowledged } = req.body;
    if (acknowledged !== true) {
      return res.status(400).json({ error: "Please review the report and confirm you take responsibility for its contents before sending." });
    }
    if (!reportText || !reportText.trim()) return res.status(400).json({ error: "Report text is required" });
    if (reportText.length > 30000) return res.status(400).json({ error: "Report is too long to send" });
    if (!appointmentType || !appointmentType.trim()) return res.status(400).json({ error: "Appointment type is required" });
    if (!doctorEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(doctorEmail.trim())) {
      return res.status(400).json({ error: "A valid doctor email is required" });
    }

    const name = `${recipient.first_name || ''} ${recipient.last_name || ''}`.trim() || 'Care Recipient';
    const age = recipient.age || 'unknown age';
    let healthConditions = [];
    try { healthConditions = JSON.parse(recipient.health_conditions || '[]'); } catch { healthConditions = []; }
    let observedConcerns = [];
    try { observedConcerns = JSON.parse(recipient.observed_concerns || '[]'); } catch { observedConcerns = []; }
    let medications = [];
    try { medications = JSON.parse(recipient.medications || '[]'); } catch { medications = []; }
    const familyUser = await db.prepare("SELECT first_name, last_name, phone, email FROM users WHERE id = ?").get(recipient.family_user_id);
    const familyName = familyUser ? `${familyUser.first_name} ${familyUser.last_name}` : 'Family member';
    const familyPhone = familyUser?.phone || '';
    const familyEmail = familyUser?.email || '';
    const report = reportText.trim();

    // PHI disclosure audit trail — who sent what where, and that they acknowledged.
    try {
      await db.prepare(
        "INSERT INTO consent_audit_log (id, care_recipient_id, actor_id, actor_role, event_type, description, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())"
      ).run(uuid(), req.params.id, req.user.id, 'family', 'doctor_report_sent',
        `Doctor report emailed to ${doctorEmail.trim()} for ${appointmentType.trim()} appointment (sender reviewed and acknowledged responsibility)`,
        JSON.stringify({ doctorEmail: doctorEmail.trim(), appointmentType: appointmentType.trim(), reportLength: report.length, acknowledged: true }));
    } catch (auditErr) {
      console.warn("doctor-report send: audit log failed (non-blocking):", auditErr.message);
    }

    const { sendEmail } = require("../utils/email");

    const emailHtml = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 640px; margin: 0 auto;">
  <div style="background: #1b6b5a; padding: 24px 28px; border-radius: 12px 12px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 20px;">Home Care Report for ${name}</h1>
    <p style="color: rgba(255,255,255,0.85); margin: 6px 0 0; font-size: 13px;">
      Prepared for: ${appointmentType.trim()} appointment
    </p>
  </div>
  <div style="padding: 28px; background: #ffffff; border: 1px solid #e0e0e0; border-top: none;">
    <p style="color: #333; font-size: 13px; margin: 0 0 4px;">
      <strong>Patient:</strong> ${name}, age ${age}
    </p>
    ${healthConditions.length > 0 ? `<p style="color: #333; font-size: 13px; margin: 0 0 4px;"><strong>Known conditions:</strong> ${healthConditions.join(', ')}</p>` : ''}
    ${medications.length > 0 ? `<p style="color: #333; font-size: 13px; margin: 0 0 4px;"><strong>Current medications:</strong> ${medications.join(', ')}</p>` : ''}
    <p style="color: #333; font-size: 13px; margin: 0 0 16px;">
      <strong>Family contact:</strong> ${familyName}${familyPhone ? ' — ' + familyPhone : ''}${familyEmail ? ' — ' + familyEmail : ''}
    </p>
    <hr style="border: none; border-top: 1px solid #eee; margin: 0 0 16px;" />
    <div style="color: #333; font-size: 14px; line-height: 1.7; white-space: pre-wrap;">${report.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
    <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0 16px;" />
    <p style="color: #999; font-size: 11px; line-height: 1.5; margin: 0;">
      This report contains observations from home caregivers and family members, collected through InPlace (yourinplace.com), a home care coordination platform. It was drafted with AI assistance and reviewed by ${familyName} before sending. It is not a clinical assessment and should not replace medical evaluation. All observations are documented by non-clinical caregivers during routine home care visits.
    </p>
  </div>
  <div style="padding: 16px 28px; background: #f8f9fa; border-radius: 0 0 12px 12px; border: 1px solid #e0e0e0; border-top: none; text-align: center;">
    <p style="margin: 0; color: #1b6b5a; font-size: 12px; font-weight: 600;">Prepared via InPlace — yourinplace.com</p>
    <p style="margin: 4px 0 0; color: #aaa; font-size: 11px;">Generated ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
    <p style="margin: 8px 0 0; color: #888; font-size: 11px; line-height: 1.5;">
      Have instructions or observations for ${name}'s care team? Simply reply to this email and your guidance will be added to their care record.
    </p>
  </div>
</div>`;

    // reply-to encodes care recipient ID for future inbound webhook routing
    const replyToAddr = process.env.REPLY_EMAIL_PREFIX
      ? `${process.env.REPLY_EMAIL_PREFIX}+${req.params.id}@${(process.env.FROM_EMAIL || 'care@yourinplace.com').split('@')[1]}`
      : undefined;

    const emailResult = await sendEmail({
      to: doctorEmail.trim(),
      subject: `Home Care Report: ${name} — ${appointmentType.trim()} appointment`,
      html: emailHtml,
      ...(replyToAddr ? { replyTo: replyToAddr } : {}),
    });

    res.json({
      emailSent: emailResult?.success || false,
      emailError: emailResult && !emailResult.success ? emailResult.error : null,
    });
  } catch (err) {
    console.error("Send doctor report error:", err);
    res.status(500).json({ error: "Failed to send report" });
  }
});

module.exports = router;
