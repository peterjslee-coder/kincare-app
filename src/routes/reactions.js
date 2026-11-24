// ─── POST /api/reactions/:targetType/:targetId (v1.105.170) ───
//
// One endpoint for every kind of thing a person can react to. What makes that safe rather
// than lazy is that the target type is not a free string: it has to be in the TARGETS table
// in utils/reactions.js, and each entry there says how to find the care recipient the row
// belongs to. Authorisation is then the ordinary question this app asks everywhere —
// "may this person see this recipient's record" — via the canonical recipientAccess().
//
// The alternative, a reactions route per feature, is how "socialize anywhere we're leaving
// feedback" turns into three implementations that drift.

const express = require("express");
const { getDb } = require("../models/database");
const { authenticate } = require("../middleware/auth");
const { recipientAccess } = require("../utils/access");
const { captureException } = require("../utils/sentry");
const {
  ALLOWED_EMOJIS, TARGETS, isKnownTarget, toggleReaction, reactionsFor,
} = require("../utils/reactions");

const router = express.Router();
router.use(authenticate);

// Resolve the target and the caller's right to see it, or say what is wrong.
// Convention from utils/access.js: a failed check answers 404, not 403 — "you may not see
// this" and "this does not exist" must be indistinguishable to someone probing ids.
async function resolveTarget(db, targetType, targetId, userId) {
  if (!isKnownTarget(targetType)) return { error: 400, message: "Unknown target type" };
  const recipientId = await TARGETS[targetType].recipientOf(db, targetId);
  if (!recipientId) return { error: 404, message: "Not found" };
  const access = await recipientAccess(db, recipientId, userId);
  if (!access) return { error: 404, message: "Not found" };
  return { recipientId, access };
}

// GET — the current list for one target. The client gets reactions inlined with the notes and
// visits it already fetches, so this is for reconciling after a write elsewhere rather than
// for first paint.
router.get("/:targetType/:targetId", async (req, res) => {
  try {
    const db = await getDb();
    const { targetType, targetId } = req.params;
    const t = await resolveTarget(db, targetType, targetId, req.user.id);
    if (t.error) return res.status(t.error).json({ error: t.message });
    res.json({ reactions: await reactionsFor(db, targetType, targetId) });
  } catch (err) {
    captureException(err, { where: "GET /api/reactions" });
    res.status(500).json({ error: "Failed to load reactions" });
  }
});

// POST — toggle this person's reaction. Same emoji removes it, a different one replaces it.
router.post("/:targetType/:targetId", async (req, res) => {
  try {
    const db = await getDb();
    const { targetType, targetId } = req.params;
    const { emoji } = req.body || {};

    if (!emoji || !ALLOWED_EMOJIS.includes(emoji)) {
      return res.status(400).json({ error: "Invalid emoji" });
    }

    const t = await resolveTarget(db, targetType, targetId, req.user.id);
    if (t.error) return res.status(t.error).json({ error: t.message });

    const { action, reactions } = await toggleReaction(db, {
      targetType, targetId, userId: req.user.id, emoji,
    });

    // No push. Pete, asked whether reacting should notify: "app only, yes." A reaction is a
    // nod — the smallest thing a person can say — and a phone buzzing for one is the reason
    // people turn notifications off for everything else too. It shows up when you next look.
    res.json({ action, reactions });
  } catch (err) {
    captureException(err, { where: "POST /api/reactions" });
    res.status(500).json({ error: "Failed to save reaction" });
  }
});

module.exports = router;
