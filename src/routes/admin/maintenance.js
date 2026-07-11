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

// ═══════════════════════════════════════════════════════════
// GET /api/admin/backup — Download full database backup as SQL
// Admin-only. Returns a .sql file with all table data.
// ═══════════════════════════════════════════════════════════
router.get("/backup", authenticate, requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const filename = `inplace-backup-${timestamp}.sql`;

    // Get all table names
    const tables = await db.prepare(`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
    `).all();

    let sql = `-- InPlace Database Backup\n-- Generated: ${new Date().toISOString()}\n-- Tables: ${tables.length}\n\n`;

    for (const { tablename } of tables) {
      // Get column info
      const cols = await db.prepare(`
        SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ?
        ORDER BY ordinal_position
      `).all(tablename);

      const colNames = cols.map(c => c.column_name);

      // Get all rows
      const rows = await db.prepare(`SELECT * FROM "${tablename}"`).all();

      sql += `-- Table: ${tablename} (${rows.length} rows)\n`;

      if (rows.length > 0) {
        for (const row of rows) {
          const values = colNames.map(col => {
            const val = row[col];
            if (val === null || val === undefined) return "NULL";
            if (typeof val === "boolean") return val ? "TRUE" : "FALSE";
            if (typeof val === "number") return String(val);
            if (val instanceof Date) return `'${val.toISOString()}'`;
            // Escape single quotes in strings
            return `'${String(val).replace(/'/g, "''")}'`;
          });
          sql += `INSERT INTO "${tablename}" (${colNames.map(c => `"${c}"`).join(", ")}) VALUES (${values.join(", ")});\n`;
        }
      }
      sql += "\n";
    }

    res.setHeader("Content-Type", "application/sql");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(sql);
  } catch (err) {
    console.error("Backup error:", err);
    res.status(500).json({ error: "Backup failed: " + err.message });
  }
});

// ─── POST /api/admin/backfill-assignments ───
// One-time backfill: create caregiver_assignments for any caregiver who has
// confirmed/completed sessions with a care recipient but no assignment record.
router.post("/backfill-assignments", async (req, res) => {
  try {
    const db = await getDb();
    // Find caregiver+recipient+family combos with sessions but no assignment
    const missing = await db.prepare(`
      SELECT DISTINCT cs.caregiver_id AS caregiver_profile_id,
        cs.care_recipient_id, cs.family_user_id
      FROM care_sessions cs
      WHERE cs.caregiver_id IS NOT NULL
        AND cs.status IN ('confirmed', 'in_progress', 'completed')
        AND NOT EXISTS (
          SELECT 1 FROM caregiver_assignments ca
          WHERE ca.caregiver_profile_id = cs.caregiver_id
            AND ca.care_recipient_id = cs.care_recipient_id
            AND ca.family_user_id = cs.family_user_id
        )
    `).all();

    let created = 0;
    for (const row of missing) {
      await db.prepare(`
        INSERT INTO caregiver_assignments (id, care_recipient_id, family_user_id, caregiver_profile_id, is_active, is_favorite)
        VALUES (?, ?, ?, ?, 1, 0)
      `).run(uuid(), row.care_recipient_id, row.family_user_id, row.caregiver_profile_id);
      created++;
      console.log(`[backfill] Created assignment: caregiver ${row.caregiver_profile_id.slice(0,8)} → recipient ${row.care_recipient_id.slice(0,8)} (family ${row.family_user_id.slice(0,8)})`);
    }

    res.json({ success: true, created, missing: missing.length });
  } catch (err) {
    console.error("Backfill assignments error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/admin/client-versions ───
// Returns all active users with their client version info (web/iOS/Android, app_version, platform)
router.get("/client-versions", authenticate, checkAdmin, requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const data = await db.prepare(`
      SELECT
        u.id, u.first_name, u.last_name, u.email, u.role, u.roles,
        uci.app_version, uci.user_agent, uci.platform, uci.last_seen_at
      FROM users u
      LEFT JOIN user_client_info uci ON u.id = uci.user_id
      WHERE u.is_active = 1
      ORDER BY uci.last_seen_at DESC NULLS LAST
    `).all();
    res.json({ users: data });
  } catch (err) {
    console.error("Client versions error:", err);
    res.status(500).json({ error: err.message });
  }
});
};
