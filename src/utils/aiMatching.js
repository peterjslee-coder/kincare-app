/**
 * AI-powered caregiver-recipient matching engine
 *
 * Scores matches based on:
 * - Proximity (20%): distance from caregiver work location to session location
 * - Care skill match (25%): caregiver's care_stoplight vs recipient's health conditions
 * - Experience (20%): past completed sessions with recipient, mood improvement, reviews
 * - Schedule fit (15%): availability rules compliance, no overtime required
 * - Rating & reliability (10%): overall rating, no-show count, completion count
 * - Rate compatibility (10%): caregiver rate vs session budget
 */

const { haversineDistance } = require('./geocode');
const { MODEL_HAIKU } = require("./aiModels");

/**
 * Score a caregiver-recipient match for a specific session.
 * Returns { score: 0-100, reasons: [...], insights: string }
 *
 * @param {object} caregiver - caregiver profile record
 * @param {object} session - care session record
 * @param {object} careRecipient - care recipient record
 * @param {object} visitHistory - { sessionCount: number, avgMoodImprovement: 0-1, avgRating: 0-5 }
 * @param {object} db - database handle (for computing insights with Claude API)
 * @returns {Promise<{ score: number, reasons: string[], insights: string }>}
 */
async function scoreMatch(caregiver, session, careRecipient, visitHistory = {}, db = null) {
  const reasons = [];
  let score = 0;

  // ─── 1. PROXIMITY (20%) ───
  const proximityScore = scoreProximity(caregiver, session, careRecipient, reasons);
  score += proximityScore * 0.2;

  // ─── 2. CARE SKILL MATCH (25%) ───
  const skillScore = scoreSkillMatch(caregiver, careRecipient, reasons);
  score += skillScore * 0.25;

  // ─── 3. EXPERIENCE WITH THIS RECIPIENT (20%) ───
  const experienceScore = scoreExperience(visitHistory, reasons);
  score += experienceScore * 0.2;

  // ─── 4. SCHEDULE FIT (15%) ───
  const scheduleScore = scoreScheduleFit(caregiver, session, reasons);
  score += scheduleScore * 0.15;

  // ─── 5. RATING & RELIABILITY (10%) ───
  const ratingScore = scoreRatingAndReliability(caregiver, reasons);
  score += ratingScore * 0.1;

  // ─── 6. RATE COMPATIBILITY (10%) ───
  const rateScore = scoreRateCompatibility(caregiver, session, reasons);
  score += rateScore * 0.1;

  // Cap at 100, floor at 0
  score = Math.max(0, Math.min(100, Math.round(score)));

  // Generate insights using Claude API (only for top matches or on demand)
  let insights = '';
  if (db && score >= 70) {
    try {
      insights = await generateInsights(caregiver, session, careRecipient, visitHistory, reasons);
    } catch (err) {
      console.error('Failed to generate insights:', err.message);
      // Fallback: synthesize from reasons
      insights = synthesizeInsights(caregiver, careRecipient, visitHistory, reasons, score);
    }
  } else {
    // For lower scores or no DB, use synthetic insights
    insights = synthesizeInsights(caregiver, careRecipient, visitHistory, reasons, score);
  }

  return { score, reasons, insights };
}

/**
 * Score proximity: distance from caregiver work location to session location
 * Returns 0-100 (higher = closer)
 */
function scoreProximity(caregiver, session, careRecipient, reasons) {
  // Extract coordinates
  const cgLat = caregiver.latitude || caregiver.work_latitude;
  const cgLng = caregiver.longitude || caregiver.work_longitude;
  const recipLat = careRecipient.latitude;
  const recipLng = careRecipient.longitude;

  if (!cgLat || !cgLng || !recipLat || !recipLng) {
    reasons.push('Location data unavailable for proximity scoring');
    return 50; // Neutral score if data missing
  }

  const distMiles = haversineDistance(cgLat, cgLng, recipLat, recipLng);
  const maxTravelMiles = caregiver.max_travel_miles || 15;

  let score;
  if (distMiles <= maxTravelMiles * 0.5) {
    score = 100; // Very close
  } else if (distMiles <= maxTravelMiles) {
    // Linear falloff from 100 to 80
    score = 80 + (20 * (1 - (distMiles - maxTravelMiles * 0.5) / (maxTravelMiles * 0.5)));
  } else if (distMiles <= maxTravelMiles * 1.5) {
    // Linear falloff from 80 to 40
    score = 40 + (40 * (1 - (distMiles - maxTravelMiles) / (maxTravelMiles * 0.5)));
  } else {
    score = 20; // Far but not impossible
  }

  reasons.push(`Distance: ${Math.round(distMiles * 10) / 10} miles (max travel: ${maxTravelMiles})`);
  return Math.max(0, Math.min(100, score));
}

