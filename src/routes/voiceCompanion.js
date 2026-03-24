/**
 * Voice Companion Routes
 *
 * Endpoints for the care-recipient-facing voice companion.
 * Shares auth and database with the main InPlace app.
 *
 * POST /api/voice-companion/chat        — Send transcript, get text + audio response
 * GET  /api/voice-companion/reminders   — Today's reminders for care recipient
 * POST /api/voice-companion/reminders   — Care team creates a reminder
 * GET  /api/voice-companion/profile     — Active voice profile for care recipient
 * POST /api/voice-companion/profiles    — Create/update voice profile
 * GET  /api/voice-companion/conversations — Conversation history
 *
 * ── Admin / Care Team (InPlace app settings) ──
 * GET  /api/voice-companion/admin/voice-routing     — Get voice routing config
 * PUT  /api/voice-companion/admin/voice-routing      — Update which voices speak for which message types
 * GET  /api/voice-companion/admin/voice-preferences  — Get care recipient's adaptive voice prefs
 * PUT  /api/voice-companion/admin/voice-preferences  — Set baseline voice prefs (speed, stability, etc)
 * GET  /api/voice-companion/admin/usage              — Credit usage stats
 * PUT  /api/voice-companion/admin/ipai-access/:userId — Toggle iPAi sidebar access for a team member
 */

const express = require("express");
const { v4: uuid } = require("uuid");
const { getDb } = require("../models/database");
const { authenticate } = require("../middleware/auth");
const { generateSpeech } = require("../utils/voiceService");
const { handleCompanionMessage } = require("../utils/voiceCompanion");

const router = express.Router();
router.use(authenticate);

// Companion access gate: user must have companion_access=1 or be admin
router.use(async (req, res, next) => {
  try {
    const db = await getDb();
    const user = await db.prepare("SELECT companion_access, is_admin FROM users WHERE id = ?").get(req.user.id);
    if (!user || (!user.companion_access && !user.is_admin)) {
      return res.status(403).json({ error: "Companion access not enabled for this account" });
    }
    next();
  } catch (err) {
    return res.status(500).json({ error: "Failed to verify companion access" });
  }
});

// ═══════════════════════════════════════════════════════════
// INITIALIZATION — Create tables if they don't exist
// ═══════════════════════════════════════════════════════════

async function initializeTables() {
  try {
    const db = await getDb();

    await db.exec(`
      CREATE TABLE IF NOT EXISTS voice_profiles (
        id UUID PRIMARY KEY,
        user_id UUID NOT NULL,
        care_recipient_id UUID,
        provider TEXT DEFAULT 'elevenlabs',
        provider_voice_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        sample_audio_url TEXT,
        consent_recorded_at TIMESTAMPTZ,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, provider_voice_id)
      );
    `);

    await db.exec(`
      CREATE TABLE IF NOT EXISTS companion_messages (
        id UUID PRIMARY KEY,
        care_recipient_id UUID NOT NULL,
        conversation_id UUID,
        role TEXT NOT NULL CHECK (role IN ('user', 'companion')),
        content TEXT NOT NULL,
        audio_url TEXT,
        voice_profile_id UUID REFERENCES voice_profiles(id),
        credits_used INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        FOREIGN KEY (voice_profile_id) REFERENCES voice_profiles(id) ON DELETE SET NULL
      );
    `);

    await db.exec(`
      CREATE TABLE IF NOT EXISTS voice_reminders (
        id UUID PRIMARY KEY,
        care_recipient_id UUID NOT NULL,
        message_text TEXT NOT NULL,
        scheduled_for TIMESTAMPTZ NOT NULL,
        voice_profile_id UUID,
        status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'skipped', 'cancelled')),
        delivered_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        created_by UUID,
        FOREIGN KEY (voice_profile_id) REFERENCES voice_profiles(id) ON DELETE SET NULL
      );
    `);

    await db.exec(`
      CREATE TABLE IF NOT EXISTS voice_routing (
        id UUID PRIMARY KEY,
        care_recipient_id UUID NOT NULL,
        message_type TEXT NOT NULL,
        voice_profile_id UUID,
        priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(care_recipient_id, message_type),
        FOREIGN KEY (voice_profile_id) REFERENCES voice_profiles(id) ON DELETE SET NULL
      );
    `);

    await db.exec(`
      CREATE TABLE IF NOT EXISTS voice_preferences (
        id UUID PRIMARY KEY,
        care_recipient_id UUID NOT NULL UNIQUE,
        speed REAL DEFAULT 1.0,
        stability REAL DEFAULT 0.5,
        similarity_boost REAL DEFAULT 0.8,
        app_volume_gain REAL DEFAULT 1.0,
        baseline_speed REAL DEFAULT 1.0,
        baseline_stability REAL DEFAULT 0.5,
        baseline_similarity_boost REAL DEFAULT 0.8,
        last_adjusted_at TIMESTAMPTZ,
        adjustment_log JSONB DEFAULT '[]'::jsonb,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        FOREIGN KEY (care_recipient_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `);

    console.log("[Voice Companion] Database tables initialized");
  } catch (err) {
    console.error("[Voice Companion] Table initialization error:", err.message);
  }
}

