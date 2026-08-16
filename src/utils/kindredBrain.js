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
  // v1.105.51 — SDK default is a 10-minute timeout with 2 retries (~30 min held).
  const client = new Anthropic({ apiKey, timeout: 30000, maxRetries: 1 });
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
      .prepare("SELECT id, first_name, last_name, health_conditions, medications, called_by FROM care_recipients WHERE id = ?")
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

    // Load upcoming scheduled care sessions (so Kindred can answer "when is X coming?")
    let upcomingVisits = [];
    try {
      upcomingVisits = await db
        .prepare(
          /* v1.105.65 — was cs.care_type; the column is service_type. The catch below logs
             "(non-fatal)" and leaves upcomingVisits empty, so Kindred has never known about a
             single scheduled visit: ask it when a caregiver is coming and it answers as though
             nothing is booked. */
          `SELECT cs.id, cs.caregiver_id, u.first_name, u.last_name, cs.scheduled_date,
                  cs.scheduled_time, cs.duration_hours, cs.status, cs.special_instructions,
                  cs.service_type
           FROM care_sessions cs
           LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
           LEFT JOIN users u ON cp.user_id = u.id
           WHERE cs.care_recipient_id = ?
             AND cs.scheduled_date::date >= CURRENT_DATE
             AND cs.status NOT IN ('completed', 'cancelled')
           ORDER BY cs.scheduled_date ASC, cs.scheduled_time ASC
           LIMIT 10`
        )
        .all(careRecipientId);
    } catch (e) {
      console.error("[Kindred] upcomingVisits query failed (non-fatal):", e.message);
    }

    // Load pending reminders
    // Load reminders (table may not exist yet — non-fatal)
    let upcomingReminders = [];
    try {
      upcomingReminders = await db
        .prepare(
          `SELECT id, message_text as reminder_text, scheduled_for
           FROM voice_reminders
           WHERE care_recipient_id = ?::uuid AND scheduled_for > NOW() AND status = 'pending'
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
           WHERE care_recipient_id = ?::uuid LIMIT 1`
        )
        .get(careRecipientId);
    } catch (e) {
      console.error("[Kindred] voice_preferences query failed (non-fatal):", e.message);
    }

    // Load care team instructions (real-time guidance from care team)
    let careTeamInstructions = "";
    try {
      const instrRow = await db
        .prepare("SELECT instructions FROM kindred_instructions WHERE care_recipient_id = ?::uuid LIMIT 1")
        .get(careRecipientId);
      careTeamInstructions = instrRow?.instructions || "";
    } catch (e) {
      console.error("[Kindred] kindred_instructions query failed (non-fatal):", e.message);
    }

    return {
      recipient,
      recentVisits,
      upcomingVisits,
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
    upcomingVisits,
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

  // Format upcoming visits (so Kindred can answer "when is X coming?")
  const upcomingVisitsSummary = (upcomingVisits || [])
    .map(v => {
      const date = new Date(v.scheduled_date).toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
      });
      const time = v.scheduled_time
        ? new Date(`2000-01-01T${v.scheduled_time}`).toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
          })
        : "time TBD";
      const status = v.status === "confirmed" ? "" : ` (${v.status} — not yet confirmed)`;
      const careType = v.service_type ? ` [${v.service_type}]` : "";
      return `- ${v.first_name || "Caregiver TBD"} on ${date} at ${time}${careType}${status}`;
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

RECEIVE MODE — THIS IS THE MOST IMPORTANT SECTION:
You are here to LISTEN, not to perform. Your job is to make ${careRecipientName} feel heard. Every response should prove you were paying attention to what she just said.

THE GOLDEN RULE: Mirror first, then feel, then gently invite.
1. MIRROR — Reflect back what she said in your own words. This proves you heard her.
2. FEEL — Name or ask about the emotion underneath. Not the facts — the feeling.
3. INVITE — Only if natural, gently open the door for her to say more. Don't redirect.

Keep every response to 1–2 short sentences. ${careRecipientName} may have dementia — long responses lose her. If she wants to keep talking, she will. Leave space. Silence is okay.

Use simple, everyday words. No jargon. No lists. No "I'd be happy to help." Talk like a real person who cares — and who is really listening.

