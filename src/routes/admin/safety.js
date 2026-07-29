// Split out of routes/admin.js (v1.92.0, tier-2 #3 — zero behavior change).
// Route bodies are verbatim; registration ORDER across modules is preserved by
// ./index.js. Shared state (passkey challenge store, helpers) lives in ./shared.js.
const { v4: uuid } = require("uuid");
const { getDb } = require("../../models/database");
const { authenticate, requireAdmin } = require("../../middleware/auth");
const { captureException } = require("../../utils/sentry");
const { activeVouchesFor } = require("../../utils/vouches");
const { sendVerificationEmail } = require("../auth");
const {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require("@simplewebauthn/server");
const { isTrustedIp, registerTrustedIp, getTrustedIps, removeTrustedIp } = require("../../utils/trustedIps");
const { getClientIp, writeAuditLog } = require("../../middleware/auditLog");
const {
  RP_ID, ORIGIN,
  setPasskeyChallenge, getPasskeyChallenge, setNukeChallenge, getNukeChallenge,
  NOT_DEMO_SESSION, safeJson, logAdminAction, checkAdmin,
} = require("./shared");

module.exports = function register(router) {

// ─── GET /api/admin/caregivers/paused — List all paused caregiver accounts ───
router.get("/caregivers/paused", authenticate, checkAdmin, requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const rows = await db.prepare(`
      SELECT cp.id, cp.user_id, cp.account_paused_reason, cp.account_paused_at,
        cp.rating_avg, cp.rating_count, cp.is_available,
        u.first_name, u.last_name, u.email, u.avatar_url, u.phone,
        (SELECT COUNT(*) FROM care_sessions cs WHERE cs.caregiver_id = cp.id AND cs.caregiver_no_show = 1) AS no_show_count,
        (SELECT COUNT(*) FROM care_sessions cs WHERE cs.caregiver_id = cp.id AND cs.status = 'completed') AS completed_count,
        ns.id AS no_show_session_id, ns.scheduled_date AS no_show_date, ns.scheduled_time AS no_show_time,
        cr_ns.first_name AS no_show_recipient_name
      FROM caregiver_profiles cp
      JOIN users u ON cp.user_id = u.id
      LEFT JOIN care_sessions ns ON ns.id = (
        SELECT cs2.id FROM care_sessions cs2
        WHERE cs2.caregiver_id = cp.id AND cs2.caregiver_no_show = 1 AND cs2.cancelled_by = 'system'
        ORDER BY cs2.scheduled_date DESC LIMIT 1
      )
      LEFT JOIN care_recipients cr_ns ON ns.care_recipient_id = cr_ns.id
      WHERE cp.account_paused = 1
      ORDER BY cp.account_paused_at DESC
    `).all();
    res.json({ paused: rows });
  } catch (err) {
    console.error("Paused caregivers error:", err);
    res.status(500).json({ error: "Failed to fetch paused caregivers" });
  }
});

// ─── POST /api/admin/caregivers/:userId/reinstate — Reinstate a paused caregiver ───
router.post("/caregivers/:userId/reinstate", authenticate, checkAdmin, requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const profile = await db.prepare("SELECT * FROM caregiver_profiles WHERE user_id = ?").get(req.params.userId);
    if (!profile) return res.status(404).json({ error: "Caregiver profile not found" });
    if (!profile.account_paused) return res.status(400).json({ error: "Account is not paused" });

    await db.prepare(`
      UPDATE caregiver_profiles SET
        account_paused = 0,
        account_paused_reason = NULL,
        account_paused_at = NULL,
        account_reinstated_at = NOW(),
        account_reinstated_by = ?,
        is_available = 1
      WHERE user_id = ?
    `).run(req.user.id, req.params.userId);

    await logAdminAction(req, "reinstate_caregiver", "caregiver", req.params.userId, {
      previousReason: profile.account_paused_reason,
      notes: req.body.notes || null,
    });

    console.log(`[admin] Reinstated caregiver ${req.params.userId} by ${req.user.email}`);
    res.json({ success: true, message: "Caregiver account reinstated" });
  } catch (err) {
    console.error("Reinstate caregiver error:", err);
    res.status(500).json({ error: "Failed to reinstate caregiver" });
  }
});

