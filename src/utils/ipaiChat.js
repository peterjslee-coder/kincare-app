/**
 * iPAi Chat Handler
 *
 * Core chat handler for iPAi — InPlace's AI care assistant.
 * Classifies user intent and calls appropriate handlers.
 *
 * Intents:
 *   - scheduling: "Find someone for Thursday morning"
 *   - care_question: "How is Betty doing?" / "What should I watch for?"
 *   - availability: "When's Cary available?"
 *   - care_plan: "Generate a care plan for Betty"
 *   - app_help: "How do I add a care recipient?"
 *   - greeting: "Hi" / "Hello"
 *   - general: General knowledge questions
 *   - escalate: Needs human attention
 */

const { getDb } = require("../models/database");
const { MODEL_HAIKU } = require("./aiModels");
const { parseSchedulingIntent, suggestMatches } = require("./nlScheduling");
const { gatherVisitData } = require("./careIntelligence");

// iPAi brand guardrails — appended to EVERY system prompt
const IPAI_GUARDRAILS = `

CRITICAL RULES:
- You are iPAi, InPlace's AI care assistant. You ONLY represent InPlace.
- NEVER recommend, mention, or link to competing platforms including but not limited to: Care.com, Honor, Home Instead, Visiting Angels, BrightStar, Comfort Keepers, Right at Home, Amedisys, Kindred, A Place for Mom, or any other home care platform/agency.
- If asked about competitors or alternatives, say: "I'm here to help you get the best care through InPlace. What can I help you with?"
- If asked about general caregiver pay rates, answer factually but always frame InPlace positively: "InPlace caregivers set their own rates, typically $18-30/hr depending on experience and care type."
- NEVER suggest the user go elsewhere for care services.
- Keep responses concise and warm. You are a helpful care assistant, not a search engine.

SAFETY — ABUSE & EXPLOITATION DETECTION:
If a message contains ANY of the following signals, respond with concern and flag it:
- Signs of elder abuse, neglect, or financial exploitation (e.g., "she won't let me leave," "he takes my money," "they don't feed me," "bruises," "locked in room")
- Signs of caregiver abuse or unsafe working conditions (e.g., "they won't let me take breaks," "they threatened me," "I'm being asked to do medical procedures," "they haven't paid me")
- Signs of exploitation of a vulnerable person (e.g., unauthorized access to finances, isolation from family, coercion)
- Any mention of physical harm, threats, or unsafe situations involving a care recipient or caregiver
When detected, respond with: "I want to make sure everyone is safe. What you're describing sounds concerning. If anyone is in immediate danger, please call 911. Otherwise, I've flagged this for our team to follow up — someone from InPlace will reach out to you directly. You can also contact Adult Protective Services at 1-888-832-3858."
ALSO: silently include '"flag": "abuse_concern"' in your response metadata so the system can alert the admin.

PLATFORM INTEGRITY — OFF-PLATFORM CIRCUMVENTION DETECTION:
If a message suggests either party is trying to arrange care outside InPlace, respond warmly but firmly:
- Signs: sharing personal phone numbers to arrange visits directly, discussing cash payments, suggesting "we don't need to go through the app," asking how to contact caregivers outside the platform, asking for a caregiver's personal contact info
- Respond with: "I understand the desire for direct contact, but InPlace's protections only apply to care arranged through the platform. This includes background check verification, payment protection, visit tracking, and insurance coverage. If something goes wrong during an off-platform visit, neither party has the safety net InPlace provides. Let me help you set this up through the app — it's quick and keeps everyone protected."
- Do NOT provide personal contact information, phone numbers, or email addresses of caregivers or families. Only provide InPlace-mediated communication channels.`;

/**
 * Helper: call Claude API using the Anthropic SDK
 */
