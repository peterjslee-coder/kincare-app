// ─── Audit Logging Middleware ───
// Logs access to sensitive endpoints for security monitoring.
// Writes to the audit_log table asynchronously (non-blocking).

const { getDb } = require("../models/database");

// Endpoints that should be audit-logged, with severity and action labels
const SENSITIVE_PATTERNS = [
  // Admin write operations — higher sensitivity
  { pattern: /^\/api\/admin/, method: "POST|PUT|PATCH|DELETE", action: "admin_write", severity: "warn" },
  // Admin reads — normal info (loading dashboard, stats, etc.)
  { pattern: /^\/api\/admin/, action: "admin_access", severity: "info" },
  // Auth events
  { pattern: /^\/api\/auth\/login/, action: "login_attempt", severity: "info" },
  { pattern: /^\/api\/auth\/register/, action: "registration", severity: "info" },
  { pattern: /^\/api\/auth\/passkey/, action: "passkey_auth", severity: "info" },
  { pattern: /^\/api\/auth\/reset/, action: "password_reset", severity: "warn" },
  // Sensitive data access
  { pattern: /^\/api\/caregivers\/.*\/profile/, action: "caregiver_profile_access", severity: "info" },
  { pattern: /^\/api\/care-recipients/, action: "care_recipient_access", severity: "info" },
  { pattern: /^\/api\/sessions\/.*\/(cancel|claim|check-in|check-out|checkout|review)/, action: "session_action", severity: "info" },
  // Accountability actions (nobody-home / no-show / disputes) — evidence-relevant
  { pattern: /^\/api\/accountability\/(family-no-show|late-resolution|dispute)/, action: "accountability_action", severity: "warn" },
  // Document writes (upload, delete, review) — higher sensitivity
  { pattern: /^\/api\/documents/, method: "POST|PUT|DELETE", action: "document_write", severity: "warn" },
  // Document reads — normal info
  { pattern: /^\/api\/documents/, action: "document_access", severity: "info" },
  { pattern: /^\/api\/onboarding/, action: "onboarding_data", severity: "info" },
];

// Track failed login attempts in memory for anomaly detection
const failedLogins = new Map(); // ip -> { count, firstAt, lastAt }
const FAILED_LOGIN_WINDOW = 15 * 60 * 1000; // 15 minutes
const FAILED_LOGIN_THRESHOLD = 10; // flag after 10 failures in window

function cleanFailedLogins() {
  const cutoff = Date.now() - FAILED_LOGIN_WINDOW;
  for (const [ip, data] of failedLogins) {
    if (data.lastAt < cutoff) failedLogins.delete(ip);
  }
}

// Get real IP from proxy headers
function getClientIp(req) {
  return req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.headers["x-real-ip"] ||
    req.socket?.remoteAddress || "unknown";
}

// Non-blocking audit log write
async function writeAuditLog(entry) {
  try {
    const db = await getDb();
    await db.prepare(`
      INSERT INTO audit_log (user_id, user_email, user_role, action, endpoint, method, ip_address, user_agent, details, severity)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.userId || null,
      entry.userEmail || null,
      entry.userRole || null,
      entry.action,
      entry.endpoint,
      entry.method,
      entry.ipAddress,
      entry.userAgent || null,
      entry.details ? JSON.stringify(entry.details) : null,
      entry.severity || "info"
    );
  } catch (err) {
    console.error("Audit log write error:", err.message);
  }
}

// Middleware: attach to Express app
function auditLogMiddleware(req, res, next) {
  const endpoint = req.originalUrl || req.url;
  const method = req.method;

  // Check if this endpoint matches a sensitive pattern (first match wins; method-specific patterns come first)
  const match = SENSITIVE_PATTERNS.find(p => {
    if (!p.pattern.test(endpoint)) return false;
    if (p.method && !p.method.split('|').includes(method)) return false;
    return true;
  });
  if (!match) return next();

  // Capture response status to log after response completes
  const startTime = Date.now();
  const originalEnd = res.end;
  res.end = function (...args) {
    const duration = Date.now() - startTime;
    const statusCode = res.statusCode;
    const ip = getClientIp(req);

    let severity = match.severity;
    let details = { statusCode, durationMs: duration };

    // Escalate severity for failures
    if (statusCode >= 400) {
      severity = statusCode >= 500 ? "error" : "warn";
    }

    // Track failed logins for anomaly detection
    if (match.action === "login_attempt" && statusCode >= 400) {
      cleanFailedLogins();
      const existing = failedLogins.get(ip) || { count: 0, firstAt: Date.now(), lastAt: 0 };
      existing.count++;
      existing.lastAt = Date.now();
      failedLogins.set(ip, existing);

      if (existing.count >= FAILED_LOGIN_THRESHOLD) {
        severity = "critical";
        details.failedLoginCount = existing.count;
        details.failedLoginWindow = `${Math.round((existing.lastAt - existing.firstAt) / 1000)}s`;
        details.anomaly = "brute_force_suspect";
      }
    }

    // Flag admin access outside normal hours (midnight-5am UTC)
    const hour = new Date().getUTCHours();
    if (match.action === "admin_access" && (hour >= 4 && hour < 9)) {
      // This is ~midnight-5am Eastern — unusual for admin activity
      details.anomaly = details.anomaly || "off_hours_admin_access";
      severity = severity === "info" ? "warn" : severity;
    }

    // Write audit log asynchronously
    writeAuditLog({
      userId: req.user?.id || null,
      userEmail: req.user?.email || null,
      userRole: req.user?.role || req.user?.activeRole || null,
      action: match.action,
      endpoint: endpoint.split("?")[0], // strip query params
      method,
      ipAddress: ip,
      userAgent: (req.headers["user-agent"] || "").substring(0, 200),
      details,
      severity,
    });

    originalEnd.apply(res, args);
  };

  next();
}

// Export for use in admin endpoints
module.exports = { auditLogMiddleware, writeAuditLog, getClientIp, failedLogins };
