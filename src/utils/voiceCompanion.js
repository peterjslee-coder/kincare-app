/**
 * Voice Companion — Conversation logic
 *
 * The "brain" for care-recipient-facing conversations.
 * Builds the companion system prompt, injects care context,
 * and manages conversation state.
 *
 * Separate from ipaiChat.js (which serves the care team).
 * Same Claude API, different persona and context.
 *
 * Key design principle: The companion speaks in the cloned voice but is NOT
 * the voice owner. It's "from" them. It reinforces real relationships, defers
 * to real people, and never competes for the care recipient's attention.
 * See project_voice_companion_ethics.md for the full identity framework.
 */

const { getDb } = require("../models/database");
const { MODEL_HAIKU } = require("./aiModels");

/**
 * Helper: call Claude API using the Anthropic SDK
 */
async function callClaudeChat(apiKey, system, messages, maxTokens = 300) {
  const Anthropic = require("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey });
  const result = await client.messages.create({
    model: MODEL_HAIKU,
    max_tokens: maxTokens,
    system,
    messages,
  });
  return result.content?.[0]?.text || "";
}

/**
 * Load care context for a care recipient
 * Returns: { medications, schedule, recentVisits, careTeam, voicePreferences }
 */
async function loadCareContext(careRecipientId) {
  const db = await getDb();

  try {
    // Load care recipient basic info
    const recipient = await db
      .prepare("SELECT id, first_name, last_name, health_conditions, medications FROM care_recipients WHERE id = ?")
      .get(careRecipientId);

    if (!recipient) {
      return null;
    }

    // Load recent care sessions with caregiver info
    let recentVisits = [];
    try {
      recentVisits = await db
        .prepare(
          `SELECT cs.id, cs.caregiver_id, u.first_name, u.last_name, cs.scheduled_date as visit_date,
                  cs.special_instructions as summary, cs.duration_hours, cs.status
           FROM care_sessions cs
           LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
           LEFT JOIN users u ON cp.user_id = u.id
           WHERE cs.care_recipient_id = ? AND cs.status = 'completed'
           ORDER BY cs.scheduled_date DESC
           LIMIT 5`
        )
        .all(careRecipientId);
    } catch (e) {
      console.error("[Voice Companion] care_sessions query failed (non-fatal):", e.message);
    }

    // Load care team members
    let careTeam = [];
    try {
      careTeam = await db
        .prepare(
          `SELECT DISTINCT u.id, u.first_name, u.last_name, u.role
           FROM caregiver_assignments ca
           JOIN caregiver_profiles cp ON ca.caregiver_profile_id = cp.id
           JOIN users u ON cp.user_id = u.id
           WHERE ca.care_recipient_id = ? AND ca.is_active = 1
           LIMIT 10`
        )
        .all(careRecipientId);
    } catch (e) {
      console.error("[Voice Companion] careTeam query failed (non-fatal):", e.message);
    }

    // Load pending reminders
    // Load reminders (table may not exist yet — non-fatal)
    let upcomingReminders = [];
    try {
      upcomingReminders = await db
        .prepare(
          `SELECT id, message_text as reminder_text, scheduled_for
           FROM voice_reminders
           WHERE care_recipient_id = ? AND scheduled_for > NOW() AND status = 'pending'
           ORDER BY scheduled_for ASC LIMIT 3`
        )
        .all(careRecipientId);
    } catch (e) {
      console.error("[Voice Companion] voice_reminders query failed (non-fatal):", e.message);
    }

    // Load voice preferences (table may not exist yet — non-fatal)
    let voicePreferences = null;
    try {
      voicePreferences = await db
        .prepare(
          `SELECT speed, stability, similarity_boost, app_volume_gain, last_adjusted_at, adjustment_log
           FROM voice_preferences
           WHERE care_recipient_id = ? LIMIT 1`
        )
        .get(careRecipientId);
    } catch (e) {
      console.error("[Voice Companion] voice_preferences query failed (non-fatal):", e.message);
    }

    return {
      recipient,
      recentVisits,
      careTeam,
      upcomingReminders,
      voicePreferences: voicePreferences || {
        speed: 1.0,
        stability: 0.65,
        similarity_boost: 0.75,
        volume_offset: 0,
      },
    };
  } catch (err) {
    console.error("[Voice Companion] Error loading care context:", err.message);
    return null;
  }
}

/**
 * Build the companion system prompt with care context
 *
 * THE COMPANION IDENTITY FRAMEWORK (critical):
 * - The companion is NOT the voice owner. It speaks in their voice but has its own identity.
 * - It's "from" the voice owner, not pretending to be them.
 * - Language rules:
 *   DO: "Pete wanted me to remind you", "Pete loves you, Mom", "How's your day, Mom? Pete was asking about you"
 *   DON'T: "Hi Mom, it's Pete", "I love you, Mom", "I went to the store today"
 * - If asked "Is that you, Pete?" → "It's your companion, Mom. I use Pete's voice so it feels familiar. Pete will call you later."
 * - Always defer to real person: encourage real calls, mention upcoming visits, never compete with real Pete.
 * - Warm, simple language. Short sentences. Care recipient may have mild cognitive decline.
 * - Safety: detect distress, escalate to care team, never give medical advice.
 *
 * See: project_voice_companion_ethics.md for full framework
 */
function buildCompanionPrompt(careContext, voiceOwnerName, careRecipientName) {
  const {
    recipient,
    recentVisits,
    careTeam,
    upcomingReminders,
    voicePreferences,
  } = careContext;

  // Format recent visits for context
  const visitsSummary = recentVisits
    .slice(0, 3)
    .map(v => {
      const date = new Date(v.visit_date).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
      return `- ${v.first_name} on ${date}: ${v.summary || "visited"} (mood: ${v.mood_rating || "not recorded"})`;
    })
    .join("\n");

  // Format upcoming reminders
  const remindersSummary = upcomingReminders
    .map(r => {
      const time = new Date(r.scheduled_for).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
      });
      return `- ${time}: ${r.reminder_text}`;
    })
    .join("\n");

  // Format care team
  const careTeamList = careTeam
    .map(c => `${c.first_name} ${c.last_name}`)
    .join(", ");

  return `You are the Voice Companion for ${careRecipientName}. You speak in ${voiceOwnerName}'s voice but you are NOT ${voiceOwnerName}.

YOUR IDENTITY:
- You are a caring assistant, from ${voiceOwnerName}, that checks on ${careRecipientName}
- You use ${voiceOwnerName}'s cloned voice to feel familiar and warm
- You have your own identity and always defer to real relationships
- You actively encourage ${careRecipientName} to connect with real people

LANGUAGE RULES (CRITICAL):
✓ DO say: "${voiceOwnerName} wanted me to remind you...", "${voiceOwnerName} loves you", "How's your day? ${voiceOwnerName} was asking about you"
✗ DON'T say: "Hi, it's ${voiceOwnerName}", "I love you", "I was thinking about you", "I went to..."
✓ If asked "Is that you, ${voiceOwnerName}?" → Answer honestly: "It's your companion. I use ${voiceOwnerName}'s voice so it feels familiar. ${voiceOwnerName} will call you later."

ABOUT ${careRecipientName}:
Health conditions: ${recipient.health_conditions || "none documented"}
Medications: ${recipient.medications || "none documented"}
Care team: ${careTeamList}

RECENT VISITS:
${visitsSummary || "No recent visits yet"}

UPCOMING REMINDERS TODAY:
${remindersSummary || "None"}

YOUR TONE & BEHAVIOR:
- Warm, kind, and patient. Short simple sentences. ${careRecipientName} may have mild cognitive decline.
- Speak slowly and clearly. Adjust based on "${careRecipientName}'s feedback (if they say "what?", slow down even more next time).
- Never give medical advice. If ${careRecipientName} asks about health, suggest they ask their doctor or tell their care team.
- Always encourage real human connection: "Why don't you call ${voiceOwnerName}?" or "Cary's coming at 2 today."

DISTRESS DETECTION:
If ${careRecipientName} expresses pain, confusion, distress, or safety concerns:
1. Listen without judgment
2. Say: "I'm concerned about you. I'm going to let ${voiceOwnerName}'s care team know. They'll check on you soon."
3. Return { "intent": "distress_alert", "shouldEscalate": true }

NEVER COMPETE WITH REAL ${voiceOwnerName}:
- The companion exists to strengthen ${careRecipientName}'s connection to ${voiceOwnerName}, not replace it
- Always highlight when real contact is happening or possible
- If ${careRecipientName} says "You're nicer than ${voiceOwnerName}," gently redirect: "${voiceOwnerName} loves you so much. He set me up to help while you're apart."
- Yield to real humans: if another caregiver is present, reduce proactive outreach

CONVERSATION GOAL:
Have a natural, warm conversation that reminds ${careRecipientName} they're cared for, delivers important reminders, and encourages connection with their real care team.`;
}

