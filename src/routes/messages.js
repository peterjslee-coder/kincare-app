const express = require("express");
const { v4: uuid } = require("uuid");
const { getDb } = require("../models/database");
const { authenticate } = require("../middleware/auth");
const { sendPushToUser } = require("./push");
const { screenMessage } = require("../utils/messageSafety");

const router = express.Router();
router.use(authenticate);

// Helper: check if caregiver is cleared (BG check passed + approved)
// Returns true for non-caregivers (they have no restrictions)
async function isCaregiverCleared(db, user) {
  const roles = user.roles || [user.role];
  if (!roles.includes("caregiver")) return true; // non-caregivers always cleared
  const profile = await db.prepare(
    "SELECT is_background_checked FROM caregiver_profiles WHERE user_id = ?"
  ).get(user.id);
  return !!profile?.is_background_checked;
}

// Helper: check if a conversation includes an admin member
async function conversationHasAdmin(db, conversationId) {
  const adminMember = await db.prepare(`
    SELECT u.id FROM conversation_members cm
    JOIN users u ON cm.user_id = u.id
    WHERE cm.conversation_id = ? AND u.is_admin = 1
    LIMIT 1
  `).get(conversationId);
  return !!adminMember;
}

// ─── GET /api/messages/conversations ─── List all conversations for current user
router.get("/conversations", async (req, res) => {
  const db = await getDb();
  const userId = req.user.id;
  const cleared = await isCaregiverCleared(db, req.user);

  // Get conversations from the conversations table (new model)
  const convRows = await db.prepare(`
    SELECT c.id, c.type, c.name, c.care_team_id, c.created_at,
      cm.last_read_at
    FROM conversation_members cm
    JOIN conversations c ON cm.conversation_id = c.id
    WHERE cm.user_id = ?
    ORDER BY c.updated_at DESC
  `).all(userId);

  const conversations = [];
  for (const conv of convRows) {
    // Get last message
    const lastMsg = await db.prepare(`
      SELECT content, sender_id, created_at FROM messages
      WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1
    `).get(conv.id);

    // Get unread count
    const unreadRow = await db.prepare(`
      SELECT COUNT(*) AS count FROM messages
      WHERE conversation_id = ? AND sender_id != ?
        AND created_at > COALESCE(?::TIMESTAMPTZ, '1970-01-01'::TIMESTAMPTZ)
    `).get(conv.id, userId, conv.last_read_at);

    // Get members
    const members = await db.prepare(`
      SELECT u.id, u.first_name, u.last_name, u.role, u.profile_photo
      FROM conversation_members cm
      JOIN users u ON cm.user_id = u.id
      WHERE cm.conversation_id = ?
    `).all(conv.id);

    // For direct conversations, use partner name as conversation name
    // EXCEPT when conversation has an explicit name like "InPlace Support" or "iPAi"
    let displayName = conv.name;
    let partnerPhoto = null;
    if (conv.type === "direct") {
      const partner = members.find(m => m.id !== userId);
      if (conv.name && (conv.name === "InPlace Support" || conv.name === "iPAi")) {
        displayName = conv.name;
      } else {
        displayName = partner ? `${partner.first_name} ${partner.last_name}` : "Unknown";
      }
      partnerPhoto = partner?.profile_photo || null;
    }

    conversations.push({
      id: conv.id,
      type: conv.type,
      name: displayName,
      profilePhoto: partnerPhoto,
      careTeamId: conv.care_team_id,
      members: members.map(m => ({
        id: m.id,
        name: `${m.first_name} ${m.last_name}`,
        first_name: m.first_name,
        last_name: m.last_name,
        role: m.role,
        profilePhoto: m.profile_photo || null,
      })),
      lastMessage: lastMsg?.content || null,
      lastMessageAt: lastMsg?.created_at || conv.created_at,
      unreadCount: parseInt(unreadRow?.count || 0),
    });
  }

  // Also check for legacy messages without conversation_id (backward compat)
  const legacyMessages = await db.prepare(`
    SELECT DISTINCT
      CASE WHEN sender_id = ? THEN recipient_id ELSE sender_id END AS partner_id
    FROM messages
    WHERE (sender_id = ? OR recipient_id = ?) AND conversation_id IS NULL
  `).all(userId, userId, userId);

  for (const row of legacyMessages) {
    // Check if we already have a direct conversation with this partner
    const existingConv = conversations.find(c =>
      c.type === "direct" && c.members.some(m => m.id === row.partner_id)
    );
    if (existingConv) continue;

    // Build a virtual conversation from legacy messages
    const partner = await db.prepare("SELECT id, first_name, last_name, role, profile_photo, is_admin FROM users WHERE id = ?").get(row.partner_id);
    if (!partner) continue;

    // Skip legacy conversations with unconnected users (unless admin)
    const reqUser = await db.prepare("SELECT is_admin FROM users WHERE id = ?").get(userId);
    if (!partner.is_admin && !reqUser?.is_admin) {
      const connected = await db.prepare(`
        SELECT 1 FROM care_team_members ctm1
        JOIN care_team_members ctm2 ON ctm1.care_team_id = ctm2.care_team_id
        WHERE ctm1.user_id = ? AND ctm2.user_id = ?
        UNION ALL
        SELECT 1 FROM caregiver_assignments ca
        JOIN caregiver_profiles cp ON ca.caregiver_profile_id = cp.id
        WHERE (cp.user_id = ? OR ca.family_user_id = ?) AND (cp.user_id = ? OR ca.family_user_id = ?) AND ca.is_active = 1
        UNION ALL
        SELECT 1 FROM connections
        WHERE ((requester_id = ? AND recipient_id = ?) OR (requester_id = ? AND recipient_id = ?)) AND status = 'accepted'
        LIMIT 1
      `).get(userId, row.partner_id, userId, userId, row.partner_id, row.partner_id, userId, row.partner_id, row.partner_id, userId);
      if (!connected) continue;
    }

    const lastMsg = await db.prepare(`
      SELECT content, created_at FROM messages
      WHERE ((sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?))
        AND conversation_id IS NULL
      ORDER BY created_at DESC LIMIT 1
    `).get(userId, row.partner_id, row.partner_id, userId);

    const unreadRow = await db.prepare(`
      SELECT COUNT(*) AS count FROM messages
      WHERE sender_id = ? AND recipient_id = ? AND is_read = 0 AND conversation_id IS NULL
    `).get(row.partner_id, userId);

    conversations.push({
      id: `legacy-${row.partner_id}`,
      type: "direct",
      name: `${partner.first_name} ${partner.last_name}`,
      profilePhoto: partner.profile_photo || null,
      careTeamId: null,
      members: [
        { id: userId, name: "You", role: req.user.activeRole || req.user.role },
        { id: partner.id, name: `${partner.first_name} ${partner.last_name}`, role: partner.role, profilePhoto: partner.profile_photo || null },
      ],
      lastMessage: lastMsg?.content || null,
      lastMessageAt: lastMsg?.created_at || null,
      unreadCount: parseInt(unreadRow?.count || 0),
      isLegacy: true,
    });
  }

  // Sort all conversations by most recent message (newest first)
  conversations.sort((a, b) => {
    const aTime = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
    const bTime = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
    return bTime - aTime;
  });

  // Uncleared caregivers can only see conversations with admin/support
  if (!cleared) {
    const filtered = [];
    for (const conv of conversations) {
      // Check if conversation name is InPlace Support or if any member is admin
      if (conv.name === "InPlace Support" || conv.name === "iPAi") {
        filtered.push(conv);
      } else {
        const hasAdmin = await conversationHasAdmin(db, conv.id);
        if (hasAdmin) filtered.push(conv);
      }
    }
    return res.json({ conversations: filtered, messagingLimited: true });
  }

  res.json({ conversations });
});

