const express = require("express");
const { getDb } = require("../models/database");
const { authenticate } = require("../middleware/auth");
const { getNowInZone, getTodayStringInZone } = require("../utils/timezone");
const { haversineDistance } = require("../utils/geocode");
const { computeJobConflicts, computeMatchScore } = require("../utils/jobMatching");
const { calculateSessionCost } = require("../utils/rateCalculator");
const { scoreMatch } = require("../utils/aiMatching");
const { expireStaleProposals } = require("./sessions");

const router = express.Router();
router.use(authenticate);

// Helper: get platform fee percent from DB (default 20)
async function getPlatformFeePercent(db) {
  try {
    const row = await db.prepare("SELECT value FROM platform_settings WHERE key = 'platform_fee_percent'").get();
    return row ? parseFloat(row.value) : 20;
  } catch { return 20; }
}

// ─── GET /api/dashboard ───
// Role-aware dashboard data
router.get("/", async (req, res) => {
  const db = await getDb();
  const userId = req.user.id;
  const role = req.user.activeRole || req.user.role;

  if (role === "family") {
    return familyDashboard(db, userId, res);
  } else if (role === "caregiver") {
    return caregiverDashboard(db, userId, res);
  } else if (role === "care_for") {
    return careForDashboard(db, userId, res);
  }

  res.status(403).json({ error: "Unknown role" });
});

