const express = require("express");
const router = express.Router();
const { authenticate } = require("../middleware/auth");
const { getDb } = require("../models/database");
const { generateCareIntelligence, generateSessionSummary, analyzePatterns, gatherVisitData, generateCarePlan } = require("../utils/careIntelligence");

// ─── GET /api/care-intelligence/:recipientId — Generate full care intelligence report ───
router.get("/:recipientId", authenticate, async (req, res) => {
  try {
    const db = await getDb();

    // Verify care recipient exists
    const recipient = await db.prepare("SELECT * FROM care_recipients WHERE id = ?").get(req.params.recipientId);
    if (!recipient) return res.status(404).json({ error: "Care recipient not found", recipientId: req.params.recipientId });

    // Check access: owner, care team, caregiver, or admin
    const isOwner = recipient.family_id === req.user.id;
    const isAdmin = await db.prepare("SELECT is_admin FROM users WHERE id = ?").get(req.user.id);
    let hasAccess = isOwner || !!isAdmin?.is_admin;

    if (!hasAccess) {
      try {
        const isTeamMember = await db.prepare(
          "SELECT 1 FROM care_team_members WHERE care_recipient_id = ? AND user_id = ? AND status = 'accepted'"
        ).get(req.params.recipientId, req.user.id);
        if (isTeamMember) hasAccess = true;
      } catch {}
    }
    if (!hasAccess) {
      try {
        const isCaregiver = await db.prepare(
          "SELECT 1 FROM caregiver_assignments WHERE care_recipient_id = ? AND caregiver_user_id = ? AND status = 'active'"
        ).get(req.params.recipientId, req.user.id);
        if (isCaregiver) hasAccess = true;
      } catch {}
    }

    if (!hasAccess) {
      return res.status(403).json({ error: "Access denied" });
    }

    console.log(`[iPAi] Generating care intelligence for recipient ${req.params.recipientId} by user ${req.user.id}`);
    const result = await generateCareIntelligence(req.params.recipientId);

    if (result.error) {
      console.error("[iPAi] Care intelligence returned error:", result.error);
    }

    // Always return 200 with whatever we got — partial data is better than nothing
    res.json(result);
  } catch (err) {
    console.error("[iPAi] Care intelligence route CRASH:", err.message, err.stack);
    res.status(500).json({ error: "Failed to generate care intelligence", detail: err.message });
  }
});

// ─── GET /api/care-intelligence/test — Test AI connectivity ───
router.get("/test/ai", authenticate, async (req, res) => {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.json({ error: "ANTHROPIC_API_KEY not set", hasKey: false });

    const Anthropic = require("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey });
    const result = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 50,
      messages: [{ role: "user", content: "Say 'iPAi is working' and nothing else." }],
    });
    const text = result.content?.[0]?.text || "";
    res.json({ success: true, response: text, model: "claude-haiku-4-5-20251001" });
  } catch (err) {
    res.json({ error: err.message, type: err.constructor.name, stack: err.stack?.split("\n").slice(0, 3) });
  }
});

// ─── GET /api/care-intelligence/test/data/:recipientId — Diagnose data pipeline ───
router.get("/test/data/:recipientId", authenticate, async (req, res) => {
  const steps = {};
  try {
    const db = await getDb();
    steps.dbConnected = true;

    const recipient = await db.prepare("SELECT id, first_name, health_conditions, family_id FROM care_recipients WHERE id = ?").get(req.params.recipientId);
    steps.recipient = recipient ? { id: recipient.id, name: recipient.first_name, familyId: recipient.family_id } : null;
    if (!recipient) return res.json({ steps, error: "Recipient not found" });

    try {
      const visits = await db.prepare(`
        SELECT COUNT(*) as count FROM visit_logs vl
        JOIN care_sessions cs ON vl.session_id = cs.id
        WHERE cs.care_recipient_id = ?
      `).get(req.params.recipientId);
      steps.visitLogCount = parseInt(visits.count);
    } catch (e) { steps.visitLogError = e.message; }

    try {
      const sessions = await db.prepare(`
        SELECT COUNT(*) as count FROM care_sessions WHERE care_recipient_id = ?
      `).get(req.params.recipientId);
      steps.sessionCount = parseInt(sessions.count);
    } catch (e) { steps.sessionError = e.message; }

    try {
      const notes = await db.prepare(`
        SELECT COUNT(*) as count FROM recipient_notes WHERE care_recipient_id = ?
      `).get(req.params.recipientId);
      steps.noteCount = parseInt(notes.count);
    } catch (e) { steps.noteError = e.message; }

    // Test the full gatherVisitData
    try {
      const data = await gatherVisitData(req.params.recipientId);
      steps.gatherVisitData = data ? {
        hasRecipient: !!data.recipient,
        visitCount: data.visits?.length || 0,
        noteCount: data.careNotes?.length || 0,
        reviewCount: data.reviews?.length || 0,
      } : null;
    } catch (e) { steps.gatherError = e.message; }

    // Test a minimal AI call with the data
    try {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (apiKey) {
        const Anthropic = require("@anthropic-ai/sdk");
        const client = new Anthropic({ apiKey });
        const result = await client.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 100,
          messages: [{ role: "user", content: `Say "Ready to analyze ${recipient.first_name}'s care data" and nothing else.` }],
        });
        steps.aiCall = { success: true, response: result.content?.[0]?.text };
      } else {
        steps.aiCall = { error: "No API key" };
      }
    } catch (e) { steps.aiCall = { error: e.message }; }

    res.json({ steps, allGood: !Object.values(steps).some(v => v?.error) });
  } catch (err) {
    res.json({ steps, error: err.message });
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