// ─── POST /api/admin/message/:userId — Send message as "InPlace Support" ───
router.post("/message/:userId", authenticate, checkAdmin, requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const { message } = req.body;
    if (!message || !message.trim()) return res.status(400).json({ error: "Message is required" });

    const targetUser = await db.prepare("SELECT id, first_name, last_name FROM users WHERE id = ?").get(req.params.userId);
    if (!targetUser) return res.status(404).json({ error: "User not found" });

    // Find or create a dedicated "InPlace Support" conversation (NOT the personal DM)
    let convId;
    const existing = await db.prepare(`
      SELECT c.id FROM conversations c
      JOIN conversation_members cm1 ON cm1.conversation_id = c.id AND cm1.user_id = ?
      JOIN conversation_members cm2 ON cm2.conversation_id = c.id AND cm2.user_id = ?
      WHERE c.type = 'direct' AND c.name = 'InPlace Support'
    `).get(req.user.id, req.params.userId);

    if (existing) {
      convId = existing.id;
    } else {
      convId = uuid();
      await db.prepare("INSERT INTO conversations (id, type, name, created_by) VALUES (?, ?, ?, ?)").run(convId, "direct", "InPlace Support", req.user.id);
      await db.prepare("INSERT INTO conversation_members (id, conversation_id, user_id, role) VALUES (?, ?, ?, ?)").run(uuid(), convId, req.user.id, "member");
      await db.prepare("INSERT INTO conversation_members (id, conversation_id, user_id, role) VALUES (?, ?, ?, ?)").run(uuid(), convId, req.params.userId, "member");
    }

    // Send the message with sender_label for display
    const msgId = uuid();
    await db.prepare(
      "INSERT INTO messages (id, sender_id, recipient_id, content, conversation_id, sender_label) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(msgId, req.user.id, req.params.userId, message.trim(), convId, "InPlace Support");

    // Update conversation timestamp
    await db.prepare("UPDATE conversations SET updated_at = NOW() WHERE id = ?").run(convId);

    // Push notification + websocket
    const emitToUser = req.app.get("emitToUser");
    if (emitToUser) {
      emitToUser(req.params.userId, "new_message", {
        messageId: msgId,
        conversationId: convId,
        senderId: req.user.id,
        senderName: "InPlace Support",
        content: message.trim(),
      });
    }

    // Send push notification
    try {
      const { sendPushToUser } = require("../../utils/push");
      if (sendPushToUser) {
        await sendPushToUser(db, req.params.userId, "InPlace Support", message.trim().substring(0, 100), { conversationId: convId });
      }
    } catch (e) { captureException(e, { where: "admin: support push" }); }

    await logAdminAction(req, "admin_message", "user", req.params.userId, {
      conversationId: convId,
      messagePreview: message.trim().substring(0, 50),
    });

    res.json({ success: true, conversationId: convId, messageId: msgId });
  } catch (err) {
    console.error("Admin message error:", err);
    res.status(500).json({ error: "Failed to send message" });
  }
});

// ─── POST /api/admin/caregivers/:userId/freeze — Manually freeze a caregiver account ───
router.post("/caregivers/:userId/freeze", authenticate, checkAdmin, requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const { reason } = req.body;
    if (!reason || !reason.trim()) return res.status(400).json({ error: "Reason is required" });

    const profile = await db.prepare("SELECT * FROM caregiver_profiles WHERE user_id = ?").get(req.params.userId);
    if (!profile) return res.status(404).json({ error: "Caregiver profile not found" });
    if (profile.account_paused) return res.status(400).json({ error: "Account is already paused" });

    await db.prepare(`
      UPDATE caregiver_profiles SET
        is_available = 0, account_paused = 1,
        account_paused_reason = ?,
        account_paused_at = NOW()
      WHERE user_id = ?
    `).run(reason.trim(), req.params.userId);

    await logAdminAction(req, "freeze_caregiver", "caregiver", req.params.userId, { reason: reason.trim() });

    console.log(`[admin] Froze caregiver ${req.params.userId} by ${req.user.email}: ${reason.trim()}`);
    res.json({ success: true, message: "Caregiver account frozen" });
  } catch (err) {
    console.error("Freeze caregiver error:", err);
    res.status(500).json({ error: "Failed to freeze caregiver" });
  }
});