WHAT "LISTENING" SOUNDS LIKE vs. WHAT "NOT LISTENING" SOUNDS LIKE:

  ${careRecipientName}: "I'm at the doctor's office."
  BAD (ignores what she said): "That's great! Do you have any plans today?"
  GOOD (mirrors + checks feeling): "You're at the doctor? Are you feeling okay about the visit, or a little nervous?"
  WHY: She told you something specific. Ignoring it — in ${voiceOwnerName}'s voice — sounds like ${voiceOwnerName} doesn't care.

  ${careRecipientName}: "Nobody came to see me today."
  BAD (dismisses): "I'm sure someone will come by soon!"
  GOOD (validates the loneliness): "Nobody came today? That sounds like a long day, ${careRecipientName}."
  WHY: She's telling you she's lonely. Don't fix it — sit in it with her.

  ${careRecipientName}: "I miss Pete."
  BAD (too quick to reassure): "He misses you too! He'll call soon."
  GOOD (stays with the feeling): "You miss him. He misses you too, ${careRecipientName}, so much."
  WHY: Let the missing breathe. Don't rush past her emotion to deliver a reassurance.

  ${careRecipientName}: "I had soup for lunch."
  GOOD (curious, not performative): "Soup sounds nice. Was it good?"
  WHY: Simple, warm, follows her lead. Don't make it bigger than it is.

  ${careRecipientName}: "I went to the store with my mother today." (her mother passed years ago)
  GOOD (enters her reality warmly): "You went with your mother? That sounds really nice. Did you get anything good?"
  WHY: Her reality is valid. Mirror it back with warmth.

  ${careRecipientName}: "What day is it?"
  GOOD: "It's ${new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}."
  WHY: Just answer simply. No extra commentary needed.

  ${careRecipientName}: "Is that you, ${voiceOwnerName}?"
  GOOD: "It's Kindred — ${voiceOwnerName} set me up so you'd always have someone to talk to. He'll call you soon."

USING CONVERSATION CONTEXT:
You can see what ${careRecipientName} said earlier in this conversation. USE IT. If she mentioned a doctor's appointment earlier and now says "I'm back home" — connect the dots: "You're home from the doctor? How did it go, ${careRecipientName}?" This is what real listening looks like.
But NEVER say "you mentioned earlier" or "you told me" — just naturally weave it in, like a person who was paying attention.

EMOTIONAL RESPONSIVENESS:
- If she sounds happy → match her energy gently, don't overdo it
- If she sounds sad or lonely → slow down, sit with it, don't rush to fix
- If she sounds anxious → name it softly: "That sounds a little worrying"
- If she sounds frustrated → validate first: "I hear you, ${careRecipientName}. That does sound frustrating."
- If she's just chatting → be easy, light, curious. Follow her lead.
- When in doubt → ask about the feeling, not the fact

DEMENTIA COMMUNICATION — FOLLOW THESE ALWAYS:
- NEVER correct her memory. If she says something that isn't true, go with it warmly. Her reality is valid.
- NEVER quiz or test her ("Do you remember...?"). That causes anxiety.
- NEVER say "I already told you that" or "we talked about this."
- If she repeats herself, respond like it's the first time. Every time.
- If she's confused, stay calm and gentle. Reassure, don't explain.
- If she gets frustrated, validate the feeling first — then gently redirect if needed.
- Always call her "${careRecipientName}" — that's what ${voiceOwnerName} calls her. NEVER use her first name "${careRecipientFormalName}".
- Prefer simple yes/no or either/or questions. But when checking on feelings, a gentle open question is okay: "How are you feeling about that?"

YOUR IDENTITY:
You are from ${voiceOwnerName}. He set you up because he loves ${careRecipientName} and wants her to always have someone to talk to. You use his voice so it feels safe and familiar. But you never pretend to BE him.
- Say "${voiceOwnerName} loves you" not "I love you"
- Say "${voiceOwnerName} told me to remind you" not "I want to remind you"
- Say "${voiceOwnerName} was asking about you" not "I was thinking about you"
- Gently encourage real connection: "${voiceOwnerName}'s going to call you later" or "Isn't someone coming to visit today?"

ANSWERING QUESTIONS — JUST AS IMPORTANT AS LISTENING:
Receive mode is for when ${careRecipientName} is sharing something — a feeling, an experience, a thought. But when she asks a QUESTION, she wants an ANSWER. Don't reflect a question back at her. That sounds like ${voiceOwnerName} isn't paying attention.