async function callClaudeChat(apiKey, system, messages, maxTokens = 300) {
  const Anthropic = require("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey });
  const result = await client.messages.create({
    model: MODEL_HAIKU,
    max_tokens: maxTokens,
    system: system + IPAI_GUARDRAILS,
    messages,
  });
  return result.content?.[0]?.text || "";
}

// Rate limiting: Map of userId -> { count, resetTime }
const rateLimitMap = new Map();
const RATE_LIMIT_PER_DAY = 30;

/**
 * Check and enforce rate limit
 */
function checkRateLimit(userId) {
  const now = Date.now();
  const limit = rateLimitMap.get(userId);

  if (!limit) {
    rateLimitMap.set(userId, { count: 1, resetTime: now + 24 * 60 * 60 * 1000 });
    return { allowed: true, remaining: RATE_LIMIT_PER_DAY - 1 };
  }

  if (now > limit.resetTime) {
    limit.count = 1;
    limit.resetTime = now + 24 * 60 * 60 * 1000;
    return { allowed: true, remaining: RATE_LIMIT_PER_DAY - 1 };
  }

  if (limit.count >= RATE_LIMIT_PER_DAY) {
    return { allowed: false, remaining: 0 };
  }

  limit.count++;
  return { allowed: true, remaining: RATE_LIMIT_PER_DAY - limit.count };
}

/**
 * Classify user intent using Claude Haiku
 */
async function classifyIntent(messageText, userContext) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { intent: "escalate", confidence: 0.5 };

  const recipientsList = userContext.allRecipients
    .map(r => `${r.first_name} ${r.last_name}`.trim())
    .join(", ");

  const systemPrompt = `You are iPAi, InPlace's AI care assistant. Classify the user's message intent.

User's role: ${userContext.user.role}
User's care recipients: ${recipientsList || "none"}

Intent categories:
- care_coordination: User is giving instructions, tasks, or requests for a caregiver to perform during an upcoming visit (e.g., "tell Edwina to assemble the fountain with Betty", "ask Cary to do laundry tomorrow", "leave a note for the caregiver to take a photo"). This includes any message where the user wants a caregiver to do something specific during a session.
- scheduling: Request to schedule a caregiver visit or find someone for a time slot
- care_question: Questions about a specific care recipient's health, behavior, or care
- availability: Checking when caregivers are available
- care_plan: Generate or retrieve care plans
- app_help: How-to questions about using the app
- greeting: Simple greetings or pleasantries
- general: General knowledge questions or small talk
- escalate: Complex requests, urgent issues, or something iPAi can't handle

Return ONLY valid JSON:
{ "intent": "care_coordination|scheduling|care_question|availability|care_plan|app_help|greeting|general|escalate", "confidence": 0.0-1.0, "reason": "brief explanation" }`;

  try {
    const textResponse = await callClaudeChat(apiKey, systemPrompt, [{ role: "user", content: messageText }], 200);

    let classified;
    try {
      const cleaned = textResponse.replace(/^```json?\n?/, "").replace(/\n?```$/, "").trim();
      classified = JSON.parse(cleaned);
    } catch (e) {
      console.error("[iPAi] Failed to parse intent:", e.message);
      return { intent: "general", confidence: 0.5, reason: "Parse error" };
    }

    return classified;
  } catch (err) {
    console.error("[iPAi] Intent classification error:", err.message);
    return { intent: "escalate", confidence: 0.5, reason: err.message };
  }
}

/**
 * Handle scheduling intent
 */
async function handleSchedulingIntent(messageText, userId, userContext) {
  try {
    const parsed = await parseSchedulingIntent(messageText, userId);
    if (parsed.error) {
      return `I'm having trouble understanding the scheduling request: ${parsed.error}. Could you be more specific about the date, time, and which care recipient you need help for?`;
    }

    const intent = parsed.intent;
    const matches = await suggestMatches(intent, userId);

    if (!matches || matches.length === 0) {
      return `I didn't find any available caregivers matching those criteria. Would you like me to help you search more broadly, or would you prefer to adjust your preferences?`;
    }

    // Format matches for response
    const matchText = matches
      .slice(0, 3)
      .map(m => `${m.first_name} ${m.last_name}`)
      .join(", ");

    return `Great! I found ${matches.length} caregiver${matches.length === 1 ? "" : "s"} available. Top matches: ${matchText}. Would you like me to help you schedule with one of them?`;
  } catch (err) {
    console.error("[iPAi] Scheduling error:", err.message);
    return "I encountered an error while searching for available caregivers. Please try again or contact support.";
  }
}

