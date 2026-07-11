// Split out of routes/admin.js (v1.92.0, tier-2 #3 — zero behavior change).
// Route bodies are verbatim; registration ORDER across modules is preserved by
// ./index.js. Shared state (passkey challenge store, helpers) lives in ./shared.js.
const { v4: uuid } = require("uuid");
const { getDb } = require("../../models/database");
const { authenticate, requireAdmin } = require("../../middleware/auth");
const { captureException } = require("../../utils/sentry");
const { activeVouchesFor } = require("../../utils/vouches");
const { sendVerificationEmail } = require("../auth");
const {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require("@simplewebauthn/server");
const { isTrustedIp, registerTrustedIp, getTrustedIps, removeTrustedIp } = require("../../utils/trustedIps");
const { getClientIp, writeAuditLog } = require("../../middleware/auditLog");
const {
  RP_ID, ORIGIN,
  setPasskeyChallenge, getPasskeyChallenge, setNukeChallenge, getNukeChallenge,
  NOT_DEMO_SESSION, safeJson, logAdminAction, checkAdmin,
} = require("./shared");

module.exports = function register(router) {

// ─── Security: Audit Log & Anomaly Detection ───

// GET /api/admin/security/audit-log — Paginated audit log with filters
router.get("/security/audit-log", requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const { severity, action, userId, limit: lim, offset: off, startDate, endDate } = req.query;
    const limitN = Math.min(parseInt(lim) || 50, 200);
    const offsetN = parseInt(off) || 0;

    let where = "WHERE 1=1";
    const params = [];
    if (severity && severity !== 'all') { where += " AND severity = ?"; params.push(severity); }
    if (action && action !== 'all') { where += " AND action = ?"; params.push(action); }
    if (userId) { where += " AND user_id = ?"; params.push(userId); }
    if (startDate) { where += " AND created_at >= ?"; params.push(startDate); }
    if (endDate) { where += " AND created_at <= ?"; params.push(endDate); }

    const rows = await db.prepare(`
      SELECT * FROM audit_log ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?
    `).all(...params, limitN, offsetN);

    const countRow = await db.prepare(`SELECT COUNT(*) as total FROM audit_log ${where}`).get(...params);

    res.json({ entries: rows, total: countRow?.total || 0 });
  } catch (err) {
    console.error("Audit log fetch error:", err);
    res.status(500).json({ error: "Failed to fetch audit log" });
  }
});

// GET /api/admin/security/dashboard — Anomaly detection summary
router.get("/security/dashboard", requireAdmin, async (req, res) => {
  try {
    const db = await getDb();

    // Counts by severity in last 24h
    const severityCounts = await db.prepare(`
      SELECT severity, COUNT(*) as count
      FROM audit_log
      WHERE created_at > NOW() - INTERVAL '24 hours'
      GROUP BY severity
      ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'error' THEN 2 WHEN 'warn' THEN 3 ELSE 4 END
    `).all();

    // Top actions in last 24h
    const topActions = await db.prepare(`
      SELECT action, COUNT(*) as count, COUNT(DISTINCT user_id) as unique_users, COUNT(DISTINCT ip_address) as unique_ips
      FROM audit_log
      WHERE created_at > NOW() - INTERVAL '24 hours'
      GROUP BY action ORDER BY count DESC LIMIT 15
    `).all();

    // Failed logins in last 24h
    const failedLogins24h = await db.prepare(`
      SELECT ip_address, COUNT(*) as count, MAX(created_at) as last_attempt,
        MIN(created_at) as first_attempt, user_email
      FROM audit_log
      WHERE action = 'login_attempt' AND severity IN ('warn', 'critical')
        AND created_at > NOW() - INTERVAL '24 hours'
      GROUP BY ip_address, user_email
      HAVING COUNT(*) >= 3
      ORDER BY count DESC
      LIMIT 20
    `).all();

    // Critical/error events in last 7 days
    const criticalEvents = await db.prepare(`
      SELECT * FROM audit_log
      WHERE severity IN ('critical', 'error')
        AND created_at > NOW() - INTERVAL '7 days'
      ORDER BY created_at DESC
      LIMIT 20
    `).all();

    // Admin access in last 24h
    const adminAccess = await db.prepare(`
      SELECT user_email, ip_address, COUNT(*) as count, MAX(created_at) as last_access,
        MIN(created_at) as first_access
      FROM audit_log
      WHERE action = 'admin_access'
        AND created_at > NOW() - INTERVAL '24 hours'
      GROUP BY user_email, ip_address
      ORDER BY count DESC
    `).all();

    // Hourly activity for last 24h (for chart)
    const hourlyActivity = await db.prepare(`
      SELECT date_trunc('hour', created_at) as hour, COUNT(*) as count, severity
      FROM audit_log
      WHERE created_at > NOW() - INTERVAL '24 hours'
      GROUP BY date_trunc('hour', created_at), severity
      ORDER BY hour
    `).all();

    // Anomaly flags from in-memory tracker
    const { failedLogins: failedLoginTracker } = require("../middleware/auditLog");
    const activeThreats = [];
    for (const [ip, data] of failedLoginTracker) {
      if (data.count >= 5) {
        activeThreats.push({ ip, failedCount: data.count, since: new Date(data.firstAt).toISOString() });
      }
    }

    res.json({
      severityCounts,
      topActions,
      failedLogins: failedLogins24h,
      criticalEvents,
      adminAccess,
      hourlyActivity,
      activeThreats,
    });
  } catch (err) {
    console.error("Security dashboard error:", err);
    res.status(500).json({ error: "Failed to load security dashboard" });
  }
});

