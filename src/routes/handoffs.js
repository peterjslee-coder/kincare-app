// ─── /api/handoffs — the note one caregiver leaves the next (v1.154.0) ───
//
// See src/utils/handoff.js for the rule. Who may see a hand-off: the caregiver who wrote it, the
// caregiver it is for, the person's family (owner, care team, shares) and admin. Not every
// caregiver on the team (Pete, 11/23).

const express = require("express");
const { v4: uuid } = require("uuid");
const { getDb } = require("../models/database");
const { authenticate } = require("../middleware/auth");
const { blockWhileImpersonating } = require("../middleware/noImpersonation");
const { sessionAccess, recipientAccess } = require("../utils/access");
const { isTeamOrOwner } = require("../utils/noteVisibility");
const { nextVisitAfter, buildSnapshot, CONDITIONS, CONDITION_LABELS } = require("../utils/handoff");

const router = express.Router();
router.use(authenticate);

const NOTE_MAX = 2000;

function shape(h, { you } = {}) {
  if (!h) return null;
  let snapshot = null;
  try { snapshot = h.snapshot ? JSON.parse(h.snapshot) : null; } catch { snapshot = null; }
  return {
    id: h.id,
    fromSessionId: h.from_session_id,
    toSessionId: h.to_session_id,
    fromFirstName: h.from_first_name || null,
    toFirstName: h.to_first_name || null,
    condition: h.condition || null,
    conditionLabel: h.condition ? (CONDITION_LABELS[h.condition] || h.condition) : null,
    note: h.note || null,
    snapshot,
    skipped: !!h.skipped,
    writtenAt: h.updated_at || h.created_at,
    readAt: h.read_at || null,
    you: you || null,
  };
}

const HANDOFF_SQL = `
  SELECT h.*, fu.first_name AS from_first_name, tu.first_name AS to_first_name
    FROM visit_handoffs h
    LEFT JOIN users fu ON fu.id = h.from_user_id
    LEFT JOIN users tu ON tu.id = h.to_user_id
`;

/** Family, or admin, for the person this visit is for. */
async function isFamilyViewer(db, recipientId, userId) {
  const level = await recipientAccess(db, recipientId, userId);
  if (!level) return false;
  if (level === "admin") return true;
  return isTeamOrOwner(db, recipientId, userId);
}

// ─── GET /api/handoffs/session/:sessionId ───
// For the OUTGOING caregiver: who is next, what her day already says, and her note if written.
// For the INCOMING caregiver: the note written for this visit.
// For the family: both directions for this visit.
router.get("/session/:sessionId", async (req, res) => {
  try {
    const db = await getDb();
    const acc = await sessionAccess(db, req.params.sessionId, req.user.id);
    if (!acc) return res.status(404).json({ error: "Not found" });
    const s = acc.session;
    const family = acc.isAdmin || (!acc.isCaregiver && await isFamilyViewer(db, s.care_recipient_id, req.user.id));
    if (!acc.isCaregiver && !family) return res.status(404).json({ error: "Not found" });

    const outgoing = await db.prepare(`${HANDOFF_SQL} WHERE h.from_session_id = ?`).get(s.id);
    const incoming = await db.prepare(`${HANDOFF_SQL} WHERE h.to_session_id = ? AND h.skipped = 0 ORDER BY h.updated_at DESC LIMIT 1`).get(s.id);

    const out = { incoming: null, outgoing: null, next: null, snapshot: null, conditions: CONDITIONS.map((k) => ({ key: k, label: CONDITION_LABELS[k] })) };
    // A caregiver sees what was left FOR her visit, and what she wrote from it — never the
    // hand-off between two other caregivers.
    if (incoming && (family || incoming.to_user_id === req.user.id)) out.incoming = shape(incoming, { you: incoming.to_user_id === req.user.id ? "to" : null });
    if (outgoing && (family || outgoing.from_user_id === req.user.id)) out.outgoing = shape(outgoing, { you: outgoing.from_user_id === req.user.id ? "from" : null });

    if (acc.isCaregiver && ["confirmed", "in_progress", "completed"].includes(s.status)) {
      const next = await nextVisitAfter(db, s);
      if (next) {
        out.next = { sessionId: next.sessionId, firstName: next.caregiverFirstName, date: next.date, time: next.time };
        if (!outgoing) {
          const cr = await db.prepare("SELECT timezone FROM care_recipients WHERE id = ?").get(s.care_recipient_id);
          out.snapshot = await buildSnapshot(db, s, cr?.timezone);
        }
      }
    }
    res.json(out);
  } catch (err) {
    console.error("Hand-off read error:", err);
    res.status(500).json({ error: "Could not load the hand-off" });
  }
});

