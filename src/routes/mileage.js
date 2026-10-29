// ─── /api/mileage — visit mileage (v1.126.0) ───
//
// The family's settings, the caregiver's trip calculator, the visit's summary, and the
// leader's decision on miles past the cap. All arithmetic and every distance live in
// utils/mileage.js; this file is who-may-do-what.
//
//   GET    /settings/:recipientId           anyone with access to the loved one
//   PUT    /settings/:recipientId           the care team leader (or the record's owner)
//   GET    /sessions/:sessionId             anyone who can see the visit
//   POST   /sessions/:sessionId/quote       the visit's caregiver, during the visit
//   POST   /sessions/:sessionId/trips       the visit's caregiver, during the visit
//   DELETE /trips/:tripId                   the caregiver who logged it, until check-out
//   POST   /sessions/:sessionId/extra       the leader: { approve: true | false }
//
// Failed access answers 404, per utils/access.js.
const express = require("express");
const { authenticate } = require("../middleware/auth");
const { blockWhileImpersonating } = require("../middleware/noImpersonation");
const { getDb } = require("../models/database");
const { recipientAccess, sessionAccess } = require("../utils/access");
const { consumeDaily } = require("../utils/usageLimits");
const { captureException } = require("../utils/sentry");
const mileage = require("../utils/mileage");

const router = express.Router();
router.use(authenticate);

const publicSettings = (s, canEdit) => {
  if (!s) return null;
  const { _row, ...rest } = s;
  return { ...rest, canEdit: !!canEdit };
};

async function canEditSettings(db, recipientId, userId, isAdminLevel) {
  if (isAdminLevel) return true;
  return mileage.isLeaderOrOwner(db, recipientId, userId);
}

router.get("/settings/:recipientId", async (req, res) => {
  try {
    const db = await getDb();
    const level = await recipientAccess(db, req.params.recipientId, req.user.id);
    if (!level) return res.status(404).json({ error: "Not found" });
    const s = await mileage.settingsFor(db, req.params.recipientId);
    if (!s) return res.status(404).json({ error: "Not found" });
    const canEdit = await canEditSettings(db, req.params.recipientId, req.user.id, level === "admin");
    res.json({ settings: publicSettings(s, canEdit) });
  } catch (err) {
    captureException(err, { where: "mileage: get settings" });
    res.status(500).json({ error: "Couldn't load the mileage settings." });
  }
});

router.put("/settings/:recipientId", async (req, res) => {
  try {
    const db = await getDb();
    const level = await recipientAccess(db, req.params.recipientId, req.user.id);
    if (!level) return res.status(404).json({ error: "Not found" });
    if (!(await canEditSettings(db, req.params.recipientId, req.user.id, level === "admin"))) {
      return res.status(403).json({ error: "Only the care team leader can change mileage." });
    }
    const out = await mileage.saveSettings(db, req.params.recipientId, req.user.id, req.body || {});
    if (out.error) return res.status(400).json({ error: out.error });
    res.json({ settings: publicSettings(out.settings, true) });
  } catch (err) {
    captureException(err, { where: "mileage: save settings" });
    res.status(500).json({ error: "Couldn't save the mileage settings." });
  }
});

router.get("/sessions/:sessionId", async (req, res) => {
  try {
    const db = await getDb();
    const acc = await sessionAccess(db, req.params.sessionId, req.user.id);
    if (!acc) return res.status(404).json({ error: "Not found" });
    const summary = await mileage.sessionSummary(db, acc.session);
    const canDecide = acc.session.mileage_extra_status === "pending"
      && (acc.isAdmin || (await mileage.isLeaderOrOwner(db, acc.session.care_recipient_id, req.user.id)));
    res.json({
      mileage: {
        ...summary,
        canLog: acc.isCaregiver && acc.session.status === "in_progress" && !acc.session.mileage_locked_at && summary.enabled,
        canDecideExtra: !!canDecide,
      },
    });
  } catch (err) {
    captureException(err, { where: "mileage: session summary" });
    res.status(500).json({ error: "Couldn't load mileage for this visit." });
  }
});