// Initialize on module load
initializeTables().catch(err => console.error("[Voice Companion] Init failed:", err));

// ── Helper: Determine voice to use for message ─────────────────────

async function getVoiceForMessage(db, careRecipientId, messageType = "conversation") {
  // Look up voice routing config for this care recipient + message type
  const routing = await db.prepare(
    "SELECT voice_profile_id FROM voice_routing WHERE care_recipient_id = ? AND message_type = ? LIMIT 1"
  ).get(careRecipientId, messageType);

  if (routing?.voice_profile_id) {
    const profile = await db.prepare(
      "SELECT * FROM voice_profiles WHERE id = ? AND is_active = true"
    ).get(routing.voice_profile_id);
    if (profile) return profile;
  }

  // Fallback: get any active profile for this care recipient (primary/Pete's voice)
  const defaultProfile = await db.prepare(
    "SELECT * FROM voice_profiles WHERE care_recipient_id = ? AND is_active = true ORDER BY created_at ASC LIMIT 1"
  ).get(careRecipientId);

  return defaultProfile;
}

// ── Helper: Get voice preferences ──────────────────────────────────

async function getVoicePreferences(db, careRecipientId) {
  let prefs = await db.prepare(
    "SELECT * FROM voice_preferences WHERE care_recipient_id = ?"
  ).get(careRecipientId);

  if (!prefs) {
    // Create default preferences
    const id = uuid();
    await db.prepare(`
      INSERT INTO voice_preferences (id, care_recipient_id) VALUES (?, ?)
    `).run(id, careRecipientId);
    prefs = await db.prepare(
      "SELECT * FROM voice_preferences WHERE care_recipient_id = ?"
    ).get(careRecipientId);
  }

  return prefs;
}

// ── Helper: Calculate credits for text ─────────────────────────────

function calculateCredits(text) {
  // ElevenLabs pricing: ~1 credit per character (simplified)
  return Math.max(1, Math.ceil(text.length / 100));
}

// ───────────────────────────────────────────────────────────────────
// CARE RECIPIENT ENDPOINTS (Voice Companion PWA)
// ───────────────────────────────────────────────────────────────────