// ─── GET /api/admin/safety-flags — List all safety flags for review ───
router.get("/safety-flags", authenticate, checkAdmin, requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const flags = await db.prepare(`
      SELECT sf.*, u.first_name, u.last_name, u.email,
        ru.first_name AS reviewer_first, ru.last_name AS reviewer_last
      FROM safety_flags sf
      JOIN users u ON sf.user_id = u.id
      LEFT JOIN users ru ON sf.reviewed_by = ru.id
      ORDER BY sf.created_at DESC
      LIMIT 50
    `).all();

    // Enrich each flag with conversation participants (so admin can message anyone involved)
    for (const flag of flags) {
      if (flag.conversation_id) {
        const participants = await db.prepare(`
          SELECT u.id AS user_id, u.first_name, u.last_name, u.email, u.role
          FROM conversation_members cm
          JOIN users u ON cm.user_id = u.id
          WHERE cm.conversation_id = ?
        `).all(flag.conversation_id);
        flag.participants = participants;
      } else {
        flag.participants = [];
      }
    }

    res.json({ flags });
  } catch (err) {
    console.error("Safety flags error:", err);
    res.status(500).json({ error: "Failed to load safety flags" });
  }
});

// ─── PUT /api/admin/safety-flags/:id — Review a safety flag ───
router.put("/safety-flags/:id", authenticate, checkAdmin, requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const { status, admin_notes } = req.body;
    if (!status) return res.status(400).json({ error: "Status is required" });

    await db.prepare(`
      UPDATE safety_flags SET status = ?, admin_notes = ?, reviewed_by = ?, reviewed_at = NOW()
      WHERE id = ?
    `).run(status, admin_notes || null, req.user.id, req.params.id);

    // Log status change as audit event
    await db.prepare(
      "INSERT INTO safety_flag_events (id, safety_flag_id, event_type, actor_id, actor_label, content, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())"
    ).run(uuid(), req.params.id, `status_${status}`, req.user.id, "Admin",
      admin_notes ? `Status changed to ${status}. Notes: ${admin_notes}` : `Status changed to ${status}`
    ).catch(() => {});

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to update safety flag" });
  }
});

// ─── POST /api/admin/safety-flags/:id/challenge — Generate passkey challenge for resolve/dismiss ───
router.post("/safety-flags/:id/challenge", authenticate, checkAdmin, requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const flag = await db.prepare("SELECT id FROM safety_flags WHERE id = ?").get(req.params.id);
    if (!flag) return res.status(404).json({ error: "Safety flag not found" });

    const passkeys = await db.prepare(
      "SELECT credential_id, transports FROM user_passkeys WHERE user_id = ?"
    ).all(req.user.id);
    if (passkeys.length === 0) {
      return res.status(400).json({ error: "You need a registered passkey. Set one up in My Account → Security." });
    }

    const allowCredentials = passkeys.map(pk => ({
      id: pk.credential_id,
      transports: pk.transports ? JSON.parse(pk.transports) : [],
    }));

    const options = await generateAuthenticationOptions({
      rpID: RP_ID,
      allowCredentials,
      userVerification: "required",
    });

    const challengeKey = `safetyflag_${req.user.id}_${req.params.id}_${Date.now()}`;
    setPasskeyChallenge(challengeKey, {
      challenge: options.challenge,
      adminId: req.user.id,
      flagId: req.params.id,
    });

    res.json({ ...options, _challengeKey: challengeKey });
  } catch (err) {
    console.error("Safety flag challenge error:", err);
    res.status(500).json({ error: "Failed to generate passkey challenge" });
  }
});

