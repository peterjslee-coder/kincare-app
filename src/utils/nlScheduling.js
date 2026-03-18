/**
 * Natural Language Scheduling
 *
 * Converts natural language text about scheduling intent into structured parameters.
 * Uses Claude Haiku for fast, cost-efficient parsing of scheduling intent.
 *
 * Example:
 *   "Betty needs someone Tuesday afternoon who's good with her mood swings"
 *   =>
 *   {
 *     date: "2026-03-19",
 *     timeRange: { start: "12:00", end: "17:00" },
 *     duration: 4,
 *     serviceType: "companionship",
 *     preferences: ["dementia experience", "mood management"],
 *     recipientName: "Betty"
 *   }
 */

const { getDb } = require("../models/database");

/**
 * Parse natural language scheduling intent using Claude Haiku
 * Returns structured scheduling parameters
 */
async function parseSchedulingIntent(text, userId) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { error: "AI not configured", intent: null };
  }

  // Get user's care recipients to help with name matching
  const db = await getDb();
  const userRecipients = await db.prepare(`
    SELECT cr.id, cr.first_name, cr.last_name
    FROM care_recipients cr
    WHERE cr.family_id = ?
    ORDER BY cr.created_at DESC
  `).all(userId);

  const recipientNames = userRecipients.map(r => `${r.first_name} ${r.last_name}`.trim()).join(", ");

  const prompt = `You are parsing scheduling intent from natural language. Extract structured scheduling parameters.

USER'S CARE RECIPIENTS: ${recipientNames || "none"}
TEXT: "${text}"

Your task: Parse the text and extract scheduling intent as JSON. Be smart about:
1. DATE: Parse "Tuesday", "next week", "tomorrow", etc. into YYYY-MM-DD format (relative to today 2026-03-17)
2. TIME RANGE: Extract time context ("morning" = 08:00-12:00, "afternoon" = 12:00-17:00, "evening" = 17:00-21:00, or specific times)
3. DURATION: How long? Default 2-4 hours if not specified
4. SERVICE TYPE: companionship, personal_care, medical_support, respite, etc. (based on context)
5. PREFERENCES: Extract mentions of experience needed (e.g., "dementia experience", "good with mobility issues")
6. RECIPIENT NAME: Match against care recipients if possible

Return ONLY this JSON (no markdown):
{
  "recipientName": "Name or null if not specified",
  "date": "2026-03-19 or null if not specific",
  "timeRange": { "start": "HH:MM", "end": "HH:MM" } or null,
  "duration": 3 or null,
  "serviceType": "companionship" or null,
  "preferences": ["experience area 1", "experience area 2"],
  "notes": "Any ambiguities or clarifications needed"
}`;

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
        max_tokens: 400,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("[NL Scheduling] Claude API error:", response.status, errText);
      return { error: "AI service unavailable", intent: null };
    }

    const result = await response.json();
    const text_response = result.content?.[0]?.text || "";

    let intent;
    try {
      const cleaned = text_response.replace(/^```json?\n?/, "").replace(/\n?```$/, "").trim();
      intent = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error("[NL Scheduling] Failed to parse intent:", parseErr.message);
      return { error: "Failed to parse intent", intent: null };
    }

    // Resolve recipient ID if name was matched
    let recipientId = null;
    if (intent.recipientName) {
      const recipient = userRecipients.find(r =>
        `${r.first_name}`.toLowerCase() === intent.recipientName.toLowerCase() ||
        `${r.first_name} ${r.last_name}`.toLowerCase() === intent.recipientName.toLowerCase()
      );
      if (recipient) {
        recipientId = recipient.id;
      }
    }

    return {
      intent: {
        ...intent,
        recipientId,
      },
      generatedAt: new Date().toISOString(),
    };
  } catch (err) {
    console.error("[NL Scheduling] Intent parsing error:", err);
    return { error: err.message, intent: null };
  }
}

/**
 * Score a caregiver against scheduling intent preferences
 * Used for ranking matches
 */
