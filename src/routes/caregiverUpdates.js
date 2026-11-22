// ─── Caregiver updates (v1.146.0) ───
//
// Pete, 11/22: "I want a messaging option for all caregivers. An update. Tips. Newsletter of
// sorts." His answers:
//   • where it lands — a card pinned on the caregiver's Home, plus a push
//   • replies        — go to him privately (an ordinary direct message, never a group thread)
//   • who            — every caregiver, onboarding ones too
//
// Admin side (InPlace staff): compose and send, see who opened it / said "Got it" / replied,
// edit a typo after sending, withdraw one sent by mistake.
// Caregiver side: the pinned update, "Got it", "Reply", and the history in My Account.
//
// The push never carries the message (no content on a lock screen — the push-PHI rule applies
// to everything, not only health). It says who it is from and that there is something new.
//
// A caregiver who joins after an update was sent still sees recent ones: GET /mine gives her a
// receipt (without a push) for anything sent in the last BACKFILL_DAYS.

const express = require("express");
const { v4: uuid } = require("uuid");
const { getDb } = require("../models/database");
const { authenticate, requireAdmin } = require("../middleware/auth");
const { checkAdmin } = require("./admin/shared");
const { captureException } = require("../utils/sentry");

const router = express.Router();
router.use(authenticate);

const KINDS = ["tip", "news", "thanks"];
const TITLE_MAX = 120;
const BODY_MAX = 2000;
const REPLY_MAX = 2000;
const BACKFILL_DAYS = 14;

// Every real, active account that is a caregiver. Exact-match on the JSON roles array, like
// admin/overview.js, so "caregiver" inside another word can never match.
const AUDIENCE_SQL = `
  SELECT u.id FROM users u
  WHERE COALESCE(u.is_demo, 0) = 0
    AND COALESCE(u.is_active, 1) = 1
    AND (u.role = 'caregiver' OR u.roles LIKE '%"caregiver"%'
         OR EXISTS (SELECT 1 FROM caregiver_profiles cp WHERE cp.user_id = u.id))`;

function clean(s, max) {
  return String(s == null ? "" : s).replace(/\r\n/g, "\n").trim().slice(0, max);
}

function validate(body) {
  const kind = KINDS.includes(body && body.kind) ? body.kind : "tip";
  const title = clean(body && body.title, TITLE_MAX);
  const text = clean(body && body.body, BODY_MAX);
  if (!title) return { error: "Give it a title." };
  if (!text) return { error: "Write the message." };
  return { kind, title, body: text };
}

async function isCaregiver(db, userId) {
  const row = await db.prepare(`${AUDIENCE_SQL} AND u.id = ?`).get(userId);
  return !!row;
}

function senderName(row) {
  return [row.sender_first, row.sender_last].filter(Boolean).join(" ") || "InPlace";
}

function shape(row) {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    createdAt: row.created_at,
    editedAt: row.edited_at || null,
    from: senderName(row),
    seenAt: row.seen_at || null,
    gotItAt: row.got_it_at || null,
    repliedAt: row.replied_at || null,
  };
}

// ─── Admin ───

const admin = [checkAdmin, requireAdmin];

router.get("/admin/audience", admin, async (req, res) => {
  try {
    const db = await getDb();
    const rows = await db.prepare(AUDIENCE_SQL).all();
    res.json({ count: rows.filter((r) => r.id !== req.user.id).length });
  } catch (err) {
    captureException(err);
    res.status(500).json({ error: "Couldn't count caregivers." });
  }
});

router.get("/admin", admin, async (req, res) => {
  try {
    const db = await getDb();
    const rows = await db.prepare(`
      SELECT u.*, s.first_name AS sender_first, s.last_name AS sender_last,
        (SELECT COUNT(*) FROM caregiver_update_receipts r WHERE r.update_id = u.id) AS sent_to,
        (SELECT COUNT(*) FROM caregiver_update_receipts r WHERE r.update_id = u.id AND r.seen_at IS NOT NULL) AS seen,
        (SELECT COUNT(*) FROM caregiver_update_receipts r WHERE r.update_id = u.id AND r.got_it_at IS NOT NULL) AS got_it,
        (SELECT COUNT(*) FROM caregiver_update_receipts r WHERE r.update_id = u.id AND r.replied_at IS NOT NULL) AS replied
      FROM caregiver_updates u LEFT JOIN users s ON s.id = u.created_by
      ORDER BY u.created_at DESC LIMIT 100`).all();
    res.json({
      updates: rows.map((r) => ({
        ...shape(r),
        withdrawnAt: r.withdrawn_at || null,
        stats: { sentTo: Number(r.sent_to) || 0, seen: Number(r.seen) || 0, gotIt: Number(r.got_it) || 0, replied: Number(r.replied) || 0 },
      })),
    });
  } catch (err) {
    captureException(err);
    res.status(500).json({ error: "Couldn't load updates." });
  }
});

