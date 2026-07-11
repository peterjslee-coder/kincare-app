const express = require("express");
const router = express.Router();
const { authenticate } = require("../middleware/auth");
const { getDb } = require("../models/database");
const { generateCareIntelligence, generateSessionSummary, analyzePatterns, gatherVisitData, generateCarePlan } = require("../utils/careIntelligence");
const { MODEL_HAIKU } = require("../utils/aiModels");
const { captureException } = require("../utils/sentry");

// ─── Shared access checks (IDOR guards) ───
// A user may see a recipient's care data if they own it, are an admin, are an
// accepted care-team member, or are an active assigned caregiver. Mirrors the
// inline check used by GET /:recipientId so all routes authorize consistently.
// v1.86.0: the team/caregiver access queries in this file referenced nonexistent
// columns since inception (care_team_members.status/care_recipient_id,
// caregiver_assignments.caregiver_user_id) — the two wrapped in try/catch always
// threw and silently DENIED team members + caregivers; the care-plan endpoints'
// unwrapped copies 500'd for everyone. Rewritten against the real schema.
async function userCanAccessRecipient(db, userId, recipientId) {
  const recipient = await db.prepare("SELECT family_user_id FROM care_recipients WHERE id = ?").get(recipientId);
  if (!recipient) return false;
  if (recipient.family_user_id === userId) return true;
  const admin = await db.prepare("SELECT is_admin FROM users WHERE id = ?").get(userId);
  if (admin?.is_admin) return true;
  try {
    const team = await db.prepare("SELECT 1 FROM care_team_members ctm JOIN care_teams ct ON ctm.care_team_id = ct.id WHERE ct.care_recipient_id = ? AND ctm.user_id = ?").get(recipientId, userId);
    if (team) return true;
  } catch (e) { captureException(e, { where: "careIntelligence: access check (care team)" }); }
  try {
    const cg = await db.prepare("SELECT 1 FROM caregiver_assignments ca JOIN caregiver_profiles cp ON ca.caregiver_profile_id = cp.id WHERE ca.care_recipient_id = ? AND cp.user_id = ? AND ca.is_active = 1").get(recipientId, userId);
    if (cg) return true;
  } catch (e) { captureException(e, { where: "careIntelligence: access check (caregiver assignment)" }); }
  return false;
}

async function userIsAdmin(db, userId) {
  const a = await db.prepare("SELECT is_admin FROM users WHERE id = ?").get(userId);
  return !!a?.is_admin;
}

// Resolve the recipient a session belongs to, then apply the recipient access check.
async function userCanAccessSession(db, userId, sessionId) {
  const sess = await db.prepare("SELECT care_recipient_id FROM care_sessions WHERE id = ?").get(sessionId);
  if (!sess) return null; // caller returns 404
  return await userCanAccessRecipient(db, userId, sess.care_recipient_id);
}