// ─── Family Dashboard (Pete's view) ───
async function familyDashboard(db, userId, res) {
  try {
    // Fire-and-forget: housekeeping writes run in background, don't block dashboard load
    expireStaleProposals(db, null, null).catch(() => {});
    db.exec(`
      UPDATE care_sessions
      SET status = 'cancelled', cancelled_at = NOW(), cancel_reason = 'Private request expired - scheduled date passed'
      WHERE offered_to_caregiver_id IS NOT NULL
        AND COALESCE(private_only, 0) = 1
        AND scheduled_date::date < CURRENT_DATE
        AND status IN ('pending', 'open', 'requested')
    `).catch(e => console.warn('Private-only expiry query failed:', e.message));
    db.exec(`
      UPDATE care_sessions
      SET offered_to_caregiver_id = NULL, exclusive_until = NULL, status = 'open'
      WHERE offered_to_caregiver_id IS NOT NULL
        AND exclusive_until IS NOT NULL
        AND exclusive_until < NOW()
        AND COALESCE(private_only, 0) = 0
        AND status IN ('pending', 'open', 'requested')
    `).catch(() => {
      db.exec(`
        UPDATE care_sessions
        SET offered_to_caregiver_id = NULL, exclusive_until = NULL, status = 'open'
        WHERE offered_to_caregiver_id IS NOT NULL
          AND exclusive_until IS NOT NULL
          AND exclusive_until < NOW()
          AND status IN ('pending', 'open', 'requested')
      `).catch(() => {});
    });

    // Parallel batch 1: fee + all three recipient sources at once
    const [feePercent, ownedRecipients, sharedRecipients, teamRecipients] = await Promise.all([
      getPlatformFeePercent(db),
      db.prepare("SELECT * FROM care_recipients WHERE family_user_id = ?").all(userId),
      db.prepare(`
        SELECT cr.* FROM care_recipient_shares crs
        JOIN care_recipients cr ON crs.care_recipient_id = cr.id
        WHERE crs.shared_with_user_id = ?
      `).all(userId),
      db.prepare(`
        SELECT cr.* FROM care_team_members ctm
        JOIN care_teams ct ON ctm.care_team_id = ct.id
        JOIN care_recipients cr ON ct.care_recipient_id = cr.id
        WHERE ctm.user_id = ?
      `).all(userId),
    ]);
    const ownedIds = new Set(ownedRecipients.map(r => r.id));
    const sharedIds = new Set(sharedRecipients.map(r => r.id));
    const recipients = [
      ...ownedRecipients,
      ...sharedRecipients.filter(r => !ownedIds.has(r.id)),
      ...teamRecipients.filter(r => !ownedIds.has(r.id) && !sharedIds.has(r.id)),
    ];

    const famEtNow = getNowInZone();
    const monthStart = new Date(famEtNow); monthStart.setDate(1);
    const monthStr = monthStart.getFullYear() + '-' + String(monthStart.getMonth() + 1).padStart(2, '0') + '-01';

    // All recipient IDs this user can see (owned + shared)
    const allRecipientIds = recipients.map(r => r.id);
    const recipientPlaceholders = allRecipientIds.length > 0 ? allRecipientIds.map(() => '?').join(',') : "'__none__'";

    // Use care-location timezone for "today" — all times are care-location times
    const today = getTodayStringInZone();
    const etNow = getNowInZone();
    const next30Date = new Date(etNow); next30Date.setDate(next30Date.getDate() + 30);
    const next30 = next30Date.getFullYear() + '-' + String(next30Date.getMonth() + 1).padStart(2, '0') + '-' + String(next30Date.getDate()).padStart(2, '0');
    const sevenDaysAgo = new Date(etNow); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const sevenDaysAgoStr = sevenDaysAgo.getFullYear() + '-' + String(sevenDaysAgo.getMonth() + 1).padStart(2, '0') + '-' + String(sevenDaysAgo.getDate()).padStart(2, '0');

    // Parallel batch 2: ALL read queries at once (none depend on each other)
    const [monthlyStats, upcoming, recentCompleted, recentActivity, unreadCount, recentPhotos, pendingProposals, avgRating, assignedCount] = await Promise.all([
      // Monthly stats
      db.prepare(`
        SELECT
          COUNT(*) as total_sessions,
          SUM(duration_hours) as total_hours,
          SUM(COALESCE(actual_cost, estimated_cost)) as total_spend
        FROM care_sessions cs
        WHERE (cs.family_user_id = ? OR cs.care_recipient_id IN (${recipientPlaceholders}))
          AND cs.scheduled_date >= ?
          AND cs.status IN ('confirmed', 'completed', 'in_progress')
      `).get(userId, ...allRecipientIds, monthStr),

      // Upcoming sessions
      db.prepare(`
        SELECT * FROM (
          SELECT DISTINCT ON (cs.id) cs.*,
            cr.first_name || ' ' || cr.last_name AS recipient_name,
            cr.timezone AS care_timezone,
            u.first_name || ' ' || u.last_name AS caregiver_name,
            u.phone AS caregiver_phone,
            cp.rating_avg AS caregiver_rating,
            fu.first_name || ' ' || fu.last_name AS booked_by_name,
            vl.check_in_time,
            ofu.first_name AS offered_caregiver_name,
            tcp.proposed_time AS tc_proposed_time,
            tcp.proposed_duration AS tc_proposed_duration,
            tcp.proposed_by AS tc_proposed_by
          FROM care_sessions cs
          LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
          LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
          LEFT JOIN users u ON cp.user_id = u.id
          LEFT JOIN users fu ON cs.family_user_id = fu.id
          LEFT JOIN visit_logs vl ON vl.session_id = cs.id
          LEFT JOIN caregiver_profiles ocp ON cs.offered_to_caregiver_id = ocp.id
          LEFT JOIN users ofu ON ocp.user_id = ofu.id
          LEFT JOIN time_change_proposals tcp ON cs.pending_time_change_id = tcp.id
          WHERE (cs.family_user_id = ? OR cs.care_recipient_id IN (${recipientPlaceholders}))
            AND cs.scheduled_date >= ?
            AND cs.scheduled_date <= ?
            AND cs.status IN ('pending', 'confirmed', 'open', 'requested', 'in_progress', 'payment_hold')
          ORDER BY cs.id
        ) sub
        ORDER BY sub.scheduled_date ASC, sub.scheduled_time ASC
        LIMIT 15
      `).all(userId, ...allRecipientIds, today, next30),

      // Recently completed sessions (last 7 days)
      db.prepare(`
        SELECT * FROM (
          SELECT DISTINCT ON (cs.id) cs.*,
            cr.first_name || ' ' || cr.last_name AS recipient_name,
            u.first_name || ' ' || u.last_name AS caregiver_name,
            vl.summary AS visit_summary,
            vl.care_feedback,
            vl.departure_mood,
            vl.condition_tags
          FROM care_sessions cs
          LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
          LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
          LEFT JOIN users u ON cp.user_id = u.id
          LEFT JOIN visit_logs vl ON vl.session_id = cs.id
          WHERE (cs.family_user_id = ? OR cs.care_recipient_id IN (${recipientPlaceholders}))
            AND cs.status = 'completed'
            AND cs.cancelled_by IS NULL
            AND cs.caregiver_no_show = 0
            AND cs.scheduled_date >= ?
          ORDER BY cs.id
        ) sub
        ORDER BY sub.scheduled_date DESC, sub.scheduled_time DESC
        LIMIT 5
      `).all(userId, ...allRecipientIds, sevenDaysAgoStr),

      // Recent activity
      db.prepare(`
        SELECT * FROM activity_feed
        WHERE family_user_id = ? OR care_recipient_id IN (${recipientPlaceholders})
        ORDER BY created_at DESC LIMIT 5
      `).all(userId, ...allRecipientIds),

      // Unread count
      db.prepare(
        `SELECT COUNT(*) as count FROM activity_feed WHERE (family_user_id = ? OR care_recipient_id IN (${recipientPlaceholders})) AND is_read = 0`
      ).get(userId, ...allRecipientIds),

      // Recent visit photos
      db.prepare(`
        SELECT vp.id, vp.photo_url, vp.caption, vp.created_at,
          u.first_name || ' ' || u.last_name AS caregiver_name,
          cr.first_name || ' ' || cr.last_name AS recipient_name,
          cs.id AS session_id, cs.scheduled_date
        FROM visit_photos vp
        JOIN visit_logs vl ON vp.visit_log_id = vl.id
        JOIN care_sessions cs ON vl.session_id = cs.id
        JOIN caregiver_profiles cp ON vl.caregiver_id = cp.id
        JOIN users u ON cp.user_id = u.id
        LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
        WHERE (cs.family_user_id = ? OR cs.care_recipient_id IN (${recipientPlaceholders}))
        ORDER BY vp.created_at DESC
        LIMIT 12
      `).all(userId, ...allRecipientIds).catch(() => []),

      // Pending time proposals
      db.prepare(`
        SELECT tp.*,
          u.first_name || ' ' || u.last_name AS caregiver_name,
          cp.rating_avg AS caregiver_rating,
          cs.scheduled_date AS original_date,
          cs.scheduled_time AS original_time,
          cs.service_type,
          cs.duration_hours,
          cr.first_name || ' ' || cr.last_name AS recipient_name
        FROM time_proposals tp
        JOIN care_sessions cs ON tp.session_id = cs.id
        JOIN caregiver_profiles cp ON tp.caregiver_profile_id = cp.id
        JOIN users u ON tp.caregiver_user_id = u.id
        LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
        WHERE (cs.family_user_id = ? OR cs.care_recipient_id IN (${recipientPlaceholders}))
          AND tp.status = 'pending'
        ORDER BY tp.created_at DESC
        LIMIT 20
      `).all(userId, ...allRecipientIds).catch(() => []),

      // Average caregiver rating
      db.prepare(`
        SELECT AVG(cp.rating_avg) as avg
        FROM care_sessions cs
        JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
        WHERE (cs.family_user_id = ? OR cs.care_recipient_id IN (${recipientPlaceholders})) AND cs.status = 'completed'
      `).get(userId, ...allRecipientIds),

      // Assigned caregiver count
      db.prepare(`
        SELECT COUNT(DISTINCT ca.caregiver_profile_id) as count
        FROM caregiver_assignments ca
        LEFT JOIN care_recipients cr ON ca.care_recipient_id = cr.id
        WHERE (ca.family_user_id = ? OR ca.care_recipient_id IN (${recipientPlaceholders})) AND ca.is_active = 1
      `).get(userId, ...allRecipientIds),
    ]);

    const primary = recipients[0];
    const parent = primary
      ? {
          id: primary.id,
          name: `${primary.first_name} ${primary.last_name}`,
          age: primary.age,
          location: `${primary.location_city}, ${primary.location_state}`,
          healthConditions: JSON.parse(primary.health_conditions || "[]"),
          medications: JSON.parse(primary.medications || "[]"),
          preferences: primary.preferences,
          photo: primary.photo || null,
          emoji: primary.emoji || null,
          consent_status: primary.consent_status || 'pending',
          authorization_tier: primary.authorization_tier || 'unset',
          emergencyContact: {
            name: primary.emergency_contact_name,
            phone: primary.emergency_contact_phone,
          },
        }
      : null;

    res.json({
      role: "family",
      parent,
      isNewUser: recipients.length === 0,
      careRecipients: recipients.map((r) => ({
        ...r,
        healthConditions: JSON.parse(r.health_conditions || "[]"),
        medications: JSON.parse(r.medications || "[]"),
      })),
      stats: {
        sessionsThisMonth: (monthlyStats && monthlyStats.total_sessions) || 0,
        totalHours: Math.round(((monthlyStats && monthlyStats.total_hours) || 0) * 10) / 10,
        monthlySpend: Math.round(((monthlyStats && monthlyStats.total_spend) || 0) * 100) / 100,
        avgCaregiverRating: Math.round(((avgRating && avgRating.avg) || 0) * 10) / 10,
        unreadNotifications: (unreadCount && unreadCount.count) || 0,
        assignedCaregivers: (assignedCount && assignedCount.count) || 0,
      },
      platformFeePercent: feePercent,
      upcomingSessions: upcoming.map((s) => {
        const familyPrice = parseFloat(s.estimated_cost) || 0;
        const fee = Math.round(familyPrice * (feePercent / 100) * 100) / 100;
        return {
          id: s.id,
          date: s.scheduled_date,
          time: s.scheduled_time,
          serviceType: s.service_type,
          status: s.status,
          durationHours: s.duration_hours,
          caregiverName: s.caregiver_name,
          caregiverPhone: s.caregiver_phone || null,
          caregiverRating: s.caregiver_rating,
          recipientName: s.recipient_name,
          specialInstructions: s.special_instructions,
          estimatedCost: s.estimated_cost,
          caregiverPayout: Math.round((familyPrice - fee) * 100) / 100,
          platformFee: fee,
          familyTotal: familyPrice,
          timezone: s.care_timezone || "America/New_York",
          bookedBy: s.family_user_id !== userId ? s.booked_by_name : null,
          checkInTime: s.check_in_time || null,
          offeredToCaregiverId: s.offered_to_caregiver_id || null,
          exclusiveUntil: s.exclusive_until || null,
          offeredCaregiverName: s.offered_caregiver_name || null,
          pendingTimeChangeId: s.pending_time_change_id || null,
          tcProposedTime: s.tc_proposed_time || null,
          tcProposedDuration: s.tc_proposed_duration || null,
          tcProposedBy: s.tc_proposed_by || null,
        };
      }),
      recentActivity: recentActivity.map((a) => {
        let meta = {};
        try { meta = a.metadata ? JSON.parse(a.metadata) : {}; } catch(e) {}
        return {
          id: a.id,
          eventType: a.event_type,
          title: a.title,
          message: a.message,
          isRead: a.is_read,
          timestamp: a.created_at,
          sessionId: meta.sessionId || null,
        };
      }),
      pendingProposals: pendingProposals.map(p => ({
        id: p.id,
        sessionId: p.session_id,
        caregiverName: p.caregiver_name,
        caregiverRating: p.caregiver_rating,
        proposedDate: p.proposed_date,
        proposedTime: p.proposed_time,
        message: p.message,
        originalDate: p.original_date,
        originalTime: p.original_time,
        serviceType: p.service_type,
        durationHours: p.duration_hours,
        recipientName: p.recipient_name,
        createdAt: p.created_at,
        expiresAt: p.expires_at,
      })),
      recentPhotos: recentPhotos.map(p => ({
        id: p.id,
        photoUrl: p.photo_url,
        caption: p.caption,
        createdAt: p.created_at,
        caregiverName: p.caregiver_name,
        recipientName: p.recipient_name,
        sessionId: p.session_id,
        sessionDate: p.scheduled_date,
      })),
      recentlyCompleted: await Promise.all(recentCompleted.map(async (s) => {
        let condTags = [];
        try { condTags = s.condition_tags ? JSON.parse(s.condition_tags) : []; } catch(e) {}
        // Check if family already reviewed this session
        const existingReview = await db.prepare(
          "SELECT id, rating FROM reviews WHERE session_id = ? AND family_user_id = ?"
        ).get(s.id, userId);
        return {
          id: s.id,
          date: s.scheduled_date,
          time: s.scheduled_time,
          serviceType: s.service_type,
          durationHours: s.duration_hours,
          caregiverName: s.caregiver_name,
          caregiverId: s.caregiver_id,
          recipientName: s.recipient_name,
          visitSummary: s.care_feedback || s.visit_summary,
          departureMood: s.departure_mood,
          conditionTags: condTags,
          hasReview: !!existingReview,
          reviewRating: existingReview ? existingReview.rating : null,
        };
      })),
    });
  } catch (err) {
    console.error("Family dashboard error:", err);
    // Return a valid response even on error so frontend doesn't break
    res.json({
      role: "family",
      parent: null,
      isNewUser: true,
      careRecipients: [],
      stats: { sessionsThisMonth: 0, totalHours: 0, monthlySpend: 0, avgCaregiverRating: 0, unreadNotifications: 0, assignedCaregivers: 0 },
      upcomingSessions: [],
      recentActivity: [],
    });
  }
}