function scoreCaregiver(caregiver, intent) {
  let score = 0;

  if (!intent.preferences || intent.preferences.length === 0) {
    return score;
  }

  const caregiverBio = (caregiver.bio || "").toLowerCase();
  const caregiverExperience = (caregiver.experience_summary || "").toLowerCase();
  const caregiverSkills = (caregiver.skills || "").toLowerCase();

  for (const pref of intent.preferences) {
    const prefLower = pref.toLowerCase();

    // Exact mention boost
    if (caregiverBio.includes(prefLower) || caregiverExperience.includes(prefLower)) {
      score += 3;
    } else if (caregiverSkills.includes(prefLower)) {
      score += 2;
    }

    // Related term matching
    const dementiaTerms = ["dementia", "alzheimer", "memory loss", "cognitive"];
    const mobilityTerms = ["mobility", "wheelchair", "transfer", "walking"];
    const moodTerms = ["mood", "behavior", "anxious", "emotional"];

    if (dementiaTerms.some(t => prefLower.includes(t))) {
      if (dementiaTerms.some(t => caregiverBio.includes(t) || caregiverExperience.includes(t))) {
        score += 2;
      }
    }

    if (mobilityTerms.some(t => prefLower.includes(t))) {
      if (mobilityTerms.some(t => caregiverBio.includes(t) || caregiverExperience.includes(t))) {
        score += 2;
      }
    }

    if (moodTerms.some(t => prefLower.includes(t))) {
      if (moodTerms.some(t => caregiverBio.includes(t) || caregiverExperience.includes(t))) {
        score += 2;
      }
    }
  }

  return score;
}

/**
 * Suggest ranked caregiver matches for parsed intent
 */
async function suggestMatches(intent, userId) {
  const db = await getDb();

  if (!intent.date || !intent.timeRange) {
    return { error: "Intent must have date and timeRange for scheduling", suggestions: [] };
  }

  // Query available caregivers for the requested date/time
  const query = `
    SELECT DISTINCT cp.id, cp.user_id, u.first_name, u.last_name, u.profile_photo,
      cp.hourly_rate, cp.bio, cp.experience_summary, cp.skills,
      av.type as availability_type
    FROM caregiver_profiles cp
    JOIN users u ON cp.user_id = u.id
    LEFT JOIN availability av ON u.id = av.user_id
      AND av.date = ?
      AND av.type != 'unavailable'
    WHERE cp.account_paused = 0
      AND u.status = 'active'
    ORDER BY u.created_at DESC
    LIMIT 20
  `;

  const caregivers = await db.prepare(query).all(intent.date);

  // Score each caregiver
  const scored = caregivers.map(cg => ({
    caregiverId: cg.id,
    userId: cg.user_id,
    name: `${cg.first_name} ${cg.last_name}`,
    photo: cg.profile_photo,
    hourlyRate: cg.hourly_rate,
    availabilityType: cg.availability_type || "unknown",
    score: scoreCaregiver(cg, intent),
    reasons: extractScoreReasons(cg, intent),
  }));

  // Sort by score and take top 3
  const suggestions = scored
    .filter(cg => cg.score > 0 || cg.availabilityType === "available") // Include top matches or available caregivers
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((cg, idx) => ({
      rank: idx + 1,
      ...cg,
    }));

  return {
    suggestions,
    totalCandidates: caregivers.length,
    intent,
  };
}

/**
 * Extract human-readable reasons for a caregiver's score
 */
function extractScoreReasons(caregiver, intent) {
  const reasons = [];

  if (!intent.preferences || intent.preferences.length === 0) {
    return reasons;
  }

  const caregiverBio = (caregiver.bio || "").toLowerCase();
  const caregiverExperience = (caregiver.experience_summary || "").toLowerCase();

  for (const pref of intent.preferences) {
    const prefLower = pref.toLowerCase();

    if (caregiverBio.includes(prefLower) || caregiverExperience.includes(prefLower)) {
      reasons.push(`Experience with ${pref}`);
    }
  }

  if (reasons.length === 0 && caregiver.experience_summary) {
    reasons.push("Experienced caregiver");
  }

  return reasons;
}

module.exports = {
  parseSchedulingIntent,
  suggestMatches,
  scoreCaregiver,
};
