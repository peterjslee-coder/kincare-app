const express = require("express");
const router = express.Router();
const { authenticate } = require("../middleware/auth");
const { getDb } = require("../models/database");
const { generateCareIntelligence, generateSessionSummary, analyzePatterns, gatherVisitData, generateCarePlan } = require("../utils/careIntelligence");

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
    if (result.error) {
      console.error("[iPAi] Care intelligence error:", result.error);
      // Still return the result — it may have partial data (analysis without AI)
      return res.status(result.error === "AI not configured" ? 503 : 200).json(result);
    }
    res.json(result);
  } catch (err) {
    console.error("[iPAi] Care intelligence route error:", err.message, err.stack);
    res.status(500).json({ error: "Failed to generate care intelligence", detail: err.message });
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

// ─── GET /api/care-intelligence/coaching/:sessionId — Get coaching tips for a completed session ───
router.get("/coaching/:sessionId", authenticate, async (req, res) => {
  try {
    const db = await getDb();
    // Check if coaching already exists
    const vl = await db.prepare("SELECT ai_coaching FROM visit_logs WHERE session_id = ?").get(req.params.sessionId);
    if (vl?.ai_coaching) {
      try { return res.json(JSON.parse(vl.ai_coaching)); } catch {}
    }
    // Generate on demand
    const { generateCaregiverCoaching } = require("../utils/careIntelligence");
    const coaching = await generateCaregiverCoaching(req.params.sessionId);
    if (!coaching) return res.status(404).json({ error: "Could not generate coaching — missing visit data" });
    // Store for next time
    try {
      await db.prepare("UPDATE visit_logs SET ai_coaching = ? WHERE session_id = ?").run(
        JSON.stringify(coaching), req.params.sessionId
      );
    } catch {}
    res.json(coaching);
  } catch (err) {
    console.error("[iPAi] Coaching route error:", err);
    res.status(500).json({ error: "Failed to generate coaching" });
  }
});

// ─── POST /api/care-intelligence/:recipientId/care-plan — Generate or regenerate the care plan ───
router.post("/:recipientId/care-plan", authenticate, async (req, res) => {
  try {
    const db = await getDb();

    // Verify user has access to this care recipient
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

    const result = await generateCarePlan(req.params.recipientId);

    if (result.carePlan) {
      // Store the care plan
      await db.prepare(
        "UPDATE care_recipients SET ai_care_plan = ?, ai_care_plan_updated_at = NOW() WHERE id = ?"
      ).run(JSON.stringify(result.carePlan), req.params.recipientId);
    }

    res.json(result);
  } catch (err) {
    console.error("[iPAi] Care plan generation error:", err);
    res.status(500).json({ error: "Failed to generate care plan" });
  }
});

// ─── GET /api/care-intelligence/:recipientId/care-plan — Retrieve the stored care plan ───
router.get("/:recipientId/care-plan", authenticate, async (req, res) => {
  try {
    const db = await getDb();

    // Verify user has access
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

    if (!recipient.ai_care_plan) {
      return res.status(404).json({ error: "Care plan not yet generated. Call POST to generate." });
    }

    let carePlan;
    try {
      carePlan = JSON.parse(recipient.ai_care_plan);
    } catch {
      carePlan = null;
    }

    res.json({
      carePlan,
      lastUpdated: recipient.ai_care_plan_updated_at,
      recipientName: recipient.first_name,
    });
  } catch (err) {
    console.error("[iPAi] Care plan retrieval error:", err);
    res.status(500).json({ error: "Failed to retrieve care plan" });
  }
});

module.exports = router;
