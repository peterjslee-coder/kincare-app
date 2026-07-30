const express = require("express");
const { getDb } = require("../models/database");
const { authenticate, requireAdmin } = require("../middleware/auth");

const router = express.Router();

// ─── Admin check middleware (same pattern as admin.js) ───
async function checkAdmin(req, res, next) {
  if (req.isAdmin) return next();
  try {
    const db = await getDb();
    const user = await db.prepare("SELECT is_admin FROM users WHERE id = ?").get(req.user.id);
    req.isAdmin = !!(user && user.is_admin);
    next();
  } catch (err) {
    console.error("Admin check error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}

router.use(authenticate, checkAdmin, requireAdmin);

// ─── Helper: estimate Stripe processing fees ───
function estimateStripeFees(amount) {
  return Math.round((amount * 0.029 + 0.30) * 100) / 100;
}

// ─── Helper: SQL fragment to exclude sessions where the caregiver is a demo user ───
const NO_DEMO_CAREGIVER = `AND NOT EXISTS (SELECT 1 FROM caregiver_profiles _cp JOIN users _cu ON _cp.user_id = _cu.id WHERE _cp.id = cs.caregiver_id AND _cu.is_demo = 1)`;

// ─── GET /api/admin/financials/summary ───
// KPI snapshot + 12-month time series
router.get("/summary", async (req, res) => {
  try {
    const db = await getDb();

    // Current month boundaries
    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
    const lastMonthEnd = thisMonthStart;

    // KPI: current month — use completed sessions as source of truth for revenue
    // (payments table only has rows when Stripe checkout completes, which may not cover all sessions)
    // Exclude demo users to avoid inflated numbers
    const currentMonth = await db.prepare(`
      SELECT COALESCE(SUM(cs.estimated_cost), 0) AS gross_revenue,
             COALESCE(SUM(cs.estimated_cost * 0.2), 0) AS platform_revenue,
             COUNT(*) AS payment_count
      FROM care_sessions cs
      JOIN users u ON cs.family_user_id = u.id
      WHERE cs.status = 'completed' AND cs.estimated_cost > 0
        AND COALESCE(u.is_demo, 0) = 0 ${NO_DEMO_CAREGIVER}
        AND COALESCE(cs.completed_at, cs.updated_at, cs.created_at) >= ?
    `).get(thisMonthStart);

    // KPI: previous month
    const prevMonth = await db.prepare(`
      SELECT COALESCE(SUM(cs.estimated_cost), 0) AS gross_revenue,
             COALESCE(SUM(cs.estimated_cost * 0.2), 0) AS platform_revenue,
             COUNT(*) AS payment_count
      FROM care_sessions cs
      JOIN users u ON cs.family_user_id = u.id
      WHERE cs.status = 'completed' AND cs.estimated_cost > 0
        AND COALESCE(u.is_demo, 0) = 0 ${NO_DEMO_CAREGIVER}
        AND COALESCE(cs.completed_at, cs.updated_at, cs.created_at) >= ?
        AND COALESCE(cs.completed_at, cs.updated_at, cs.created_at) < ?
    `).get(lastMonthStart, lastMonthEnd);

    // Current month sessions (completed + confirmed) — exclude demo
    const currentSessions = await db.prepare(`
      SELECT COUNT(*) AS count FROM care_sessions cs
      JOIN users u ON cs.family_user_id = u.id
      WHERE cs.status IN ('completed', 'confirmed') AND cs.created_at >= ?
        AND COALESCE(u.is_demo, 0) = 0 ${NO_DEMO_CAREGIVER}
    `).get(thisMonthStart);

    const prevSessions = await db.prepare(`
      SELECT COUNT(*) AS count FROM care_sessions cs
      JOIN users u ON cs.family_user_id = u.id
      WHERE cs.status IN ('completed', 'confirmed') AND cs.created_at >= ? AND cs.created_at < ?
        AND COALESCE(u.is_demo, 0) = 0 ${NO_DEMO_CAREGIVER}
    `).get(lastMonthStart, lastMonthEnd);

    // Background check revenue
    const bgCheckCurrent = await db.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS total FROM background_check_payments
      WHERE status = 'completed' AND completed_at >= ?
    `).get(thisMonthStart);

    const bgCheckPrev = await db.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS total FROM background_check_payments
      WHERE status = 'completed' AND completed_at >= ? AND completed_at < ?
    `).get(lastMonthStart, lastMonthEnd);

    // Compute net revenue (platform fee - estimated Stripe fees)
    const currentStripeFees = currentMonth.payment_count > 0
      ? currentMonth.payment_count * 0.30 + currentMonth.gross_revenue * 0.029 : 0;
    const prevStripeFees = prevMonth.payment_count > 0
      ? prevMonth.payment_count * 0.30 + prevMonth.gross_revenue * 0.029 : 0;

    const currentNetRevenue = currentMonth.platform_revenue - currentStripeFees;
    const prevNetRevenue = prevMonth.platform_revenue - prevStripeFees;

    const currentAvgSession = currentMonth.payment_count > 0
      ? Math.round(currentMonth.gross_revenue / currentMonth.payment_count * 100) / 100 : 0;
    const prevAvgSession = prevMonth.payment_count > 0
      ? Math.round(prevMonth.gross_revenue / prevMonth.payment_count * 100) / 100 : 0;

    // 12-month time series — from completed sessions, exclude demo
    const monthlyData = await db.prepare(`
      SELECT TO_CHAR(DATE_TRUNC('month', COALESCE(cs.completed_at, cs.updated_at, cs.created_at)), 'YYYY-MM') AS month,
             COALESCE(SUM(cs.estimated_cost), 0) AS gross_revenue,
             COALESCE(SUM(cs.estimated_cost * 0.2), 0) AS platform_fee,
             COALESCE(SUM(cs.estimated_cost * 0.8), 0) AS caregiver_payout,
             COUNT(*) AS payment_count
      FROM care_sessions cs
      JOIN users u ON cs.family_user_id = u.id
      WHERE cs.status = 'completed' AND cs.estimated_cost > 0
        AND COALESCE(u.is_demo, 0) = 0 ${NO_DEMO_CAREGIVER}
        AND COALESCE(cs.completed_at, cs.updated_at, cs.created_at) >= DATE_TRUNC('month', NOW()) - INTERVAL '11 months'
      GROUP BY DATE_TRUNC('month', COALESCE(cs.completed_at, cs.updated_at, cs.created_at))
      ORDER BY month ASC
    `).all();

    // Fill in missing months
    const months = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const found = monthlyData.find(m => m.month === key);
      const label = d.toLocaleDateString('en-US', { month: 'short' });
      if (found) {
        const stripeFees = found.payment_count * 0.30 + found.gross_revenue * 0.029;
        months.push({
          month: key, label,
          grossRevenue: Math.round(found.gross_revenue * 100) / 100,
          platformFee: Math.round(found.platform_fee * 100) / 100,
          estimatedStripeFees: Math.round(stripeFees * 100) / 100,
          netRevenue: Math.round((found.platform_fee - stripeFees) * 100) / 100,
          caregiverPayout: Math.round(found.caregiver_payout * 100) / 100,
          paymentCount: found.payment_count,
        });
      } else {
        months.push({
          month: key, label,
          grossRevenue: 0, platformFee: 0, estimatedStripeFees: 0,
          netRevenue: 0, caregiverPayout: 0, paymentCount: 0,
        });
      }
    }

    // New users + caregivers per month (for growth tracking)
    const userGrowth = await db.prepare(`
      SELECT TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') AS month,
             COUNT(*) FILTER (WHERE role = 'family') AS new_families,
             COUNT(*) FILTER (WHERE role = 'caregiver') AS new_caregivers,
             COUNT(*) AS total_new
      FROM users WHERE COALESCE(is_demo, 0) = 0
        AND created_at >= DATE_TRUNC('month', NOW()) - INTERVAL '11 months'
      GROUP BY DATE_TRUNC('month', created_at)
      ORDER BY month ASC
    `).all();

    // Merge user growth into monthly
    for (const m of months) {
      const growth = userGrowth.find(g => g.month === m.month);
      m.newFamilies = growth ? parseInt(growth.new_families) : 0;
      m.newCaregivers = growth ? parseInt(growth.new_caregivers) : 0;
      m.newUsers = growth ? parseInt(growth.total_new) : 0;
    }

    // All-time totals — from completed sessions, exclude demo
    const allTime = await db.prepare(`
      SELECT COALESCE(SUM(cs.estimated_cost), 0) AS gross_revenue,
             COALESCE(SUM(cs.estimated_cost * 0.2), 0) AS platform_revenue,
             COUNT(*) AS payment_count
      FROM care_sessions cs
      JOIN users u ON cs.family_user_id = u.id
      WHERE cs.status = 'completed' AND cs.estimated_cost > 0
        AND COALESCE(u.is_demo, 0) = 0 ${NO_DEMO_CAREGIVER}
    `).get();

    res.json({
      kpi: {
        grossRevenue: { current: Math.round(currentMonth.gross_revenue * 100) / 100, previous: Math.round(prevMonth.gross_revenue * 100) / 100 },
        platformRevenue: { current: Math.round(currentMonth.platform_revenue * 100) / 100, previous: Math.round(prevMonth.platform_revenue * 100) / 100 },
        netRevenue: { current: Math.round(currentNetRevenue * 100) / 100, previous: Math.round(prevNetRevenue * 100) / 100 },
        totalSessions: { current: currentSessions.count, previous: prevSessions.count },
        avgSessionValue: { current: currentAvgSession, previous: prevAvgSession },
        bgCheckRevenue: { current: bgCheckCurrent.total, previous: bgCheckPrev.total },
      },
      monthly: months,
      allTime: {
        grossRevenue: Math.round(allTime.gross_revenue * 100) / 100,
        platformRevenue: Math.round(allTime.platform_revenue * 100) / 100,
        paymentCount: allTime.payment_count,
      },
    });
  } catch (err) {
    console.error("Financials summary error:", err);
    res.status(500).json({ error: "Failed to fetch financial summary" });
  }
});

// ─── GET /api/admin/financials/daily-snapshot ───
// Daily chart data (last 28 days) + rolling 4-week quick stats vs prior 4 weeks
router.get("/daily-snapshot", async (req, res) => {
  try {
    const db = await getDb();

    // Daily data for last 56 days (current 4 weeks + prior 4 weeks for comparison)
    const dailyData = await db.prepare(`
      SELECT DATE(COALESCE(cs.completed_at, cs.updated_at, cs.created_at)) AS day,
             COALESCE(SUM(cs.estimated_cost), 0) AS gross,
             COALESCE(SUM(cs.estimated_cost * 0.2), 0) AS fees,
             COALESCE(SUM(cs.estimated_cost * 0.8), 0) AS net,
             COUNT(*) AS payment_count
      FROM care_sessions cs
      JOIN users u ON cs.family_user_id = u.id
      WHERE cs.status = 'completed' AND cs.estimated_cost > 0
        AND COALESCE(u.is_demo, 0) = 0 ${NO_DEMO_CAREGIVER}
        AND COALESCE(cs.completed_at, cs.updated_at, cs.created_at) >= CURRENT_DATE - INTERVAL '55 days'
      GROUP BY DATE(COALESCE(cs.completed_at, cs.updated_at, cs.created_at))
      ORDER BY day ASC
    `).all();

    // Sessions per day (last 56 days) — exclude demo
    const dailySessions = await db.prepare(`
      SELECT DATE(cs.scheduled_date) AS day, COUNT(*) AS cnt
      FROM care_sessions cs
      JOIN users u ON cs.family_user_id = u.id
      WHERE cs.status IN ('completed', 'confirmed', 'checked_in', 'scheduled')
        AND cs.scheduled_date::date >= CURRENT_DATE - INTERVAL '55 days'
        AND COALESCE(u.is_demo, 0) = 0 ${NO_DEMO_CAREGIVER}
      GROUP BY DATE(cs.scheduled_date) ORDER BY day ASC
    `).all();

    // Fill in all 56 days (including zeros)
    const allDays = [];
    const now = new Date();
    for (let i = 55; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const key = d.toISOString().split('T')[0];
      const found = dailyData.find(r => r.day && r.day.toISOString ? r.day.toISOString().split('T')[0] === key : String(r.day).split('T')[0] === key);
      const sess = dailySessions.find(r => r.day && r.day.toISOString ? r.day.toISOString().split('T')[0] === key : String(r.day).split('T')[0] === key);
      const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const shortLabel = d.toLocaleDateString('en-US', { weekday: 'short' });
      allDays.push({
        day: key, label, shortLabel,
        gross: found ? Math.round(Number(found.gross) * 100) / 100 : 0,
        fees: found ? Math.round(Number(found.fees) * 100) / 100 : 0,
        net: found ? Math.round(Number(found.net) * 100) / 100 : 0,
        payments: found ? Number(found.payment_count) : 0,
        sessions: sess ? Number(sess.cnt) : 0,
      });
    }

    // Chart: last 28 days only
    const days = allDays.slice(-28);

    // Rolling 4-week stats: current 28 days vs prior 28 days
    const current4w = allDays.slice(-28);
    const prior4w = allDays.slice(0, 28);

    const sum = (arr, key) => arr.reduce((s, d) => s + d[key], 0);
    const pctChange = (curr, prev) => prev > 0 ? Math.round(((curr - prev) / prev) * 100) : (curr > 0 ? 100 : 0);

    const quickStats = {
      sessionsToday: sum(current4w, 'sessions'),
      sessionsDelta: pctChange(sum(current4w, 'sessions'), sum(prior4w, 'sessions')),
      grossToday: Math.round(sum(current4w, 'gross') * 100) / 100,
      grossDelta: pctChange(sum(current4w, 'gross'), sum(prior4w, 'gross')),
      feesToday: Math.round(sum(current4w, 'fees') * 100) / 100,
      feesDelta: pctChange(sum(current4w, 'fees'), sum(prior4w, 'fees')),
      netToday: Math.round(sum(current4w, 'net') * 100) / 100,
      netDelta: pctChange(sum(current4w, 'net'), sum(prior4w, 'net')),
      paymentsToday: sum(current4w, 'payments'),
      paymentsDelta: pctChange(sum(current4w, 'payments'), sum(prior4w, 'payments')),
    };

    res.json({ days, quickStats });
  } catch (err) {
    console.error("Daily snapshot error:", err);
    res.status(500).json({ error: "Failed to fetch daily snapshot" });
  }
});

// ─── GET /api/admin/financials/breakdown ───
// Revenue breakdown by service type, payout speed, top clients/caregivers
router.get("/breakdown", async (req, res) => {
  try {
    const db = await getDb();

    // By service type — from completed sessions, exclude demo
    const byServiceType = await db.prepare(`
      SELECT cs.service_type,
             COUNT(*) AS session_count,
             COALESCE(SUM(cs.estimated_cost), 0) AS revenue,
             COALESCE(SUM(cs.estimated_cost * 0.2), 0) AS platform_fee
      FROM care_sessions cs
      JOIN users u ON cs.family_user_id = u.id
      WHERE cs.status = 'completed' AND cs.estimated_cost > 0
        AND COALESCE(u.is_demo, 0) = 0 ${NO_DEMO_CAREGIVER}
      GROUP BY cs.service_type
      ORDER BY revenue DESC
    `).all();

    // By payout speed — keep from payments table (only relevant for actual Stripe payments)
    const byPayoutSpeed = await db.prepare(`
      SELECT COALESCE(payout_speed, 'standard') AS speed,
             COUNT(*) AS count,
             COALESCE(SUM(amount), 0) AS revenue,
             COALESCE(SUM(platform_fee), 0) AS platform_fee
      FROM payments WHERE status = 'completed'
      GROUP BY COALESCE(payout_speed, 'standard')
    `).all();

    // Top 5 families by spend — from completed sessions, exclude demo
    const topFamilies = await db.prepare(`
      SELECT u.id, u.first_name, u.last_name, u.email,
             COUNT(*) AS session_count,
             COALESCE(SUM(cs.estimated_cost), 0) AS total_spent,
             ROUND(COALESCE(AVG(cs.estimated_cost), 0)::numeric, 2) AS avg_session
      FROM care_sessions cs
      JOIN users u ON cs.family_user_id = u.id
      WHERE cs.status = 'completed' AND cs.estimated_cost > 0
        AND COALESCE(u.is_demo, 0) = 0 ${NO_DEMO_CAREGIVER}
      GROUP BY u.id, u.first_name, u.last_name, u.email
      ORDER BY total_spent DESC
      LIMIT 5
    `).all();

    // Top 5 caregivers by earnings — from completed sessions, exclude demo
    const topCaregivers = await db.prepare(`
      SELECT u.id, u.first_name, u.last_name, u.email,
             cp.rating_avg,
             COUNT(*) AS session_count,
             COALESCE(SUM(cs.estimated_cost * 0.8), 0) AS total_earned,
             ROUND(COALESCE(AVG(cs.estimated_cost * 0.8), 0)::numeric, 2) AS avg_payout
      FROM care_sessions cs
      JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
      JOIN users u ON cp.user_id = u.id
      JOIN users fu ON cs.family_user_id = fu.id
      WHERE cs.status = 'completed' AND cs.estimated_cost > 0
        AND COALESCE(u.is_demo, 0) = 0
        AND COALESCE(fu.is_demo, 0) = 0
      GROUP BY u.id, u.first_name, u.last_name, u.email, cp.rating_avg
      ORDER BY total_earned DESC
      LIMIT 5
    `).all();

    res.json({
      byServiceType: byServiceType.map(r => ({
        serviceType: r.service_type,
        sessionCount: r.session_count,
        revenue: Math.round(r.revenue * 100) / 100,
        platformFee: Math.round(r.platform_fee * 100) / 100,
      })),
      byPayoutSpeed: byPayoutSpeed.map(r => ({
        speed: r.speed,
        count: r.count,
        revenue: Math.round(r.revenue * 100) / 100,
        platformFee: Math.round(r.platform_fee * 100) / 100,
      })),
      topFamilies: topFamilies.map(r => ({
        id: r.id, name: `${r.first_name} ${r.last_name}`, email: r.email,
        sessionCount: r.session_count,
        totalSpent: Math.round(r.total_spent * 100) / 100,
        avgSession: parseFloat(r.avg_session) || 0,
      })),
      topCaregivers: topCaregivers.map(r => ({
        id: r.id, name: `${r.first_name} ${r.last_name}`, email: r.email,
        rating: r.rating_avg || 0,
        sessionCount: r.session_count,
        totalEarned: Math.round(r.total_earned * 100) / 100,
        avgPayout: parseFloat(r.avg_payout) || 0,
      })),
    });
  } catch (err) {
    console.error("Financials breakdown error:", err);
    res.status(500).json({ error: "Failed to fetch financial breakdown" });
  }
});

// ─── GET /api/admin/financials/transactions ───
// Paginated transaction list
router.get("/transactions", async (req, res) => {
  try {
    const db = await getDb();
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 25, 100);
    const offset = (page - 1) * limit;
    const status = req.query.status || null;

    // Build simple query — use the db wrapper for unfiltered or status-filtered
    // For simplicity, fetch all then filter (transaction volumes are low for admin)
    const allTransactions = await db.prepare(`
      SELECT p.*,
        fu.first_name AS family_first_name, fu.last_name AS family_last_name, fu.email AS family_email,
        cu.first_name AS caregiver_first_name, cu.last_name AS caregiver_last_name, cu.email AS caregiver_email,
        cs.service_type, cs.scheduled_date, cs.scheduled_time, cs.duration_hours,
        cs.status AS session_status, cs.completed_at, cs.review_completed, cs.late_check_in,
        cs.special_instructions,
        vl.check_in_time, vl.check_out_time,
        vl.check_in_latitude, vl.check_in_longitude, vl.check_out_lat, vl.check_out_lng,
        cr.first_name AS cr_first_name, cr.last_name AS cr_last_name
      FROM payments p
      LEFT JOIN users fu ON p.family_user_id = fu.id
      LEFT JOIN caregiver_profiles cp ON p.caregiver_id = cp.id
      LEFT JOIN users cu ON cp.user_id = cu.id
      LEFT JOIN care_sessions cs ON p.session_id = cs.id
      LEFT JOIN visit_logs vl ON vl.session_id = cs.id
      LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
      WHERE COALESCE(fu.is_demo, 0) = 0 AND COALESCE(cu.is_demo, 0) = 0
      ORDER BY p.created_at DESC
    `).all();

    // Filter
    let filtered = allTransactions;
    if (status) filtered = filtered.filter(t => t.status === status);
    if (req.query.dateFrom) filtered = filtered.filter(t => t.created_at >= req.query.dateFrom);
    if (req.query.dateTo) filtered = filtered.filter(t => t.created_at <= req.query.dateTo);

    const total = filtered.length;
    const paged = filtered.slice(offset, offset + limit);

    res.json({
      transactions: paged.map(t => ({
        id: t.id,
        sessionId: t.session_id,
        date: t.created_at,
        familyName: `${t.family_first_name || ''} ${t.family_last_name || ''}`.trim(),
        familyEmail: t.family_email,
        caregiverName: `${t.caregiver_first_name || ''} ${t.caregiver_last_name || ''}`.trim(),
        caregiverEmail: t.caregiver_email,
        careRecipient: t.cr_first_name ? `${t.cr_first_name} ${t.cr_last_name || ''}`.trim() : null,
        serviceType: t.service_type || 'N/A',
        scheduledDate: t.scheduled_date,
        scheduledTime: t.scheduled_time,
        durationHours: t.duration_hours,
        sessionStatus: t.session_status,
        completedAt: t.completed_at,
        reviewCompleted: !!t.review_completed,
        lateCheckIn: !!t.late_check_in,
        checkIn: t.check_in_time,
        checkOut: t.check_out_time,
        geo: (t.check_in_latitude || t.check_out_lat) ? {
          inLat: t.check_in_latitude, inLng: t.check_in_longitude,
          outLat: t.check_out_lat, outLng: t.check_out_lng,
        } : null,
        amount: t.amount,
        platformFee: t.platform_fee,
        caregiverPayout: t.caregiver_payout,
        payoutSpeed: t.payout_speed || 'standard',
        status: t.status,
        stripeCheckoutId: t.stripe_checkout_id,
        tipCents: t.tip_cents || 0,
        autoCharged: !!t.auto_charged,
      })),
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error("Financials transactions error:", err);
    res.status(500).json({ error: "Failed to fetch transactions" });
  }
});

// ─── GET /api/admin/financials/insights ───
// Rule-based AI insights engine
router.get("/insights", async (req, res) => {
  try {
    const db = await getDb();
    const insights = [];

    // Gather data for insight computation
    const now = new Date();
    const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
    const sixtyDaysAgo = new Date(now - 60 * 24 * 60 * 60 * 1000).toISOString();
    const ninetyDaysAgo = new Date(now - 90 * 24 * 60 * 60 * 1000).toISOString();

    // Revenue last 30 days vs prior 30 days
    const recentRevenue = await db.prepare(
      "SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count FROM payments WHERE status = 'completed' AND created_at >= ?"
    ).get(thirtyDaysAgo);
    const priorRevenue = await db.prepare(
      "SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count FROM payments WHERE status = 'completed' AND created_at >= ? AND created_at < ?"
    ).get(sixtyDaysAgo, thirtyDaysAgo);

    // 1. Revenue Growth Rate
    if (priorRevenue.total > 0) {
      const growthPct = Math.round(((recentRevenue.total - priorRevenue.total) / priorRevenue.total) * 100);
      if (growthPct > 20) {
        insights.push({
          id: 'revenue_growth', type: 'revenue', severity: 'positive',
          title: 'Strong Revenue Growth',
          description: `Revenue grew ${growthPct}% in the last 30 days compared to the prior period.`,
          metric: `+${growthPct}%`,
          recommendation: 'Capitalize on momentum — consider expanding marketing spend and caregiver recruitment to sustain growth.',
        });
      } else if (growthPct < -10) {
        insights.push({
          id: 'revenue_decline', type: 'revenue', severity: 'warning',
          title: 'Revenue Declining',
          description: `Revenue dropped ${Math.abs(growthPct)}% compared to the prior 30-day period.`,
          metric: `${growthPct}%`,
          recommendation: 'Investigate whether session volume or average session value is driving the decline. Consider re-engagement campaigns for inactive families.',
        });
      } else {
        insights.push({
          id: 'revenue_stable', type: 'revenue', severity: 'neutral',
          title: 'Revenue Stable',
          description: `Revenue changed ${growthPct >= 0 ? '+' : ''}${growthPct}% over the last 30 days.`,
          metric: `${growthPct >= 0 ? '+' : ''}${growthPct}%`,
          recommendation: 'Stable revenue is healthy. Focus on upselling higher-value services or expanding to new markets for the next growth phase.',
        });
      }
    } else if (recentRevenue.total > 0) {
      insights.push({
        id: 'first_revenue', type: 'revenue', severity: 'positive',
        title: 'First Revenue Generated!',
        description: `$${recentRevenue.total.toFixed(2)} in revenue in the last 30 days — congratulations on your first transactions.`,
        metric: `$${recentRevenue.total.toFixed(2)}`,
        recommendation: 'Focus on delivering excellent service to early customers. Happy families will refer others — consider a referral bonus program.',
      });
    } else {
      insights.push({
        id: 'no_revenue', type: 'revenue', severity: 'warning',
        title: 'No Revenue Yet',
        description: 'No completed payments recorded. This is normal for early-stage platforms.',
        metric: '$0',
        recommendation: 'Focus on completing your first paid session. Ensure the payment flow is working end-to-end with Stripe test mode.',
      });
    }

    // 2. Session Volume Trend — exclude demo
    const recentSessions = await db.prepare(
      `SELECT COUNT(*) AS count FROM care_sessions cs JOIN users u ON cs.family_user_id = u.id WHERE cs.created_at >= ? AND COALESCE(u.is_demo, 0) = 0 ${NO_DEMO_CAREGIVER}`
    ).get(thirtyDaysAgo);
    const priorSessions = await db.prepare(
      `SELECT COUNT(*) AS count FROM care_sessions cs JOIN users u ON cs.family_user_id = u.id WHERE cs.created_at >= ? AND cs.created_at < ? AND COALESCE(u.is_demo, 0) = 0 ${NO_DEMO_CAREGIVER}`
    ).get(sixtyDaysAgo, thirtyDaysAgo);

    if (priorSessions.count > 0) {
      const sessionGrowth = Math.round(((recentSessions.count - priorSessions.count) / priorSessions.count) * 100);
      if (sessionGrowth < -20) {
        insights.push({
          id: 'session_decline', type: 'sessions', severity: 'warning',
          title: 'Session Bookings Dropping',
          description: `Session bookings down ${Math.abs(sessionGrowth)}% compared to the prior period.`,
          metric: `${sessionGrowth}%`,
          recommendation: 'Check if families are having trouble booking, or if caregiver availability has decreased. Consider promotional pricing or outreach.',
        });
      } else if (sessionGrowth > 30) {
        insights.push({
          id: 'session_surge', type: 'sessions', severity: 'positive',
          title: 'Session Bookings Surging',
          description: `Bookings up ${sessionGrowth}% — demand is accelerating.`,
          metric: `+${sessionGrowth}%`,
          recommendation: 'Ensure you have enough caregivers to meet demand. Consider onboarding more caregivers in high-demand areas.',
        });
      }
    }

    // 3. Average Session Value
    if (recentRevenue.count > 0 && priorRevenue.count > 0) {
      const recentAvg = recentRevenue.total / recentRevenue.count;
      const priorAvg = priorRevenue.total / priorRevenue.count;
      const avgChange = Math.round(((recentAvg - priorAvg) / priorAvg) * 100);
      if (avgChange < -15) {
        insights.push({
          id: 'avg_value_declining', type: 'revenue', severity: 'warning',
          title: 'Average Session Value Declining',
          description: `Average transaction value dropped ${Math.abs(avgChange)}% ($${priorAvg.toFixed(0)} → $${recentAvg.toFixed(0)}).`,
          metric: `-${Math.abs(avgChange)}%`,
          recommendation: 'Families may be booking shorter sessions. Consider offering bundled packages or premium "full day" care at a discount.',
        });
      }
    }

    // 4. Instant Payout Adoption
    const payoutStats = await db.prepare(`
      SELECT COALESCE(payout_speed, 'standard') AS speed, COUNT(*) AS count
      FROM payments WHERE status = 'completed'
      GROUP BY COALESCE(payout_speed, 'standard')
    `).all();
    const totalPayouts = payoutStats.reduce((s, p) => s + p.count, 0);
    const instantPayouts = payoutStats.find(p => p.speed === 'instant');
    const instantPct = totalPayouts > 0 && instantPayouts ? Math.round((instantPayouts.count / totalPayouts) * 100) : 0;

    if (totalPayouts > 0) {
      if (instantPct < 30) {
        insights.push({
          id: 'instant_payout_low', type: 'payouts', severity: 'neutral',
          title: 'Instant Payout Adoption Low',
          description: `Only ${instantPct}% of caregivers use instant payouts. Instant payouts are handled by Stripe (1% fee, min $0.50 — paid by caregiver, not the platform).`,
          metric: `${instantPct}%`,
          recommendation: 'Promote instant payouts to caregivers — highlight same-day access to earnings. This is a caregiver perk at no cost to the platform.',
        });
      } else if (instantPct > 50) {
        insights.push({
          id: 'instant_payout_high', type: 'payouts', severity: 'positive',
          title: 'Strong Instant Payout Adoption',
          description: `${instantPct}% of payments use instant payouts. Stripe handles the fee (1%, min $0.50) — no platform cost.`,
          metric: `${instantPct}%`,
          recommendation: 'Great adoption! Caregivers value fast access to earnings. This is a retention driver at zero cost to the platform.',
        });
      }
    }

    // 5. Service Mix Concentration
    const serviceRevenue = await db.prepare(`
      SELECT cs.service_type, COALESCE(SUM(p.amount), 0) AS revenue
      FROM payments p JOIN care_sessions cs ON p.session_id = cs.id
      WHERE p.status = 'completed'
      GROUP BY cs.service_type ORDER BY revenue DESC
    `).all();
    const totalServiceRevenue = serviceRevenue.reduce((s, r) => s + r.revenue, 0);
    if (serviceRevenue.length > 0 && totalServiceRevenue > 0) {
      const topServicePct = Math.round((serviceRevenue[0].revenue / totalServiceRevenue) * 100);
      if (topServicePct > 60 && serviceRevenue.length > 1) {
        insights.push({
          id: 'service_concentration', type: 'services', severity: 'warning',
          title: 'Service Revenue Concentrated',
          description: `"${serviceRevenue[0].service_type}" accounts for ${topServicePct}% of all revenue.`,
          metric: `${topServicePct}%`,
          recommendation: 'Diversify by promoting underutilized services. Cross-sell companion care or meal prep to families who only book personal care.',
        });
      }
    }

    // 6. Top Client Concentration
    const topClients = await db.prepare(`
      SELECT family_user_id, COALESCE(SUM(amount), 0) AS total
      FROM payments WHERE status = 'completed'
      GROUP BY family_user_id ORDER BY total DESC LIMIT 3
    `).all();
    const totalAllRevenue = await db.prepare(
      "SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE status = 'completed'"
    ).get();
    if (topClients.length >= 3 && totalAllRevenue.total > 0) {
      const top3Revenue = topClients.reduce((s, c) => s + c.total, 0);
      const top3Pct = Math.round((top3Revenue / totalAllRevenue.total) * 100);
      if (top3Pct > 50) {
        insights.push({
          id: 'client_concentration', type: 'risk', severity: 'warning',
          title: 'Revenue Concentrated in Top 3 Clients',
          description: `Your top 3 families account for ${top3Pct}% of all revenue — high dependency risk.`,
          metric: `${top3Pct}%`,
          recommendation: 'Prioritize family acquisition to diversify your revenue base. Consider referral programs or targeted outreach in new neighborhoods.',
        });
      }
    }

    // 7. Caregiver Utilization
    const totalCaregivers = await db.prepare(
      "SELECT COUNT(*) AS count FROM caregiver_profiles cp JOIN users u ON cp.user_id = u.id WHERE COALESCE(u.is_demo, 0) = 0"
    ).get();
    const activeCaregivers = await db.prepare(`
      SELECT COUNT(DISTINCT p.caregiver_id) AS count FROM payments p
      JOIN caregiver_profiles cp ON p.caregiver_id = cp.id
      JOIN users u ON cp.user_id = u.id
      WHERE p.status = 'completed' AND p.created_at >= ? AND COALESCE(u.is_demo, 0) = 0
    `).get(ninetyDaysAgo);

    if (totalCaregivers.count > 0) {
      const utilizationPct = Math.round((activeCaregivers.count / totalCaregivers.count) * 100);
      if (utilizationPct < 40) {
        insights.push({
          id: 'caregiver_utilization', type: 'caregivers', severity: 'warning',
          title: 'Low Caregiver Utilization',
          description: `Only ${activeCaregivers.count} of ${totalCaregivers.count} caregivers (${utilizationPct}%) have had paid sessions in the last 90 days.`,
          metric: `${utilizationPct}%`,
          recommendation: 'Re-engage inactive caregivers with email campaigns highlighting available care requests in their area. Consider reducing the background check fee barrier.',
        });
      } else {
        insights.push({
          id: 'caregiver_utilization_good', type: 'caregivers', severity: 'positive',
          title: 'Strong Caregiver Utilization',
          description: `${utilizationPct}% of caregivers are active — healthy supply-side engagement.`,
          metric: `${utilizationPct}%`,
          recommendation: 'Keep it up! Consider recruiting more caregivers to handle growth without overburdening existing ones.',
        });
      }
    }

    // 8. Background Check Conversion
    const bgCheckTotal = await db.prepare(
      "SELECT COUNT(*) AS total FROM caregiver_profiles cp JOIN users u ON cp.user_id = u.id WHERE COALESCE(u.is_demo, 0) = 0"
    ).get();
    const bgCheckPaid = await db.prepare(
      "SELECT COUNT(*) AS paid FROM caregiver_profiles WHERE background_check_paid = 1"
    ).get();

    if (bgCheckTotal.total > 0) {
      const bgPct = Math.round((bgCheckPaid.paid / bgCheckTotal.total) * 100);
      if (bgPct < 50 && bgCheckTotal.total > 2) {
        insights.push({
          id: 'bg_check_conversion', type: 'onboarding', severity: 'warning',
          title: 'Low Background Check Conversion',
          description: `Only ${bgCheckPaid.paid} of ${bgCheckTotal.total} caregivers (${bgPct}%) have paid for background checks.`,
          metric: `${bgPct}%`,
          recommendation: 'The $30 fee may be a friction point. Consider offering promotional discounts, or waiving the fee for the first 50 caregivers to build supply.',
        });
      }
    }

    // 9. Monthly Projection
    const last3Months = await db.prepare(`
      SELECT TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') AS month,
             COALESCE(SUM(platform_fee), 0) AS platform_fee
      FROM payments WHERE status = 'completed'
        AND created_at >= DATE_TRUNC('month', NOW()) - INTERVAL '2 months'
      GROUP BY DATE_TRUNC('month', created_at)
      ORDER BY month ASC
    `).all();

    if (last3Months.length >= 2) {
      const revenues = last3Months.map(m => m.platform_fee);
      // Simple linear regression on last 2-3 months
      const avgGrowth = revenues.length >= 3
        ? ((revenues[2] - revenues[0]) / 2)
        : (revenues[1] - revenues[0]);
      const projected = Math.max(0, revenues[revenues.length - 1] + avgGrowth);

      insights.push({
        id: 'projection', type: 'forecast', severity: projected > revenues[revenues.length - 1] ? 'positive' : 'neutral',
        title: 'Next Month Revenue Projection',
        description: `Based on recent trends, projected platform revenue next month: $${projected.toFixed(2)}.`,
        metric: `$${projected.toFixed(2)}`,
        recommendation: projected > revenues[revenues.length - 1]
          ? 'Trending upward — ensure caregiver capacity can meet growing demand.'
          : 'Growth has plateaued. Focus on customer acquisition or increasing session frequency with existing families.',
      });
    }

    // 10. Platform fee health check
    if (totalAllRevenue.total > 0) {
      const allPlatformFee = await db.prepare(
        "SELECT COALESCE(SUM(platform_fee), 0) AS total FROM payments WHERE status = 'completed'"
      ).get();
      const effectiveRate = Math.round((allPlatformFee.total / totalAllRevenue.total) * 1000) / 10;
      if (effectiveRate < 18) {
        insights.push({
          id: 'fee_rate_low', type: 'revenue', severity: 'warning',
          title: 'Effective Platform Rate Below Target',
          description: `Your effective platform fee rate is ${effectiveRate}%, below the 20% target.`,
          metric: `${effectiveRate}%`,
          recommendation: 'Check if any discount codes or fee waivers are active. Ensure all checkout sessions correctly apply the 20% platform fee.',
        });
      }
    }

    res.json({ insights });
  } catch (err) {
    console.error("Financials insights error:", err);
    res.status(500).json({ error: "Failed to generate insights" });
  }
});

// ─── GET /api/admin/financials/platform-fee ───
// Get current platform fee percentage
router.get("/platform-fee", async (req, res) => {
  try {
    const db = await getDb();
    const row = await db.prepare("SELECT value FROM platform_settings WHERE key = 'platform_fee_percent'").get();
    res.json({ platformFeePercent: row ? parseFloat(row.value) : 20 });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch platform fee" });
  }
});

// ─── PUT /api/admin/financials/platform-fee ───
// Update platform fee percentage
router.put("/platform-fee", async (req, res) => {
  const { platformFeePercent } = req.body;
  if (platformFeePercent == null || platformFeePercent < 0 || platformFeePercent > 50) {
    return res.status(400).json({ error: "platformFeePercent must be between 0 and 50" });
  }
  try {
    const db = await getDb();
    await db.prepare(
      "INSERT INTO platform_settings (key, value) VALUES ('platform_fee_percent', ?) ON CONFLICT (key) DO UPDATE SET value = ?, updated_at = NOW()"
    ).run(String(platformFeePercent), String(platformFeePercent));
    res.json({ platformFeePercent });
  } catch (err) {
    res.status(500).json({ error: "Failed to update platform fee" });
  }
});

// ─── GET /api/admin/financials/cancellation-fee ───
// v1.105.15 — the rate the Client Services Agreement points at.
//
// The clause charges "a cancellation fee at the then-current rate posted on IPC's platform
// at the time of cancellation". Until a rate is set here there is nothing for that clause
// to reference, so late cancellations release the hold instead of charging. This endpoint
// is what makes the clause enforceable — which is why 0 is the default and not 100.
router.get("/cancellation-fee", async (req, res) => {
  try {
    const db = await getDb();
    const row = await db.prepare("SELECT value FROM platform_settings WHERE key = 'cancellation_fee_percent'").get();
    const pct = row ? parseFloat(row.value) : 0;
    res.json({
      cancellationFeePercent: Number.isFinite(pct) ? pct : 0,
      isPosted: !!row,
      // Surfaced so the admin screen can say WHY nothing is being charged, rather than
      // showing a silent 0 that reads like a working setting.
      note: row
        ? null
        : "No rate is posted, so late cancellations currently release the hold in full. The Client Services Agreement can only charge a rate that has been posted.",
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch cancellation fee" });
  }
});

// ─── PUT /api/admin/financials/cancellation-fee ───
router.put("/cancellation-fee", async (req, res) => {
  const { cancellationFeePercent } = req.body;
  const pct = Number(cancellationFeePercent);
  // 0-100. Above 100 is uncapturable — the hold is the ceiling — and a negative fee would
  // mean paying the client to cancel.
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
    return res.status(400).json({ error: "cancellationFeePercent must be between 0 and 100" });
  }
  try {
    const db = await getDb();
    await db.prepare(
      "INSERT INTO platform_settings (key, value) VALUES ('cancellation_fee_percent', ?) ON CONFLICT (key) DO UPDATE SET value = ?, updated_at = NOW()"
    ).run(String(pct), String(pct));
    res.json({ cancellationFeePercent: pct });
  } catch (err) {
    res.status(500).json({ error: "Failed to update cancellation fee" });
  }
});

// ─── GET /api/admin/financials/payments-enabled ───
// Check if real payments are enabled
router.get("/payments-enabled", async (req, res) => {
  try {
    const db = await getDb();
    const row = await db.prepare("SELECT value FROM platform_settings WHERE key = 'payments_enabled'").get();
    res.json({ paymentsEnabled: row?.value === 'true' });
  } catch (err) {
    res.status(500).json({ error: "Failed to check payment status" });
  }
});

// ─── PUT /api/admin/financials/payments-enabled ───
// Toggle real payments on/off — admin kill switch
router.put("/payments-enabled", async (req, res) => {
  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: "enabled must be true or false" });
  }
  try {
    const db = await getDb();
    await db.prepare(
      "INSERT INTO platform_settings (key, value) VALUES ('payments_enabled', ?) ON CONFLICT (key) DO UPDATE SET value = ?, updated_at = NOW()"
    ).run(String(enabled), String(enabled));
    console.log(`💰 Payments ${enabled ? 'ENABLED' : 'DISABLED'} by admin`);
    res.json({ paymentsEnabled: enabled });
  } catch (err) {
    res.status(500).json({ error: "Failed to update payment status" });
  }
});