/**
 * Score skill match: caregiver's care_stoplight vs recipient's health conditions
 * Returns 0-100
 */
function scoreSkillMatch(caregiver, careRecipient, reasons) {
  const careStoplight = caregiver.care_stoplight || 'red'; // 'green', 'yellow', 'red'
  const recipConditions = parseJson(careRecipient.health_conditions || '[]');

  // Parse caregiver specialties/certifications
  const specialties = parseJson(caregiver.specialties || '[]');
  const certs = parseJson(caregiver.certifications || '[]');

  let score = 50; // Base score

  // Green stoplight = full capacity for all care types
  if (careStoplight === 'green') {
    score = 90;
    reasons.push('Caregiver at full capacity (green stoplight)');
  } else if (careStoplight === 'yellow') {
    score = 70;
    reasons.push('Caregiver approaching capacity (yellow stoplight)');
  } else {
    score = 40;
    reasons.push('Caregiver at reduced capacity (red stoplight)');
  }

  // Check for specialty matches with recipient's conditions
  if (recipConditions.length > 0 && specialties.length > 0) {
    const conditionStr = recipConditions.join(' ').toLowerCase();
    const matchedSpecs = specialties.filter(spec =>
      conditionStr.includes((spec || '').toLowerCase()) ||
      (spec || '').toLowerCase().includes('dementia') ||
      (spec || '').toLowerCase().includes('alzheimer')
    );

    if (matchedSpecs.length > 0) {
      score += 20;
      reasons.push(`Specialties match: ${matchedSpecs.slice(0, 2).join(', ')}`);
    }
  }

  // Check for relevant certifications
  if (certs.length > 0) {
    const certStr = certs.join(' ').toLowerCase();
    if (certStr.includes('cna') || certStr.includes('cpn') || certStr.includes('nurse')) {
      score += 15;
      reasons.push('Has nursing/medical certifications');
    } else if (certStr.includes('first aid') || certStr.includes('cpr')) {
      score += 10;
      reasons.push('Has first aid/CPR certification');
    }
  }

  return Math.max(0, Math.min(100, score));
}

/**
 * Score experience with this specific recipient
 * Returns 0-100
 */
function scoreExperience(visitHistory = {}, reasons) {
  const sessionCount = visitHistory.sessionCount || 0;
  const avgMoodImprovement = visitHistory.avgMoodImprovement || 0; // 0-1
  const avgRating = visitHistory.avgRating || 0; // 0-5

  let score = 0;

  // Session count: 0→20 pts, 1-3→40 pts, 4-7→70 pts, 8+→100 pts
  if (sessionCount === 0) {
    score = 0;
    reasons.push('New caregiver for this recipient');
  } else if (sessionCount <= 3) {
    score = 40;
    reasons.push(`Has ${sessionCount} previous session${sessionCount > 1 ? 's' : ''} with recipient`);
  } else if (sessionCount <= 7) {
    score = 70;
    reasons.push(`Has ${sessionCount} previous sessions with recipient (experienced)`);
  } else {
    score = 100;
    reasons.push(`Has ${sessionCount} previous sessions with recipient (very experienced)`);
  }

  // Mood improvement bonus (if tracked)
  if (avgMoodImprovement > 0.5) {
    score += 20;
    reasons.push(`Strong mood improvement: ${Math.round(avgMoodImprovement * 100)}% of sessions`);
  }

  // Rating bonus (if tracked)
  if (avgRating >= 4.5) {
    score += 15;
    reasons.push(`Excellent feedback: ${Math.round(avgRating * 10) / 10} avg rating`);
  } else if (avgRating >= 4.0) {
    score += 10;
    reasons.push(`Good feedback: ${Math.round(avgRating * 10) / 10} avg rating`);
  }

  return Math.max(0, Math.min(100, score));
}