// ─── POST /api/handoffs/session/:sessionId — write (or Skip) the note ───
router.post("/session/:sessionId", blockWhileImpersonating("write a hand-off"), async (req, res) => {
  try {
    const db = await getDb();
    const acc = await sessionAccess(db, req.params.sessionId, req.user.id);
    if (!acc || !acc.isCaregiver) return res.status(404).json({ error: "Not found" });
    const s = acc.session;
    if (!["in_progress", "completed"].includes(s.status)) {
      return res.status(400).json({ error: "A hand-off is written during or right after your visit" });
    }
    const next = await nextVisitAfter(db, s);
    if (!next) return res.status(400).json({ error: "No one else is coming right after this visit" });

    const skip = !!(req.body && req.body.skip);
    const condition = req.body && CONDITIONS.includes(req.body.condition) ? req.body.condition : null;
    const note = typeof req.body?.note === "string" ? req.body.note.trim().slice(0, NOTE_MAX) : "";
    if (!skip && !condition && !note) {
      return res.status(400).json({ error: "Tap how they are, or write a line" });
    }
    const cr = await db.prepare("SELECT timezone FROM care_recipients WHERE id = ?").get(s.care_recipient_id);
    const snapshot = skip ? null : JSON.stringify(await buildSnapshot(db, s, cr?.timezone));

    const existing = await db.prepare("SELECT id, skipped FROM visit_handoffs WHERE from_session_id = ?").get(s.id);
    let id = existing?.id;
    if (existing) {
      // A Skip never wipes a note that was sent; a note may replace a Skip.
      if (skip && !existing.skipped) return res.json({ success: true, alreadySent: true });
      await db.prepare(`
        UPDATE visit_handoffs SET to_session_id = ?, to_user_id = ?, condition = ?, note = ?, snapshot = ?,
               skipped = ?, updated_at = NOW()
         WHERE id = ?
      `).run(next.sessionId, next.caregiverUserId, condition, note || null, snapshot, skip ? 1 : 0, id);
    } else {
      id = uuid();
      await db.prepare(`
        INSERT INTO visit_handoffs (id, from_session_id, to_session_id, care_recipient_id, from_user_id, to_user_id,
                                    condition, note, snapshot, skipped)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (from_session_id) DO NOTHING
      `).run(id, s.id, next.sessionId, s.care_recipient_id, req.user.id, next.caregiverUserId,
        condition, note || null, snapshot, skip ? 1 : 0);
    }

    if (!skip && next.caregiverUserId) {
      try {
        const me = await db.prepare("SELECT first_name FROM users WHERE id = ?").get(req.user.id);
        const { sendPushToUser } = require("./push");
        // No condition or note on the lock screen — those are the PHI.
        await sendPushToUser(next.caregiverUserId, {
          title: `Hand-off from ${me?.first_name || "the caregiver before you"}`,
          body: "Read it before your visit.",
          data: { type: "visit_handoff", sessionId: next.sessionId, page: "dashboard" },
        }, "visit_handoff");
      } catch (e) { /* the note stands whether or not the push lands */ }
    }
    const row = await db.prepare(`${HANDOFF_SQL} WHERE h.id = ?`).get(id);
    res.json({ success: true, handoff: shape(row, { you: "from" }) });
  } catch (err) {
    console.error("Hand-off write error:", err);
    res.status(500).json({ error: "Could not save the hand-off" });
  }
});

// ─── POST /api/handoffs/:id/read — "Got it" from the caregiver it was for ───
router.post("/:id/read", async (req, res) => {
  try {
    const db = await getDb();
    const h = await db.prepare("SELECT id, to_user_id, read_at FROM visit_handoffs WHERE id = ?").get(req.params.id);
    if (!h || h.to_user_id !== req.user.id) return res.status(404).json({ error: "Not found" });
    await db.prepare("UPDATE visit_handoffs SET read_at = NOW() WHERE id = ? AND read_at IS NULL").run(h.id);
    const row = await db.prepare("SELECT read_at FROM visit_handoffs WHERE id = ?").get(h.id);
    res.json({ success: true, readAt: row?.read_at || null });
  } catch (err) {
    console.error("Hand-off read-receipt error:", err);
    res.status(500).json({ error: "Could not mark it read" });
  }
});

module.exports = router;
