/**
 * Per-account daily usage caps that survive a restart (v1.106.5).
 *
 * The iPAi quota was a `Map` in process memory. Every deploy reset it, and Pete deploys several
 * times a day — so "30 messages per day" was really "30 messages per deploy", and the paid
 * Anthropic calls behind it had no durable ceiling at all. The same shape would have applied to
 * upload quotas, so both live here.
 *
 * Keyed on the ACCOUNT rather than the IP on purpose: an IP is shared by a family behind one
 * router and rotated freely by anyone who wants to, whereas the thing actually being spent —
 * our money, our disk — is spent per account.
 */
const { getDb } = require("../models/database");

/**
 * Count one use against a daily cap, atomically.
 *
 * The INSERT ... ON CONFLICT DO UPDATE is one statement so two concurrent requests cannot both
 * read 29 and both write 30. It returns the post-increment count, which is what decides.
 *
 * Fails OPEN on a database error: a counter is a cost control, and refusing a caregiver's
 * message because a counter table was briefly unavailable is the worse outcome. The error is
 * reported so a persistent failure is visible rather than silently unlimited.
 *
 * @returns {Promise<{allowed: boolean, used: number, remaining: number, limit: number}>}
 */
async function consumeDaily(userId, kind, limit) {
  if (!userId || !kind) return { allowed: true, used: 0, remaining: limit, limit };
  try {
    const db = await getDb();
    const row = await db.prepare(`
      INSERT INTO usage_counters (user_id, kind, day, count)
      VALUES (?, ?, CURRENT_DATE, 1)
      ON CONFLICT (user_id, kind, day)
      DO UPDATE SET count = usage_counters.count + 1
      RETURNING count
    `).get(userId, kind);
    const used = Number(row?.count || 1);
    return { allowed: used <= limit, used, remaining: Math.max(0, limit - used), limit };
  } catch (err) {
    try {
      require("./sentry").captureException(err, { where: `usageLimits: ${kind}` });
    } catch { /* sentry optional */ }
    return { allowed: true, used: 0, remaining: limit, limit };
  }
}

/** Read the count without spending one — for showing "3 left today" without consuming it. */
async function peekDaily(userId, kind, limit) {
  try {
    const db = await getDb();
    const row = await db.prepare(
      "SELECT count FROM usage_counters WHERE user_id = ? AND kind = ? AND day = CURRENT_DATE"
    ).get(userId, kind);
    const used = Number(row?.count || 0);
    return { used, remaining: Math.max(0, limit - used), limit };
  } catch {
    return { used: 0, remaining: limit, limit };
  }
}

/**
 * Count N units (bytes) against a daily cap. Same atomic upsert as consumeDaily.
 */
async function consumeDailyAmount(userId, kind, amount, limit) {
  if (!userId || !kind || !(amount > 0)) return { allowed: true, used: 0, remaining: limit, limit };
  try {
    const db = await getDb();
    const row = await db.prepare(`
      INSERT INTO usage_counters (user_id, kind, day, count)
      VALUES (?, ?, CURRENT_DATE, ?)
      ON CONFLICT (user_id, kind, day)
      DO UPDATE SET count = usage_counters.count + ?
      RETURNING count
    `).get(userId, kind, Math.ceil(amount), Math.ceil(amount));
    const used = Number(row?.count || amount);
    return { allowed: used <= limit, used, remaining: Math.max(0, limit - used), limit };
  } catch (err) {
    try { require("./sentry").captureException(err, { where: `usageLimits: ${kind}` }); } catch {}
    return { allowed: true, used: 0, remaining: limit, limit };
  }
}

/**
 * Express middleware: a per-account daily ceiling on uploaded bytes (v1.106.5).
 *
 * The review's top takedown vector was filling the Postgres volume — the outage that actually
 * happened on Sept 2, but on purpose. Rate limits alone do not stop it, because the damage is
 * measured in bytes and not in requests: 5 MB at a permitted rate still fills 50 GB in under
 * two hours. This is the control that does stop it.
 *
 * Measured with Content-Length, so it covers base64 JSON bodies and multipart uploads with one
 * rule, and it is counted BEFORE the body is parsed or stored.
 *
 * Mount AFTER authenticate — it needs to know whose day it is.
 */
const DEFAULT_DAILY_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB/day: no honest user comes close

function uploadQuota(limitBytes = DEFAULT_DAILY_UPLOAD_BYTES) {
  return async function uploadQuotaMiddleware(req, res, next) {
    try {
      if (!["POST", "PUT", "PATCH"].includes(req.method)) return next();
      const bytes = Number(req.headers["content-length"] || 0);
      if (!bytes) return next();
      if (!req.user?.id) return next();
      const r = await consumeDailyAmount(req.user.id, "upload_bytes", bytes, limitBytes);
      if (!r.allowed) {
        return res.status(429).json({
          error: "You've reached today's upload limit. It resets at midnight — if you need more, contact support.",
          uploadLimitReached: true,
        });
      }
      return next();
    } catch { return next(); }
  };
}

module.exports = { consumeDaily, consumeDailyAmount, peekDaily, uploadQuota, DEFAULT_DAILY_UPLOAD_BYTES };