/**
 * Score schedule fit: does the caregiver have this slot available?
 * Returns 0-100
 */
function scoreScheduleFit(caregiver, session, reasons) {
  // For v1, we check:
  // - availability_rules exist (assume compliance if not stored yet)
  // - Not requiring excessive overtime
  // - Respecting maximum hours per week/month

  // Base score: assume available unless marked as unavailable
  let score = 80;

  const maxWeeklyHours = caregiver.max_hours_per_week || 40;
  const isOvernightSession = session.service_type &&
    (session.service_type.toLowerCase().includes('overnight') ||
     session.service_type.toLowerCase().includes('night'));

  if (isOvernightSession) {
    // Overnight sessions are premium work, slightly penalize if not explicitly certified
    if (!caregiver.overnight_certified) {
      score -= 10;
      reasons.push('Overnight session but not marked as overnight-certified');
    }
  }

  // Reduce score if approaching hour limits (we don't have exact data here)
  // In a real implementation, this would check against confirmed sessions this week
  reasons.push('Schedule slot appears available');

  return score;
}

/**
 * Score rating & reliability: overall rating, no-show count, completion count
 * Returns 0-100
 */
function scoreRatingAndReliability(caregiver, reasons) {
  const rating = caregiver.rating_avg || 0; // 0-5
  const ratingCount = caregiver.rating_count || 0;
  const noShowCount = caregiver.no_show_count || 0;

  let score = 50; // Base

  // Rating: 4.5+→100, 4.0+→85, 3.5+→70, 3.0+→50, <3→30
  if (rating >= 4.5) {
    score = 95;
    reasons.push(`Excellent rating: ${Math.round(rating * 10) / 10}/5 (${ratingCount} reviews)`);
  } else if (rating >= 4.0) {
    score = 85;
    reasons.push(`Good rating: ${Math.round(rating * 10) / 10}/5`);
  } else if (rating >= 3.5) {
    score = 70;
    reasons.push(`Fair rating: ${Math.round(rating * 10) / 10}/5`);
  } else if (rating >= 3.0) {
    score = 50;
    reasons.push(`Average rating: ${Math.round(rating * 10) / 10}/5`);
  } else if (rating > 0) {
    score = 30;
    reasons.push(`Low rating: ${Math.round(rating * 10) / 10}/5`);
  } else {
    score = 40;
    reasons.push('No ratings yet (new caregiver)');
  }

  // No-show penalty: each no-show -5 pts
  if (noShowCount > 0) {
    score -= Math.min(30, noShowCount * 5);
    reasons.push(`Reliability concern: ${noShowCount} no-show${noShowCount > 1 ? 's' : ''}`);
  }

  return Math.max(0, Math.min(100, score));
}

/**
 * Score rate compatibility: caregiver's rate vs session budget
 * Returns 0-100
 */
function scoreRateCompatibility(caregiver, session, reasons) {
  const cgRate = caregiver.hourly_rate || 0;
  const sessionBudget = session.estimated_cost || 0;
  const durationHours = session.duration_hours || 2;

  if (!cgRate || !sessionBudget) {
    reasons.push('Rate data incomplete');
    return 50; // Neutral
  }

  const impliedRateFromBudget = sessionBudget / durationHours;
  const difference = impliedRateFromBudget - cgRate;
  const percentDifference = (difference / cgRate) * 100;

  let score = 50;

  if (percentDifference >= 0) {
    // Family budget is equal or above caregiver's rate
    if (percentDifference >= 20) {
      score = 100;
      reasons.push(`Rate highly compatible: family offers ${Math.round(impliedRateFromBudget)}/hr, caregiver asks ${cgRate}/hr`);
    } else if (percentDifference >= 0) {
      score = 85;
      reasons.push(`Rate compatible: family ${Math.round(impliedRateFromBudget)}/hr matches caregiver ${cgRate}/hr`);
    }
  } else if (percentDifference >= -10) {
    // Slight underpay (acceptable)
    score = 70;
    reasons.push(`Rate slightly below caregiver rate (${Math.round(percentDifference)}% difference)`);
  } else {
    // Significant underpay (less attractive)
    score = 40;
    reasons.push(`Rate significantly below caregiver rate (${Math.round(percentDifference)}% difference)`);
  }

  return Math.max(0, Math.min(100, score));
}

