/**
 * AI-powered caregiver-recipient matching endpoints
 *
 * GET /api/matching/score?sessionId=X&caregiverId=Y
 *   Returns match score and reasons for a specific pairing
 *
 * GET /api/matching/ranked?sessionId=X
 *   Returns all eligible caregivers ranked by match score
 */

const express = require('express');
const { getDb } = require('../models/database');
const { authenticate } = require('../middleware/auth');
const { scoreMatch } = require('../utils/aiMatching');

const router = express.Router();
router.use(authenticate);

/**
 * GET /api/matching/score?sessionId=X&caregiverId=Y
 *
 * Returns detailed match score and reasons for a specific caregiver-session pairing.
 * Includes Claude-generated insights for top matches.
 *
 * Response: { score, reasons, insights, caregiver, session, recipient }
 */
router.get('/score', async (req, res) => {
  try {
    const { sessionId, caregiverId } = req.query;
    if (!sessionId || !caregiverId) {
      return res.status(400).json({ error: 'sessionId and caregiverId required' });
    }

    const db = await getDb();

    // Fetch session
    const session = await db.prepare(`
      SELECT cs.*, cr.id as recipient_id
      FROM care_sessions cs
      LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
      WHERE cs.id = ?
    `).get(sessionId);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Fetch caregiver profile
    const caregiver = await db.prepare(`
      SELECT cp.*, u.first_name, u.last_name
      FROM caregiver_profiles cp
      JOIN users u ON cp.user_id = u.id
      WHERE cp.id = ?
    `).get(caregiverId);

    if (!caregiver) {
      return res.status(404).json({ error: 'Caregiver not found' });
    }

    // Fetch care recipient
    const recipient = await db.prepare(`
      SELECT * FROM care_recipients WHERE id = ?
    `).get(session.recipient_id || session.care_recipient_id);

    if (!recipient) {
      return res.status(404).json({ error: 'Care recipient not found' });
    }

    // Fetch visit history for this caregiver-recipient pair
    const visitHistory = await getVisitHistory(db, caregiverId, session.recipient_id || session.care_recipient_id);

    // Compute match score (with Claude insights for high scores)
    const matchData = await scoreMatch(caregiver, session, recipient, visitHistory, db);

    res.json({
      score: matchData.score,
      reasons: matchData.reasons,
      insights: matchData.insights,
      caregiver: {
        id: caregiver.id,
        name: `${caregiver.first_name} ${caregiver.last_name}`,
        rating: caregiver.rating_avg,
        ratingCount: caregiver.rating_count,
        hourlyRate: caregiver.hourly_rate,
      },
      session: {
        id: session.id,
        date: session.scheduled_date,
        time: session.scheduled_time,
        duration: session.duration_hours,
        serviceType: session.service_type,
        budget: session.estimated_cost,
      },
      recipient: {
        id: recipient.id,
        name: `${recipient.first_name} ${recipient.last_name}`,
        age: recipient.age,
      },
    });
  } catch (err) {
    console.error('Matching score error:', err);
    res.status(500).json({ error: err.message || 'Failed to compute match score' });
  }
});

/**
 * GET /api/matching/ranked?sessionId=X&limit=10&includeInsights=false
 *
 * Returns all eligible caregivers ranked by match score for a given session.
 * For performance, insights are only generated for top 3 matches by default.
 *
 * Query params:
 *   - sessionId (required): the session to rank caregivers for
 *   - limit (optional, default 10): max number of matches to return
 *   - includeInsights (optional, default false): generate Claude insights for all results
 *
 * Response: { session, matches: [{score, reasons, insights, caregiver}, ...] }
 */
