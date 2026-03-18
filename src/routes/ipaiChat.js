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

    // Return response
    return res.json({
      response: chatResult.response,
      intent: chatResult.intent,
      actions: chatResult.actions,
      conversationId,
      messageId: ipaiMessageId,
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