router.get("/admin/:id/receipts", admin, async (req, res) => {
  try {
    const db = await getDb();
    const rows = await db.prepare(`
      SELECT r.*, u.first_name, u.last_name FROM caregiver_update_receipts r
      JOIN users u ON u.id = r.user_id WHERE r.update_id = ?
      ORDER BY u.first_name, u.last_name`).all(req.params.id);
    res.json({
      receipts: rows.map((r) => ({
        userId: r.user_id,
        name: [r.first_name, r.last_name].filter(Boolean).join(" ") || "Caregiver",
        state: r.replied_at ? "replied" : r.got_it_at ? "got_it" : r.seen_at ? "seen" : "not_opened",
        seenAt: r.seen_at || null, gotItAt: r.got_it_at || null, repliedAt: r.replied_at || null,
      })),
    });
  } catch (err) {
    captureException(err);
    res.status(500).json({ error: "Couldn't load who read it." });
  }
});

router.post("/admin", admin, async (req, res) => {
  const v = validate(req.body);
  if (v.error) return res.status(400).json({ error: v.error });
  try {
    const db = await getDb();
    const id = uuid();
    await db.prepare(
      "INSERT INTO caregiver_updates (id, kind, title, body, created_by) VALUES (?, ?, ?, ?, ?)"
    ).run(id, v.kind, v.title, v.body, req.user.id);
    const audience = (await db.prepare(AUDIENCE_SQL).all()).map((r) => r.id).filter((uid) => uid !== req.user.id);
    for (const uid of audience) {
      await db.prepare(
        "INSERT INTO caregiver_update_receipts (update_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING"
      ).run(id, uid);
    }
    const sender = await db.prepare("SELECT first_name FROM users WHERE id = ?").get(req.user.id);
    const label = v.kind === "tip" ? "a tip" : v.kind === "thanks" ? "a note" : "an update";
    const { sendPushToUser } = require("./push");
    const emitToUser = req.app.get("emitToUser");
    for (const uid of audience) {
      sendPushToUser(uid, {
        title: "From InPlace",
        body: `${(sender && sender.first_name) || "InPlace"} sent ${label} for caregivers`,
        data: { type: "caregiver_update", updateId: id, url: "/" },
      }, "caregiver_update").catch(() => {});
      if (emitToUser) emitToUser(uid, "caregiver_update", { id });
    }
    res.status(201).json({ id, sentTo: audience.length });
  } catch (err) {
    captureException(err);
    res.status(500).json({ error: "Couldn't send it." });
  }
});

// Fix a typo after sending. No new push.
router.patch("/admin/:id", admin, async (req, res) => {
  const v = validate(req.body);
  if (v.error) return res.status(400).json({ error: v.error });
  try {
    const db = await getDb();
    const r = await db.prepare(
      "UPDATE caregiver_updates SET kind = ?, title = ?, body = ?, edited_at = NOW() WHERE id = ? AND withdrawn_at IS NULL"
    ).run(v.kind, v.title, v.body, req.params.id);
    if (!r.changes) return res.status(404).json({ error: "Not found." });
    res.json({ ok: true });
  } catch (err) {
    captureException(err);
    res.status(500).json({ error: "Couldn't save it." });
  }
});

router.post("/admin/:id/withdraw", admin, async (req, res) => {
  try {
    const db = await getDb();
    const r = await db.prepare(
      "UPDATE caregiver_updates SET withdrawn_at = NOW() WHERE id = ? AND withdrawn_at IS NULL"
    ).run(req.params.id);
    if (!r.changes) return res.status(404).json({ error: "Not found." });
    res.json({ ok: true });
  } catch (err) {
    captureException(err);
    res.status(500).json({ error: "Couldn't withdraw it." });
  }
});

// ─── Caregiver ───

router.get("/mine", async (req, res) => {
  try {
    const db = await getDb();
    if (!(await isCaregiver(db, req.user.id))) return res.json({ pinned: null, history: [] });
    // A caregiver who joined after an update went out still gets the recent ones (no push).
    await db.prepare(`
      INSERT INTO caregiver_update_receipts (update_id, user_id)
      SELECT u.id, ? FROM caregiver_updates u
      WHERE u.withdrawn_at IS NULL AND u.created_by IS DISTINCT FROM ?
        AND u.created_at > NOW() - INTERVAL '${BACKFILL_DAYS} days'
      ON CONFLICT DO NOTHING`).run(req.user.id, req.user.id);
    const rows = await db.prepare(`
      SELECT u.*, r.seen_at, r.got_it_at, r.replied_at,
             s.first_name AS sender_first, s.last_name AS sender_last
      FROM caregiver_update_receipts r
      JOIN caregiver_updates u ON u.id = r.update_id
      LEFT JOIN users s ON s.id = u.created_by
      WHERE r.user_id = ? AND u.withdrawn_at IS NULL
      ORDER BY u.created_at DESC LIMIT 50`).all(req.user.id);
    const history = rows.map(shape);
    // Pinned: the newest one she has not said "Got it" to. Replying also settles it.
    const pinned = history.find((u) => !u.gotItAt && !u.repliedAt) || null;
    res.json({ pinned, history });
  } catch (err) {
    captureException(err);
    res.status(500).json({ error: "Couldn't load updates." });
  }
});