async function caregiverDuringVisit(db, req, res) {
  const acc = await sessionAccess(db, req.params.sessionId, req.user.id);
  if (!acc || !acc.isCaregiver) { res.status(404).json({ error: "Not found" }); return null; }
  if (acc.session.status !== "in_progress" || acc.session.mileage_locked_at) {
    res.status(400).json({ error: "Trips can only be logged during the visit." });
    return null;
  }
  return acc.session;
}

router.post("/sessions/:sessionId/quote", async (req, res) => {
  try {
    const db = await getDb();
    const session = await caregiverDuringVisit(db, req, res);
    if (!session) return;
    // Every quote may be a paid Google route call; a stuck client must not run up the bill.
    const quota = await consumeDaily(req.user.id, "mileage_quote", 150);
    if (!quota.allowed) return res.status(429).json({ error: "That's a lot of look-ups today. Try again tomorrow, or ask the family to add the trip." });
    const q = await mileage.quoteTrip(db, session, req.body || {});
    if (q.error) return res.status(400).json({ error: q.error, code: q.code });
    res.json({ trip: q.trip });
  } catch (err) {
    captureException(err, { where: "mileage: quote" });
    res.status(500).json({ error: "We couldn't work out the distance. Try again." });
  }
});

router.post("/sessions/:sessionId/trips", async (req, res) => {
  try {
    const db = await getDb();
    const session = await caregiverDuringVisit(db, req, res);
    if (!session) return;
    const quota = await consumeDaily(req.user.id, "mileage_quote", 150);
    if (!quota.allowed) return res.status(429).json({ error: "That's a lot of look-ups today. Try again tomorrow." });
    const out = await mileage.addTrip(db, session, req.user.id, req.body || {});
    if (out.error) return res.status(400).json({ error: out.error, code: out.code });
    const summary = await mileage.sessionSummary(db, session);
    res.status(201).json({ trip: out.trip, mileage: summary });
  } catch (err) {
    captureException(err, { where: "mileage: add trip" });
    res.status(500).json({ error: "Couldn't save the trip. Try again." });
  }
});

router.delete("/trips/:tripId", async (req, res) => {
  try {
    const db = await getDb();
    const t = await db.prepare(`
      SELECT vt.id, vt.session_id, vt.caregiver_user_id, cs.status, cs.mileage_locked_at
        FROM visit_trips vt JOIN care_sessions cs ON cs.id = vt.session_id
       WHERE vt.id = ? AND vt.deleted_at IS NULL
    `).get(req.params.tripId);
    if (!t || t.caregiver_user_id !== req.user.id) return res.status(404).json({ error: "Not found" });
    if (t.status !== "in_progress" || t.mileage_locked_at) {
      return res.status(400).json({ error: "Trips lock at check-out." });
    }
    await db.prepare("UPDATE visit_trips SET deleted_at = NOW() WHERE id = ?").run(t.id);
    const session = await db.prepare("SELECT * FROM care_sessions WHERE id = ?").get(t.session_id);
    res.json({ ok: true, mileage: await mileage.sessionSummary(db, session) });
  } catch (err) {
    captureException(err, { where: "mileage: delete trip" });
    res.status(500).json({ error: "Couldn't remove the trip." });
  }
});

router.post("/sessions/:sessionId/extra", blockWhileImpersonating("approve or decline extra mileage"), async (req, res) => {
  try {
    const db = await getDb();
    const acc = await sessionAccess(db, req.params.sessionId, req.user.id);
    if (!acc) return res.status(404).json({ error: "Not found" });
    if (!(await mileage.isLeaderOrOwner(db, acc.session.care_recipient_id, req.user.id))) {
      return res.status(403).json({ error: "Only the care team leader can decide extra mileage." });
    }
    if (typeof (req.body || {}).approve !== "boolean") return res.status(400).json({ error: "approve must be true or false" });
    const out = await mileage.decideExtra(db, acc.session, req.user.id, req.body.approve);
    if (out.error) return res.status(400).json({ error: out.error });
    const session = await db.prepare("SELECT * FROM care_sessions WHERE id = ?").get(acc.session.id);
    res.json({ status: out.status, charge: out.charge ? { charged: !!out.charge.charged, skipped: out.charge.skipped || null } : null,
      mileage: await mileage.sessionSummary(db, session) });
  } catch (err) {
    captureException(err, { where: "mileage: decide extra" });
    res.status(500).json({ error: "Couldn't save that. Try again." });
  }
});

module.exports = router;
