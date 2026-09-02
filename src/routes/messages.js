const express = require("express");
const { PERSONAL_DIRECT_WHERE } = require("../utils/conversations");
const { hasAnyActiveVouch } = require("../utils/vouches");
const { userPhotoUrl } = require("./media");
const multer = require("multer");
const { v4: uuid } = require("uuid");
const { getDb } = require("../models/database");
const { getBlockedIds, isBlockedBetween } = require("../utils/blocks");
const { authenticate } = require("../middleware/auth");
const { sendPushToUser } = require("./push");
const { screenMessage } = require("../utils/messageSafety");
const { validateMagicBytes } = require("../utils/fileValidation");

const router = express.Router();
router.use(authenticate);

// v1.84: rate-limit message sends (infra #4) — global apiLimiter (120/min) is
// too loose for spam via send endpoints. 30 sends/min per IP is far above any
// human typing rate. GETs (polling, list) are untouched.
const rateLimit = require("express-rate-limit");
const sendLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: "You're sending messages too quickly — please wait a moment" },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false, xForwardedForHeader: false },
});

// Multer for chat photo uploads — memory storage, 5MB limit, images only
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files are allowed"));
  },
});

// Helper: check if caregiver is cleared to message (real BG check, or an
// active admin vouch for at least one family — v1.64.0 honest-override).
// Returns true for non-caregivers (they have no restrictions)
async function isCaregiverCleared(db, user) {
  const roles = user.roles || [user.role];
  if (!roles.includes("caregiver")) return true; // non-caregivers always cleared
  const profile = await db.prepare(
    "SELECT is_background_checked FROM caregiver_profiles WHERE user_id = ?"
  ).get(user.id);
  if (profile?.is_background_checked) return true;
  return await hasAnyActiveVouch(db, user.id);
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
      cm.last_read_at, cm.archived_at,
      /* v1.105.92 — when THIS person joined. Everything below is cut at it. */
      COALESCE(cm.joined_at, c.created_at) AS history_from
    FROM conversation_members cm
    JOIN conversations c ON cm.conversation_id = c.id
    WHERE cm.user_id = ?
      AND (cm.deleted_at IS NULL OR c.updated_at > cm.deleted_at)
    ORDER BY c.updated_at DESC
  `).all(userId);

  let conversations = []; // reassigned by the v1.105.18 block filter below
  for (const conv of convRows) {
    // Get last message
    // v1.105.92 — the preview is a message body on a list screen. Cutting the thread but
    // leaving the preview would have leaked the very thing being hidden, one line at a time.
    const lastMsg = await db.prepare(`
      SELECT content, sender_id, created_at FROM messages
      WHERE conversation_id = ? AND created_at >= ?
      ORDER BY created_at DESC LIMIT 1
    `).get(conv.id, conv.history_from);

    // Get unread count (exclude Kindred relay messages — user sees those in Kindred chat)
    const unreadRow = await db.prepare(`
      SELECT COUNT(*) AS count FROM messages
      WHERE conversation_id = ? AND sender_id != ?
        AND created_at > COALESCE(?::TIMESTAMPTZ, '1970-01-01'::TIMESTAMPTZ)
        /* v1.105.92 — never count messages from before they joined: an unread badge you
           cannot clear by opening the thread is its own small bug. */
        AND created_at >= ?
        AND sender_id NOT IN (SELECT id FROM users WHERE email = 'kindred@yourinplace.com')
    `).get(conv.id, userId, conv.last_read_at, conv.history_from);

    // Get members
    const members = await db.prepare(`
      SELECT u.id, u.first_name, u.last_name, u.role, u.profile_photo, u.avatar_url
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
      partnerPhoto = userPhotoUrl(partner);
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
        profilePhoto: userPhotoUrl(m),
      })),
      lastMessage: lastMsg?.content || null,
      lastMessageAt: lastMsg?.created_at || conv.created_at,
      unreadCount: parseInt(unreadRow?.count || 0),
      archivedAt: conv.archived_at || null,
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
    const partner = await db.prepare("SELECT id, first_name, last_name, role, profile_photo, avatar_url, is_admin FROM users WHERE id = ?").get(row.partner_id);
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
      profilePhoto: userPhotoUrl(partner),
      careTeamId: null,
      members: [
        { id: userId, name: "You", role: req.user.activeRole || req.user.role },
        { id: partner.id, name: `${partner.first_name} ${partner.last_name}`, role: partner.role, profilePhoto: userPhotoUrl(partner) },
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

  // ─── v1.105.18 — drop conversations with anyone either party has blocked ───
  // Filtering here rather than in SQL follows the uncleared-caregiver precedent below, and
  // covers BOTH the real and the legacy virtual conversations in one place — they are built
  // by separate code paths above and a WHERE clause would only have caught one of them.
  // The last-message preview and the unread badge ride on these objects, so removing the
  // conversation removes the leak through those too.
  const blockedIds = await getBlockedIds(db, userId);
  if (blockedIds.size) {
    conversations = conversations.filter((conv) => {
      // Group and care-team threads survive: a block is between two people, and silently
      // ejecting someone from their family's care coordination is a much bigger act than
      // they asked for. Direct threads with a blocked person go.
      const others = (conv.members || []).filter((m) => m.id !== userId);
      if (others.length !== 1) return true;
      return !blockedIds.has(others[0].id);
    });
  }

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

// v1.105.103 — do not push someone about a message they are reading. `isViewingConversation`
// is set from the socket layer (server.js) and is socket-scoped, so it only suppresses when a
// still-connected socket has that exact thread on screen. If the answer is unknown — no socket
// server wired in, as in the integration harness — it is false, and the push goes out. The
// failure direction is an extra push, never a swallowed one.
// v1.105.103 — the live payload must match what GET /conversations/:id returns, or the same
// message reads differently depending on whether it arrived over the socket or over a refetch.
// Two fields were missing: `reactions` (harmless, the client defaults it) and `senderLabel` —
// which is how a message from the platform is labelled "InPlace Support" instead of the
// admin's own name. Without it, a support message that arrived LIVE showed a person's real
// name, and the same message showed "InPlace Support" after backing out and re-entering.
function liveMessagePayload(message, realName, convId) {
  return {
    ...message,
    senderName: message.sender_label || realName,
    senderLabel: message.sender_label || null,
    reactions: [],
    type: "received",
    conversationId: convId,
  };
}

// ─── v1.105.181 — the photo does not ride along with the thread ───
//
// Pete: "we should probably resize photos in messages or something...loading is bad now."
//
// A photo message stores its image as a base64 data URI in `metadata.photoUrl`, and every list
// endpoint returned the metadata verbatim. Measured on production: the four biggest messages in
// one thread are 5-6 MB EACH and the table is 24 MB across 433 rows — so opening that
// conversation downloaded ~24 MB before a single bubble appeared. It is also half the reason
// the Postgres volume filled (boot snapshots copied all of it, five times).
//
// Same rule the note photos have had since v1.105.74: the list carries a FLAG, the image is
// fetched by id. `/photo` below streams it, one request per photo actually on screen.
function stripPhotoBlob(m) {
  if (!m || !m.metadata) return m;
  let meta;
  try { meta = typeof m.metadata === "string" ? JSON.parse(m.metadata) : m.metadata; } catch { return m; }
  if (!meta || typeof meta !== "object" || !meta.photoUrl) return m;
  // Keep everything about the photo EXCEPT the bytes: the caption still renders, and hasPhoto
  // is what tells the client to point an <img> at the endpoint.
  const { photoUrl, ...rest } = meta;
  return { ...m, metadata: JSON.stringify({ ...rest, hasPhoto: true }) };
}

function makeShouldPush(req) {
  const isViewing = req.app.get("isViewingConversation");
  return (memberId, convId) => !(typeof isViewing === "function" && isViewing(memberId, convId));
}

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
      WHERE ${PERSONAL_DIRECT_WHERE}
    `).get(req.user.id, partnerId);

    if (existing) return res.json({ conversationId: existing.id, existing: true });
  }

  const convId = uuid();
  // v1.105.102 — a direct conversation is NEVER named here. Its title is the other person,
  // resolved at read time. A name on a direct row means a system thread ("InPlace Support",
  // "iPAi", "Kindred (…)"), and letting a caller set one from the request body would let a
  // user's DM impersonate the platform — and would break the "name IS NULL means personal"
  // invariant that PERSONAL_DIRECT_WHERE depends on.
  await db.prepare(
    "INSERT INTO conversations (id, type, name, created_by) VALUES (?, ?, ?, ?)"
  ).run(convId, type, type === "direct" ? null : (name || null), req.user.id);

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
      SELECT id, first_name, last_name, role, email, profile_photo, avatar_url FROM users
      WHERE is_admin = 1 AND is_active = 1 AND COALESCE(is_demo, 0) = ?
      ORDER BY first_name ASC
    `).all(isDemo);
    return res.json({
      contacts: admins.map(u => ({ id: u.id, name: `${u.first_name} ${u.last_name}`, role: u.role, email: u.email, profilePhoto: userPhotoUrl(u) })),
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

  // 4. For care_for users: caregivers assigned to their linked care_recipient + the family contact
  const activeRole = req.user.activeRole || req.user.role;
  let careForContacts = [];
  if (activeRole === 'care_for' || (req.user.roles || []).includes('care_for')) {
    careForContacts = await db.prepare(`
      SELECT DISTINCT cp.user_id
      FROM care_recipients cr
      JOIN caregiver_assignments ca ON ca.care_recipient_id = cr.id AND ca.is_active = 1
      JOIN caregiver_profiles cp ON ca.caregiver_profile_id = cp.id
      WHERE cr.linked_user_id = ?
      UNION
      SELECT cr.family_user_id AS user_id
      FROM care_recipients cr
      WHERE cr.linked_user_id = ? AND cr.family_user_id IS NOT NULL AND cr.family_user_id != ?
    `).all(userId, userId, userId).catch(() => []);
  }

  const connectedIds = new Set([
    ...teamMembers.map(r => r.user_id),
    ...assignmentContacts.map(r => r.user_id),
    ...connectionContacts.map(r => r.user_id),
    ...careForContacts.map(r => r.user_id),
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
      SELECT id, first_name, last_name, role, email, profile_photo, avatar_url FROM users
      WHERE id IN (${placeholders}) AND COALESCE(is_demo, 0) = ? AND is_active = 1
        AND (LOWER(first_name || ' ' || last_name) LIKE ? OR LOWER(email) LIKE ?)
      ORDER BY first_name ASC
      LIMIT 20
    `).all(...idList, isDemo, `%${search}%`, `%${search}%`);
  } else {
    users = await db.prepare(`
      SELECT id, first_name, last_name, role, email, profile_photo, avatar_url FROM users
      WHERE id IN (${placeholders}) AND COALESCE(is_demo, 0) = ? AND is_active = 1
      ORDER BY first_name ASC
    `).all(...idList, isDemo);
  }

  const contacts = users.map(u => ({
    id: u.id,
    name: `${u.first_name} ${u.last_name}`,
    role: u.role,
    email: u.email,
    profilePhoto: userPhotoUrl(u),
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

    return res.json({ messages: enriched.map(stripPhotoBlob), conversationType: "direct" });
  }

  // Verify membership
  const membership = await db.prepare(
    "SELECT id, joined_at FROM conversation_members WHERE conversation_id = ? AND user_id = ?"
  ).get(convId, userId);
  if (!membership) return res.status(403).json({ error: "Not a member of this conversation" });

  // Get conversation info
  const conv = await db.prepare("SELECT type, name, care_team_id, created_at FROM conversations WHERE id = ?").get(convId);

  // ─── v1.105.92: you see the conversation from the day you joined it ───
  //
  // Pete: "i only want new members of the care team to get messages whilst they are part of
  // the team...not all messages in the history."
  //
  // Adding someone to a care team put them in its conversation and handed them everything ever
  // said in it. For Betty's team that is months of family discussion about her health, visible
  // in full to a neighbour who joined to help with dinner. Nobody chose that; it was simply
  // what "add to the conversation" did.
  //
  // conversation_members.joined_at has been recorded accurately since the table was created —
  // DEFAULT NOW(), never written explicitly — so the cut needs no migration and no backfill.
  // Anyone who was there from the start joined at creation and loses nothing.
  //
  // Falls back to the conversation's own created_at rather than the epoch: if joined_at were
  // ever NULL, defaulting to "the beginning of time" would quietly reopen the whole history,
  // which is the failure direction that matters here.
  const historyFrom = membership.joined_at || conv?.created_at || new Date(0).toISOString();

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
      AND m.created_at >= ?
    ORDER BY m.created_at ASC
  `).all(convId, historyFrom);

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

  // v1.105.92 — tell the client where the person's view of this thread begins, and whether
  // anything sits above it. A thread that simply starts mid-conversation with no explanation is
  // the same silent absence as a hidden job or a missing invite: the reader assumes something
  // is broken. The COUNT is of existence only; no content crosses the wire.
  const earlier = await db.prepare(
    "SELECT COUNT(*) AS c FROM messages WHERE conversation_id = ? AND created_at < ?"
  ).get(convId, historyFrom);
  const hiddenBefore = parseInt(earlier?.c || 0, 10);

  res.json({
    messages: enriched,
    conversationType: conv?.type || "direct",
    historyFrom,
    hiddenBefore,
  });
});

// ─── GET /api/messages/:id/photo (v1.105.181) — stream one photo ───
//
// The counterpart to stripPhotoBlob. Membership is checked on the message's conversation, and
// a failed check answers 404 rather than 403 so probing ids tells you nothing — the same
// convention as notes and family visits.
//
// Cached privately for a day: the bytes for a given message id never change, and re-downloading
// a photo every time someone scrolls past it is the problem this endpoint exists to solve.
router.get("/:id/photo", async (req, res) => {
  try {
    const db = await getDb();
    const msg = await db.prepare(
      "SELECT id, conversation_id, sender_id, recipient_id, metadata FROM messages WHERE id = ?"
    ).get(req.params.id);
    if (!msg) return res.status(404).json({ error: "Photo not found" });

    let allowed = false;
    if (msg.conversation_id) {
      const membership = await db.prepare(
        "SELECT id FROM conversation_members WHERE conversation_id = ? AND user_id = ?"
      ).get(msg.conversation_id, req.user.id);
      allowed = !!membership;
    } else {
      // Legacy direct messages predate conversations and have no membership row.
      allowed = msg.sender_id === req.user.id || msg.recipient_id === req.user.id;
    }
    if (!allowed) return res.status(404).json({ error: "Photo not found" });

    let meta = null;
    try { meta = msg.metadata ? JSON.parse(msg.metadata) : null; } catch { meta = null; }
    const dataUrl = meta && meta.photoUrl;
    if (!dataUrl) return res.status(404).json({ error: "Photo not found" });

    const m = String(dataUrl).match(/^data:([^;]+);base64,(.+)$/s);
    if (!m) return res.status(500).json({ error: "Stored photo is corrupt" });
    res.set("Content-Type", m[1]);
    res.set("Cache-Control", "private, max-age=86400");
    res.send(Buffer.from(m[2], "base64"));
  } catch (err) {
    captureException(err, { where: "messages: photo" });
    res.status(500).json({ error: "Could not load that photo" });
  }
});

// ─── POST /api/messages/conversations/:id/photo ─── Upload a photo in a conversation
router.post("/conversations/:id/photo", sendLimiter, upload.single("photo"), async (req, res) => {
  try {
    const db = await getDb();
    const userId = req.user.id;
    const convId = req.params.id;
    const caption = req.body.caption || "";

    if (!req.file) return res.status(400).json({ error: "No photo uploaded" });

    // Validate magic bytes
    const validation = validateMagicBytes(req.file.buffer, req.file.mimetype);
    if (!validation.valid) {
      return res.status(400).json({ error: "Invalid image file" });
    }

    // Uncleared caregivers can only message in conversations with admin
    const cleared = await isCaregiverCleared(db, req.user);
    if (!cleared) {
      const hasAdmin = await conversationHasAdmin(db, convId);
      if (!hasAdmin) {
        return res.status(403).json({ error: "Messaging is limited to InPlace Support until your background check is approved." });
      }
    }

    // Verify membership
    const membership = await db.prepare(
      "SELECT id FROM conversation_members WHERE conversation_id = ? AND user_id = ?"
    ).get(convId, userId);
    if (!membership) return res.status(403).json({ error: "Not a member of this conversation" });

    // Convert to base64 data URL
    const base64 = req.file.buffer.toString("base64");
    const dataUrl = `data:${req.file.mimetype};base64,${base64}`;

    // Get conversation members for notification
    const members = await db.prepare(
      "SELECT user_id FROM conversation_members WHERE conversation_id = ? AND user_id != ?"
    ).all(convId, userId);

    // For 1:1 conversations, set recipient_id for backward compat
    const conv = await db.prepare("SELECT type FROM conversations WHERE id = ?").get(convId);
    const recipientId = (conv?.type === "direct" && members.length === 1) ? members[0].user_id : null;

    const msgId = uuid();
    const displayContent = caption || "📷 Photo";
    const metadata = JSON.stringify({ photoUrl: dataUrl, caption, originalName: req.file.originalname });

    await db.prepare(
      "INSERT INTO messages (id, sender_id, recipient_id, content, conversation_id, message_type, metadata) VALUES (?, ?, ?, ?, ?, 'photo', ?)"
    ).run(msgId, userId, recipientId || userId, displayContent, convId, metadata);

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
    const shouldPush = makeShouldPush(req);
    for (const member of members) {
      if (shouldPush(member.user_id, convId)) sendPushToUser(member.user_id, {
        title: "InPlace",
        // v1.105.39 — the caption is free text about the person being cared for.
        body: `${senderName} sent a photo`,
        data: { type: "message", senderId: userId, conversationId: convId },
      }).catch(() => {});

      if (emitToUser) {
        emitToUser(member.user_id, "new_message", liveMessagePayload(message, senderName, convId));
      }
    }

    res.status(201).json({ message });
  } catch (err) {
    console.error("Photo upload error:", err);
    if (err.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "Photo must be under 5MB" });
    res.status(500).json({ error: "Failed to upload photo" });
  }
});

