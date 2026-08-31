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

// ─── GET /api/admin/users/:id/reachability ───
//
// v1.105.144. "Did it actually ring?" has been unanswerable all week, and every attempt to
// answer it has been inference from one field. Pete: "julia's definitely not on the PWA, but
// on the ios version" — while `user_client_info.platform` says "web" for her, which is either
// a bug in how the native app reports itself or a stale row from a browser session. Either
// way, guessing is how the last three wrong answers happened.
//
// This is the question stated properly: what would a call to this person actually reach?
// Devices, kinds, and whether each one has EVER worked — a subscription that has never had a
// success is a subscription that does not exist, no matter how good the row looks.
//
// No tokens or endpoints are returned. A push token is a credential for someone's phone; the
// kind and the dates are what a diagnosis needs.
router.get("/users/:id/reachability", authenticate, checkAdmin, requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const user = await db.prepare(
      "SELECT id, first_name, last_name, email FROM users WHERE id = ?"
    ).get(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    const client = await db.prepare(
      "SELECT app_version, user_agent, platform, last_seen_at FROM user_client_info WHERE user_id = ?"
    ).get(req.params.id);

    const subs = await db.prepare(`
      SELECT endpoint, fail_count, last_success_at, last_failure_at, created_at, updated_at
      FROM push_subscriptions WHERE user_id = ? ORDER BY created_at
    `).all(req.params.id);

    const devices = subs.map((s) => {
      const ep = String(s.endpoint || "");
      // native://ios/<token> and native://android/<token> — anything else is Web Push.
      // v1.105.151 — one definition, shared with /api/push/status and the client's self-repair.
      // v1.105.155 — WHICH push service, so a browser subscription can be placed. Apple's is
      // Safari or an iOS home-screen app; Google's is Chrome, and usually a laptop. "web" on
      // its own could not tell Pete's iPhone from his Mac, which is the exact question he was
      // asking. Host only — never the token.
      let service = null;
      try { service = ep.startsWith("http") ? new URL(ep).host : null; } catch { service = null; }
      return {
        kind: require("../../utils/pushDevices").deviceKind(ep),
        service,
        // Enough to tell two rows apart in a support conversation, and useless to anyone else.
        ref: ep.slice(-6),
        failCount: s.fail_count || 0,
        everWorked: !!s.last_success_at,
        lastSuccessAt: s.last_success_at,
        lastFailureAt: s.last_failure_at,
        createdAt: s.created_at,
      };
    });

    const usable = devices.filter((d) => d.failCount < 5);
    const summary = !devices.length
      ? "no devices registered — a call can only be answered if they happen to be in the app"
      : usable.some((d) => d.kind === "ios" || d.kind === "android")
        ? `native push should reach them (${usable.filter((d) => d.kind !== "web").length} device(s))`
        : "only Web Push is registered — inside the native iOS app that arrives nowhere";

    res.json({
      user: { id: user.id, name: `${user.first_name || ""} ${user.last_name || ""}`.trim(), email: user.email },
      client: client || null,
      devices,
      summary,
    });
  } catch (err) {
    console.error("Reachability error:", err);
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