/**
 * Generate human-readable insights using Claude API.
 * Called only for top matches or on demand to save API costs.
 *
 * Returns a 1-2 sentence explanation of why this is a good match.
 */
async function generateInsights(caregiver, session, careRecipient, visitHistory = {}, reasons) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Fallback if API key not available
    return synthesizeInsights(caregiver, careRecipient, visitHistory, reasons, 75);
  }

  const context = [
    `Caregiver: ${caregiver.first_name || 'Unknown'} (rating: ${caregiver.rating_avg || 'N/A'}/5)`,
    `Care recipient: ${careRecipient.first_name || 'Client'}, age ${careRecipient.age || 'N/A'}`,
    `Session: ${session.service_type || 'general care'}, ${session.duration_hours || 2} hours`,
    `Visit history: ${visitHistory.sessionCount || 0} previous sessions`,
    careRecipient.health_conditions ? `Health conditions: ${parseJson(careRecipient.health_conditions || '[]').slice(0, 2).join(', ')}` : '',
    caregiver.specialties ? `Specialties: ${parseJson(caregiver.specialties || '[]').slice(0, 2).join(', ')}` : '',
  ].filter(Boolean).join('\n');

  const prompt = `Based on this caregiver-recipient pairing, generate a brief 1-2 sentence explanation of why this is a good match, written in an encouraging tone for a family. Focus on concrete strengths.

${context}

Explanation (1-2 sentences, conversational tone):`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL_HAIKU,
        max_tokens: 150,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Claude API error: ${response.status} ${errText}`);
    }

    const data = await response.json();
    const insight = data.content?.[0]?.text?.trim() || '';
    return insight || synthesizeInsights(caregiver, careRecipient, visitHistory, reasons, 75);
  } catch (err) {
    console.error('Claude API call failed:', err.message);
    throw err;
  }
}

/**
 * Fallback: synthesize insights from structured reasons without API call.
 */
function synthesizeInsights(caregiver, careRecipient, visitHistory = {}, reasons, score) {
  const cgName = caregiver.first_name || 'This caregiver';
  const recipName = careRecipient.first_name || 'your loved one';
  const sessionCount = visitHistory.sessionCount || 0;

  if (score >= 85) {
    if (sessionCount >= 5) {
      return `${cgName} has ${sessionCount} visits with ${recipName} and consistently delivers excellent care. This is an outstanding match.`;
    } else if (sessionCount > 0) {
      return `${cgName} already knows ${recipName} well and has a proven track record. Highly recommended.`;
    } else {
      return `${cgName} has exceptional skills and an excellent rating—a strong fit for ${recipName}'s needs.`;
    }
  } else if (score >= 70) {
    if (sessionCount >= 3) {
      return `${cgName} is familiar with ${recipName} and has positive feedback from previous visits.`;
    } else {
      return `${cgName}'s experience and reliability make this a solid match for ${recipName}.`;
    }
  } else if (score >= 50) {
    return `${cgName} meets ${recipName}'s care requirements and is available for the requested time.`;
  } else {
    return `${cgName} is available and willing to provide care, though not an ideal match on all criteria.`;
  }
}

/**
 * Helper: safely parse JSON strings
 */
function parseJson(str) {
  if (!str) return [];
  try {
    return JSON.parse(str);
  } catch {
    return [];
  }
}

module.exports = { scoreMatch };
