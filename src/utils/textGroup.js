// ─── v1.133.0 — the person's simple-screen Text group, from the family's side ───
//
// v1.130.2 made the Text button one ordinary group conversation: the person (Betty) plus the
// people the leader picked. Pete, 11/18, on what a message to her means:
//
//   "Anyone that I've added to the simple screen messaging for betty gets that message. it sits
//    on betty's screen until she acknowledges it. Any reply or alert 'I have pain' etc shows up
//    there... They should get a notification that there's a message to betty (from me, in this
//    example)... I don't want to send mom a message, and immediately see a red dot show up over
//    my messages anchor because i have an unread message in a group chat from myself."
//
// The last part was already true (unread never counts your own messages; sending marks the
// thread read for you; push and socket go to the OTHER members only). This module adds:
//   - textGroupForConversation: is this conversation someone's Text group? (push wording)
//   - acknowledgeTextGroup: Betty's "Got it" — stamps acknowledged_at/by on what was waiting
//   - postIntoTextGroup: her "Tell the family" alert also lands in the group, with NO message
//     push, because the alert already sent one (one alert, one notification)

const { v4: uuid } = require("uuid");

/**
 * The care recipient whose Text group this conversation is, or null.
 * simple_mode is JSON in a TEXT column; LIKE narrows, parse confirms (a LIKE hit on an id that
 * merely appears elsewhere in the JSON is not a match).
 */
async function textGroupForConversation(db, convId) {
  if (!convId || typeof convId !== "string") return null;
  const { parseSimpleMode } = require("./simpleMode");
  const rows = await db.prepare(
    "SELECT id, first_name, called_by, linked_user_id, simple_mode FROM care_recipients WHERE simple_mode LIKE ?"
  ).all(`%${convId}%`);
  for (const r of rows) {
    const mode = parseSimpleMode(r.simple_mode);
    if (mode.textConversationId === convId) {
      return { id: r.id, firstName: r.called_by || r.first_name || "", linkedUserId: r.linked_user_id || null, on: mode.on };
    }
  }
  return null;
}

/**
 * The push body for a message posted into a Text group. No content (PHI rule, v1.105.39).
 * "Peter sent Betty a message"; when the person herself writes, "Betty sent a message".
 */
function textGroupPushBody(group, senderId, senderFirstName) {
  const name = group.firstName || "them";
  if (group.linkedUserId && senderId === group.linkedUserId) return `${name} sent a message`;
  return `${senderFirstName || "Someone"} sent ${name} a message`;
}

/**
 * Betty's "Got it". Every message from someone else that is still waiting is stamped as seen by
 * her, and the thread is marked read for her. Returns the ids stamped. Replying counts too: the
 * send route calls this when the person writes into her own group.
 */
async function acknowledgeTextGroup(db, convId, userId) {
  const rows = await db.prepare(`
    SELECT id FROM messages
    WHERE conversation_id = ? AND sender_id != ? AND acknowledged_at IS NULL AND COALESCE(is_deleted, 0) = 0
  `).all(convId, userId);
  if (rows.length) {
    await db.prepare(`
      UPDATE messages SET acknowledged_at = NOW(), acknowledged_by = ?
      WHERE conversation_id = ? AND sender_id != ? AND acknowledged_at IS NULL AND COALESCE(is_deleted, 0) = 0
    `).run(userId, convId, userId);
  }
  await db.prepare(
    "UPDATE conversation_members SET last_read_at = NOW() WHERE conversation_id = ? AND user_id = ?"
  ).run(convId, userId);
  return rows.map((r) => r.id);
}

/**
 * Post a message into the group as `senderId`, live to the other members, with no push.
 * Used for "Tell the family", whose own push already went out.
 */
async function postIntoTextGroup(db, app, { convId, senderId, senderName, content }) {
  const member = await db.prepare(
    "SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?"
  ).get(convId, senderId);
  if (!member) return null;
  const msgId = uuid();
  await db.prepare(
    "INSERT INTO messages (id, sender_id, recipient_id, content, conversation_id) VALUES (?, ?, ?, ?, ?)"
  ).run(msgId, senderId, senderId, content, convId);
  await db.prepare("UPDATE conversations SET updated_at = NOW() WHERE id = ?").run(convId);
  await db.prepare(
    "UPDATE conversation_members SET last_read_at = NOW() WHERE conversation_id = ? AND user_id = ?"
  ).run(convId, senderId);
  const message = await db.prepare("SELECT * FROM messages WHERE id = ?").get(msgId);
  const emitToUser = app && app.get ? app.get("emitToUser") : null;
  if (emitToUser) {
    const others = await db.prepare(
      "SELECT user_id FROM conversation_members WHERE conversation_id = ? AND user_id != ?"
    ).all(convId, senderId);
    for (const m of others) {
      emitToUser(m.user_id, "new_message", {
        ...message, senderName, senderLabel: null, reactions: [], type: "received", conversationId: convId,
      });
    }
  }
  return msgId;
}

module.exports = { textGroupForConversation, textGroupPushBody, acknowledgeTextGroup, postIntoTextGroup };
