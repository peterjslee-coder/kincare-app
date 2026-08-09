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
const { MODEL_HAIKU } = require("./aiModels");

// Parse mood value — handles both legacy single strings and new JSON arrays
function parseMoodDisplay(val) {
  if (!val) return null;
  try { const p = JSON.parse(val); if (Array.isArray(p)) return p.join(", "); } catch {} // expected: tolerated parse fallback
  return val;
}

/**
 * Helper: call Claude API using the Anthropic SDK (same as working careRecipients.js)
 */
async function callClaude(apiKey, model, maxTokens, messages, system) {
  const Anthropic = require("@anthropic-ai/sdk");
  // v1.105.51 — SDK default is a 10-minute timeout with 2 retries (~30 min held).
  const client = new Anthropic({ apiKey, timeout: 30000, maxRetries: 1 });
  const params = { model, max_tokens: maxTokens, messages };
  if (system) params.system = system;
  const result = await client.messages.create(params);
  return result.content?.[0]?.text || "";
}

/**
 * Gather all visit data for a care recipient
 */
async function gatherVisitData(careRecipientId) {
  const db = await getDb();

  // Get care recipient profile
  const recipient = await db.prepare(`
    SELECT cr.*, u.first_name AS linked_first_name, u.last_name AS linked_last_name
    FROM care_recipients cr
    LEFT JOIN users u ON cr.linked_user_id = u.id
    WHERE cr.id = ?
  `).get(careRecipientId);

  if (!recipient) return null;

  // Each query wrapped in try/catch — partial data is better than crashing
  let visits = [];
  try {
    visits = await db.prepare(`
      SELECT vl.*, cs.scheduled_date, cs.scheduled_time, cs.service_type,
        cs.duration_hours, cs.caregiver_id,
        u.first_name AS caregiver_first, u.last_name AS caregiver_last
      FROM visit_logs vl
      JOIN care_sessions cs ON vl.session_id = cs.id
      LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
      LEFT JOIN users u ON cp.user_id = u.id
      WHERE cs.care_recipient_id = ?
      ORDER BY cs.scheduled_date DESC, cs.scheduled_time DESC
    `).all(careRecipientId);
  } catch (e) { console.error("[iPAi] visits query failed:", e.message); }

  let careNotes = [];
  try {
    careNotes = await db.prepare(`
      SELECT rn.*, u.first_name AS author_first, u.last_name AS author_last
      FROM recipient_notes rn
      LEFT JOIN users u ON rn.author_id = u.id
      WHERE rn.care_recipient_id = ?
      ORDER BY rn.created_at DESC
      LIMIT 30
    `).all(careRecipientId);
  } catch (e) { console.error("[iPAi] notes query failed:", e.message); }

  let reviews = [];
  try {
    reviews = await db.prepare(`
      SELECT r.rating, r.comment, r.created_at,
        u.first_name AS reviewer_first
      FROM reviews r
      JOIN care_sessions cs ON r.session_id = cs.id
      LEFT JOIN users u ON r.reviewer_id = u.id
      WHERE cs.care_recipient_id = ?
      ORDER BY r.created_at DESC
      LIMIT 20
    `).all(careRecipientId);
  } catch (e) { console.error("[iPAi] reviews query failed:", e.message); }

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
    try { tags = JSON.parse(v.condition_tags || "[]"); } catch {} // expected: tolerated parse fallback
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
/**
 * Robust JSON extraction for iPAi care intelligence output.
 * Tries strategies in order; falls back to a stub only if all fail.
 * Always returns an object shaped like { headline, insights, caregiverGuidance, schedulingAdvice, watchList }.
 */
function parseIntelligenceJSON(text, recipientName) {
  if (!text || typeof text !== 'string') {
    return makeIntelligenceStub(recipientName, 'empty AI response');
  }

  const tryParse = (s) => {
    try { return JSON.parse(s); } catch { return null; }
  };

  // Strategy 1: strip markdown code fences and parse what's left.
  let cleaned = text.replace(/^[\s\S]*?```json?\s*\n?/i, "").replace(/\n?\s*```[\s\S]*$/, "").trim();
  if (!cleaned.startsWith("{")) {
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) cleaned = text.substring(firstBrace, lastBrace + 1);
  }
  let parsed = tryParse(cleaned);

  // Strategy 2: balanced-brace scan starting at the first {. Handles trailing commentary.
  if (!parsed && text.indexOf("{") !== -1) {
    const start = text.indexOf("{");
    let depth = 0, inString = false, escape = false, end = -1;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (escape) { escape = false; continue; }
      if (c === '\\') { escape = true; continue; }
      if (c === '"') inString = !inString;
      else if (!inString) {
        if (c === '{') depth++;
        else if (c === '}') { depth--; if (depth === 0) { end = i; break; } }
      }
    }
    if (end > start) parsed = tryParse(text.substring(start, end + 1));
  }

  // Strategy 3: greedy regex anchored on expected keys (new narrative shape or legacy insights).
  if (!parsed) {
    const m = text.match(/\{[\s\S]*"headline"[\s\S]*(?:"paragraphs"|"insights")[\s\S]*\}/);
    if (m) parsed = tryParse(m[0]);
  }

  if (!parsed || typeof parsed !== 'object') {
    // Truncation by max_tokens is a common cause — log a hint when text is long.
    const hint = text.length > 9000 ? ' (response is large — possible max_tokens truncation)' : '';
    console.error("[iPAi] All JSON parse strategies failed" + hint + ". Raw text starts:", text.substring(0, 300));
    return makeIntelligenceStub(recipientName, text.length > 9000 ? 'AI response was cut off mid-thought' : 'unparseable AI response');
  }

  // Normalize: ensure all expected fields exist with sensible defaults so the client never crashes.
  // v1.89.1 — BUG FIX: v1.77.0 moved the family card to narrative `paragraphs`, but this
  // normalizer still whitelisted only the legacy fields, silently DROPPING the paragraphs.
  // Result: the card rendered headline + watch list only — "a list of issues, not a narrative".
  return {
    headline: typeof parsed.headline === 'string' ? parsed.headline : `Care intelligence for ${recipientName}`,
    paragraphs: Array.isArray(parsed.paragraphs) ? parsed.paragraphs.filter(p => typeof p === 'string' && p.trim()) : [],
    insights: Array.isArray(parsed.insights) ? parsed.insights : [],
    caregiverGuidance: typeof parsed.caregiverGuidance === 'string' ? parsed.caregiverGuidance : '',
    schedulingAdvice: typeof parsed.schedulingAdvice === 'string' ? parsed.schedulingAdvice : '',
    watchList: Array.isArray(parsed.watchList) ? parsed.watchList : [],
  };
}