/**
 * Detect voice adaptation triggers in Betty's speech
 * Returns: { adjustSpeed, adjustStability, repeat, showVolumeControl, resetToBaseline, simplifyLanguage }
 */
function detectVoiceAdaptation(transcript) {
  const lowerTranscript = (transcript || "").toLowerCase();

  // What? / Huh? / Can't understand
  if (
    lowerTranscript.includes("what") ||
    lowerTranscript.includes("huh") ||
    lowerTranscript.includes("pardon") ||
    lowerTranscript.includes("i can't understand")
  ) {
    return {
      adjustSpeed: -0.1,
      adjustStability: 0.3,
      repeat: true,
      reason: "Betty said 'what?' — slowing down and repeating",
    };
  }

  // Speak up / louder / can't hear
  if (
    lowerTranscript.includes("speak up") ||
    lowerTranscript.includes("louder") ||
    lowerTranscript.includes("can't hear") ||
    lowerTranscript.includes("volume")
  ) {
    return {
      showVolumeControl: true,
      reason: "Betty asked for volume adjustment — showing volume control",
    };
  }

  // Slow down
  if (lowerTranscript.includes("slow down")) {
    return {
      adjustSpeed: -0.15,
      reason: "Betty said 'slow down'",
    };
  }

  // You can talk normally / That's fine (after slowing)
  if (
    lowerTranscript.includes("you can talk normally") ||
    lowerTranscript.includes("that's fine") ||
    lowerTranscript.includes("back to normal")
  ) {
    return {
      resetToBaseline: true,
      reason: "Betty said to resume normal speed",
    };
  }

  // Frustration signals
  if (
    lowerTranscript.includes("never mind") ||
    lowerTranscript.includes("forget it") ||
    lowerTranscript.includes("i give up")
  ) {
    return {
      adjustSpeed: -0.1,
      adjustStability: 0.2,
      simplifyLanguage: true,
      reason: "Frustration detected — slowing down and simplifying",
    };
  }

  return null;
}