// ── POST /api/voice-companion/chat ────────────────────────────────
// Main conversation endpoint
router.post("/chat", async (req, res) => {
  const db = await getDb();
  const { transcript, care_recipient_id, conversation_id, message_type = "conversation" } = req.body;

  if (!transcript || typeof transcript !== "string" || !transcript.trim()) {
    return res.status(400).json({ error: "Transcript is required and must be non-empty" });
  }

  if (!care_recipient_id) {
    return res.status(400).json({ error: "care_recipient_id is required" });
  }

  try {
    // Get voice profile to use (fall back to Pete's cloned voice for Phase 0)
    let voiceProfile = await getVoiceForMessage(db, care_recipient_id, message_type);
    if (!voiceProfile) {
      // Phase 0 fallback: use Pete's ElevenLabs cloned voice directly
      voiceProfile = {
        id: null,
        provider_voice_id: process.env.ELEVENLABS_VOICE_ID || "c2liOZ7MsLVLDpKuwIY5",
        display_name: "Pete (default)",
      };
    }

    // Get voice preferences for audio generation
    const voicePrefs = await getVoicePreferences(db, care_recipient_id);

    // Generate conversation ID if not provided
    const convId = conversation_id || uuid();

    // Handle the message through the companion brain (Claude)
    const chatResult = await handleCompanionMessage(transcript, care_recipient_id, convId);
    // handleCompanionMessage returns { text, intent, shouldSpeak, ... }
    const companionText = chatResult.text || chatResult.response || "I'm sorry, I couldn't process that.";

    // Generate audio for the response
    const audioBuffer = await generateSpeech(companionText, voiceProfile.provider_voice_id, {
      speed: voicePrefs.speed || 1.0,
      stability: voicePrefs.stability || 0.5,
      similarity_boost: voicePrefs.similarity_boost || 0.8,
    });

    const audioBase64 = audioBuffer.toString("base64");
    const creditsUsed = calculateCredits(companionText);

    // Store messages (non-blocking — don't let DB errors prevent the response)
    const companionMessageId = uuid();
    try {
      const userMessageId = uuid();
      await db.prepare(`
        INSERT INTO companion_messages (id, care_recipient_id, conversation_id, role, content, created_at)
        VALUES (?, ?, ?, 'user', ?, NOW())
      `).run(userMessageId, care_recipient_id, convId, transcript);

      await db.prepare(`
        INSERT INTO companion_messages (id, care_recipient_id, conversation_id, role, content, voice_profile_id, credits_used, created_at)
        VALUES (?, ?, ?, 'companion', ?, ?, ?, NOW())
      `).run(companionMessageId, care_recipient_id, convId, companionText, voiceProfile.id || null, creditsUsed);
    } catch (storeErr) {
      console.error("[Voice Companion Chat] Message storage error (non-fatal):", storeErr.message);
    }

    return res.json({
      text: companionText,
      audio: audioBase64,
      voice_used: voiceProfile.display_name,
      message_id: companionMessageId,
      conversation_id: convId,
      credits_used: creditsUsed,
      intent: chatResult.intent,
      actions: chatResult.actions || [],
    });
  } catch (err) {
    console.error("[Voice Companion Chat] Error:", err.message);
    return res.status(500).json({
      error: "Failed to process message",
      message: err.message,
    });
  }
});

// ── GET /api/voice-companion/reminders ─────────────────────────────
router.get("/reminders", async (req, res) => {
  const db = await getDb();
  const { care_recipient_id } = req.query;

  if (!care_recipient_id) {
    return res.status(400).json({ error: "care_recipient_id is required" });
  }

  try {
    // Get today's reminders
    const today = new Date().toISOString().split("T")[0];
    const reminders = await db.prepare(`
      SELECT vr.*, vp.display_name as voice_display_name
      FROM voice_reminders vr
      LEFT JOIN voice_profiles vp ON vr.voice_profile_id = vp.id
      WHERE vr.care_recipient_id = ?
        AND DATE(vr.scheduled_for) = ?
        AND vr.status IN ('pending', 'delivered')
      ORDER BY vr.scheduled_for ASC
    `).all(care_recipient_id, today);

    return res.json({ reminders });
  } catch (err) {
    console.error("[Voice Companion Reminders GET] Error:", err.message);
    return res.status(500).json({ error: "Failed to fetch reminders" });
  }
});