// ─── GET /api/care-intelligence/:recipientId — Generate full care intelligence report ───
router.get("/:recipientId", authenticate, async (req, res) => {
  try {
    const db = await getDb();

    // Verify care recipient exists
    const recipient = await db.prepare("SELECT * FROM care_recipients WHERE id = ?").get(req.params.recipientId);
    if (!recipient) return res.status(404).json({ error: "Care recipient not found", recipientId: req.params.recipientId });

    // Check access: owner, care team, caregiver, or admin
    const isOwner = recipient.family_user_id === req.user.id;
    const isAdmin = await db.prepare("SELECT is_admin FROM users WHERE id = ?").get(req.user.id);
    let hasAccess = isOwner || !!isAdmin?.is_admin;

    if (!hasAccess) {
      try {
        const isTeamMember = await db.prepare(
          "SELECT 1 FROM care_team_members ctm JOIN care_teams ct ON ctm.care_team_id = ct.id WHERE ct.care_recipient_id = ? AND ctm.user_id = ?"
        ).get(req.params.recipientId, req.user.id);
        if (isTeamMember) hasAccess = true;
      } catch (e) { captureException(e, { where: "careIntelligence: access check (team member)" }); }
    }
    // v1.77.0 — the intelligence report is a FAMILY artifact (it names financial and
    // other vulnerabilities). Caregivers get the check-in briefing, coaching, and the
    // caregiver-facing care summary instead — never this.

    if (!hasAccess) {
      return res.status(403).json({ error: "Access denied" });
    }

    // Check for cached intelligence — return it if fresh enough (< 24 hours or force=true to regenerate)
    // v1.58.71: cache lives in ai_care_intelligence (separate column) so we never clobber
    // the plain-text ai_care_summary written by /api/care-recipients/:id/generate-summary.
    let forceRegenerate = req.query.force === 'true';
    const cachedRaw = recipient.ai_care_intelligence;
    // v1.89.1 — self-heal: v1.77.0→v1.89.0 cached objects lost their narrative `paragraphs`
    // (normalizer bug) and also carry no legacy `insights`, so the card rendered as a bare
    // headline + watch list. Treat that shape as stale and regenerate instead of serving it.
    if (!forceRegenerate && typeof cachedRaw === 'string' && cachedRaw.trim().startsWith('{')) {
      try {
        const probe = JSON.parse(cachedRaw);
        const hasNarrative = Array.isArray(probe.paragraphs) && probe.paragraphs.length > 0;
        const hasLegacyInsights = Array.isArray(probe.insights) && probe.insights.length > 0;
        if (!hasNarrative && !hasLegacyInsights) {
          console.log(`[iPAi] Cached intelligence for ${req.params.recipientId} has no narrative/insights (v1.77 normalizer bug) — regenerating`);
          forceRegenerate = true;
        }
      } catch { /* unparseable cache — leave existing handling to deal with it */ }
    }
    if (!forceRegenerate && cachedRaw) {
      const updatedAt = recipient.ai_care_intelligence_updated_at;
      const ageMs = updatedAt ? (Date.now() - new Date(updatedAt).getTime()) : Infinity;
      const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
      if (ageMs < MAX_AGE_MS) {
        console.log(`[iPAi] Returning cached care intelligence for ${req.params.recipientId} (age: ${Math.round(ageMs / 60000)} min)`);
        // Re-hydrate stored JSON into an object so the client always gets the same shape.
        let cachedIntelligence = cachedRaw;
        try {
          if (typeof cachedRaw === 'string' && cachedRaw.trim().startsWith('{')) {
            cachedIntelligence = JSON.parse(cachedRaw);
          }
        } catch { /* fall back to raw string */ }
        const generatedAt = updatedAt || new Date().toISOString();
        try {
          const analysis = await analyzePatterns(req.params.recipientId);
          return res.json({ intelligence: cachedIntelligence, analysis, generatedAt, cached: true });
        } catch {
          return res.json({ intelligence: cachedIntelligence, generatedAt, cached: true });
        }
      }
    }

    console.log(`[iPAi] Generating care intelligence for recipient ${req.params.recipientId} by user ${req.user.id}`);
    const result = await generateCareIntelligence(req.params.recipientId);

    if (result.error) {
      console.error("[iPAi] Care intelligence returned error:", result.error);
    }

    // Cache the intelligence result so we don't re-call Claude every time.
    // v1.58.71: write to ai_care_intelligence, NOT ai_care_summary.
    if (result.intelligence) {
      try {
        const summaryStr = typeof result.intelligence === 'string' ? result.intelligence : JSON.stringify(result.intelligence);
        await db.prepare(
          "UPDATE care_recipients SET ai_care_intelligence = ?, ai_care_intelligence_updated_at = NOW() WHERE id = ?"
        ).run(summaryStr, req.params.recipientId);
        console.log(`[iPAi] Cached care intelligence for ${req.params.recipientId}`);
      } catch (cacheErr) {
        console.error("[iPAi] Failed to cache intelligence:", cacheErr.message);
      }
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
    const db = await getDb();
    if (!(await userIsAdmin(db, req.user.id))) return res.status(403).json({ error: "Access denied" });
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.json({ error: "ANTHROPIC_API_KEY not set", hasKey: false });

    const Anthropic = require("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey });
    const result = await client.messages.create({
      model: MODEL_HAIKU,
      max_tokens: 50,
      messages: [{ role: "user", content: "Say 'iPAi is working' and nothing else." }],
    });
    const text = result.content?.[0]?.text || "";
    res.json({ success: true, response: text, model: MODEL_HAIKU });
  } catch (err) {
    res.status(500).json({ error: "AI connectivity test failed" });
  }
});

// ─── GET /api/care-intelligence/test/data/:recipientId — Diagnose data pipeline ───
router.get("/test/data/:recipientId", authenticate, async (req, res) => {
  const steps = {};
  try {
    const db = await getDb();
    if (!(await userIsAdmin(db, req.user.id))) return res.status(403).json({ error: "Access denied" });
    steps.dbConnected = true;

    const recipient = await db.prepare("SELECT id, first_name, health_conditions, family_id FROM care_recipients WHERE id = ?").get(req.params.recipientId);
    steps.recipient = recipient ? { id: recipient.id, name: recipient.first_name, familyId: recipient.family_user_id } : null;
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
          model: MODEL_HAIKU,
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
    const db = await getDb();
    if (!(await userCanAccessRecipient(db, req.user.id, req.params.recipientId)))
      return res.status(403).json({ error: "Access denied" });
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
    const db = await getDb();
    const ok = await userCanAccessSession(db, req.user.id, req.params.sessionId);
    if (ok === null) return res.status(404).json({ error: "Session not found" });
    if (!ok) return res.status(403).json({ error: "Access denied" });
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
    const ok = await userCanAccessSession(db, req.user.id, req.params.sessionId);
    if (ok === null) return res.status(404).json({ error: "Session not found" });
    if (!ok) return res.status(403).json({ error: "Access denied" });
    // Check if coaching already exists
    const vl = await db.prepare("SELECT ai_coaching FROM visit_logs WHERE session_id = ?").get(req.params.sessionId);
    if (vl?.ai_coaching) {
      try { return res.json(JSON.parse(vl.ai_coaching)); } catch {} // expected: tolerated parse fallback
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
    } catch (e) { captureException(e, { where: "careIntelligence: cache coaching" }); }
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
    const isOwner = recipient.family_user_id === req.user.id;
    const isTeamMember = await db.prepare(
      "SELECT 1 FROM care_team_members ctm JOIN care_teams ct ON ctm.care_team_id = ct.id WHERE ct.care_recipient_id = ? AND ctm.user_id = ?"
    ).get(req.params.recipientId, req.user.id);
    const isCaregiver = await db.prepare(
      "SELECT 1 FROM caregiver_assignments ca JOIN caregiver_profiles cp ON ca.caregiver_profile_id = cp.id WHERE ca.care_recipient_id = ? AND cp.user_id = ? AND ca.is_active = 1"
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
    const isOwner = recipient.family_user_id === req.user.id;
    const isTeamMember = await db.prepare(
      "SELECT 1 FROM care_team_members ctm JOIN care_teams ct ON ctm.care_team_id = ct.id WHERE ct.care_recipient_id = ? AND ctm.user_id = ?"
    ).get(req.params.recipientId, req.user.id);
    const isCaregiver = await db.prepare(
      "SELECT 1 FROM caregiver_assignments ca JOIN caregiver_profiles cp ON ca.caregiver_profile_id = cp.id WHERE ca.care_recipient_id = ? AND cp.user_id = ? AND ca.is_active = 1"
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