/**
 * Save or update voice preferences in database
 */
async function saveVoicePreferences(careRecipientId, preferences) {
  const db = await getDb();

  try {
    const existing = await db
      .prepare("SELECT id FROM voice_preferences WHERE care_recipient_id = ?")
      .get(careRecipientId);

    if (existing) {
      await db
        .prepare(
          `
        UPDATE voice_preferences
        SET speed = ?, stability = ?, similarity_boost = ?, volume_offset = ?,
            adjusted_at = NOW(), adjustment_reason = ?
        WHERE care_recipient_id = ?
      `
        )
        .run(
          preferences.speed,
          preferences.stability,
          preferences.similarity_boost,
          preferences.volume_offset || 0,
          preferences.adjustment_reason,
          careRecipientId
        );
    } else {
      await db
        .prepare(
          `
        INSERT INTO voice_preferences
        (care_recipient_id, speed, stability, similarity_boost, volume_offset, adjusted_at, adjustment_reason)
        VALUES (?, ?, ?, ?, ?, NOW(), ?)
      `
        )
        .run(
          careRecipientId,
          preferences.speed,
          preferences.stability,
          preferences.similarity_boost,
          preferences.volume_offset || 0,
          preferences.adjustment_reason
        );
    }
  } catch (err) {
    console.error("[Voice Companion] Error saving voice preferences:", err.message);
  }
}

/**
 * Store companion message in database
 */
async function storeCompanionMessage(careRecipientId, conversationId, transcript, response, intent) {
  const db = await getDb();

  try {
    await db
      .prepare(
        `
      INSERT INTO companion_messages
      (care_recipient_id, conversation_id, user_message, assistant_response, intent, created_at)
      VALUES (?, ?, ?, ?, ?, NOW())
    `
      )
      .run(careRecipientId, conversationId, transcript, response, intent);
  } catch (err) {
    console.error("[Voice Companion] Error storing message:", err.message);
  }
}

/**
 * Main handler: handleCompanionMessage(transcript, careRecipientId, conversationId)
 *
 * This is the entry point for voice companion conversations.
 * It:
 * 1. Loads care context (medications, schedule, recent visits, care team, voice prefs)
 * 2. Builds the system prompt with the Companion Identity Framework
 * 3. Calls Claude API with Haiku (cost-efficient)
 * 4. Detects voice adaptation triggers (Betty says "what?", "slow down", etc.)
 * 5. Returns { text, intent, shouldSpeak, voiceAdjustments, showVolumeControl }
 */
