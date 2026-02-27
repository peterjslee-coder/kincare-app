/**
 * Job matching utilities — conflict detection and match scoring
 * for caregiver dashboard "Find Work" section.
 */

const TRAVEL_BUFFER_MINUTES = 30; // buffer after each session for travel

/**
 * Check if an open job conflicts with any of the caregiver's existing sessions.
 * Adds a travel buffer after each existing session's end time.
 *
 * @param {object} job - { scheduled_date, scheduled_time, duration_hours }
 * @param {Array} existingSessions - caregiver's upcoming sessions [{ date/scheduled_date, time/scheduled_time, durationHours/duration_hours }]
 * @returns {{ hasConflict: boolean, conflictWith: string|null }}
 */
function computeJobConflicts(job, existingSessions) {
  if (!job.scheduled_time || !existingSessions || existingSessions.length === 0) {
    return { hasConflict: false, conflictWith: null };
  }

  const jobDate = (job.scheduled_date || '').split('T')[0];
  const jobStartMin = parseTimeToMinutes(job.scheduled_time);
  const jobDuration = parseFloat(job.duration_hours) || 2;
  const jobEndMin = jobStartMin + jobDuration * 60;

  for (const session of existingSessions) {
    const sDate = (session.date || session.scheduled_date || '').split('T')[0];
    if (sDate !== jobDate) continue; // different day, no conflict

    const sTime = session.time || session.scheduled_time;
    if (!sTime) continue;

    const sStartMin = parseTimeToMinutes(sTime);
    const sDuration = parseFloat(session.durationHours || session.duration_hours) || 2;
    const sEndMin = sStartMin + sDuration * 60 + TRAVEL_BUFFER_MINUTES;

    // Check overlap: job starts before session+buffer ends AND job ends after session starts
    if (jobStartMin < sEndMin && jobEndMin > (sStartMin - TRAVEL_BUFFER_MINUTES)) {
      return {
        hasConflict: true,
        conflictWith: formatTime12(sTime),
      };
    }
  }

  return { hasConflict: false, conflictWith: null };
}

/**
 * Score a job for a caregiver (0-100). Higher = better match.
 *
 * @param {object} job - { service_type, scheduled_date, scheduled_time }
 * @param {object} profile - { specialties (JSON string or array), maxTravelMiles }
 * @param {boolean} hasConflict
 * @param {number|null} distanceMiles
 * @returns {{ score: number, quality: string|null }}
 */
function computeMatchScore(job, profile, hasConflict, distanceMiles) {
  let score = 0;

  // No conflict: +40
  if (!hasConflict) score += 40;

  // Distance: +25 max (scales down beyond max_travel_miles)
  const maxMiles = profile.maxTravelMiles || profile.max_travel_miles || 10;
  if (distanceMiles !== null && distanceMiles !== undefined) {
    if (distanceMiles <= maxMiles) {
      score += 25;
    } else if (distanceMiles <= maxMiles * 2) {
      // Linear falloff: 25 → 5 as distance goes from maxMiles to 2×maxMiles
      score += Math.round(25 - 20 * ((distanceMiles - maxMiles) / maxMiles));
    } else {
      score += 5;
    }
  } else {
    // No location data — neutral score
    score += 12;
  }

  // Specialty match: +20
  let specialties = profile.specialties || [];
  if (typeof specialties === 'string') {
    try { specialties = JSON.parse(specialties); } catch (e) { specialties = []; }
  }
  if (specialties.length > 0 && job.service_type) {
    const svcNorm = (job.service_type || '').toLowerCase().replace(/_/g, ' ');
    const matched = specialties.some(s =>
      svcNorm.includes((s || '').toLowerCase()) || (s || '').toLowerCase().includes(svcNorm)
    );
    if (matched) score += 20;
  } else {
    // No specialties configured — give partial credit
    score += 10;
  }

  // Urgency: +15 if within 48 hours
  if (job.scheduled_date) {
    const jobDate = new Date(job.scheduled_date + 'T12:00:00');
    const hoursUntil = (jobDate - new Date()) / (1000 * 60 * 60);
    if (hoursUntil <= 48 && hoursUntil > 0) {
      score += 15;
    } else if (hoursUntil <= 96) {
      score += 8;
    }
  }

  // Cap at 100
  score = Math.min(score, 100);

  const quality = score >= 75 ? 'great' : score >= 50 ? 'good' : null;

  return { score, quality };
}

/**
 * Parse "HH:MM" time string to minutes since midnight.
 */
function parseTimeToMinutes(timeStr) {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * Format "HH:MM" 24h time to "H:MM AM/PM".
 */
function formatTime12(timeStr) {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const dh = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${dh}:${String(m).padStart(2, '0')} ${ampm}`;
}

module.exports = { computeJobConflicts, computeMatchScore };