// ── POST /api/voice-companion/reminders ────────────────────────────
router.post("/reminders", async (req, res) => {
  const db = await getDb();
  const { care_recipient_id, message_text, scheduled_for, voice_profile_id } = req.body;

  if (!care_recipient_id || !message_text || !scheduled_for) {
    return res.status(400).json({ error: "care_recipient_id, message_text, and scheduled_for are required" });
  }

  try {
    // Validate voice profile if provided
    if (voice_profile_id) {
      const profile = await db.prepare(
        "SELECT id FROM voice_profiles WHERE id = ? AND is_active = true"
      ).get(voice_profile_id);
      if (!profile) {
        return res.status(404).json({ error: "Voice profile not found or inactive" });
      }
    }

    const reminderId = uuid();
    await db.prepare(`
      INSERT INTO voice_reminders (id, care_recipient_id, message_text, scheduled_for, voice_profile_id, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, NOW())
    `).run(reminderId, care_recipient_id, message_text, scheduled_for, voice_profile_id || null, req.user.id);

    const reminder = await db.prepare(
      "SELECT * FROM voice_reminders WHERE id = ?"
    ).get(reminderId);

    return res.status(201).json(reminder);
  } catch (err) {
    console.error("[Voice Companion Reminders POST] Error:", err.message);
    return res.status(500).json({ error: "Failed to create reminder" });
  }
});

// ── GET /api/voice-companion/profile ───────────────────────────────
router.get("/profile", async (req, res) => {
  const db = await getDb();
  const { care_recipient_id } = req.query;

  if (!care_recipient_id) {
    return res.status(400).json({ error: "care_recipient_id is required" });
  }

  try {
    const profile = await db.prepare(
      "SELECT * FROM voice_profiles WHERE care_recipient_id = ? AND is_active = true ORDER BY created_at ASC LIMIT 1"
    ).get(care_recipient_id);

    if (!profile) {
      return res.status(404).json({ error: "No active voice profile found" });
    }

    return res.json(profile);
  } catch (err) {
    console.error("[Voice Companion Profile GET] Error:", err.message);
    return res.status(500).json({ error: "Failed to fetch profile" });
  }
});

// ── POST /api/voice-companion/profiles ─────────────────────────────
router.post("/profiles", async (req, res) => {
  const db = await getDb();
  const { provider_voice_id, display_name, care_recipient_id, consent_recorded_at } = req.body;

  if (!provider_voice_id || !display_name) {
    return res.status(400).json({ error: "provider_voice_id and display_name are required" });
  }

  try {
    const profileId = uuid();
    await db.prepare(`
      INSERT INTO voice_profiles (id, user_id, care_recipient_id, provider_voice_id, display_name, consent_recorded_at, created_at, updated_at)
      VALUES (?, ?, ?, 'elevenlabs', ?, ?, NOW(), NOW())
    `).run(profileId, req.user.id, care_recipient_id || null, display_name, consent_recorded_at || new Date().toISOString());

    const profile = await db.prepare(
      "SELECT * FROM voice_profiles WHERE id = ?"
    ).get(profileId);

    return res.status(201).json(profile);
  } catch (err) {
    console.error("[Voice Companion Profiles POST] Error:", err.message);
    return res.status(500).json({ error: "Failed to create profile" });
  }
});