// ─── POST /api/messages/conversations ─── Create a new conversation
router.post("/conversations", async (req, res) => {
  const db = await getDb();
  const { type = "direct", name, memberIds = [] } = req.body;

  if (!memberIds.length) return res.status(400).json({ error: "At least one member is required" });
  if (type === "group" && !name) return res.status(400).json({ error: "Group name is required" });

  // Uncleared caregivers can only create conversations with admin
  const cleared = await isCaregiverCleared(db, req.user);
  if (!cleared) {
    // Check if any target member is admin
    let hasAdminTarget = false;
    for (const mid of memberIds) {
      const u = await db.prepare("SELECT is_admin FROM users WHERE id = ?").get(mid);
      if (u?.is_admin) { hasAdminTarget = true; break; }
    }
    if (!hasAdminTarget) {
      return res.status(403).json({ error: "Messaging is limited to InPlace Support until your background check is approved." });
    }
  }

  // ── Connection check: only allow messaging connected users (or admins) ──
  if (type === "direct") {
    for (const memberId of memberIds) {
      if (memberId === req.user.id) continue;

      // Admins are always messageable
      const targetUser = await db.prepare("SELECT is_admin FROM users WHERE id = ?").get(memberId);
      if (targetUser?.is_admin) continue;

      // If the requesting user is admin, they can message anyone
      const me = await db.prepare("SELECT is_admin FROM users WHERE id = ?").get(req.user.id);
      if (me?.is_admin) continue;

      // Check care team membership
      const sameTeam = await db.prepare(`
        SELECT 1 FROM care_team_members ctm1
        JOIN care_team_members ctm2 ON ctm1.care_team_id = ctm2.care_team_id
        WHERE ctm1.user_id = ? AND ctm2.user_id = ?
      `).get(req.user.id, memberId);
      if (sameTeam) continue;

      // Check caregiver assignment
      const hasAssignment = await db.prepare(`
        SELECT 1 FROM caregiver_assignments ca
        JOIN caregiver_profiles cp ON ca.caregiver_profile_id = cp.id
        WHERE (cp.user_id = ? OR ca.family_user_id = ?)
          AND (cp.user_id = ? OR ca.family_user_id = ?)
          AND ca.is_active = 1
      `).get(req.user.id, req.user.id, memberId, memberId);
      if (hasAssignment) continue;

      // Check accepted connection
      const hasConnection = await db.prepare(`
        SELECT 1 FROM connections
        WHERE ((requester_id = ? AND recipient_id = ?) OR (requester_id = ? AND recipient_id = ?))
          AND status = 'accepted'
      `).get(req.user.id, memberId, memberId, req.user.id);
      if (hasConnection) continue;

      // No valid relationship — block conversation creation
      return res.status(403).json({ error: "You can only message people you're connected with." });
    }
  }

  // For direct conversations, check if one already exists
  if (type === "direct" && memberIds.length === 1) {
    const partnerId = memberIds[0];
    const existing = await db.prepare(`
      SELECT c.id FROM conversations c
      JOIN conversation_members cm1 ON cm1.conversation_id = c.id AND cm1.user_id = ?
      JOIN conversation_members cm2 ON cm2.conversation_id = c.id AND cm2.user_id = ?
      WHERE c.type = 'direct'
    `).get(req.user.id, partnerId);

    if (existing) return res.json({ conversationId: existing.id, existing: true });
  }

  const convId = uuid();
  await db.prepare(
    "INSERT INTO conversations (id, type, name, created_by) VALUES (?, ?, ?, ?)"
  ).run(convId, type, name || null, req.user.id);

  // Add the creator as a member (admin for groups)
  await db.prepare(
    "INSERT INTO conversation_members (id, conversation_id, user_id, role) VALUES (?, ?, ?, ?)"
  ).run(uuid(), convId, req.user.id, type === "group" ? "admin" : "member");

  // Add other members
  for (const memberId of memberIds) {
    if (memberId !== req.user.id) {
      await db.prepare(
        "INSERT INTO conversation_members (id, conversation_id, user_id, role) VALUES (?, ?, ?, ?)"
      ).run(uuid(), convId, memberId, "member");
    }
  }

  res.status(201).json({ conversationId: convId });
});

