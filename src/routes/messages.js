const express = require("express");
const { v4: uuid } = require("uuid");
const { getDb } = require("../models/database");
const { authenticate } = require("../middleware/auth");
const { validateMessage } = require("../middleware/validate");
const { sendPushToUser } = require("./push");

const router = express.Router();
router.use(authenticate);

// GET /api/messages/conversations — list conversations for current user
router.get("/conversations", async (req, res) => {
  const db = await getDb();
  const userId = req.user.id;

  // Get all messages involving this user
  const allMessages = await db.prepare(`
    SELECT m.*,
      CASE WHEN m.sender_id = ? THEN m.recipient_id ELSE m.sender_id END AS partner_id
    FROM messages m
    WHERE m.sender_id = ? OR m.recipient_id = ?
    ORDER BY m.created_at DESC
  `).all(userId, userId, userId);

  // Build conversations from messages in JS
  const convMap = {};
  for (const m of allMessages) {
    if (!convMap[m.partner_id]) {
      convMap[m.partner_id] = { lastMessage: m.content, lastMessageAt: m.created_at, unread: 0 };
    }
    if (m.sender_id !== userId && m.recipient_id === userId && !m.is_read) {
      convMap[m.partner_id].unread++;
    }
  }

  // Fetch partner info
  const conversations = [];
  for (const [partnerId, info] of Object.entries(convMap)) {
    const partner = await db.prepare("SELECT id, first_name, last_name, role FROM users WHERE id = ?").get(partnerId);
    if (partner) {
      conversations.push({
        partnerId: partner.id,
        partnerName: `${partner.first_name} ${partner.last_name}`,
        partnerRole: partner.role,
        lastMessage: info.lastMessage,
        lastMessageAt: info.lastMessageAt,
        unreadCount: info.unread,
      });
    }
  }

  // Sort by most recent message
  conversations.sort((a, b) => (b.lastMessageAt || '').localeCompare(a.lastMessageAt || ''));

  res.json({ conversations });
});

// GET /api/messages/contacts — list users available to message
// NOTE: must be before /:partnerId to avoid route collision
router.get("/contacts", async (req, res) => {
  const db = await getDb();
  const userId = req.user.id;

  // Return all users except the current user
  const users = await db.prepare(`
    SELECT id, first_name, last_name, role FROM users WHERE id != ?
    ORDER BY first_name ASC
  `).all(userId);

  const contacts = users.map(u => ({
    id: u.id,
    name: `${u.first_name} ${u.last_name}`,
    role: u.role,
  }));

  res.json({ contacts });
});

// GET /api/messages/:partnerId — get messages with a specific user
router.get("/:partnerId", async (req, res) => {
  const db = await getDb();
  const userId = req.user.id;
  const partnerId = req.params.partnerId;

  const messages = await db.prepare(`
    SELECT m.*,
      su.first_name AS sender_first_name, su.last_name AS sender_last_name,
      ru.first_name AS recipient_first_name, ru.last_name AS recipient_last_name
    FROM messages m
    JOIN users su ON m.sender_id = su.id
    JOIN users ru ON m.recipient_id = ru.id
    WHERE (m.sender_id = ? AND m.recipient_id = ?)
       OR (m.sender_id = ? AND m.recipient_id = ?)
    ORDER BY m.created_at ASC
  `).all(userId, partnerId, partnerId, userId);

  // Mark as read
  await db.prepare(`
    UPDATE messages SET is_read = 1
    WHERE sender_id = ? AND recipient_id = ? AND is_read = 0
  `).run(partnerId, userId);

  // Add type field for frontend
  const enriched = messages.map(m => ({
    ...m,
    type: m.sender_id === userId ? 'sent' : 'received',
    senderName: `${m.sender_first_name} ${m.sender_last_name}`,
  }));

  res.json({ messages: enriched });
});

// POST /api/messages — send a message
router.post("/", validateMessage, async (req, res) => {
  const db = await getDb();
  const { recipientId, content } = req.body;

  if (!recipientId || !content) {
    return res.status(400).json({ error: "recipientId and content required" });
  }

  const id = uuid();
  await db.prepare(`
    INSERT INTO messages (id, sender_id, recipient_id, content)
    VALUES (?, ?, ?, ?)
  `).run(id, req.user.id, recipientId, content);

  const message = await db.prepare("SELECT * FROM messages WHERE id = ?").get(id);

  // Send push notification to recipient (non-blocking)
  const sender = await db.prepare("SELECT first_name, last_name FROM users WHERE id = ?").get(req.user.id);
  const senderName = sender ? `${sender.first_name} ${sender.last_name}` : "Someone";
  sendPushToUser(recipientId, {
    title: `New message from ${senderName}`,
    body: content.length > 100 ? content.substring(0, 97) + "..." : content,
    data: { type: "message", senderId: req.user.id },
  }).catch(() => {});

  // Real-time: notify recipient via WebSocket
  const emitToUser = req.app.get("emitToUser");
  if (emitToUser) {
    emitToUser(recipientId, "new_message", {
      ...message,
      senderName,
      type: "received",
    });
  }

  res.status(201).json({ message });
});

module.exports = router;
