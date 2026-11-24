// Shared helpers/state for the admin route modules (split from routes/admin.js,
// v1.92.0, tier-2 #3). Everything here is verbatim from the original header.
// The passkey challenge store MUST stay a single instance — challenge and
// verify endpoints live in different modules.
const { v4: uuid } = require("uuid");
const { getDb } = require("../../models/database");

// Passkey config (matches passkeys.js)
const RP_ID = process.env.RP_ID || (process.env.APP_URL ? new URL(process.env.APP_URL).hostname : "yourinplace.com");
const ORIGIN = process.env.APP_URL || "https://yourinplace.com";

// In-memory challenge store for passkey-protected actions (short-lived, 2-min TTL)
const passkeyChallenges = new Map();
function setPasskeyChallenge(key, value) {
  passkeyChallenges.set(key, { value, expires: Date.now() + 2 * 60 * 1000 });
  for (const [k, v] of passkeyChallenges) {
    if (v.expires < Date.now()) passkeyChallenges.delete(k);
  }
}
function getPasskeyChallenge(key) {
  const entry = passkeyChallenges.get(key);
  if (!entry) return null;
  passkeyChallenges.delete(key); // one-time use
  if (entry.expires < Date.now()) return null;
  return entry.value;
}
// Aliases for backward compat
const setNukeChallenge = setPasskeyChallenge;
const getNukeChallenge = getPasskeyChallenge;


// v1.81.0 — one correct way to exclude demo sessions from admin surfaces.
// A session is "demo" when its family OR its caregiver is a demo user.
// (The previous inline version used cs.family_id — a column that doesn't exist —
// and compared caregiver_profiles.id to users.id; it threw and was silently caught.)
const NOT_DEMO_SESSION = (alias = "cs") => `NOT EXISTS (
  SELECT 1 FROM users du
  WHERE COALESCE(du.is_demo, 0) = 1
    AND (du.id = ${alias}.family_user_id
         OR du.id = (SELECT cp_d.user_id FROM caregiver_profiles cp_d WHERE cp_d.id = ${alias}.caregiver_id))
)`;


// v1.74.2 — parse stored JSON defensively: a single malformed row must not 500 an endpoint
function safeJson(raw, fallback) {
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}


// ─── Audit log helper ───
async function logAdminAction(req, action, targetType, targetId, details) {
  try {
    const db = await getDb();
    await db.prepare(
      "INSERT INTO admin_audit_log (id, admin_user_id, action, target_type, target_id, details, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(uuid(), req.user.id, action, targetType || null, targetId || null, details ? JSON.stringify(details) : null, req.ip || req.headers['x-forwarded-for'] || null);
  } catch (err) {
    console.error("Audit log error:", err.message);
  }
}

// ─── Admin check middleware ───
// Runs after authenticate, looks up is_admin from DB and sets req.isAdmin
async function checkAdmin(req, res, next) {
  // API key auth already sets isAdmin — skip DB lookup
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

module.exports = {
  RP_ID, ORIGIN,
  setPasskeyChallenge, getPasskeyChallenge, setNukeChallenge, getNukeChallenge,
  NOT_DEMO_SESSION, safeJson, logAdminAction, checkAdmin,
};