// ─── GET /api/messages/contacts ─── List/search users available to message
// Only return users the requesting user is connected to via:
// - Care team membership (both users are members of the same care_team)
// - Caregiver assignment (caregiver assigned to a family's care recipient)
router.get("/contacts", async (req, res) => {
  const db = await getDb();
  const userId = req.user.id;
  const search = (req.query.q || "").trim().toLowerCase();

  // Look up requesting user's demo flag
  const me = await db.prepare("SELECT is_demo FROM users WHERE id = ?").get(userId);
  const isDemo = me && me.is_demo ? 1 : 0;

  // Uncleared caregivers can only see admin contacts
  const cleared = await isCaregiverCleared(db, req.user);
  if (!cleared) {
    const admins = await db.prepare(`
      SELECT id, first_name, last_name, role, email, profile_photo FROM users
      WHERE is_admin = 1 AND is_active = 1 AND COALESCE(is_demo, 0) = ?
      ORDER BY first_name ASC
    `).all(isDemo);
    return res.json({
      contacts: admins.map(u => ({ id: u.id, name: `${u.first_name} ${u.last_name}`, role: u.role, email: u.email, profilePhoto: u.profile_photo || null })),
      messagingLimited: true,
    });
  }

  // Build list of connected user IDs from care teams and caregiver assignments
  // 1. Users in the same care team
  const teamMembers = await db.prepare(`
    SELECT DISTINCT ctm2.user_id
    FROM care_team_members ctm1
    JOIN care_team_members ctm2 ON ctm1.care_team_id = ctm2.care_team_id
    WHERE ctm1.user_id = ? AND ctm2.user_id != ?
  `).all(userId, userId);

  // 2. For family users: caregivers assigned to their care recipients
  // For caregivers: families who assigned them
  const assignmentContacts = await db.prepare(`
    SELECT DISTINCT u.id as user_id FROM caregiver_assignments ca
    JOIN caregiver_profiles cp ON ca.caregiver_profile_id = cp.id
    JOIN users u ON (
      CASE WHEN cp.user_id = ? THEN u.id = ca.family_user_id
           WHEN ca.family_user_id = ? THEN u.id = cp.user_id
      END
    )
    WHERE (cp.user_id = ? OR ca.family_user_id = ?) AND ca.is_active = 1
  `).all(userId, userId, userId, userId);

  // 3. Accepted connections (user search + connection request system)
  const connectionContacts = await db.prepare(`
    SELECT CASE WHEN requester_id = ? THEN recipient_id ELSE requester_id END AS user_id
    FROM connections
    WHERE (requester_id = ? OR recipient_id = ?) AND status = 'accepted'
  `).all(userId, userId, userId);

  const connectedIds = new Set([
    ...teamMembers.map(r => r.user_id),
    ...assignmentContacts.map(r => r.user_id),
    ...connectionContacts.map(r => r.user_id),
  ]);

  if (connectedIds.size === 0) {
    return res.json({ contacts: [] });
  }

  const idList = [...connectedIds];
  // Build parameterized query for connected users
  const placeholders = idList.map(() => '?').join(',');

  let users;
  if (search) {
    users = await db.prepare(`
      SELECT id, first_name, last_name, role, email, profile_photo FROM users
      WHERE id IN (${placeholders}) AND COALESCE(is_demo, 0) = ? AND is_active = 1
        AND (LOWER(first_name || ' ' || last_name) LIKE ? OR LOWER(email) LIKE ?)
      ORDER BY first_name ASC
      LIMIT 20
    `).all(...idList, isDemo, `%${search}%`, `%${search}%`);
  } else {
    users = await db.prepare(`
      SELECT id, first_name, last_name, role, email, profile_photo FROM users
      WHERE id IN (${placeholders}) AND COALESCE(is_demo, 0) = ? AND is_active = 1
      ORDER BY first_name ASC
    `).all(...idList, isDemo);
  }

  const contacts = users.map(u => ({
    id: u.id,
    name: `${u.first_name} ${u.last_name}`,
    role: u.role,
    email: u.email,
    profilePhoto: u.profile_photo || null,
  }));

  res.json({ contacts });
});

