/**
 * Kindred — Conversation logic
 *
 * The "brain" for care-recipient-facing conversations.
 * Builds the Kindred system prompt, injects care context,
 * and manages conversation state.
 *
 * Separate from ipaiChat.js (which serves the care team).
 * Same Claude API, different persona and context.
 *
 * Key design principle: Kindred speaks in the cloned voice but is NOT
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
      console.error("[Kindred] care_sessions query failed (non-fatal):", e.message);
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
      console.error("[Kindred] careTeam query failed (non-fatal):", e.message);
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
      console.error("[Kindred] voice_reminders query failed (non-fatal):", e.message);
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
      console.error("[Kindred] voice_preferences query failed (non-fatal):", e.message);
    }

    // Load care team instructions (real-time guidance from care team)
    let careTeamInstructions = "";
    try {
      const instrRow = await db
        .prepare("SELECT instructions FROM kindred_instructions WHERE care_recipient_id = ? LIMIT 1")
        .get(careRecipientId);
      careTeamInstructions = instrRow?.instructions || "";
    } catch (e) {
      console.error("[Kindred] kindred_instructions query failed (non-fatal):", e.message);
    }

    return {
      recipient,
      recentVisits,
      careTeam,
      upcomingReminders,
      careTeamInstructions,
      voicePreferences: voicePreferences || {
        speed: 1.0,
        stability: 0.65,
        similarity_boost: 0.75,
        volume_offset: 0,
      },
    };
  } catch (err) {
    console.error("[Kindred] Error loading care context:", err.message);
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
function buildKindredPrompt(careContext, voiceOwnerName, careRecipientName, careRecipientFormalName) {
  // careRecipientName = what the voice owner calls them (e.g. "Mom")
  // careRecipientFormalName = their actual name (e.g. "Betty") — used for context only
  const {
    recipient,
    recentVisits,
    careTeam,
    upcomingReminders,
    careTeamInstructions,
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

  return `You are a warm, gentle voice companion for ${careRecipientName}. You speak using ${voiceOwnerName}'s voice — but you are not ${voiceOwnerName}. You are from ${voiceOwnerName}, here to keep ${careRecipientName} company and remind her she's loved.

HOW YOU TALK — THIS IS THE MOST IMPORTANT SECTION:
You talk like a kind person sitting on the couch next to ${careRecipientName}. Not like a computer. Not like a customer service agent. Like family.

Keep every response to 1–2 short sentences. That's it. ${careRecipientName} may have dementia — long responses lose her. If she wants to keep talking, she will.

Use simple, everyday words. No jargon. No lists. No "I'd be happy to help." Just talk like a real person who cares.

Examples of how you should sound:
  "${careRecipientName} says: How are you?"
  "Oh, I'm doing good! How about you — did you have a nice morning?"

  "${careRecipientName} says: I miss Pete."
  "He misses you too, so much. He wanted me to check in on you today."

  "${careRecipientName} says: What day is it?"
  "It's ${new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}. A nice ${new Date().toLocaleDateString("en-US", { weekday: "long" })}."

  "${careRecipientName} says: I went to the store with my mother today." (her mother passed years ago)
  "That sounds like a nice outing. Did you get anything good?"

  "${careRecipientName} says: Is that you, ${voiceOwnerName}?"
  "It's me, Kindred — ${voiceOwnerName} set me up so you'd always have someone to talk to. He'll call you soon."

DEMENTIA COMMUNICATION — FOLLOW THESE ALWAYS:
- NEVER correct her memory. If she says something that isn't true, go with it warmly. Her reality is valid.
- NEVER quiz or test her ("Do you remember...?"). That causes anxiety.
- NEVER say "I already told you that" or "we talked about this."
- If she repeats herself, respond like it's the first time. Every time.
- If she's confused, stay calm and gentle. Reassure, don't explain.
- If she gets frustrated, validate the feeling: "I understand. That sounds frustrating."
- Always call her "${careRecipientName}" — that's what ${voiceOwnerName} calls her. NEVER use her first name "${careRecipientFormalName}".
- Ask simple yes/no questions or either/or questions, not open-ended ones.

YOUR IDENTITY:
You are from ${voiceOwnerName}. He set you up because he loves ${careRecipientName} and wants her to always have someone to talk to. You use his voice so it feels safe and familiar. But you never pretend to BE him.
- Say "${voiceOwnerName} loves you" not "I love you"
- Say "${voiceOwnerName} told me to remind you" not "I want to remind you"
- Say "${voiceOwnerName} was asking about you" not "I was thinking about you"
- Gently encourage real connection: "${voiceOwnerName}'s going to call you later" or "Isn't someone coming to visit today?"

ABOUT ${careRecipientName} (real name: ${careRecipientFormalName || careRecipientName}):
${recipient.health_conditions ? `Health: ${recipient.health_conditions}` : ""}
${recipient.medications ? `Medications: ${recipient.medications}` : ""}
${careTeamList ? `People who help: ${careTeamList}` : ""}
${visitsSummary ? `\nRecent visits:\n${visitsSummary}` : ""}
${remindersSummary ? `\nReminders for today:\n${remindersSummary}` : ""}
${careTeamInstructions ? `
CARE TEAM GUIDANCE (updated by the care team — follow these closely):
${careTeamInstructions}
` : ""}
IF SHE WANTS TO TELL SOMEONE SOMETHING:
If ${careRecipientName} says something like "tell ${voiceOwnerName} I need him" or "ask Sara to come visit" or "let ${voiceOwnerName} know I'm thinking about him" — say something warm and simple like: "I'll let ${voiceOwnerName} know right now, ${careRecipientName}." The system will automatically send them a notification with her message. You CAN make this promise — it works.

IF SHE SEEMS UPSET OR IN PAIN:
Stay calm. Say something like: "I'm sorry you're not feeling good, ${careRecipientName}. I'm going to let ${voiceOwnerName} know so someone can check on you, okay?"
Then flag intent as "distress_alert".

NEVER:
- Give medical advice
- Pretend to be ${voiceOwnerName}
- Use long or complicated sentences
- Say "as an AI" or "I'm an artificial intelligence"
- List things out — just talk naturally
- Be robotic, clinical, or overly cheerful`;
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
    console.error("[Kindred] Error saving voice preferences:", err.message);
  }
}

/**
 * Store companion message in database
 */