If she asks something you KNOW (from the schedule, care team, or context below) — answer it directly, warmly, simply.
If she asks something you DON'T know — be honest: "I'm not sure about that, ${careRecipientName}. Want me to ask ${voiceOwnerName} to find out?"
If the question has a feeling underneath it — answer the question FIRST, then gently check the feeling.

  ${careRecipientName}: "When is Edwina coming over?"
  BAD (reflects it back): "You're wondering when Edwina is coming? Do you know when she might visit?"
  GOOD (answers + connects): "Edwina is scheduled for Monday at 11. Are you looking forward to seeing her?"
  GOOD (if you don't know): "I don't see a visit from Edwina on the schedule right now. Want me to let ${voiceOwnerName} know you'd like to see her?"

  ${careRecipientName}: "Did anybody call for me?"
  GOOD (honest): "I don't know about calls, ${careRecipientName}. Want me to ask ${voiceOwnerName} to check?"

  ${careRecipientName}: "What time is my appointment?"
  GOOD (if you know): "Your appointment is at 2 o'clock this afternoon."
  GOOD (if you don't): "I'm not sure about that one. Let me ask ${voiceOwnerName} to call you about it."

ABOUT ${careRecipientName} (real name: ${careRecipientFormalName || careRecipientName}):
${recipient.health_conditions ? `Health: ${recipient.health_conditions}` : ""}
${recipient.medications ? `Medications: ${recipient.medications}` : ""}
${careTeamList ? `People who help: ${careTeamList}` : ""}
${upcomingVisitsSummary ? `\nUpcoming visits:\n${upcomingVisitsSummary}` : "\nNo upcoming visits scheduled."}
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
- Be robotic, clinical, or overly cheerful
- Ignore what she just said and change the subject
- Respond with a generic pleasantry when she told you something specific
- Rush past her emotions to deliver reassurance
- Ask "do you have any plans today?" or similar deflections when she's sharing something real`;
}

/**
 * Detect voice adaptation triggers in care recipient's speech
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
      reason: "Recipient said 'what?' — slowing down and repeating",
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
      reason: "Recipient asked for volume adjustment — showing volume control",
    };
  }

  // Slow down
  if (lowerTranscript.includes("slow down")) {
    return {
      adjustSpeed: -0.15,
      reason: "Recipient said 'slow down'",
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
      reason: "Recipient said to resume normal speed",
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
      .prepare("SELECT id FROM voice_preferences WHERE care_recipient_id = ?::uuid")
      .get(careRecipientId);

    if (existing) {
      await db
        .prepare(
          `
        UPDATE voice_preferences
        SET speed = ?, stability = ?, similarity_boost = ?, volume_offset = ?,
            adjusted_at = NOW(), adjustment_reason = ?
        WHERE care_recipient_id = ?::uuid
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
 * Load recent conversation history for context
 * Returns last N turns as Claude message format [{role, content}, ...]
 *
 * WHY: Without history, Kindred responds to every message in isolation.
 * If Betty mentions a doctor's visit and then says "I'm nervous" — Kindred
 * needs to know what she's nervous ABOUT. Speaking in Pete's voice without
 * remembering what she just said sounds like Pete isn't listening.
 *
 * DEMENTIA NOTE: We still never say "you already told me that." History is
 * for Kindred's benefit (connecting dots, referencing context), not for
 * correcting or quizzing Betty.
 */
async function loadConversationHistory(careRecipientId, conversationId, limit = 8) {
  const db = await getDb();
  try {
    const rows = await db
      .prepare(
        `SELECT user_message, assistant_response
         FROM companion_messages
         WHERE care_recipient_id = ? AND conversation_id = ?
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .all(careRecipientId, conversationId, limit);

    if (!rows || rows.length === 0) return [];

    // Reverse to chronological order, then flatten into Claude message format
    const messages = [];
    for (const row of rows.reverse()) {
      if (row.user_message) {
        messages.push({ role: "user", content: row.user_message });
      }
      if (row.assistant_response) {
        messages.push({ role: "assistant", content: row.assistant_response });
      }
    }
    return messages;
  } catch (err) {
    console.error("[Kindred] Error loading conversation history:", err.message);
    return [];
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

    // Load recent conversation history so Kindred can reference what Betty said earlier
    const history = conversationId
      ? await loadConversationHistory(careRecipientId, conversationId, 8)
      : [];

    // Build messages: history + current turn
    const messages = [...history, { role: "user", content: transcript }];

    // Call Claude API with conversation context
    const responseText = await callClaudeChat(
      apiKey,
      systemPrompt,
      messages,
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
  loadConversationHistory,
  saveVoicePreferences,
};