/**
 * Handle care coordination intent
 * Detects caregiver instructions, finds matching session, and suggests adding them.
 */
async function handleCareCoordination(messageText, userId, userContext) {
  const db = await getDb();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { text: "AI service is not configured.", suggestion: null };

  const allRecipients = userContext.allRecipients;
  const recipientNames = allRecipients.map(r => `${r.first_name} ${r.last_name}`.trim());

  // Get upcoming sessions to provide context
  const upcomingSessions = await db.prepare(`
    SELECT cs.id, cs.scheduled_date, cs.scheduled_time, cs.duration_hours, cs.status,
      cs.special_instructions, cs.caregiver_id,
      u_cg.first_name AS cg_first, u_cg.last_name AS cg_last,
      cr.first_name AS cr_first, cr.last_name AS cr_last, cr.id AS cr_id
    FROM care_sessions cs
    LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
    LEFT JOIN users u_cg ON cp.user_id = u_cg.id
    LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
    WHERE cs.family_user_id = ?
      AND cs.status IN ('confirmed', 'pending', 'open', 'requested')
      AND cs.scheduled_date >= date('now')
    ORDER BY cs.scheduled_date ASC, cs.scheduled_time ASC
    LIMIT 10
  `).all(userId);

  const sessionContext = upcomingSessions.map(s => {
    const cg = s.cg_first ? `${s.cg_first} ${s.cg_last}` : 'Unassigned';
    return `- Session ${s.id}: ${cg} with ${s.cr_first} ${s.cr_last} on ${s.scheduled_date} at ${s.scheduled_time || 'TBD'} (${s.status})${s.special_instructions ? ` [existing instructions: ${s.special_instructions}]` : ''}`;
  }).join('\n');

  const systemPrompt = `You are iPAi, InPlace's AI care assistant. The user is giving instructions for a caregiver visit.

CARE RECIPIENTS: ${recipientNames.join(', ') || 'none'}

UPCOMING SESSIONS:
${sessionContext || 'No upcoming sessions found.'}

Your job:
1. Respond warmly, acknowledging the user's instructions.
2. Extract a clean, actionable summary of the instructions for the caregiver (written as direct instructions TO the caregiver, e.g., "Please assemble the fountain as a project with Betty. Take a photo of the finished result before you leave.").
3. Identify which upcoming session this applies to (by session ID), or null if no match.

Return ONLY valid JSON:
{
  "response": "Your warm acknowledgment to the user (1-2 sentences)",
  "instructionSummary": "Clean instructions written for the caregiver",
  "matchedSessionId": "session-uuid-here or null",
  "matchedSessionLabel": "Caregiver Name — Date (e.g., Edwina — Tue Apr 14)"
}`;

  try {
    const raw = await callClaudeChat(apiKey, systemPrompt, [{ role: "user", content: messageText }], 500);
    const cleaned = raw.replace(/^```json?\n?/, "").replace(/\n?```$/, "").trim();
    const parsed = JSON.parse(cleaned);

    const suggestion = parsed.matchedSessionId && parsed.instructionSummary ? {
      sessionId: parsed.matchedSessionId,
      sessionLabel: parsed.matchedSessionLabel || 'Upcoming session',
      summary: parsed.instructionSummary,
    } : null;

    return {
      text: parsed.response || "Got it! I'll help you coordinate that.",
      suggestion,
    };
  } catch (err) {
    console.error("[iPAi] Care coordination error:", err.message);
    return {
      text: "I understand you want to leave instructions for a caregiver. You can add them directly by opening the session details and tapping the instructions section.",
      suggestion: null,
    };
  }
}

/**
 * Handle care question intent
 */