// ── GET /api/voice-companion/conversations ─────────────────────────
router.get("/conversations", async (req, res) => {
  const db = await getDb();
  const { care_recipient_id, limit = 50, offset = 0 } = req.query;

  if (!care_recipient_id) {
    return res.status(400).json({ error: "care_recipient_id is required" });
  }

  try {
    // Get conversation summaries (grouped by conversation_id)
    const conversations = await db.prepare(`
      SELECT
        conversation_id,
        MIN(created_at) as started_at,
        MAX(created_at) as updated_at,
        COUNT(*) as message_count
      FROM companion_messages
      WHERE care_recipient_id = ?
      GROUP BY conversation_id
      ORDER BY updated_at DESC
      LIMIT ? OFFSET ?
    `).all(care_recipient_id, parseInt(limit), parseInt(offset));

    // Get messages for each conversation
    const result = [];
    for (const conv of conversations) {
      const messages = await db.prepare(`
        SELECT id, role, content, voice_profile_id, credits_used, created_at
        FROM companion_messages
        WHERE conversation_id = ?
        ORDER BY created_at ASC
      `).all(conv.conversation_id);

      result.push({
        conversation_id: conv.conversation_id,
        started_at: conv.started_at,
        updated_at: conv.updated_at,
        message_count: conv.message_count,
        messages,
      });
    }

    return res.json({ conversations: result });
  } catch (err) {
    console.error("[Voice Companion Conversations] Error:", err.message);
    return res.status(500).json({ error: "Failed to fetch conversations" });
  }
});

// ═══════════════════════════════════════════════════════════════════
// ADMIN / CARE TEAM ENDPOINTS (InPlace app settings)
// ═══════════════════════════════════════════════════════════════════

// ── Helper: Check admin permission ────────────────────────────────

async function requireAdmin(req, res, next) {
  // Check API key auth first (sets req.isAdmin)
  if (req.isAdmin) {
    return next();
  }

  // Otherwise check database for JWT auth
  try {
    const db = await getDb();
    const user = await db.prepare("SELECT is_admin FROM users WHERE id = ?").get(req.user.id);
    if (!user || !user.is_admin) {
      return res.status(403).json({ error: "Admin access required" });
    }
    next();
  } catch (err) {
    console.error("[Voice Companion] Admin check error:", err.message);
    return res.status(500).json({ error: "Admin check failed" });
  }
}

// ── GET /api/voice-companion/admin/voice-routing ──────────────────
router.get("/admin/voice-routing", requireAdmin, async (req, res) => {
  const db = await getDb();
  const { care_recipient_id } = req.query;

  if (!care_recipient_id) {
    return res.status(400).json({ error: "care_recipient_id is required" });
  }

  try {
    const routing = await db.prepare(`
      SELECT vr.*, vp.display_name
      FROM voice_routing vr
      LEFT JOIN voice_profiles vp ON vr.voice_profile_id = vp.id
      WHERE vr.care_recipient_id = ?
      ORDER BY vr.message_type ASC
    `).all(care_recipient_id);

    return res.json({ routing });
  } catch (err) {
    console.error("[Voice Routing GET] Error:", err.message);
    return res.status(500).json({ error: "Failed to fetch voice routing" });
  }
});

