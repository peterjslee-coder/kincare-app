/**
 * iPAi Care Intelligence Engine
 *
 * Generates deep care insights by combining:
 * - Care recipient health conditions & profile
 * - Visit history (moods, condition tags, care notes)
 * - Session timing patterns
 * - Caregiver observations
 *
 * Uses Claude to synthesize behavioral observations with medical/care knowledge
 * to produce actionable guidance that only AI can connect.
 */

const { getDb } = require("../models/database");

/**
 * Gather all visit data for a care recipient
 */
async function gatherVisitData(careRecipientId) {
  const db = await getDb();

  // Get care recipient profile
  const recipient = await db.prepare(`
    SELECT cr.*, u.first_name, u.last_name
    FROM care_recipients cr
    LEFT JOIN users u ON cr.linked_user_id = u.id
    WHERE cr.id = ?
  `).get(careRecipientId);

  if (!recipient) return null;

  // Get all visit logs with caregiver info
  const visits = await db.prepare(`
    SELECT vl.*, cs.scheduled_date, cs.scheduled_time, cs.service_type,
      cs.duration_hours, cs.caregiver_id,
      u.first_name AS caregiver_first, u.last_name AS caregiver_last
    FROM visit_logs vl
    JOIN care_sessions cs ON vl.session_id = cs.id
    JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
    JOIN users u ON cp.user_id = u.id
    WHERE cs.care_recipient_id = ?
    ORDER BY cs.scheduled_date DESC, cs.scheduled_time DESC
  `).all(careRecipientId);

  // Get care notes from recipient_notes
  const careNotes = await db.prepare(`
    SELECT rn.*, u.first_name AS author_first, u.last_name AS author_last
    FROM recipient_notes rn
    LEFT JOIN users u ON rn.author_id = u.id
    WHERE rn.care_recipient_id = ?
    ORDER BY rn.created_at DESC
    LIMIT 30
  `).all(careRecipientId);

  // Get reviews related to sessions with this recipient
  const reviews = await db.prepare(`
    SELECT r.rating, r.comment, r.created_at,
      u.first_name AS reviewer_first
    FROM reviews r
    JOIN care_sessions cs ON r.session_id = cs.id
    JOIN users u ON r.reviewer_id = u.id
    WHERE cs.care_recipient_id = ?
    ORDER BY r.created_at DESC
    LIMIT 20
  `).all(careRecipientId);

  return { recipient, visits, careNotes, reviews };
}

/**
 * Analyze visit patterns without AI (fast, algorithmic)
 */
function analyzePatterns(visits) {
  if (!visits || visits.length === 0) return { patterns: [], stats: {} };

  const patterns = [];

  // Mood patterns by time of day
  const moodByTime = { morning: [], afternoon: [], evening: [] };
  for (const v of visits) {
    const hour = parseInt((v.check_in_time || v.scheduled_time || "12:00").split(":")[0]);
    const mood = v.departure_mood || v.mood_rating;
    if (mood) {
      const bucket = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
      moodByTime[bucket].push(typeof mood === "number" ? mood : mood.length); // rough numeric
    }
  }

  for (const [period, moods] of Object.entries(moodByTime)) {
    if (moods.length >= 2) {
      const avg = moods.reduce((a, b) => a + b, 0) / moods.length;
      patterns.push({ type: "mood_by_time", period, avgMood: avg, count: moods.length });
    }
  }

  // Condition tag frequency
  const tagCounts = {};
  for (const v of visits) {
    let tags = [];
    try { tags = JSON.parse(v.condition_tags || "[]"); } catch {}
    for (const tag of tags) {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    }
  }
  const frequentTags = Object.entries(tagCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([tag, count]) => ({ tag, count, pct: Math.round(count / visits.length * 100) }));

  // Caregiver effectiveness
  const caregiverStats = {};
  for (const v of visits) {
    const cg = v.caregiver_first || "Unknown";
    if (!caregiverStats[cg]) caregiverStats[cg] = { visits: 0, moods: [] };
    caregiverStats[cg].visits++;
    const mood = v.departure_mood || v.mood_rating;
    if (mood) caregiverStats[cg].moods.push(typeof mood === "number" ? mood : 3);
  }

  // Trend detection (last 5 vs previous 5)
  const recent = visits.slice(0, 5);
  const older = visits.slice(5, 10);
  let trendNote = null;
  if (recent.length >= 3 && older.length >= 3) {
    const recentTags = recent.flatMap(v => { try { return JSON.parse(v.condition_tags || "[]"); } catch { return []; } });
    const olderTags = older.flatMap(v => { try { return JSON.parse(v.condition_tags || "[]"); } catch { return []; } });

    const recentAnxious = recentTags.filter(t => t.toLowerCase().includes("anxious") || t.toLowerCase().includes("agitat")).length;
    const olderAnxious = olderTags.filter(t => t.toLowerCase().includes("anxious") || t.toLowerCase().includes("agitat")).length;
    if (recentAnxious > olderAnxious + 1) trendNote = "increasing_anxiety";

    const recentAppetite = recentTags.filter(t => t.toLowerCase().includes("no appetite") || t.toLowerCase().includes("ate little")).length;
    const olderAppetite = olderTags.filter(t => t.toLowerCase().includes("no appetite") || t.toLowerCase().includes("ate little")).length;
    if (recentAppetite > olderAppetite + 1) trendNote = trendNote ? trendNote + ",declining_appetite" : "declining_appetite";
  }

  return {
    patterns,
    frequentTags,
    caregiverStats,
    trendNote,
    stats: {
      totalVisits: visits.length,
      dateRange: visits.length > 0 ? `${visits[visits.length - 1].scheduled_date} to ${visits[0].scheduled_date}` : null,
    },
  };
}

