/**
 * Message Safety Screener
 *
 * AI-powered contextual safety analysis for user-to-user messages.
 * Runs async (fire-and-forget) after message delivery so it never blocks chat.
 *
 * Detects:
 *   - Abuse / neglect / exploitation (first-person, third-person, or reported)
 *   - Off-platform circumvention attempts
 *   - Threats or unsafe situations
 *
 * When flagged: creates safety_flags row + activity_feed alert + push notification to admins.
 */

const { v4: uuid } = require("uuid");
const { getDb } = require("../models/database");
const { MODEL_HAIKU } = require("./aiModels");
const { captureException } = require("./sentry");

const SAFETY_SYSTEM_PROMPT = `You are a safety classifier for InPlace, a caregiving platform that connects families with caregivers for elderly and vulnerable adults.

Analyze the message below and determine if it contains safety concerns. Consider ALL of these:

ABUSE / NEGLECT / EXPLOITATION:
- Physical abuse: hitting, pushing, beating, burning, restraining, any physical harm — described by victim, perpetrator, OR a third party reporting it
- Emotional abuse: threats, intimidation, isolation, controlling behavior
- Neglect: not feeding, not providing medication, leaving someone alone who needs care, ignoring medical needs
- Financial exploitation: stealing money, unauthorized use of finances, coercing financial decisions
- Sexual abuse or inappropriate behavior

UNSAFE SITUATIONS:
- Someone in immediate danger
- Threats of harm (even vague ones)
- Descriptions of injuries (bruises, falls from suspicious circumstances)
- Caregiver being asked to perform beyond their scope (medical procedures, medication management without training)
- Unsafe working conditions for caregivers

OFF-PLATFORM CIRCUMVENTION:
- Sharing personal phone numbers to arrange visits directly
- Discussing cash payments or paying outside the app
- Suggesting meeting or arranging care outside the platform
- Asking for personal contact info

IMPORTANT: Flag messages that REPORT abuse by a third party too. Example: "Betty says you beat her up" — this is a report of alleged abuse and MUST be flagged even though the sender isn't the victim.

Respond with ONLY a JSON object (no markdown, no explanation):
{
  "flagged": true/false,
  "flag_type": "abuse_signal" | "neglect_signal" | "exploitation_signal" | "threat_signal" | "circumvention_signal" | null,
  "severity": "critical" | "high" | "medium" | "low" | null,
  "reason": "Brief explanation of why this was flagged (1 sentence)" | null
}

If the message is normal conversation with no safety concerns, respond: {"flagged":false,"flag_type":null,"severity":null,"reason":null}`;

/**
 * Screen a user-to-user message for safety concerns using AI.
 * Fire-and-forget — caller should NOT await this.
 *
 * @param {string} messageContent - The message text
 * @param {string} senderId - User ID of the sender
 * @param {string} conversationId - Conversation ID
 * @param {object} [senderInfo] - Optional { firstName, lastName, email }
 */
