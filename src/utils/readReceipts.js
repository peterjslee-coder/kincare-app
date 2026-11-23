// ─── Read receipts on care notes and visit reports (v1.148.0) ───
//
// Pete, 11/22: "I want different care team members who review the care notes to be able to
// 'check' that they read it. I have no way of knowing whether or not my sis and bro are reading
// anything on app... there should be a big green 'Got it! - Mark Read'."
//
// A receipt is an explicit tap, never an inferred "opened". A note is a row in a list — there
// is no moment it is "opened" — and a visit sheet that pops up from a stray tap on Home is not
// someone reading it. The only honest signal is the person saying so.
//
// Same shape as utils/reactions.js: the TARGETS table is the whitelist AND the authorisation
// rule. Each entry says how to find the care recipient, who wrote the thing (they never need to
// mark their own), and whether a given person may read it.
//
// v1.149.1 — Pete: "I don't care who hasn't seen it. I care who has seen it and marked that
// they've read it." There is no "Not yet" list, and nothing here works one out: the only
// names a receipt ever carries are the people who tapped.

const crypto = require("crypto");

// The big button only for things from the last two weeks. Without a window, the day this
// ships every note in Betty's history would grow a green button — a wall of asks about things
// nobody was ever asked to confirm. "Seen by" shows on everything, whatever its age.
const ASK_WINDOW_DAYS = 14;

function withinAskWindow(createdAt, now = Date.now()) {
  if (!createdAt) return false;
  const t = new Date(createdAt).getTime();
  return Number.isFinite(t) && now - t <= ASK_WINDOW_DAYS * 24 * 3600 * 1000;
}

const TARGETS = {
  note: {
    async load(db, id) {
      const row = await db.prepare(
        "SELECT id, care_recipient_id, author_id, note_type, created_at FROM recipient_notes WHERE id = ?"
      ).get(id);
      if (!row) return null;
      return { recipientId: row.care_recipient_id, authorId: row.author_id, createdAt: row.created_at, row };
    },
    // The notes list's own rule, row by row — an observation hidden from someone must not be
    // markable for them either.
    async mayRead(db, t, userId) {
      const { noteAccess, noteRowReadable } = require("./noteVisibility");
      const na = await noteAccess(db, t.recipientId, userId);
      return noteRowReadable(na, t.row);
    },
  },
  session: {
    async load(db, id) {
      const row = await db.prepare(`
        SELECT cs.id, cs.care_recipient_id, cs.status, cp.user_id AS caregiver_user_id,
               vl.check_out_time, cs.updated_at
          FROM care_sessions cs
          LEFT JOIN caregiver_profiles cp ON cp.id = cs.caregiver_id
          LEFT JOIN visit_logs vl ON vl.session_id = cs.id
         WHERE cs.id = ?
      `).get(id);
      if (!row) return null;
      // Only a finished visit has a report to read.
      if (row.status !== "completed") return { recipientId: row.care_recipient_id, notReady: true };
      return {
        recipientId: row.care_recipient_id,
        authorId: row.caregiver_user_id,
        createdAt: row.check_out_time || row.updated_at,
        row,
      };
    },
    // The visit sheet's rule for showing the report (routes/sessions.js GET /:id).
    async mayRead(db, t, userId) {
      const { recipientCapabilities } = require("./access");
      const { can, CAP } = require("./capabilities");
      return can(await recipientCapabilities(db, t.recipientId, userId), CAP.READ_VISITS);
    },
  },
};

const isKnownTarget = (t) => Object.prototype.hasOwnProperty.call(TARGETS, t);

const nameOf = (r) => [r.first_name, r.last_name].filter(Boolean).join(" ") || "Someone";

async function receiptsForMany(db, targetType, ids) {
  const list = [...new Set((ids || []).filter(Boolean))];
  if (!isKnownTarget(targetType) || !list.length) return {};
  const rows = await db.prepare(`
    SELECT rr.target_id, rr.user_id, rr.read_at, u.first_name, u.last_name
      FROM read_receipts rr
      JOIN users u ON u.id = rr.user_id
     WHERE rr.target_type = ? AND rr.target_id = ANY(?)
     ORDER BY rr.read_at
  `).all(targetType, list);
  const by = {};
  for (const r of rows) {
    (by[r.target_id] = by[r.target_id] || []).push({ userId: r.user_id, name: nameOf(r), readAt: r.read_at });
  }
  return by;
}

/**
 * The block the client draws: who has read it, and whether the viewer is the one who should
 * be offered the button.
 */
function shapeBlock({ readBy, authorId, createdAt, viewerId, mayRead }) {
  const recent = withinAskWindow(createdAt);
  const mine = readBy.find((r) => r.userId === viewerId) || null;
  return {
    readBy,
    readByMe: !!mine,
    myReadAt: mine ? mine.readAt : null,
    // The writer never confirms their own note; a caregiver never confirms her own report.
    canMark: !!mayRead && viewerId !== authorId && (recent || !!mine),
  };
}

/**
 * Attach `readReceipts` to every note in a list that has already been through the visibility
 * filter (so the viewer may read each one). One receipts query for the whole page.
 */
async function attachNoteReceipts(db, notes, { viewerId }) {
  const list = notes || [];
  if (!list.length) return list;
  const by = await receiptsForMany(db, "note", list.map((n) => n.id));
  return list.map((n) => ({
    ...n,
    readReceipts: shapeBlock({
      readBy: by[n.id] || [], authorId: n.author_id,
      createdAt: n.created_at, viewerId, mayRead: true,
    }),
  }));
}

/** The block for one target, or null when it has none (not finished, not readable). */
async function blockFor(db, targetType, targetId, viewerId) {
  if (!isKnownTarget(targetType)) return null;
  const T = TARGETS[targetType];
  const t = await T.load(db, targetId);
  if (!t || t.notReady) return null;
  const mayRead = await T.mayRead(db, t, viewerId);
  const by = await receiptsForMany(db, targetType, [targetId]);
  return shapeBlock({
    readBy: by[targetId] || [], authorId: t.authorId,
    createdAt: t.createdAt, viewerId, mayRead,
  });
}

async function markRead(db, { targetType, targetId, userId }) {
  await db.prepare(`
    INSERT INTO read_receipts (id, target_type, target_id, user_id)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (target_type, target_id, user_id) DO NOTHING
  `).run(crypto.randomUUID(), targetType, targetId, userId);
}

async function unmarkRead(db, { targetType, targetId, userId }) {
  await db.prepare(
    "DELETE FROM read_receipts WHERE target_type = ? AND target_id = ? AND user_id = ?"
  ).run(targetType, targetId, userId);
}

module.exports = {
  ASK_WINDOW_DAYS, TARGETS, isKnownTarget, withinAskWindow, shapeBlock,
  receiptsForMany, attachNoteReceipts, blockFor, markRead, unmarkRead,
};
