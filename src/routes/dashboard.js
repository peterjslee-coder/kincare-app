const express = require("express");
const { getDb } = require("../models/database");
const { authenticate } = require("../middleware/auth");

const router = express.Router();
router.use(authenticate);

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

    const monthStart = new Date();
    monthStart.setDate(1);
    const monthStr = monthStart.toISOString().split("T")[0];

    const monthlyStats = await db.prepare(`
      SELECT
        COUNT(*) as total_sessions,
        SUM(duration_hours) as total_hours,
        SUM(COALESCE(actual_cost, estimated_cost)) as total_spend
      FROM care_sessions
      WHERE family_user_id = ? AND scheduled_date >= ?
    `).get(userId, monthStr);

    const today = new Date().toISOString().split("T")[0];
    const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0];

    const upcoming = await db.prepare(`
      SELECT cs.*,
        cr.first_name || ' ' || cr.last_name AS recipient_name,
        u.first_name || ' ' || u.last_name AS caregiver_name,
        cp.rating_avg AS caregiver_rating
      FROM care_sessions cs
      LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
      LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
      LEFT JOIN users u ON cp.user_id = u.id
      WHERE cs.family_user_id = ?
        AND cs.scheduled_date >= ?
        AND cs.scheduled_date <= ?
        AND cs.status IN ('pending', 'confirmed')
      ORDER BY cs.scheduled_date ASC, cs.scheduled_time ASC
      LIMIT 5
    `).all(userId, today, nextWeek);

    const recentActivity = await db.prepare(`
      SELECT * FROM activity_feed
      WHERE family_user_id = ?
      ORDER BY created_at DESC LIMIT 5
    `).all(userId);

    const unreadCount = await db.prepare(
      "SELECT COUNT(*) as count FROM activity_feed WHERE family_user_id = ? AND is_read = 0"
    ).get(userId);

    const avgRating = await db.prepare(`
      SELECT AVG(cp.rating_avg) as avg
      FROM care_sessions cs
      JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
      WHERE cs.family_user_id = ? AND cs.status = 'completed'
    `).get(userId);

    // Assigned caregiver count
    const assignedCount = await db.prepare(`
      SELECT COUNT(DISTINCT caregiver_profile_id) as count
      FROM caregiver_assignments
      WHERE family_user_id = ? AND is_active = 1
    `).get(userId);

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
      upcomingSessions: upcoming.map((s) => ({
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
      })),
      recentActivity: recentActivity.map((a) => ({
        id: a.id,
        eventType: a.event_type,
        title: a.title,
        message: a.message,
        isRead: a.is_read,
        timestamp: a.created_at,
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

  // Upcoming sessions
  const today = new Date().toISOString().split("T")[0];
  const upcoming = await db.prepare(`
    SELECT cs.*,
      cr.first_name || ' ' || cr.last_name AS recipient_name,
      cr.location_address, cr.location_city,
      cr.preferences AS recipient_preferences
    FROM care_sessions cs
    LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
    WHERE cs.caregiver_id = ? AND cs.scheduled_date >= ? AND cs.status IN ('pending', 'confirmed')
    ORDER BY cs.scheduled_date ASC, cs.scheduled_time ASC
    LIMIT 10
  `).all(profile.id, today);

  // Monthly stats
  const monthStart = new Date();
  monthStart.setDate(1);
  const monthStr = monthStart.toISOString().split("T")[0];

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

  // Recent reviews
  const reviews = await db.prepare(`
    SELECT r.*, u.first_name || ' ' || u.last_name AS reviewer_name
    FROM reviews r JOIN users u ON r.family_user_id = u.id
    WHERE r.caregiver_id = ?
    ORDER BY r.created_at DESC LIMIT 5
  `).all(profile.id);

  res.json({
    role: "caregiver",
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
      onboardingComplete: !!profile.onboarding_complete,
      checkrStatus: profile.checkr_status || 'pending',
      legalFirstName: profile.legal_first_name,
      legalLastName: profile.legal_last_name,
      dateOfBirth: profile.date_of_birth,
      ssnLast4: profile.ssn_last4,
      dlNumber: profile.dl_number,
      dlState: profile.dl_state,
      care_stoplight: profile.care_stoplight,
      avatar_url: user.avatar_url || null,
    },
    assignments: assignments.map(a => ({
      ...a,
      health_conditions: a.health_conditions ? JSON.parse(a.health_conditions) : [],
    })),
    upcomingSessions: upcoming.map(s => ({
      id: s.id,
      date: s.scheduled_date,
      time: s.scheduled_time,
      serviceType: s.service_type,
      status: s.status,
      durationHours: s.duration_hours,
      recipientName: s.recipient_name,
      location: s.location_address ? `${s.location_address}, ${s.location_city}` : s.location_city,
      specialInstructions: s.special_instructions,
      recipientPreferences: s.recipient_preferences,
      estimatedCost: s.estimated_cost,
    })),
    reviews: reviews.map(r => ({
      id: r.id,
      rating: r.rating,
      comment: r.comment,
      reviewerName: r.reviewer_name,
      createdAt: r.created_at,
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

  // Find care recipient matching this user's name
  const recipient = await db.prepare(`
    SELECT cr.* FROM care_recipients cr
    WHERE cr.first_name = ? AND cr.last_name = ?
    LIMIT 1
  `).get(user.first_name, user.last_name);

  if (!recipient) {
    return res.json({ role: "care_for", userName: `${user.first_name} ${user.last_name}`, sessions: [], notes: [] });
  }

  // All future sessions (calendar data)
  const today = new Date().toISOString().split("T")[0];
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

  res.json({
    role: "care_for",
    userName: `${user.first_name} ${user.last_name}`,
    careRecipientId: recipient.id,
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