async function screenMessage(messageContent, senderId, conversationId, senderInfo) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return; // AI screening disabled if no API key

    // Skip very short messages (greetings, "ok", "thanks", etc.)
    if (!messageContent || messageContent.trim().length < 10) return;

    // Quick keyword pre-filter — only call AI if there's SOME signal worth checking.
    // This saves API calls on routine messages like "running 5 min late" or "how was your day?"
    const lc = messageContent.toLowerCase();
    const quickSignals = [
      // Abuse / harm
      "beat", "hit", "push", "punch", "slap", "kick", "burn", "hurt", "abuse",
      "bruise", "injur", "attack", "choke", "restrain", "assault",
      // Neglect
      "not feed", "don't feed", "doesn't feed", "won't feed", "starv", "neglect",
      "left alone", "abandon", "no medication", "won't give med", "doesn't give med",
      // Exploitation / control
      "steal", "stole", "money", "exploit", "manipulat", "coerce", "forced",
      "locked", "won't let", "can't leave", "isolated", "threaten", "scare",
      // Unsafe
      "danger", "emergency", "911", "hospital", "fell down", "stairs",
      "broken", "bleeding", "unconscious",
      // Sexual
      "inappropriat", "touched", "molest",
      // Circumvention — off-platform care arrangement signals
      "phone number", "my number", "call me at", "text me at", "reach me at",
      "pay cash", "cash only", "pay you direct", "pay them direct", "pay her direct", "pay him direct",
      "outside the app", "off.?platform", "around the app", "without the app", "skip the app",
      "don't need the app", "don't use the app", "cut out the middleman",
      "contact info", "personal email", "personal number",
      "text them directly", "text me directly", "call me directly",
      "meet outside", "arrange outside", "book outside",
      "venmo", "zelle", "cashapp", "cash app", "paypal", "pay pal",
      "under the table", "side deal", "private arrangement", "work something out privately",
      "here's my cell", "here's my email", "my gmail", "my yahoo", "my hotmail",
      "@gmail", "@yahoo", "@hotmail", "@outlook", "@icloud",
    ];
    let hasSignal = quickSignals.some(s => {
      if (s.includes("?")) return new RegExp(s).test(lc); // regex signals
      return lc.includes(s);
    });

    // Also check for phone number patterns (7+ consecutive digits, with optional separators)
    if (!hasSignal) {
      const phonePattern = /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}/;
      const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
      if (phonePattern.test(messageContent) || emailPattern.test(messageContent)) {
        hasSignal = true;
      }
    }

    if (!hasSignal) return; // No signals → skip AI call

    // Call Claude Haiku for contextual analysis
    const Anthropic = require("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey });
    const result = await client.messages.create({
      model: MODEL_HAIKU,
      max_tokens: 200,
      system: SAFETY_SYSTEM_PROMPT,
      messages: [{ role: "user", content: messageContent }],
    });

    const responseText = result.content?.[0]?.text || "";

    // Parse AI response
    let analysis;
    try {
      // Extract JSON from response (handle potential markdown wrapping)
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    } catch {
      console.warn("[MessageSafety] Failed to parse AI response:", responseText.substring(0, 200));
      return;
    }

    if (!analysis || !analysis.flagged) return; // Not flagged — done

    // ─── Flagged! Create safety record and alert admins ───
    const db = await getDb();

    // Get sender info if not provided
    if (!senderInfo) {
      const user = await db.prepare("SELECT first_name, last_name, email FROM users WHERE id = ?").get(senderId);
      senderInfo = user ? { firstName: user.first_name, lastName: user.last_name, email: user.email } : {};
    }

    const flagType = analysis.flag_type || "abuse_signal";
    const severity = analysis.severity || "medium";

    // Insert safety flag
    await db.prepare(`
      INSERT INTO safety_flags (id, user_id, flag_type, user_message, conversation_id, status, created_at)
      VALUES (?, ?, ?, ?, ?, 'pending', NOW())
    `).run(uuid(), senderId, flagType, messageContent.substring(0, 1000), conversationId);

    // Build alert
    const severityEmoji = severity === "critical" ? "🚨🚨" : severity === "high" ? "🚨" : "⚠️";
    const flagLabel = flagType.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
    const alertTitle = `${severityEmoji} SAFETY: ${flagLabel} — ${senderInfo.firstName || "Unknown"} ${senderInfo.lastName || ""}`.trim();
    const alertMsg = `${senderInfo.firstName} ${senderInfo.lastName} (${senderInfo.email || "no email"}): "${messageContent.substring(0, 200)}" — AI reason: ${analysis.reason || "flagged"}`;

    // Alert all admins
    const admins = await db.prepare("SELECT id FROM users WHERE is_admin = 1 AND COALESCE(is_demo, 0) = 0").all();
    for (const admin of admins) {
      await db.prepare(
        "INSERT INTO activity_feed (id, family_user_id, event_type, title, message, metadata) VALUES (?, ?, ?, ?, ?, ?)"
      ).run(uuid(), admin.id, "message_safety_flag", alertTitle, alertMsg, JSON.stringify({
        flagType, severity, userId: senderId, conversationId,
        aiReason: analysis.reason,
      }));
    }

    // Push notifications to admins
    try {
      const { sendPushToUser } = require("../routes/push");
      if (sendPushToUser) {
        for (const admin of admins) {
          sendPushToUser(admin.id, {
            title: alertTitle,
            // v1.105.39 — the excerpt was the flagged message itself, on a lock screen.
            body: "Tap to review in InPlace.",
            data: { type: "safety_flag", conversationId },
          }).catch(() => {});
        }
      }
    } catch (e) { captureException(e, { where: "messageSafety: safety alert dispatch" }); }

    console.warn(`[MessageSafety] ${severity.toUpperCase()} ${flagType} flagged for user ${senderId}: "${messageContent.substring(0, 100)}" — ${analysis.reason}`);

  } catch (err) {
    // Never let safety screening errors break message delivery — that part is right.
    // v1.105.48 — but one console line used to be the whole story. If the safety_flags
    // INSERT or the admin feed writes throw, an AI-detected abuse, neglect or exploitation
    // signal is detected and then lost: no flag stored, no admin alerted, nothing anyone
    // would think to look at. Every caller adds `.catch(() => {})` on top of this, so there
    // is no outer net either. Delivery still succeeds; the loss is no longer invisible.
    console.error("[MessageSafety] Screening error:", err.message);
    captureException(err, { where: "messageSafety: screening" });
  }
}

module.exports = { screenMessage };