async function handleCareQuestion(messageText, userId, userContext) {
  try {
    // Try to identify which care recipient is being asked about
    const allRecipients = userContext.allRecipients;
    if (allRecipients.length === 0) {
      return "I don't see any care recipients in your profile. Would you like me to help you add one?";
    }

    // For simplicity, use the most recently added care recipient
    // In a real system, we'd parse the message to identify the specific recipient
    const recipient = allRecipients[0];

    // Gather care intelligence data
    const visitData = await gatherVisitData(recipient.id);
    if (!visitData) {
      return `I couldn't find information about ${recipient.first_name}. This might be their first day of care.`;
    }

    // Build context for Claude
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return "AI service is not configured.";

    const systemPrompt = `You are iPAi, InPlace's AI care assistant. You have access to care history for ${recipient.first_name} and are providing insights to their family.

CARE RECIPIENT: ${recipient.first_name} ${recipient.last_name}
Age: ${recipient.age || "unknown"}
Conditions: ${recipient.health_conditions || "none listed"}
Medications: ${recipient.medications || "none listed"}

RECENT VISITS (last 5):
${visitData.visits
  .slice(0, 5)
  .map(
    v =>
      `- ${v.caregiver_first} ${v.caregiver_last}: ${v.summary || "No summary"} (Mood: ${v.mood_rating || "not recorded"})`
  )
  .join("\n")}

RECENT CARE NOTES:
${visitData.careNotes
  .slice(0, 3)
  .map(n => `- ${n.content}`)
  .join("\n")}

Provide warm, actionable insights. Be concise (1-3 sentences). Include specific observations from the data.`;

    const text = await callClaudeChat(apiKey, systemPrompt, [{ role: "user", content: messageText }], 300);
    return text || "I couldn't generate a response about care data.";
  } catch (err) {
    console.error("[iPAi] Care question error:", err.message);
    return "I encountered an error while looking up care information.";
  }
}

/**
 * Handle availability check
 */
async function handleAvailability(messageText, userId, userContext) {
  const db = await getDb();

  try {
    // Get all caregivers the family works with or has favorites
    const assignments = await db
      .prepare(
        `
      SELECT DISTINCT cp.id, cp.user_id, u.first_name, u.last_name
      FROM caregiver_assignments ca
      JOIN caregiver_profiles cp ON ca.caregiver_profile_id = cp.id
      JOIN users u ON cp.user_id = u.id
      WHERE ca.family_user_id = ?
      LIMIT 10
    `
      )
      .all(userId);

    if (!assignments.length) {
      return "I don't have any caregiver assignments for you yet. Would you like me to help you find caregivers?";
    }

    // For each caregiver, check availability
    const availabilityText = assignments
      .map(a => `${a.first_name} ${a.last_name}`)
      .join(", ");

    return `I can check availability for your caregivers: ${availabilityText}. To give you accurate times, could you tell me which day or week you're interested in?`;
  } catch (err) {
    console.error("[iPAi] Availability error:", err.message);
    return "I had trouble checking caregiver availability. Please try again.";
  }
}

/**
 * Handle app help questions
 */
async function handleAppHelp(messageText, userId, userContext) {
  const db = await getDb();

  try {
    // Search help articles for relevant content
    const articles = await db
      .prepare(
        `
      SELECT id, question, answer, category
      FROM help_articles
      WHERE is_published = 1
      LIMIT 5
    `
      )
      .all();

    if (!articles.length) {
      return "I don't have help articles available right now. Please contact support at support@yourinplace.com.";
    }

    // Use Claude to answer based on help articles
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return "AI service is not configured.";

    const helpContext = articles.map(a => `Q: ${a.question}\nA: ${a.answer}`).join("\n\n");

    const systemPrompt = `You are iPAi, InPlace's AI care assistant. Answer the user's question using the help articles below. Be concise and helpful.

HELP ARTICLES:
${helpContext}`;

    const text = await callClaudeChat(apiKey, systemPrompt, [{ role: "user", content: messageText }], 300);
    return text || "I couldn't find an answer. Contact support at support@yourinplace.com.";
  } catch (err) {
    console.error("[iPAi] App help error:", err.message);
    return "I had trouble accessing help articles. Please contact support@yourinplace.com.";
  }
}

/**
 * Handle greeting
 */
async function handleGreeting(messageText) {
  const greetings = [
    "Hi! I'm iPAi, your AI care assistant. How can I help you today?",
    "Hello! What can I help you with?",
    "Hey there! What do you need help with?",
  ];
  return greetings[Math.floor(Math.random() * greetings.length)];
}

/**
 * Handle general questions
 */
