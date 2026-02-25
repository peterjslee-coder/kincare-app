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
    healthConditions, medications, preferences,
    emergencyContactName, emergencyContactPhone, emoji,
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

  await db.prepare(`
    INSERT INTO care_recipients
    (id, family_user_id, first_name, last_name, age,
     location_address, location_city, location_state, location_zip,
     latitude, longitude,
     health_conditions, medications, preferences,
     emergency_contact_name, emergency_contact_phone, emoji)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, req.user.id, firstName, lastName, age || null,
    address || null, city || null, state || null, zip || null,
    lat, lng,
    JSON.stringify(healthConditions || []),
    JSON.stringify(medications || []),
    preferences || null,
    emergencyContactName || null, emergencyContactPhone || null,
    emoji || null
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
router.put("/:id", requireRole("family"), async (req, res) => {
  const db = await getDb();
  const access = await hasAccess(db, req.params.id, req.user.id);
  if (!access) return res.status(404).json({ error: "Care recipient not found" });
  if (access === "view") return res.status(403).json({ error: "You have view-only access to this care recipient" });

  const existing = await db.prepare("SELECT * FROM care_recipients WHERE id = ?").get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Care recipient not found" });

  const {
    firstName, lastName, age, address, city, state, zip,
    healthConditions, medications, preferences,
    emergencyContactName, emergencyContactPhone, emoji,
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
      emoji = ${('emoji' in req.body) ? '?' : 'emoji'},
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
    ...('emoji' in req.body ? [emoji || null] : []),
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
    if (permissionTier) {
      await db.prepare("UPDATE care_recipients SET permission_tier = ? WHERE id = ?").run(permissionTier, req.params.id);
    }
    if (visibilitySettings !== undefined) {
      await db.prepare("UPDATE care_recipients SET visibility_settings = ? WHERE id = ?").run(
        JSON.stringify(visibilitySettings), req.params.id
      );
    }

    const updated = await db.prepare("SELECT permission_tier, visibility_settings FROM care_recipients WHERE id = ?").get(req.params.id);
    res.json({
      permissionTier: updated.permission_tier,
      visibilitySettings: updated.visibility_settings ? JSON.parse(updated.visibility_settings) : null,
    });
  } catch (err) {
    console.error("Update permissions error:", err);
    res.status(500).json({ error: "Failed to update permissions" });
  }
});

module.exports = router;
