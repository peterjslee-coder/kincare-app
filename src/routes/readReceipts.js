// ─── /api/read-receipts/:targetType/:targetId (v1.148.0) ───
//
// Pete: "a big green 'Got it! - Mark Read'" on care notes and visit reports, so he can see
// whether his sister and brother are reading. POST marks, DELETE undoes, GET reconciles.
// Every answer is the whole block (readBy / readByMe / myReadAt / canMark), never a delta.
//
// Authorisation lives in utils/readReceipts.js TARGETS — the same rule that decides whether
// this person may READ the thing. 404 when they may not (utils/access.js convention).
// No push: a receipt is for looking at, not for buzzing anyone's phone.

const express = require("express");
const { getDb } = require("../models/database");
const { authenticate } = require("../middleware/auth");
const { captureException } = require("../utils/sentry");
const RR = require("../utils/readReceipts");

const router = express.Router();
router.use(authenticate);

async function resolve(db, targetType, targetId, userId) {
  if (!RR.isKnownTarget(targetType)) return { error: 400, message: "Unknown target type" };
  const T = RR.TARGETS[targetType];
  const t = await T.load(db, targetId);
  if (!t || !t.recipientId) return { error: 404, message: "Not found" };
  if (!(await T.mayRead(db, t, userId))) return { error: 404, message: "Not found" };
  if (t.notReady) return { error: 409, message: "There is no report to read yet" };
  return { t };
}

router.get("/:targetType/:targetId", async (req, res) => {
  try {
    const db = await getDb();
    const { targetType, targetId } = req.params;
    const r = await resolve(db, targetType, targetId, req.user.id);
    if (r.error) return res.status(r.error).json({ error: r.message });
    res.json({ readReceipts: await RR.blockFor(db, targetType, targetId, req.user.id) });
  } catch (err) {
    captureException(err, { where: "GET /api/read-receipts" });
    res.status(500).json({ error: "Could not load who has read this" });
  }
});

router.post("/:targetType/:targetId", async (req, res) => {
  try {
    const db = await getDb();
    const { targetType, targetId } = req.params;
    const r = await resolve(db, targetType, targetId, req.user.id);
    if (r.error) return res.status(r.error).json({ error: r.message });
    if (r.t.authorId && r.t.authorId === req.user.id) {
      return res.status(400).json({ error: "You wrote this one" });
    }
    await RR.markRead(db, { targetType, targetId, userId: req.user.id });
    res.json({ readReceipts: await RR.blockFor(db, targetType, targetId, req.user.id) });
  } catch (err) {
    captureException(err, { where: "POST /api/read-receipts" });
    res.status(500).json({ error: "Could not mark this read" });
  }
});

router.delete("/:targetType/:targetId", async (req, res) => {
  try {
    const db = await getDb();
    const { targetType, targetId } = req.params;
    const r = await resolve(db, targetType, targetId, req.user.id);
    if (r.error) return res.status(r.error).json({ error: r.message });
    await RR.unmarkRead(db, { targetType, targetId, userId: req.user.id });
    res.json({ readReceipts: await RR.blockFor(db, targetType, targetId, req.user.id) });
  } catch (err) {
    captureException(err, { where: "DELETE /api/read-receipts" });
    res.status(500).json({ error: "Could not undo that" });
  }
});

module.exports = router;