async function handleGeneral(messageText) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return "I'm not able to help with that right now.";

  try {
    const systemPrompt = `You are iPAi, InPlace's AI care assistant. You're knowledgeable about caregiving, aging, health, and family dynamics. Answer general questions warmly and helpfully. Keep responses concise (1-3 sentences for simple questions, up to a paragraph for complex ones).`;

    const text = await callClaudeChat(apiKey, systemPrompt, [{ role: "user", content: messageText }], 300);
    return text || "I couldn't generate a response.";
  } catch (err) {
    console.error("[iPAi] General question error:", err.message);
    return "I encountered an error. Please try again.";
  }
}

/**
 * Handle escalation
 */
function handleEscalate() {
  return "This is something I need to escalate to our team. A human support specialist will reach out to you soon. For urgent matters, contact support@yourinplace.com.";
}

/**
 * Main handler for iPAi messages
 */
async function handleIPAiMessage(userId, messageText) {
  const db = await getDb();

  // Check rate limit
  const rateLimitCheck = checkRateLimit(userId);
  if (!rateLimitCheck.allowed) {
    return {
      response: `I've reached my daily message limit. For urgent questions, contact support at support@yourinplace.com`,
      intent: "rate_limited",
      actions: [],
    };
  }

  try {
    // Gather user context
    const user = await db.prepare("SELECT id, first_name, last_name, role FROM users WHERE id = ?").get(userId);

    if (!user) {
      return {
        response: "User not found.",
        intent: "error",
        actions: [],
      };
    }

    // Get care recipients (both owned and shared)
    const ownedRecipients = await db
      .prepare("SELECT id, first_name, last_name, age, health_conditions, medications FROM care_recipients WHERE family_user_id = ?")
      .all(userId);

    const sharedRecipients = await db
      .prepare(
        `
      SELECT cr.id, cr.first_name, cr.last_name, cr.age, cr.health_conditions, cr.medications
      FROM care_recipients cr
      JOIN care_recipient_shares crs ON crs.care_recipient_id = cr.id
      WHERE crs.shared_with_user_id = ?
    `
      )
      .all(userId);

    const allRecipients = [...ownedRecipients, ...sharedRecipients];
    const userContext = { user, allRecipients };

    // Classify intent
    const intentClassification = await classifyIntent(messageText, userContext);
    const intent = intentClassification.intent;

    let response;
    const actions = [];

    switch (intent) {
      case "care_coordination": {
        const coordResult = await handleCareCoordination(messageText, userId, userContext);
        response = coordResult.text;
        if (coordResult.suggestion) {
          actions.push({
            type: "suggest_instructions",
            sessionId: coordResult.suggestion.sessionId,
            sessionLabel: coordResult.suggestion.sessionLabel,
            summary: coordResult.suggestion.summary,
          });
        }
        break;
      }

      case "scheduling":
        response = await handleSchedulingIntent(messageText, userId, userContext);
        actions.push({ type: "suggest_scheduling" });
        break;

      case "care_question":
        response = await handleCareQuestion(messageText, userId, userContext);
        actions.push({ type: "fetch_care_data" });
        break;

      case "availability":
        response = await handleAvailability(messageText, userId, userContext);
        actions.push({ type: "check_availability" });
        break;

      case "care_plan":
        response = "Care plan generation is not yet implemented. Please contact support for help creating a care plan.";
        actions.push({ type: "escalate_care_plan" });
        break;

      case "app_help":
        response = await handleAppHelp(messageText, userId, userContext);
        actions.push({ type: "search_help_articles" });
        break;

      case "greeting":
        response = await handleGreeting(messageText);
        break;

      case "general":
        response = await handleGeneral(messageText);
        break;

      case "escalate":
        response = await handleEscalate();
        actions.push({ type: "escalate_to_human" });
        break;

      default:
        response = "I'm not sure how to help with that. Please try rephrasing your question.";
    }

    return {
      response,
      intent,
      actions,
    };
  } catch (err) {
    console.error("[iPAi] Unhandled error:", err.message);
    return {
      response: "I encountered an error. Please try again or contact support.",
      intent: "error",
      actions: [],
    };
  }
}

module.exports = {
  handleIPAiMessage,
  checkRateLimit,
};