async function ownReceipt(db, updateId, userId) {
  return db.prepare(`
    SELECT r.*, u.title, u.created_by FROM caregiver_update_receipts r
    JOIN caregiver_updates u ON u.id = r.update_id
    WHERE r.update_id = ? AND r.user_id = ? AND u.withdrawn_at IS NULL`).get(updateId, userId);
}

router.post("/:id/seen", async (req, res) => {
  try {
    const db = await getDb();
    if (!(await ownReceipt(db, req.params.id, req.user.id))) return res.status(404).json({ error: "Not found." });
    await db.prepare(
      "UPDATE caregiver_update_receipts SET seen_at = COALESCE(seen_at, NOW()) WHERE update_id = ? AND user_id = ?"
    ).run(req.params.id, req.user.id);
    res.json({ ok: true });
  } catch (err) {
    captureException(err);
    res.status(500).json({ error: "Couldn't save that." });
  }
});

router.post("/:id/got-it", async (req, res) => {
  try {
    const db = await getDb();
    if (!(await ownReceipt(db, req.params.id, req.user.id))) return res.status(404).json({ error: "Not found." });
    await db.prepare(
      "UPDATE caregiver_update_receipts SET seen_at = COALESCE(seen_at, NOW()), got_it_at = COALESCE(got_it_at, NOW()) WHERE update_id = ? AND user_id = ?"
    ).run(req.params.id, req.user.id);
    res.json({ ok: true });
  } catch (err) {
    captureException(err);
    res.status(500).json({ error: "Couldn't save that." });
  }
});

// The reply is a private direct message to whoever sent the update, in their personal thread
// (never a system thread — utils/conversations.js), quoting the update's title so the sender
// knows which one it answers.
router.post("/:id/reply", async (req, res) => {
  const text = clean(req.body && req.body.text, REPLY_MAX);
  if (!text) return res.status(400).json({ error: "Write a reply first." });
  try {
    const db = await getDb();
    const receipt = await ownReceipt(db, req.params.id, req.user.id);
    if (!receipt || !receipt.created_by) return res.status(404).json({ error: "Not found." });
    const to = receipt.created_by;
    const me = req.user.id;
    const { findPersonalDirectConversation } = require("../utils/conversations");
    let conv = await findPersonalDirectConversation(db, me, to);
    let convId = conv && conv.id;
    if (!convId) {
      convId = uuid();
      await db.prepare("INSERT INTO conversations (id, type, created_by) VALUES (?, 'direct', ?)").run(convId, me);
      await db.prepare("INSERT INTO conversation_members (id, conversation_id, user_id, role) VALUES (?, ?, ?, 'member')").run(uuid(), convId, me);
      await db.prepare("INSERT INTO conversation_members (id, conversation_id, user_id, role) VALUES (?, ?, ?, 'member')").run(uuid(), convId, to);
    }
    const content = `Re: “${receipt.title}”\n${text}`;
    const msgId = uuid();
    await db.prepare(
      "INSERT INTO messages (id, sender_id, recipient_id, content, conversation_id) VALUES (?, ?, ?, ?, ?)"
    ).run(msgId, me, to, content, convId);
    await db.prepare("UPDATE conversations SET updated_at = NOW() WHERE id = ?").run(convId);
    await db.prepare(
      "UPDATE conversation_members SET last_read_at = NOW() WHERE conversation_id = ? AND user_id = ?"
    ).run(convId, me);
    await db.prepare(
      "UPDATE caregiver_update_receipts SET seen_at = COALESCE(seen_at, NOW()), replied_at = NOW() WHERE update_id = ? AND user_id = ?"
    ).run(req.params.id, me);

    const message = await db.prepare("SELECT * FROM messages WHERE id = ?").get(msgId);
    const sender = await db.prepare("SELECT first_name, last_name FROM users WHERE id = ?").get(me);
    const name = sender ? [sender.first_name, sender.last_name].filter(Boolean).join(" ") : "A caregiver";
    const { sendPushToUser } = require("./push");
    sendPushToUser(to, {
      title: "InPlace",
      body: `${name} replied to your update`,
      data: { type: "message", senderId: me, conversationId: convId },
    }).catch(() => {});
    const emitToUser = req.app.get("emitToUser");
    if (emitToUser) {
      emitToUser(to, "new_message", { ...message, senderName: name, senderLabel: null, reactions: [], type: "received", conversationId: convId });
    }
    res.status(201).json({ ok: true, conversationId: convId });
  } catch (err) {
    captureException(err);
    res.status(500).json({ error: "Couldn't send your reply." });
  }
});

module.exports = router;
module.exports._test = { validate, AUDIENCE_SQL, KINDS };