// ─── PUT /api/admin/safety-flags/:id/verified — Resolve/dismiss safety flag (requires passkey) ───
router.put("/safety-flags/:id/verified", authenticate, checkAdmin, requireAdmin, async (req, res) => {
  try {
    const { _challengeKey, status, admin_notes, ...authResponse } = req.body;
    if (!status) return res.status(400).json({ error: "Status is required" });

    // 1. Verify passkey challenge
    const stored = getPasskeyChallenge(_challengeKey);
    if (!stored) {
      return res.status(401).json({ error: "Passkey challenge expired. Please try again." });
    }
    if (stored.adminId !== req.user.id || stored.flagId !== req.params.id) {
      return res.status(401).json({ error: "Challenge mismatch." });
    }

    const db = await getDb();
    const passkey = await db.prepare(
      "SELECT pk.*, u.id as uid FROM user_passkeys pk JOIN users u ON pk.user_id = u.id WHERE pk.credential_id = ?"
    ).get(authResponse.id);
    if (!passkey || passkey.uid !== req.user.id) {
      return res.status(401).json({ error: "Passkey not found or doesn't belong to you." });
    }

    const EXPECTED_ORIGINS = [
      ORIGIN,
      `android:apk-key-hash:${process.env.ANDROID_CERT_HASH || ""}`,
    ].filter(Boolean);

    const verification = await verifyAuthenticationResponse({
      response: authResponse,
      expectedChallenge: stored.challenge,
      expectedOrigin: EXPECTED_ORIGINS,
      expectedRPID: RP_ID,
      credential: { id: passkey.credential_id, publicKey: Buffer.from(passkey.public_key, "base64url"), counter: passkey.counter || 0 },
    });

    if (!verification.verified) {
      return res.status(401).json({ error: "Passkey verification failed." });
    }

    // Update counter
    await db.prepare("UPDATE user_passkeys SET counter = ? WHERE credential_id = ?")
      .run(verification.authenticationInfo.newCounter, passkey.credential_id).catch(() => {});

    // 2. Perform the actual flag update
    await db.prepare(`
      UPDATE safety_flags SET status = ?, admin_notes = ?, reviewed_by = ?, reviewed_at = NOW()
      WHERE id = ?
    `).run(status, admin_notes || null, req.user.id, req.params.id);

    await db.prepare(
      "INSERT INTO safety_flag_events (id, safety_flag_id, event_type, actor_id, actor_label, content, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())"
    ).run(uuid(), req.params.id, `status_${status}`, req.user.id, "Admin (passkey verified)",
      admin_notes ? `Status changed to ${status} (passkey verified). Notes: ${admin_notes}` : `Status changed to ${status} (passkey verified)`
    ).catch(() => {});

    res.json({ success: true });
  } catch (err) {
    console.error("Safety flag verified review error:", err);
    res.status(500).json({ error: "Failed to update safety flag" });
  }
});