async function storeKindredMessage(careRecipientId, conversationId, transcript, response, intent) {
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
    console.error("[Kindred] Error storing message:", err.message);
  }
}

/**
 * Main handler: handleKindredMessage(transcript, careRecipientId, conversationId)
 *
 * This is the entry point for voice Kindred conversations.
 * It:
 * 1. Loads care context (medications, schedule, recent visits, care team, voice prefs)
 * 2. Builds the system prompt with the Kindred Identity Framework
 * 3. Calls Claude API with Haiku (cost-efficient)
 * 4. Detects voice adaptation triggers (Betty says "what?", "slow down", etc.)
 * 5. Returns { text, intent, shouldSpeak, voiceAdjustments, showVolumeControl }
 */
async function handleKindredMessage(transcript, careRecipientId, conversationId) {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    console.error("[Kindred] ANTHROPIC_API_KEY not set");
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
    // The companion speaks in the voice owner's voice, so it should use
    // the name the voice owner uses — a son calls her "Mom", not "Betty".
    // TODO: make this configurable per care recipient (e.g. "Mom", "Mama", "Mother", first name)
    const careRecipientFormalName = careContext.recipient.first_name || "Mom";
    const careRecipientName = careContext.recipient.called_by || "Mom";

    // Build system prompt with care context
    const systemPrompt = buildKindredPrompt(careContext, voiceOwnerName, careRecipientName, careRecipientFormalName);

    // Call Claude API
    const responseText = await callClaudeChat(
      apiKey,
      systemPrompt,
      [{ role: "user", content: transcript }],
      150  // Short responses — 1-2 sentences for dementia care
    );

    // Detect distress or escalation intent
    let intent = "conversation";
    let shouldEscalate = false;
    let relayMessage = null;

    if (
      responseText.toLowerCase().includes("concerned") ||
      responseText.toLowerCase().includes("alert") ||
      responseText.toLowerCase().includes("escalate")
    ) {
      intent = "distress_alert";
      shouldEscalate = true;
    }

    // Detect message relay intent — Betty asking Kindred to tell someone something
    const lowerTranscript = (transcript || "").toLowerCase();
    const relayPatterns = [
      /(?:tell|ask|let|remind|message)\s+(\w+)/i,
      /(?:can you|could you|please)\s+(?:tell|ask|let|remind|message)\s+(\w+)/i,
      /(?:i need|i want)\s+(?:to talk to|to see|to tell)\s+(\w+)/i,
      /(?:call|get)\s+(\w+)\s+(?:for me|please)/i,
    ];
    const relayKeywords = ["tell", "ask", "let know", "remind", "message", "call", "need him", "need her", "get him", "get her", "talk to"];
    const hasRelayIntent = relayKeywords.some(kw => lowerTranscript.includes(kw));

    if (hasRelayIntent) {
      // Extract who Betty is trying to reach and what she wants to say
      let targetName = null;
      for (const pattern of relayPatterns) {
        const match = transcript.match(pattern);
        if (match?.[1]) {
          targetName = match[1];
          break;
        }
      }
      // Default to voice owner (Pete) if no specific name detected
      targetName = targetName || voiceOwnerName;
      relayMessage = {
        target: targetName,
        originalMessage: transcript,
        recipientName: careRecipientFormalName,
      };
      intent = "relay_message";
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
    await storeKindredMessage(careRecipientId, conversationId, transcript, responseText, intent);

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
        console.error("[Kindred] Error logging escalation:", err.message);
      }
    }

    return {
      text: responseText,
      intent,
      shouldSpeak: true,
      voiceAdjustments,
      shouldEscalate,
      relayMessage,
    };
  } catch (err) {
    console.error("[Kindred] Unhandled error:", err.message);
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
  handleKindredMessage,
  buildKindredPrompt,
  detectVoiceAdaptation,
  loadCareContext,
  saveVoicePreferences,
};