/**
 * Generate deep care intelligence using Claude
 * This is the core iPAi feature — connects observations with medical knowledge
 */
async function generateCareIntelligence(careRecipientId) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { error: "AI not configured", insights: null };
  }

  const data = await gatherVisitData(careRecipientId);
  if (!data) return { error: "Care recipient not found", insights: null };

  const { recipient, visits, careNotes, reviews } = data;
  const analysis = analyzePatterns(visits);

  // Build a rich prompt with all the context
  const healthConditions = (() => {
    try { return JSON.parse(recipient.health_conditions || "[]"); } catch { return []; }
  })();
  const medications = (() => {
    try { return JSON.parse(recipient.medications || "[]"); } catch { return []; }
  })();

  const recipientName = recipient.first_name || "the care recipient";

  // Compile visit summaries (last 15)
  const visitSummaries = visits.slice(0, 15).map(v => {
    const tags = (() => { try { return JSON.parse(v.condition_tags || "[]"); } catch { return []; } })();
    return `${v.scheduled_date} ${v.scheduled_time || ""} with ${v.caregiver_first}: ` +
      `arrival mood=${v.arrival_mood || "?"}, departure mood=${v.departure_mood || "?"}, ` +
      `tags=[${tags.join(", ")}], ` +
      `notes: "${(v.care_feedback || v.summary || v.notes || "").substring(0, 200)}"`;
  }).join("\n");

  // Compile care notes (last 10)
  const notesSummary = careNotes.slice(0, 10).map(n =>
    `${n.created_at?.toString().substring(0, 10)} by ${n.author_first || "caregiver"}: "${(n.content || "").substring(0, 200)}"`
  ).join("\n");

  const prompt = `You are iPAi, the AI care intelligence system for InPlace, a care coordination platform. You have deep knowledge of geriatric care, dementia stages, behavioral patterns, and evidence-based care techniques.

CARE RECIPIENT: ${recipientName}
Age: ${recipient.age || "unknown"}
Health conditions: ${healthConditions.join(", ") || "none listed"}
Medications: ${medications.join(", ") || "none listed"}
Mobility: ${recipient.mobility || "unknown"}

VISIT DATA (${analysis.stats.totalVisits} visits${analysis.stats.dateRange ? `, ${analysis.stats.dateRange}` : ""}):
${visitSummaries || "No visits recorded yet."}

CARE NOTES:
${notesSummary || "No care notes yet."}

BEHAVIORAL PATTERNS DETECTED:
- Frequent condition tags: ${analysis.frequentTags.map(t => `${t.tag} (${t.pct}% of visits)`).join(", ") || "none yet"}
- Mood by time: ${analysis.patterns.filter(p => p.type === "mood_by_time").map(p => `${p.period}: avg ${p.avgMood.toFixed(1)}/5 (${p.count} visits)`).join(", ") || "insufficient data"}
- Trends: ${analysis.trendNote || "no significant trends detected"}

YOUR TASK: Generate a comprehensive care intelligence report for ${recipientName}'s family. This should be genuinely insightful — not just restating data, but CONNECTING observations with your knowledge of ${healthConditions[0] || "their condition"} to explain WHY things are happening and WHAT to do about it.

Structure your response as a JSON object:
{
  "headline": "One-sentence overall assessment (warm, clear, actionable)",
  "insights": [
    {
      "title": "Short insight title",
      "observation": "What the data shows",
      "explanation": "WHY this is happening — connect to medical/behavioral knowledge",
      "recommendation": "What the family or caregiver should DO about it",
      "priority": "high|medium|low"
    }
  ],
  "caregiverGuidance": "2-3 paragraphs of guidance specifically for caregivers working with ${recipientName}. Include communication techniques, things to watch for, and approaches that work best based on the data. Be specific and practical — not generic dementia advice.",
  "schedulingAdvice": "Based on mood/time patterns, when are the best times to schedule care? Be specific.",
  "watchList": ["Things the family should actively monitor based on trends"]
}

Be specific to ${recipientName}. Reference actual observations from the visit data. Don't be generic — if you see patterns, name them and explain what they mean for THIS person. If there isn't enough data for deep insights, say so honestly and suggest what data would help.

IMPORTANT: Return ONLY the JSON object, no markdown formatting or code blocks.`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5-20250514",
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("[iPAi] Claude API error:", response.status, errText);
      return { error: "AI service unavailable", insights: null, analysis };
    }

    const result = await response.json();
    const text = result.content?.[0]?.text || "";

    // Parse JSON response
    let intelligence;
    try {
      // Strip any markdown code block wrapper if present
      const cleaned = text.replace(/^```json?\n?/, "").replace(/\n?```$/, "").trim();
      intelligence = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error("[iPAi] Failed to parse AI response:", parseErr.message);
      // Return the raw text as a fallback
      intelligence = {
        headline: "Care intelligence generated",
        insights: [{ title: "AI Analysis", observation: text, explanation: "", recommendation: "", priority: "medium" }],
        caregiverGuidance: "",
        schedulingAdvice: "",
        watchList: [],
      };
    }

    return {
      intelligence,
      analysis,
      generatedAt: new Date().toISOString(),
      recipientName,
      model: "claude-sonnet-4-5-20250514",
    };
  } catch (err) {
    console.error("[iPAi] Care intelligence error:", err);
    return { error: err.message, insights: null, analysis };
  }
}