router.get('/ranked', async (req, res) => {
  try {
    const { sessionId, limit = 10, includeInsights = 'false' } = req.query;
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId required' });
    }

    const db = await getDb();
    const limitNum = Math.min(parseInt(limit) || 10, 50); // Cap at 50
    const shouldIncludeInsights = includeInsights === 'true';

    // Fetch session and recipient
    const session = await db.prepare(`
      SELECT cs.*, cr.id as recipient_id, cr.first_name, cr.last_name
      FROM care_sessions cs
      LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
      WHERE cs.id = ?
    `).get(sessionId);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Fetch care recipient details
    const recipient = await db.prepare(`
      SELECT * FROM care_recipients WHERE id = ?
    `).get(session.recipient_id || session.care_recipient_id);

    if (!recipient) {
      return res.status(404).json({ error: 'Care recipient not found' });
    }

    // Fetch all active caregivers (could be filtered by location, availability, etc.)
    const caregivers = await db.prepare(`
      SELECT cp.*, u.first_name, u.last_name
      FROM caregiver_profiles cp
      JOIN users u ON cp.user_id = u.id
      WHERE cp.is_available = 1
        AND (cp.account_paused IS NULL OR cp.account_paused = 0)
        AND (cp.is_background_checked = 1 OR EXISTS (
          SELECT 1 FROM bg_admin_vouches v
          WHERE v.caregiver_user_id = cp.user_id AND v.family_user_id = ? AND v.revoked_at IS NULL
        ))
      LIMIT 200
    `).all(session.family_user_id);

    // Compute match scores for all caregivers
    const matches = [];
    for (const caregiver of caregivers) {
      try {
        const visitHistory = await getVisitHistory(db, caregiver.id, session.recipient_id || session.care_recipient_id);

        // For ranked view, only include insights for top 3 matches or if explicitly requested
        const includeInsightsForThis = shouldIncludeInsights || matches.length < 3;
        const matchData = await scoreMatch(caregiver, session, recipient, visitHistory, includeInsightsForThis ? db : null);

        matches.push({
          score: matchData.score,
          reasons: matchData.reasons,
          insights: matchData.insights || '',
          caregiver: {
            id: caregiver.id,
            name: `${caregiver.first_name} ${caregiver.last_name}`,
            rating: caregiver.rating_avg || 0,
            ratingCount: caregiver.rating_count || 0,
            hourlyRate: caregiver.hourly_rate || 0,
            specialties: parseJson(caregiver.specialties || '[]'),
          },
        });
      } catch (err) {
        console.error(`Error scoring caregiver ${caregiver.id}:`, err.message);
        // Skip this caregiver on error
        continue;
      }
    }

    // Sort by score descending
    matches.sort((a, b) => b.score - a.score);

    // Return top N matches
    const topMatches = matches.slice(0, limitNum);

    res.json({
      session: {
        id: session.id,
        date: session.scheduled_date,
        time: session.scheduled_time,
        duration: session.duration_hours,
        serviceType: session.service_type,
        recipientName: `${session.first_name} ${session.last_name}`,
      },
      totalCaregivers: caregivers.length,
      rankedCount: topMatches.length,
      matches: topMatches,
    });
  } catch (err) {
    console.error('Ranking error:', err);
    res.status(500).json({ error: err.message || 'Failed to rank caregivers' });
  }
});

/**
 * Helper: fetch visit history for a caregiver-recipient pair
 * Returns { sessionCount, avgMoodImprovement, avgRating }
 */
async function getVisitHistory(db, caregiverId, recipientId) {
  if (!caregiverId || !recipientId) {
    return { sessionCount: 0, avgMoodImprovement: 0, avgRating: 0 };
  }

  try {
    // Count completed sessions
    const sessionStats = await db.prepare(`
      SELECT COUNT(*) as session_count
      FROM care_sessions
      WHERE caregiver_id = ? AND care_recipient_id = ? AND status = 'completed'
    `).get(caregiverId, recipientId);

    const sessionCount = sessionStats?.session_count || 0;

    // Average mood improvement from visit logs
    const moodStats = await db.prepare(`
      SELECT AVG(
        CASE
          WHEN vl.arrival_mood IS NOT NULL AND vl.departure_mood IS NOT NULL
          THEN GREATEST(0, LEAST(1, (vl.departure_mood::float - vl.arrival_mood::float) / 5))
          ELSE NULL
        END
      ) as avg_mood_improvement
      FROM visit_logs vl
      JOIN care_sessions cs ON vl.session_id = cs.id
      WHERE cs.caregiver_id = ? AND cs.care_recipient_id = ? AND cs.status = 'completed'
    `).get(caregiverId, recipientId);

    const avgMoodImprovement = parseFloat(moodStats?.avg_mood_improvement || 0) || 0;

    // Average rating from reviews for this caregiver-recipient pair
    const ratingStats = await db.prepare(`
      SELECT AVG(r.rating) as avg_rating, COUNT(*) as rating_count
      FROM reviews r
      JOIN care_sessions cs ON r.session_id = cs.id
      WHERE cs.caregiver_id = ? AND cs.care_recipient_id = ?
    `).get(caregiverId, recipientId);

    const avgRating = parseFloat(ratingStats?.avg_rating || 0) || 0;

    return {
      sessionCount,
      avgMoodImprovement,
      avgRating,
    };
  } catch (err) {
    console.error('Visit history query error:', err);
    return { sessionCount: 0, avgMoodImprovement: 0, avgRating: 0 };
  }
}

/**
 * Helper: safely parse JSON
 */
function parseJson(str) {
  if (!str) return [];
  try {
    return JSON.parse(str);
  } catch {
    return [];
  }
}

module.exports = router;