// ─── GET /api/messages/conversations/:id ─── Get messages in a conversation
router.get("/conversations/:id", async (req, res) => {
  const db = await getDb();
  const userId = req.user.id;
  const convId = req.params.id;

  // Handle legacy conversation IDs (legacy-<partnerId>)
  if (convId.startsWith("legacy-")) {
    const partnerId = convId.replace("legacy-", "");

    const messages = await db.prepare(`
      SELECT m.*,
        su.first_name AS sender_first_name, su.last_name AS sender_last_name
      FROM messages m
      JOIN users su ON m.sender_id = su.id
      WHERE ((m.sender_id = ? AND m.recipient_id = ?) OR (m.sender_id = ? AND m.recipient_id = ?))
        AND m.conversation_id IS NULL
      ORDER BY m.created_at ASC
    `).all(userId, partnerId, partnerId, userId);

    // Mark as read
    await db.prepare(`
      UPDATE messages SET is_read = 1
      WHERE sender_id = ? AND recipient_id = ? AND is_read = 0 AND conversation_id IS NULL
    `).run(partnerId, userId);

    const enriched = messages.map(m => ({
      ...m,
      type: m.sender_id === userId ? 'sent' : 'received',
      senderName: m.sender_label || `${m.sender_first_name} ${m.sender_last_name}`,
      senderLabel: m.sender_label || null,
    }));

    return res.json({ messages: enriched, conversationType: "direct" });
  }

  // Verify membership
  const membership = await db.prepare(
    "SELECT id FROM conversation_members WHERE conversation_id = ? AND user_id = ?"
  ).get(convId, userId);
  if (!membership) return res.status(403).json({ error: "Not a member of this conversation" });

  // Get conversation info
  const conv = await db.prepare("SELECT type, name, care_team_id FROM conversations WHERE id = ?").get(convId);

  // Get messages with reply-to info
  const messages = await db.prepare(`
    SELECT m.*,
      su.first_name AS sender_first_name, su.last_name AS sender_last_name,
      rm.content AS reply_content, rm.sender_id AS reply_sender_id,
      ru.first_name AS reply_sender_first, ru.last_name AS reply_sender_last
    FROM messages m
    JOIN users su ON m.sender_id = su.id
    LEFT JOIN messages rm ON m.reply_to_id = rm.id
    LEFT JOIN users ru ON rm.sender_id = ru.id
    WHERE m.conversation_id = ?
    ORDER BY m.created_at ASC
  `).all(convId);

  // Get reactions for all messages in this conversation
  const msgIds = messages.map(m => m.id);
  let reactionsMap = {};
  if (msgIds.length > 0) {
    const placeholders = msgIds.map(() => '?').join(',');
    const reactions = await db.prepare(`
      SELECT mr.message_id, mr.emoji, mr.user_id,
        u.first_name, u.last_name
      FROM message_reactions mr
      JOIN users u ON mr.user_id = u.id
      WHERE mr.message_id IN (${placeholders})
    `).all(...msgIds);
    for (const r of reactions) {
      if (!reactionsMap[r.message_id]) reactionsMap[r.message_id] = [];
      reactionsMap[r.message_id].push({
        emoji: r.emoji,
        userId: r.user_id,
        userName: `${r.first_name} ${r.last_name}`,
      });
    }
  }

  // Update last_read_at
  await db.prepare(
    "UPDATE conversation_members SET last_read_at = NOW() WHERE conversation_id = ? AND user_id = ?"
  ).run(convId, userId);

  const enriched = messages.map(m => ({
    ...m,
    type: m.sender_id === userId ? 'sent' : 'received',
    senderName: m.sender_label || `${m.sender_first_name} ${m.sender_last_name}`,
    senderLabel: m.sender_label || null,
    replyTo: m.reply_to_id ? {
      id: m.reply_to_id,
      content: m.reply_content,
      senderName: m.reply_sender_first ? `${m.reply_sender_first} ${m.reply_sender_last}` : null,
    } : null,
    reactions: reactionsMap[m.id] || [],
  }));

  res.json({ messages: enriched, conversationType: conv?.type || "direct" });
});