// ─── POST /api/messages/conversations/:id ─── Send a message to a conversation
router.post("/conversations/:id", sendLimiter, async (req, res) => {
  const db = await getDb();
  const userId = req.user.id;
  const convId = req.params.id;
  const { content, replyToId } = req.body;

  if (!content || !content.trim()) return res.status(400).json({ error: "Message content is required" });

  // ─── v1.105.18 — refuse to send into a blocked direct conversation ───
  // The read filters above hide the thread, but hiding is not the same as preventing: a
  // client holding a stale conversation id, or simply retrying, would otherwise still
  // deliver a message — and delivery fires the push, which is the part that reaches a
  // blocked person's lock screen.
  try {
    const others = await db.prepare(
      "SELECT user_id FROM conversation_members WHERE conversation_id = ? AND user_id != ?"
    ).all(convId, userId);
    if (others.length === 1 && await isBlockedBetween(db, userId, others[0].user_id)) {
      return res.status(403).json({ error: "You can't message this person.", blocked: true });
    }
  } catch (e) { console.error("[messages] block check failed on send:", e.message); }

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
    // v1.105.39 — no preview. messages.content is marked /* PHI-risk */ in the schema
    // because families and caregivers discuss health in here, and a preview renders on a
    // locked screen. Knowing WHO wrote is enough to decide whether to pick the phone up.
    if (makeShouldPush(req)(partnerId, newConvId)) sendPushToUser(partnerId, {
      title: "InPlace",
      body: `${senderName} sent you a message`,
      data: { type: "message", senderId: userId, conversationId: newConvId },
    }).catch(() => {});

    const emitToUser = req.app.get("emitToUser");
    if (emitToUser) {
      emitToUser(partnerId, "new_message", liveMessagePayload(message, senderName, newConvId));
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
  const shouldPush = makeShouldPush(req);
  for (const member of members) {
    // v1.105.39 — no preview (group threads carry the same PHI risk as one-to-one).
    if (shouldPush(member.user_id, convId)) sendPushToUser(member.user_id, {
      title: "InPlace",
      body: `${senderName} sent a message`,
      data: { type: "message", senderId: userId, conversationId: convId },
    }).catch(() => {});

    if (emitToUser) {
      emitToUser(member.user_id, "new_message", liveMessagePayload(message, senderName, convId));
    }
  }

  // Fire-and-forget AI safety screening
  screenMessage(content.trim(), userId, convId, {
    firstName: sender?.first_name, lastName: sender?.last_name,
  }).catch(() => {});

  res.status(201).json({ message });
});

// ─── LEGACY: POST /api/messages ─── Send a 1:1 message (backward compat)
router.post("/", sendLimiter, async (req, res) => {
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
    WHERE ${PERSONAL_DIRECT_WHERE}
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
  // v1.105.39 — no preview (legacy direct-message path).
  if (makeShouldPush(req)(recipientId, convId)) sendPushToUser(recipientId, {
    title: "InPlace",
    body: `${senderName} sent you a message`,
    data: { type: "message", senderId: req.user.id, conversationId: convId },
  }).catch(() => {});

  const emitToUser = req.app.get("emitToUser");
  if (emitToUser) {
    emitToUser(recipientId, "new_message", liveMessagePayload(message, senderName, convId));
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
    WHERE ${PERSONAL_DIRECT_WHERE}
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

  res.json({ messages: enriched.map(stripPhotoBlob) });
});

// ─── DELETE /api/messages/:messageId ─── Soft-delete a message (sender only)
// Replaces content with "[Name] deleted a message" so the conversation flow still makes sense
router.delete("/:messageId", async (req, res) => {
  const db = await getDb();
  const userId = req.user.id;
  const { messageId } = req.params;

  try {
    const msg = await db.prepare("SELECT * FROM messages WHERE id = ?").get(messageId);
    if (!msg) return res.status(404).json({ error: "Message not found" });

    // Only the sender can delete their own message
    if (msg.sender_id !== userId) {
      return res.status(403).json({ error: "You can only delete your own messages" });
    }

    // Get sender name for the tombstone
    const sender = await db.prepare("SELECT first_name FROM users WHERE id = ?").get(userId);
    const tombstone = `${sender?.first_name || 'Someone'} deleted a message`;

    await db.prepare(
      "UPDATE messages SET content = ?, is_deleted = 1, updated_at = NOW() WHERE id = ?"
    ).run(tombstone, messageId);

    // Also delete any reactions on this message
    await db.prepare("DELETE FROM message_reactions WHERE message_id = ?").run(messageId);

    // Emit socket event so other participants see the deletion in real time
    if (msg.conversation_id && global.io) {
      global.io.to(`conv:${msg.conversation_id}`).emit("message_deleted", {
        messageId, conversationId: msg.conversation_id, tombstone,
      });
    }

    res.json({ ok: true, tombstone });
  } catch (err) {
    console.error("DELETE /messages/:messageId error:", err);
    res.status(500).json({ error: "Server error" });
  }
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

// ─── PUT /api/messages/conversations/:id/archive ─── Archive a conversation for this user
router.put("/conversations/:id/archive", async (req, res) => {
  const db = await getDb();
  const userId = req.user.id;
  const convId = req.params.id;
  try {
    const result = await db.prepare(
      "UPDATE conversation_members SET archived_at = NOW() WHERE conversation_id = ? AND user_id = ? AND archived_at IS NULL"
    ).run(convId, userId);
    if (result.changes === 0) {
      return res.status(404).json({ error: "Not a member or already archived" });
    }
    res.json({ success: true });
  } catch (err) {
    console.error("[Messages] Archive conversation error:", err);
    res.status(500).json({ error: "Failed to archive conversation" });
  }
});

// ─── PUT /api/messages/conversations/:id/unarchive ─── Unarchive a conversation for this user
router.put("/conversations/:id/unarchive", async (req, res) => {
  const db = await getDb();
  const userId = req.user.id;
  const convId = req.params.id;
  try {
    await db.prepare(
      "UPDATE conversation_members SET archived_at = NULL WHERE conversation_id = ? AND user_id = ?"
    ).run(convId, userId);
    res.json({ success: true });
  } catch (err) {
    console.error("[Messages] Unarchive conversation error:", err);
    res.status(500).json({ error: "Failed to unarchive conversation" });
  }
});

// ─── DELETE /api/messages/conversations/:id ─── Delete a conversation and all its messages
router.delete("/conversations/:id", async (req, res) => {
  const db = await getDb();
  const userId = req.user.id;
  const convId = req.params.id;

  try {
    // Verify user is a member of this conversation (or is admin)
    const member = await db.prepare(
      "SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?"
    ).get(convId, userId);
    const user = await db.prepare("SELECT role FROM users WHERE id = ?").get(userId);

    if (!member && user?.role !== 'admin') {
      return res.status(403).json({ error: "Not a member of this conversation" });
    }

    // Soft-delete: hide this conversation for the requesting user only. Messages,
    // membership, and the conversation itself are NEVER destroyed — the other party
    // keeps their copy and the full thread remains available as evidence. A new
    // message bumps conversations.updated_at, which un-hides the thread for this user.
    if (!member) {
      // Admins are not members here; they must not hard-delete evidence either.
      return res.status(403).json({ error: "Only a conversation member can remove it from their inbox" });
    }
    await db.prepare(
      "UPDATE conversation_members SET deleted_at = NOW() WHERE conversation_id = ? AND user_id = ?"
    ).run(convId, userId);

    res.json({ success: true, softDeleted: true });
  } catch (err) {
    console.error("[Messages] Delete conversation error:", err);
    res.status(500).json({ error: "Failed to delete conversation" });
  }
});

// ─── Upload errors, handled (v1.105.150) ───
//
// Sentry INPLACE-G, 16 hours old, unhandled, on a NEW user's first photo message:
//
//   Error: Unexpected end of form
//   busboy/lib/types/multipart.js:588  Multipart._final
//   POST /api/messages/conversations/:id/photo   mechanism auto.middleware.express
//
// busboy raises that when the multipart body stops arriving before the form is complete —
// a phone that lost signal mid-upload, an app backgrounded halfway through, a tab closed.
// It is a normal thing for a network to do and it was reaching Express's default handler,
// which means an unhandled 500 and a page in Sentry.
//
// photos.js has had this handler since it shipped; this router never got one, and the
// difference only shows up when someone's upload is interrupted.
//
// The response may well go nowhere — if they truly disconnected, nobody is listening. That is
// not the point: the point is that a dropped connection is not a crash, and it must not spend
// the alerting budget that a real failure needs.
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "That photo is too large (5MB max)." });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err && err.message === "Only image files are allowed") {
    return res.status(400).json({ error: err.message });
  }
  // The upload was cut off. 408 rather than 400: nothing was wrong with the request, it just
  // did not all arrive.
  if (err && /Unexpected end of form|Unexpected end of multipart data|aborted/i.test(String(err.message))) {
    console.log("  [messages] upload interrupted (client disconnected mid-body)");
    if (res.headersSent || req.destroyed) return; // nobody is listening; do not thrash
    return res.status(408).json({ error: "The photo didn't finish uploading. Try again." });
  }
  return next(err);
});

module.exports = router;