// ─── GET /api/admin/safety-flags/:id/thread — Full evidence thread for a safety flag ───
// Returns: original conversation messages, admin outreach threads, audit events — all in chronological order
router.get("/safety-flags/:id/thread", authenticate, checkAdmin, requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const flagId = req.params.id;

    // Get the safety flag itself
    const flag = await db.prepare(`
      SELECT sf.*, u.first_name, u.last_name, u.email
      FROM safety_flags sf JOIN users u ON sf.user_id = u.id
      WHERE sf.id = ?
    `).get(flagId);
    if (!flag) return res.status(404).json({ error: "Safety flag not found" });

    // Mark as read by admin
    if (!flag.admin_read_at) {
      await db.prepare("UPDATE safety_flags SET admin_read_at = NOW() WHERE id = ?").run(flagId);
      // Log read event
      await db.prepare(
        "INSERT INTO safety_flag_events (id, safety_flag_id, event_type, actor_id, actor_label, created_at) VALUES (?, ?, 'admin_viewed', ?, 'Admin', NOW())"
      ).run(uuid(), flagId, req.user.id);
    }

    // 1. Original conversation messages (evidence)
    let evidenceMessages = [];
    if (flag.conversation_id) {
      evidenceMessages = await db.prepare(`
        SELECT m.id, m.sender_id, m.content, m.created_at, m.sender_label,
          u.first_name, u.last_name, u.email, u.role
        FROM messages m
        LEFT JOIN users u ON m.sender_id = u.id
        WHERE m.conversation_id = ?
        ORDER BY m.created_at ASC
      `).all(flag.conversation_id);
    }

    // 2. Admin outreach threads (conversations linked to this safety flag)
    const linkedThreads = await db.prepare(`
      SELECT sft.*, c.name AS conv_name,
        u.first_name AS participant_first, u.last_name AS participant_last, u.email AS participant_email
      FROM safety_flag_threads sft
      JOIN conversations c ON sft.conversation_id = c.id
      JOIN users u ON sft.participant_user_id = u.id
      WHERE sft.safety_flag_id = ?
    `).all(flagId);

    // Get messages for each linked thread
    const outreachMessages = [];
    for (const thread of linkedThreads) {
      const msgs = await db.prepare(`
        SELECT m.id, m.sender_id, m.content, m.created_at, m.sender_label,
          u.first_name, u.last_name, u.email, u.role
        FROM messages m
        LEFT JOIN users u ON m.sender_id = u.id
        WHERE m.conversation_id = ?
        ORDER BY m.created_at ASC
      `).all(thread.conversation_id);
      outreachMessages.push({
        threadId: thread.id,
        conversationId: thread.conversation_id,
        participant: {
          userId: thread.participant_user_id,
          firstName: thread.participant_first,
          lastName: thread.participant_last,
          email: thread.participant_email,
        },
        messages: msgs,
      });
    }

    // 3. Audit events (status changes, notes, admin views)
    const events = await db.prepare(`
      SELECT e.*, u.first_name AS actor_first, u.last_name AS actor_last
      FROM safety_flag_events e
      LEFT JOIN users u ON e.actor_id = u.id
      WHERE e.safety_flag_id = ?
      ORDER BY e.created_at ASC
    `).all(flagId);

    // 4. Conversation participants
    let participants = [];
    if (flag.conversation_id) {
      participants = await db.prepare(`
        SELECT u.id AS user_id, u.first_name, u.last_name, u.email, u.role
        FROM conversation_members cm
        JOIN users u ON cm.user_id = u.id
        WHERE cm.conversation_id = ?
      `).all(flag.conversation_id);
    }

    res.json({
      flag,
      evidenceMessages,
      outreachMessages,
      events,
      participants,
    });
  } catch (err) {
    console.error("Safety flag thread error:", err);
    res.status(500).json({ error: "Failed to load thread" });
  }
});

