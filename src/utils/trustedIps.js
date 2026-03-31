// ─── Trusted Admin IP Management ───
// Tracks which IPs are verified as belonging to admin users.
// IPs get added on successful login/passkey auth for admin accounts.
// Unknown IPs trigger a passkey re-verification challenge.

const { getDb } = require("../models/database");

/**
 * Register an IP as trusted for an admin user.
 * Uses UPSERT so repeated logins just update last_seen_at.
 */
async function registerTrustedIp(userId, ipAddress, { userAgent, verifiedVia = "login", label } = {}) {
  try {
    const db = await getDb();
    // Check if user is admin
    const user = await db.prepare("SELECT role FROM users WHERE id = ?").get(userId);
    if (!user || user.role !== "admin") return false;

    await db.prepare(`
      INSERT INTO trusted_admin_ips (user_id, ip_address, user_agent, label, verified_via, last_seen_at, expires_at)
      VALUES (?, ?, ?, ?, ?, NOW(), NOW() + INTERVAL '90 days')
      ON CONFLICT (user_id, ip_address)
      DO UPDATE SET last_seen_at = NOW(), expires_at = NOW() + INTERVAL '90 days',
        user_agent = COALESCE(EXCLUDED.user_agent, trusted_admin_ips.user_agent),
        verified_via = EXCLUDED.verified_via
    `).run(userId, ipAddress, userAgent || null, label || null, verifiedVia);

    return true;
  } catch (err) {
    console.error("registerTrustedIp error:", err.message);
    return false;
  }
}

/**
 * Check if an IP is trusted for a given admin user.
 * Returns the trust record if found and not expired, null otherwise.
 */
async function isTrustedIp(userId, ipAddress) {
  try {
    const db = await getDb();
    const row = await db.prepare(`
      SELECT * FROM trusted_admin_ips
      WHERE user_id = ? AND ip_address = ? AND expires_at > NOW()
    `).get(userId, ipAddress);
    return row || null;
  } catch (err) {
    console.error("isTrustedIp error:", err.message);
    return null;
  }
}

/**
 * Get all trusted IPs for a user (for admin panel display).
 */
async function getTrustedIps(userId) {
  try {
    const db = await getDb();
    return await db.prepare(`
      SELECT id, ip_address, user_agent, label, verified_via, created_at, last_seen_at, expires_at
      FROM trusted_admin_ips
      WHERE user_id = ? AND expires_at > NOW()
      ORDER BY last_seen_at DESC
    `).all(userId);
  } catch (err) {
    console.error("getTrustedIps error:", err.message);
    return [];
  }
}

/**
 * Remove a trusted IP (manual revocation).
 */
async function removeTrustedIp(userId, ipId) {
  try {
    const db = await getDb();
    const result = await db.prepare(
      "DELETE FROM trusted_admin_ips WHERE id = ? AND user_id = ?"
    ).run(ipId, userId);
    return result.changes > 0;
  } catch (err) {
    console.error("removeTrustedIp error:", err.message);
    return false;
  }
}

module.exports = { registerTrustedIp, isTrustedIp, getTrustedIps, removeTrustedIp };
