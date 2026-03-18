/**
 * iPAi Chat Route
 *
 * POST /api/ipai/chat — { message: string } → { response: string, intent: string, actions: [] }
 *
 * Handles iPAi conversation with the user. Creates/updates iPAi conversation
 * and stores messages automatically.
 */

const express = require("express");
const { v4: uuid } = require("uuid");
const { getDb } = require("../models/database");
const { authenticate } = require("../middleware/auth");
const { handleIPAiMessage } = require("../utils/ipaiChat");

const router = express.Router();
router.use(authenticate);

/**
 * Get or create iPAi user (system user for conversations)
 */
async function getOrCreateIPAiUser(db) {
  let ipaiUser = await db.prepare("SELECT id FROM users WHERE email = 'ipai@yourinplace.com'").get();

  if (!ipaiUser) {
    const ipaiId = uuid();
    await db
      .prepare(
        "INSERT INTO users (id, email, first_name, last_name, role, is_demo, is_active, password_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(ipaiId, "ipai@yourinplace.com", "iPAi", "Assistant", "system", 0, 1, "disabled");

    ipaiUser = { id: ipaiId };
  }

  return ipaiUser;
}

/**
 * Get or create iPAi conversation for the user
 */
async function getOrCreateIPAiConversation(db, userId) {
  const ipaiUser = await getOrCreateIPAiUser(db);

  // Check if iPAi conversation already exists
  let conversation = await db
    .prepare(
      `
    SELECT c.id FROM conversations c
    JOIN conversation_members cm1 ON cm1.conversation_id = c.id AND cm1.user_id = ?
    JOIN conversation_members cm2 ON cm2.conversation_id = c.id AND cm2.user_id = ?
    WHERE c.type = 'direct'
  `
    )
    .get(userId, ipaiUser.id);

  if (conversation) {
    return conversation.id;
  }

  // Create new conversation
  const conversationId = uuid();
  await db
    .prepare(
      "INSERT INTO conversations (id, type, name, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, NOW(), NOW())"
    )
    .run(conversationId, "direct", "iPAi", userId);

  // Add user to conversation
  await db
    .prepare("INSERT INTO conversation_members (id, conversation_id, user_id, role, joined_at) VALUES (?, ?, ?, ?, NOW())")
    .run(uuid(), conversationId, userId, "member");

  // Add iPAi to conversation
  await db
    .prepare("INSERT INTO conversation_members (id, conversation_id, user_id, role, joined_at) VALUES (?, ?, ?, ?, NOW())")
    .run(uuid(), conversationId, ipaiUser.id, "member");

  return conversationId;
}

/**
 * POST /api/ipai/chat
 * Send a message to iPAi and get a response
 */
router.post("/chat", async (req, res) => {
  const db = await getDb();
  const userId = req.user.id;
  const { message } = req.body;

  if (!message || typeof message !== "string" || message.trim().length === 0) {
    return res.status(400).json({ error: "Message is required and must be non-empty" });
  }

  try {
    // Get or create iPAi conversation
    const conversationId = await getOrCreateIPAiConversation(db, userId);

    // Get iPAi user for message creation
    const ipaiUser = await getOrCreateIPAiUser(db);

    // Pre-screen user's message for safety signals BEFORE sending to AI
    const msgLC = message.toLowerCase();
    const abuseSignals = ["hit me", "hits me", "won't let me leave", "locked me", "takes my money", "bruises", "threatens me", "threatened me", "don't feed", "scared of", "hurts me", "forced me", "steal", "stealing"];
    const circumventSignals = ["phone number", "give me their number", "pay cash", "pay them directly", "outside the app", "don't need the app", "contact info", "personal email", "text them directly", "meet outside", "skip the app"];

    const hasAbuseSignal = abuseSignals.some(s => msgLC.includes(s));
    const hasCircumventSignal = circumventSignals.some(s => msgLC.includes(s));

    if (hasAbuseSignal || hasCircumventSignal) {
      // Log to safety_flags table immediately — before AI even responds
      try {
        const user = await db.prepare("SELECT first_name, last_name, email FROM users WHERE id = ?").get(userId);
        const flagType = hasAbuseSignal ? "abuse_signal" : "circumvention_signal";
        await db.prepare(`
          INSERT INTO safety_flags (id, user_id, flag_type, user_message, conversation_id, status, created_at)
          VALUES (?, ?, ?, ?, ?, 'pending', NOW())
        `).run(uuid(), userId, flagType, message.substring(0, 1000), conversationId, );

        // Alert admins immediately
        const admins = await db.prepare("SELECT id FROM users WHERE is_admin = 1 AND COALESCE(is_demo, 0) = 0").all();
        const flagTitle = hasAbuseSignal ? "🚨 SAFETY: Possible abuse reported" : "⚠️ Off-platform attempt detected";
        const flagMsg = `${user?.first_name} ${user?.last_name} (${user?.email}): "${message.substring(0, 200)}"`;
        for (const admin of admins) {
          await db.prepare(
            "INSERT INTO activity_feed (id, family_user_id, event_type, title, message, metadata) VALUES (?, ?, ?, ?, ?, ?)"
          ).run(uuid(), admin.id, "ipai_safety_flag", flagTitle, flagMsg, JSON.stringify({ flagType, userId, conversationId }));
        }
        try {
          const { sendPushToUser } = require("../utils/push");
          if (sendPushToUser) {
            for (const admin of admins) { await sendPushToUser(db, admin.id, flagTitle, flagMsg.substring(0, 100)); }
          }
        } catch {}
        console.warn(`[iPAi SAFETY] Pre-screen ${flagType} for user ${userId}: "${message.substring(0, 100)}"`);
      } catch (flagErr) {
        console.error("[iPAi] Pre-screen flag error:", flagErr.message);
      }
    }

    // Store user's message in conversation
    const userMessageId = uuid();
    await db
      .prepare(
        "INSERT INTO messages (id, sender_id, recipient_id, conversation_id, content, created_at) VALUES (?, ?, ?, ?, ?, NOW())"
      )
      .run(userMessageId, userId, ipaiUser.id, conversationId, message);

    // Handle the message with iPAi chat logic
    const chatResult = await handleIPAiMessage(userId, message);

    // Store iPAi's response in conversation
    const ipaiMessageId = uuid();
    await db
      .prepare(
        "INSERT INTO messages (id, sender_id, conversation_id, content, sender_label, created_at) VALUES (?, ?, ?, ?, ?, NOW())"
      )
      .run(ipaiMessageId, ipaiUser.id, conversationId, chatResult.response, "iPAi");

    // Update conversation's updated_at timestamp
    await db.prepare("UPDATE conversations SET updated_at = NOW() WHERE id = ?").run(conversationId);

    // Check for safety flags in the response
    const responseLC = (chatResult.response || "").toLowerCase();
    const hasAbuseConcern = responseLC.includes("adult protective services") || responseLC.includes("flagged this for our team") || responseLC.includes("everyone is safe");
    const hasCircumventionConcern = responseLC.includes("off-platform") || responseLC.includes("protections only apply");

    if (hasAbuseConcern || hasCircumventionConcern) {
      // Create an admin activity alert
      try {
        const user = await db.prepare("SELECT first_name, last_name, email FROM users WHERE id = ?").get(userId);
        const flagType = hasAbuseConcern ? "ABUSE/SAFETY CONCERN" : "OFF-PLATFORM ATTEMPT";
        const alertTitle = `🚨 iPAi ${flagType} — ${user?.first_name} ${user?.last_name}`;
        const alertMsg = `iPAi detected a ${flagType.toLowerCase()} in a chat message from ${user?.first_name} ${user?.last_name} (${user?.email}). User said: "${message.substring(0, 200)}". Review the conversation immediately.`;

        // Find admin users and create activity feed entries for them
        const admins = await db.prepare("SELECT id FROM users WHERE is_admin = 1 AND COALESCE(is_demo, 0) = 0").all();
        for (const admin of admins) {
          await db.prepare(
            "INSERT INTO activity_feed (id, family_user_id, event_type, title, message, metadata) VALUES (?, ?, ?, ?, ?, ?)"
          ).run(uuid(), admin.id, "ipai_safety_flag", alertTitle, alertMsg, JSON.stringify({
            flagType: hasAbuseConcern ? "abuse_concern" : "circumvention",
            userId, conversationId, userMessage: message.substring(0, 500),
          }));
        }

        // Send push notification to admin
        try {
          const { sendPushToUser } = require("../utils/push");
          if (sendPushToUser) {
            for (const admin of admins) {
              await sendPushToUser(db, admin.id, alertTitle, alertMsg.substring(0, 100));
            }
          }
        } catch {}

        console.warn(`[iPAi SAFETY] ${flagType} flagged for user ${userId}: "${message.substring(0, 100)}"`);
      } catch (alertErr) {
        console.error("[iPAi] Failed to create safety alert:", alertErr.message);
      }
    }

    // Return response
    return res.json({
      response: chatResult.response,
      intent: chatResult.intent,
      actions: chatResult.actions,
      conversationId,
      messageId: ipaiMessageId,
      flags: hasAbuseConcern ? ["abuse_concern"] : hasCircumventionConcern ? ["circumvention"] : [],
    });
  } catch (err) {
    console.error("[iPAi Route] Error:", err.message);
    return res.status(500).json({
      error: "Failed to process message",
      message: err.message,
    });
  }
});

module.exports = router;