// ─── Caregiver Dashboard (Maria's view) ───
async function caregiverDashboard(db, userId, res) {
  // Expire time proposals that have passed their 2-hour response window
  await expireStaleProposals(db, null, null).catch(() => {});

  // Private-only sessions: NO timer-based expiry here. They persist until scheduled_date passes.
  // (Family dashboard handles date-based expiry for private-only sessions.)
  // Non-private exclusive offers: open to all caregivers after 1-hour window
  try {
    await db.exec(`
      UPDATE care_sessions
      SET offered_to_caregiver_id = NULL, exclusive_until = NULL, status = 'open'
      WHERE offered_to_caregiver_id IS NOT NULL
        AND exclusive_until IS NOT NULL
        AND exclusive_until < NOW()
        AND COALESCE(private_only, 0) = 0
        AND status IN ('pending', 'open', 'requested')
    `);
  } catch (e) {
    await db.exec(`
      UPDATE care_sessions
      SET offered_to_caregiver_id = NULL, exclusive_until = NULL, status = 'open'
      WHERE offered_to_caregiver_id IS NOT NULL
        AND exclusive_until IS NOT NULL
        AND exclusive_until < NOW()
        AND status IN ('pending', 'open', 'requested')
    `);
  }

  const profile = await db.prepare("SELECT * FROM caregiver_profiles WHERE user_id = ?").get(userId);
  if (!profile) return res.status(404).json({ error: "Caregiver profile not found" });

  const user = await db.prepare("SELECT first_name, last_name, avatar_url FROM users WHERE id = ?").get(userId);

  // Assigned families (deduplicate by care_recipient — siblings may each have an assignment for same recipient)
  const assignments = await db.prepare(`
    SELECT DISTINCT ON (ca.care_recipient_id)
      ca.*, cr.first_name AS recipient_first_name, cr.last_name AS recipient_last_name,
      cr.location_address, cr.location_city, cr.location_state, cr.latitude, cr.longitude,
      cr.health_conditions, cr.preferences,
      fu.first_name AS family_first_name, fu.last_name AS family_last_name
    FROM caregiver_assignments ca
    JOIN care_recipients cr ON ca.care_recipient_id = cr.id
    JOIN users fu ON ca.family_user_id = fu.id
    WHERE ca.caregiver_profile_id = ? AND ca.is_active = 1
    ORDER BY ca.care_recipient_id, ca.is_favorite DESC, ca.created_at ASC
  `).all(profile.id);

  // Upcoming sessions — use care-location timezone
  const cgEtNow = getNowInZone();
  const today = getTodayStringInZone();
  const upcoming = await db.prepare(`
    SELECT cs.*,
      cr.first_name || ' ' || cr.last_name AS recipient_name,
      cr.location_address, cr.location_city,
      cr.preferences AS recipient_preferences,
      cr.timezone AS care_timezone,
      cr.health_conditions AS cr_health_conditions,
      cr.caregiver_briefing AS cr_caregiver_briefing,
      cr.latitude AS recipient_lat,
      cr.longitude AS recipient_lng,
      fu.first_name || ' ' || fu.last_name AS family_name,
      cp.hourly_rate AS cg_hourly_rate, cp.rate_daytime AS cg_rate_daytime,
      cp.rate_nighttime AS cg_rate_nighttime, cp.rate_overnight AS cg_rate_overnight,
      vl.check_in_time,
      tcp.proposed_time AS tc_proposed_time,
      tcp.proposed_duration AS tc_proposed_duration,
      tcp.proposed_by AS tc_proposed_by
    FROM care_sessions cs
    LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
    LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
    LEFT JOIN users fu ON cs.family_user_id = fu.id
    LEFT JOIN visit_logs vl ON vl.session_id = cs.id
    LEFT JOIN time_change_proposals tcp ON cs.pending_time_change_id = tcp.id
    WHERE cs.caregiver_id = ? AND cs.scheduled_date >= ? AND cs.status IN ('pending', 'confirmed', 'in_progress', 'payment_hold')
    ORDER BY cs.scheduled_date ASC, cs.scheduled_time ASC
    LIMIT 20
  `).all(profile.id, today);

  // Monthly stats
  const cgMonthStart = new Date(cgEtNow); cgMonthStart.setDate(1);
  const monthStr = cgMonthStart.getFullYear() + '-' + String(cgMonthStart.getMonth() + 1).padStart(2, '0') + '-01';

  const monthlyStats = await db.prepare(`
    SELECT COUNT(*) as completed_sessions,
      SUM(COALESCE(actual_cost, estimated_cost)) as total_earnings,
      SUM(COALESCE(short_notice_surcharge, 0)) as total_surcharges,
      SUM(duration_hours) as total_hours
    FROM care_sessions
    WHERE caregiver_id = ? AND scheduled_date >= ? AND status = 'completed'
  `).get(profile.id, monthStr);

  const pending = await db.prepare(`
    SELECT SUM(estimated_cost) as pending_earnings,
      SUM(COALESCE(short_notice_surcharge, 0)) as pending_surcharges
    FROM care_sessions
    WHERE caregiver_id = ? AND status IN ('confirmed', 'pending') AND scheduled_date >= ?
  `).get(profile.id, today);

  // Open care requests — jobs available to claim (next 30 days)
  const thirtyDaysOut = new Date(cgEtNow);
  thirtyDaysOut.setDate(thirtyDaysOut.getDate() + 30);
  const fiveDayStr = thirtyDaysOut.getFullYear() + '-' + String(thirtyDaysOut.getMonth() + 1).padStart(2, '0') + '-' + String(thirtyDaysOut.getDate()).padStart(2, '0');

  // Demo isolation: only show jobs from families with matching demo status
  const me = await db.prepare("SELECT is_demo FROM users WHERE id = ?").get(userId);
  const isDemo = me && me.is_demo ? 1 : 0;

  // Build a cutoff: for today's date, exclude sessions whose start time has already passed
  const nowTimeStr = String(cgEtNow.getHours()).padStart(2, '0') + ':' + String(cgEtNow.getMinutes()).padStart(2, '0');

  const openJobs = await db.prepare(`
    SELECT cs.*,
      cr.first_name || ' ' || cr.last_name AS recipient_name,
      cr.location_city AS recipient_city,
      cr.latitude AS recipient_lat,
      cr.longitude AS recipient_lng,
      cr.timezone AS care_timezone,
      cr.health_conditions AS cr_health_conditions,
      cr.caregiver_briefing AS cr_caregiver_briefing,
      cr.age AS recipient_age,
      fu.first_name || ' ' || fu.last_name AS family_name
    FROM care_sessions cs
    LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
    LEFT JOIN users fu ON cs.family_user_id = fu.id
    WHERE (
        (cs.status IN ('open', 'requested', 'pending') AND (cs.caregiver_id IS NULL OR cs.caregiver_id = ?))
        OR (cs.status = 'pending' AND cs.offered_to_caregiver_id = ?)
      )
      AND cs.scheduled_date >= ?
      AND cs.scheduled_date <= ?
      AND COALESCE(fu.is_demo, 0) = ?
      /* Exclude today's sessions whose start time has already passed */
      AND NOT (cs.scheduled_date = ? AND cs.scheduled_time <= ?)
      /* Exclude sessions requested by this same user (dual-role: can't accept your own request) */
      AND cs.family_user_id != ?
      /* Exclude sessions that have a pending or expired time proposal from this caregiver */
      AND NOT EXISTS (
        SELECT 1 FROM time_proposals tp
        WHERE tp.session_id = cs.id
          AND tp.caregiver_user_id = ?
          AND tp.status IN ('pending', 'expired')
      )
    ORDER BY cs.scheduled_date ASC, cs.scheduled_time ASC
    LIMIT 30
  `).all(profile.id, profile.id, today, fiveDayStr, isDemo, today, nowTimeStr, userId, userId);

  // Recent reviews
  const reviews = await db.prepare(`
    SELECT r.*, u.first_name || ' ' || u.last_name AS reviewer_name
    FROM reviews r JOIN users u ON r.family_user_id = u.id
    WHERE r.caregiver_id = ?
    ORDER BY r.created_at DESC LIMIT 5
  `).all(profile.id);

  // Recently completed sessions (last 7 days) for the dashboard
  const sevenDaysAgoCg = new Date(cgEtNow); sevenDaysAgoCg.setDate(sevenDaysAgoCg.getDate() - 7);
  const sevenDaysAgoCgStr = sevenDaysAgoCg.getFullYear() + '-' + String(sevenDaysAgoCg.getMonth() + 1).padStart(2, '0') + '-' + String(sevenDaysAgoCg.getDate()).padStart(2, '0');
  const recentCompletedCg = await db.prepare(`
    SELECT * FROM (
      SELECT DISTINCT ON (cs.id) cs.*,
        cr.first_name || ' ' || cr.last_name AS recipient_name,
        cr.location_city,
        cr.timezone AS care_timezone,
        vl.summary AS visit_summary,
        vl.care_feedback,
        vl.departure_mood,
        cp.hourly_rate AS cg_hourly_rate, cp.rate_daytime AS cg_rate_daytime,
        cp.rate_nighttime AS cg_rate_nighttime, cp.rate_overnight AS cg_rate_overnight
      FROM care_sessions cs
      LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
      LEFT JOIN visit_logs vl ON vl.session_id = cs.id
      LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
      WHERE cs.caregiver_id = ?
        AND cs.status = 'completed'
        AND cs.scheduled_date >= ?
      ORDER BY cs.id
    ) sub
    ORDER BY sub.scheduled_date DESC, sub.scheduled_time DESC
    LIMIT 5
  `).all(profile.id, sevenDaysAgoCgStr);

  // Caregiver's own sent proposals — so they can track what they proposed
  let myProposals = [];
  try {
    myProposals = await db.prepare(`
      SELECT tp.*,
        cs.scheduled_date AS original_date,
        cs.scheduled_time AS original_time,
        cs.service_type,
        cs.duration_hours,
        cr.first_name || ' ' || cr.last_name AS recipient_name,
        fu.first_name || ' ' || fu.last_name AS family_name
      FROM time_proposals tp
      JOIN care_sessions cs ON tp.session_id = cs.id
      LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
      LEFT JOIN users fu ON cs.family_user_id = fu.id
      WHERE tp.caregiver_user_id = ?
        AND tp.created_at > NOW() - INTERVAL '30 days'
      ORDER BY tp.created_at DESC
      LIMIT 20
    `).all(userId);
  } catch (e) {
    console.log('My proposals query skipped:', e.message);
  }

  // Fetch recent no-show cancelled sessions for this caregiver (alert banner)
  let noShowAlerts = [];
  try {
    noShowAlerts = await db.prepare(`
      SELECT cs.id, cs.scheduled_date, cs.scheduled_time, cs.caregiver_no_show_at,
        cs.review_required, cs.review_completed,
        cr.first_name || ' ' || cr.last_name AS recipient_name
      FROM care_sessions cs
      LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
      WHERE cs.caregiver_id = ?
        AND cs.caregiver_no_show = 1
        AND cs.cancelled_by = 'system'
        AND cs.scheduled_date::date >= CURRENT_DATE - INTERVAL '30 days'
      ORDER BY cs.caregiver_no_show_at DESC
      LIMIT 5
    `).all(profile.id);
  } catch (e) {
    console.log('No-show alerts query skipped:', e.message);
  }

  const feePercentCg = await getPlatformFeePercent(db);

  res.json({
    role: "caregiver",
    platformFeePercent: feePercentCg,
    profile: {
      id: profile.id,
      name: `${user.first_name} ${user.last_name}`,
      bio: profile.bio,
      rating: profile.rating_avg,
      reviewCount: profile.rating_count,
      hourlyRate: profile.hourly_rate,
      rateDaytime: profile.rate_daytime || profile.hourly_rate,
      rateNighttime: profile.rate_nighttime || profile.hourly_rate,
      rateOvernight: profile.rate_overnight || profile.hourly_rate,
      specialties: JSON.parse(profile.specialties || "[]"),
      certifications: JSON.parse(profile.certifications || "[]"),
      isAvailable: !!profile.is_available,
      accountPaused: !!profile.account_paused,
      accountPausedReason: profile.account_paused_reason || null,
      accountPausedAt: profile.account_paused_at || null,
      city: profile.location_city,
      state: profile.location_state,
      zip: profile.zip,
      workLocationAddress: profile.work_location_address,
      onboardingComplete: !!profile.onboarding_complete,
      earlyCheckInAllowed: !!profile.early_check_in_allowed,
      background_check_paid: !!profile.background_check_paid,
      isBackgroundChecked: !!profile.is_background_checked,
      checkrStatus: profile.is_background_checked ? 'clear' : (profile.checkr_status || 'pending'),
      stripeConnected: !!profile.stripe_onboard_complete,
      stripeOnboardComplete: !!profile.stripe_onboard_complete,
      // Stripe not yet live — cleared if BG check passed OR admin set is_available override
      caregiverCleared: !!profile.is_background_checked || !!profile.is_available,
      bgCheckRejectionReason: profile.bg_check_rejection_reason || null,
      legalFirstName: profile.legal_first_name,
      legalMiddleName: profile.legal_middle_name || '',
      legalLastName: profile.legal_last_name,
      dateOfBirth: profile.date_of_birth,
      ssnLast4: profile.ssn_last4,
      dlNumber: profile.dl_number,
      dlState: profile.dl_state,
      care_stoplight: profile.care_stoplight,
      avatar_url: user.avatar_url || null,
      academicProgram: profile.academic_program || null,
      academicProgramYear: profile.academic_program_year || null,
      needsHourReports: !!profile.needs_hour_reports,
    },
    assignments: assignments.map(a => ({
      ...a,
      health_conditions: a.health_conditions ? JSON.parse(a.health_conditions) : [],
    })),
    upcomingSessions: upcoming.map(s => {
      // If family offered a specific rate (proposed_rate), use it — the offer is the offer.
      // Only fall back to caregiver profile rates when no offer was made.
      let caregiverPayout;
      if (s.proposed_rate && parseFloat(s.proposed_rate) > 0) {
        // Family's offered rate × duration = what the caregiver earns
        caregiverPayout = Math.round(parseFloat(s.proposed_rate) * parseFloat(s.duration_hours || 2) * 100) / 100;
      } else {
        const rates = {
          daytime: s.cg_rate_daytime || s.cg_hourly_rate || 28,
          nighttime: s.cg_rate_nighttime || s.cg_hourly_rate || 28,
          overnight: s.cg_rate_overnight || s.cg_hourly_rate || 28,
          base: s.cg_hourly_rate || 28,
        };
        const storedSurcharge = parseFloat(s.short_notice_surcharge) || 0;
        const shortNotice = storedSurcharge > 0;
        const costResult = calculateSessionCost(s.scheduled_time, null, rates, {
          scheduledDate: s.scheduled_date,
          durationHours: parseFloat(s.duration_hours || 2),
          shortNotice,
        });
        const surchargeToCaregiver = Math.round((costResult.surcharge || 0) * 0.75 * 100) / 100;
        caregiverPayout = Math.round((costResult.subtotal + surchargeToCaregiver) * 100) / 100;
      }
      return {
        id: s.id,
        date: s.scheduled_date,
        time: s.scheduled_time,
        serviceType: s.service_type,
        status: s.status,
        durationHours: s.duration_hours,
        recipientName: s.recipient_name,
        location: s.location_address ? `${s.location_address}, ${s.location_city}` : s.location_city,
        hasAddress: !!(s.location_address || s.location_city),
        familyUserId: s.family_user_id,
        careRecipientId: s.care_recipient_id,
        specialInstructions: s.special_instructions,
        recipientPreferences: s.recipient_preferences,
        estimatedCost: s.estimated_cost,
        caregiverPayout: caregiverPayout,
        timezone: s.care_timezone || "America/New_York",
        offeredToCaregiverId: s.offered_to_caregiver_id || null,
        exclusiveUntil: s.exclusive_until || null,
        familyName: s.family_name || null,
        healthTags: (() => { try { return JSON.parse(s.cr_health_conditions || '[]').slice(0, 3); } catch { return []; } })(),
        careSummary: s.cr_caregiver_briefing ? s.cr_caregiver_briefing.substring(0, 200) : null,
        recipientCity: s.location_city || null,
        recipientLat: s.recipient_lat || null,
        recipientLng: s.recipient_lng || null,
        interviewRequired: !!s.interview_required,
        interviewType: s.interview_type || null,
        interviewStatus: s.interview_status || null,
        checkInTime: s.check_in_time || null,
        pendingTimeChangeId: s.pending_time_change_id || null,
        tcProposedTime: s.tc_proposed_time || null,
        tcProposedDuration: s.tc_proposed_duration || null,
        tcProposedBy: s.tc_proposed_by || null,
      };
    }),
    reviews: reviews.map(r => ({
      id: r.id,
      rating: r.rating,
      comment: r.comment,
      reviewerName: r.reviewer_name,
      createdAt: r.created_at,
    })),
    openJobs: await (async () => {
      // Caregiver must have passed BG check AND completed Stripe to see sensitive job details
      const bgCleared = !!profile.is_background_checked && !!profile.stripe_onboard_complete;
      const results = [];

      for (const s of openJobs) {
        // Conflict detection: check against caregiver's upcoming sessions
        const conflict = computeJobConflicts(s, upcoming);
        // Distance from caregiver's location
        const cgLat = profile.latitude || profile.work_latitude;
        const cgLng = profile.longitude || profile.work_longitude;
        const dist = (cgLat && cgLng && s.recipient_lat && s.recipient_lng)
          ? Math.round(haversineDistance(cgLat, cgLng, s.recipient_lat, s.recipient_lng) * 10) / 10
          : null;
        // Legacy match score (kept for backward compatibility)
        const match = computeMatchScore(s, profile, conflict.hasConflict, dist);

        // Compute AI-powered match score (without insights for list view)
        let aiScore = match.score; // fallback to legacy score
        try {
          const recipient = await db.prepare(`
            SELECT * FROM care_recipients WHERE id = ?
          `).get(s.care_recipient_id);

          if (recipient) {
            const aiMatchData = await scoreMatch(s, s, recipient, {}, null); // null = no DB/insights
            aiScore = aiMatchData.score;
          }
        } catch (err) {
          console.error(`AI matching error for session ${s.id}:`, err.message);
          // Fall back to legacy score on error
        }

        // If background check not cleared, strip sensitive care recipient info
        results.push({
          id: s.id,
          date: s.scheduled_date,
          time: s.scheduled_time,
          serviceType: s.service_type,
          status: s.status,
          durationHours: s.duration_hours,
          recipientName: bgCleared ? s.recipient_name : null,
          recipientCity: bgCleared ? s.recipient_city : (s.recipient_city ? s.recipient_city.split(',')[0] : null),
          familyName: bgCleared ? s.family_name : null,
          specialInstructions: bgCleared ? s.special_instructions : null,
          estimatedCost: s.estimated_cost,
          caregiverPayout: s.estimated_cost,
          proposedRate: s.proposed_rate,
          shortNoticeSurcharge: s.short_notice_surcharge,
          timezone: s.care_timezone || "America/New_York",
          hasConflict: conflict.hasConflict,
          conflictWith: conflict.conflictWith,
          conflictEndTime: conflict.conflictEndTime || null,
          distanceMiles: dist,
          matchScore: aiScore,
          matchQuality: aiScore >= 75 ? 'great' : aiScore >= 50 ? 'good' : null,
          offeredToCaregiverId: s.offered_to_caregiver_id || null,
          exclusiveUntil: s.exclusive_until || null,
          recipientAge: bgCleared ? (s.recipient_age || null) : null,
          careSummary: bgCleared ? (s.cr_caregiver_briefing ? s.cr_caregiver_briefing.substring(0, 200) : null) : null,
          healthTags: bgCleared ? (() => { try { return JSON.parse(s.cr_health_conditions || '[]').slice(0, 3); } catch { return []; } })() : [],
          recipientLat: bgCleared ? (s.recipient_lat || null) : null,
          recipientLng: bgCleared ? (s.recipient_lng || null) : null,
          interviewRequired: !!s.interview_required,
          interviewType: s.interview_type || null,
          interviewStatus: s.interview_status || null,
          careRecipientId: s.care_recipient_id,
        });
      }

      return results;
    })(),
    recentlyCompleted: recentCompletedCg.map(s => {
      // If family offered a specific rate (proposed_rate), use it — the offer is the offer.
      let caregiverPayout;
      if (s.proposed_rate && parseFloat(s.proposed_rate) > 0) {
        caregiverPayout = Math.round(parseFloat(s.proposed_rate) * parseFloat(s.duration_hours || 2) * 100) / 100;
      } else {
        const rates = {
          daytime: s.cg_rate_daytime || s.cg_hourly_rate || 28,
          nighttime: s.cg_rate_nighttime || s.cg_hourly_rate || 28,
          overnight: s.cg_rate_overnight || s.cg_hourly_rate || 28,
          base: s.cg_hourly_rate || 28,
        };
        const storedSurcharge = parseFloat(s.short_notice_surcharge) || 0;
        const shortNotice = storedSurcharge > 0;
        const costResult = calculateSessionCost(s.scheduled_time, null, rates, {
          scheduledDate: s.scheduled_date,
          durationHours: parseFloat(s.duration_hours || 2),
          shortNotice,
        });
        const surchargeToCaregiver = Math.round((costResult.surcharge || 0) * 0.75 * 100) / 100;
        caregiverPayout = Math.round((costResult.subtotal + surchargeToCaregiver) * 100) / 100;
      }
      return {
        id: s.id,
        date: s.scheduled_date,
        time: s.scheduled_time,
        serviceType: s.service_type,
        durationHours: s.duration_hours,
        recipientName: s.recipient_name,
        locationCity: s.location_city,
        visitSummary: s.care_feedback || s.visit_summary,
        departureMood: s.departure_mood,
        estimatedCost: s.estimated_cost,
        caregiverPayout: caregiverPayout,
        timezone: s.care_timezone || "America/New_York",
      };
    }),
    stats: {
      completedThisMonth: monthlyStats.completed_sessions || 0,
      // 75/25 split: caregiver earns total minus 25% of surcharges
      monthlyEarnings: Math.round(((monthlyStats.total_earnings || 0) - (monthlyStats.total_surcharges || 0) * 0.25) * 100) / 100,
      hoursThisMonth: Math.round((monthlyStats.total_hours || 0) * 10) / 10,
      pendingEarnings: Math.round(((pending.pending_earnings || 0) - (pending.pending_surcharges || 0) * 0.25) * 100) / 100,
      assignedFamilies: assignments.length,
    },
    myProposals: myProposals.map(p => ({
      id: p.id,
      sessionId: p.session_id,
      proposedDate: p.proposed_date,
      proposedTime: p.proposed_time,
      originalDate: p.original_date,
      originalTime: p.original_time,
      message: p.message,
      status: p.status,
      recipientName: p.recipient_name,
      familyName: p.family_name,
      serviceType: p.service_type,
      durationHours: p.duration_hours,
      createdAt: p.created_at,
      respondedAt: p.responded_at,
      expiresAt: p.expires_at,
    })),
    noShowAlerts: noShowAlerts.map(s => ({
      id: s.id,
      scheduledDate: s.scheduled_date,
      scheduledTime: s.scheduled_time,
      noShowAt: s.caregiver_no_show_at,
      recipientName: s.recipient_name,
      reviewRequired: !!s.review_required,
      reviewCompleted: !!s.review_completed,
    })),
  });
}