// ── PUT /api/voice-companion/admin/voice-routing ───────────────────
router.put("/admin/voice-routing", requireAdmin, async (req, res) => {
  const db = await getDb();
  const { care_recipient_id, routing } = req.body;

  if (!care_recipient_id || !Array.isArray(routing)) {
    return res.status(400).json({ error: "care_recipient_id and routing array are required" });
  }

  try {
    await db.transaction(async (tx) => {
      for (const entry of routing) {
        const { message_type, voice_profile_id, priority = "medium" } = entry;

        if (!message_type) {
          throw new Error("message_type is required for each routing entry");
        }

        // Validate voice profile if provided
        if (voice_profile_id) {
          const profile = await tx.prepare(
            "SELECT id FROM voice_profiles WHERE id = ? AND is_active = true"
          ).get(voice_profile_id);
          if (!profile) {
            throw new Error(`Voice profile ${voice_profile_id} not found or inactive`);
          }
        }

        // Upsert routing entry
        const existing = await tx.prepare(
          "SELECT id FROM voice_routing WHERE care_recipient_id = ? AND message_type = ?"
        ).get(care_recipient_id, message_type);

        if (existing) {
          await tx.prepare(`
            UPDATE voice_routing SET voice_profile_id = ?, priority = ?, updated_at = NOW()
            WHERE care_recipient_id = ? AND message_type = ?
          `).run(voice_profile_id || null, priority, care_recipient_id, message_type);
        } else {
          await tx.prepare(`
            INSERT INTO voice_routing (id, care_recipient_id, message_type, voice_profile_id, priority, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, NOW(), NOW())
          `).run(uuid(), care_recipient_id, message_type, voice_profile_id || null, priority);
        }
      }
    });

    const updated = await db.prepare(`
      SELECT vr.*, vp.display_name
      FROM voice_routing vr
      LEFT JOIN voice_profiles vp ON vr.voice_profile_id = vp.id
      WHERE vr.care_recipient_id = ?
      ORDER BY vr.message_type ASC
    `).all(care_recipient_id);

    return res.json({ routing: updated });
  } catch (err) {
    console.error("[Voice Routing PUT] Error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── GET /api/voice-companion/admin/voice-preferences ───────────────
router.get("/admin/voice-preferences", requireAdmin, async (req, res) => {
  const db = await getDb();
  const { care_recipient_id } = req.query;

  if (!care_recipient_id) {
    return res.status(400).json({ error: "care_recipient_id is required" });
  }

  try {
    const prefs = await getVoicePreferences(db, care_recipient_id);
    return res.json(prefs);
  } catch (err) {
    console.error("[Voice Preferences GET] Error:", err.message);
    return res.status(500).json({ error: "Failed to fetch preferences" });
  }
});

// ── PUT /api/voice-companion/admin/voice-preferences ───────────────
router.put("/admin/voice-preferences", requireAdmin, async (req, res) => {
  const db = await getDb();
  const { care_recipient_id, speed, stability, similarity_boost } = req.body;

  if (!care_recipient_id) {
    return res.status(400).json({ error: "care_recipient_id is required" });
  }

  try {
    // Validate ranges
    if (speed !== undefined && (speed < 0.7 || speed > 1.5)) {
      return res.status(400).json({ error: "speed must be between 0.7 and 1.5" });
    }
    if (stability !== undefined && (stability < 0 || stability > 1)) {
      return res.status(400).json({ error: "stability must be between 0 and 1" });
    }
    if (similarity_boost !== undefined && (similarity_boost < 0 || similarity_boost > 1)) {
      return res.status(400).json({ error: "similarity_boost must be between 0 and 1" });
    }

    const prefs = await getVoicePreferences(db, care_recipient_id);

    // Prepare update
    const newSpeed = speed ?? prefs.baseline_speed;
    const newStability = stability ?? prefs.baseline_stability;
    const newSimilarity = similarity_boost ?? prefs.baseline_similarity_boost;

    await db.prepare(`
      UPDATE voice_preferences
      SET
        speed = ?,
        stability = ?,
        similarity_boost = ?,
        baseline_speed = ?,
        baseline_stability = ?,
        baseline_similarity_boost = ?,
        last_adjusted_at = NOW(),
        updated_at = NOW()
      WHERE care_recipient_id = ?
    `).run(newSpeed, newStability, newSimilarity, newSpeed, newStability, newSimilarity, care_recipient_id);

    const updated = await db.prepare(
      "SELECT * FROM voice_preferences WHERE care_recipient_id = ?"
    ).get(care_recipient_id);

    return res.json(updated);
  } catch (err) {
    console.error("[Voice Preferences PUT] Error:", err.message);
    return res.status(500).json({ error: "Failed to update preferences" });
  }
});

// ── GET /api/voice-companion/admin/usage ────────────────────────────
router.get("/admin/usage", requireAdmin, async (req, res) => {
  const db = await getDb();
  const { care_recipient_id } = req.query;

  if (!care_recipient_id) {
    return res.status(400).json({ error: "care_recipient_id is required" });
  }

  try {
    // Total credits used
    const totalResult = await db.prepare(`
      SELECT
        SUM(credits_used) as total_credits,
        COUNT(*) as total_messages
      FROM companion_messages
      WHERE care_recipient_id = ?
    `).get(care_recipient_id);

    // Daily breakdown for past 7 days
    const dailyResult = await db.prepare(`
      SELECT
        DATE(created_at) as day,
        SUM(credits_used) as credits_used,
        COUNT(*) as message_count
      FROM companion_messages
      WHERE care_recipient_id = ? AND created_at > NOW() - INTERVAL '7 days'
      GROUP BY DATE(created_at)
      ORDER BY day DESC
    `).all(care_recipient_id);

    // Reminders
    const remindersResult = await db.prepare(`
      SELECT COUNT(*) as delivered_count
      FROM voice_reminders
      WHERE care_recipient_id = ? AND status = 'delivered'
    `).get(care_recipient_id);

    // Conversations
    const conversationsResult = await db.prepare(`
      SELECT COUNT(DISTINCT conversation_id) as conversation_count
      FROM companion_messages
      WHERE care_recipient_id = ?
    `).get(care_recipient_id);

    const avgDailyCredits = dailyResult.length > 0
      ? Math.round(dailyResult.reduce((sum, d) => sum + (d.credits_used || 0), 0) / dailyResult.length)
      : 0;

    const projectedMonthly = avgDailyCredits * 30;

    return res.json({
      summary: {
        total_credits_used: totalResult.total_credits || 0,
        total_messages: totalResult.total_messages || 0,
        delivered_reminders: remindersResult.delivered_count || 0,
        conversation_count: conversationsResult.conversation_count || 0,
        projected_monthly_credits: projectedMonthly,
      },
      daily_breakdown: dailyResult,
    });
  } catch (err) {
    console.error("[Voice Usage] Error:", err.message);
    return res.status(500).json({ error: "Failed to fetch usage stats" });
  }
});

// ── PUT /api/voice-companion/admin/ipai-access/:userId ──────────────
router.put("/admin/ipai-access/:userId", requireAdmin, async (req, res) => {
  const db = await getDb();
  const { userId } = req.params;
  const { enabled } = req.body;

  if (enabled === undefined || typeof enabled !== "boolean") {
    return res.status(400).json({ error: "enabled boolean is required" });
  }

  try {
    // Cannot modify own access (admins always have iPAi)
    if (userId === req.user.id && !enabled) {
      return res.status(403).json({ error: "Cannot disable iPAi access for yourself" });
    }

    // Update user's iPAi access
    await db.prepare(`
      UPDATE users SET ipai_access = ?, updated_at = NOW()
      WHERE id = ?
    `).run(enabled ? 1 : 0, userId);

    const user = await db.prepare(
      "SELECT id, email, first_name, last_name, ipai_access FROM users WHERE id = ?"
    ).get(userId);

    return res.json({ user });
  } catch (err) {
    console.error("[iPAi Access] Error:", err.message);
    return res.status(500).json({ error: "Failed to update iPAi access" });
  }
});

// ═══════════════════════════════════════════════════════════
// PUT /admin/companion-access/:userId — Toggle companion access for a user
// ═══════════════════════════════════════════════════════════

router.put("/admin/companion-access/:userId", requireAdmin, async (req, res) => {
  const { userId } = req.params;
  const { enabled } = req.body;
  const db = await getDb();

  try {
    await db.prepare(`
      UPDATE users SET companion_access = ?, updated_at = NOW()
      WHERE id = ?
    `).run(enabled ? 1 : 0, userId);

    const user = await db.prepare(
      "SELECT id, email, first_name, last_name, companion_access FROM users WHERE id = ?"
    ).get(userId);

    return res.json({ user });
  } catch (err) {
    console.error("[Companion Access] Error:", err.message);
    return res.status(500).json({ error: "Failed to update companion access" });
  }
});

module.exports = router;
