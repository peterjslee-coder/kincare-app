// ─── Reactions, for anything (v1.105.170) ───
//
// Pete: "I'd like the option to carry this same thing over to people reacting to visits and
// care notes as well...socialize anywhere that we're leaving feedback." Then: "add the
// reactions into the notes section."
//
// "Socialize anywhere" only works if it is ONE feature rather than three that rhyme, so the
// knowledge about each kind of thing lives in exactly one place — the TARGETS table below —
// and everything else in this file is type-agnostic.
//
// Adding a third kind of thing is one entry there. It is deliberately not possible to add one
// without saying how to authorise it: the entry IS the authorisation rule.

const crypto = require("crypto");

// The same six the messages UI offers. A reaction is a nod, not a comment; an open emoji
// field would need moderation, and this is a care record.
const ALLOWED_EMOJIS = ["❤️", "👍", "👎", "😂", "😮", "🙏"];

// Each target type says how to find the care recipient the row belongs to. Access is then the
// same question it always is — "may this person see this recipient's record" — answered by
// the one canonical helper, so a reaction can never be visible where its subject is not.
const TARGETS = {
  note: {
    table: "recipient_notes",
    recipientOf: async (db, id) => {
      const row = await db.prepare(
        "SELECT care_recipient_id FROM recipient_notes WHERE id = ?"
      ).get(id);
      return row ? row.care_recipient_id : null;
    },
  },
  family_visit: {
    table: "family_visits",
    recipientOf: async (db, id) => {
      const row = await db.prepare(
        "SELECT care_recipient_id FROM family_visits WHERE id = ?"
      ).get(id);
      return row ? row.care_recipient_id : null;
    },
  },
};

const isKnownTarget = (t) => Object.prototype.hasOwnProperty.call(TARGETS, t);

const shape = (r) => ({
  emoji: r.emoji,
  userId: r.user_id,
  userName: [r.first_name, r.last_name].filter(Boolean).join(" ") || "Someone",
});

/**
 * Every reaction on one target, oldest first, shaped the way the client's ReactionBar wants:
 * { emoji, userId, userName }.
 */
async function reactionsFor(db, targetType, targetId) {
  if (!isKnownTarget(targetType) || !targetId) return [];
  const rows = await db.prepare(`
    SELECT r.emoji, r.user_id, u.first_name, u.last_name
    FROM reactions r
    JOIN users u ON u.id = r.user_id
    WHERE r.target_type = ? AND r.target_id = ?
    ORDER BY r.created_at
  `).all(targetType, targetId);
  return rows.map(shape);
}

/**
 * Reactions for a LIST of targets, in ONE query.
 *
 * The obvious version of this is a loop calling reactionsFor per row, which is a query per
 * note on a screen that shows fifty of them. `= ANY(?)` keeps it at one no matter how long
 * the care record gets.
 *
 * Returns a plain object keyed by target id; ids with no reactions are simply absent, so a
 * caller can do `map[row.id] || []`.
 */
async function reactionsForMany(db, targetType, targetIds) {
  const ids = [...new Set((targetIds || []).filter(Boolean))];
  if (!isKnownTarget(targetType) || !ids.length) return {};
  const rows = await db.prepare(`
    SELECT r.target_id, r.emoji, r.user_id, u.first_name, u.last_name
    FROM reactions r
    JOIN users u ON u.id = r.user_id
    WHERE r.target_type = ? AND r.target_id = ANY(?)
    ORDER BY r.created_at
  `).all(targetType, ids);
  const byTarget = {};
  for (const r of rows) {
    (byTarget[r.target_id] = byTarget[r.target_id] || []).push(shape(r));
  }
  return byTarget;
}

/**
 * Attach a `reactions` array to every row of a list, in one query. Rows with none get `[]`
 * rather than undefined — a client that has to test for both writes the bug twice.
 */
async function attachReactions(db, targetType, rows, idKey = "id") {
  const list = rows || [];
  if (!list.length) return list;
  const byTarget = await reactionsForMany(db, targetType, list.map((r) => r[idKey]));
  return list.map((r) => ({ ...r, reactions: byTarget[r[idKey]] || [] }));
}

/**
 * Toggle one person's reaction on one target.
 *
 * Same emoji again -> removed. A different emoji -> replaced. Nothing yet -> added. That is
 * the iMessage rule, and the UNIQUE index on (target_type, target_id, user_id) enforces it in
 * the database rather than in this function, so two fast taps cannot leave two rows behind.
 *
 * Returns { action, reactions } — the FULL list, not a delta, because a delta is only correct
 * if the client's copy was already correct, and someone else may have reacted since it loaded.
 */
async function toggleReaction(db, { targetType, targetId, userId, emoji }) {
  const existing = await db.prepare(
    "SELECT id, emoji FROM reactions WHERE target_type = ? AND target_id = ? AND user_id = ?"
  ).get(targetType, targetId, userId);

  let action;
  if (existing && existing.emoji === emoji) {
    await db.prepare("DELETE FROM reactions WHERE id = ?").run(existing.id);
    action = "removed";
  } else if (existing) {
    await db.prepare("UPDATE reactions SET emoji = ? WHERE id = ?").run(emoji, existing.id);
    action = "replaced";
  } else {
    await db.prepare(`
      INSERT INTO reactions (id, target_type, target_id, user_id, emoji)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (target_type, target_id, user_id) DO UPDATE SET emoji = EXCLUDED.emoji
    `).run(crypto.randomUUID(), targetType, targetId, userId, emoji);
    action = "added";
  }

  return { action, reactions: await reactionsFor(db, targetType, targetId) };
}

module.exports = {
  ALLOWED_EMOJIS,
  TARGETS,
  isKnownTarget,
  reactionsFor,
  reactionsForMany,
  attachReactions,
  toggleReaction,
};
