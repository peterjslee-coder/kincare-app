const express = require("express");
const { getDb } = require("../models/database");
const { authenticate } = require("../middleware/auth");
const { getNowInZone, getTodayStringInZone } = require("../utils/timezone");

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
    const feePercent = await getPlatformFeePercent(db);

    // Get owned + shared recipients
    const ownedRecipients = await db.prepare(
      "SELECT * FROM care_recipients WHERE family_user_id = ?"
    ).all(userId);
    const sharedRecipients = await db.prepare(`
      SELECT cr.* FROM care_recipient_shares crs
      JOIN care_recipients cr ON crs.care_recipient_id = cr.id
      WHERE crs.shared_with_user_id = ?
    `).all(userId);
    const ownedIds = new Set(ownedRecipients.map(r => r.id));
    const recipients = [...ownedRecipients, ...sharedRecipients.filter(r => !ownedIds.has(r.id))];

    const famEtNow = getNowInZone();
    const monthStart = new Date(famEtNow); monthStart.setDate(1);
    const monthStr = monthStart.getFullYear() + '-' + String(monthStart.getMonth() + 1).padStart(2, '0') + '-01';

    // All recipient IDs this user can see (owned + shared)
    const allRecipientIds = recipients.map(r => r.id);
    const recipientPlaceholders = allRecipientIds.length > 0 ? allRecipientIds.map(() => '?').join(',') : "'__none__'";

    const monthlyStats = await db.prepare(`
      SELECT
        COUNT(*) as total_sessions,
        SUM(duration_hours) as total_hours,
        SUM(COALESCE(actual_cost, estimated_cost)) as total_spend
      FROM care_sessions cs
      WHERE (cs.family_user_id = ? OR cs.care_recipient_id IN (${recipientPlaceholders}))
        AND cs.scheduled_date >= ?
        AND cs.status IN ('confirmed', 'completed', 'in_progress')
    `).get(userId, ...allRecipientIds, monthStr);

    // Use care-location timezone for "today" — all times are care-location times
    const today = getTodayStringInZone();
    const etNow = getNowInZone();
    const next30Date = new Date(etNow); next30Date.setDate(next30Date.getDate() + 30);
    const next30 = next30Date.getFullYear() + '-' + String(next30Date.getMonth() + 1).padStart(2, '0') + '-' + String(next30Date.getDate()).padStart(2, '0');

    const upcoming = await db.prepare(`
      SELECT cs.*,
        cr.first_name || ' ' || cr.last_name AS recipient_name,
        cr.timezone AS care_timezone,
        u.first_name || ' ' || u.last_name AS caregiver_name,
        cp.rating_avg AS caregiver_rating,
        fu.first_name || ' ' || fu.last_name AS booked_by_name,
        vl.check_in_time
      FROM care_sessions cs
      LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
      LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
      LEFT JOIN users u ON cp.user_id = u.id
      LEFT JOIN users fu ON cs.family_user_id = fu.id
      LEFT JOIN visit_logs vl ON vl.session_id = cs.id
      WHERE (cs.family_user_id = ? OR cs.care_recipient_id IN (${recipientPlaceholders}))
        AND cs.scheduled_date >= ?
        AND cs.scheduled_date <= ?
        AND cs.status IN ('pending', 'confirmed', 'open', 'requested', 'in_progress')
      ORDER BY cs.scheduled_date ASC, cs.scheduled_time ASC
      LIMIT 15
    `).all(userId, ...allRecipientIds, today, next30);

    // Recently completed sessions (last 7 days)
    const sevenDaysAgo = new Date(etNow); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const sevenDaysAgoStr = sevenDaysAgo.getFullYear() + '-' + String(sevenDaysAgo.getMonth() + 1).padStart(2, '0') + '-' + String(sevenDaysAgo.getDate()).padStart(2, '0');
    const recentCompleted = await db.prepare(`
      SELECT cs.*,
        cr.first_name || ' ' || cr.last_name AS recipient_name,
        u.first_name || ' ' || u.last_name AS caregiver_name,
        vl.summary AS visit_summary,
        vl.departure_mood,
        vl.condition_tags
      FROM care_sessions cs
      LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
      LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
      LEFT JOIN users u ON cp.user_id = u.id
      LEFT JOIN visit_logs vl ON vl.session_id = cs.id
      WHERE (cs.family_user_id = ? OR cs.care_recipient_id IN (${recipientPlaceholders}))
        AND cs.status = 'completed'
        AND cs.scheduled_date >= ?
      ORDER BY cs.scheduled_date DESC, cs.scheduled_time DESC
      LIMIT 5
    `).all(userId, ...allRecipientIds, sevenDaysAgoStr);

    const recentActivity = await db.prepare(`
      SELECT * FROM activity_feed
      WHERE family_user_id = ? OR care_recipient_id IN (${recipientPlaceholders})
      ORDER BY created_at DESC LIMIT 5
    `).all(userId, ...allRecipientIds);

    const unreadCount = await db.prepare(
      `SELECT COUNT(*) as count FROM activity_feed WHERE (family_user_id = ? OR care_recipient_id IN (${recipientPlaceholders})) AND is_read = 0`
    ).get(userId, ...allRecipientIds);

    const avgRating = await db.prepare(`
      SELECT AVG(cp.rating_avg) as avg
      FROM care_sessions cs
      JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
      WHERE (cs.family_user_id = ? OR cs.care_recipient_id IN (${recipientPlaceholders})) AND cs.status = 'completed'
    `).get(userId, ...allRecipientIds);

    // Assigned caregiver count — include caregivers assigned by any family member for shared recipients
    const assignedCount = await db.prepare(`
      SELECT COUNT(DISTINCT ca.caregiver_profile_id) as count
      FROM caregiver_assignments ca
      LEFT JOIN care_recipients cr ON ca.care_recipient_id = cr.id
      WHERE (ca.family_user_id = ? OR ca.care_recipient_id IN (${recipientPlaceholders})) AND ca.is_active = 1
    `).get(userId, ...allRecipientIds);

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
          visitSummary: s.visit_summary,
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
      cr.timezone AS care_timezone
    FROM care_sessions cs
    LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
    WHERE cs.caregiver_id = ? AND cs.scheduled_date >= ? AND cs.status IN ('pending', 'confirmed', 'in_progress')
    ORDER BY cs.scheduled_date ASC, cs.scheduled_time ASC
    LIMIT 10
  `).all(profile.id, today);

  // Monthly stats
  const cgMonthStart = new Date(cgEtNow); cgMonthStart.setDate(1);
  const monthStr = cgMonthStart.getFullYear() + '-' + String(cgMonthStart.getMonth() + 1).padStart(2, '0') + '-01';

  const monthlyStats = await db.prepare(`
    SELECT COUNT(*) as completed_sessions,
      SUM(COALESCE(actual_cost, estimated_cost)) as total_earnings,
      SUM(duration_hours) as total_hours
    FROM care_sessions
    WHERE caregiver_id = ? AND scheduled_date >= ? AND status = 'completed'
  `).get(profile.id, monthStr);

  const pending = await db.prepare(`
    SELECT SUM(estimated_cost) as pending_earnings
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

  const openJobs = await db.prepare(`
    SELECT cs.*,
      cr.first_name || ' ' || cr.last_name AS recipient_name,
      cr.location_city AS recipient_city,
      cr.timezone AS care_timezone,
      fu.first_name || ' ' || fu.last_name AS family_name
    FROM care_sessions cs
    LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
    LEFT JOIN users fu ON cs.family_user_id = fu.id
    WHERE cs.status IN ('open', 'requested')
      AND cs.scheduled_date >= ?
      AND cs.scheduled_date <= ?
      AND (cs.caregiver_id IS NULL OR cs.caregiver_id = ?)
      AND COALESCE(fu.is_demo, 0) = ?
    ORDER BY cs.scheduled_date ASC, cs.scheduled_time ASC
    LIMIT 10
  `).all(today, fiveDayStr, profile.id, isDemo);

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
    SELECT cs.*,
      cr.first_name || ' ' || cr.last_name AS recipient_name,
      cr.location_city,
      cr.timezone AS care_timezone,
      vl.summary AS visit_summary,
      vl.departure_mood
    FROM care_sessions cs
    LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
    LEFT JOIN visit_logs vl ON vl.session_id = cs.id
    WHERE cs.caregiver_id = ?
      AND cs.status = 'completed'
      AND cs.scheduled_date >= ?
    ORDER BY cs.scheduled_date DESC, cs.scheduled_time DESC
    LIMIT 5
  `).all(profile.id, sevenDaysAgoCgStr);

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
      city: profile.location_city,
      state: profile.location_state,
      zip: profile.zip,
      workLocationAddress: profile.work_location_address,
      onboardingComplete: !!profile.onboarding_complete,
      earlyCheckInAllowed: !!profile.early_check_in_allowed,
      background_check_paid: !!profile.background_check_paid,
      isBackgroundChecked: !!profile.is_background_checked,
      checkrStatus: profile.is_background_checked ? 'clear' : (profile.checkr_status || 'pending'),
      legalFirstName: profile.legal_first_name,
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
      // Caregiver gets full estimated_cost (platform fee is added on top for family, not deducted)
      const sessionCost = parseFloat(s.estimated_cost) || 0;
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
        caregiverPayout: sessionCost,
        timezone: s.care_timezone || "America/New_York",
      };
    }),
    reviews: reviews.map(r => ({
      id: r.id,
      rating: r.rating,
      comment: r.comment,
      reviewerName: r.reviewer_name,
      createdAt: r.created_at,
    })),
    openJobs: openJobs.map(s => ({
      id: s.id,
      date: s.scheduled_date,
      time: s.scheduled_time,
      serviceType: s.service_type,
      status: s.status,
      durationHours: s.duration_hours,
      recipientName: s.recipient_name,
      recipientCity: s.recipient_city,
      familyName: s.family_name,
      specialInstructions: s.special_instructions,
      estimatedCost: s.estimated_cost,
      proposedRate: s.proposed_rate,
      shortNoticeSurcharge: s.short_notice_surcharge,
      timezone: s.care_timezone || "America/New_York",
    })),
    recentlyCompleted: recentCompletedCg.map(s => ({
      id: s.id,
      date: s.scheduled_date,
      time: s.scheduled_time,
      serviceType: s.service_type,
      durationHours: s.duration_hours,
      recipientName: s.recipient_name,
      locationCity: s.location_city,
      visitSummary: s.visit_summary,
      departureMood: s.departure_mood,
      estimatedCost: s.estimated_cost,
      caregiverPayout: parseFloat(s.estimated_cost) || 0,
      timezone: s.care_timezone || "America/New_York",
    })),
    stats: {
      completedThisMonth: monthlyStats.completed_sessions || 0,
      monthlyEarnings: Math.round((monthlyStats.total_earnings || 0) * 100) / 100,
      hoursThisMonth: Math.round((monthlyStats.total_hours || 0) * 10) / 10,
      pendingEarnings: Math.round((pending.pending_earnings || 0) * 100) / 100,
      assignedFamilies: assignments.length,
    },
  });
}

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