// ─── POST /api/messages/conversations/:id ─── Send a message to a conversation
router.post("/conversations/:id", async (req, res) => {
  const db = await getDb();
  const userId = req.user.id;
  const convId = req.params.id;
  const { content, replyToId } = req.body;

  if (!content || !content.trim()) return res.status(400).json({ error: "Message content is required" });

  // Uncleared caregivers can only message in conversations with admin
  const cleared = await isCaregiverCleared(db, req.user);
  if (!cleared && !convId.startsWith("legacy-")) {
    const hasAdmin = await conversationHasAdmin(db, convId);
    if (!hasAdmin) {
      return res.status(403).json({ error: "Messaging is limited to InPlace Support until your background check is approved." });
    }
  }

  // Handle legacy conversations — auto-migrate to real conversation
  if (convId.startsWith("legacy-")) {
    const partnerId = convId.replace("legacy-", "");

    // Create a real direct conversation
    const newConvId = uuid();
    await db.prepare(
      "INSERT INTO conversations (id, type, created_by) VALUES (?, 'direct', ?)"
    ).run(newConvId, userId);

    await db.prepare(
      "INSERT INTO conversation_members (id, conversation_id, user_id, role) VALUES (?, ?, ?, 'member')"
    ).run(uuid(), newConvId, userId);
    await db.prepare(
      "INSERT INTO conversation_members (id, conversation_id, user_id, role) VALUES (?, ?, ?, 'member')"
    ).run(uuid(), newConvId, partnerId);

    // Migrate existing messages
    await db.prepare(`
      UPDATE messages SET conversation_id = ?
      WHERE ((sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?))
        AND conversation_id IS NULL
    `).run(newConvId, userId, partnerId, partnerId, userId);

    // Send the new message in this conversation
    const msgId = uuid();
    await db.prepare(
      "INSERT INTO messages (id, sender_id, recipient_id, content, conversation_id) VALUES (?, ?, ?, ?, ?)"
    ).run(msgId, userId, partnerId, content.trim(), newConvId);

    await db.prepare("UPDATE conversations SET updated_at = NOW() WHERE id = ?").run(newConvId);

    const message = await db.prepare("SELECT * FROM messages WHERE id = ?").get(msgId);
    const sender = await db.prepare("SELECT first_name, last_name FROM users WHERE id = ?").get(userId);
    const senderName = sender ? `${sender.first_name} ${sender.last_name}` : "Someone";

    // Push + WebSocket to partner
    const preview = content.trim().length > 80 ? content.trim().substring(0, 77) + "..." : content.trim();
    sendPushToUser(partnerId, {
      title: "InPlace",
      body: `${senderName}: ${preview}`,
      data: { type: "message", senderId: userId, conversationId: newConvId },
    }).catch(() => {});

    const emitToUser = req.app.get("emitToUser");
    if (emitToUser) {
      emitToUser(partnerId, "new_message", {
        ...message, senderName, type: "received", conversationId: newConvId,
      });
    }

    // Fire-and-forget AI safety screening
    screenMessage(content.trim(), userId, newConvId, {
      firstName: sender?.first_name, lastName: sender?.last_name,
    }).catch(() => {});

    return res.status(201).json({ message, conversationId: newConvId });
  }

  // Verify membership
  const membership = await db.prepare(
    "SELECT id FROM conversation_members WHERE conversation_id = ? AND user_id = ?"
  ).get(convId, userId);
  if (!membership) return res.status(403).json({ error: "Not a member of this conversation" });

  // Get conversation members for notification
  const members = await db.prepare(
    "SELECT user_id FROM conversation_members WHERE conversation_id = ? AND user_id != ?"
  ).all(convId, userId);

  // For 1:1 conversations, set recipient_id for backward compat
  const conv = await db.prepare("SELECT type FROM conversations WHERE id = ?").get(convId);
  const recipientId = (conv?.type === "direct" && members.length === 1) ? members[0].user_id : null;

  const msgId = uuid();
  await db.prepare(
    "INSERT INTO messages (id, sender_id, recipient_id, content, conversation_id, reply_to_id) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(msgId, userId, recipientId || userId, content.trim(), convId, replyToId || null);

  // Update conversation timestamp
  await db.prepare("UPDATE conversations SET updated_at = NOW() WHERE id = ?").run(convId);

  // Update sender's last_read_at
  await db.prepare(
    "UPDATE conversation_members SET last_read_at = NOW() WHERE conversation_id = ? AND user_id = ?"
  ).run(convId, userId);

  const message = await db.prepare("SELECT * FROM messages WHERE id = ?").get(msgId);
  const sender = await db.prepare("SELECT first_name, last_name FROM users WHERE id = ?").get(userId);
  const senderName = sender ? `${sender.first_name} ${sender.last_name}` : "Someone";

  // Notify all other members
  const emitToUser = req.app.get("emitToUser");
  for (const member of members) {
    const memberPreview = content.trim().length > 80 ? content.trim().substring(0, 77) + "..." : content.trim();
    sendPushToUser(member.user_id, {
      title: "InPlace",
      body: `${senderName}: ${memberPreview}`,
      data: { type: "message", senderId: userId, conversationId: convId },
    }).catch(() => {});

    if (emitToUser) {
      emitToUser(member.user_id, "new_message", {
        ...message, senderName, type: "received", conversationId: convId,
      });
    }
  }

  // Fire-and-forget AI safety screening
  screenMessage(content.trim(), userId, convId, {
    firstName: sender?.first_name, lastName: sender?.last_name,
  }).catch(() => {});

  res.status(201).json({ message });
});

// ─── LEGACY: POST /api/messages ─── Send a 1:1 message (backward compat)
router.post("/", async (req, res) => {
  const db = await getDb();
  const { recipientId, content } = req.body;

  if (!recipientId || !content) {
    return res.status(400).json({ error: "recipientId and content required" });
  }

  // Check if a direct conversation already exists
  let convId = null;
  const existing = await db.prepare(`
    SELECT c.id FROM conversations c
    JOIN conversation_members cm1 ON cm1.conversation_id = c.id AND cm1.user_id = ?
    JOIN conversation_members cm2 ON cm2.conversation_id = c.id AND cm2.user_id = ?
    WHERE c.type = 'direct'
  `).get(req.user.id, recipientId);

  if (existing) {
    convId = existing.id;
  } else {
    // Create a direct conversation
    convId = uuid();
    await db.prepare(
      "INSERT INTO conversations (id, type, created_by) VALUES (?, 'direct', ?)"
    ).run(convId, req.user.id);
    await db.prepare(
      "INSERT INTO conversation_members (id, conversation_id, user_id, role) VALUES (?, ?, ?, 'member')"
    ).run(uuid(), convId, req.user.id);
    await db.prepare(
      "INSERT INTO conversation_members (id, conversation_id, user_id, role) VALUES (?, ?, ?, 'member')"
    ).run(uuid(), convId, recipientId);
  }

  const id = uuid();
  await db.prepare(`
    INSERT INTO messages (id, sender_id, recipient_id, content, conversation_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, req.user.id, recipientId, content, convId);

  await db.prepare("UPDATE conversations SET updated_at = NOW() WHERE id = ?").run(convId);

  const message = await db.prepare("SELECT * FROM messages WHERE id = ?").get(id);

  // Push + WebSocket
  const sender = await db.prepare("SELECT first_name, last_name FROM users WHERE id = ?").get(req.user.id);
  const senderName = sender ? `${sender.first_name} ${sender.last_name}` : "Someone";
  const legacyPreview = content.length > 80 ? content.substring(0, 77) + "..." : content;
  sendPushToUser(recipientId, {
    title: "InPlace",
    body: `${senderName}: ${legacyPreview}`,
    data: { type: "message", senderId: req.user.id, conversationId: convId },
  }).catch(() => {});

  const emitToUser = req.app.get("emitToUser");
  if (emitToUser) {
    emitToUser(recipientId, "new_message", {
      ...message, senderName, type: "received", conversationId: convId,
    });
  }

  // Fire-and-forget AI safety screening
  screenMessage(content, req.user.id, convId, {
    firstName: sender?.first_name, lastName: sender?.last_name,
  }).catch(() => {});

  res.status(201).json({ message });
});

// ─── LEGACY: GET /api/messages/:partnerId ─── Get messages with a partner (backward compat)
router.get("/:partnerId", async (req, res) => {
  const db = await getDb();
  const userId = req.user.id;
  const partnerId = req.params.partnerId;

  // Check for a conversation first
  const conv = await db.prepare(`
    SELECT c.id FROM conversations c
    JOIN conversation_members cm1 ON cm1.conversation_id = c.id AND cm1.user_id = ?
    JOIN conversation_members cm2 ON cm2.conversation_id = c.id AND cm2.user_id = ?
    WHERE c.type = 'direct'
  `).get(userId, partnerId);

  let messages;
  if (conv) {
    messages = await db.prepare(`
      SELECT m.*, su.first_name AS sender_first_name, su.last_name AS sender_last_name
      FROM messages m JOIN users su ON m.sender_id = su.id
      WHERE m.conversation_id = ?
      ORDER BY m.created_at ASC
    `).all(conv.id);

    await db.prepare(
      "UPDATE conversation_members SET last_read_at = NOW() WHERE conversation_id = ? AND user_id = ?"
    ).run(conv.id, userId);
  } else {
    messages = await db.prepare(`
      SELECT m.*, su.first_name AS sender_first_name, su.last_name AS sender_last_name
      FROM messages m JOIN users su ON m.sender_id = su.id
      WHERE ((m.sender_id = ? AND m.recipient_id = ?) OR (m.sender_id = ? AND m.recipient_id = ?))
        AND m.conversation_id IS NULL
      ORDER BY m.created_at ASC
    `).all(userId, partnerId, partnerId, userId);

    await db.prepare(`
      UPDATE messages SET is_read = 1
      WHERE sender_id = ? AND recipient_id = ? AND is_read = 0 AND conversation_id IS NULL
    `).run(partnerId, userId);
  }

  const enriched = messages.map(m => ({
    ...m,
    type: m.sender_id === userId ? 'sent' : 'received',
    senderName: `${m.sender_first_name} ${m.sender_last_name}`,
  }));

  res.json({ messages: enriched });
});

// ─── POST /api/messages/:messageId/reactions ─── Add or toggle a reaction
router.post("/:messageId/reactions", async (req, res) => {
  const db = await getDb();
  const userId = req.user.id;
  const { messageId } = req.params;
  const { emoji } = req.body;

  const ALLOWED_EMOJIS = ['❤️', '👍', '👎', '😂', '😮', '🙏'];
  if (!emoji || !ALLOWED_EMOJIS.includes(emoji)) {
    return res.status(400).json({ error: "Invalid emoji" });
  }

  // Verify message exists and user has access
  const msg = await db.prepare("SELECT id, conversation_id, sender_id FROM messages WHERE id = ?").get(messageId);
  if (!msg) return res.status(404).json({ error: "Message not found" });

  if (msg.conversation_id) {
    const membership = await db.prepare(
      "SELECT id FROM conversation_members WHERE conversation_id = ? AND user_id = ?"
    ).get(msg.conversation_id, userId);
    if (!membership) return res.status(403).json({ error: "Not a member" });
  }

  // Check if user already reacted to this message
  const existing = await db.prepare(
    "SELECT id, emoji FROM message_reactions WHERE message_id = ? AND user_id = ?"
  ).get(messageId, userId);

  let action;
  if (existing && existing.emoji === emoji) {
    // Same emoji — remove (toggle off)
    await db.prepare("DELETE FROM message_reactions WHERE id = ?").run(existing.id);
    action = 'removed';
  } else if (existing) {
    // Different emoji — replace
    await db.prepare("UPDATE message_reactions SET emoji = ? WHERE id = ?").run(emoji, existing.id);
    action = 'replaced';
  } else {
    // New reaction
    await db.prepare(
      "INSERT INTO message_reactions (id, message_id, user_id, emoji) VALUES (?, ?, ?, ?)"
    ).run(uuid(), messageId, userId, emoji);
    action = 'added';
  }

  // Get updated reactions for this message
  const reactions = await db.prepare(`
    SELECT mr.emoji, mr.user_id, u.first_name, u.last_name
    FROM message_reactions mr JOIN users u ON mr.user_id = u.id
    WHERE mr.message_id = ?
  `).all(messageId);

  const reactionData = reactions.map(r => ({
    emoji: r.emoji, userId: r.user_id, userName: `${r.first_name} ${r.last_name}`,
  }));

  // Emit to conversation members via WebSocket
  if (msg.conversation_id) {
    const members = await db.prepare(
      "SELECT user_id FROM conversation_members WHERE conversation_id = ? AND user_id != ?"
    ).all(msg.conversation_id, userId);
    const emitToUser = req.app.get("emitToUser");
    if (emitToUser) {
      const sender = await db.prepare("SELECT first_name, last_name FROM users WHERE id = ?").get(userId);
      for (const m of members) {
        emitToUser(m.user_id, "message_reaction", {
          messageId, conversationId: msg.conversation_id,
          reactions: reactionData, action, emoji,
          reactorName: sender ? `${sender.first_name} ${sender.last_name}` : 'Someone',
        });
      }
    }
  }

  res.json({ reactions: reactionData, action });
});

module.exports = router;