// ─── GET /api/admin/security/insights ─── Context-aware AI security insights
// Distinguishes trusted admin activity from genuinely suspicious events.
// Trusted = admin users accessing from IPs they've successfully logged in from before.
router.get("/security/insights", requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const insights = [];

    // ── Build trusted-user context from trusted_admin_ips table ──
    // Uses the persisted, passkey-verified trusted IP list (not audit log heuristics)
    const trustedRows = await db.prepare(`
      SELECT tai.user_id, u.email as user_email, tai.ip_address
      FROM trusted_admin_ips tai
      JOIN users u ON tai.user_id = u.id
      WHERE tai.expires_at > NOW()
    `).all();
    // Build a Set of "userId:ip" pairs that are trusted
    const trustedPairs = new Set(trustedRows.map(r => `${r.user_id}:${r.ip_address}`));
    const trustedEmails = new Set(trustedRows.map(r => r.user_email).filter(Boolean));
    // Also get admin user IDs
    const adminUsers = await db.prepare(`SELECT id, email FROM users WHERE role = 'admin'`).all();
    const adminIds = new Set(adminUsers.map(u => u.id));
    const adminEmails = new Set(adminUsers.map(u => u.email));

    // Helper: is this event from a trusted admin on a known IP?
    function isTrustedAdmin(row) {
      if (!row.user_id || !adminIds.has(row.user_id)) return false;
      return trustedPairs.has(`${row.user_id}:${row.ip_address}`);
    }

    // Helper: is this a self-inflicted auth/CSRF error from an admin user?
    // These are app bugs or stale sessions, not security threats
    function isAdminAuthNoise(row) {
      if (!row.user_id || !adminIds.has(row.user_id)) return false;
      const det = typeof row.details === 'string' ? JSON.parse(row.details || '{}') : (row.details || {});
      const statusCode = det.statusCode || 0;
      // 401 (expired session) or 403 (CSRF/auth) from a known admin user — not a threat
      return statusCode === 401 || statusCode === 403;
    }

    // ── 1. Critical/error events — with root cause breakdown ──
    const critEvents24h = await db.prepare(`
      SELECT id, user_id, user_email, ip_address, action, endpoint, severity, details, created_at
      FROM audit_log
      WHERE severity IN ('critical', 'error') AND created_at > NOW() - INTERVAL '24 hours'
      ORDER BY created_at DESC
    `).all();

    // Separate genuine threats from trusted admin noise
    const genuineCritical = [];
    const trustedAdminNoise = [];
    for (const evt of critEvents24h) {
      if (isTrustedAdmin(evt) || isAdminAuthNoise(evt)) {
        trustedAdminNoise.push(evt);
      } else {
        genuineCritical.push(evt);
      }
    }

    // Break down genuine critical events by category
    const bruteForce = genuineCritical.filter(e => {
      const det = typeof e.details === 'string' ? JSON.parse(e.details || '{}') : (e.details || {});
      return det.anomaly === 'brute_force_suspect';
    });
    const serverErrors = genuineCritical.filter(e => {
      const det = typeof e.details === 'string' ? JSON.parse(e.details || '{}') : (e.details || {});
      return (det.statusCode >= 500) && det.anomaly !== 'brute_force_suspect';
    });
    const unknownIPAdmin = genuineCritical.filter(e =>
      e.action === 'admin_access' && e.user_id && !trustedPairs.has(`${e.user_id}:${e.ip_address}`)
    );
    const otherCritical = genuineCritical.filter(e =>
      !bruteForce.includes(e) && !serverErrors.includes(e) && !unknownIPAdmin.includes(e)
    );

    // 7-day comparison for spike detection (excluding trusted admin noise)
    const critWeek = await db.prepare(`
      SELECT DATE(created_at) as day, COUNT(*) as cnt
      FROM audit_log
      WHERE severity IN ('critical', 'error') AND created_at > NOW() - INTERVAL '7 days'
      GROUP BY DATE(created_at) ORDER BY day
    `).all();
    const totalCrit7d = critWeek.reduce((s, r) => s + Number(r.cnt), 0);

    if (genuineCritical.length === 0 && totalCrit7d === 0) {
      insights.push({ type: 'positive', icon: '✅', title: 'Clean week — zero critical events', detail: 'No critical or error events in the past 7 days. System is running cleanly.' });
    } else if (genuineCritical.length === 0 && trustedAdminNoise.length > 0) {
      insights.push({
        type: 'positive', icon: '✅',
        title: `All ${trustedAdminNoise.length} flagged event${trustedAdminNoise.length > 1 ? 's' : ''} today are your own admin activity`,
        detail: `${trustedAdminNoise.length} event${trustedAdminNoise.length > 1 ? 's' : ''} from known admin IPs — no action needed. These are routine and have been filtered out of severity counts.`,
      });
    } else if (genuineCritical.length > 0) {
      // Build a root-cause summary
      const parts = [];
      if (bruteForce.length > 0) {
        const bfIPs = [...new Set(bruteForce.map(e => e.ip_address))];
        parts.push(`${bruteForce.length} brute force attempt${bruteForce.length > 1 ? 's' : ''} from ${bfIPs.length === 1 ? bfIPs[0] : bfIPs.length + ' IPs'}`);
      }
      if (serverErrors.length > 0) {
        const errEndpoints = [...new Set(serverErrors.map(e => e.endpoint))];
        parts.push(`${serverErrors.length} server error${serverErrors.length > 1 ? 's' : ''} on ${errEndpoints.slice(0, 3).join(', ')}${errEndpoints.length > 3 ? ` (+${errEndpoints.length - 3} more)` : ''}`);
      }
      if (unknownIPAdmin.length > 0) {
        const unkIPs = [...new Set(unknownIPAdmin.map(e => e.ip_address))];
        const unkEmails = [...new Set(unknownIPAdmin.map(e => e.user_email || 'unknown'))];
        parts.push(`${unknownIPAdmin.length} admin access${unknownIPAdmin.length > 1 ? 'es' : ''} from unfamiliar IP${unkIPs.length > 1 ? 's' : ''} (${unkEmails.join(', ')} @ ${unkIPs.join(', ')})`);
      }
      if (otherCritical.length > 0) {
        parts.push(`${otherCritical.length} other critical event${otherCritical.length > 1 ? 's' : ''}`);
      }

      // Build recommendation
      const recs = [];
      if (bruteForce.length > 0) {
        const bfIPs = [...new Set(bruteForce.map(e => e.ip_address))];
        recs.push(`Block ${bfIPs.length === 1 ? 'IP ' + bfIPs[0] : 'these ' + bfIPs.length + ' IPs'} at Railway firewall or add rate limiting`);
      }
      if (serverErrors.length > 0) recs.push('Check Railway logs for the 5xx errors — could be a deploy issue or database timeout');
      if (unknownIPAdmin.length > 0) recs.push('Verify the unfamiliar admin IP — if it\'s not you (VPN, mobile, etc.), rotate your credentials immediately');

      const avgCrit = totalCrit7d > 0 ? Math.round(totalCrit7d / Math.max(critWeek.length, 1)) : 0;
      const isSpiking = genuineCritical.length > avgCrit * 2 && genuineCritical.length >= 3;

      insights.push({
        type: 'critical',
        icon: '🔴',
        title: isSpiking
          ? `${genuineCritical.length} genuine critical events today (${Math.round(genuineCritical.length / Math.max(avgCrit, 1))}x avg)`
          : `${genuineCritical.length} critical event${genuineCritical.length > 1 ? 's' : ''} today`,
        detail: parts.join(' · '),
        recommendation: recs.length > 0 ? recs.join('. ') + '.' : null,
      });
    }

    // ── 2. Failed login trend with attacker context ──
    const failedLogins24h = await db.prepare(`
      SELECT ip_address, user_email, COUNT(*) as cnt, MAX(created_at) as last_at
      FROM audit_log
      WHERE action = 'login_attempt' AND severity IN ('warn', 'critical')
        AND created_at > NOW() - INTERVAL '24 hours'
      GROUP BY ip_address, user_email
      ORDER BY cnt DESC
    `).all();
    const totalFailed24h = failedLogins24h.reduce((s, r) => s + Number(r.cnt), 0);

    // Check if these are against known accounts or random email guessing
    const targetedEmails = failedLogins24h.filter(r => r.user_email && trustedEmails.has(r.user_email));
    const randomEmails = failedLogins24h.filter(r => !r.user_email || !trustedEmails.has(r.user_email));
    const attackerIPs = [...new Set(failedLogins24h.filter(r => Number(r.cnt) >= 5).map(r => r.ip_address))];

    if (totalFailed24h >= 5) {
      const parts = [];
      if (targetedEmails.length > 0) {
        parts.push(`${targetedEmails.reduce((s, r) => s + Number(r.cnt), 0)} attempts against real accounts (${targetedEmails.map(r => r.user_email.split('@')[0]).join(', ')})`);
      }
      if (randomEmails.length > 0) {
        parts.push(`${randomEmails.reduce((s, r) => s + Number(r.cnt), 0)} against non-existent emails (credential stuffing)`);
      }

      // Trend: compare to last 6h vs 6h before that
      const recent6h = await db.prepare(`
        SELECT COUNT(*) as cnt FROM audit_log
        WHERE action = 'login_attempt' AND severity IN ('warn', 'critical')
          AND created_at > NOW() - INTERVAL '6 hours'
      `).get();
      const prior6h = await db.prepare(`
        SELECT COUNT(*) as cnt FROM audit_log
        WHERE action = 'login_attempt' AND severity IN ('warn', 'critical')
          AND created_at BETWEEN NOW() - INTERVAL '12 hours' AND NOW() - INTERVAL '6 hours'
      `).get();
      const r6 = Number(recent6h?.cnt || 0);
      const p6 = Number(prior6h?.cnt || 0);
      const trendNote = p6 > 0
        ? (r6 > p6 * 1.5 ? ' — getting worse (last 6h > prior 6h)' : r6 < p6 * 0.5 ? ' — subsiding' : ' — steady')
        : '';

      insights.push({
        type: totalFailed24h >= 20 || targetedEmails.length > 0 ? 'critical' : 'warning',
        icon: totalFailed24h >= 20 ? '🚨' : '🔐',
        title: `${totalFailed24h} failed logins today${trendNote}`,
        detail: parts.join('. '),
        recommendation: attackerIPs.length > 0
          ? `Top offender IPs: ${attackerIPs.slice(0, 5).join(', ')}. ${targetedEmails.length > 0 ? 'Real accounts are being targeted — consider enforcing passkey-only auth or temporary lockout.' : 'Random email spray — rate limiting should handle this.'}`
          : null,
      });
    }

    // ── 3. Admin access from unknown IPs (separate from critical events) ──
    const adminAccess24h = await db.prepare(`
      SELECT user_id, user_email, ip_address, COUNT(*) as cnt, MAX(created_at) as last_at
      FROM audit_log
      WHERE action = 'admin_access' AND created_at > NOW() - INTERVAL '24 hours'
      GROUP BY user_id, user_email, ip_address
      ORDER BY cnt DESC
    `).all();
    const unknownAdminAccess = adminAccess24h.filter(r =>
      r.user_id && !trustedPairs.has(`${r.user_id}:${r.ip_address}`)
    );
    const knownAdminAccess = adminAccess24h.filter(r =>
      r.user_id && trustedPairs.has(`${r.user_id}:${r.ip_address}`)
    );

    if (unknownAdminAccess.length > 0) {
      const entries = unknownAdminAccess.map(r => `${r.user_email || 'unknown'} from ${r.ip_address} (${r.cnt}x)`);
      insights.push({
        type: 'warning',
        icon: '⚠️',
        title: `Admin access from ${unknownAdminAccess.length} unfamiliar IP${unknownAdminAccess.length > 1 ? 's' : ''}`,
        detail: entries.join(', '),
        recommendation: 'If this is you on a new network (VPN, mobile, coffee shop), no action needed — this IP will become trusted after your next login. If not, change your password immediately.',
      });
    }

    // ── 4. Off-hours admin activity (only flag unknown IPs) ──
    const offHoursAdmin = await db.prepare(`
      SELECT user_email, user_id, ip_address, COUNT(*) as cnt
      FROM audit_log
      WHERE action = 'admin_access'
        AND created_at > NOW() - INTERVAL '24 hours'
        AND (EXTRACT(HOUR FROM created_at) < 6 OR EXTRACT(HOUR FROM created_at) > 22)
      GROUP BY user_email, user_id, ip_address
    `).all();
    // Only flag off-hours if it's from an unknown IP — trusted admin working late is normal
    const suspiciousOffHours = offHoursAdmin.filter(r =>
      r.user_id && !trustedPairs.has(`${r.user_id}:${r.ip_address}`)
    );
    if (suspiciousOffHours.length > 0) {
      insights.push({
        type: 'warning',
        icon: '🌙',
        title: `Off-hours admin access from unknown IP`,
        detail: suspiciousOffHours.map(a => `${a.user_email || 'unknown'} from ${a.ip_address} (${a.cnt}x between 10PM–6AM)`).join(', '),
        recommendation: 'Off-hours access from an unrecognized IP warrants extra scrutiny. Verify this was intentional.',
      });
    }

    // ── 5. Unique IP surge ──
    const ipsNow = await db.prepare(`
      SELECT COUNT(DISTINCT ip_address) as cnt FROM audit_log WHERE created_at > NOW() - INTERVAL '24 hours'
    `).get();
    const ipsPrev = await db.prepare(`
      SELECT COUNT(DISTINCT ip_address) as cnt FROM audit_log
      WHERE created_at BETWEEN NOW() - INTERVAL '48 hours' AND NOW() - INTERVAL '24 hours'
    `).get();
    const ips24 = Number(ipsNow?.cnt || 0);
    const ipsPrev24 = Number(ipsPrev?.cnt || 0);
    if (ipsPrev24 > 0 && ips24 > ipsPrev24 * 2 && ips24 >= 5) {
      insights.push({
        type: 'warning',
        icon: '🌐',
        title: `IP surge: ${ips24} unique IPs today (was ${ipsPrev24} yesterday)`,
        detail: `Unique IP addresses more than doubled. Could be organic traffic or distributed scanning.`,
        recommendation: 'Cross-reference with the failed login IPs above. If most new IPs are hitting /api/auth/login, it\'s likely a distributed brute force attack.',
      });
    }

    // ── 6. Most active endpoints (only flag if suspicious) ──
    const hotEndpoints = await db.prepare(`
      SELECT endpoint, COUNT(*) as cnt, COUNT(DISTINCT ip_address) as ips
      FROM audit_log
      WHERE created_at > NOW() - INTERVAL '24 hours' AND endpoint IS NOT NULL
      GROUP BY endpoint ORDER BY cnt DESC LIMIT 5
    `).all();
    const endpointTotal = hotEndpoints.reduce((s, r) => s + Number(r.cnt), 0);
    if (hotEndpoints.length > 0 && endpointTotal > 0) {
      const top = hotEndpoints[0];
      const topPct = Math.round((Number(top.cnt) / endpointTotal) * 100);
      if (topPct > 60 && Number(top.cnt) > 20) {
        const isSingleIP = Number(top.ips) === 1;
        insights.push({
          type: isSingleIP ? 'warning' : 'info',
          icon: isSingleIP ? '🤖' : '🎯',
          title: `${top.endpoint} is ${topPct}% of traffic${isSingleIP ? ' (single IP)' : ''}`,
          detail: `${top.cnt} hits from ${top.ips} IP${Number(top.ips) > 1 ? 's' : ''}.`,
          recommendation: isSingleIP ? 'Single IP hammering one endpoint looks automated. Consider rate limiting this endpoint.' : null,
        });
      }
    }

    // ── 7. Overall volume trend (keep, but lower priority) ──
    const volNow = await db.prepare(`
      SELECT COUNT(*) as cnt FROM audit_log WHERE created_at > NOW() - INTERVAL '24 hours'
    `).get();
    const volPrev = await db.prepare(`
      SELECT COUNT(*) as cnt FROM audit_log
      WHERE created_at BETWEEN NOW() - INTERVAL '48 hours' AND NOW() - INTERVAL '24 hours'
    `).get();
    const now24 = Number(volNow?.cnt || 0);
    const prev24 = Number(volPrev?.cnt || 0);
    if (prev24 > 0) {
      const pctChange = Math.round(((now24 - prev24) / prev24) * 100);
      if (pctChange > 50) {
        insights.push({
          type: 'info',
          icon: '📈',
          title: `Overall activity up ${pctChange}% vs yesterday`,
          detail: `${now24} total events in the last 24h compared to ${prev24} yesterday. This is informational — check the items above for anything that needs action.`,
        });
      }
    }

    // ── 8. All-clear positive signal ──
    const critInsights = insights.filter(i => i.type === 'critical');
    const warnInsights = insights.filter(i => i.type === 'warning');
    if (critInsights.length === 0 && warnInsights.length === 0 && genuineCritical.length === 0) {
      // Only add if we don't already have a positive insight
      if (!insights.some(i => i.type === 'positive')) {
        insights.push({ type: 'positive', icon: '🟢', title: 'System looks healthy', detail: 'No suspicious activity detected. All admin access is from known IPs and there are no unusual patterns.' });
      }
    }

    // ── Health score — based on genuine threats only ──
    const critCount = critInsights.length;
    const warnCount = warnInsights.length;
    const posCount = insights.filter(i => i.type === 'positive').length;
    let healthScore, healthLabel, healthColor;
    if (critCount > 0) { healthScore = Math.max(20, 50 - critCount * 15 - warnCount * 5); healthLabel = 'Needs Attention'; healthColor = '#c62828'; }
    else if (warnCount > 2) { healthScore = 65 - warnCount * 3; healthLabel = 'Fair'; healthColor = '#e65100'; }
    else if (warnCount > 0) { healthScore = 80 - warnCount * 5; healthLabel = 'Good'; healthColor = '#2e7d32'; }
    else { healthScore = 90 + posCount * 2; healthLabel = 'Excellent'; healthColor = '#1b6b5a'; }
    healthScore = Math.min(100, Math.max(0, healthScore));

    // Sort: critical first, then warning, then info, then positive
    const typeOrder = { critical: 0, warning: 1, info: 2, positive: 3 };
    insights.sort((a, b) => (typeOrder[a.type] ?? 9) - (typeOrder[b.type] ?? 9));

    res.json({
      insights,
      health: { score: healthScore, label: healthLabel, color: healthColor },
      trustedContext: {
        trustedAdminIPs: trustedRows.map(r => ({ email: r.user_email, ip: r.ip_address })),
        filteredNoiseCount: trustedAdminNoise.length,
      },
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Security insights error:", err);
    res.status(500).json({ error: "Failed to generate security insights" });
  }
});
};