// ─── POST /api/admin/safety-flags/:id/message/:userId — Send outreach message linked to safety flag ───
router.post("/safety-flags/:id/message/:userId", authenticate, checkAdmin, requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const flagId = req.params.id;
    const targetUserId = req.params.userId;
    const { message } = req.body;
    if (!message || !message.trim()) return res.status(400).json({ error: "Message is required" });

    const flag = await db.prepare("SELECT id, conversation_id FROM safety_flags WHERE id = ?").get(flagId);
    if (!flag) return res.status(404).json({ error: "Safety flag not found" });

    const targetUser = await db.prepare("SELECT id, first_name, last_name FROM users WHERE id = ?").get(targetUserId);
    if (!targetUser) return res.status(404).json({ error: "User not found" });

    // Check if we already have a linked thread for this participant
    let thread = await db.prepare(
      "SELECT * FROM safety_flag_threads WHERE safety_flag_id = ? AND participant_user_id = ?"
    ).get(flagId, targetUserId);

    let convId;
    if (thread) {
      convId = thread.conversation_id;
    } else {
      // Find existing InPlace Support conversation with this user, or create one
      const existing = await db.prepare(`
        SELECT c.id FROM conversations c
        JOIN conversation_members cm1 ON cm1.conversation_id = c.id AND cm1.user_id = ?
        JOIN conversation_members cm2 ON cm2.conversation_id = c.id AND cm2.user_id = ?
        WHERE c.type = 'direct' AND c.name = 'InPlace Support'
      `).get(req.user.id, targetUserId);

      if (existing) {
        convId = existing.id;
      } else {
        convId = uuid();
        await db.prepare("INSERT INTO conversations (id, type, name, created_by) VALUES (?, 'direct', 'InPlace Support', ?)").run(convId, req.user.id);
        await db.prepare("INSERT INTO conversation_members (id, conversation_id, user_id, role) VALUES (?, ?, ?, 'member')").run(uuid(), convId, req.user.id);
        await db.prepare("INSERT INTO conversation_members (id, conversation_id, user_id, role) VALUES (?, ?, ?, 'member')").run(uuid(), convId, targetUserId);
      }

      // Link this conversation to the safety flag
      await db.prepare(
        "INSERT INTO safety_flag_threads (id, safety_flag_id, conversation_id, participant_user_id, created_at) VALUES (?, ?, ?, ?, NOW())"
      ).run(uuid(), flagId, convId, targetUserId);
    }

    // Send the message
    const msgId = uuid();
    await db.prepare(
      "INSERT INTO messages (id, sender_id, recipient_id, content, conversation_id, sender_label, created_at) VALUES (?, ?, ?, ?, ?, 'InPlace Support', NOW())"
    ).run(msgId, req.user.id, targetUserId, message.trim(), convId);
    await db.prepare("UPDATE conversations SET updated_at = NOW() WHERE id = ?").run(convId);

    // Log as audit event
    await db.prepare(
      "INSERT INTO safety_flag_events (id, safety_flag_id, event_type, actor_id, actor_label, content, metadata, created_at) VALUES (?, ?, 'admin_message', ?, 'InPlace Support', ?, ?::jsonb, NOW())"
    ).run(uuid(), flagId, req.user.id, message.trim().substring(0, 500),
      JSON.stringify({ recipientId: targetUserId, recipientName: `${targetUser.first_name} ${targetUser.last_name}`, conversationId: convId })
    );

    // Push + WebSocket to recipient
    const emitToUser = req.app.get("emitToUser");
    if (emitToUser) {
      emitToUser(targetUserId, "new_message", {
        messageId: msgId, conversationId: convId,
        senderId: req.user.id, senderName: "InPlace Support",
        content: message.trim(),
      });
    }
    try {
      const { sendPushToUser } = require("../push");
      sendPushToUser(targetUserId, {
        title: "InPlace Support",
        body: message.trim().substring(0, 100),
        data: { type: "message", conversationId: convId },
      }).catch(() => {});
    } catch (e) { captureException(e, { where: "admin: support push (legacy)" }); }

    await logAdminAction(req, "safety_flag_message", "safety_flag", flagId, {
      recipientId: targetUserId, conversationId: convId,
    });

    res.json({ success: true, messageId: msgId, conversationId: convId });
  } catch (err) {
    console.error("Safety flag message error:", err);
    res.status(500).json({ error: "Failed to send message" });
  }
});

// ─── POST /api/admin/safety-flags/:id/note — Add internal admin note (not sent to anyone) ───
router.post("/safety-flags/:id/note", authenticate, checkAdmin, requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const { note } = req.body;
    if (!note || !note.trim()) return res.status(400).json({ error: "Note is required" });

    await db.prepare(
      "INSERT INTO safety_flag_events (id, safety_flag_id, event_type, actor_id, actor_label, content, created_at) VALUES (?, ?, 'admin_note', ?, 'Admin', ?, NOW())"
    ).run(uuid(), req.params.id, req.user.id, note.trim());

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to add note" });
  }
});
};