function makeIntelligenceStub(recipientName, reason) {
  return {
    headline: `Care intelligence for ${recipientName} — please regenerate`,
    insights: [{
      title: "Couldn't generate insights",
      observation: `The AI service returned a response we couldn't read (${reason}).`,
      explanation: "",
      recommendation: "Tap 'Regenerate' to try again.",
      priority: "medium",
    }],
    caregiverGuidance: "",
    schedulingAdvice: "",
    watchList: [],
  };
}

/**
 * v1.76.0 — Categorize a family observation note (non-blocking, fired after save).
 * Extracts care domains + actionables so the timeline gets chips and the
 * caregiver briefing gets substance without the family filling out forms.
 */
async function categorizeObservation(noteId) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const db = await getDb();
  const note = await db.prepare("SELECT id, content FROM recipient_notes WHERE id = ?").get(noteId);
  if (!note || !note.content) return null;
  const prompt = `A family member wrote this free-form observation about an elderly loved one they care for. Extract structure. Respond with ONLY valid JSON, no markdown:
{"categories": [<zero or more of: "physical","nutrition","cognition","mood","safety","social","medication","other">], "actionables": [<0-3 short imperative strings a caregiver could act on, e.g. "Clip toenails — possible broken toe, check comfort walking">], "headline": "<one sentence, care-relevant essence>"}

Observation: ${note.content.slice(0, 2000)}`;
  try {
    const text = await callClaude(apiKey, "claude-haiku-4-5-20251001", 400, [{ role: "user", content: prompt }]);
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const parsed = JSON.parse(m[0]);
    const categories = Array.isArray(parsed.categories) ? parsed.categories.slice(0, 6) : [];
    const highlights = {
      actionables: Array.isArray(parsed.actionables) ? parsed.actionables.slice(0, 3) : [],
      headline: typeof parsed.headline === "string" ? parsed.headline.slice(0, 200) : null,
    };
    await db.prepare("UPDATE recipient_notes SET categories = ?, ai_highlights = ?, updated_at = NOW() WHERE id = ?")
      .run(JSON.stringify(categories), JSON.stringify(highlights), noteId);
    return { categories, highlights };
  } catch (err) {
    console.warn("[iPAi] observation categorization failed (non-blocking):", err.message);
    return null;
  }
}

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
  const observedConcerns = (() => {
    try { return JSON.parse(recipient.observed_concerns || "[]"); } catch { return []; }
  })();
  const medications = (() => {
    try { return JSON.parse(recipient.medications || "[]"); } catch { return []; }
  })();

  const recipientName = recipient.first_name || "the care recipient";

  // Compile visit summaries (last 15)
  const visitSummaries = visits.slice(0, 15).map(v => {
    const tags = (() => { try { return JSON.parse(v.condition_tags || "[]"); } catch { return []; } })();
    return `${v.scheduled_date} ${v.scheduled_time || ""} with ${v.caregiver_first}: ` +
      `arrival mood=${parseMoodDisplay(v.arrival_mood) || "?"}, departure mood=${parseMoodDisplay(v.departure_mood) || "?"}, ` +
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
Diagnosed conditions (formal medical diagnoses): ${healthConditions.join(", ") || "none listed"}
Observed concerns (family observations — NOT diagnoses; never present these as diagnosed illnesses): ${observedConcerns.join(", ") || "none listed"}
Medications: ${medications.join(", ") || "none listed"}
Mobility: ${recipient.mobility || "unknown"}

VISIT DATA (${analysis.stats.totalVisits} visits${analysis.stats.dateRange ? `, ${analysis.stats.dateRange}` : ""}):
${visitSummaries || "No visits recorded yet."}

CARE NOTES:
${notesSummary || "No care notes yet."}

FAMILY ADDITIONS (direct input from the family — treat these as high-priority context):
${recipient.family_ai_notes || "None yet."}

BEHAVIORAL PATTERNS DETECTED:
- Frequent condition tags: ${analysis.frequentTags.map(t => `${t.tag} (${t.pct}% of visits)`).join(", ") || "none yet"}
- Mood by time: ${analysis.patterns.filter(p => p.type === "mood_by_time").map(p => `${p.period}: avg ${p.avgMood.toFixed(1)}/5 (${p.count} visits)`).join(", ") || "insufficient data"}
- Trends: ${analysis.trendNote || "no significant trends detected"}

YOUR TASK: Write a care intelligence report addressed to ${recipientName}'s FAMILY — the people who entered much of this data. They already know the raw facts; do NOT recite their own inputs back at them. Your value is synthesis: what's changing, what it means, and what to do next. Speak to them as "you".
TRUTH AND VOICE — two separate rules, both absolute:

WHAT you may claim (truth):
- Never state a past event or current lifestyle fact about ${recipientName} — driving, falls, moves, living situation, habits, history — unless it appears in the data above. If it is not in the data, it did not happen, no matter how typical it is for the diagnosis.
- Interpretation is welcome and should be PERSONAL: connect her documented behavior to your care knowledge, by name, framed as a possibility or guidance. "${recipientName} may get frustrated when she's aware she's forgetful — reassure rather than correct" is exactly right: it interprets what was observed, it does not invent an event.
- If the data can't support an insight, leave that insight out silently. Do not write about what the data lacks.

HOW you sound (voice):
- Warm, plain, human — like a trusted nurse who knows ${recipientName} talking with her family, not a report. Contractions are good. Normalize and reassure where the observations support it ("she's been sleeping in the recliner instead of her bed — and that's OK").
- NEVER hedge with meta-language: no "based on the provided data", "the data suggests", "according to the notes", "it appears that". The truth rules govern what you claim — they must be invisible in the writing.

CORROBORATION (weighting): a pattern documented by two or more DIFFERENT observers (e.g., a son AND a caregiver) is far more established than one person noting it repeatedly — lean on multi-observer patterns for your strongest interpretations, and treat single-observer patterns as one person's perspective, however often repeated.


Structure your response as a JSON object:
{
  "headline": "One-sentence overall read (warm, clear, under 25 words)",
  "paragraphs": [
    "Paragraph 1 — HOW THINGS ARE GOING: the trajectory. What's steady, what's shifting, mood and rhythm across recent visits and observations. Narrative, not a list.",
    "Paragraph 2 — WHAT IT MEANS: interpret the patterns with your care knowledge, personally and by name, possibility-framed. This is where 'she may get frustrated when she's aware she's forgetful' lives.",
    "Paragraph 3 — WHAT WOULD HELP NOW: recommendations addressed to the FAMILY (scheduling, caregiver continuity, things to raise with her doctor, what to try). Family-level decisions only — caregiver technique goes in the caregiver briefing, not here."
  ],
  "watchList": ["Things for the family to keep an eye on. Each under 15 words. Max 4. Omit if nothing genuine."]
}

LENGTH BUDGET — STRICT: total response under 2800 characters. Each paragraph 60–120 words, flowing prose, no headers or bullets inside.

Be specific to ${recipientName}. Reference actual observations from the visit data. Don't be generic — name patterns and explain what they mean for THIS person. If data is thin, say so honestly and suggest what would help, but stay within the length budget.

IMPORTANT: Return ONLY the JSON object, no markdown formatting or code blocks.`;

  try {
    const text = await callClaude(apiKey, "claude-haiku-4-5-20251001", 3000, [{ role: "user", content: prompt }]);

    // Parse JSON response — robust extraction handles code fences, leading text, etc.
    // v1.58.71: more forgiving — tries multiple strategies, salvages partial fields,
    // and only falls back to the "display issue" stub when truly nothing parses.
    let intelligence = parseIntelligenceJSON(text, recipientName);

    return {
      intelligence,
      analysis,
      generatedAt: new Date().toISOString(),
      recipientName,
      model: MODEL_HAIKU,
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

  // Use summary (Care Notes from checkout form) as primary; fall back to care_feedback for legacy visits
  const caregiverNotes = session?.summary || session?.care_feedback;
  if (!session || !caregiverNotes) return null;

  const conditions = (() => { try { return JSON.parse(session.health_conditions || "[]"); } catch { return []; } })();
  const tags = (() => { try { return JSON.parse(session.condition_tags || "[]"); } catch { return []; } })();

  // Also pull recent care notes for this recipient to give AI context (but keep them separate from this visit's notes)
  let recentCareNotes = [];
  try {
    recentCareNotes = await db.prepare(`
      SELECT content, note_type, created_at FROM recipient_notes
      WHERE care_recipient_id = ? AND id != ?
      ORDER BY created_at DESC LIMIT 5
    `).all(session.care_recipient_id, sessionId);
  } catch { /* non-critical */ }

  const recentContext = recentCareNotes.length > 0
    ? `\n\nRECENT CARE HISTORY (for context, do NOT just repeat these — use them to notice trends or changes):\n${recentCareNotes.map(n => `- ${n.created_at}: ${n.content?.substring(0, 150)}`).join("\n")}`
    : "";

  const prompt = `You are iPAi, writing a warm post-session summary for a family about their loved one's care visit.
Write only from the visit data below — never add events or background facts that are not in it. Warm interpretation of what IS in it is welcome; write like a caring human, not a report, and never use meta-language like \"based on the data\".

VISIT DETAILS:
- Care recipient: ${session.recipient_name}
- Health conditions: ${conditions.join(", ") || "not specified"}
- Caregiver: ${session.caregiver_name}
- Date: ${session.scheduled_date} at ${session.scheduled_time}
- Duration: ${session.duration_hours} hours
- Service: ${session.service_type}
- Arrival mood: ${parseMoodDisplay(session.arrival_mood) || "not recorded"}
- Departure mood: ${parseMoodDisplay(session.departure_mood) || "not recorded"}
- Condition tags: ${tags.join(", ") || "none"}
- Caregiver notes: "${caregiverNotes}"
${session.service_feedback ? `- Service notes: "${session.service_feedback}"` : ""}${recentContext}

INSTRUCTIONS:
Write a 3-4 sentence warm summary for the family about THIS visit. Be specific about what happened — reference actual observations from the caregiver's notes above. Do NOT just list or rephrase the care notes — synthesize them into a natural narrative. If the mood changed, note it. If there are concerning observations, flag them gently with a suggestion. End on a positive or constructive note. Keep it conversational, like a thoughtful caregiver texting the family.

If recent care history is provided, use it only to note meaningful changes or trends (e.g. "mood has been improving over the last few visits"). Do NOT summarize past visits.

Then provide 1-2 brief actionable suggestions if warranted (e.g., scheduling tips, things to watch for).

Return JSON:
{
  "summary": "The warm summary text",
  "suggestions": ["suggestion 1", "suggestion 2"],
  "moodChange": "improved|declined|stable|unknown"
}

Return ONLY the JSON, no markdown.`;

  try {
    const text = await callClaude(apiKey, "claude-haiku-4-5-20251001", 500, [{ role: "user", content: prompt }]);
    const cleaned = text.replace(/^```json?\n?/, "").replace(/\n?```$/, "").trim();
    return JSON.parse(cleaned);
  } catch (err) {
    console.error("[iPAi] Session summary error:", err);
    return null;
  }
}

/**
 * Generate a living care plan document based on visit data, health conditions, and caregiver feedback
 * Creates a structured, evolving guide for caregivers and family
 */
async function generateCarePlan(careRecipientId) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { error: "AI not configured", carePlan: null };
  }

  const data = await gatherVisitData(careRecipientId);
  if (!data) return { error: "Care recipient not found", carePlan: null };

  const { recipient, visits, careNotes } = data;
  const analysis = analyzePatterns(visits);

  const healthConditions = (() => {
    try { return JSON.parse(recipient.health_conditions || "[]"); } catch { return []; }
  })();
  const observedConcerns = (() => {
    try { return JSON.parse(recipient.observed_concerns || "[]"); } catch { return []; }
  })();
  const medications = (() => {
    try { return JSON.parse(recipient.medications || "[]"); } catch { return []; }
  })();

  const recipientName = recipient.first_name || "the care recipient";

  // Compile visit summaries focusing on what works and what doesn't
  const visitSummaries = visits.slice(0, 20).map(v => {
    const tags = (() => { try { return JSON.parse(v.condition_tags || "[]"); } catch { return []; } })();
    return `${v.scheduled_date} with ${v.caregiver_first}: ` +
      `arrival mood=${parseMoodDisplay(v.arrival_mood) || "?"}, departure mood=${parseMoodDisplay(v.departure_mood) || "?"}, ` +
      `tags=[${tags.join(", ")}], ` +
      `notes: "${(v.care_feedback || v.summary || "").substring(0, 150)}"`;
  }).join("\n");

  // Extract caregiver effectiveness patterns
  const caregiverStats = {};
  for (const v of visits) {
    const cg = v.caregiver_first || "Unknown";
    if (!caregiverStats[cg]) caregiverStats[cg] = { visits: 0, tags: [], moods: [] };
    caregiverStats[cg].visits++;
    const mood = v.departure_mood || v.mood_rating;
    if (mood) caregiverStats[cg].moods.push(typeof mood === "number" ? mood : 3);
    try {
      const tags = JSON.parse(v.condition_tags || "[]");
      caregiverStats[cg].tags.push(...tags);
    } catch {} // expected: tolerated parse fallback
  }

  const caregiverSummary = Object.entries(caregiverStats)
    .map(([name, stats]) => {
      const avgMood = stats.moods.length ? (stats.moods.reduce((a, b) => a + b, 0) / stats.moods.length).toFixed(1) : "?";
      return `${name}: ${stats.visits} visits, avg departure mood ${avgMood}/5`;
    })
    .join("; ");

  const prompt = `You are creating a LIVING CARE PLAN for ${recipientName}, a guide that evolves with every visit. This is not a static document — it captures the current best understanding of how to care for this person.

CARE RECIPIENT: ${recipientName}
Age: ${recipient.age || "unknown"}
Diagnosed conditions (formal medical diagnoses): ${healthConditions.join(", ") || "none listed"}
Observed concerns (family observations — NOT diagnoses; never present these as diagnosed illnesses): ${observedConcerns.join(", ") || "none listed"}
Medications: ${medications.join(", ") || "none listed"}
Mobility: ${recipient.mobility || "unknown"}

VISIT DATA (${analysis.stats.totalVisits} visits):
${visitSummaries || "No visits yet."}

CAREGIVER PATTERNS:
${caregiverSummary}

FREQUENT PATTERNS:
- Tags: ${analysis.frequentTags.slice(0, 5).map(t => `${t.tag} (${t.pct}% of visits)`).join(", ") || "none"}
- Time mood trends: ${analysis.patterns.filter(p => p.type === "mood_by_time").map(p => `${p.period}: ${p.avgMood.toFixed(1)}/5`).join(", ") || "insufficient data"}

YOUR TASK: Generate a structured CARE PLAN JSON that captures the living wisdom about caring for ${recipientName}. This should be:
- SPECIFIC to this person's needs, not generic advice
- ACTIONABLE for caregivers (things to do and avoid)
- EVOLVING (references visit count and dates for staleness awareness)
- HONEST about gaps (if data is insufficient, say so)
- GROUNDED: never state events or lifestyle facts (driving, falls, living situation, habits) that are not in the data above. Personal, possibility-framed interpretation of documented behavior IS welcome (\"she may...\", \"watch for...\"). No meta-language about the data itself.
SAFETY — this text is caregiver-visible: never include information that maps financial or security vulnerabilities — trouble managing money, cash or valuables in the home, who pays for things, entry codes, confusion about transactions. If money-adjacent behavior matters for care, state it neutrally ("may misplace belongings") without exploitable detail. No family coordination decisions (assignments, hiring, payments) — hands-on care guidance only.

Structure as JSON:
{
  "planTitle": "Care Plan for ${recipientName}",
  "lastUpdated": "2026-03-17",
  "visitsSinceLastUpdate": ${analysis.stats.totalVisits},
  "dailyRoutine": {
    "morning": "Brief description of what works well in mornings based on mood/pattern data",
    "afternoon": "What to expect and how to support in afternoons",
    "evening": "Evening patterns and best practices"
  },
  "carePreferences": [
    { "category": "Communication", "guideline": "Specific guidance based on observed patterns", "source": "Pattern from X visits" },
    { "category": "Medication", "guideline": "What caregivers need to know", "source": "Visit logs" }
  ],
  "medicationNotes": "Critical info about how this person takes medications, what to watch for",
  "safetyConsiderations": ["Specific risk factors observed or documented"],
  "whatWorksWell": ["Techniques/approaches that improve mood or cooperation based on visit data"],
  "whatToAvoid": ["Approaches that typically don't work or worsen mood"],
  "emergencyProtocol": "What to do if [specific scenario]. Based on conditions and patterns.",
  "familyNotes": "Additional context from family notes that caregivers should know"
}

CRITICAL: Return ONLY the JSON object, no markdown formatting or code blocks. Be specific to this person's actual visit history.`;

  try {
    const text = await callClaude(apiKey, "claude-haiku-4-5-20251001", 3000, [{ role: "user", content: prompt }]);

    let carePlan;
    try {
      let cleaned = text.replace(/^[\s\S]*?```json?\s*\n?/i, "").replace(/\n?\s*```[\s\S]*$/, "").trim();
      if (!cleaned.startsWith("{")) {
        const firstBrace = text.indexOf("{");
        const lastBrace = text.lastIndexOf("}");
        if (firstBrace !== -1 && lastBrace > firstBrace) cleaned = text.substring(firstBrace, lastBrace + 1);
      }
      carePlan = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error("[iPAi] Failed to parse care plan:", parseErr.message);
      carePlan = {
        planTitle: `Care Plan for ${recipientName}`,
        lastUpdated: new Date().toISOString().split("T")[0],
        visitsSinceLastUpdate: analysis.stats.totalVisits,
        dailyRoutine: { morning: "", afternoon: "", evening: "" },
        carePreferences: [],
        medicationNotes: text,
        safetyConsiderations: [],
        whatWorksWell: [],
        whatToAvoid: [],
        emergencyProtocol: "",
        familyNotes: "",
      };
    }

    return {
      carePlan,
      generatedAt: new Date().toISOString(),
      recipientName,
      visitCount: analysis.stats.totalVisits,
    };
  } catch (err) {
    console.error("[iPAi] Care plan generation error:", err);
    return { error: err.message, carePlan: null };
  }
}

/**
 * Generate private caregiver coaching tips after a session
 * Only the caregiver sees these — specific to THIS care recipient
 */
async function generateCaregiverCoaching(sessionId) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const db = await getDb();

  const session = await db.prepare(`
    SELECT cs.*, cr.first_name AS recipient_name, cr.health_conditions,
      cr.medications, cr.age, cr.mobility,
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

  // Use summary (Care Notes from checkout form) as primary; fall back to care_feedback for legacy visits
  const coachingNotes = session?.summary || session?.care_feedback;
  if (!session || !coachingNotes) return null;

  // Get care notes from family for context
  const familyNotes = await db.prepare(`
    SELECT content FROM recipient_notes
    WHERE care_recipient_id = ? AND note_type != 'visit_summary'
    ORDER BY created_at DESC LIMIT 5
  `).all(session.care_recipient_id);

  // Get past visit data for trend context
  const pastVisits = await db.prepare(`
    SELECT vl.departure_mood, vl.condition_tags, vl.care_feedback, vl.summary,
      cs.scheduled_date
    FROM visit_logs vl
    JOIN care_sessions cs ON vl.session_id = cs.id
    WHERE cs.care_recipient_id = ? AND cs.caregiver_id = ?
      AND cs.id != ?
    ORDER BY cs.scheduled_date DESC LIMIT 5
  `).all(session.care_recipient_id, session.caregiver_id, sessionId);

  const conditions = (() => { try { return JSON.parse(session.health_conditions || "[]"); } catch { return []; } })();
  const tags = (() => { try { return JSON.parse(session.condition_tags || "[]"); } catch { return []; } })();
  const meds = (() => { try { return JSON.parse(session.medications || "[]"); } catch { return []; } })();

  const pastContext = pastVisits.map(v => {
    const t = (() => { try { return JSON.parse(v.condition_tags || "[]"); } catch { return []; } })();
    return `${v.scheduled_date}: mood=${parseMoodDisplay(v.departure_mood) || "?"}, tags=[${t.join(",")}], notes="${(v.summary || v.care_feedback || "").substring(0, 100)}"`;
  }).join("\n");

  const familyContext = familyNotes.map(n => `- "${(n.content || "").substring(0, 150)}"`).join("\n");

  const prompt = `You are iPAi, a private coaching assistant for caregivers on InPlace. Generate brief, actionable coaching tips for ${session.caregiver_name} about caring for ${session.recipient_name}.
Ground every tip in the data below — never state events or facts about ${session.recipient_name} that are not in it. Personal, possibility-framed coaching (\"she may respond better if...\") is welcome; keep the voice warm and direct, no meta-language about the data.
SAFETY — this text is caregiver-visible: never include information that maps financial or security vulnerabilities — trouble managing money, cash or valuables in the home, who pays for things, entry codes, confusion about transactions. If money-adjacent behavior matters for care, state it neutrally ("may misplace belongings") without exploitable detail. No family coordination decisions (assignments, hiring, payments) — hands-on care guidance only.

CARE RECIPIENT:
- Name: ${session.recipient_name}, Age: ${session.age || "unknown"}
- Conditions: ${conditions.join(", ") || "none listed"}
- Medications: ${meds.join(", ") || "none listed"}
- Mobility: ${session.mobility || "unknown"}

TODAY'S SESSION:
- Arrival mood: ${parseMoodDisplay(session.arrival_mood) || "not recorded"}
- Departure mood: ${parseMoodDisplay(session.departure_mood) || "not recorded"}
- Condition tags: ${tags.join(", ") || "none"}
- ${session.caregiver_name}'s notes: "${coachingNotes}"

PAST SESSIONS WITH ${session.recipient_name}:
${pastContext || "This was the first session"}

FAMILY NOTES:
${familyContext || "No family notes"}

Generate 2-3 brief, specific coaching tips for ${session.caregiver_name}. These should be:
- Specific to ${session.recipient_name} (not generic care advice)
- Based on what happened today or patterns from past visits
- Practical and actionable (something to try next visit)
- Warm and supportive in tone (this is coaching, not criticism)

If you notice something the family mentioned that the caregiver should know about, include it.

Return JSON:
{
  "greeting": "Brief warm opening (e.g. 'Great session today!')",
  "tips": [
    { "tip": "The actionable advice", "context": "Why this matters for ${session.recipient_name}" }
  ],
  "nextVisitNote": "One thing to try or watch for next time"
}

Return ONLY JSON, no markdown.`;

  try {
    const text = await callClaude(apiKey, "claude-haiku-4-5-20251001", 500, [{ role: "user", content: prompt }]);
    const cleaned = text.replace(/^```json?\n?/, "").replace(/\n?```$/, "").trim();
    return JSON.parse(cleaned);
  } catch (err) {
    console.error("[iPAi] Caregiver coaching error:", err);
    return null;
  }
}

module.exports = {
  categorizeObservation,
  gatherVisitData,
  analyzePatterns,
  generateCareIntelligence,
  generateSessionSummary,
  generateCaregiverCoaching,
  generateCarePlan,
};
