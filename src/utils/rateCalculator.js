// ─── Rate Calculator ───
// Pure functions for tiered rate calculation, short-notice surcharge, overnight minimums.
// Tier boundaries: daytime 7:00–18:00, nighttime 18:00–24:00, overnight 0:00–7:00.

const TIER_BOUNDARIES = [
  { tier: 'overnight', start: 0, end: 7 },    // 12am – 7am
  { tier: 'daytime',   start: 7, end: 18 },   // 7am – 6pm
  { tier: 'nighttime', start: 18, end: 24 },   // 6pm – 12am
];

const OVERNIGHT_MIN_HOURS = 6;
const SHORT_NOTICE_HOURS = 24;
const SHORT_NOTICE_SURCHARGE_PCT = 0.20;
const SURCHARGE_CAREGIVER_SHARE = 0.75;
const SURCHARGE_PLATFORM_SHARE = 0.25;

/**
 * Detect which rate tier applies for a given hour (0–23).
 * @param {number} hour — 0-based hour of day
 * @returns {'daytime'|'nighttime'|'overnight'}
 */
function detectTier(hour) {
  if (hour >= 0 && hour < 7) return 'overnight';
  if (hour >= 7 && hour < 18) return 'daytime';
  return 'nighttime'; // 18–23
}

/**
 * Check if a booking qualifies for short-notice surcharge (<24h before start).
 * @param {string|Date} sessionStart — session start datetime
 * @param {string|Date} bookingTime — when the booking was made (default: now)
 * @returns {boolean}
 */
function isShortNotice(sessionStart, bookingTime) {
  const start = new Date(sessionStart);
  const booked = bookingTime ? new Date(bookingTime) : new Date();
  const hoursUntilStart = (start.getTime() - booked.getTime()) / (1000 * 60 * 60);
  return hoursUntilStart < SHORT_NOTICE_HOURS;
}

/**
 * Calculate session cost by walking minute-by-minute through tier boundaries.
 *
 * @param {string} startTime — ISO datetime or "HH:MM" (combined with scheduledDate)
 * @param {string} endTime — ISO datetime or derived from startTime + durationHours
 * @param {object} rates — { daytime, nighttime, overnight, base }
 *   If a tier rate is null/undefined, falls back to `base` (which falls back to 28)
 * @param {object} [options]
 * @param {boolean} [options.shortNotice=false] — whether short-notice surcharge applies
 * @param {number} [options.surchargePercent=0.20]
 * @param {number} [options.overnightMinHours=6]
 * @param {string} [options.scheduledDate] — "YYYY-MM-DD" if startTime is "HH:MM"
 * @param {number} [options.durationHours] — alternative to endTime
 * @returns {object} { subtotal, tierBreakdown, surcharge, surchargeBreakdown, total, effectiveHourlyRate, totalHours }
 */
function calculateSessionCost(startTime, endTime, rates, options = {}) {
  const base = rates.base || rates.daytime || 28;
  const rateMap = {
    daytime:   rates.daytime   ?? base,
    nighttime: rates.nighttime ?? base,
    overnight: rates.overnight ?? base,
  };

  const surchargePercent = options.surchargePercent ?? SHORT_NOTICE_SURCHARGE_PCT;
  const overnightMin = options.overnightMinHours ?? OVERNIGHT_MIN_HOURS;

  // Parse start/end times
  let startDt, endDt;
  if (options.scheduledDate && /^\d{1,2}:\d{2}/.test(startTime)) {
    startDt = new Date(`${options.scheduledDate}T${startTime.padStart(5, '0')}:00`);
  } else {
    startDt = new Date(startTime);
  }
  if (endTime) {
    if (options.scheduledDate && /^\d{1,2}:\d{2}/.test(endTime)) {
      endDt = new Date(`${options.scheduledDate}T${endTime.padStart(5, '0')}:00`);
    } else {
      endDt = new Date(endTime);
    }
  } else if (options.durationHours) {
    endDt = new Date(startDt.getTime() + options.durationHours * 60 * 60 * 1000);
  } else {
    endDt = new Date(startDt.getTime() + 2 * 60 * 60 * 1000); // default 2h
  }

  // Walk minute-by-minute and accumulate minutes per tier
  const tierMinutes = { daytime: 0, nighttime: 0, overnight: 0 };
  const totalMinutes = Math.round((endDt.getTime() - startDt.getTime()) / (1000 * 60));

  for (let m = 0; m < totalMinutes; m++) {
    const dt = new Date(startDt.getTime() + m * 60 * 1000);
    const tier = detectTier(dt.getHours());
    tierMinutes[tier]++;
  }

  // Enforce overnight minimum: if ANY overnight minutes, pad to overnightMin hours
  if (tierMinutes.overnight > 0 && tierMinutes.overnight < overnightMin * 60) {
    tierMinutes.overnight = overnightMin * 60;
  }

  // Build breakdown
  const tierBreakdown = [];
  let subtotal = 0;
  for (const tier of ['daytime', 'nighttime', 'overnight']) {
    const minutes = tierMinutes[tier];
    if (minutes > 0) {
      const hours = Math.round(minutes / 60 * 100) / 100; // 2 decimal places
      const rate = rateMap[tier];
      const amount = Math.round(rate * hours * 100) / 100;
      subtotal += amount;
      tierBreakdown.push({ tier, hours, rate, amount });
    }
  }

  subtotal = Math.round(subtotal * 100) / 100;

  // Short-notice surcharge
  let surcharge = 0;
  let surchargeBreakdown = { caregiver: 0, platform: 0 };
  if (options.shortNotice) {
    surcharge = Math.round(subtotal * surchargePercent * 100) / 100;
    surchargeBreakdown = {
      caregiver: Math.round(surcharge * SURCHARGE_CAREGIVER_SHARE * 100) / 100,
      platform: Math.round(surcharge * SURCHARGE_PLATFORM_SHARE * 100) / 100,
    };
  }

  const total = Math.round((subtotal + surcharge) * 100) / 100;
  const totalHours = tierBreakdown.reduce((s, t) => s + t.hours, 0);
  const effectiveHourlyRate = totalHours > 0 ? Math.round(total / totalHours * 100) / 100 : 0;

  return {
    subtotal,
    tierBreakdown,
    surcharge,
    surchargeBreakdown,
    total,
    effectiveHourlyRate,
    totalHours,
  };
}

/**
 * Human-readable cost breakdown string.
 */
function formatCostBreakdown(result) {
  const lines = result.tierBreakdown.map(t =>
    `${t.hours}h ${t.tier} @ $${t.rate}/hr = $${t.amount.toFixed(2)}`
  );
  if (result.surcharge > 0) {
    lines.push(`Short-notice surcharge (20%): +$${result.surcharge.toFixed(2)}`);
  }
  lines.push(`Total: $${result.total.toFixed(2)}`);
  return lines.join('\n');
}

module.exports = {
  detectTier,
  isShortNotice,
  calculateSessionCost,
  formatCostBreakdown,
  TIER_BOUNDARIES,
  OVERNIGHT_MIN_HOURS,
  SHORT_NOTICE_HOURS,
  SHORT_NOTICE_SURCHARGE_PCT,
  SURCHARGE_CAREGIVER_SHARE,
  SURCHARGE_PLATFORM_SHARE,
};