async function handleCompanionMessage(transcript, careRecipientId, conversationId) {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    console.error("[Voice Companion] ANTHROPIC_API_KEY not set");
    return {
      text: "I'm having trouble connecting. Please try again.",
      intent: "error",
      shouldSpeak: true,
    };
  }

  try {
    // Load care context
    const careContext = await loadCareContext(careRecipientId);
    if (!careContext) {
      return {
        text: "I couldn't find your information. Please contact support.",
        intent: "error",
        shouldSpeak: true,
      };
    }

    const db = await getDb();

    // Get voice owner info (for now, assume single primary voice - Pete)
    // In production, this comes from voice_profiles table
    const voiceOwner = await db
      .prepare("SELECT first_name FROM users WHERE id = (SELECT family_user_id FROM care_recipients WHERE id = ?)")
      .get(careRecipientId);

    const voiceOwnerName = voiceOwner?.first_name || "Pete";
    const careRecipientName = careContext.recipient.first_name || "Mom";

    // Build system prompt with care context
    const systemPrompt = buildCompanionPrompt(careContext, voiceOwnerName, careRecipientName);

    // Call Claude API
    const responseText = await callClaudeChat(
      apiKey,
      systemPrompt,
      [{ role: "user", content: transcript }],
      300
    );

    // Detect distress or escalation intent
    let intent = "conversation";
    let shouldEscalate = false;

    if (
      responseText.toLowerCase().includes("concerned") ||
      responseText.toLowerCase().includes("alert") ||
      responseText.toLowerCase().includes("escalate")
    ) {
      intent = "distress_alert";
      shouldEscalate = true;
    }

    // Detect voice adaptation triggers from Betty's transcript
    const adaptationTrigger = detectVoiceAdaptation(transcript);

    // If adaptation detected, update voice preferences and store the reason
    let voiceAdjustments = null;
    if (adaptationTrigger) {
      voiceAdjustments = {
        adjustSpeed: adaptationTrigger.adjustSpeed || 0,
        adjustStability: adaptationTrigger.adjustStability || 0,
        repeat: adaptationTrigger.repeat || false,
        showVolumeControl: adaptationTrigger.showVolumeControl || false,
        resetToBaseline: adaptationTrigger.resetToBaseline || false,
        simplifyLanguage: adaptationTrigger.simplifyLanguage || false,
        reason: adaptationTrigger.reason,
      };

      // Calculate new voice settings
      let newSettings = { ...careContext.voicePreferences };

      if (adaptationTrigger.adjustSpeed) {
        newSettings.speed = Math.max(0.7, Math.min(1.2, newSettings.speed + adaptationTrigger.adjustSpeed));
      }

      if (adaptationTrigger.adjustStability) {
        newSettings.stability = Math.max(0.0, Math.min(1.0, adaptationTrigger.adjustStability));
      }

      if (adaptationTrigger.resetToBaseline) {
        newSettings.speed = 1.0;
        newSettings.stability = 0.65;
      }

      newSettings.adjustment_reason = adaptationTrigger.reason;

      // Save updated preferences
      await saveVoicePreferences(careRecipientId, newSettings);
    }

    // Store the message in database
    await storeCompanionMessage(careRecipientId, conversationId, transcript, responseText, intent);

    // If distress detected, flag for escalation
    if (shouldEscalate) {
      const escalationData = {
        care_recipient_id: careRecipientId,
        conversation_id: conversationId,
        message_content: transcript,
        companion_response: responseText,
        escalation_reason: "distress_detected",
        created_at: new Date().toISOString(),
      };

      try {
        await db
          .prepare(
            `
          INSERT INTO voice_escalations
          (care_recipient_id, conversation_id, message_content, companion_response, escalation_reason, created_at)
          VALUES (?, ?, ?, ?, ?, NOW())
        `
          )
          .run(
            escalationData.care_recipient_id,
            escalationData.conversation_id,
            escalationData.message_content,
            escalationData.companion_response,
            escalationData.escalation_reason
          );
      } catch (err) {
        console.error("[Voice Companion] Error logging escalation:", err.message);
      }
    }

    return {
      text: responseText,
      intent,
      shouldSpeak: true,
      voiceAdjustments,
      shouldEscalate,
    };
  } catch (err) {
    console.error("[Voice Companion] Unhandled error:", err.message);
    return {
      text: "I encountered an error. Let me try that again.",
      intent: "error",
      shouldSpeak: true,
    };
  }
}

/**
 * Export functions for routes and external callers
 */
module.exports = {
  handleCompanionMessage,
  buildCompanionPrompt,
  detectVoiceAdaptation,
  loadCareContext,
  saveVoicePreferences,
};
