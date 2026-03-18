const express = require("express");
const router = express.Router();
const { authenticate } = require("../middleware/auth");
const { getDb } = require("../models/database");
const { generateCareIntelligence, generateSessionSummary, analyzePatterns, gatherVisitData } = require("../utils/careIntelligence");

// ─── GET /api/care-intelligence/:recipientId — Generate full care intelligence report ───
router.get("/:recipientId", authenticate, async (req, res) => {
  try {
    const db = await getDb();

    // Verify user has access to this care recipient (family member, care team, or admin)
    const recipient = await db.prepare("SELECT * FROM care_recipients WHERE id = ?").get(req.params.recipientId);
    if (!recipient) return res.status(404).json({ error: "Care recipient not found" });

    // Check access: owner, care team member, assigned caregiver, or admin
    const isOwner = recipient.family_id === req.user.id;
    const isTeamMember = await db.prepare(
      "SELECT 1 FROM care_team_members WHERE care_recipient_id = ? AND user_id = ? AND status = 'accepted'"
    ).get(req.params.recipientId, req.user.id);
    const isCaregiver = await db.prepare(
      "SELECT 1 FROM caregiver_assignments WHERE care_recipient_id = ? AND caregiver_user_id = ? AND status = 'active'"
    ).get(req.params.recipientId, req.user.id);
    const isAdmin = await db.prepare("SELECT is_admin FROM users WHERE id = ?").get(req.user.id);

    if (!isOwner && !isTeamMember && !isCaregiver && !isAdmin?.is_admin) {
      return res.status(403).json({ error: "Access denied" });
    }

    const result = await generateCareIntelligence(req.params.recipientId);
    res.json(result);
  } catch (err) {
    console.error("[iPAi] Care intelligence route error:", err);
    res.status(500).json({ error: "Failed to generate care intelligence" });
  }
});

// ─── GET /api/care-intelligence/:recipientId/patterns — Quick patterns (no AI call) ───
router.get("/:recipientId/patterns", authenticate, async (req, res) => {
  try {
    const data = await gatherVisitData(req.params.recipientId);
    if (!data) return res.status(404).json({ error: "Care recipient not found" });

    const analysis = analyzePatterns(data.visits);
    res.json({ analysis, visitCount: data.visits.length });
  } catch (err) {
    res.status(500).json({ error: "Failed to analyze patterns" });
  }
});

// ─── POST /api/care-intelligence/session-summary/:sessionId — Generate post-session summary ───
router.post("/session-summary/:sessionId", authenticate, async (req, res) => {
  try {
    const summary = await generateSessionSummary(req.params.sessionId);
    if (!summary) return res.status(404).json({ error: "Could not generate summary — missing visit data" });
    res.json(summary);
  } catch (err) {
    console.error("[iPAi] Session summary route error:", err);
    res.status(500).json({ error: "Failed to generate session summary" });
  }
});

module.exports = router;
