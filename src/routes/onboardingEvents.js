const express = require("express");
const { v4: uuid } = require("uuid");
const { getDb } = require("../models/database");
const { authenticate } = require("../middleware/auth");

const router = express.Router();

// ─── POST /api/onboarding-events ───
// Log an auth/onboarding event (step completion, error, drop-off, login, register, etc.)
// Can be called with or without auth (pre-registration errors have no token)
router.post("/", async (req, res) => {
  try {
    const db = await getDb();
    const { eventType, step, stepName, errorMessage, errorSource, email, metadata, flow } = req.body;

    if (!eventType) {
      return res.status(400).json({ error: "eventType is required" });
    }

    // Try to get user from auth header (may not exist for pre-registration errors)
    let userId = null;
    let userEmail = email || null;
    const header = req.headers.authorization;
    if (header && header.startsWith("Bearer ")) {
      try {
        const jwt = require("jsonwebtoken");
        const JWT_SECRET = process.env.JWT_SECRET;
        const decoded = jwt.verify(header.split(" ")[1], JWT_SECRET);
        userId = decoded.id;
        userEmail = userEmail || decoded.email;
      } catch (e) { /* invalid token, that's fine */ }
    }

    const userAgent = req.headers["user-agent"] || null;
    const ip = req.headers["x-forwarded-for"] || req.connection?.remoteAddress || null;
    const eventFlow = flow || 'onboarding';

    await db.prepare(`
      INSERT INTO onboarding_events (id, user_id, email, event_type, step, step_name, error_message, error_source, metadata, user_agent, ip_address, flow)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      uuid(), userId, userEmail, eventType,
      step || null, stepName || null,
      errorMessage || null, errorSource || null,
      metadata ? JSON.stringify(metadata) : null,
      userAgent, ip, eventFlow
    );

    // Log to console for Railway logs too
    const emoji = eventType === 'error' ? '❌' : eventType.includes('success') || eventType.includes('complete') ? '✅' : 'ℹ️';
    console.log(`  [${eventFlow}] ${emoji} ${eventType} | user=${userEmail || userId || 'anon'}${step ? ' | step=' + step : ''}${errorMessage ? ' | error=' + errorMessage : ''}`);

    res.json({ ok: true });
  } catch (err) {
    console.error("  [auth-events] Failed to log event:", err.message);
    // Don't fail the user's flow — always return 200
    res.json({ ok: true });
  }
});

// ─── GET /api/onboarding-events ───
// Admin: retrieve onboarding events (filterable)
router.get("/", authenticate, async (req, res) => {
  try {
    // Check admin
    const db = await getDb();
    const user = await db.prepare("SELECT is_admin FROM users WHERE id = ?").get(req.user.id);
    if (!user?.is_admin && !req.isAdmin) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const { eventType, email, flow: flowFilter, limit = 100, offset = 0, since } = req.query;

    let query = "SELECT * FROM onboarding_events WHERE 1=1";
    const params = [];

    if (eventType) {
      query += " AND event_type = ?";
      params.push(eventType);
    }
    if (email) {
      query += " AND email ILIKE ?";
      params.push(`%${email}%`);
    }
    if (flowFilter) {
      query += " AND flow = ?";
      params.push(flowFilter);
    }
    if (since) {
      query += " AND created_at >= ?";
      params.push(since);
    }

    query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
    params.push(parseInt(limit), parseInt(offset));

    const events = await db.prepare(query).all(...params);

    // Summary stats (30 days) — grouped by flow + event_type
    const stats = await db.prepare(`
      SELECT
        COALESCE(flow, 'onboarding') as flow,
        event_type,
        COUNT(*) as count,
        COUNT(DISTINCT COALESCE(user_id, email)) as unique_users
      FROM onboarding_events
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY COALESCE(flow, 'onboarding'), event_type
      ORDER BY flow, count DESC
    `).all();

    // Step completion funnel (last 30 days) — onboarding only
    const funnel = await db.prepare(`
      SELECT
        step, step_name,
        COUNT(*) as completions,
        COUNT(DISTINCT COALESCE(user_id, email)) as unique_users
      FROM onboarding_events
      WHERE event_type = 'step_complete'
        AND COALESCE(flow, 'onboarding') = 'onboarding'
        AND created_at >= NOW() - INTERVAL '30 days'
      GROUP BY step, step_name
      ORDER BY step
    `).all();

    // Recent errors (all flows)
    const recentErrors = await db.prepare(`
      SELECT *
      FROM onboarding_events
      WHERE event_type = 'error'
      ORDER BY created_at DESC
      LIMIT 20
    `).all();

    // Flow summary (30 days) — high-level counts per flow
    const flowSummary = await db.prepare(`
      SELECT
        COALESCE(flow, 'onboarding') as flow,
        COUNT(*) as total_events,
        COUNT(DISTINCT COALESCE(user_id, email)) as unique_users,
        COUNT(*) FILTER (WHERE event_type = 'error') as error_count
      FROM onboarding_events
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY COALESCE(flow, 'onboarding')
      ORDER BY total_events DESC
    `).all();

    res.json({ events, stats, funnel, recentErrors, flowSummary });
  } catch (err) {
    console.error("  [onboarding-events] GET error:", err.message);
    res.status(500).json({ error: "Failed to load events" });
  }
});

module.exports = router;