/**
 * Generate a post-session summary for the family
 * Called after caregiver checkout
 */
async function generateSessionSummary(sessionId) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const db = await getDb();

  const session = await db.prepare(`
    SELECT cs.*, cr.first_name AS recipient_name, cr.health_conditions,
      u.first_name AS caregiver_name,
      vl.arrival_mood, vl.departure_mood, vl.condition_tags,
      vl.care_feedback, vl.service_feedback, vl.summary
    FROM care_sessions cs
    JOIN care_recipients cr ON cs.care_recipient_id = cr.id
    JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
    JOIN users u ON cp.user_id = u.id
    LEFT JOIN visit_logs vl ON vl.session_id = cs.id
    WHERE cs.id = ?
  `).get(sessionId);

  if (!session || !session.care_feedback) return null;

  const conditions = (() => { try { return JSON.parse(session.health_conditions || "[]"); } catch { return []; } })();
  const tags = (() => { try { return JSON.parse(session.condition_tags || "[]"); } catch { return []; } })();

  const prompt = `You are iPAi, writing a warm post-session summary for a family about their loved one's care visit.

VISIT DETAILS:
- Care recipient: ${session.recipient_name}
- Health conditions: ${conditions.join(", ") || "not specified"}
- Caregiver: ${session.caregiver_name}
- Date: ${session.scheduled_date} at ${session.scheduled_time}
- Duration: ${session.duration_hours} hours
- Service: ${session.service_type}
- Arrival mood: ${session.arrival_mood || "not recorded"}
- Departure mood: ${session.departure_mood || "not recorded"}
- Condition tags: ${tags.join(", ") || "none"}
- Caregiver notes: "${session.care_feedback}"
${session.service_feedback ? `- Service notes: "${session.service_feedback}"` : ""}

Write a 3-4 sentence warm summary for the family. Be specific about what happened — reference actual observations. If the mood changed, note it. If there are concerning observations, flag them gently with a suggestion. End on a positive or constructive note. Keep it conversational, like a thoughtful caregiver texting the family.

Then provide 1-2 brief suggestions if the data warrants it (e.g., scheduling tips, things to watch for).

Return JSON:
{
  "summary": "The warm summary text",
  "suggestions": ["suggestion 1", "suggestion 2"],
  "moodChange": "improved|declined|stable|unknown"
}

Return ONLY the JSON, no markdown.`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 500,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) return null;

    const result = await response.json();
    const text = result.content?.[0]?.text || "";
    const cleaned = text.replace(/^```json?\n?/, "").replace(/\n?```$/, "").trim();
    return JSON.parse(cleaned);
  } catch (err) {
    console.error("[iPAi] Session summary error:", err);
    return null;
  }
}

module.exports = {
  gatherVisitData,
  analyzePatterns,
  generateCareIntelligence,
  generateSessionSummary,
};