// ─── GET /api/admin/financials/time-audit ───
// Time Record Audit: surfaces sessions needing review per the caregiver agreement
// Three confirmation layers: (1) Platform Time Records (check-in/out), (2) Client Confirmation (review), (3) Geotag
router.get("/time-audit", async (req, res) => {
  try {
    const db = await getDb();

    // 1. Unconfirmed visits: completed sessions with visit log but no family review
    const unconfirmed = await db.prepare(`
      SELECT cs.id, cs.scheduled_date, cs.scheduled_time, cs.duration_hours, cs.service_type,
        cs.status, cs.completed_at, cs.review_completed,
        vl.check_in_time, vl.check_out_time,
        vl.check_in_latitude, vl.check_in_longitude, vl.check_out_lat, vl.check_out_lng,
        vl.check_in_distance_ft,
        u_fam.first_name AS family_first, u_fam.last_name AS family_last,
        u_cg.first_name AS cg_first, u_cg.last_name AS cg_last,
        cp.id AS cg_profile_id
      FROM care_sessions cs
      JOIN visit_logs vl ON vl.session_id = cs.id
      JOIN users u_fam ON cs.family_user_id = u_fam.id
      LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
      LEFT JOIN users u_cg ON cp.user_id = u_cg.id
      WHERE cs.status = 'completed'
        AND COALESCE(cs.review_completed, 0) = 0
        AND vl.check_in_time IS NOT NULL
        AND vl.check_out_time IS NOT NULL
        AND COALESCE(u_fam.is_demo, 0) = 0
      ORDER BY cs.completed_at DESC NULLS LAST
      LIMIT 50
    `).all();

    // 2. Time discrepancies: actual duration differs from scheduled by > 15 min
    const discrepancies = await db.prepare(`
      SELECT cs.id, cs.scheduled_date, cs.scheduled_time, cs.duration_hours, cs.service_type,
        cs.status, cs.completed_at, cs.review_completed, cs.late_check_in,
        vl.check_in_time, vl.check_out_time,
        vl.check_in_latitude, vl.check_in_longitude, vl.check_out_lat, vl.check_out_lng,
        vl.check_in_distance_ft,
        u_fam.first_name AS family_first, u_fam.last_name AS family_last,
        u_cg.first_name AS cg_first, u_cg.last_name AS cg_last,
        EXTRACT(EPOCH FROM (vl.check_out_time - vl.check_in_time)) / 3600.0 AS actual_hours
      FROM care_sessions cs
      JOIN visit_logs vl ON vl.session_id = cs.id
      JOIN users u_fam ON cs.family_user_id = u_fam.id
      LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
      LEFT JOIN users u_cg ON cp.user_id = u_cg.id
      WHERE cs.status IN ('completed', 'paid')
        AND vl.check_in_time IS NOT NULL
        AND vl.check_out_time IS NOT NULL
        AND COALESCE(u_fam.is_demo, 0) = 0
        AND ABS(EXTRACT(EPOCH FROM (vl.check_out_time - vl.check_in_time)) / 3600.0 - cs.duration_hours) > 0.25
      ORDER BY cs.completed_at DESC NULLS LAST
      LIMIT 50
    `).all();

    // 3. Missing time records: completed/paid sessions with no visit log or no check-in/out
    const missingRecords = await db.prepare(`
      SELECT cs.id, cs.scheduled_date, cs.scheduled_time, cs.duration_hours, cs.service_type,
        cs.status, cs.completed_at,
        u_fam.first_name AS family_first, u_fam.last_name AS family_last,
        u_cg.first_name AS cg_first, u_cg.last_name AS cg_last,
        vl.id AS visit_log_id, vl.check_in_time, vl.check_out_time
      FROM care_sessions cs
      JOIN users u_fam ON cs.family_user_id = u_fam.id
      LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
      LEFT JOIN users u_cg ON cp.user_id = u_cg.id
      LEFT JOIN visit_logs vl ON vl.session_id = cs.id
      WHERE cs.status IN ('completed', 'paid')
        AND COALESCE(u_fam.is_demo, 0) = 0
        AND (vl.id IS NULL OR vl.check_in_time IS NULL OR vl.check_out_time IS NULL)
      ORDER BY cs.completed_at DESC NULLS LAST
      LIMIT 50
    `).all();

    // 4. Summary counts
    const countUnconfirmed = await db.prepare(`
      SELECT COUNT(*) AS count FROM care_sessions cs
      JOIN visit_logs vl ON vl.session_id = cs.id
      JOIN users u ON cs.family_user_id = u.id
      WHERE cs.status = 'completed' AND COALESCE(cs.review_completed, 0) = 0
        AND vl.check_in_time IS NOT NULL AND vl.check_out_time IS NOT NULL
        AND COALESCE(u.is_demo, 0) = 0
    `).get();

    const countDiscrepancies = await db.prepare(`
      SELECT COUNT(*) AS count FROM care_sessions cs
      JOIN visit_logs vl ON vl.session_id = cs.id
      JOIN users u ON cs.family_user_id = u.id
      WHERE cs.status IN ('completed', 'paid')
        AND vl.check_in_time IS NOT NULL AND vl.check_out_time IS NOT NULL
        AND COALESCE(u.is_demo, 0) = 0
        AND ABS(EXTRACT(EPOCH FROM (vl.check_out_time - vl.check_in_time)) / 3600.0 - cs.duration_hours) > 0.25
    `).get();

    const countMissing = await db.prepare(`
      SELECT COUNT(*) AS count FROM care_sessions cs
      JOIN users u ON cs.family_user_id = u.id
      LEFT JOIN visit_logs vl ON vl.session_id = cs.id
      WHERE cs.status IN ('completed', 'paid')
        AND COALESCE(u.is_demo, 0) = 0
        AND (vl.id IS NULL OR vl.check_in_time IS NULL OR vl.check_out_time IS NULL)
    `).get();

    const countLateCheckins = await db.prepare(`
      SELECT COUNT(*) AS count FROM care_sessions cs
      JOIN users u ON cs.family_user_id = u.id
      WHERE cs.late_check_in = 1 AND cs.status IN ('completed', 'paid', 'in_progress')
        AND COALESCE(u.is_demo, 0) = 0
    `).get();

    res.json({
      counts: {
        unconfirmed: parseInt(countUnconfirmed.count) || 0,
        discrepancies: parseInt(countDiscrepancies.count) || 0,
        missingRecords: parseInt(countMissing.count) || 0,
        lateCheckins: parseInt(countLateCheckins.count) || 0,
      },
      unconfirmed: unconfirmed.map(r => ({
        sessionId: r.id, scheduledDate: r.scheduled_date, scheduledTime: r.scheduled_time,
        durationHours: r.duration_hours, serviceType: r.service_type, status: r.status,
        completedAt: r.completed_at, reviewCompleted: !!r.review_completed,
        checkIn: r.check_in_time, checkOut: r.check_out_time,
        geo: { inLat: r.check_in_latitude, inLng: r.check_in_longitude, outLat: r.check_out_lat, outLng: r.check_out_lng, distanceFt: r.check_in_distance_ft },
        family: `${r.family_first} ${r.family_last}`, caregiver: r.cg_first ? `${r.cg_first} ${r.cg_last}` : '—',
      })),
      discrepancies: discrepancies.map(r => ({
        sessionId: r.id, scheduledDate: r.scheduled_date, scheduledTime: r.scheduled_time,
        durationHours: r.duration_hours, actualHours: parseFloat(r.actual_hours) || 0,
        serviceType: r.service_type, status: r.status, completedAt: r.completed_at,
        reviewCompleted: !!r.review_completed, lateCheckIn: !!r.late_check_in,
        checkIn: r.check_in_time, checkOut: r.check_out_time,
        geo: { inLat: r.check_in_latitude, inLng: r.check_in_longitude, outLat: r.check_out_lat, outLng: r.check_out_lng, distanceFt: r.check_in_distance_ft },
        family: `${r.family_first} ${r.family_last}`, caregiver: r.cg_first ? `${r.cg_first} ${r.cg_last}` : '—',
        deltaMinutes: Math.round((parseFloat(r.actual_hours) - r.duration_hours) * 60),
      })),
      missingRecords: missingRecords.map(r => ({
        sessionId: r.id, scheduledDate: r.scheduled_date, scheduledTime: r.scheduled_time,
        durationHours: r.duration_hours, serviceType: r.service_type, status: r.status,
        completedAt: r.completed_at, hasVisitLog: !!r.visit_log_id,
        hasCheckIn: !!r.check_in_time, hasCheckOut: !!r.check_out_time,
        family: `${r.family_first} ${r.family_last}`, caregiver: r.cg_first ? `${r.cg_first} ${r.cg_last}` : '—',
      })),
    });
  } catch (err) {
    console.error("Time audit error:", err);
    res.status(500).json({ error: "Failed to load time audit data" });
  }
});

module.exports = router;