// (interview data is fetched client-side via /api/interviews/* endpoints)

// ─── Cared-For Dashboard (Betty's view) ───
async function careForDashboard(db, userId, res) {
  const user = await db.prepare("SELECT first_name, last_name FROM users WHERE id = ?").get(userId);

  // Find care recipient linked to this user account
  const recipient = await db.prepare(`
    SELECT cr.* FROM care_recipients cr
    WHERE cr.linked_user_id = ?
    LIMIT 1
  `).get(userId);

  if (!recipient) {
    return res.json({ role: "care_for", userName: `${user.first_name} ${user.last_name}`, sessions: [], notes: [] });
  }

  // Resolve managed-by user name if present
  let managedByName = null;
  if (recipient.managed_by_user_id) {
    const mgr = await db.prepare("SELECT first_name, last_name FROM users WHERE id = ?").get(recipient.managed_by_user_id);
    if (mgr) managedByName = `${mgr.first_name} ${mgr.last_name}`;
  }

  // All future sessions (calendar data) — use care-location timezone
  const today = getTodayStringInZone();
  const sessions = await db.prepare(`
    SELECT cs.*,
      u.first_name || ' ' || u.last_name AS caregiver_name
    FROM care_sessions cs
    LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
    LEFT JOIN users u ON cp.user_id = u.id
    WHERE cs.care_recipient_id = ? AND cs.scheduled_date >= ?
      AND cs.status IN ('pending', 'confirmed')
    ORDER BY cs.scheduled_date ASC, cs.scheduled_time ASC
  `).all(recipient.id, today);

  // Notes
  const notes = await db.prepare(`
    SELECT rn.*, u.first_name AS author_first_name, u.last_name AS author_last_name, u.role AS author_role
    FROM recipient_notes rn
    JOIN users u ON rn.author_id = u.id
    WHERE rn.care_recipient_id = ?
    ORDER BY rn.created_at DESC
  `).all(recipient.id);

  // Parse JSON fields safely
  const parseJson = (str) => { try { return JSON.parse(str); } catch { return []; } };

  res.json({
    role: "care_for",
    userName: `${user.first_name} ${user.last_name}`,
    careRecipientId: recipient.id,
    permissionTier: recipient.permission_tier || "full",
    managedByName: managedByName,
    managedReason: recipient.managed_reason || null,
    visibilitySettings: parseJson(recipient.visibility_settings) || null,
    careProfile: {
      healthConditions: parseJson(recipient.health_conditions),
      medications: parseJson(recipient.medications),
      preferences: recipient.preferences,
      emergencyContactName: recipient.emergency_contact_name,
      emergencyContactPhone: recipient.emergency_contact_phone,
      pets: recipient.pets,
      foodAllergies: parseJson(recipient.food_allergies),
      medicalConditions: recipient.medical_conditions,
      photo: recipient.photo,
      emoji: recipient.emoji,
    },
    timezone: recipient.timezone || "America/New_York",
    sessions: sessions.map(s => ({
      id: s.id,
      date: s.scheduled_date,
      time: s.scheduled_time,
      serviceType: s.service_type,
      status: s.status,
      durationHours: s.duration_hours,
      caregiverName: s.caregiver_name,
      specialInstructions: s.special_instructions,
    })),
    notes: notes.map(n => ({
      id: n.id,
      content: n.content,
      noteType: n.note_type,
      authorName: `${n.author_first_name} ${n.author_last_name}`,
      authorRole: n.author_role,
      createdAt: n.created_at,
      updatedAt: n.updated_at,
    })),
  });
}

module.exports = router;
