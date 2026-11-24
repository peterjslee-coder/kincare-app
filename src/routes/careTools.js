// ─── GET /api/care-tools/status (v1.114.0) ───
// Whether the signed-in person's care tools are open, and — when they are not — how much care
// booked through InPlace (at their own fee) would open them. See utils/careTools.js.
const express = require("express");
const { getDb } = require("../models/database");
const { authenticate } = require("../middleware/auth");
const { careToolsFor, FEATURES } = require("../utils/careTools");
const { captureException } = require("../utils/sentry");

const router = express.Router();
router.use(authenticate);

router.get("/status", async (req, res) => {
  try {
    const db = await getDb();
    const s = await careToolsFor(db, req.user.id);
    res.json({
      status: s.status,
      locked: s.status === "locked",
      windowDays: s.windowDays,
      careNeededCents: s.status === "locked" ? s.careNeededCents : 0,
      features: FEATURES,
    });
  } catch (err) {
    captureException(err, { where: "GET /api/care-tools/status" });
    // Unknown is not "locked": the server still enforces, the screen just doesn't nag.
    res.json({ status: "unknown", locked: false, windowDays: 30, careNeededCents: 0, features: FEATURES });
  }
});

module.exports = router;
