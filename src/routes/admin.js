const express = require("express");
const { v4: uuid } = require("uuid");
const { getDb } = require("../models/database");
const { authenticate, requireAdmin } = require("../middleware/auth");
const authRouter = require("./auth");
const { sendVerificationEmail } = authRouter;
const {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require("@simplewebauthn/server");

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

const router = express.Router();

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

const { isTrustedIp, registerTrustedIp, getTrustedIps, removeTrustedIp } = require("../utils/trustedIps");
const { getClientIp, writeAuditLog } = require("../middleware/auditLog");

// All admin routes require auth + admin check + admin flag
router.use(authenticate, checkAdmin, requireAdmin);

// ─── IP Trust Verification Middleware ───
// Checks if admin is on a trusted IP. If not, requires passkey re-verification.
// Exempts the IP-verification challenge/verify endpoints themselves.
const IP_CHECK_EXEMPT = [
  "/ip-verify/challenge",
  "/ip-verify/verify",
  "/ip-verify/status",
  "/security/trusted-ips",
];

router.use(async (req, res, next) => {
  const path = req.path;
  // Skip IP check for exempt endpoints
  if (IP_CHECK_EXEMPT.some(p => path === p || path.startsWith(p))) return next();

  try {
    const ip = getClientIp(req);
    const trusted = await isTrustedIp(req.user.id, ip);
    if (trusted) {
      req.trustedIp = true;
      return next();
    }

    // Bootstrap: if NO admin has ANY trusted IPs yet, auto-trust this admin
    // (fresh deploy / empty table — can't lock everyone out)
    const db = await getDb();
    const anyTrusted = await db.prepare("SELECT COUNT(*) as cnt FROM trusted_admin_ips").get();
    if (!anyTrusted || Number(anyTrusted.cnt) === 0) {
      await registerTrustedIp(req.user.id, ip, {
        userAgent: (req.headers["user-agent"] || "").substring(0, 200),
        verifiedVia: "bootstrap_first_admin",
      });
      console.log(`  [ip-trust] Bootstrap: auto-trusted ${req.user.email} at ${ip} (empty trusted_admin_ips table)`);
      req.trustedIp = true;
      return next();
    }

    // Unknown IP — require passkey verification
    return res.status(403).json({
      error: "Admin access from an unrecognized network. Please verify your identity with a passkey.",
      code: "IP_VERIFICATION_REQUIRED",
      ip: ip,
    });
  } catch (err) {
    // If IP check itself fails (DB error, table missing, etc.), don't lock out admin
    console.error("IP trust check error (allowing through):", err.message);
    return next();
  }
});

// ─── POST /api/admin/impersonate/:userId/challenge — Passkey challenge before impersonation ───
router.post("/impersonate/:userId/challenge", async (req, res) => {
  try {
    const db = await getDb();
    const target = await db.prepare(
      "SELECT id, first_name, last_name, is_active, is_admin FROM users WHERE id = ?"
    ).get(req.params.userId);
    if (!target) return res.status(404).json({ error: "User not found" });
    if (!target.is_active) return res.status(400).json({ error: "User is deactivated" });
    if (target.is_admin) return res.status(400).json({ error: "Cannot impersonate another admin" });

    const allPasskeys = await db.prepare(
      "SELECT credential_id, transports FROM user_passkeys WHERE user_id = ?"
    ).all(req.user.id);

    if (allPasskeys.length === 0) {
      // No passkeys registered — allow without verification but log it
      console.warn(`[admin] Impersonation challenge: no passkeys on file for admin ${req.user.id.slice(0,8)}, granting bypass`);
      const bypassKey = `impersonate_bypass_${req.user.id}_${req.params.userId}`;
      setPasskeyChallenge(bypassKey, { bypass: true, targetId: req.params.userId });
      return res.json({ noPasskey: true, _challengeKey: bypassKey });
    }

    const allowCredentials = allPasskeys.map(pk => ({
      id: pk.credential_id,
      transports: pk.transports ? JSON.parse(pk.transports) : undefined,
    }));

    const options = await generateAuthenticationOptions({
      rpID: RP_ID,
      allowCredentials,
      userVerification: "required",
    });

    const challengeKey = `impersonate_${req.user.id}_${req.params.userId}`;
    setPasskeyChallenge(challengeKey, {
      challenge: options.challenge,
      targetId: req.params.userId,
    });

    res.json({ ...options, _challengeKey: challengeKey });
  } catch (err) {
    console.error("Impersonate challenge error:", err);
    res.status(500).json({ error: "Failed to generate challenge" });
  }
});

// ─── POST /api/admin/impersonate/:userId — View app as another user (test mode) ───
// Requires passkey verification (or bypass if no passkeys registered).
// Generates a short-lived JWT that lets admin see exactly what the target user sees.
// Sessions checked in/out while impersonating skip payment gates and flag visit logs as test.
router.post("/impersonate/:userId", async (req, res) => {
  try {
    const db = await getDb();
    const { _challengeKey } = req.body || {};

    // Verify passkey response
    if (!_challengeKey) {
      return res.status(400).json({ error: "Passkey verification required. Use /challenge first." });
    }
    const stored = getPasskeyChallenge(_challengeKey);
    if (!stored) {
      return res.status(400).json({ error: "Challenge expired. Please try again." });
    }
    if (stored.targetId !== req.params.userId) {
      return res.status(400).json({ error: "Challenge mismatch." });
    }

    // If not a bypass (admin has passkeys), verify the passkey response
    if (!stored.bypass) {
      const credentialIdB64 = req.body.id;
      const passkey = await db.prepare(
        "SELECT * FROM user_passkeys WHERE credential_id = ? AND user_id = ?"
      ).get(credentialIdB64, req.user.id);

      if (!passkey) {
        writeAuditLog({
          userId: req.user.id, userEmail: req.user.email, userRole: 'admin',
          action: 'impersonate_passkey_failed', endpoint: `/api/admin/impersonate/${req.params.userId}`,
          method: 'POST', ipAddress: getClientIp(req),
          userAgent: (req.headers["user-agent"] || "").substring(0, 200),
          details: { targetUserId: req.params.userId }, severity: 'critical',
        });
        return res.status(401).json({ error: "Passkey not recognized." });
      }

      const EXPECTED_ORIGINS = [ORIGIN, ORIGIN.replace('https://', 'android:apk-key-hash:')];
      const verification = await verifyAuthenticationResponse({
        response: req.body,
        expectedChallenge: stored.challenge,
        expectedOrigin: EXPECTED_ORIGINS,
        expectedRPID: RP_ID,
        credential: {
          id: passkey.credential_id,
          publicKey: Buffer.from(passkey.public_key, "base64url"),
          counter: passkey.counter || 0,
        },
      });

      if (!verification.verified) {
        return res.status(401).json({ error: "Passkey verification failed." });
      }

      // Update counter
      await db.prepare(
        "UPDATE user_passkeys SET counter = ? WHERE credential_id = ?"
      ).run(verification.authenticationInfo.newCounter, credentialIdB64);
    }

    // Passkey verified (or bypassed) — generate impersonation token
    const target = await db.prepare(
      "SELECT id, email, first_name, last_name, roles, role, is_active, is_admin FROM users WHERE id = ?"
    ).get(req.params.userId);
    if (!target) return res.status(404).json({ error: "User not found" });
    if (!target.is_active) return res.status(400).json({ error: "User is deactivated" });
    if (target.is_admin) return res.status(400).json({ error: "Cannot impersonate another admin" });

    let roles = target.roles
      ? (typeof target.roles === "string" ? JSON.parse(target.roles) : target.roles)
      : [target.role || "family"];

    const jwt = require("jsonwebtoken");
    const token = jwt.sign(
      { id: target.id, email: target.email, roles, role: roles[0], impersonatedBy: req.user.id },
      process.env.JWT_SECRET,
      { expiresIn: "2h" }
    );

    // Audit log
    writeAuditLog({
      userId: req.user.id, userEmail: req.user.email, userRole: 'admin',
      action: 'impersonate_start', endpoint: `/api/admin/impersonate/${req.params.userId}`,
      method: 'POST', ipAddress: getClientIp(req),
      userAgent: (req.headers["user-agent"] || "").substring(0, 200),
      details: { targetUserId: target.id, targetEmail: target.email, targetName: `${target.first_name} ${target.last_name}` },
      severity: 'warning',
    });

    console.log(`[admin] Impersonation started (passkey verified): admin ${req.user.id.slice(0,8)} → user ${target.id.slice(0,8)} (${target.first_name} ${target.last_name})`);

    res.json({
      token,
      user: {
        id: target.id, email: target.email,
        firstName: target.first_name, lastName: target.last_name,
        first_name: target.first_name, last_name: target.last_name,
        roles,
      },
    });
  } catch (err) {
    console.error("Impersonation error:", err);
    res.status(500).json({ error: "Failed to start impersonation" });
  }
});

// ─── POST /api/admin/ip-verify/challenge — Generate passkey challenge for IP verification ───
router.post("/ip-verify/challenge", async (req, res) => {
  try {
    const db = await getDb();
    const passkeys = await db.prepare(
      "SELECT credential_id, transports FROM user_passkeys WHERE user_id = ?"
    ).get(req.user.id);
    // Get all passkeys (not just first)
    const allPasskeys = await db.prepare(
      "SELECT credential_id, transports FROM user_passkeys WHERE user_id = ?"
    ).all(req.user.id);

    if (allPasskeys.length === 0) {
      // No passkeys registered — auto-trust this IP (fallback for password-only admins)
      const ip = getClientIp(req);
      await registerTrustedIp(req.user.id, ip, {
        userAgent: (req.headers["user-agent"] || "").substring(0, 200),
        verifiedVia: "auto_no_passkey",
      });
      return res.json({ autoTrusted: true, message: "IP trusted (no passkey on file — set one up for stronger security)." });
    }

    const allowCredentials = allPasskeys.map(pk => ({
      id: pk.credential_id,
      transports: pk.transports ? JSON.parse(pk.transports) : undefined,
    }));

    const { generateAuthenticationOptions } = require("@simplewebauthn/server");
    const options = await generateAuthenticationOptions({
      rpID: RP_ID,
      allowCredentials,
      userVerification: "required",
    });

    setPasskeyChallenge(`ip_verify_${req.user.id}`, {
      challenge: options.challenge,
      ip: getClientIp(req),
    });

    res.json(options);
  } catch (err) {
    console.error("IP verify challenge error:", err);
    res.status(500).json({ error: "Failed to generate verification challenge" });
  }
});

// ─── POST /api/admin/ip-verify/verify — Verify passkey response for IP trust ───
router.post("/ip-verify/verify", async (req, res) => {
  try {
    const stored = getPasskeyChallenge(`ip_verify_${req.user.id}`);
    if (!stored) {
      return res.status(400).json({ error: "Verification challenge expired. Please try again." });
    }

    const db = await getDb();
    const credentialIdB64 = req.body.id;
    const passkey = await db.prepare(
      "SELECT * FROM user_passkeys WHERE credential_id = ? AND user_id = ?"
    ).get(credentialIdB64, req.user.id);

    if (!passkey) {
      // Failed — flag this in audit log
      const ip = getClientIp(req);
      writeAuditLog({
        userId: req.user.id,
        userEmail: req.user.email,
        userRole: 'admin',
        action: 'ip_verify_failed',
        endpoint: '/api/admin/ip-verify/verify',
        method: 'POST',
        ipAddress: ip,
        userAgent: (req.headers["user-agent"] || "").substring(0, 200),
        details: { anomaly: 'ip_verify_passkey_not_found', ip },
        severity: 'critical',
      });
      return res.status(401).json({ error: "Passkey not recognized." });
    }

    const EXPECTED_ORIGINS = [
      ORIGIN,
      `android:apk-key-hash:${process.env.ANDROID_CERT_HASH || ""}`,
    ].filter(Boolean);

    const verification = await verifyAuthenticationResponse({
      response: req.body,
      expectedChallenge: stored.challenge,
      expectedOrigin: EXPECTED_ORIGINS,
      expectedRPID: RP_ID,
      credential: {
        id: passkey.credential_id,
        publicKey: Buffer.from(passkey.public_key, "base64url"),
        counter: passkey.counter,
        transports: passkey.transports ? JSON.parse(passkey.transports) : [],
      },
    });

    if (!verification.verified) {
      // Failed verification — flag it
      const ip = getClientIp(req);
      writeAuditLog({
        userId: req.user.id,
        userEmail: req.user.email,
        userRole: 'admin',
        action: 'ip_verify_failed',
        endpoint: '/api/admin/ip-verify/verify',
        method: 'POST',
        ipAddress: ip,
        userAgent: (req.headers["user-agent"] || "").substring(0, 200),
        details: { anomaly: 'ip_verify_passkey_failed', ip },
        severity: 'critical',
      });
      return res.status(401).json({ error: "Passkey verification failed. This attempt has been logged." });
    }

    // Update passkey counter
    await db.prepare(
      "UPDATE user_passkeys SET counter = ?, last_used = NOW() WHERE id = ?"
    ).run(verification.authenticationInfo.newCounter, passkey.id);

    // Register this IP as trusted
    const ip = getClientIp(req);
    await registerTrustedIp(req.user.id, ip, {
      userAgent: (req.headers["user-agent"] || "").substring(0, 200),
      verifiedVia: "passkey_ip_verify",
    });

    // Log success
    writeAuditLog({
      userId: req.user.id,
      userEmail: req.user.email,
      userRole: 'admin',
      action: 'ip_verified',
      endpoint: '/api/admin/ip-verify/verify',
      method: 'POST',
      ipAddress: ip,
      userAgent: (req.headers["user-agent"] || "").substring(0, 200),
      details: { ip, verified_via: 'passkey' },
      severity: 'info',
    });

    console.log(`  [ip-verify] Admin ${req.user.email} verified IP ${ip} via passkey`);
    res.json({ verified: true, ip, message: "IP verified and trusted for 90 days." });
  } catch (err) {
    console.error("IP verify error:", err);
    res.status(500).json({ error: "Verification failed" });
  }
});

// ─── GET /api/admin/ip-verify/status — Check if current IP is trusted ───
router.get("/ip-verify/status", async (req, res) => {
  const ip = getClientIp(req);
  const trusted = await isTrustedIp(req.user.id, ip);
  res.json({ trusted: !!trusted, ip, expiresAt: trusted?.expires_at || null });
});

// ─── GET /api/admin/security/trusted-ips — List all trusted IPs for this admin ───
router.get("/security/trusted-ips", async (req, res) => {
  const ips = await getTrustedIps(req.user.id);
  res.json({ trustedIps: ips });
});

// ─── DELETE /api/admin/security/trusted-ips/:id — Revoke a trusted IP ───
router.delete("/security/trusted-ips/:id", async (req, res) => {
  const removed = await removeTrustedIp(req.user.id, req.params.id);
  if (!removed) return res.status(404).json({ error: "Trusted IP not found" });
  res.json({ removed: true });
});

// ─── GET /api/admin/alerts — Lightweight count of items needing admin attention ───
// Returns raw counts + a "seen" snapshot so the client only badges NEW items
router.get("/alerts", async (req, res) => {
  try {
    const db = await getDb();
    const [pendingUsers, pausedCaregivers, pendingConsent, newFeedback, safetyFlags, checkrAlerts, recentReferrals, recentMilestones, userRow] = await Promise.all([
      db.prepare(`SELECT COUNT(*) as count FROM users WHERE COALESCE(is_demo, 0) = 0 AND COALESCE(account_approved, 0) = 0 AND COALESCE(is_active, 1) = 1 AND created_at > '2026-02-20'`).get(),
      db.prepare(`SELECT COUNT(*) as count FROM caregiver_profiles WHERE account_paused = 1 AND COALESCE(checkr_status, 'pending') != 'rejected'`).get(),
      db.prepare(`SELECT COUNT(*) as count FROM care_recipients WHERE consent_status = 'pending' OR consent_status = 'attestation_pending'`).get(),
      db.prepare(`SELECT COUNT(*) as count FROM feedback WHERE status = 'new' AND created_at > NOW() - INTERVAL '30 days'`).get(),
      db.prepare(`SELECT COUNT(*) as count FROM safety_flags WHERE status IN ('pending', 'escalated')`).get().catch(() => ({ count: 0 })),
      // Unread Checkr webhook events in the last 7 days
      db.prepare(`SELECT COUNT(*) as count FROM activity_feed WHERE event_type IN ('checkr_submitted', 'checkr_cleared', 'checkr_flagged', 'checkr_expired', 'checkr_suspended', 'checkr_resumed', 'checkr_disputed') AND is_read = 0 AND created_at > NOW() - INTERVAL '7 days'`).get().catch(() => ({ count: 0 })),
      // Referral stats (last 7 days)
      db.prepare(`SELECT COUNT(*) as count FROM referrals WHERE claimed_at > NOW() - INTERVAL '7 days' AND status = 'claimed'`).get().catch(() => ({ count: 0 })),
      // Recent milestones (last 7 days)
      db.prepare(`SELECT COUNT(*) as count FROM milestones WHERE created_at > NOW() - INTERVAL '7 days'`).get().catch(() => ({ count: 0 })),
      // Fetch admin's last-seen snapshot
      db.prepare(`SELECT admin_alerts_snapshot FROM users WHERE id = ?`).get(req.user.id).catch(() => null),
    ]);

    const counts = {
      pendingUsers: parseInt(pendingUsers.count) || 0,
      pausedCaregivers: parseInt(pausedCaregivers.count) || 0,
      pendingConsent: parseInt(pendingConsent.count) || 0,
      newFeedback: parseInt(newFeedback.count) || 0,
      safetyFlags: parseInt(safetyFlags.count) || 0,
      checkrAlerts: parseInt(checkrAlerts.count) || 0,
      recentReferrals: parseInt(recentReferrals.count) || 0,
      recentMilestones: parseInt(recentMilestones.count) || 0,
    };

    // Calculate delta from last-seen snapshot — only badge genuinely new items
    let seen = {};
    try { seen = JSON.parse(userRow?.admin_alerts_snapshot || '{}'); } catch {}
    const delta = {
      pendingUsers: Math.max(0, counts.pendingUsers - (seen.pendingUsers || 0)),
      pausedCaregivers: Math.max(0, counts.pausedCaregivers - (seen.pausedCaregivers || 0)),
      pendingConsent: Math.max(0, counts.pendingConsent - (seen.pendingConsent || 0)),
      newFeedback: Math.max(0, counts.newFeedback - (seen.newFeedback || 0)),
      safetyFlags: Math.max(0, counts.safetyFlags - (seen.safetyFlags || 0)),
      checkrAlerts: Math.max(0, counts.checkrAlerts - (seen.checkrAlerts || 0)),
    };

    const total = delta.pendingUsers + delta.pausedCaregivers + delta.pendingConsent +
      delta.newFeedback + delta.safetyFlags + delta.checkrAlerts;

    // Fetch caregivers with BG check results needing admin action
    const bgCheckActionItems = await db.prepare(`
      SELECT cp.user_id, cp.checkr_status, cp.is_background_checked, cp.bg_check_admin_approved,
        u.first_name, u.last_name, u.email, cp.updated_at
      FROM caregiver_profiles cp
      JOIN users u ON cp.user_id = u.id
      WHERE cp.checkr_status IN ('consider', 'adverse_action', 'disputed', 'suspended', 'did_not_pass')
        AND COALESCE(cp.is_background_checked, 0) = 0
        AND COALESCE(cp.bg_check_admin_approved, 0) = 0
        AND COALESCE(u.is_demo, 0) = 0
      ORDER BY cp.updated_at DESC
    `).all().catch(() => []);

    res.json({
      total,
      ...delta,
      // Raw counts for the snapshot when dismissing
      _raw: counts,
      // Caregivers with BG check results needing review
      bgCheckActionItems: bgCheckActionItems.map(c => ({
        userId: c.user_id,
        name: `${c.first_name} ${c.last_name}`,
        email: c.email,
        checkrStatus: c.checkr_status,
        updatedAt: c.updated_at,
      })),
    });
  } catch (err) {
    console.error("Admin alerts error:", err);
    res.status(500).json({ error: "Failed to load admin alerts" });
  }
});

// ─── POST /api/admin/alerts/dismiss-checkr — Mark Checkr alerts as read ───
router.post("/alerts/dismiss-checkr", async (req, res) => {
  try {
    const db = await getDb();
    await db.prepare(
      `UPDATE activity_feed SET is_read = 1 WHERE event_type IN ('checkr_submitted', 'checkr_cleared', 'checkr_flagged', 'checkr_expired', 'checkr_suspended', 'checkr_resumed', 'checkr_disputed') AND is_read = 0`
    ).run();
    res.json({ ok: true });
  } catch (err) {
    console.error("Dismiss checkr alerts error:", err);
    res.status(500).json({ error: "Failed to dismiss alerts" });
  }
});

// ─── POST /api/admin/alerts/dismiss-all — Save current counts as "seen" snapshot ───
// After this, only new items (counts that increase) will show in the badge
router.post("/alerts/dismiss-all", async (req, res) => {
  try {
    const db = await getDb();
    // Store snapshot of current counts on the user row
    const snapshot = JSON.stringify(req.body.snapshot || {});
    await db.prepare(
      "UPDATE users SET admin_alerts_snapshot = ?, admin_alerts_seen_at = NOW() WHERE id = ?"
    ).run(snapshot, req.user.id);
    // Also mark Checkr alerts as read
    await db.prepare(
      `UPDATE activity_feed SET is_read = 1 WHERE event_type IN ('checkr_submitted', 'checkr_cleared', 'checkr_flagged', 'checkr_expired', 'checkr_suspended', 'checkr_resumed', 'checkr_disputed') AND is_read = 0`
    ).run();
    res.json({ ok: true });
  } catch (err) {
    console.error("Dismiss all alerts error:", err);
    res.status(500).json({ error: "Failed to dismiss alerts" });
  }
});

// ─── GET /api/admin/stats — Platform overview metrics ───
router.get("/stats", async (req, res) => {
  try {
    const db = await getDb();

    // Wrap each core query individually so one failure doesn't crash the whole endpoint
    let users = { count: 0 }, waitlist = { count: 0 }, sessions = { count: 0 }, caregivers = { count: 0 }, recentSignups = [];
    try { users = await db.prepare("SELECT COUNT(*) as count FROM users WHERE COALESCE(is_demo, 0) = 0").get() || { count: 0 }; } catch (e) { console.error("Stats: users query failed:", e.message); }
    try { waitlist = await db.prepare("SELECT COUNT(*) as count FROM waitlist").get() || { count: 0 }; } catch (e) { console.error("Stats: waitlist query failed:", e.message); }
    try { sessions = await db.prepare("SELECT COUNT(*) as count FROM care_sessions cs WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id IN (cs.family_id, cs.caregiver_id) AND COALESCE(u.is_demo, 0) = 1)").get() || { count: 0 }; } catch (e) { console.error("Stats: sessions query failed:", e.message); }
    try { caregivers = await db.prepare("SELECT COUNT(*) as count FROM caregiver_profiles cp JOIN users u ON cp.user_id = u.id WHERE COALESCE(u.is_demo, 0) = 0").get() || { count: 0 }; } catch (e) { console.error("Stats: caregivers query failed:", e.message); }
    try {
      recentSignups = await db.prepare(`
        SELECT DATE(created_at) as date, COUNT(*) as count
        FROM users WHERE COALESCE(is_demo, 0) = 0
        AND created_at > NOW() - INTERVAL '30 days'
        GROUP BY DATE(created_at)
        ORDER BY date ASC
      `).all() || [];
    } catch (e) { console.error("Stats: recentSignups query failed:", e.message); }

    // Waitlist signups per day for last 30 days
    let waitlistTrend = [];
    try {
      waitlistTrend = await db.prepare(`
        SELECT DATE(created_at) as date, COUNT(*) as count
        FROM waitlist
        WHERE created_at > NOW() - INTERVAL '30 days'
        GROUP BY DATE(created_at)
        ORDER BY date ASC
      `).all() || [];
    } catch (e) { console.error("Stats: waitlistTrend query failed:", e.message); }

    // Sessions by status (excluding demo user sessions)
    let sessionsByStatus = [];
    try {
      sessionsByStatus = await db.prepare(`
        SELECT cs.status, COUNT(*) as count FROM care_sessions cs
        WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id IN (cs.family_id, cs.caregiver_id) AND COALESCE(u.is_demo, 0) = 1)
        GROUP BY cs.status
      `).all() || [];
    } catch (e) { console.error("Stats: sessionsByStatus query failed:", e.message); }

    // v1.53 — Enhanced stats for new admin dashboard
    let openTickets = { count: 0 }, safetyFlags = { count: 0 }, avgRating = { avg: 0, total: 0 }, revenueMtd = { total: 0 };
    try {
      openTickets = await db.prepare("SELECT COUNT(*) as count FROM admin_tickets WHERE status IN ('open', 'in_progress')").get() || { count: 0 };
    } catch (e) { /* table may not exist yet */ }
    try {
      safetyFlags = await db.prepare("SELECT COUNT(*) as count FROM safety_flags WHERE status IN ('pending', 'open', 'investigating', 'escalated')").get() || { count: 0 };
    } catch (e) { /* */ }
    let ratingDist = {};
    try {
      avgRating = await db.prepare("SELECT ROUND(AVG(r.rating), 1) as avg, COUNT(*) as total FROM reviews r JOIN users fu ON r.family_user_id = fu.id WHERE COALESCE(fu.is_demo, 0) = 0").get() || { avg: 0, total: 0 };
      const distRows = await db.prepare("SELECT r.rating, COUNT(*) as cnt FROM reviews r JOIN users fu ON r.family_user_id = fu.id WHERE COALESCE(fu.is_demo, 0) = 0 GROUP BY r.rating").all();
      for (const d of distRows) ratingDist[d.rating] = d.cnt;
    } catch (e) { /* */ }
    try {
      // Use care_sessions.estimated_cost (source of truth), exclude demo users on both sides
      revenueMtd = await db.prepare(`
        SELECT COALESCE(SUM(cs.estimated_cost), 0) as total
        FROM care_sessions cs
        JOIN users u ON cs.family_user_id = u.id
        WHERE cs.status = 'completed' AND cs.estimated_cost > 0
          AND COALESCE(u.is_demo, 0) = 0
          AND NOT EXISTS (SELECT 1 FROM caregiver_profiles _cp JOIN users _cu ON _cp.user_id = _cu.id WHERE _cp.id = cs.caregiver_id AND _cu.is_demo = 1)
          AND COALESCE(cs.completed_at, cs.updated_at, cs.created_at) >= date_trunc('month', NOW())
      `).get() || { total: 0 };
    } catch (e) { /* */ }
    let revenueYtd = { total: 0 };
    try {
      revenueYtd = await db.prepare(`
        SELECT COALESCE(SUM(cs.estimated_cost), 0) as total
        FROM care_sessions cs
        JOIN users u ON cs.family_user_id = u.id
        WHERE cs.status = 'completed' AND cs.estimated_cost > 0
          AND COALESCE(u.is_demo, 0) = 0
          AND NOT EXISTS (SELECT 1 FROM caregiver_profiles _cp JOIN users _cu ON _cp.user_id = _cu.id WHERE _cp.id = cs.caregiver_id AND _cu.is_demo = 1)
          AND COALESCE(cs.completed_at, cs.updated_at, cs.created_at) >= date_trunc('year', NOW())
      `).get() || { total: 0 };
    } catch (e) { /* */ }

    // Visits this week
    let visitsThisWeek = { count: 0 };
    try {
      visitsThisWeek = await db.prepare("SELECT COUNT(*) as count FROM care_sessions WHERE scheduled_date >= date_trunc('week', NOW())::date::text AND status NOT IN ('cancelled')").get() || { count: 0 };
    } catch (e) { /* */ }

    res.json({
      totalUsers: parseInt(users.count),
      totalWaitlist: parseInt(waitlist.count),
      totalSessions: parseInt(sessions.count),
      totalCaregivers: parseInt(caregivers.count),
      signupTrend: recentSignups,
      waitlistTrend,
      sessionsByStatus,
      // v1.53 additions
      openTickets: parseInt(openTickets.count || 0),
      safetyFlags: parseInt(safetyFlags.count || 0),
      avgRating: parseFloat(avgRating.avg || 0),
      totalReviews: parseInt(avgRating.total || 0),
      revenueMtd: parseFloat(revenueMtd.total || 0),
      revenueYtd: parseFloat(revenueYtd.total || 0),
      visitsThisWeek: parseInt(visitsThisWeek.count || 0),
      ratingDistribution: ratingDist,
    });
  } catch (err) {
    console.error("Admin stats error:", err);
    res.status(500).json({ error: "Failed to load stats" });
  }
});

// ─── GET /api/admin/users — All registered users ───
router.get("/users", async (req, res) => {
  try {
    const db = await getDb();
    const { search, role, sort = "created_at", order = "DESC", limit = 50, offset = 0 } = req.query;

    // Build query dynamically
    let sql = `
      SELECT id, email, role, first_name, last_name, phone, email_verified, is_demo, is_admin, admin_role, admin_notes, is_tester, is_active, companion_access, created_at, updated_at
      FROM users WHERE COALESCE(is_active, 1) = 1
    `;
    const params = [];

    if (search) {
      params.push(`%${search}%`, `%${search}%`);
      sql += ` AND (email ILIKE ? OR (first_name || ' ' || last_name) ILIKE ?)`;
    }
    if (role) {
      params.push(role);
      sql += ` AND role = ?`;
    }
    if (req.query.demo === 'demo') {
      sql += ` AND COALESCE(is_demo, 0) = 1`;
    } else if (req.query.demo === 'real' || !req.query.demo) {
      // Default: hide demo accounts unless explicitly requested
      sql += ` AND COALESCE(is_demo, 0) = 0`;
    }
    // demo=all → no filter (shows everything)

    // Validate sort column to prevent SQL injection
    const validSorts = ["created_at", "email", "first_name", "role"];
    const sortCol = validSorts.includes(sort) ? sort : "created_at";
    const sortOrder = order.toUpperCase() === "ASC" ? "ASC" : "DESC";
    sql += ` ORDER BY ${sortCol} ${sortOrder}`;

    params.push(parseInt(limit), parseInt(offset));
    sql += ` LIMIT ? OFFSET ?`;

    const users = await db.prepare(sql).all(...params);

    // Total count for pagination
    let countSql = "SELECT COUNT(*) as count FROM users WHERE COALESCE(is_active, 1) = 1";
    const countParams = [];
    if (search) {
      countParams.push(`%${search}%`, `%${search}%`);
      countSql += ` AND (email ILIKE ? OR (first_name || ' ' || last_name) ILIKE ?)`;
    }
    if (role) {
      countParams.push(role);
      countSql += ` AND role = ?`;
    }
    if (req.query.demo === 'demo') {
      countSql += ` AND COALESCE(is_demo, 0) = 1`;
    } else if (req.query.demo === 'real' || !req.query.demo) {
      countSql += ` AND COALESCE(is_demo, 0) = 0`;
    }
    const total = await db.prepare(countSql).get(...countParams);

    res.json({ users, total: parseInt(total.count) });
  } catch (err) {
    console.error("Admin users error:", err);
    res.status(500).json({ error: "Failed to load users" });
  }
});

// ─── GET /api/admin/users/:id/detail — Person detail with journey stage ───
router.get("/users/:id/detail", async (req, res) => {
  try {
    const db = await getDb();
    const userId = req.params.id;

    // Core user data
    const user = await db.prepare(`
      SELECT id, email, role, first_name, last_name, phone, avatar_url, email_verified, is_demo,
        is_admin, admin_role, admin_notes, is_tester, is_active, companion_access, created_at, updated_at
      FROM users WHERE id = ?
    `).get(userId);
    if (!user) return res.status(404).json({ error: "User not found" });

    // Caregiver profile (if applicable)
    let caregiverProfile = null;
    try {
      caregiverProfile = await db.prepare(`
        SELECT cp.*, u.email FROM caregiver_profiles cp JOIN users u ON cp.user_id = u.id WHERE cp.user_id = ?
      `).get(userId);
    } catch (e) { /* */ }

    // Session counts
    const sessionStats = await db.prepare(`
      SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
        COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled,
        COUNT(CASE WHEN status IN ('open', 'requested', 'confirmed', 'pending') THEN 1 END) as upcoming
      FROM care_sessions
      WHERE family_user_id = ? OR caregiver_id = (SELECT id FROM caregiver_profiles WHERE user_id = ?)
    `).get(userId, userId);

    // Lifetime revenue (payments involving this user)
    let lifetimeRevenue = { total: 0 };
    try {
      lifetimeRevenue = await db.prepare(`
        SELECT COALESCE(SUM(amount), 0) as total FROM payments
        WHERE (family_user_id = ? OR caregiver_id = (SELECT id FROM caregiver_profiles WHERE user_id = ?))
        AND status = 'completed'
      `).get(userId, userId) || { total: 0 };
    } catch (e) { /* */ }

    // Reviews (given and received)
    let reviewStats = { given: 0, received: 0, avgReceived: 0 };
    try {
      const given = await db.prepare("SELECT COUNT(*) as count FROM reviews WHERE family_user_id = ?").get(userId);
      const received = await db.prepare(`
        SELECT COUNT(*) as count, ROUND(AVG(rating), 1) as avg FROM reviews
        WHERE caregiver_id = (SELECT id FROM caregiver_profiles WHERE user_id = ?)
      `).get(userId);
      reviewStats = { given: parseInt(given?.count || 0), received: parseInt(received?.count || 0), avgReceived: parseFloat(received?.avg || 0) };
    } catch (e) { /* */ }

    // Care team membership
    let careTeams = [];
    try {
      careTeams = await db.prepare(`
        SELECT ct.id, ct.name, ctm.role as team_role,
          cr.first_name || ' ' || cr.last_name as recipient_name
        FROM care_team_members ctm
        JOIN care_teams ct ON ctm.care_team_id = ct.id
        JOIN care_recipients cr ON ct.care_recipient_id = cr.id
        WHERE ctm.user_id = ?
      `).all(userId);
    } catch (e) { /* */ }

    // Related tickets
    let tickets = [];
    try {
      tickets = await db.prepare(`
        SELECT id, subject, status, priority, category, created_at
        FROM admin_tickets
        WHERE reporter_user_id = ? OR related_user_id = ?
        ORDER BY created_at DESC LIMIT 10
      `).all(userId, userId);
    } catch (e) { /* */ }

    // Safety flags involving this user
    let safetyFlags = [];
    try {
      safetyFlags = await db.prepare(`
        SELECT id, flag_type, description, status, severity, created_at
        FROM safety_flags
        WHERE reporter_user_id = ? OR flagged_user_id = ? OR caregiver_user_id = ?
        ORDER BY created_at DESC LIMIT 10
      `).all(userId, userId, userId);
    } catch (e) { /* */ }

    // ─── All uploaded documents (unified across all 3 tables) ───
    let allDocuments = [];
    try {
      // 1. caregiver_documents (legacy onboarding uploads — DL, certs)
      const cgDocs = await db.prepare(`
        SELECT id, 'caregiver_documents' AS source_table, document_type, file_name,
          'uploaded' AS status, NULL AS category, NULL AS ai_classification,
          NULL AS admin_notes, NULL AS expires_at, created_at
        FROM caregiver_documents WHERE user_id = ?
        ORDER BY created_at DESC
      `).all(userId).catch(() => []);

      // 2. verified_documents (unified system — DL, certs, insurance, consent, legal)
      const vDocs = await db.prepare(`
        SELECT id, 'verified_documents' AS source_table, document_type, file_name,
          status, category, ai_classification, admin_notes, expires_at, created_at
        FROM verified_documents WHERE uploaded_by = ? OR owner_id = ?
        ORDER BY created_at DESC
      `).all(userId, userId).catch(() => []);

      // 3. authorization_documents (legacy POA/guardianship — tied to care recipients)
      const authDocs = await db.prepare(`
        SELECT ad.id, 'authorization_documents' AS source_table, ad.document_type, ad.file_name,
          ad.upload_status AS status, 'legal' AS category, NULL AS ai_classification,
          ad.admin_notes, NULL AS expires_at, ad.created_at,
          cr.first_name || ' ' || cr.last_name AS recipient_name
        FROM authorization_documents ad
        LEFT JOIN care_recipients cr ON ad.care_recipient_id = cr.id
        WHERE ad.submitted_by = ?
        ORDER BY ad.created_at DESC
      `).all(userId).catch(() => []);

      allDocuments = [...cgDocs, ...vDocs, ...authDocs]
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    } catch (e) { console.error('Admin doc query error:', e); }

    // Last active (most recent activity_feed, message, or session)
    let lastActive = user.updated_at;
    try {
      const lastMsg = await db.prepare("SELECT MAX(created_at) as ts FROM messages WHERE sender_id = ?").get(userId);
      const lastActivity = await db.prepare("SELECT MAX(created_at) as ts FROM activity_feed WHERE family_user_id = ?").get(userId);
      const candidates = [user.updated_at, lastMsg?.ts, lastActivity?.ts].filter(Boolean);
      lastActive = candidates.sort().pop() || user.created_at;
    } catch (e) { /* */ }

    // ─── Compute Customer Journey Stage ───
    // Signup → Verified → Team Built → First Visit → Active → Churned
    let journeyStage = 'signup';
    let journeySteps = { signup: true, verified: false, team_built: false, first_visit: false, active: false };

    if (user.email_verified) {
      journeySteps.verified = true;
      journeyStage = 'verified';
    }
    if (careTeams.length > 0) {
      journeySteps.team_built = true;
      journeyStage = 'team_built';
    }
    if ((sessionStats?.completed || 0) > 0) {
      journeySteps.first_visit = true;
      journeyStage = 'first_visit';
    }
    if ((sessionStats?.completed || 0) >= 3) {
      journeySteps.active = true;
      journeyStage = 'active';
    }
    // Churn check: no activity in 30 days and had previous sessions
    if (journeySteps.first_visit && lastActive) {
      const daysSinceLast = (Date.now() - new Date(lastActive).getTime()) / (1000 * 86400);
      if (daysSinceLast > 30) journeyStage = 'churned';
    }

    res.json({
      user,
      caregiverProfile,
      sessionStats,
      lifetimeRevenue: parseFloat(lifetimeRevenue?.total || 0),
      reviewStats,
      careTeams,
      tickets,
      safetyFlags,
      allDocuments,
      lastActive,
      journeyStage,
      journeySteps,
    });
  } catch (err) {
    console.error("Admin user detail error:", err);
    res.status(500).json({ error: "Failed to load user detail" });
  }
});

// ─── PUT /api/admin/users/:id/admin-notes — Update admin sticky notes ───
router.put("/users/:id/admin-notes", async (req, res) => {
  try {
    const db = await getDb();
    const { notes } = req.body;
    await db.prepare("UPDATE users SET admin_notes = ?, updated_at = NOW() WHERE id = ?").run(notes || null, req.params.id);

    // Audit
    try {
      await db.prepare(
        "INSERT INTO admin_audit_log (id, admin_user_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?, ?)"
      ).run(uuid(), req.user.id, 'admin_notes_updated', 'user', req.params.id, JSON.stringify({ preview: (notes || '').slice(0, 100) }));
    } catch (e) { /* */ }

    res.json({ ok: true });
  } catch (err) {
    console.error("Admin notes error:", err);
    res.status(500).json({ error: "Failed to update admin notes" });
  }
});

// ─── POST /api/admin/users/:id/set-password — Admin sets a user's password ───
router.post("/users/:id/set-password", async (req, res) => {
  try {
    const db = await getDb();
    const { password } = req.body;
    if (!password || password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }

    const user = await db.prepare("SELECT id, email, first_name, last_name FROM users WHERE id = ?").get(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    const bcrypt = require("bcryptjs");
    const passwordHash = await bcrypt.hash(password, 10);
    await db.prepare(
      "UPDATE users SET password_hash = ?, must_change_password = 1, password_changed_at = NOW(), updated_at = NOW() WHERE id = ?"
    ).run(passwordHash, req.params.id);

    // Audit log
    await logAdminAction(req, "set_password", "user", req.params.id, {
      userName: `${user.first_name} ${user.last_name}`,
      email: user.email,
    });

    console.log(`[admin] Password set for ${user.email} by ${req.user.email}`);
    res.json({ ok: true, message: `Password set for ${user.email}. User will be prompted to change it on next login.` });
  } catch (err) {
    console.error("Admin set-password error:", err);
    res.status(500).json({ error: "Failed to set password" });
  }
});

// ─── GET /api/admin/waitlist — Full waitlist ───
router.get("/waitlist", async (req, res) => {
  try {
    const db = await getDb();
    const { sort = "created_at", order = "DESC", limit = 100, offset = 0 } = req.query;

    const validSorts = ["created_at", "email", "name"];
    const sortCol = validSorts.includes(sort) ? sort : "created_at";
    const sortOrder = order.toUpperCase() === "ASC" ? "ASC" : "DESC";

    const entries = await db.prepare(`
      SELECT id, email, name, role, source, created_at
      FROM waitlist
      ORDER BY ${sortCol} ${sortOrder}
      LIMIT ? OFFSET ?
    `).all(parseInt(limit), parseInt(offset));

    const total = await db.prepare("SELECT COUNT(*) as count FROM waitlist").get();

    res.json({ entries, total: parseInt(total.count) });
  } catch (err) {
    console.error("Admin waitlist error:", err);
    res.status(500).json({ error: "Failed to load waitlist" });
  }
});

// ─── GET /api/admin/activity — Recent platform activity ───
router.get("/activity", async (req, res) => {
  try {
    const db = await getDb();
    const { limit = 50 } = req.query;

    // Recent registrations
    const recentUsers = await db.prepare(`
      SELECT id, email, first_name, last_name, role, created_at
      FROM users WHERE COALESCE(is_demo, 0) = 0
      ORDER BY created_at DESC LIMIT ?
    `).all(parseInt(limit));

    // Recent sessions
    const recentSessions = await db.prepare(`
      SELECT cs.id, cs.service_type, cs.status, cs.scheduled_date, cs.created_at,
             u.first_name || ' ' || u.last_name as family_name,
             cr.first_name || ' ' || cr.last_name as recipient_name
      FROM care_sessions cs
      JOIN users u ON cs.family_user_id = u.id
      JOIN care_recipients cr ON cs.care_recipient_id = cr.id
      ORDER BY cs.created_at DESC LIMIT ?
    `).all(parseInt(limit));

    // Recent waitlist signups
    const recentWaitlist = await db.prepare(`
      SELECT id, email, name, created_at FROM waitlist
      ORDER BY created_at DESC LIMIT ?
    `).all(parseInt(limit));

    res.json({ recentUsers, recentSessions, recentWaitlist });
  } catch (err) {
    console.error("Admin activity error:", err);
    res.status(500).json({ error: "Failed to load activity" });
  }
});

// ─── GET /api/admin/care-team-invites — List all care team invites ───
router.get("/care-team-invites", async (req, res) => {
  try {
    const db = await getDb();
    const invites = await db.prepare(`
      SELECT cti.id, cti.invited_email, cti.role, cti.status, cti.token, cti.expires_at, cti.created_at,
             ct.name AS team_name,
             cr.first_name AS recipient_first_name, cr.last_name AS recipient_last_name,
             u.first_name AS inviter_first_name, u.last_name AS inviter_last_name
      FROM care_team_invites cti
      JOIN care_teams ct ON cti.care_team_id = ct.id
      JOIN care_recipients cr ON ct.care_recipient_id = cr.id
      JOIN users u ON cti.invited_by = u.id
      ORDER BY cti.created_at DESC
      LIMIT 100
    `).all();
    res.json({ careTeamInvites: invites, total: invites.length });
  } catch (err) {
    console.error("Admin care-team-invites error:", err);
    res.status(500).json({ error: "Failed to load care team invites" });
  }
});

// ─── POST /api/admin/care-team-add — Manually add a user to a care team by email ───
router.post("/care-team-add", async (req, res) => {
  try {
    const db = await getDb();
    const { email, careTeamId, careRecipientName } = req.body;
    if (!email) return res.status(400).json({ error: "email is required" });

    // Find the user
    const user = await db.prepare("SELECT id, email, first_name, last_name FROM users WHERE LOWER(email) = LOWER(?)").get(email);
    if (!user) return res.status(404).json({ error: `No user found with email ${email}` });

    // Find the care team — by ID or by care recipient name
    let team;
    if (careTeamId) {
      team = await db.prepare("SELECT * FROM care_teams WHERE id = ?").get(careTeamId);
    } else if (careRecipientName) {
      team = await db.prepare(`
        SELECT ct.* FROM care_teams ct
        JOIN care_recipients cr ON ct.care_recipient_id = cr.id
        WHERE LOWER(cr.first_name) = LOWER(?)
        LIMIT 1
      `).get(careRecipientName);
    } else {
      return res.status(400).json({ error: "careTeamId or careRecipientName is required" });
    }
    if (!team) return res.status(404).json({ error: "Care team not found" });

    // Check if already a member
    const existing = await db.prepare(
      "SELECT id FROM care_team_members WHERE care_team_id = ? AND user_id = ?"
    ).get(team.id, user.id);
    if (existing) return res.json({ message: "Already a member", userId: user.id, teamId: team.id });

    // Add as member
    const { v4: uuid } = require("uuid");
    await db.prepare(
      "INSERT INTO care_team_members (id, care_team_id, user_id, role, invited_by) VALUES (?, ?, ?, 'member', ?)"
    ).run(uuid(), team.id, user.id, req.user.id);

    // Also add care_recipient_shares
    const shareExists = await db.prepare(
      "SELECT id FROM care_recipient_shares WHERE care_recipient_id = ? AND shared_with_user_id = ?"
    ).get(team.care_recipient_id, user.id);
    if (!shareExists) {
      await db.prepare(
        "INSERT INTO care_recipient_shares (id, care_recipient_id, shared_with_user_id, permission, shared_by_user_id) VALUES (?, ?, ?, 'edit', ?)"
      ).run(uuid(), team.care_recipient_id, user.id, req.user.id);
    }

    // Auto-connect for messaging
    const members = await db.prepare(
      "SELECT user_id FROM care_team_members WHERE care_team_id = ? AND user_id != ?"
    ).all(team.id, user.id);
    for (const m of members) {
      const conn = await db.prepare(
        "SELECT id FROM connections WHERE (requester_id = ? AND recipient_id = ?) OR (requester_id = ? AND recipient_id = ?)"
      ).get(user.id, m.user_id, m.user_id, user.id);
      if (!conn) {
        await db.prepare(
          "INSERT INTO connections (id, requester_id, recipient_id, status) VALUES (?, ?, ?, 'accepted')"
        ).run(uuid(), user.id, m.user_id);
      }
    }

    // Add to care team conversation
    const conv = await db.prepare(
      "SELECT id FROM conversations WHERE care_team_id = ? AND type = 'care_team'"
    ).get(team.id);
    if (conv) {
      const inConv = await db.prepare(
        "SELECT id FROM conversation_members WHERE conversation_id = ? AND user_id = ?"
      ).get(conv.id, user.id);
      if (!inConv) {
        await db.prepare(
          "INSERT INTO conversation_members (id, conversation_id, user_id, role) VALUES (?, ?, ?, 'member')"
        ).run(uuid(), conv.id, user.id);
      }
    }

    // Mark any pending invites as accepted
    await db.prepare(
      "UPDATE care_team_invites SET status = 'accepted' WHERE care_team_id = ? AND LOWER(invited_email) = LOWER(?) AND status = 'pending'"
    ).run(team.id, email);

    console.log(`[admin] Manually added ${user.email} to care team ${team.name || team.id}`);
    res.json({
      ok: true,
      message: `Added ${user.first_name} ${user.last_name} (${user.email}) to care team`,
      userId: user.id, teamId: team.id,
    });
  } catch (err) {
    console.error("Admin care-team-add error:", err);
    res.status(500).json({ error: "Failed to add user to care team" });
  }
});

// ─── GET /api/admin/search-email — Search across users, waitlist, and invites ───
router.get("/search-email", async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) return res.status(400).json({ error: "Email query parameter required" });

    const db = await getDb();
    const normalizedEmail = email.trim().toLowerCase();

    const [user, waitlistEntry, invite, careTeamInvites] = await Promise.all([
      db.prepare(`
        SELECT id, email, role, first_name, last_name, phone, email_verified, is_demo, created_at
        FROM users WHERE LOWER(email) = ?
      `).get(normalizedEmail),
      db.prepare(`
        SELECT id, email, name, role, source, created_at
        FROM waitlist WHERE LOWER(email) = ?
      `).get(normalizedEmail),
      db.prepare(`
        SELECT pi.id, pi.invited_email, pi.role, pi.status, pi.expires_at, pi.created_at,
               u.first_name AS inviter_first_name, u.last_name AS inviter_last_name
        FROM platform_invites pi
        JOIN users u ON pi.invited_by = u.id
        WHERE LOWER(pi.invited_email) = ?
        ORDER BY pi.created_at DESC LIMIT 1
      `).get(normalizedEmail),
      db.prepare(`
        SELECT cti.id, cti.invited_email, cti.role, cti.status, cti.expires_at, cti.created_at,
               ct.name AS care_team_name,
               u.first_name AS inviter_first_name, u.last_name AS inviter_last_name
        FROM care_team_invites cti
        JOIN care_teams ct ON cti.care_team_id = ct.id
        JOIN users u ON cti.invited_by = u.id
        WHERE LOWER(cti.invited_email) = ?
        ORDER BY cti.created_at DESC
      `).all(normalizedEmail),
    ]);

    res.json({
      user: user || null,
      waitlist: waitlistEntry || null,
      invite: invite || null,
      careTeamInvites: careTeamInvites || [],
    });
  } catch (err) {
    console.error("Admin search-email error:", err);
    res.status(500).json({ error: "Failed to search" });
  }
});

// ─── POST /api/admin/reset-password ───
// Admin resets a user's password (sets to a temporary password + must_change_password flag)
router.post("/reset-password", async (req, res) => {
  try {
    const { userId, newPassword } = req.body;
    if (!userId || !newPassword) {
      return res.status(400).json({ error: "userId and newPassword required" });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }
    const db = await getDb();
    const user = await db.prepare("SELECT id, email FROM users WHERE id = ?").get(userId);
    if (!user) return res.status(404).json({ error: "User not found" });

    const bcrypt = require("bcryptjs");
    const hash = await bcrypt.hash(newPassword, 10);
    await db.prepare("UPDATE users SET password_hash = ?, updated_at = NOW() WHERE id = ?").run(hash, userId);

    await logAdminAction(req, "reset_password", "user", userId, { email: user.email });
    res.json({ success: true, message: `Password reset for ${user.email}` });
  } catch (err) {
    console.error("Admin reset-password error:", err);
    res.status(500).json({ error: "Failed to reset password" });
  }
});

// ─── DELETE /api/admin/users/:id ───
// Admin deletes a user and all associated data (same logic as self-service DELETE /api/auth/me)
// ─── DELETE /api/admin/users/:id — Admin account deletion (soft-delete) ───
// Same anonymization approach as self-service delete. Retains audit trail.
router.delete("/users/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const db = await getDb();
    const user = await db.prepare("SELECT id, email, role, is_demo FROM users WHERE id = ?").get(id);
    if (!user) return res.status(404).json({ error: "User not found" });

    const anonEmail = `deleted_${id.slice(0, 8)}@deleted.inplace`;

    // ── Run everything in a transaction so it's all-or-nothing ──
    await db.transaction(async (tx) => {
      const cgProfile = await tx.prepare("SELECT id FROM caregiver_profiles WHERE user_id = ?").get(id);
      const cgId = cgProfile?.id;

      // 1. Caregiver-specific cleanup
      if (cgId) {
        // Unassign ALL non-completed/cancelled sessions back to 'requested'
        await tx.prepare(`
          UPDATE care_sessions
          SET caregiver_id = NULL, status = 'requested', updated_at = NOW()
          WHERE caregiver_id = ? AND status NOT IN ('completed', 'cancelled')
        `).run(cgId);
        await tx.prepare("UPDATE session_offers SET status = 'expired' WHERE (from_user_id = ? OR to_user_id = ?) AND status = 'pending'").run(id, id);
        await tx.prepare("DELETE FROM caregiver_assignments WHERE caregiver_profile_id = ?").run(cgId);
        await tx.prepare("DELETE FROM availability WHERE caregiver_id = ?").run(cgId);
        await tx.prepare(`
          UPDATE caregiver_profiles SET
            bio = NULL, legal_first_name = NULL, legal_last_name = NULL,
            date_of_birth = NULL, ssn_last4 = NULL, address_line1 = NULL,
            address_line2 = NULL, zip = NULL, dl_number = NULL, dl_state = NULL,
            location_city = NULL, location_state = NULL, latitude = NULL, longitude = NULL,
            work_location_address = NULL, work_latitude = NULL, work_longitude = NULL,
            stripe_account_id = NULL, is_available = 0,
            updated_at = NOW()
          WHERE id = ?
        `).run(cgId);
      }

      // 2. Delete sensitive auth & device data
      await tx.prepare("DELETE FROM password_reset_tokens WHERE user_id = ?").run(id);
      await tx.prepare("DELETE FROM email_verification_tokens WHERE user_id = ?").run(id);
      await tx.prepare("DELETE FROM push_subscriptions WHERE user_id = ?").run(id);
      await tx.prepare("DELETE FROM oauth_accounts WHERE user_id = ?").run(id);
      await tx.prepare("DELETE FROM user_2fa WHERE user_id = ?").run(id);
      await tx.prepare("DELETE FROM trusted_devices WHERE user_id = ?").run(id);

      // 3. RETAIN personal documents — mark as retained for legal/compliance
      // Documents must survive account deletion for fraud/forgery protection
      await tx.prepare("UPDATE caregiver_documents SET retained_from_deleted = 1, deleted_user_email = ? WHERE user_id = ?").run(user.email, id);
      await tx.prepare("UPDATE verified_documents SET retained_from_deleted = 1, deleted_user_email = ? WHERE uploaded_by = ?").run(user.email, id);

      // 4. Remove from active teams & connections
      await tx.prepare("DELETE FROM care_team_members WHERE user_id = ?").run(id);
      await tx.prepare("DELETE FROM connections WHERE requester_id = ? OR recipient_id = ?").run(id, id);
      await tx.prepare("DELETE FROM conversation_members WHERE user_id = ?").run(id);
      await tx.prepare("DELETE FROM care_recipient_shares WHERE shared_with_user_id = ? OR shared_by_user_id = ?").run(id, id);
      await tx.prepare("UPDATE care_recipients SET linked_user_id = NULL WHERE linked_user_id = ?").run(id);

      // 5. RETAIN: messages, activity_feed, feedback, reviews, payments,
      //    care_sessions, background_check_payments, recipient_notes

      // 6. Anonymize the user row
      await tx.prepare(`
        UPDATE users SET
          deleted_email = email,
          email = ?,
          password_hash = 'DELETED',
          first_name = 'Deleted',
          last_name = 'User',
          phone = NULL,
          avatar_url = NULL,
          profile_photo = NULL,
          pets = NULL,
          pet_allergies = NULL,
          food_allergies = NULL,
          medical_conditions = NULL,
          notification_prefs = NULL,
          is_active = 0,
          deleted_at = NOW(),
          updated_at = NOW()
        WHERE id = ?
      `).run(anonEmail, id);
    }); // end transaction

    await logAdminAction(req, "delete_user", "user", id, { email: user.email, role: user.role });
    res.json({ success: true, message: `Soft-deleted user ${user.email} → ${anonEmail}` });
  } catch (err) {
    console.error("Admin delete user error:", err);
    console.error("User deletion error:", err.message); res.status(500).json({ error: "Failed to delete user" });
  }
});

// ─── POST /api/admin/users/:id/nuke/challenge — Generate passkey challenge for nuke confirmation ───
router.post("/users/:id/nuke/challenge", async (req, res) => {
  try {
    const db = await getDb();
    const target = await db.prepare("SELECT id, email FROM users WHERE id = ?").get(req.params.id);
    if (!target) return res.status(404).json({ error: "User not found" });

    // Get admin's passkeys
    const passkeys = await db.prepare(
      "SELECT credential_id, transports FROM user_passkeys WHERE user_id = ?"
    ).all(req.user.id);
    if (passkeys.length === 0) {
      return res.status(400).json({ error: "You need a registered passkey to use nuke. Set one up in My Account → Security." });
    }

    const allowCredentials = passkeys.map(pk => ({
      id: pk.credential_id,
      transports: pk.transports ? JSON.parse(pk.transports) : [],
    }));

    const options = await generateAuthenticationOptions({
      rpID: RP_ID,
      allowCredentials,
      userVerification: "required", // Must verify identity (biometric/PIN)
    });

    const challengeKey = `nuke_${req.user.id}_${req.params.id}_${Date.now()}`;
    setNukeChallenge(challengeKey, {
      challenge: options.challenge,
      adminId: req.user.id,
      targetUserId: req.params.id,
      targetEmail: target.email,
    });

    res.json({ ...options, _challengeKey: challengeKey });
  } catch (err) {
    console.error("Nuke challenge error:", err);
    res.status(500).json({ error: "Failed to generate passkey challenge" });
  }
});

// ─── DELETE /api/admin/users/:id/nuke — HARD DELETE all user data (requires passkey) ───
router.delete("/users/:id/nuke", async (req, res) => {
  try {
    const { _challengeKey, _passwordAuth, password, ...authResponse } = req.body;
    const db = await getDb();

    // Password-based fallback for admin verification
    if (_passwordAuth && password) {
      const bcrypt = require("bcryptjs");
      const adminUser = await db.prepare("SELECT password_hash, is_admin FROM users WHERE id = ?").get(req.user.id);
      if (!adminUser?.is_admin) return res.status(403).json({ error: "Admin access required." });
      const match = await bcrypt.compare(password, adminUser.password_hash);
      if (!match) return res.status(401).json({ error: "Incorrect password." });
    } else {
      // Passkey-based verification
      const stored = getNukeChallenge(_challengeKey);
      if (!stored) {
        return res.status(401).json({ error: "Passkey challenge expired. Please try again." });
      }
      if (stored.adminId !== req.user.id || stored.targetUserId !== req.params.id) {
        return res.status(401).json({ error: "Challenge mismatch." });
      }

      const passkey = await db.prepare(
        "SELECT pk.*, u.id as uid FROM user_passkeys pk JOIN users u ON pk.user_id = u.id WHERE pk.credential_id = ?"
      ).get(authResponse.id);
      if (!passkey || passkey.uid !== req.user.id) {
        return res.status(401).json({ error: "Passkey not recognized or doesn't belong to you." });
      }

      const verification = await verifyAuthenticationResponse({
        response: authResponse,
        expectedChallenge: stored.challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        credential: {
          id: passkey.credential_id,
          publicKey: Buffer.from(passkey.public_key, "base64"),
          counter: Number(passkey.counter),
        },
        requireUserVerification: true,
      });

      if (!verification.verified) {
        return res.status(401).json({ error: "Passkey verification failed." });
      }

      // Update passkey counter
      await db.prepare("UPDATE user_passkeys SET counter = ?, last_used = NOW() WHERE id = ?")
        .run(verification.authenticationInfo.newCounter, passkey.id);
    }

    // 2. Get user info before nuking
    const { id } = req.params;
    const user = await db.prepare("SELECT id, email, role, is_admin, first_name, last_name FROM users WHERE id = ?").get(id);
    if (!user) return res.status(404).json({ error: "User not found" });

    // Safety: never nuke yourself
    if (id === req.user.id) {
      return res.status(400).json({ error: "You cannot nuke your own account." });
    }

    // 3. HARD DELETE everything in a transaction
    // IMPORTANT: Order matters — delete child rows before parent rows to avoid FK violations.
    // In PostgreSQL, a failed statement poisons the entire transaction (even if caught by JS try/catch).
    // We use SAVEPOINT/ROLLBACK TO for any statement that might fail (table may not exist, column missing, etc.)
    await db.transaction(async (tx) => {
      // Safe-run helper: wraps risky SQL in a savepoint so a failure doesn't poison the whole PG transaction
      const safeRun = async (sql, params = [], label = '') => {
        const sp = 'sp_' + Math.random().toString(36).slice(2, 10);
        try {
          await tx.prepare(`SAVEPOINT ${sp}`).run();
          await tx.prepare(sql).run(...params);
          await tx.prepare(`RELEASE SAVEPOINT ${sp}`).run();
        } catch (e) {
          await tx.prepare(`ROLLBACK TO SAVEPOINT ${sp}`).run();
          if (label) console.log(`  [NUKE] ${label} skip: ${e.message}`);
        }
      };

      const cgProfile = await tx.prepare("SELECT * FROM caregiver_profiles WHERE user_id = ?").get(id);
      const cgId = cgProfile?.id;

      // Archive background check data BEFORE deleting (permanent record)
      if (cgId && (cgProfile.checkr_candidate_id || cgProfile.checkr_report_id || cgProfile.is_background_checked || cgProfile.background_check_paid)) {
        const { v4: archiveUuid } = require("uuid");
        await tx.prepare(`
          INSERT INTO background_check_archive (
            id, user_id, user_email, user_first_name, user_last_name,
            caregiver_profile_id, checkr_candidate_id, checkr_report_id, checkr_invitation_id,
            checkr_status, is_background_checked, background_check_paid,
            bg_check_admin_approved, bg_check_admin_approved_by, bg_check_admin_approved_at,
            legal_first_name, legal_last_name, archived_at, archived_reason, original_created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), 'user_deleted', ?)
        `).run(
          archiveUuid(), id, user.email, user.first_name, user.last_name,
          cgId, cgProfile.checkr_candidate_id, cgProfile.checkr_report_id, cgProfile.checkr_invitation_id,
          cgProfile.checkr_status, cgProfile.is_background_checked ? 1 : 0, cgProfile.background_check_paid ? 1 : 0,
          cgProfile.bg_check_admin_approved ? 1 : 0, cgProfile.bg_check_admin_approved_by || null, cgProfile.bg_check_admin_approved_at || null,
          cgProfile.legal_first_name, cgProfile.legal_last_name, cgProfile.created_at
        );
        console.log(`  [NUKE] Archived background check for ${user.email}: candidate=${cgProfile.checkr_candidate_id}, report=${cgProfile.checkr_report_id}, status=${cgProfile.checkr_status}`);
      }

      // Caregiver-specific tables
      if (cgId) {
        // Visit photos → visit logs (need log IDs first)
        const vlogs = await tx.prepare("SELECT id FROM visit_logs WHERE caregiver_id = ?").all(cgId);
        for (const vl of vlogs) {
          await tx.prepare("DELETE FROM visit_photos WHERE visit_log_id = ?").run(vl.id);
        }
        await tx.prepare("DELETE FROM visit_logs WHERE caregiver_id = ?").run(cgId);
        await tx.prepare("DELETE FROM caregiver_assignments WHERE caregiver_profile_id = ?").run(cgId);
        await tx.prepare("DELETE FROM availability WHERE caregiver_id = ?").run(cgId);
        await tx.prepare("DELETE FROM reviews WHERE caregiver_id = ?").run(cgId);
        await tx.prepare("DELETE FROM payments WHERE caregiver_id = ?").run(cgId);
        await safeRun("DELETE FROM first_visit_confirmations WHERE caregiver_id = ?", [cgId], 'first_visit_confirmations(cg)');
        // Sessions: delete offers first, then sessions
        const cgSessions = await tx.prepare("SELECT id FROM care_sessions WHERE caregiver_id = ?").all(cgId);
        for (const cs of cgSessions) {
          await tx.prepare("DELETE FROM session_offers WHERE session_id = ?").run(cs.id);
        }
        await tx.prepare("DELETE FROM care_sessions WHERE caregiver_id = ? AND status NOT IN ('completed')").run(cgId);
        // Completed sessions: clear caregiver reference but keep for audit
        await tx.prepare("UPDATE care_sessions SET caregiver_id = NULL WHERE caregiver_id = ? AND status = 'completed'").run(cgId);
        await tx.prepare("DELETE FROM caregiver_profiles WHERE id = ?").run(cgId);
      }

      // Family-specific: care recipients + their cascading data
      const crs = await tx.prepare("SELECT id FROM care_recipients WHERE family_user_id = ?").all(id);
      for (const cr of crs) {
        await safeRun("DELETE FROM consent_outreach WHERE care_recipient_id = ?", [cr.id], 'consent_outreach(cr)');
        await safeRun("DELETE FROM consent_audit_log WHERE care_recipient_id = ?", [cr.id], 'consent_audit_log(cr)');
        await safeRun("DELETE FROM attestations WHERE care_recipient_id = ?", [cr.id], 'attestations');
        await safeRun("DELETE FROM verification_attempts WHERE care_recipient_id = ?", [cr.id], 'verification_attempts');
        await safeRun("DELETE FROM first_visit_confirmations WHERE care_recipient_id = ?", [cr.id], 'first_visit_confirmations(cr)');
        // RETAIN authorization documents — mark as retained for legal/compliance
        await safeRun("UPDATE authorization_documents SET retained_from_deleted = 1 WHERE care_recipient_id = ?", [cr.id], 'auth_docs retain');
        await safeRun("UPDATE verified_documents SET retained_from_deleted = 1 WHERE owner_type = 'care_recipient' AND owner_id = ?", [cr.id], 'verified_docs retain');
        await safeRun("DELETE FROM recipient_notes WHERE care_recipient_id = ?", [cr.id], 'recipient_notes(cr)');
        await tx.prepare("DELETE FROM caregiver_assignments WHERE care_recipient_id = ?").run(cr.id);
        await tx.prepare("DELETE FROM care_recipient_shares WHERE care_recipient_id = ?").run(cr.id);
        await tx.prepare("DELETE FROM activity_feed WHERE care_recipient_id = ?").run(cr.id);
        // Sessions under this care recipient
        const crSessions = await tx.prepare("SELECT id FROM care_sessions WHERE care_recipient_id = ?").all(cr.id);
        for (const cs of crSessions) {
          await tx.prepare("DELETE FROM session_offers WHERE session_id = ?").run(cs.id);
          const slogs = await tx.prepare("SELECT id FROM visit_logs WHERE session_id = ?").all(cs.id);
          for (const vl of slogs) {
            await tx.prepare("DELETE FROM visit_photos WHERE visit_log_id = ?").run(vl.id);
          }
          await tx.prepare("DELETE FROM visit_logs WHERE session_id = ?").run(cs.id);
          await safeRun("DELETE FROM reviews WHERE session_id = ?", [cs.id], 'reviews(session)');
          await safeRun("DELETE FROM payments WHERE session_id = ?", [cs.id], 'payments(session)');
        }
        await tx.prepare("DELETE FROM care_sessions WHERE care_recipient_id = ?").run(cr.id);
        // Care teams linked to this care recipient
        const teams = await tx.prepare("SELECT id FROM care_teams WHERE care_recipient_id = ?").all(cr.id);
        for (const t of teams) {
          await tx.prepare("UPDATE conversations SET care_team_id = NULL WHERE care_team_id = ?").run(t.id);
          await tx.prepare("DELETE FROM care_team_invites WHERE care_team_id = ?").run(t.id);
          await tx.prepare("DELETE FROM care_team_members WHERE care_team_id = ?").run(t.id);
        }
        await tx.prepare("DELETE FROM care_teams WHERE care_recipient_id = ?").run(cr.id);
      }
      await tx.prepare("DELETE FROM care_recipients WHERE family_user_id = ?").run(id);

      // Auth & security
      await tx.prepare("DELETE FROM refresh_tokens WHERE user_id = ?").run(id);
      await safeRun("DELETE FROM password_reset_tokens WHERE user_id = ?", [id], 'password_reset_tokens');
      await safeRun("DELETE FROM email_verification_tokens WHERE user_id = ?", [id], 'email_verification_tokens');
      await tx.prepare("DELETE FROM push_subscriptions WHERE user_id = ?").run(id);
      await safeRun("DELETE FROM oauth_accounts WHERE user_id = ?", [id], 'oauth_accounts');
      await safeRun("DELETE FROM user_2fa WHERE user_id = ?", [id], 'user_2fa');
      await safeRun("DELETE FROM trusted_devices WHERE user_id = ?", [id], 'trusted_devices');
      await tx.prepare("DELETE FROM user_passkeys WHERE user_id = ?").run(id);

      // RETAIN documents — mark as retained for legal/compliance
      await safeRun("UPDATE caregiver_documents SET retained_from_deleted = 1, deleted_user_email = ? WHERE user_id = ?", [user.email, id], 'caregiver_documents retain');
      await safeRun("UPDATE verified_documents SET retained_from_deleted = 1, deleted_user_email = ? WHERE uploaded_by = ?", [user.email, id], 'verified_documents retain');
      await safeRun("DELETE FROM background_check_payments WHERE user_id = ?", [id], 'bg_check_payments');
      await safeRun("DELETE FROM payout_preferences WHERE user_id = ?", [id], 'payout_preferences');

      // Social & messaging — must handle ALL FK references to users(id)
      await tx.prepare("DELETE FROM care_team_members WHERE user_id = ?").run(id);
      await safeRun("DELETE FROM care_team_invites WHERE invited_by = ?", [id], 'care_team_invites');
      await safeRun("DELETE FROM platform_invites WHERE invited_by = ?", [id], 'platform_invites');
      await safeRun("DELETE FROM connections WHERE requester_id = ? OR recipient_id = ?", [id, id], 'connections');
      await tx.prepare("DELETE FROM conversation_members WHERE user_id = ?").run(id);
      await safeRun("DELETE FROM message_reactions WHERE user_id = ?", [id], 'message_reactions');
      await tx.prepare("DELETE FROM messages WHERE sender_id = ? OR recipient_id = ?").run(id, id);
      await tx.prepare("DELETE FROM session_offers WHERE from_user_id = ? OR to_user_id = ?").run(id, id);
      await tx.prepare("UPDATE conversations SET created_by = NULL WHERE created_by = ?").run(id);
      await safeRun("UPDATE blocked_emails SET blocked_by = NULL WHERE blocked_by = ?", [id], 'blocked_emails');

      // Activity & feedback
      await tx.prepare("DELETE FROM activity_feed WHERE family_user_id = ?").run(id);
      await tx.prepare("DELETE FROM feedback WHERE user_id = ?").run(id);
      await safeRun("DELETE FROM onboarding_events WHERE user_id = ?", [id], 'onboarding_events');

      // Sessions owned by this family user
      await safeRun("DELETE FROM reviews WHERE family_user_id = ?", [id], 'reviews(family)');
      await safeRun("DELETE FROM payments WHERE family_user_id = ?", [id], 'payments(family)');
      const familySessions = await tx.prepare("SELECT id FROM care_sessions WHERE family_user_id = ?").all(id);
      for (const cs of familySessions) {
        await tx.prepare("DELETE FROM session_offers WHERE session_id = ?").run(cs.id);
        const slogs = await tx.prepare("SELECT id FROM visit_logs WHERE session_id = ?").all(cs.id);
        for (const vl of slogs) {
          await tx.prepare("DELETE FROM visit_photos WHERE visit_log_id = ?").run(vl.id);
        }
        await tx.prepare("DELETE FROM visit_logs WHERE session_id = ?").run(cs.id);
      }
      await tx.prepare("DELETE FROM care_sessions WHERE family_user_id = ?").run(id);

      // Recipient notes authored by this user
      await safeRun("DELETE FROM recipient_notes WHERE author_id = ?", [id], 'recipient_notes(author)');
      // Care recipient shares
      await safeRun("DELETE FROM care_recipient_shares WHERE shared_with_user_id = ? OR shared_by_user_id = ?", [id, id], 'care_recipient_shares');

      // Consent audit log entries by this user
      await safeRun("DELETE FROM consent_audit_log WHERE actor_id = ?", [id], 'consent_audit_log(actor)');

      // Safety flags & related sub-tables
      await safeRun("DELETE FROM safety_flag_threads WHERE participant_user_id = ?", [id], 'safety_flag_threads');
      await safeRun("UPDATE safety_flag_events SET actor_id = NULL WHERE actor_id = ?", [id], 'safety_flag_events');
      await safeRun("DELETE FROM safety_flags WHERE user_id = ?", [id], 'safety_flags');
      await safeRun("UPDATE safety_flags SET reviewed_by = NULL WHERE reviewed_by = ?", [id], 'safety_flags(reviewed_by)');

      // Tickets
      await safeRun("DELETE FROM admin_ticket_comments WHERE author_id = ?", [id], 'admin_ticket_comments');
      await safeRun("UPDATE admin_tickets SET assigned_to = NULL WHERE assigned_to = ?", [id], 'admin_tickets(assigned)');
      await safeRun("DELETE FROM admin_tickets WHERE reporter_user_id = ?", [id], 'admin_tickets(reporter)');
      await safeRun("UPDATE admin_tickets SET related_user_id = NULL WHERE related_user_id = ?", [id], 'admin_tickets(related)');

      // Interviews, disputes, time proposals, tips
      await safeRun("DELETE FROM interviews WHERE requested_by = ? OR requested_of = ?", [id, id], 'interviews');
      await safeRun("DELETE FROM session_disputes WHERE filed_by = ?", [id], 'session_disputes');
      await safeRun("UPDATE session_disputes SET resolved_by = NULL WHERE resolved_by = ?", [id], 'session_disputes(resolved)');
      await safeRun("DELETE FROM time_proposals WHERE caregiver_user_id = ?", [id], 'time_proposals');
      await safeRun("DELETE FROM tips WHERE family_user_id = ?", [id], 'tips');

      // Referrals, milestones, reminders, manual payments
      await safeRun("DELETE FROM referrals WHERE referrer_user_id = ?", [id], 'referrals');
      await safeRun("UPDATE referrals SET referred_user_id = NULL WHERE referred_user_id = ?", [id], 'referrals(referred)');
      await safeRun("DELETE FROM milestones WHERE user_id = ?", [id], 'milestones');
      await safeRun("DELETE FROM manual_payments WHERE from_user_id = ?", [id], 'manual_payments');
      await safeRun("DELETE FROM kindred_reminders WHERE from_user_id = ?", [id], 'kindred_reminders');
      await safeRun("DELETE FROM consent_outreach WHERE initiated_by = ?", [id], 'consent_outreach(initiated)');

      // Nullify nullable FK refs on surviving rows
      await safeRun("UPDATE care_teams SET billing_user_id = NULL WHERE billing_user_id = ?", [id], 'care_teams(billing)');
      await safeRun("UPDATE care_recipients SET linked_user_id = NULL WHERE linked_user_id = ?", [id], 'care_recipients(linked)');
      await safeRun("UPDATE caregiver_assignments SET family_user_id = NULL WHERE family_user_id = ?", [id], 'caregiver_assignments(family)');

      // Catch-all: try to nuke any remaining FK references we might have missed
      // Query PG catalog for all FK constraints pointing to users(id) and clean them
      const fkRefs = await tx.prepare(`
        SELECT tc.table_name, kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
        JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND ccu.table_name = 'users' AND ccu.column_name = 'id'
          AND tc.table_name != 'users'
      `).all();
      for (const fk of fkRefs) {
        // Skip tables we already handled above
        await safeRun(`DELETE FROM "${fk.table_name}" WHERE "${fk.column_name}" = ?`, [id], `catch-all: ${fk.table_name}.${fk.column_name}`);
      }

      // Finally: DELETE the user row
      await tx.prepare("DELETE FROM users WHERE id = ?").run(id);
    }); // end transaction

    await logAdminAction(req, "nuke_user", "user", id, { email: user.email, role: user.role, method: "passkey_verified" });
    console.log(`  [NUKE] Admin ${req.user.id} permanently deleted user ${user.email} (${id})`);
    res.json({ success: true, message: `☢️ Permanently deleted ${user.email} and all associated data.` });
  } catch (err) {
    console.error("Nuke user error:", err);
    console.error("Nuke error stack:", err.stack);
    res.status(500).json({ error: `Operation failed: ${err.message}` });
  }
});

// ─── POST /api/admin/users/:id/reset-password — Admin force-resets a user's password ───
// Invalidates old password immediately (user cannot log in with it) and sends reset email.
router.post("/users/:id/reset-password", async (req, res) => {
  try {
    const db = await getDb();
    const { id } = req.params;
    const user = await db.prepare("SELECT id, email, first_name FROM users WHERE id = ?").get(id);
    if (!user) return res.status(404).json({ error: "User not found" });

    const crypto = require("crypto");
    const bcrypt = require("bcryptjs");
    const { sendEmail, brandedHtml } = require("../utils/email");

    // 1. Invalidate old password — set to random hash so old password stops working immediately
    const randomPw = crypto.randomBytes(32).toString("hex");
    const invalidHash = await bcrypt.hash(randomPw, 10);
    await db.prepare("UPDATE users SET password_hash = ?, must_change_password = 1, updated_at = NOW() WHERE id = ?").run(invalidHash, user.id);

    // 2. Create reset token
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours for admin resets

    await db.prepare("DELETE FROM password_reset_tokens WHERE user_id = ?").run(user.id);
    await db.prepare(
      "INSERT INTO password_reset_tokens (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)"
    ).run(uuid(), user.id, token, expiresAt);

    // 3. Send reset email
    const baseUrl = (process.env.APP_URL || "https://yourinplace.com").replace(/\/$/, "");
    const resetUrl = `${baseUrl}/?reset=${token}`;
    await sendEmail({
      to: user.email,
      subject: "Reset your InPlace password",
      html: brandedHtml({
        title: "InPlace",
        greeting: `Hi ${user.first_name},`,
        body: "Your password has been reset by an administrator. Click below to create a new password:",
        ctaUrl: resetUrl,
        ctaText: "Create New Password",
        footnote: "This link expires in 24 hours. You'll need to set a new password before you can sign in.",
      }),
    });

    await logAdminAction(req, "force_password_reset", "user", id, { email: user.email });
    res.json({ success: true, message: `Password invalidated & reset email sent to ${user.email}` });
  } catch (err) {
    console.error("Admin force password reset error:", err);
    res.status(500).json({ error: "Failed to reset password" });
  }
});

// ─── Customer Service: Reviews Management ───

// GET /api/admin/reviews — Fetch reviews with optional filters
router.get("/reviews", requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const { status, maxRating, limit: lim } = req.query;
    const maxR = parseInt(maxRating) || 3;
    const limitN = Math.min(parseInt(lim) || 50, 200);
    let where = "WHERE r.rating < ? AND COALESCE(fu.is_demo, 0) = 0";
    const params = [maxR];

    if (status && status !== 'all') {
      where += " AND COALESCE(r.admin_status, 'pending') = ?";
      params.push(status);
    }

    params.push(limitN);

    const rows = await db.prepare(`
      SELECT r.*,
        fu.first_name || ' ' || fu.last_name AS family_name,
        fu.email AS family_email,
        cu.first_name || ' ' || cu.last_name AS caregiver_name,
        cp.rating_avg AS caregiver_rating_avg,
        cp.rating_count AS caregiver_rating_count,
        cs.scheduled_date, cs.scheduled_time, cs.service_type,
        cr.first_name || ' ' || cr.last_name AS recipient_name,
        au.first_name || ' ' || au.last_name AS reviewed_by_name
      FROM reviews r
      JOIN users fu ON r.family_user_id = fu.id
      JOIN caregiver_profiles cp ON r.caregiver_id = cp.id
      JOIN users cu ON cp.user_id = cu.id
      JOIN care_sessions cs ON r.session_id = cs.id
      LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
      LEFT JOIN users au ON r.admin_reviewed_by = au.id
      ${where}
      ORDER BY r.created_at DESC
      LIMIT ?
    `).all(...params);

    // Summary counts (exclude demo users)
    const counts = await db.prepare(`
      SELECT
        COUNT(*) FILTER (WHERE r.rating < 3) AS total_flagged,
        COUNT(*) FILTER (WHERE r.rating < 3 AND COALESCE(r.admin_status, 'pending') = 'pending') AS pending,
        COUNT(*) FILTER (WHERE r.rating < 3 AND r.admin_status = 'reviewed') AS reviewed,
        COUNT(*) FILTER (WHERE r.rating < 3 AND r.admin_status = 'escalated') AS escalated,
        COUNT(*) FILTER (WHERE r.rating < 3 AND r.admin_status = 'resolved') AS resolved
      FROM reviews r
      JOIN users fu ON r.family_user_id = fu.id
      WHERE COALESCE(fu.is_demo, 0) = 0
    `).get();

    res.json({ reviews: rows, counts });
  } catch (err) {
    console.error("Admin reviews fetch error:", err);
    res.status(500).json({ error: "Failed to fetch reviews" });
  }
});

// PUT /api/admin/reviews/:id — Update admin status/notes on a review
router.put("/reviews/:id", requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const { admin_status, admin_notes } = req.body;
    if (!admin_status) return res.status(400).json({ error: "admin_status is required" });

    const review = await db.prepare("SELECT id FROM reviews WHERE id = ?").get(req.params.id);
    if (!review) return res.status(404).json({ error: "Review not found" });

    await db.prepare(`
      UPDATE reviews SET admin_status = ?, admin_notes = ?, admin_reviewed_by = ?, admin_reviewed_at = NOW()
      WHERE id = ?
    `).run(admin_status, admin_notes || null, req.user.id, req.params.id);

    res.json({ ok: true });
  } catch (err) {
    console.error("Admin review update error:", err);
    res.status(500).json({ error: "Failed to update review" });
  }
});

// GET /api/admin/reviews/all — All reviews, sortable, with distribution stats
router.get("/reviews/all", requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const { sort, order, minRating, maxRating, limit: lim, offset: off, caregiverId } = req.query;
    const limitN = Math.min(parseInt(lim) || 50, 200);
    const offsetN = parseInt(off) || 0;

    let where = "WHERE COALESCE(fu.is_demo, 0) = 0";
    const params = [];
    if (minRating) { where += " AND r.rating >= ?"; params.push(parseInt(minRating)); }
    if (maxRating) { where += " AND r.rating <= ?"; params.push(parseInt(maxRating)); }
    if (caregiverId) { where += " AND r.caregiver_id = ?"; params.push(caregiverId); }

    const sortCol = ({ rating: 'r.rating', date: 'r.created_at', caregiver: 'caregiver_name' })[sort] || 'r.created_at';
    const sortDir = order === 'asc' ? 'ASC' : 'DESC';

    params.push(limitN, offsetN);

    const rows = await db.prepare(`
      SELECT r.*,
        fu.first_name || ' ' || fu.last_name AS family_name,
        fu.email AS family_email,
        cu.first_name || ' ' || cu.last_name AS caregiver_name,
        cp.rating_avg AS caregiver_rating_avg,
        cp.rating_count AS caregiver_rating_count,
        cs.scheduled_date, cs.scheduled_time, cs.service_type,
        cr.first_name || ' ' || cr.last_name AS recipient_name,
        au.first_name || ' ' || au.last_name AS reviewed_by_name
      FROM reviews r
      JOIN users fu ON r.family_user_id = fu.id
      JOIN caregiver_profiles cp ON r.caregiver_id = cp.id
      JOIN users cu ON cp.user_id = cu.id
      JOIN care_sessions cs ON r.session_id = cs.id
      LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
      LEFT JOIN users au ON r.admin_reviewed_by = au.id
      ${where}
      ORDER BY ${sortCol} ${sortDir}
      LIMIT ? OFFSET ?
    `).all(...params);

    // Total count (reuse same where + join to exclude demos)
    const countRow = await db.prepare(`
      SELECT COUNT(*) AS total FROM reviews r
      JOIN users fu ON r.family_user_id = fu.id
      ${where}
    `).get(...params.slice(0, -2));

    // Distribution: count per rating (exclude demo)
    const dist = await db.prepare(`
      SELECT r.rating, COUNT(*) AS cnt FROM reviews r
      JOIN users fu ON r.family_user_id = fu.id
      WHERE COALESCE(fu.is_demo, 0) = 0
      GROUP BY r.rating ORDER BY r.rating
    `).all();

    // Overall stats (exclude demo)
    const overall = await db.prepare(`
      SELECT COUNT(*) AS total, ROUND(AVG(r.rating), 2) AS avg_rating,
        COUNT(*) FILTER (WHERE r.rating >= 4) AS positive,
        COUNT(*) FILTER (WHERE r.rating <= 2) AS negative,
        COUNT(*) FILTER (WHERE r.comment IS NOT NULL AND r.comment != '') AS with_comments
      FROM reviews r
      JOIN users fu ON r.family_user_id = fu.id
      WHERE COALESCE(fu.is_demo, 0) = 0
    `).get();

    // Flagged count (exclude demo)
    const flagged = await db.prepare(`
      SELECT COUNT(*) AS cnt FROM reviews r
      JOIN users fu ON r.family_user_id = fu.id
      WHERE COALESCE(fu.is_demo, 0) = 0 AND r.rating < 3 AND COALESCE(r.admin_status, 'pending') = 'pending'
    `).get();

    res.json({
      reviews: rows,
      total: countRow?.total || 0,
      distribution: dist,
      stats: { ...overall, flagged_pending: flagged?.cnt || 0 },
    });
  } catch (err) {
    console.error("Admin all reviews fetch error:", err);
    res.status(500).json({ error: "Failed to fetch reviews" });
  }
});

// GET /api/admin/reviews/insights — AI-generated review insights
router.get("/reviews/insights", requireAdmin, async (req, res) => {
  try {
    const db = await getDb();

    // Get recent reviews with comments (last 90 days, exclude demo)
    const recentReviews = await db.prepare(`
      SELECT r.rating, r.comment, r.review_type, r.created_at,
        cu.first_name || ' ' || cu.last_name AS caregiver_name,
        cs.service_type
      FROM reviews r
      JOIN users fu ON r.family_user_id = fu.id
      JOIN caregiver_profiles cp ON r.caregiver_id = cp.id
      JOIN users cu ON cp.user_id = cu.id
      JOIN care_sessions cs ON r.session_id = cs.id
      WHERE r.created_at > NOW() - INTERVAL '90 days' AND COALESCE(fu.is_demo, 0) = 0
      ORDER BY r.created_at DESC
      LIMIT 100
    `).all();

    // Compute insights from the data
    const insights = [];
    const totalRecent = recentReviews.length;
    if (totalRecent === 0) {
      return res.json({ insights: [{ type: 'info', icon: '📭', title: 'No Recent Reviews', detail: 'No reviews in the last 90 days to analyze.' }] });
    }

    const withComments = recentReviews.filter(r => r.comment && r.comment.trim());
    const avgRating = recentReviews.reduce((s, r) => s + r.rating, 0) / totalRecent;
    const positive = recentReviews.filter(r => r.rating >= 4);
    const negative = recentReviews.filter(r => r.rating <= 2);

    // 1. Overall sentiment
    insights.push({
      type: avgRating >= 4 ? 'positive' : avgRating >= 3 ? 'neutral' : 'warning',
      icon: avgRating >= 4 ? '😊' : avgRating >= 3 ? '😐' : '😟',
      title: 'Overall Sentiment',
      detail: `Average rating of ${avgRating.toFixed(1)}/5 across ${totalRecent} reviews in the last 90 days. ${positive.length} positive (4-5★), ${negative.length} negative (1-2★).`,
    });

    // 2. Comment analysis — keyword themes
    const allComments = withComments.map(r => r.comment.toLowerCase()).join(' ');
    const themes = [
      { keywords: ['patient', 'patience', 'calm', 'gentle'], label: 'Patience & gentleness', icon: '🕊️' },
      { keywords: ['kind', 'caring', 'compassion', 'warm', 'sweet'], label: 'Kindness & compassion', icon: '💛' },
      { keywords: ['punctual', 'on time', 'reliable', 'dependable'], label: 'Punctuality & reliability', icon: '⏰' },
      { keywords: ['professional', 'thorough', 'detail', 'organized'], label: 'Professionalism', icon: '👔' },
      { keywords: ['communicate', 'communication', 'update', 'informed'], label: 'Good communication', icon: '💬' },
      { keywords: ['late', 'no show', 'no-show', 'absent', 'missed'], label: 'Attendance issues', icon: '⚠️', negative: true },
      { keywords: ['rude', 'unprofessional', 'disrespect', 'careless'], label: 'Unprofessional behavior', icon: '🚩', negative: true },
      { keywords: ['dirty', 'clean', 'mess', 'hygiene'], label: 'Cleanliness/hygiene mentions', icon: '🧹' },
      { keywords: ['safe', 'safety', 'secure', 'trust'], label: 'Safety & trust', icon: '🛡️' },
      { keywords: ['happy', 'enjoy', 'love', 'wonderful', 'amazing', 'great', 'excellent', 'fantastic'], label: 'Strongly positive language', icon: '🌟' },
    ];

    const detectedThemes = [];
    for (const t of themes) {
      const count = t.keywords.reduce((sum, kw) => sum + (allComments.split(kw).length - 1), 0);
      if (count > 0) detectedThemes.push({ ...t, count });
    }
    detectedThemes.sort((a, b) => b.count - a.count);

    if (detectedThemes.length > 0) {
      const positiveThemes = detectedThemes.filter(t => !t.negative).slice(0, 3);
      const negativeThemes = detectedThemes.filter(t => t.negative);

      if (positiveThemes.length > 0) {
        insights.push({
          type: 'positive',
          icon: '🌟',
          title: 'What Families Appreciate',
          detail: positiveThemes.map(t => `${t.icon} ${t.label} (mentioned ${t.count}x)`).join(' • '),
        });
      }
      if (negativeThemes.length > 0) {
        insights.push({
          type: 'warning',
          icon: '⚠️',
          title: 'Areas of Concern',
          detail: negativeThemes.map(t => `${t.icon} ${t.label} (mentioned ${t.count}x)`).join(' • '),
        });
      }
    }

    // 3. Per-caregiver breakdown
    const caregiverMap = {};
    for (const r of recentReviews) {
      if (!caregiverMap[r.caregiver_name]) caregiverMap[r.caregiver_name] = { ratings: [], comments: [] };
      caregiverMap[r.caregiver_name].ratings.push(r.rating);
      if (r.comment) caregiverMap[r.caregiver_name].comments.push(r.comment);
    }

    // Top performer
    const caregiverAvgs = Object.entries(caregiverMap)
      .filter(([, v]) => v.ratings.length >= 2)
      .map(([name, v]) => ({ name, avg: v.ratings.reduce((s, r) => s + r, 0) / v.ratings.length, count: v.ratings.length }))
      .sort((a, b) => b.avg - a.avg);

    if (caregiverAvgs.length > 0 && caregiverAvgs[0].avg >= 4) {
      insights.push({
        type: 'positive',
        icon: '🏆',
        title: 'Top Rated Caregiver',
        detail: `${caregiverAvgs[0].name} — ${caregiverAvgs[0].avg.toFixed(1)}★ avg across ${caregiverAvgs[0].count} recent reviews.`,
      });
    }

    // Struggling caregiver
    const struggling = caregiverAvgs.filter(c => c.avg < 3);
    if (struggling.length > 0) {
      insights.push({
        type: 'warning',
        icon: '📉',
        title: 'Needs Attention',
        detail: struggling.map(c => `${c.name} (${c.avg.toFixed(1)}★ across ${c.count} reviews)`).join(', ') + ' — consider follow-up coaching.',
      });
    }

    // 4. Trend: last 30 vs prior 30
    const now = new Date();
    const thirtyAgo = new Date(now - 30 * 86400000);
    const sixtyAgo = new Date(now - 60 * 86400000);
    const recent30 = recentReviews.filter(r => new Date(r.created_at) >= thirtyAgo);
    const prior30 = recentReviews.filter(r => { const d = new Date(r.created_at); return d >= sixtyAgo && d < thirtyAgo; });

    if (recent30.length >= 3 && prior30.length >= 3) {
      const recentAvg = recent30.reduce((s, r) => s + r.rating, 0) / recent30.length;
      const priorAvg = prior30.reduce((s, r) => s + r.rating, 0) / prior30.length;
      const delta = recentAvg - priorAvg;
      if (Math.abs(delta) > 0.3) {
        insights.push({
          type: delta > 0 ? 'positive' : 'warning',
          icon: delta > 0 ? '📈' : '📉',
          title: 'Rating Trend',
          detail: `Average rating ${delta > 0 ? 'improved' : 'declined'} from ${priorAvg.toFixed(1)} to ${recentAvg.toFixed(1)} (${delta > 0 ? '+' : ''}${delta.toFixed(1)}) over the last 30 days vs prior 30.`,
        });
      }
    }

    // 5. Comment rate
    const commentRate = withComments.length / totalRecent;
    insights.push({
      type: 'info',
      icon: '💬',
      title: 'Comment Rate',
      detail: `${Math.round(commentRate * 100)}% of reviews include written feedback (${withComments.length}/${totalRecent}).`,
    });

    res.json({ insights });
  } catch (err) {
    console.error("Review insights error:", err);
    res.status(500).json({ error: "Failed to generate insights" });
  }
});

// GET /api/admin/briefing — Admin iPAi briefing: platform health snapshot
router.get("/briefing", requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const briefing = {};

    // 1. Session activity (last 7 days vs prior 7)
    try {
      briefing.sessions = await db.prepare(`
        SELECT
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') AS sessions_7d,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '14 days' AND created_at <= NOW() - INTERVAL '7 days') AS sessions_prior_7d,
          COUNT(*) FILTER (WHERE status = 'completed' AND created_at > NOW() - INTERVAL '7 days') AS completed_7d,
          COUNT(*) FILTER (WHERE status = 'cancelled' AND created_at > NOW() - INTERVAL '7 days') AS cancelled_7d,
          COUNT(*) FILTER (WHERE status = 'pending' OR status = 'confirmed') AS upcoming
        FROM care_sessions
      `).get();
    } catch (e) { console.error("Briefing sessions:", e.message); briefing.sessions = {}; }

    // 2. Caregiver engagement: offer acceptance rate
    try {
      briefing.offers = await db.prepare(`
        SELECT
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') AS offers_7d,
          COUNT(*) FILTER (WHERE status = 'accepted' AND created_at > NOW() - INTERVAL '7 days') AS accepted_7d,
          COUNT(*) FILTER (WHERE status = 'declined' AND created_at > NOW() - INTERVAL '7 days') AS declined_7d,
          COUNT(*) FILTER (WHERE status = 'expired' AND created_at > NOW() - INTERVAL '7 days') AS expired_7d,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '14 days' AND created_at <= NOW() - INTERVAL '7 days') AS offers_prior_7d,
          COUNT(*) FILTER (WHERE status = 'accepted' AND created_at > NOW() - INTERVAL '14 days' AND created_at <= NOW() - INTERVAL '7 days') AS accepted_prior_7d
        FROM session_offers
      `).get();
    } catch (e) { console.error("Briefing offers:", e.message); briefing.offers = {}; }

    // 3. Revenue snapshot — use care_sessions estimated_cost (source of truth)
    try {
      briefing.revenue = await db.prepare(`
        SELECT
          COALESCE(SUM(cs.estimated_cost * 100) FILTER (WHERE cs.completed_at > NOW() - INTERVAL '7 days' OR (cs.completed_at IS NULL AND cs.updated_at > NOW() - INTERVAL '7 days')), 0) AS revenue_7d,
          COALESCE(SUM(cs.estimated_cost * 100) FILTER (WHERE COALESCE(cs.completed_at, cs.updated_at) > NOW() - INTERVAL '14 days' AND COALESCE(cs.completed_at, cs.updated_at) <= NOW() - INTERVAL '7 days'), 0) AS revenue_prior_7d,
          COUNT(*) FILTER (WHERE COALESCE(cs.completed_at, cs.updated_at) > NOW() - INTERVAL '7 days') AS payments_7d,
          0 AS failed_7d
        FROM care_sessions cs
        JOIN users u ON cs.family_user_id = u.id
        WHERE cs.status = 'completed' AND cs.estimated_cost > 0
          AND COALESCE(u.is_demo, 0) = 0
          AND NOT EXISTS (SELECT 1 FROM caregiver_profiles _cp JOIN users _cu ON _cp.user_id = _cu.id WHERE _cp.id = cs.caregiver_id AND _cu.is_demo = 1)
      `).get();
    } catch (e) { console.error("Briefing revenue:", e.message); briefing.revenue = {}; }

    // 4. User growth
    try {
      briefing.users = await db.prepare(`
        SELECT
          COUNT(*) AS total_users,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') AS new_7d,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '14 days' AND created_at <= NOW() - INTERVAL '7 days') AS new_prior_7d,
          0 AS active_7d
        FROM users WHERE COALESCE(is_demo, 0) = 0
      `).get();
    } catch (e) { console.error("Briefing users:", e.message); briefing.users = {}; }

    // 5. Review summary
    try {
      briefing.reviews = await db.prepare(`
        SELECT
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') AS reviews_7d,
          ROUND(AVG(rating) FILTER (WHERE created_at > NOW() - INTERVAL '7 days'), 2) AS avg_rating_7d,
          ROUND(AVG(rating) FILTER (WHERE created_at > NOW() - INTERVAL '14 days' AND created_at <= NOW() - INTERVAL '7 days'), 2) AS avg_rating_prior_7d,
          0 AS flagged_pending
        FROM reviews
      `).get();
    } catch (e) { console.error("Briefing reviews:", e.message); briefing.reviews = {}; }

    // 6. Support tickets
    try {
      briefing.tickets = await db.prepare(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'open' OR status = 'in_progress') AS open_tickets,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') AS new_7d,
          COUNT(*) FILTER (WHERE status = 'resolved' AND updated_at > NOW() - INTERVAL '7 days') AS resolved_7d
        FROM admin_tickets
      `).get();
    } catch (e) { console.error("Briefing tickets:", e.message); briefing.tickets = {}; }

    // 7. Security: recent failed logins
    try {
      briefing.security = await db.prepare(`
        SELECT
          COUNT(*) FILTER (WHERE action = 'login_failed' AND created_at > NOW() - INTERVAL '24 hours') AS failed_logins_24h,
          COUNT(*) FILTER (WHERE severity IN ('critical', 'error') AND created_at > NOW() - INTERVAL '24 hours') AS critical_events_24h
        FROM audit_log
      `).get();
    } catch (e) { console.error("Briefing security:", e.message); briefing.security = {}; }

    // 8. Generate natural-language briefing items
    const items = [];
    const s = briefing.sessions || {};
    const o = briefing.offers || {};
    const r = briefing.revenue || {};
    const u = briefing.users || {};
    const rv = briefing.reviews || {};
    const t = briefing.tickets || {};
    const sec = briefing.security || {};

    // Session activity
    const sessionDelta = s.sessions_prior_7d > 0 ? ((s.sessions_7d - s.sessions_prior_7d) / s.sessions_prior_7d * 100) : null;
    items.push({
      category: 'activity',
      icon: '📅',
      title: 'Session Activity',
      detail: `${s.sessions_7d || 0} sessions this week${sessionDelta !== null ? ` (${sessionDelta > 0 ? '+' : ''}${Math.round(sessionDelta)}% vs last week)` : ''}. ${s.completed_7d || 0} completed, ${s.cancelled_7d || 0} cancelled, ${s.upcoming || 0} upcoming.`,
      sentiment: sessionDelta > 10 ? 'up' : sessionDelta < -10 ? 'down' : 'neutral',
    });

    // Offer acceptance
    const acceptRate = o.offers_7d > 0 ? Math.round(o.accepted_7d / o.offers_7d * 100) : null;
    const priorAcceptRate = o.offers_prior_7d > 0 ? Math.round(o.accepted_prior_7d / o.offers_prior_7d * 100) : null;
    if (o.offers_7d > 0) {
      let offerDetail = `Caregiver offer acceptance rate: ${acceptRate}% (${o.accepted_7d}/${o.offers_7d}).`;
      if (o.expired_7d > 0) offerDetail += ` ${o.expired_7d} offers expired.`;
      if (priorAcceptRate !== null && acceptRate < priorAcceptRate - 10) {
        offerDetail += ` ⚠️ Down from ${priorAcceptRate}% last week — caregivers may be less responsive.`;
      }
      items.push({
        category: 'engagement',
        icon: '🤝',
        title: 'Caregiver Engagement',
        detail: offerDetail,
        sentiment: acceptRate >= 70 ? 'up' : acceptRate >= 40 ? 'neutral' : 'down',
      });
    }

    // Revenue
    const revDollars7d = ((r.revenue_7d || 0) / 100).toFixed(0);
    const revDollarsPrior = ((r.revenue_prior_7d || 0) / 100).toFixed(0);
    const revDelta = r.revenue_prior_7d > 0 ? ((r.revenue_7d - r.revenue_prior_7d) / r.revenue_prior_7d * 100) : null;
    items.push({
      category: 'revenue',
      icon: '💰',
      title: 'Revenue',
      detail: `$${revDollars7d} gross this week (${r.payments_7d || 0} payments)${revDelta !== null ? ` ${revDelta > 0 ? '↑' : '↓'}${Math.abs(Math.round(revDelta))}% vs last week` : ''}.${r.failed_7d > 0 ? ` ⚠️ ${r.failed_7d} failed payments.` : ''}`,
      sentiment: revDelta > 5 ? 'up' : revDelta < -10 ? 'down' : 'neutral',
    });

    // Users
    items.push({
      category: 'growth',
      icon: '👥',
      title: 'User Growth',
      detail: `${u.new_7d || 0} new users this week${u.new_prior_7d > 0 ? ` (was ${u.new_prior_7d} last week)` : ''}. ${u.active_7d || 0} active users. ${u.total_users || 0} total.`,
      sentiment: (u.new_7d || 0) > (u.new_prior_7d || 0) ? 'up' : 'neutral',
    });

    // Reviews
    if (rv.reviews_7d > 0) {
      const ratingDelta = rv.avg_rating_prior_7d ? (rv.avg_rating_7d - rv.avg_rating_prior_7d) : null;
      items.push({
        category: 'satisfaction',
        icon: '⭐',
        title: 'Satisfaction',
        detail: `${rv.reviews_7d} reviews this week, avg ${rv.avg_rating_7d}★${ratingDelta ? ` (${ratingDelta > 0 ? '+' : ''}${ratingDelta.toFixed(1)} vs last week)` : ''}.${rv.flagged_pending > 0 ? ` ⚠️ ${rv.flagged_pending} flagged reviews need attention.` : ''}`,
        sentiment: rv.avg_rating_7d >= 4 ? 'up' : rv.avg_rating_7d >= 3 ? 'neutral' : 'down',
      });
    }

    // Support
    if ((t.open_tickets || 0) > 0 || (t.new_7d || 0) > 0) {
      items.push({
        category: 'support',
        icon: '🎫',
        title: 'Support',
        detail: `${t.open_tickets || 0} open tickets. ${t.new_7d || 0} new this week, ${t.resolved_7d || 0} resolved.`,
        sentiment: (t.open_tickets || 0) > 5 ? 'down' : 'neutral',
      });
    }

    // Security
    if ((sec.failed_logins_24h || 0) > 10 || (sec.critical_events_24h || 0) > 0) {
      items.push({
        category: 'security',
        icon: '🛡️',
        title: 'Security',
        detail: `${sec.failed_logins_24h || 0} failed logins in 24h${sec.critical_events_24h > 0 ? `, ${sec.critical_events_24h} critical events` : ''}. ${sec.failed_logins_24h > 20 ? '⚠️ Elevated — possible brute force.' : 'Normal levels.'}`,
        sentiment: sec.critical_events_24h > 0 ? 'down' : 'neutral',
      });
    }

    briefing.items = items;
    briefing.generatedAt = new Date().toISOString();
    res.json(briefing);
  } catch (err) {
    console.error("Admin briefing error:", err);
    res.status(500).json({ error: "Failed to generate briefing" });
  }
});

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

// ─── GET /api/admin/blocked-emails ─── List all blocked emails
router.get("/blocked-emails", authenticate, checkAdmin, requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const rows = await db.prepare(
      "SELECT be.*, u.first_name || ' ' || u.last_name AS blocked_by_name FROM blocked_emails be LEFT JOIN users u ON be.blocked_by = u.id ORDER BY be.created_at DESC"
    ).all();
    res.json({ blockedEmails: rows });
  } catch (err) {
    console.error("Fetch blocked emails error:", err);
    res.status(500).json({ error: "Failed to fetch blocked emails" });
  }
});

// ─── POST /api/admin/blocked-emails ─── Block an email from registering
router.post("/blocked-emails", authenticate, checkAdmin, requireAdmin, async (req, res) => {
  try {
    const { email, reason } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required" });

    const db = await getDb();
    const existing = await db.prepare("SELECT id FROM blocked_emails WHERE LOWER(email) = LOWER(?)").get(email);
    if (existing) return res.status(409).json({ error: "This email is already blocked" });

    const { v4: uuid } = require("uuid");
    await db.prepare(
      "INSERT INTO blocked_emails (id, email, reason, blocked_by) VALUES (?, LOWER(?), ?, ?)"
    ).run(uuid(), email, reason || null, req.user.id);

    await logAdminAction(req, "block_email", "email", email, { reason });
    res.status(201).json({ message: `${email} has been blocked from registering` });
  } catch (err) {
    console.error("Block email error:", err);
    res.status(500).json({ error: "Failed to block email" });
  }
});

// ─── DELETE /api/admin/blocked-emails/:id ─── Unblock an email
router.delete("/blocked-emails/:id", authenticate, checkAdmin, requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const row = await db.prepare("SELECT email FROM blocked_emails WHERE id = ?").get(req.params.id);
    if (!row) return res.status(404).json({ error: "Blocked email not found" });

    await db.prepare("DELETE FROM blocked_emails WHERE id = ?").run(req.params.id);
    await logAdminAction(req, "unblock_email", "email", row.email, {});
    res.json({ message: `${row.email} has been unblocked` });
  } catch (err) {
    console.error("Unblock email error:", err);
    res.status(500).json({ error: "Failed to unblock email" });
  }
});

// ─── GET /api/admin/users/:id/onboarding — Get caregiver onboarding status ───
router.get("/users/:id/onboarding", async (req, res) => {
  try {
    const db = await getDb();
    const user = await db.prepare("SELECT id, email, role, first_name, last_name, profile_photo, avatar_url FROM users WHERE id = ?").get(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    const profile = await db.prepare(`
      SELECT id, is_background_checked, background_check_consent, background_check_paid,
             onboarding_complete, is_available, stripe_onboard_complete,
             dl_number, dl_state,
             academic_program, academic_program_year, needs_hour_reports
      FROM caregiver_profiles WHERE user_id = ?
    `).get(req.params.id);

    // Check for uploaded documents
    const docs = await db.prepare(
      "SELECT document_type, created_at FROM caregiver_documents WHERE user_id = ? ORDER BY created_at DESC"
    ).all(req.params.id).catch(() => []);

    // Check photo from users table (profile_photo or avatar_url)
    const hasPhoto = !!(user.profile_photo || user.avatar_url);

    // Check identity verification status (selfie + ID)
    let identityVerified = false;
    let identityStatus = null;
    if (profile) {
      const idDoc = await db.prepare(
        `SELECT status, is_verified FROM verified_documents
         WHERE owner_id = ? AND owner_type = 'caregiver' AND category = 'identity' AND document_type != 'selfie'
         ORDER BY created_at DESC LIMIT 1`
      ).get(profile.id);
      if (idDoc) {
        identityVerified = idDoc.status === 'approved';
        identityStatus = idDoc.status; // 'pending', 'approved', 'rejected'
      }
    }

    res.json({
      user: { id: user.id, email: user.email, role: user.role, name: `${user.first_name || ''} ${user.last_name || ''}`.trim() },
      profile: profile || null,
      documents: docs || [],
      flags: profile ? {
        backgroundCheckCleared: !!profile.is_background_checked,
        backgroundCheckPaid: !!profile.background_check_paid,
        backgroundCheckConsent: !!profile.background_check_consent,
        stripeOnboardComplete: !!profile.stripe_onboard_complete,
        onboardingComplete: !!profile.onboarding_complete,
        isAvailable: !!profile.is_available,
        hasPhoto,
        hasDriversLicense: !!(profile.dl_number && profile.dl_state),
        identityVerified,
        identityStatus,
        needsHourReports: !!profile.needs_hour_reports,
        academicProgram: profile.academic_program || null,
        academicProgramYear: profile.academic_program_year || null,
      } : null,
    });
  } catch (err) {
    console.error("Admin onboarding status error:", err);
    res.status(500).json({ error: "Failed to load onboarding status" });
  }
});

// ─── PUT /api/admin/users/:id/onboarding — Admin override caregiver flags ───
router.put("/users/:id/onboarding", async (req, res) => {
  try {
    const db = await getDb();
    const user = await db.prepare("SELECT id, email, role FROM users WHERE id = ?").get(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    const profile = await db.prepare("SELECT id FROM caregiver_profiles WHERE user_id = ?").get(req.params.id);
    if (!profile) return res.status(404).json({ error: "No caregiver profile found for this user" });

    const { backgroundCheckCleared, backgroundCheckPaid, stripeOnboardComplete, onboardingComplete, isAvailable, identityVerified } = req.body;
    // Each flag is now independent — no cascading. Admin picks exactly which steps to skip.
    const colMap = new Map(); // column -> { sql, param? }

    // Identity verification is stored in verified_documents, not caregiver_profiles
    if (identityVerified !== undefined) {
      const idDoc = await db.prepare(
        `SELECT id FROM verified_documents WHERE owner_id = ? AND owner_type = 'caregiver' AND category = 'identity' AND document_type != 'selfie' ORDER BY created_at DESC LIMIT 1`
      ).get(profile.id);
      if (idDoc) {
        await db.prepare(
          "UPDATE verified_documents SET status = ?, is_verified = ?, admin_reviewed_by = ?, admin_reviewed_at = NOW() WHERE id = ?"
        ).run(identityVerified ? 'approved' : 'rejected', identityVerified ? 1 : 0, req.user.id, idDoc.id);
      } else if (identityVerified) {
        // Admin manually approving without a submitted doc — create a placeholder
        await db.prepare(
          `INSERT INTO verified_documents (id, owner_id, owner_type, uploaded_by, category, document_type, file_data, status, is_verified, admin_reviewed_by, admin_reviewed_at, created_at)
           VALUES (?, ?, 'caregiver', ?, 'identity', 'admin_override', '', 'approved', 1, ?, NOW(), NOW())`
        ).run(uuid(), profile.id, req.user.id, req.user.id);
      }
      // If this is the only flag being toggled and no caregiver_profiles columns to update, return early
      if (Object.keys(req.body).length === 1) return res.json({ updated: true, identityVerified });
    }

    if (backgroundCheckCleared !== undefined) {
      colMap.set("is_background_checked", { sql: "is_background_checked = ?", param: backgroundCheckCleared ? 1 : 0 });
      colMap.set("checkr_status", { sql: backgroundCheckCleared ? "checkr_status = 'clear'" : "checkr_status = 'pending'" });
    }
    if (backgroundCheckPaid !== undefined) {
      colMap.set("background_check_paid", { sql: "background_check_paid = ?", param: backgroundCheckPaid ? 1 : 0 });
    }
    if (stripeOnboardComplete !== undefined) {
      colMap.set("stripe_onboard_complete", { sql: "stripe_onboard_complete = ?", param: stripeOnboardComplete ? 1 : 0 });
    }
    if (onboardingComplete !== undefined) {
      colMap.set("onboarding_complete", { sql: "onboarding_complete = ?", param: onboardingComplete ? 1 : 0 });
    }
    if (isAvailable !== undefined) {
      colMap.set("is_available", { sql: "is_available = ?", param: isAvailable ? 1 : 0 });
    }

    if (colMap.size === 0) return res.status(400).json({ error: "No flags to update" });

    const updates = [];
    const params = [];
    for (const entry of colMap.values()) {
      updates.push(entry.sql);
      if (entry.param !== undefined) params.push(entry.param);
    }
    updates.push("updated_at = NOW()");
    params.push(req.params.id);

    await db.prepare(`UPDATE caregiver_profiles SET ${updates.join(", ")} WHERE user_id = ?`).run(...params);

    res.json({ success: true, message: `Updated onboarding flags for ${user.email}`, updatedFlags: req.body });
  } catch (err) {
    console.error("Admin onboarding override error:", err);
    res.status(500).json({ error: "Failed to update onboarding flags" });
  }
});

// ─── PUT /api/admin/users/:id/photo — Admin set profile photo (base64) ───
router.put("/users/:id/photo", async (req, res) => {
  try {
    const db = await getDb();
    const { photo } = req.body;
    if (!photo) return res.status(400).json({ error: "photo is required" });
    const user = await db.prepare("SELECT id, email FROM users WHERE id = ?").get(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });
    await db.prepare("UPDATE users SET profile_photo = ?, avatar_url = ?, updated_at = NOW() WHERE id = ?").run(photo, photo, req.params.id);
    res.json({ success: true, email: user.email });
  } catch (err) {
    console.error("Admin photo update error:", err);
    res.status(500).json({ error: "Failed to update photo" });
  }
});

// ─── PUT /api/admin/users/:id/tester — Toggle is_tester flag ───
router.put("/users/:id/tester", async (req, res) => {
  try {
    const db = await getDb();
    const user = await db.prepare("SELECT id, email, first_name, is_tester FROM users WHERE id = ?").get(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    const newValue = user.is_tester ? 0 : 1;
    await db.prepare("UPDATE users SET is_tester = ? WHERE id = ?").run(newValue, req.params.id);

    // Notify the user
    try {
      const { sendPushToUser } = require("./push");
      const statusText = newValue ? "enabled" : "removed";
      await sendPushToUser(req.params.id, {
        title: "Account Updated",
        body: `An admin has ${statusText} Feedback Tester access for your account.`,
        data: { type: "admin_setting_change", setting: "is_tester", value: !!newValue },
      }, "admin_update");
    } catch (pushErr) { console.log("Push notify skipped:", pushErr.message); }

    res.json({ success: true, is_tester: !!newValue, email: user.email });
  } catch (err) {
    console.error("Admin tester toggle error:", err);
    res.status(500).json({ error: "Failed to toggle tester status" });
  }
});

// ─── PUT /api/admin/users/:id/companion-access — Toggle Kindred access flag ───
router.put("/users/:id/companion-access", async (req, res) => {
  try {
    const db = await getDb();
    const user = await db.prepare("SELECT id, email, first_name, companion_access FROM users WHERE id = ?").get(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    const newValue = user.companion_access ? 0 : 1;
    await db.prepare("UPDATE users SET companion_access = ? WHERE id = ?").run(newValue, req.params.id);

    // Notify the user
    try {
      const { sendPushToUser } = require("./push");
      const statusText = newValue ? "enabled" : "removed";
      await sendPushToUser(req.params.id, {
        title: "Account Updated",
        body: `An admin has ${statusText} Kindred access for your account.`,
        data: { type: "admin_setting_change", setting: "companion_access", value: !!newValue },
      }, "admin_update");
    } catch (pushErr) { console.log("Push notify skipped:", pushErr.message); }

    res.json({ success: true, companion_access: !!newValue, email: user.email });
  } catch (err) {
    console.error("Admin companion-access toggle error:", err);
    res.status(500).json({ error: "Failed to toggle companion access" });
  }
});

// ─── PUT /api/admin/users/:id/verify-email — Admin override: toggle email verification ───
router.put("/users/:id/verify-email", async (req, res) => {
  try {
    const db = await getDb();
    const user = await db.prepare("SELECT id, email, email_verified FROM users WHERE id = ?").get(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    const newValue = user.email_verified ? 0 : 1;
    await db.prepare("UPDATE users SET email_verified = ?, email_verified_at = NOW(), updated_at = NOW() WHERE id = ?").run(newValue, req.params.id);

    // Clean up any lingering verification tokens
    if (newValue === 1) {
      await db.prepare("DELETE FROM email_verification_tokens WHERE user_id = ?").run(req.params.id);
    }

    console.log(`  [admin] Email verification ${newValue ? 'granted' : 'revoked'} for ${user.email} by admin`);
    res.json({ success: true, email_verified: !!newValue, email: user.email });
  } catch (err) {
    console.error("Admin verify-email toggle error:", err);
    res.status(500).json({ error: "Failed to toggle email verification" });
  }
});

// ─── POST /api/admin/reseed — Refresh demo data (PRESERVES real users) ───
// Always uses demoOnly mode — real user data is NEVER touched.
// Still requires confirmation as a safety measure.
router.post("/reseed", async (req, res) => {
  try {
    const { confirm } = req.body || {};

    // Gate: Require confirmation string
    if (confirm !== "REFRESH_DEMO_DATA") {
      return res.status(400).json({
        error: "Reseed requires confirmation.",
        required: { confirm: "REFRESH_DEMO_DATA" },
        hint: "This will delete and re-insert all demo (is_demo=1) data. Real user data is preserved.",
      });
    }

    const db = await getDb();

    // Count what exists before reseed for logging
    const demoCount = await db.prepare("SELECT COUNT(*) as count FROM users WHERE is_demo = 1").get();
    const realCount = await db.prepare("SELECT COUNT(*) as count FROM users WHERE is_demo = 0 OR is_demo IS NULL").get();

    console.log(`🔄 Admin-triggered demo reseed: ${demoCount.count} demo users to refresh, ${realCount.count} real user(s) preserved`);

    // Proceed with demo-only reseed — real data untouched
    const { seed } = require("../seed");
    await seed({ demoOnly: true });

    console.log("✅ Admin-triggered demo reseed complete");
    res.json({
      success: true,
      message: "Demo data refreshed. Real user data preserved.",
      demo_users_refreshed: parseInt(demoCount.count),
      real_users_preserved: parseInt(realCount.count),
    });
  } catch (err) {
    console.error("Admin reseed error:", err);
    console.error("Reseed error:", err.message); res.status(500).json({ error: "Reseed failed" });
  }
});

// ─── GET /api/admin/reseed-backups — List available pre-reseed backups ───
router.get("/reseed-backups", async (req, res) => {
  try {
    const db = await getDb();
    // Check if backup table exists
    const tableExists = await db.prepare(
      "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = '_reseed_backups')"
    ).get();
    if (!tableExists || !Object.values(tableExists)[0]) {
      return res.json({ backups: [], message: "No backups table found — no reseeds have been performed with the safeguarded endpoint." });
    }
    const backups = await db.prepare(
      "SELECT id, created_at, LENGTH(data) AS data_size_bytes FROM _reseed_backups ORDER BY created_at DESC"
    ).all();
    res.json({ backups });
  } catch (err) {
    console.error("Admin API error:", err.message); res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/admin/reseed-backups/:id — Retrieve a specific backup ───
router.get("/reseed-backups/:id", async (req, res) => {
  try {
    const db = await getDb();
    const backup = await db.prepare("SELECT * FROM _reseed_backups WHERE id = ?").get(req.params.id);
    if (!backup) return res.status(404).json({ error: "Backup not found" });
    res.json({ id: backup.id, created_at: backup.created_at, data: JSON.parse(backup.data) });
  } catch (err) {
    console.error("Admin API error:", err.message); res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/admin/restore-user — Restore a user from a backup snapshot ───
router.post("/restore-user", async (req, res) => {
  try {
    const { backup_id, email } = req.body || {};
    if (!backup_id || !email) {
      return res.status(400).json({ error: "Required: backup_id and email" });
    }

    const db = await getDb();
    const backupRow = await db.prepare("SELECT data FROM _reseed_backups WHERE id = ?").get(backup_id);
    if (!backupRow) return res.status(404).json({ error: "Backup not found" });

    const data = JSON.parse(backupRow.data);
    const user = data.users?.find(u => u.email === email);
    if (!user) return res.status(404).json({ error: `User ${email} not found in backup ${backup_id}` });

    // Check if user already exists
    const existing = await db.prepare("SELECT id FROM users WHERE email = ?").get(email);
    if (existing) {
      return res.status(409).json({ error: `User ${email} already exists (id: ${existing.id}). Delete first or use a different approach.` });
    }

    // Re-insert the user with their original data
    await db.prepare(`
      INSERT INTO users (id, email, password_hash, role, roles, first_name, last_name, phone,
        is_active, is_demo, is_admin, email_verified, notification_prefs,
        pets, pet_allergies, food_allergies, medical_conditions, disclaimer_accepted_at, disclaimer_version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      user.id, user.email, user.password_hash, user.role, user.roles,
      user.first_name, user.last_name, user.phone,
      user.is_active ?? 1, user.is_demo ?? 0, user.is_admin ?? 0,
      user.email_verified ?? 0, user.notification_prefs,
      user.pets, user.pet_allergies, user.food_allergies, user.medical_conditions,
      user.disclaimer_accepted_at, user.disclaimer_version
    );

    res.json({
      success: true,
      message: `User ${email} restored from backup ${backup_id}`,
      user: { id: user.id, email: user.email, first_name: user.first_name, last_name: user.last_name, role: user.role },
    });
  } catch (err) {
    console.error("Restore user error:", err);
    console.error("Admin API error:", err.message); res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/admin/repair-demo — Insert missing demo data (care recipients, profiles, assignments) ───
router.post("/repair-demo", async (req, res) => {
  try {
    const db = await getDb();
    const { v4: uuid } = require("uuid");
    const results = [];

    // Look up existing demo user IDs
    const demoUsers = await db.prepare("SELECT id, email, role FROM users WHERE is_demo = 1").all();
    const findUser = (email) => {
      const u = demoUsers.find(x => x.email === email);
      return u ? u.id : null;
    };

    const peteId = findUser("paul@inplace.care");
    const mariaUserId = findUser("maria@inplace.care");
    const jamesUserId = findUser("james@inplace.care");
    const sarahUserId = findUser("sarah@inplace.care");
    const davidUserId = findUser("david@inplace.care");
    const bettyUserId = findUser("barbara@inplace.care");
    const davidLeeId = findUser("david.lowe@inplace.care");
    const susanLeeId = findUser("susan.lowe@inplace.care");
    const hendersonFamilyId = findUser("linda@inplace.care");
    const patelFamilyId = findUser("raj@inplace.care");

    if (!peteId || !mariaUserId) {
      return res.status(400).json({ error: "Required demo users not found", found: demoUsers.map(u => u.email) });
    }

    // Check which care recipients already exist per demo family user
    const existingCR = await db.prepare("SELECT family_user_id FROM care_recipients WHERE family_user_id IN (SELECT id FROM users WHERE is_demo = 1)").all();
    const existingFamilyIds = new Set(existingCR.map(r => r.family_user_id));

    // ─── Care Recipients ───
    const bettyId = uuid(), dorothyId = uuid(), arunId = uuid(), carlosId = uuid();

    if (peteId && !existingFamilyIds.has(peteId)) {
      await db.prepare(`INSERT INTO care_recipients (id, family_user_id, first_name, last_name, age, location_address, location_city, location_state, location_zip, latitude, longitude, health_conditions, medications, preferences, emergency_contact_name, emergency_contact_phone, pets, pet_allergies, food_allergies, medical_conditions) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        bettyId, peteId, "Barbara", "Lowe", 78, "123 Main Street", "Blacksburg", "VA", "24060", 37.2296, -80.4139,
        JSON.stringify(["Early-stage dementia (diagnosed 2024)","Mild arthritis — both knees","High blood pressure (controlled)","Occasional vertigo when standing quickly","Poor hearing in left ear — wears hearing aid"]),
        JSON.stringify(["Donepezil 10mg daily (evening)","Lisinopril 10mg daily (morning)","Ibuprofen 200mg PRN for knee pain","Calcium + Vitamin D supplement","Baby aspirin 81mg daily"]),
        "Prefers female caregivers. Loves gardening and old movies. Needs gentle reminders for meals and medications.",
        "Paul Lowe", "(626) 555-0142",
        "2 cats — Whiskers (orange tabby) and Mittens (calico)", "None known",
        JSON.stringify(["Peanuts (severe — carries EpiPen)","Shellfish (mild — causes hives)"]),
        "Early-stage dementia, mild arthritis, high blood pressure, occasional vertigo, poor hearing left ear"
      );
      results.push("Barbara Lowe created");
    } else { results.push("Barbara skipped (exists or no Paul)"); }

    if (hendersonFamilyId && !existingFamilyIds.has(hendersonFamilyId)) {
      await db.prepare(`INSERT INTO care_recipients (id, family_user_id, first_name, last_name, age, location_address, location_city, location_state, location_zip, latitude, longitude, health_conditions, medications, preferences, emergency_contact_name, emergency_contact_phone, pets, pet_allergies, food_allergies, medical_conditions) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        dorothyId, hendersonFamilyId, "Dorothy", "Henderson", 82, "456 Oak Avenue", "Blacksburg", "VA", "24060", 37.2340, -80.4180,
        JSON.stringify(["Type 2 diabetes","Hearing loss"]), JSON.stringify(["Metformin 500mg twice daily","Vitamin B12"]),
        "Enjoys reading and birdwatching. Needs help with meal prep and grocery shopping.",
        "Linda Henderson", "(540) 555-0301", "1 cat — Pepper (black, indoor, senior, 14 yrs)", "None known", JSON.stringify([]),
        "Type 2 diabetes, hearing loss"
      );
      results.push("Dorothy Henderson created");
    } else { results.push("Dorothy skipped (exists or no Linda)"); }

    if (patelFamilyId && !existingFamilyIds.has(patelFamilyId)) {
      await db.prepare(`INSERT INTO care_recipients (id, family_user_id, first_name, last_name, age, location_address, location_city, location_state, location_zip, latitude, longitude, health_conditions, medications, preferences, emergency_contact_name, emergency_contact_phone, pets, pet_allergies, food_allergies, medical_conditions) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        arunId, patelFamilyId, "Arun", "Patel", 85, "789 Elm Drive", "Christiansburg", "VA", "24073", 37.1320, -80.4100,
        JSON.stringify(["Parkinson's disease (early stage)","Mild cognitive impairment"]), JSON.stringify(["Levodopa/Carbidopa","Memantine 10mg daily"]),
        "Speaks Hindi and English. Vegetarian. Enjoys chess and cricket on TV.",
        "Raj Patel", "(540) 555-0302", "None", "None known", JSON.stringify(["None"]),
        "Parkinson's disease (early stage), mild cognitive impairment"
      );
      results.push("Arun Patel created");
    } else { results.push("Arun skipped (exists or no Raj)"); }

    if (mariaUserId && !existingFamilyIds.has(mariaUserId)) {
      await db.prepare(`INSERT INTO care_recipients (id, family_user_id, first_name, last_name, age, location_address, location_city, location_state, location_zip, latitude, longitude, health_conditions, medications, preferences, emergency_contact_name, emergency_contact_phone, pets, pet_allergies, food_allergies, medical_conditions) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        carlosId, mariaUserId, "Carlos", "Santos", 30, "321 Pine Road", "Blacksburg", "VA", "24060", 37.2270, -80.4110,
        JSON.stringify(["Traumatic brain injury (recovery)","Short-term memory issues","Mild left-side weakness","Anxiety"]),
        JSON.stringify(["Sertraline 50mg daily","Gabapentin 300mg twice daily","Melatonin 5mg nightly"]),
        "Loves sports and video games. Responds well to routine and patience.",
        "Maria Santos", "(540) 555-0201", "1 dog — Luna (golden retriever, therapy dog)", "None known",
        JSON.stringify(["Dairy (moderate — causes stomach cramps)"]),
        "Traumatic brain injury (recovery), short-term memory issues, mild left-side weakness, anxiety"
      );
      results.push("Carlos Santos created");
    } else { results.push("Carlos skipped (exists)"); }

    // ─── Look up actual care recipient IDs from DB (some may have been skipped if they already existed) ───
    const actualBetty = peteId ? await db.prepare("SELECT id FROM care_recipients WHERE first_name='Barbara' AND last_name='Lowe' AND family_user_id=?").get(peteId) : null;
    const actualDorothy = hendersonFamilyId ? await db.prepare("SELECT id FROM care_recipients WHERE first_name='Dorothy' AND last_name='Henderson' AND family_user_id=?").get(hendersonFamilyId) : null;
    const actualArun = patelFamilyId ? await db.prepare("SELECT id FROM care_recipients WHERE first_name='Arun' AND last_name='Patel' AND family_user_id=?").get(patelFamilyId) : null;
    const actualCarlos = mariaUserId ? await db.prepare("SELECT id FROM care_recipients WHERE first_name='Carlos' AND last_name='Santos' AND family_user_id=?").get(mariaUserId) : null;

    // Use actual DB IDs (not the UUID variables which may not have been inserted)
    const realBettyId = actualBetty?.id;
    const realDorothyId = actualDorothy?.id;
    const realArunId = actualArun?.id;
    const realCarlosId = actualCarlos?.id;
    results.push(`Resolved care recipient IDs: Betty=${!!realBettyId}, Dorothy=${!!realDorothyId}, Arun=${!!realArunId}, Carlos=${!!realCarlosId}`);

    // ─── Caregiver Profiles ───
    const existingProfiles = await db.prepare("SELECT COUNT(*) as count FROM caregiver_profiles WHERE user_id IN (SELECT id FROM users WHERE is_demo = 1)").get();
    const mariaId = uuid(), jamesId = uuid(), sarahId = uuid(), davidId = uuid();

    if (parseInt(existingProfiles.count) === 0) {
      const stoplights = {
        maria: { 'Bathing / Showering':'green','Toileting':'green','Dressing':'green','Feeding / Meal Assistance':'green','Medication Reminders':'green','Mobility / Transfer':'green','Light Housekeeping':'green','Laundry':'green','Meal Preparation':'green','Grocery Shopping':'green','Transportation / Errands':'green','Companionship':'green','Exercise / Physical Therapy':'yellow','Wound Care':'yellow','Dementia / Memory Care':'green','Hospice / End-of-Life':'red' },
        james: { 'Bathing / Showering':'yellow','Toileting':'yellow','Dressing':'green','Feeding / Meal Assistance':'green','Medication Reminders':'green','Mobility / Transfer':'green','Light Housekeeping':'green','Laundry':'green','Meal Preparation':'yellow','Grocery Shopping':'green','Transportation / Errands':'green','Companionship':'green','Exercise / Physical Therapy':'green','Wound Care':'red','Dementia / Memory Care':'yellow','Hospice / End-of-Life':'red' },
        sarah: { 'Bathing / Showering':'green','Toileting':'green','Dressing':'green','Feeding / Meal Assistance':'green','Medication Reminders':'green','Mobility / Transfer':'green','Light Housekeeping':'yellow','Laundry':'yellow','Meal Preparation':'green','Grocery Shopping':'green','Transportation / Errands':'yellow','Companionship':'green','Exercise / Physical Therapy':'green','Wound Care':'green','Dementia / Memory Care':'green','Hospice / End-of-Life':'yellow' },
        david: { 'Bathing / Showering':'yellow','Toileting':'red','Dressing':'green','Feeding / Meal Assistance':'green','Medication Reminders':'green','Mobility / Transfer':'green','Light Housekeeping':'green','Laundry':'green','Meal Preparation':'yellow','Grocery Shopping':'green','Transportation / Errands':'green','Companionship':'green','Exercise / Physical Therapy':'green','Wound Care':'red','Dementia / Memory Care':'yellow','Hospice / End-of-Life':'red' },
      };

      const profs = [
        [mariaId, mariaUserId, "Certified dementia care specialist with 8 years of experience.", 8, 34, ["Dementia Care","Meal Prep"], ["CNA","CPR/First Aid"], 1, 4.9, 127, "Blacksburg", "VA", 37.2300, -80.4145, "Blacksburg, VA 24060", 15, stoplights.maria],
        [jamesId, jamesUserId, "Former social worker passionate about elder care.", 5, 25, ["Companionship","Transportation"], ["CPR/First Aid","Social Work License"], 1, 4.8, 93, "Blacksburg", "VA", 37.2310, -80.4160, "Blacksburg, VA 24060", 10, stoplights.james],
        [sarahId, sarahUserId, "Registered nurse turned home caregiver.", 12, 32, ["Meal Prep","Medication Reminders"], ["RN","Nutrition Certificate","CPR/First Aid"], 0, 4.9, 156, "Christiansburg", "VA", 37.1298, -80.4089, "Christiansburg, VA 24073", 25, stoplights.sarah],
        [davidId, davidUserId, "Reliable and patient. Great with seniors.", 3, 22, ["Errands","Light Housekeeping"], ["CPR/First Aid"], 1, 4.7, 68, "Blacksburg", "VA", 37.2280, -80.4200, "Blacksburg, VA 24060", 10, stoplights.david],
      ];
      for (const [id,uid,bio,yrs,rate,specs,certs,avail,rating,cnt,city,st,lat,lng,wl,rad,sl] of profs) {
        await db.prepare(`INSERT INTO caregiver_profiles (id,user_id,bio,years_experience,hourly_rate,specialties,certifications,is_background_checked,is_available,rating_avg,rating_count,location_city,location_state,latitude,longitude,work_location_address,max_travel_miles,care_stoplight,terms_accepted_at,terms_version,background_check_consent,background_check_consent_at) VALUES (?,?,?,?,?,?,?,1,?,?,?,?,?,?,?,?,?,?,NOW()-INTERVAL '30 days','1.0',1,NOW()-INTERVAL '30 days')`).run(
          id,uid,bio,yrs,rate,JSON.stringify(specs),JSON.stringify(certs),avail,rating,cnt,city,st,lat,lng,wl,rad,JSON.stringify(sl));
      }
      await db.prepare(`UPDATE caregiver_profiles SET onboarding_complete=1,checkr_status='clear',legal_first_name='Maria',legal_last_name='Santos',date_of_birth='1992-03-15',ssn_last4='4829',dl_number='S520-4829-0315',dl_state='VA' WHERE id=?`).run(mariaId);
      await db.prepare(`UPDATE caregiver_profiles SET checkr_status='pending',legal_first_name='James',legal_last_name='Okafor' WHERE id=?`).run(jamesId);
      results.push("4 caregiver profiles created");
    } else {
      // Profiles exist — look up their IDs for assignments
      const mp = await db.prepare("SELECT id FROM caregiver_profiles WHERE user_id=?").get(mariaUserId);
      const jp = await db.prepare("SELECT id FROM caregiver_profiles WHERE user_id=?").get(jamesUserId);
      const sp = await db.prepare("SELECT id FROM caregiver_profiles WHERE user_id=?").get(sarahUserId);
      // Use existing profile IDs instead
      Object.assign({ mariaId: mp?.id, jamesId: jp?.id, sarahId: sp?.id });
      results.push("Caregiver profiles already exist — skipped");
    }

    // ─── Assignments ───
    // Use the profile IDs we just created (or looked up)
    const mProf = await db.prepare("SELECT id FROM caregiver_profiles WHERE user_id=?").get(mariaUserId);
    const jProf = await db.prepare("SELECT id FROM caregiver_profiles WHERE user_id=?").get(jamesUserId);
    const sProf = await db.prepare("SELECT id FROM caregiver_profiles WHERE user_id=?").get(sarahUserId);

    const existingAssign = await db.prepare("SELECT COUNT(*) as count FROM caregiver_assignments WHERE family_user_id IN (SELECT id FROM users WHERE is_demo = 1)").get();
    if (parseInt(existingAssign.count) === 0 && mProf && jProf && sProf) {
      let assignCount = 0;
      const tryAssign = async (crId, famId, profId, fav) => {
        if (!crId || !famId || !profId) return;
        await db.prepare(`INSERT INTO caregiver_assignments (id,care_recipient_id,family_user_id,caregiver_profile_id,is_active,is_favorite) VALUES (?,?,?,?,1,?)`).run(uuid(), crId, famId, profId, fav);
        assignCount++;
      };
      await tryAssign(realBettyId, peteId, mProf.id, 1);
      await tryAssign(realBettyId, peteId, jProf.id, 0);
      await tryAssign(realDorothyId, hendersonFamilyId, mProf.id, 1);
      await tryAssign(realDorothyId, hendersonFamilyId, sProf.id, 0);
      await tryAssign(realArunId, patelFamilyId, jProf.id, 0);
      await tryAssign(realBettyId, davidLeeId, jProf.id, 0);
      await tryAssign(realBettyId, susanLeeId, jProf.id, 0);
      await tryAssign(realArunId, patelFamilyId, mProf.id, 0);
      await tryAssign(realCarlosId, mariaUserId, sProf.id, 1);
      await tryAssign(realCarlosId, mariaUserId, jProf.id, 0);
      results.push(`${assignCount} caregiver assignments created`);
    } else {
      results.push("Assignments already exist or profiles missing — skipped");
    }

    // ─── Avatars ───
    const avatars = [
      [mariaUserId, "maria@inplace.care"], [jamesUserId, "james@inplace.care"],
      [sarahUserId, "sarah@inplace.care"], [davidUserId, "david@inplace.care"],
      [peteId, "paul@inplace.care"], [bettyUserId, "barbara@inplace.care"],
      [davidLeeId, "david.lowe@inplace.care"], [susanLeeId, "susan.lowe@inplace.care"],
    ];
    for (const [uid, email] of avatars) {
      if (uid) await db.prepare(`UPDATE users SET avatar_url=?, profile_photo=? WHERE id=? AND is_demo=1`).run(`https://i.pravatar.cc/150?u=${email}`, `https://i.pravatar.cc/150?u=${email}`, uid);
    }
    results.push("Avatars set");

    // ─── Sibling shares ───
    try {
      if (realBettyId && peteId && davidLeeId) {
        await db.prepare(`INSERT INTO care_recipient_shares (id,care_recipient_id,owner_user_id,shared_with_user_id,permission) VALUES (?,?,?,?,'edit')`).run(uuid(), realBettyId, peteId, davidLeeId);
      }
      if (realBettyId && peteId && susanLeeId) {
        await db.prepare(`INSERT INTO care_recipient_shares (id,care_recipient_id,owner_user_id,shared_with_user_id,permission) VALUES (?,?,?,?,'edit')`).run(uuid(), realBettyId, peteId, susanLeeId);
      }
      results.push("Barbara shared with siblings");
    } catch (e) { results.push("Shares skipped (may already exist)"); }

    // ─── Availability ───
    const existingAvail = await db.prepare("SELECT COUNT(*) as count FROM availability WHERE caregiver_id IN (SELECT id FROM caregiver_profiles WHERE user_id IN (SELECT id FROM users WHERE is_demo = 1))").get();
    if (parseInt(existingAvail.count) === 0 && mProf) {
      for (let day = 1; day <= 5; day++) await db.prepare(`INSERT INTO availability (id,caregiver_id,day_of_week,start_time,end_time,type) VALUES (?,?,?,'08:00','17:00','available')`).run(uuid(), mProf.id, day);
      await db.prepare(`INSERT INTO availability (id,caregiver_id,day_of_week,start_time,end_time,type,note) VALUES (?,?,3,'14:00','16:00','blocked','Personal appointment')`).run(uuid(), mProf.id);
      if (jProf) {
        for (let day = 1; day <= 5; day++) await db.prepare(`INSERT INTO availability (id,caregiver_id,day_of_week,start_time,end_time,type) VALUES (?,?,?,'07:00','15:00','available')`).run(uuid(), jProf.id, day);
        await db.prepare(`INSERT INTO availability (id,caregiver_id,day_of_week,start_time,end_time,type) VALUES (?,?,6,'08:00','12:00','available')`).run(uuid(), jProf.id);
      }
      const dProf = await db.prepare("SELECT id FROM caregiver_profiles WHERE user_id=?").get(davidUserId);
      if (dProf) { for (let day = 1; day <= 5; day++) await db.prepare(`INSERT INTO availability (id,caregiver_id,day_of_week,start_time,end_time,type) VALUES (?,?,?,'08:00','17:00','available')`).run(uuid(), dProf.id, day); }
      if (sProf) { for (const day of [1,2,4,5]) await db.prepare(`INSERT INTO availability (id,caregiver_id,day_of_week,start_time,end_time,type) VALUES (?,?,?,'09:00','17:00','available')`).run(uuid(), sProf.id, day); }
      results.push("Availability windows created");
    } else {
      results.push("Availability already exists — skipped");
    }

    console.log("✅ Demo repair complete:", results);
    res.json({ ok: true, results });
  } catch (err) {
    console.error("❌ Demo repair error:", err);
    console.error("Admin API error:", err.message); res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/admin/reseed-demo ───
// Full demo-only reseed: deletes all demo user data (cascading), then re-creates
// everything from seed.js with rich data (sessions, messages, notes, reviews, etc.)
// Real user data is NEVER touched.
router.post("/reseed-demo", authenticate, checkAdmin, requireAdmin, async (req, res) => {
  try {
    console.log("🔄 Admin triggered demo-only reseed...");
    const { seed } = require("../seed");
    await seed({ demoOnly: true });
    console.log("✅ Demo reseed complete");
    res.json({ ok: true, message: "Demo data fully reseeded with all rich data (sessions, messages, notes, reviews, care teams, etc.)" });
  } catch (err) {
    console.error("❌ Demo reseed error:", err);
    console.error("Admin API error:", err.message); res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/admin/audit-log — View admin audit trail ───
router.get("/audit-log", async (req, res) => {
  try {
    const db = await getDb();
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const rows = await db.prepare(`
      SELECT al.*, u.email AS admin_email, u.first_name AS admin_first_name
      FROM admin_audit_log al
      LEFT JOIN users u ON al.admin_user_id = u.id
      ORDER BY al.created_at DESC
      LIMIT ?
    `).all(limit);
    res.json({ auditLog: rows });
  } catch (err) {
    console.error("Audit log fetch error:", err);
    res.status(500).json({ error: "Failed to fetch audit log" });
  }
});

// ─── PUT /api/admin/sessions/:id/status — Admin force-set session status ───
router.put("/sessions/:id/status", async (req, res) => {
  try {
    // Auth handled by router-level authenticate + requireAdmin middleware
    const db = await getDb();
    const { status, offered_to_caregiver_id } = req.body;

    // Allow patching offered_to_caregiver_id without changing status
    if (offered_to_caregiver_id !== undefined) {
      await db.prepare("UPDATE care_sessions SET offered_to_caregiver_id = ?, updated_at = NOW() WHERE id = ?").run(offered_to_caregiver_id || null, req.params.id);
    }

    if (status) {
      const validStatuses = ["requested", "open", "pending", "confirmed", "in_progress", "completed", "cancelled", "matching", "negotiating"];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: `Invalid status '${status}'` });
      }
      await db.prepare("UPDATE care_sessions SET status = ?, updated_at = NOW() WHERE id = ?").run(status, req.params.id);
    }

    const session = await db.prepare("SELECT id, status, scheduled_date, scheduled_time, offered_to_caregiver_id FROM care_sessions WHERE id = ?").get(req.params.id);
    res.json({ session });
  } catch (err) {
    console.error("Admin session status error:", err);
    res.status(500).json({ error: "Failed to update session status" });
  }
});

// ─── PUT /api/admin/caregivers/:userId/early-check-in — Toggle early check-in permission ───
router.put("/caregivers/:userId/early-check-in", async (req, res) => {
  try {
    const db = await getDb();
    const { allowed } = req.body;
    if (allowed === undefined) {
      return res.status(400).json({ error: "Missing 'allowed' field (true/false)" });
    }
    const profile = await db.prepare(
      "SELECT id FROM caregiver_profiles WHERE user_id = ?"
    ).get(req.params.userId);
    if (!profile) {
      return res.status(404).json({ error: "Caregiver profile not found for this user" });
    }
    await db.prepare(
      "UPDATE caregiver_profiles SET early_check_in_allowed = ?, updated_at = NOW() WHERE user_id = ?"
    ).run(allowed ? 1 : 0, req.params.userId);
    const user = await db.prepare("SELECT first_name, last_name, email FROM users WHERE id = ?").get(req.params.userId);
    console.log(`  Admin: early_check_in_allowed=${allowed ? 1 : 0} for ${user?.email || req.params.userId}`);
    res.json({
      userId: req.params.userId,
      earlyCheckInAllowed: !!allowed,
      name: user ? `${user.first_name} ${user.last_name}` : null,
    });
  } catch (err) {
    console.error("Admin early check-in error:", err);
    res.status(500).json({ error: "Failed to update early check-in permission" });
  }
});

// ─── GET /api/admin/sessions/open — List open sessions for admin ───
router.get("/sessions/open", async (req, res) => {
  try {
    const db = await getDb();
    const rows = await db.prepare(`
      SELECT cs.id, cs.status, cs.scheduled_date, cs.scheduled_time, cs.offered_to_caregiver_id,
        cr.first_name || ' ' || cr.last_name AS recipient_name
      FROM care_sessions cs
      LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
      WHERE cs.status IN ('requested','open','pending')
      ORDER BY cs.created_at DESC LIMIT 20
    `).all();
    res.json({ sessions: rows });
  } catch (err) {
    console.error("Admin open sessions error:", err);
    res.status(500).json({ error: "Failed to fetch open sessions" });
  }
});

// ─── GET /api/admin/sessions/all ───
// List all sessions (any status) for admin drill-down. Supports ?status= and ?days= filters.
router.get("/sessions/all", authenticate, requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const statusFilter = req.query.status;
    const days = parseInt(req.query.days) || 30;

    let where = `cs.scheduled_date::date >= CURRENT_DATE - INTERVAL '${days} days'`;
    const params = [];
    if (statusFilter && statusFilter !== 'all') {
      where += ` AND cs.status = ?`;
      params.push(statusFilter);
    }

    const rows = await db.prepare(`
      SELECT cs.id, cs.status, cs.scheduled_date, cs.scheduled_time, cs.service_type,
        cs.duration_hours, cs.payment_status, cs.caregiver_no_show,
        cs.cancelled_by, cs.review_required,
        cr.first_name || ' ' || cr.last_name AS recipient_name,
        cu.first_name || ' ' || cu.last_name AS caregiver_name,
        fu.first_name || ' ' || fu.last_name AS family_name
      FROM care_sessions cs
      LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
      LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
      LEFT JOIN users cu ON cp.user_id = cu.id
      LEFT JOIN users fu ON cs.family_user_id = fu.id
      WHERE ${where}
      ORDER BY cs.scheduled_date DESC, cs.scheduled_time DESC
      LIMIT 100
    `).all(...params);

    // Quick counts by status
    const counts = {};
    for (const r of rows) {
      counts[r.status] = (counts[r.status] || 0) + 1;
    }

    res.json({ sessions: rows, counts, days });
  } catch (err) {
    console.error("Admin all sessions error:", err);
    res.status(500).json({ error: "Failed to fetch sessions" });
  }
});

// ─── GET /api/admin/feedback/triage — One-call feedback summary for fast triage ───
// Returns: counts by status, all new items with full detail, recently reviewed items
router.get("/feedback/triage", async (req, res) => {
  try {
    const db = await getDb();

    // Counts by status
    const statusCounts = await db.prepare(`
      SELECT status, COUNT(*) as count FROM feedback GROUP BY status
    `).all();
    const counts = { new: 0, reviewed: 0, planned: 0, done: 0, dismissed: 0 };
    statusCounts.forEach(r => { counts[r.status] = parseInt(r.count); });

    // All 'new' items with user info (these need triage)
    const newItems = await db.prepare(`
      SELECT f.id, f.category, f.description, f.mood, f.status, f.admin_notes, f.tags, f.page_context,
             f.created_at, u.first_name, u.last_name, u.email, u.role AS user_role
      FROM feedback f
      LEFT JOIN users u ON f.user_id = u.id
      WHERE f.status = 'new'
      ORDER BY f.created_at DESC
    `).all();

    // Recently reviewed items (last 7 days) for cross-reference
    const recentReviewed = await db.prepare(`
      SELECT f.id, f.category, f.description, f.mood, f.status, f.admin_notes, f.tags,
             f.created_at, f.updated_at, u.first_name, u.last_name, u.email
      FROM feedback f
      LEFT JOIN users u ON f.user_id = u.id
      WHERE f.status IN ('reviewed', 'planned')
      AND f.updated_at > NOW() - INTERVAL '7 days'
      ORDER BY f.updated_at DESC
    `).all();

    const formatItem = (f) => ({
      id: f.id,
      category: f.category,
      description: f.description,
      mood: f.mood,
      status: f.status,
      adminNotes: f.admin_notes,
      tags: f.tags ? JSON.parse(f.tags) : [],
      pageContext: f.page_context ? JSON.parse(f.page_context) : null,
      userName: f.first_name ? `${f.first_name} ${f.last_name}` : "Anonymous",
      userEmail: f.email || "—",
      userRole: f.user_role || "—",
      createdAt: f.created_at,
      updatedAt: f.updated_at,
    });

    res.json({
      counts,
      newItems: newItems.map(formatItem),
      recentReviewed: recentReviewed.map(formatItem),
      summary: `${counts.new} new, ${counts.reviewed} reviewed, ${counts.planned} planned, ${counts.done} done, ${counts.dismissed} dismissed`,
    });
  } catch (err) {
    console.error("Admin feedback triage error:", err);
    res.status(500).json({ error: "Failed to load feedback triage" });
  }
});

// ─── POST /api/admin/feedback/bulk-update — Update multiple feedback items at once ───
// Body: { updates: [{ id, status, adminNotes? }] }
router.post("/feedback/bulk-update", async (req, res) => {
  try {
    const db = await getDb();
    const { updates } = req.body;

    if (!Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({ error: "updates array is required" });
    }

    const validStatuses = ['new', 'reviewed', 'planned', 'done', 'dismissed'];
    const results = [];

    for (const item of updates) {
      if (!item.id) { results.push({ id: item.id, error: "missing id" }); continue; }
      if (item.status && !validStatuses.includes(item.status)) {
        results.push({ id: item.id, error: "invalid status" }); continue;
      }

      const setClauses = [];
      const params = [];
      if (item.status) { setClauses.push("status = ?"); params.push(item.status); }
      if (item.adminNotes !== undefined) { setClauses.push("admin_notes = ?"); params.push(item.adminNotes); }
      if (item.tags !== undefined) { setClauses.push("tags = ?"); params.push(JSON.stringify(item.tags)); }
      setClauses.push("updated_at = NOW()");

      if (setClauses.length > 1) {
        params.push(item.id);
        await db.prepare(`UPDATE feedback SET ${setClauses.join(", ")} WHERE id = ?`).run(...params);
        results.push({ id: item.id, status: item.status || "unchanged", ok: true });
      }
    }

    await logAdminAction(req, "bulk_update_feedback", "feedback", null, { count: results.filter(r => r.ok).length });

    res.json({ updated: results.filter(r => r.ok).length, total: updates.length, results });
  } catch (err) {
    console.error("Admin feedback bulk-update error:", err);
    res.status(500).json({ error: "Failed to bulk update feedback" });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// ─── AUTHORIZATIONS (Consent & Authorization Verification) ───
// ═══════════════════════════════════════════════════════════════════════

// GET /api/admin/authorizations — list care recipients with consent info
router.get("/authorizations", requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const { status, tier } = req.query;

    let sql = `
      SELECT cr.id, cr.first_name, cr.last_name, cr.authorization_tier, cr.consent_status,
             cr.consent_method, cr.consent_verified_at, cr.consent_reviewed_by, cr.consent_notes,
             cr.email AS recipient_email, cr.sms_phone AS recipient_phone,
             cr.bookings_paused, cr.bookings_paused_reason,
             cr.created_at,
             u.first_name AS family_first_name, u.last_name AS family_last_name, u.email AS family_email,
             (SELECT COUNT(*) FROM care_sessions cs WHERE cs.care_recipient_id = cr.id) AS session_count,
             att.signature_name AS attestation_signer, att.signed_at AS attestation_signed_at,
             att.relationship_to_recipient AS attestation_relationship,
             att.admin_status AS attestation_admin_status, att.admin_notes AS attestation_admin_notes,
             (SELECT va.status FROM verification_attempts va WHERE va.care_recipient_id = cr.id ORDER BY va.created_at DESC LIMIT 1) AS verification_status,
             (SELECT va2.failed_attempts FROM verification_attempts va2 WHERE va2.care_recipient_id = cr.id ORDER BY va2.created_at DESC LIMIT 1) AS verification_failed_attempts,
             (SELECT co.recipient_response FROM consent_outreach co WHERE co.care_recipient_id = cr.id ORDER BY co.created_at DESC LIMIT 1) AS outreach_response,
             (SELECT co2.responded_at FROM consent_outreach co2 WHERE co2.care_recipient_id = cr.id ORDER BY co2.created_at DESC LIMIT 1) AS outreach_responded_at,
             (SELECT co3.sent_to_email FROM consent_outreach co3 WHERE co3.care_recipient_id = cr.id ORDER BY co3.created_at DESC LIMIT 1) AS outreach_sent_to,
             (SELECT co4.recipient_response_notes FROM consent_outreach co4 WHERE co4.care_recipient_id = cr.id ORDER BY co4.created_at DESC LIMIT 1) AS outreach_response_notes,
             (SELECT ad.id FROM authorization_documents ad WHERE ad.care_recipient_id = cr.id ORDER BY ad.created_at DESC LIMIT 1) AS doc_id,
             (SELECT ad2.document_type FROM authorization_documents ad2 WHERE ad2.care_recipient_id = cr.id ORDER BY ad2.created_at DESC LIMIT 1) AS doc_type,
             (SELECT ad3.file_name FROM authorization_documents ad3 WHERE ad3.care_recipient_id = cr.id ORDER BY ad3.created_at DESC LIMIT 1) AS doc_file_name,
             (SELECT ad4.upload_status FROM authorization_documents ad4 WHERE ad4.care_recipient_id = cr.id ORDER BY ad4.created_at DESC LIMIT 1) AS doc_upload_status,
             (SELECT ad5.admin_notes FROM authorization_documents ad5 WHERE ad5.care_recipient_id = cr.id ORDER BY ad5.created_at DESC LIMIT 1) AS doc_admin_notes
      FROM care_recipients cr
      LEFT JOIN users u ON u.id = cr.family_user_id
      LEFT JOIN attestations att ON att.care_recipient_id = cr.id
      WHERE 1=1
    `;
    const params = [];
    if (status) { sql += ` AND cr.consent_status = ?`; params.push(status); }
    if (tier) { sql += ` AND cr.authorization_tier = ?`; params.push(tier); }
    sql += ` ORDER BY cr.created_at DESC`;

    const rows = await db.prepare(sql).all(...params);
    res.json({ authorizations: rows });
  } catch (err) {
    console.error("Admin authorizations list error:", err);
    res.status(500).json({ error: "Failed to fetch authorizations" });
  }
});

// GET /api/admin/documents/:docId — get full document for admin preview
// Searches all 3 document tables: verified_documents, authorization_documents, caregiver_documents
router.get("/documents/:docId", requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const docId = req.params.docId;
    // Also accept ?source= query param to hint which table to check first
    const sourceHint = req.query.source;

    let doc = null;

    // Try verified_documents first (the unified table)
    if (!doc || sourceHint === 'verified_documents') {
      doc = await db.prepare(`
        SELECT id, owner_type, owner_id, uploaded_by, document_type, file_data, file_name, file_size, mime_type,
          status, category, ai_classification, admin_notes, expires_at, created_at,
          'verified_documents' AS source_table
        FROM verified_documents WHERE id = ?
      `).get(docId).catch(() => null);
    }

    // Try authorization_documents (legacy POA/guardianship)
    if (!doc) {
      doc = await db.prepare(`
        SELECT id, care_recipient_id, document_type, file_data, file_name, file_size, mime_type,
          upload_status AS status, admin_notes, created_at,
          'authorization_documents' AS source_table
        FROM authorization_documents WHERE id = ?
      `).get(docId).catch(() => null);
    }

    // Try caregiver_documents (legacy onboarding DL/certs)
    if (!doc) {
      doc = await db.prepare(`
        SELECT id, user_id, document_type, file_data, file_name, metadata, created_at,
          'caregiver_documents' AS source_table
        FROM caregiver_documents WHERE id = ?
      `).get(docId).catch(() => null);
    }

    if (!doc) return res.status(404).json({ error: "Document not found" });
    res.json({ document: doc });
  } catch (err) {
    console.error("Admin document preview error:", err);
    res.status(500).json({ error: "Failed to fetch document" });
  }
});

// PUT /api/admin/authorizations/:id — admin approve/reject/revoke consent
router.put("/authorizations/:id", requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const { id } = req.params;
    const { action, notes } = req.body; // action: 'approve' | 'reject' | 'revoke'

    const recipient = await db.prepare("SELECT * FROM care_recipients WHERE id = ?").get(id);
    if (!recipient) return res.status(404).json({ error: "Care recipient not found" });

    const validActions = ['approve', 'reject', 'revoke', 'unpause'];
    if (!validActions.includes(action)) {
      return res.status(400).json({ error: "Action must be 'approve', 'reject', 'revoke', or 'unpause'" });
    }

    // ── Unpause bookings (standalone action, doesn't change consent status) ──
    if (action === 'unpause') {
      await db.prepare(`
        UPDATE care_recipients SET bookings_paused = 0, bookings_paused_reason = NULL, updated_at = NOW() WHERE id = ?
      `).run(id);

      await logAdminAction(req, "unpause_bookings", "care_recipient", id, {
        previousReason: recipient.bookings_paused_reason,
        notes,
      });

      // Notify family
      const recipientName = `${recipient.first_name} ${recipient.last_name}`.trim();
      try {
        await db.prepare(`
          INSERT INTO activity_feed (id, family_user_id, care_recipient_id, event_type, title, message)
          VALUES (?, ?, ?, 'bookings_resumed', ?, ?)
        `).run(uuid(), recipient.family_user_id, id,
          `Bookings resumed for ${recipientName}`,
          `Bookings for ${recipientName} have been restored by an administrator.${notes ? ' Note: ' + notes : ''}`
        );
        const emitToUser = req.app.get("emitToUser");
        if (emitToUser) emitToUser(recipient.family_user_id, "activity_update", {
          title: `Bookings resumed for ${recipientName}`,
          message: `Bookings for ${recipientName} have been restored. You can now schedule care sessions.`,
        });
      } catch (e) { console.error("Unpause notification error:", e.message); }

      const updated = await db.prepare("SELECT * FROM care_recipients WHERE id = ?").get(id);
      return res.json({ success: true, careRecipient: updated });
    }

    const statusMap = { approve: 'verified', reject: 'rejected', revoke: 'revoked' };
    const newStatus = statusMap[action];
    const newMethod = action === 'approve' ? 'admin_approved' : recipient.consent_method;
    const verifiedAt = action === 'approve' ? new Date().toISOString() : recipient.consent_verified_at;

    await db.prepare(`
      UPDATE care_recipients
      SET consent_status = ?, consent_method = ?, consent_verified_at = ?,
          consent_reviewed_by = ?, consent_notes = ?, updated_at = NOW()
      WHERE id = ?
    `).run(newStatus, newMethod, verifiedAt, req.user.id, notes || null, id);

    // For tier3: update the attestation admin_status
    if (recipient.authorization_tier === 'tier3' && (action === 'approve' || action === 'reject')) {
      const attAdminStatus = action === 'approve' ? 'approved' : 'rejected';
      await db.prepare(`
        UPDATE attestations SET admin_status = ?, admin_notes = ?, admin_reviewed_by = ?, admin_reviewed_at = NOW()
        WHERE care_recipient_id = ? ORDER BY created_at DESC LIMIT 1
      `).run(attAdminStatus, notes || null, req.user.id, id);

      // If rejecting, also unpause bookings if they were paused
      if (action === 'reject') {
        await db.prepare(
          "UPDATE care_recipients SET bookings_paused = 0, bookings_paused_reason = NULL, updated_at = NOW() WHERE id = ?"
        ).run(id);
      }
    }

    // For tier2: also update the most recent authorization document status
    if (recipient.authorization_tier === 'tier2' && (action === 'approve' || action === 'reject')) {
      const latestDoc = await db.prepare(
        "SELECT id FROM authorization_documents WHERE care_recipient_id = ? ORDER BY created_at DESC LIMIT 1"
      ).get(id);
      if (latestDoc) {
        const docStatus = action === 'approve' ? 'approved' : 'rejected';
        await db.prepare(
          "UPDATE authorization_documents SET upload_status = ?, admin_notes = ?, reviewed_by = ?, reviewed_at = NOW() WHERE id = ?"
        ).run(docStatus, notes || null, req.user.id, latestDoc.id);
      }

      // Also update verified_documents status
      const latestVDoc = await db.prepare(
        "SELECT id FROM verified_documents WHERE owner_type = 'care_recipient' AND owner_id = ? AND category = 'consent' ORDER BY created_at DESC LIMIT 1"
      ).get(id);
      if (latestVDoc) {
        const vDocStatus = action === 'approve' ? 'approved' : 'rejected';
        await db.prepare(
          "UPDATE verified_documents SET status = ?, admin_notes = ?, admin_reviewed_by = ?, admin_reviewed_at = NOW(), updated_at = NOW() WHERE id = ?"
        ).run(vDocStatus, notes || null, req.user.id, latestVDoc.id);
      }

      // POA override: if approving tier2 for a recipient with self-consent (linked_user_id), activate managed mode
      if (action === 'approve' && recipient.linked_user_id) {
        const previousPerm = recipient.permission_tier || 'full';
        if (previousPerm === 'full') {
          await db.prepare(`
            UPDATE care_recipients SET permission_tier = 'collaborative', managed_by_user_id = ?,
              managed_reason = 'POA verified by admin', managed_at = NOW() WHERE id = ?
          `).run(recipient.family_user_id, id);

          // Log managed mode activation
          try {
            const { logConsentAudit } = require("./documents");
            const rName = `${recipient.first_name} ${recipient.last_name}`.trim();
            await logConsentAudit(db, {
              careRecipientId: id, actorId: "system", actorRole: "system",
              eventType: "managed_mode_activated",
              description: `${rName}'s account transitioned to collaborative mode after POA verification. Care team now manages care decisions.`,
              metadata: { previousPermission: previousPerm, newPermission: 'collaborative', triggeredBy: 'poa_approval' },
            });
          } catch (auditErr) { console.error("Managed mode audit error:", auditErr.message); }

          // Notify care recipient
          try {
            const emitToUser = req.app.get("emitToUser");
            const title = "Your account is now in collaborative mode";
            const message = `A Power of Attorney document has been verified for your care. Your care team now helps manage your care sessions. You can still view your schedule and information.`;
            await db.prepare(
              "INSERT INTO activity_feed (id, family_user_id, care_recipient_id, event_type, title, message) VALUES (?, ?, ?, 'managed_mode_activated', ?, ?)"
            ).run(uuid(), recipient.linked_user_id, id, title, message);
            if (emitToUser) emitToUser(recipient.linked_user_id, "activity_update", { title, message });
          } catch (notifErr) { console.error("Managed mode notification error:", notifErr.message); }
        }
      }
    }

    await logAdminAction(req, `authorization_${action}`, "care_recipient", id, {
      previousStatus: recipient.consent_status,
      newStatus,
      tier: recipient.authorization_tier,
      notes,
    });

    // Consent audit log
    try {
      const { logConsentAudit } = require("./documents");
      const eventMap = { approve: "document_approved", reject: "document_rejected", revoke: "consent_revoked" };
      const recipientLabel = `${recipient.first_name} ${recipient.last_name}`.trim();
      const descMap = {
        approve: `Admin approved authorization for ${recipientLabel}${notes ? '. Note: ' + notes : ''}`,
        reject: `Admin rejected authorization for ${recipientLabel}${notes ? '. Reason: ' + notes : ''}`,
        revoke: `Admin revoked consent for ${recipientLabel}${notes ? '. Reason: ' + notes : ''}`,
      };
      await logConsentAudit(db, {
        careRecipientId: id, actorId: req.user.id, actorRole: "admin",
        eventType: eventMap[action] || `authorization_${action}`,
        description: descMap[action],
        metadata: { previousStatus: recipient.consent_status, newStatus, tier: recipient.authorization_tier, notes },
      });
    } catch (auditErr) { console.error("Admin consent audit log error:", auditErr.message); }

    // Send activity feed entry + WebSocket notification to family
    const recipientName = `${recipient.first_name} ${recipient.last_name}`.trim();
    const activityTitle = action === 'approve'
      ? `Authorization approved for ${recipientName}`
      : action === 'reject'
        ? `Authorization requires attention — ${recipientName}`
        : `Authorization revoked for ${recipientName}`;
    const activityMsg = action === 'approve'
      ? `${recipientName}'s care authorization has been verified. You can now schedule care sessions.`
      : action === 'reject'
        ? `Your authorization document for ${recipientName} needs revision.${notes ? ' Note: ' + notes : ''} Please upload a new document.`
        : `Authorization for ${recipientName} has been revoked. Please contact support if you believe this is an error.`;
    try {
      await db.prepare(`
        INSERT INTO activity_feed (id, family_user_id, care_recipient_id, event_type, title, message)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(uuid(), recipient.family_user_id, id, `authorization_${action}`, activityTitle, activityMsg);
      const emitToUser = req.app.get("emitToUser");
      if (emitToUser) emitToUser(recipient.family_user_id, "activity_update", { title: activityTitle, message: activityMsg });
    } catch (notifErr) {
      console.error("Authorization notification error:", notifErr.message);
    }

    const updated = await db.prepare("SELECT * FROM care_recipients WHERE id = ?").get(id);
    res.json({ success: true, careRecipient: updated });
  } catch (err) {
    console.error("Admin authorization update error:", err);
    res.status(500).json({ error: "Failed to update authorization" });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// ─── CONSENT REVIEW — Tier 3 pending attestations quick-view ───
// ═══════════════════════════════════════════════════════════════════════

// GET /api/admin/consent/pending — list consent items needing admin attention
// Catches: (1) pending attestation reviews, (2) unanswered outreach emails, (3) flagged responses
router.get("/consent/pending", requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const rows = await db.prepare(`
      SELECT cr.id, cr.first_name, cr.last_name, cr.consent_status, cr.email AS recipient_email,
             cr.sms_phone AS recipient_phone, cr.bookings_paused, cr.bookings_paused_reason,
             u.first_name AS family_first_name, u.last_name AS family_last_name, u.email AS family_email,
             att.signature_name, att.relationship_to_recipient, att.signed_at, att.admin_status,
             co.sent_to_email AS outreach_sent_to, co.outreach_type, co.recipient_response,
             co.recipient_response_notes, co.responded_at AS outreach_responded_at, co.expires_at AS outreach_expires_at
      FROM care_recipients cr
      JOIN users u ON u.id = cr.family_user_id
      LEFT JOIN attestations att ON att.care_recipient_id = cr.id
      LEFT JOIN consent_outreach co ON co.care_recipient_id = cr.id
        AND co.created_at = (SELECT MAX(co2.created_at) FROM consent_outreach co2 WHERE co2.care_recipient_id = cr.id)
      WHERE (
        -- Pending attestation review (original logic)
        (cr.authorization_tier = 'tier3'
          AND cr.consent_status IN ('attested', 'pending')
          AND COALESCE(att.admin_status, 'pending') = 'pending')
        OR
        -- Outreach sent but no response yet
        (co.id IS NOT NULL AND co.recipient_response IS NULL AND co.responded_at IS NULL)
        OR
        -- Bookings currently paused (needs admin resolution)
        (cr.bookings_paused = 1)
      )
      ORDER BY
        CASE WHEN cr.bookings_paused = 1 THEN 0
             WHEN co.id IS NOT NULL AND co.recipient_response IS NULL THEN 1
             ELSE 2 END,
        att.signed_at DESC NULLS LAST
    `).all();
    res.json({ pending: rows });
  } catch (err) {
    console.error("Admin consent pending error:", err);
    res.status(500).json({ error: "Failed to fetch pending consent reviews" });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// ─── CAREGIVER MANAGEMENT — Manual background check approval ───
// ═══════════════════════════════════════════════════════════════════════

// POST /api/admin/caregivers/:id/approve-bgcheck — manually approve a caregiver's background check
router.post("/caregivers/:id/approve-bgcheck", requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const { id } = req.params;
    const { notes } = req.body;

    const profile = await db.prepare(
      "SELECT cp.*, u.first_name, u.last_name, u.email FROM caregiver_profiles cp JOIN users u ON u.id = cp.user_id WHERE cp.user_id = ?"
    ).get(id);
    if (!profile) return res.status(404).json({ error: "Caregiver profile not found" });

    await db.prepare(`
      UPDATE caregiver_profiles
      SET is_background_checked = 1, bg_check_admin_approved = 1,
          bg_check_admin_approved_by = ?, bg_check_admin_approved_at = NOW(),
          checkr_status = CASE WHEN checkr_status IS NULL OR checkr_status = 'pending' THEN 'clear' ELSE checkr_status END,
          background_check_consent = 1
      WHERE user_id = ?
    `).run(req.user.id, id);

    await logAdminAction(req, "bgcheck_manual_approve", "caregiver", id, {
      caregiverName: `${profile.first_name} ${profile.last_name}`.trim(),
      notes,
    });

    // Notify the caregiver
    try {
      await db.prepare(`
        INSERT INTO activity_feed (id, family_user_id, event_type, title, message, created_at)
        VALUES (?, ?, 'bgcheck_approved', 'Background Check Approved', 'Your background check has been approved. You can now accept care sessions!', NOW())
      `).run(uuid(), id);
      const emitToUser = req.app.get("emitToUser");
      if (emitToUser) emitToUser(id, "activity_update", { title: "Background Check Approved", message: "Your background check has been approved!" });
    } catch (notifErr) { console.error("BG check notification error:", notifErr.message); }

    res.json({ success: true, message: `Background check approved for ${profile.first_name} ${profile.last_name}`.trim() });
  } catch (err) {
    console.error("Admin bgcheck approve error:", err);
    res.status(500).json({ error: "Failed to approve background check" });
  }
});

// ─── Account Approval Gate ───

// GET /api/admin/pending-approvals — list users awaiting approval
router.get("/pending-approvals", requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const pending = await db.prepare(`
      SELECT id, email, first_name, last_name, role, roles, phone, created_at
      FROM users
      WHERE account_approved = 0
        AND (is_demo IS NULL OR is_demo = 0)
        AND is_active = 1
      ORDER BY created_at DESC
    `).all();
    res.json({ pending: pending || [] });
  } catch (err) {
    console.error("Pending approvals error:", err);
    res.status(500).json({ error: "Failed to fetch pending approvals" });
  }
});

// PUT /api/admin/users/:id/approve — approve a user's account
router.put("/users/:id/approve", requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const user = await db.prepare("SELECT id, first_name, last_name, email, role FROM users WHERE id = ?").get(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    await db.prepare(
      "UPDATE users SET account_approved = 1, approved_by = ?, approved_at = NOW() WHERE id = ?"
    ).run(req.user.id, req.params.id);

    // If this caregiver had a flagged BG check (consider/disputed), mark it as reviewed-and-approved
    const cgProfile = await db.prepare(
      "SELECT checkr_status FROM caregiver_profiles WHERE user_id = ?"
    ).get(req.params.id);
    if (cgProfile && (cgProfile.checkr_status === "consider" || cgProfile.checkr_status === "disputed")) {
      await db.prepare(
        "UPDATE caregiver_profiles SET checkr_status = 'consider_approved', is_background_checked = 1, updated_at = NOW() WHERE user_id = ?"
      ).run(req.params.id);
    } else if (cgProfile && cgProfile.checkr_status === "rejected") {
      // Un-reject: reset back to consider so admin can re-review
      await db.prepare(
        "UPDATE caregiver_profiles SET checkr_status = 'consider', bg_check_rejection_reason = NULL, updated_at = NOW() WHERE user_id = ?"
      ).run(req.params.id);
    }

    await logAdminAction(req, "account_approved", "user", req.params.id, {
      userName: `${user.first_name} ${user.last_name}`.trim(),
      email: user.email,
    });

    // Send verification email now that account is approved
    // (verification email is NOT sent at signup — only after admin approval)
    try {
      const userFull = await db.prepare("SELECT id, email, first_name, email_verified FROM users WHERE id = ?").get(req.params.id);
      if (userFull && !userFull.email_verified) {
        await sendVerificationEmail(db, userFull.id, userFull.email, userFull.first_name);
        console.log(`  [admin] Sent verification email to ${userFull.email} after account approval`);
      }
    } catch (emailErr) {
      console.error("  [admin] Failed to send verification email after approval:", emailErr.message);
      // Don't fail the approval — email is best-effort
    }

    // Notify the user their account is approved
    const emitToUser = req.app.get("emitToUser");
    if (emitToUser) {
      emitToUser(req.params.id, "account_approved", {
        message: "Your account has been approved! You can now continue setting up your profile.",
      });
    }

    // Push notification
    try {
      const sendPush = req.app.get("sendPush");
      if (sendPush) {
        await sendPush(req.params.id, {
          title: "Account Approved!",
          body: "Welcome to InPlace! Your account has been approved. You can now continue setting up your profile.",
          data: { type: "account_approved" },
        });
      }
    } catch {}

    // Activity feed
    try {
      await db.prepare(
        "INSERT INTO activity_feed (id, family_user_id, event_type, title, message, created_at) VALUES (?, ?, 'account_approved', 'Welcome to InPlace!', 'Your account has been approved. Continue setting up your profile to get started.', NOW())"
      ).run(uuid(), req.params.id);
    } catch {}

    res.json({ success: true, message: `Approved ${user.first_name} ${user.last_name}` });
  } catch (err) {
    console.error("Account approve error:", err);
    res.status(500).json({ error: "Failed to approve account" });
  }
});

// PUT /api/admin/users/:id/unapprove — reset approval status (for re-review)
router.put("/users/:id/unapprove", requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    await db.prepare("UPDATE users SET account_approved = 0, approved_by = NULL, approved_at = NULL WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error("Unapprove error:", err);
    res.status(500).json({ error: "Failed to unapprove" });
  }
});

// PUT /api/admin/users/:id/reject-bgcheck — Reject caregiver due to background check (soft lock with appeal)
router.put("/users/:id/reject-bgcheck", requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const { reason } = req.body;
    const user = await db.prepare("SELECT id, first_name, last_name, email FROM users WHERE id = ?").get(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    // Update checkr status to rejected and store reason
    await db.prepare(
      "UPDATE caregiver_profiles SET checkr_status = 'rejected', bg_check_rejection_reason = ?, account_paused = 0, updated_at = NOW() WHERE user_id = ?"
    ).run(reason || 'Background check did not meet requirements', req.params.id);

    // Log the action
    await logAdminAction(req, "bgcheck_rejected", "user", req.params.id, {
      userName: `${user.first_name} ${user.last_name}`.trim(),
      email: user.email,
      reason: reason || 'Background check did not meet requirements',
    });

    // Send them an in-app message from admin explaining the decision
    const sendAdminMsg = async (msg) => {
      try {
        // Find or create a conversation
        let convo = await db.prepare(
          "SELECT id FROM conversations WHERE type = 'admin_support' AND JSON_EXTRACT(participants, '$') LIKE ?"
        ).get(`%${req.params.id}%`);
        if (!convo) {
          const convoId = uuid();
          await db.prepare(
            "INSERT INTO conversations (id, type, participants, created_at, updated_at) VALUES (?, 'admin_support', ?, NOW(), NOW())"
          ).run(convoId, JSON.stringify([req.params.id, req.user.id]));
          convo = { id: convoId };
        }
        await db.prepare(
          "INSERT INTO messages (id, sender_id, recipient_id, conversation_id, content, created_at) VALUES (?, ?, ?, ?, ?, NOW())"
        ).run(uuid(), req.user.id, req.params.id, convo.id, msg);
      } catch (msgErr) { console.warn("[reject-bgcheck] Message send failed:", msgErr.message); }
    };
    await sendAdminMsg(
      `Hi ${user.first_name}, we've reviewed your background check results and unfortunately we're unable to approve your account for caregiving at this time.\n\n` +
      `Reason: ${reason || 'Background check did not meet our requirements.'}\n\n` +
      `If you believe this is an error or would like to provide additional context, please reply to this message and we'll review your case.`
    );

    // Push notification
    try {
      const sendPush = req.app.get("sendPush");
      if (sendPush) {
        await sendPush(req.params.id, {
          title: "Background Check Update",
          body: "We've sent you a message regarding your background check. Please check your Messages.",
          data: { type: "bgcheck_rejected" },
        });
      }
    } catch {}

    // Activity feed entry for admin
    try {
      await db.prepare(
        "INSERT INTO activity_feed (id, family_user_id, event_type, title, message, created_at) VALUES (?, ?, 'checkr_rejected', ?, ?, NOW())"
      ).run(uuid(), req.user.id, `Background check rejected — ${user.first_name} ${user.last_name}`,
        `${user.first_name} ${user.last_name} was rejected due to background check findings. Reason: ${reason || 'Did not meet requirements'}`);
    } catch {}

    res.json({ success: true, message: `Rejected ${user.first_name} ${user.last_name} — they've been notified via message` });
  } catch (err) {
    console.error("BG check reject error:", err);
    res.status(500).json({ error: "Failed to reject" });
  }
});

// PUT /api/admin/users/:id/reject — reject (deactivate) a user's account
router.put("/users/:id/reject", requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const { reason } = req.body;
    const user = await db.prepare("SELECT id, first_name, last_name, email FROM users WHERE id = ?").get(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    await db.prepare("UPDATE users SET is_active = 0 WHERE id = ?").run(req.params.id);

    await logAdminAction(req, "account_rejected", "user", req.params.id, {
      userName: `${user.first_name} ${user.last_name}`.trim(),
      email: user.email,
      reason: reason || "Not approved",
    });

    res.json({ success: true, message: `Rejected ${user.first_name} ${user.last_name}` });
  } catch (err) {
    console.error("Account reject error:", err);
    res.status(500).json({ error: "Failed to reject account" });
  }
});

// ─── GET /api/admin/sessions/no-show-cancelled — List sessions cancelled by no-show poller ───
router.get("/sessions/no-show-cancelled", async (req, res) => {
  try {
    const db = await getDb();
    const sessions = await db.prepare(`
      SELECT cs.id, cs.scheduled_date, cs.scheduled_time, cs.status, cs.cancelled_at,
        cs.caregiver_no_show, cs.caregiver_no_show_at,
        cr.first_name || ' ' || cr.last_name AS recipient_name,
        u.first_name || ' ' || u.last_name AS caregiver_name,
        fu.first_name || ' ' || fu.last_name AS family_name
      FROM care_sessions cs
      LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
      LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
      LEFT JOIN users u ON cp.user_id = u.id
      LEFT JOIN users fu ON cs.family_user_id = fu.id
      WHERE cs.cancelled_by = 'system' AND cs.caregiver_no_show = 1
      ORDER BY cs.cancelled_at DESC
      LIMIT 50
    `).all();
    res.json({ sessions });
  } catch (err) {
    console.error("List no-show cancelled error:", err);
    res.status(500).json({ error: "Failed to fetch cancelled sessions" });
  }
});

// ─── POST /api/admin/sessions/:id/restore — Restore any cancelled session ───
// Optional body: { checkInTime: "2026-03-31T14:00:00", setInProgress: true }
// If checkInTime is provided, also creates/updates the visit_log with the corrected check-in time.
router.post("/sessions/:id/restore", async (req, res) => {
  try {
    const db = await getDb();
    const session = await db.prepare(`
      SELECT cs.*, cp.user_id AS caregiver_user_id, cp.id AS caregiver_profile_id
      FROM care_sessions cs
      LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
      WHERE cs.id = ?
    `).get(req.params.id);
    if (!session) return res.status(404).json({ error: "Session not found" });
    if (session.status !== 'cancelled') {
      return res.status(400).json({ error: "Session is not cancelled — current status: " + session.status });
    }

    const { checkInTime, setInProgress } = req.body || {};
    const wasNoShow = session.caregiver_no_show;
    const restoreStatus = (setInProgress || checkInTime) ? 'in_progress' : 'confirmed';

    await db.prepare(`
      UPDATE care_sessions SET
        status = ?,
        caregiver_no_show = 0,
        caregiver_no_show_at = NULL,
        cancelled_at = NULL,
        cancelled_by = NULL,
        cancel_reason = NULL,
        review_required = 0,
        notifications_sent = REPLACE(COALESCE(notifications_sent, ''), ',no_show_flagged', ''),
        updated_at = NOW()
      WHERE id = ?
    `).run(restoreStatus, req.params.id);

    // If check-in time provided, create or update the visit_log
    if (checkInTime && session.caregiver_profile_id) {
      const existingLog = await db.prepare("SELECT id FROM visit_logs WHERE session_id = ?").get(req.params.id);
      if (existingLog) {
        await db.prepare("UPDATE visit_logs SET check_in_time = ?, updated_at = NOW() WHERE session_id = ?")
          .run(checkInTime, req.params.id);
      } else {
        const { v4: uuidv4 } = require("uuid");
        await db.prepare(`
          INSERT INTO visit_logs (id, session_id, caregiver_id, check_in_time, created_at)
          VALUES (?, ?, ?, ?, NOW())
        `).run(uuidv4(), req.params.id, session.caregiver_profile_id, checkInTime);
      }
    }

    await logAdminAction(req, "restore_session", "care_session", req.params.id, {
      restoredTo: restoreStatus,
      previousCancelledBy: session.cancelled_by,
      previousCancelReason: session.cancel_reason,
      wasNoShow: !!wasNoShow,
      checkInTime: checkInTime || null,
    });

    console.log(`[admin] Restored session ${req.params.id.slice(0, 8)} → ${restoreStatus} (was: cancelled by ${session.cancelled_by || 'unknown'})${checkInTime ? ` (check-in: ${checkInTime})` : ''} by ${req.user.email}`);
    res.json({ success: true, message: `Session restored to ${restoreStatus}${checkInTime ? ` with check-in at ${checkInTime}` : ''}` });
  } catch (err) {
    console.error("Restore session error:", err);
    res.status(500).json({ error: "Failed to restore session" });
  }
});

// ─── POST /api/admin/sessions/:id/rewind — Rewind session to an earlier state ───
// Lets admin undo checkout (completed→in_progress) or undo check-in (in_progress→confirmed)
// Body: { target: "in_progress" | "confirmed" }
//   completed → in_progress: clears checkout data, keeps check-in. Re-test checkout.
//   completed → confirmed: full rewind, deletes visit log. Re-test everything.
//   in_progress → confirmed: undo check-in, deletes visit log. Re-test check-in.
router.post("/sessions/:id/rewind", async (req, res) => {
  try {
    const db = await getDb();
    const session = await db.prepare(`
      SELECT cs.*, cp.user_id AS caregiver_user_id
      FROM care_sessions cs
      LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
      WHERE cs.id = ?
    `).get(req.params.id);
    if (!session) return res.status(404).json({ error: "Session not found" });

    const { target } = req.body || {};
    const validTransitions = {
      'completed': ['in_progress', 'confirmed'],
      'in_progress': ['confirmed'],
    };
    const allowed = validTransitions[session.status];
    if (!allowed) {
      return res.status(400).json({ error: `Cannot rewind from status "${session.status}" — only completed or in_progress sessions can be rewound` });
    }
    if (!target || !allowed.includes(target)) {
      return res.status(400).json({ error: `Invalid target "${target}" for status "${session.status}". Allowed: ${allowed.join(', ')}` });
    }

    const previousStatus = session.status;

    if (target === 'in_progress') {
      // Undo checkout only — keep the visit log and check-in, clear checkout data
      await db.prepare(`
        UPDATE care_sessions SET
          status = 'in_progress',
          completed_at = NULL,
          payment_due_at = NULL,
          payment_status = NULL,
          review_required = 0,
          review_completed = 0,
          overtime_minutes = NULL,
          overtime_cost = NULL,
          updated_at = NOW()
        WHERE id = ?
      `).run(req.params.id);

      // Clear checkout fields on the visit log (keep check-in data)
      await db.prepare(`
        UPDATE visit_logs SET
          check_out_time = NULL,
          departure_mood = NULL,
          condition_tags = NULL,
          care_feedback = NULL,
          service_feedback = NULL,
          summary = NULL,
          early_departure_reason = NULL,
          early_departure_minutes = NULL,
          check_out_lat = NULL,
          check_out_lng = NULL,
          ai_summary = NULL
        WHERE session_id = ?
      `).run(req.params.id);

      // Delete any payment records created during checkout
      await db.prepare("DELETE FROM payments WHERE session_id = ? AND status IN ('pending', 'waived')").run(req.params.id);

    } else if (target === 'confirmed') {
      // Full rewind — delete visit log, reset to pre-check-in state
      await db.prepare(`
        UPDATE care_sessions SET
          status = 'confirmed',
          completed_at = NULL,
          payment_due_at = NULL,
          payment_status = NULL,
          review_required = 0,
          review_completed = 0,
          overtime_minutes = NULL,
          overtime_cost = NULL,
          late_check_in = 0,
          late_minutes = NULL,
          notifications_sent = '[]',
          updated_at = NOW()
        WHERE id = ?
      `).run(req.params.id);

      // Delete visit logs entirely
      await db.prepare("DELETE FROM visit_logs WHERE session_id = ?").run(req.params.id);

      // Delete any payment records
      await db.prepare("DELETE FROM payments WHERE session_id = ? AND status IN ('pending', 'waived')").run(req.params.id);
    }

    await logAdminAction(req, "rewind_session", "care_session", req.params.id, {
      from: previousStatus,
      to: target,
    });

    console.log(`[admin] Rewound session ${req.params.id.slice(0, 8)}: ${previousStatus} → ${target} by ${req.user.email}`);
    res.json({ success: true, message: `Session rewound: ${previousStatus} → ${target}` });
  } catch (err) {
    console.error("Rewind session error:", err);
    res.status(500).json({ error: "Failed to rewind session" });
  }
});

// ─── POST /api/admin/sessions/:id/force-check-in ───
// Admin can force-check-in any confirmed session (bypasses caregiver-only gate)
router.post("/sessions/:id/force-check-in", async (req, res) => {
  try {
    const db = await getDb();
    const session = await db.prepare(`
      SELECT cs.*, cp.id AS caregiver_profile_id
      FROM care_sessions cs
      LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
      WHERE cs.id = ?
    `).get(req.params.id);
    if (!session) return res.status(404).json({ error: "Session not found" });
    if (session.status === 'in_progress') return res.json({ success: true, message: "Already checked in" });
    if (session.status !== 'confirmed') {
      return res.status(400).json({ error: "Cannot check in — session status is " + session.status });
    }

    const now = new Date();
    // Set session to in_progress
    await db.prepare(`
      UPDATE care_sessions SET status = 'in_progress', updated_at = NOW() WHERE id = ?
    `).run(req.params.id);

    // Create or update visit_log
    const { v4: uuidv4 } = require("uuid");
    const existing = await db.prepare("SELECT id FROM visit_logs WHERE session_id = ?").get(req.params.id);
    if (existing) {
      await db.prepare("UPDATE visit_logs SET check_in_time = ?, updated_at = NOW() WHERE session_id = ?")
        .run(now.toISOString(), req.params.id);
    } else {
      await db.prepare(`
        INSERT INTO visit_logs (id, session_id, caregiver_id, check_in_time, created_at)
        VALUES (?, ?, ?, ?, NOW())
      `).run(uuidv4(), req.params.id, session.caregiver_profile_id, now.toISOString());
    }

    await logAdminAction(req, "force_check_in", "care_session", req.params.id, { checkInTime: now.toISOString() });
    console.log(`[admin] Force check-in session ${req.params.id.slice(0, 8)} by ${req.user.email}`);
    res.json({ success: true, message: "Session checked in" });
  } catch (err) {
    console.error("Force check-in error:", err);
    res.status(500).json({ error: "Failed to force check-in" });
  }
});

// ─── GET /api/admin/sessions/:id/detail ───
// Full session lifecycle drill-down for admin audit view
// Returns: booking info, confirmation, check-in (GPS, mood), visit log,
// check-out, payment trail, no-show flags/restores, audit history
router.get("/sessions/:id/detail", authenticate, requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const sid = req.params.id;

    // 1. Core session data with all participants
    const session = await db.prepare(`
      SELECT cs.*,
        cr.first_name AS recipient_first, cr.last_name AS recipient_last,
        cr.age AS recipient_age, cr.health_conditions,
        cr.location_city, cr.location_state,
        fu.first_name AS family_first, fu.last_name AS family_last, fu.email AS family_email,
        cu.first_name AS caregiver_first, cu.last_name AS caregiver_last, cu.email AS caregiver_email,
        cp.hourly_rate AS caregiver_rate
      FROM care_sessions cs
      LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
      LEFT JOIN users fu ON cs.family_user_id = fu.id
      LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
      LEFT JOIN users cu ON cp.user_id = cu.id
      WHERE cs.id = ?
    `).get(sid);

    if (!session) return res.status(404).json({ error: "Session not found" });

    // 2. Visit log (check-in, check-out, GPS, moods, notes)
    const visitLog = await db.prepare(`
      SELECT vl.*,
        vu.first_name AS vl_caregiver_first
      FROM visit_logs vl
      LEFT JOIN caregiver_profiles vcp ON vl.caregiver_id = vcp.id
      LEFT JOIN users vu ON vcp.user_id = vu.id
      WHERE vl.session_id = ?
      ORDER BY vl.created_at ASC
    `).all(sid);

    // 3. Payment records (session auto-pay + manual)
    let sessionPayments = [];
    try {
      sessionPayments = await db.prepare(`
        SELECT p.*, 'session' AS payment_type
        FROM payments p WHERE p.session_id = ?
        ORDER BY p.created_at ASC
      `).all(sid);
    } catch {}

    // 4. Activity feed entries for this session
    let activities = [];
    try {
      activities = await db.prepare(`
        SELECT af.event_type, af.title, af.message, af.metadata, af.created_at
        FROM activity_feed af
        WHERE af.metadata LIKE ?
        ORDER BY af.created_at ASC
      `).all(`%${sid}%`);
    } catch {}

    // 5. Admin audit log entries for this session
    let auditLog = [];
    try {
      auditLog = await db.prepare(`
        SELECT aal.action, aal.details, aal.ip_address, aal.created_at,
          u.first_name AS admin_first, u.last_name AS admin_last, u.email AS admin_email
        FROM admin_audit_log aal
        LEFT JOIN users u ON aal.admin_user_id = u.id
        WHERE aal.target_id = ? AND aal.target_type = 'care_session'
        ORDER BY aal.created_at ASC
      `).all(sid);
    } catch {}

    // 6. Build a unified timeline
    const timeline = [];

    // Session created
    if (session.created_at) {
      timeline.push({ time: session.created_at, type: 'booking', label: 'Session Requested',
        detail: `${session.service_type}, ${session.duration_hours}h on ${session.scheduled_date} at ${session.scheduled_time}` });
    }

    // Confirmation (if caregiver assigned)
    if (session.caregiver_id && session.offered_to_caregiver_id) {
      timeline.push({ time: session.updated_at || session.created_at, type: 'confirmed', label: 'Caregiver Confirmed',
        detail: `${session.caregiver_first || ''} ${session.caregiver_last || ''}`.trim() });
    }

    // Check-in
    for (const vl of visitLog) {
      if (vl.check_in_time) {
        const gps = (vl.check_in_lat && vl.check_in_lng)
          ? { lat: vl.check_in_lat, lng: vl.check_in_lng, distance_ft: vl.check_in_distance_ft }
          : (vl.check_in_latitude && vl.check_in_longitude)
            ? { lat: vl.check_in_latitude, lng: vl.check_in_longitude }
            : null;
        let moods = {};
        try { moods.arrival = JSON.parse(vl.arrival_mood); } catch { moods.arrival = vl.arrival_mood; }
        timeline.push({ time: vl.check_in_time, type: 'check_in', label: 'Checked In',
          detail: `by ${vl.vl_caregiver_first || 'caregiver'}`, gps, moods,
          briefingAcked: !!vl.briefing_acknowledged_at });
      }

      // Visit notes
      if (vl.care_feedback || vl.summary) {
        let tags = [];
        try { tags = JSON.parse(vl.condition_tags || '[]'); } catch {}
        timeline.push({ time: vl.check_out_time || vl.check_in_time || vl.created_at, type: 'visit_notes', label: 'Visit Notes',
          detail: vl.care_feedback || vl.summary, tags,
          serviceFeedback: vl.service_feedback || null });
      }

      // Check-out
      if (vl.check_out_time) {
        let departureMoods = {};
        try { departureMoods.departure = JSON.parse(vl.departure_mood); } catch { departureMoods.departure = vl.departure_mood; }
        const checkOutGps = (vl.check_out_lat && vl.check_out_lng)
          ? { lat: vl.check_out_lat, lng: vl.check_out_lng } : null;
        timeline.push({ time: vl.check_out_time, type: 'check_out', label: 'Checked Out',
          detail: vl.early_departure_reason ? `Early departure: ${vl.early_departure_reason}` : null,
          moods: departureMoods, gps: checkOutGps });
      }
    }

    // No-show flag
    if (session.caregiver_no_show && session.caregiver_no_show_at) {
      timeline.push({ time: session.caregiver_no_show_at, type: 'no_show', label: 'No-Show Flagged',
        detail: 'Caregiver did not check in within 30 minutes' });
    }

    // Cancellation
    if (session.cancelled_at) {
      timeline.push({ time: session.cancelled_at, type: 'cancelled', label: 'Session Cancelled',
        detail: `By ${session.cancelled_by || 'unknown'}${session.cancel_reason ? ': ' + session.cancel_reason : ''}` });
    }

    // Completion
    if (session.completed_at) {
      timeline.push({ time: session.completed_at, type: 'completed', label: 'Session Completed' });
    }

    // Payments
    for (const p of sessionPayments) {
      timeline.push({ time: p.created_at, type: 'payment', label: `Payment ${p.status}`,
        detail: `$${(p.amount / 100).toFixed(2)} total — $${(p.caregiver_payout / 100).toFixed(2)} to caregiver, $${(p.platform_fee / 100).toFixed(2)} platform fee`,
        paymentId: p.id, stripeIntent: p.stripe_payment_intent, autoCharged: !!p.auto_charged,
        tipCents: p.tip_cents || 0 });
    }

    // Payment authorization/capture from session fields
    if (session.payment_authorized_at) {
      timeline.push({ time: session.payment_authorized_at, type: 'payment_auth', label: 'Payment Authorized',
        detail: `$${((session.authorized_amount || 0) / 100).toFixed(2)} authorized` });
    }
    if (session.payment_captured_at) {
      timeline.push({ time: session.payment_captured_at, type: 'payment_capture', label: 'Payment Captured',
        detail: `Stripe PI: ${session.stripe_payment_intent_id || 'N/A'}` });
    }

    // Admin actions
    for (const a of auditLog) {
      let details = {};
      try { details = JSON.parse(a.details || '{}'); } catch {}
      timeline.push({ time: a.created_at, type: 'admin_action', label: `Admin: ${a.action.replace(/_/g, ' ')}`,
        detail: `by ${a.admin_first || ''} ${a.admin_last || ''}`.trim() + (a.admin_email ? ` (${a.admin_email})` : ''),
        adminDetails: details });
    }

    // Sort timeline chronologically
    timeline.sort((a, b) => new Date(a.time) - new Date(b.time));

    res.json({
      session: {
        id: session.id,
        status: session.status,
        service_type: session.service_type,
        scheduled_date: session.scheduled_date,
        scheduled_time: session.scheduled_time,
        duration_hours: session.duration_hours,
        agreed_rate: session.agreed_rate,
        estimated_cost: session.estimated_cost,
        actual_cost: session.actual_cost,
        special_instructions: session.special_instructions,
        private_only: session.private_only,
        payment_status: session.payment_status,
        late_check_in: session.late_check_in,
        late_minutes: session.late_minutes,
        review_required: session.review_required,
        created_at: session.created_at,
      },
      recipient: {
        name: `${session.recipient_first || ''} ${session.recipient_last || ''}`.trim(),
        age: session.recipient_age,
        location: [session.location_city, session.location_state].filter(Boolean).join(', '),
      },
      family: {
        name: `${session.family_first || ''} ${session.family_last || ''}`.trim(),
        email: session.family_email,
      },
      caregiver: session.caregiver_id ? {
        name: `${session.caregiver_first || ''} ${session.caregiver_last || ''}`.trim(),
        email: session.caregiver_email,
        rate: session.caregiver_rate,
      } : null,
      visitLog: visitLog.map(vl => ({
        check_in_time: vl.check_in_time,
        check_out_time: vl.check_out_time,
        arrival_mood: vl.arrival_mood,
        departure_mood: vl.departure_mood,
        condition_tags: vl.condition_tags,
        care_feedback: vl.care_feedback,
        service_feedback: vl.service_feedback,
        check_in_lat: vl.check_in_lat || vl.check_in_latitude,
        check_in_lng: vl.check_in_lng || vl.check_in_longitude,
        check_in_distance_ft: vl.check_in_distance_ft,
        check_out_lat: vl.check_out_lat,
        check_out_lng: vl.check_out_lng,
        briefing_acknowledged_at: vl.briefing_acknowledged_at,
        early_departure_reason: vl.early_departure_reason,
        ai_summary: vl.ai_summary,
      })),
      payments: sessionPayments,
      timeline,
    });
  } catch (err) {
    console.error("Session detail error:", err);
    res.status(500).json({ error: "Failed to load session details" });
  }
});

// ─── Backfill care notes from visit_logs care_feedback ───
// One-time use: creates recipient_notes for completed sessions that had
// care_feedback but no corresponding visit_summary note.
router.post("/backfill-care-notes", authenticate, requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const since = req.body.since || '2026-02-26';

    // Find completed sessions with care_feedback in visit_logs
    // that don't already have a visit_summary note
    const rows = await db.prepare(`
      SELECT cs.id AS session_id, cs.care_recipient_id, cp.user_id AS caregiver_user_id,
             vl.care_feedback, vl.check_out_time
      FROM care_sessions cs
      JOIN visit_logs vl ON vl.session_id = cs.id
      JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
      WHERE cs.status = 'completed'
        AND cs.care_recipient_id IS NOT NULL
        AND vl.care_feedback IS NOT NULL
        AND TRIM(vl.care_feedback) != ''
        AND vl.check_out_time >= ?
        AND NOT EXISTS (
          SELECT 1 FROM recipient_notes rn
          WHERE rn.care_recipient_id = cs.care_recipient_id
            AND rn.author_id = cp.user_id
            AND rn.note_type = 'visit_summary'
            AND rn.created_at >= ?
            AND rn.content = TRIM(vl.care_feedback)
        )
    `).all(since, since);

    let created = 0;
    for (const row of rows) {
      await db.prepare(`
        INSERT INTO recipient_notes (id, care_recipient_id, author_id, content, note_type, created_at)
        VALUES (?, ?, ?, ?, 'visit_summary', ?)
      `).run(uuid(), row.care_recipient_id, row.caregiver_user_id, row.care_feedback.trim(), row.check_out_time);
      created++;
    }

    res.json({ success: true, found: rows.length, created, since });
  } catch (err) {
    console.error("Backfill care notes error:", err);
    res.status(500).json({ error: "Failed to backfill care notes" });
  }
});

// ─── GET /api/admin/caregivers/paused — List all paused caregiver accounts ───
router.get("/caregivers/paused", authenticate, checkAdmin, requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const rows = await db.prepare(`
      SELECT cp.id, cp.user_id, cp.account_paused_reason, cp.account_paused_at,
        cp.rating_avg, cp.rating_count, cp.is_available,
        u.first_name, u.last_name, u.email, u.avatar_url, u.phone,
        (SELECT COUNT(*) FROM care_sessions cs WHERE cs.caregiver_id = cp.id AND cs.caregiver_no_show = 1) AS no_show_count,
        (SELECT COUNT(*) FROM care_sessions cs WHERE cs.caregiver_id = cp.id AND cs.status = 'completed') AS completed_count,
        ns.id AS no_show_session_id, ns.scheduled_date AS no_show_date, ns.scheduled_time AS no_show_time,
        cr_ns.first_name AS no_show_recipient_name
      FROM caregiver_profiles cp
      JOIN users u ON cp.user_id = u.id
      LEFT JOIN care_sessions ns ON ns.id = (
        SELECT cs2.id FROM care_sessions cs2
        WHERE cs2.caregiver_id = cp.id AND cs2.caregiver_no_show = 1 AND cs2.cancelled_by = 'system'
        ORDER BY cs2.scheduled_date DESC LIMIT 1
      )
      LEFT JOIN care_recipients cr_ns ON ns.care_recipient_id = cr_ns.id
      WHERE cp.account_paused = 1
      ORDER BY cp.account_paused_at DESC
    `).all();
    res.json({ paused: rows });
  } catch (err) {
    console.error("Paused caregivers error:", err);
    res.status(500).json({ error: "Failed to fetch paused caregivers" });
  }
});

// ─── POST /api/admin/caregivers/:userId/reinstate — Reinstate a paused caregiver ───
router.post("/caregivers/:userId/reinstate", authenticate, checkAdmin, requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const profile = await db.prepare("SELECT * FROM caregiver_profiles WHERE user_id = ?").get(req.params.userId);
    if (!profile) return res.status(404).json({ error: "Caregiver profile not found" });
    if (!profile.account_paused) return res.status(400).json({ error: "Account is not paused" });

    await db.prepare(`
      UPDATE caregiver_profiles SET
        account_paused = 0,
        account_paused_reason = NULL,
        account_paused_at = NULL,
        account_reinstated_at = NOW(),
        account_reinstated_by = ?,
        is_available = 1
      WHERE user_id = ?
    `).run(req.user.id, req.params.userId);

    await logAdminAction(req, "reinstate_caregiver", "caregiver", req.params.userId, {
      previousReason: profile.account_paused_reason,
      notes: req.body.notes || null,
    });

    console.log(`[admin] Reinstated caregiver ${req.params.userId} by ${req.user.email}`);
    res.json({ success: true, message: "Caregiver account reinstated" });
  } catch (err) {
    console.error("Reinstate caregiver error:", err);
    res.status(500).json({ error: "Failed to reinstate caregiver" });
  }
});

// ─── POST /api/admin/message/:userId — Send message as "InPlace Support" ───
router.post("/message/:userId", authenticate, checkAdmin, requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const { message } = req.body;
    if (!message || !message.trim()) return res.status(400).json({ error: "Message is required" });

    const targetUser = await db.prepare("SELECT id, first_name, last_name FROM users WHERE id = ?").get(req.params.userId);
    if (!targetUser) return res.status(404).json({ error: "User not found" });

    // Find or create a dedicated "InPlace Support" conversation (NOT the personal DM)
    let convId;
    const existing = await db.prepare(`
      SELECT c.id FROM conversations c
      JOIN conversation_members cm1 ON cm1.conversation_id = c.id AND cm1.user_id = ?
      JOIN conversation_members cm2 ON cm2.conversation_id = c.id AND cm2.user_id = ?
      WHERE c.type = 'direct' AND c.name = 'InPlace Support'
    `).get(req.user.id, req.params.userId);

    if (existing) {
      convId = existing.id;
    } else {
      convId = uuid();
      await db.prepare("INSERT INTO conversations (id, type, name, created_by) VALUES (?, ?, ?, ?)").run(convId, "direct", "InPlace Support", req.user.id);
      await db.prepare("INSERT INTO conversation_members (id, conversation_id, user_id, role) VALUES (?, ?, ?, ?)").run(uuid(), convId, req.user.id, "member");
      await db.prepare("INSERT INTO conversation_members (id, conversation_id, user_id, role) VALUES (?, ?, ?, ?)").run(uuid(), convId, req.params.userId, "member");
    }

    // Send the message with sender_label for display
    const msgId = uuid();
    await db.prepare(
      "INSERT INTO messages (id, sender_id, recipient_id, content, conversation_id, sender_label) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(msgId, req.user.id, req.params.userId, message.trim(), convId, "InPlace Support");

    // Update conversation timestamp
    await db.prepare("UPDATE conversations SET updated_at = NOW() WHERE id = ?").run(convId);

    // Push notification + websocket
    const emitToUser = req.app.get("emitToUser");
    if (emitToUser) {
      emitToUser(req.params.userId, "new_message", {
        messageId: msgId,
        conversationId: convId,
        senderId: req.user.id,
        senderName: "InPlace Support",
        content: message.trim(),
      });
    }

    // Send push notification
    try {
      const { sendPushToUser } = require("../utils/push");
      if (sendPushToUser) {
        await sendPushToUser(db, req.params.userId, "InPlace Support", message.trim().substring(0, 100), { conversationId: convId });
      }
    } catch {}

    await logAdminAction(req, "admin_message", "user", req.params.userId, {
      conversationId: convId,
      messagePreview: message.trim().substring(0, 50),
    });

    res.json({ success: true, conversationId: convId, messageId: msgId });
  } catch (err) {
    console.error("Admin message error:", err);
    res.status(500).json({ error: "Failed to send message" });
  }
});

// ─── POST /api/admin/caregivers/:userId/freeze — Manually freeze a caregiver account ───
router.post("/caregivers/:userId/freeze", authenticate, checkAdmin, requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const { reason } = req.body;
    if (!reason || !reason.trim()) return res.status(400).json({ error: "Reason is required" });

    const profile = await db.prepare("SELECT * FROM caregiver_profiles WHERE user_id = ?").get(req.params.userId);
    if (!profile) return res.status(404).json({ error: "Caregiver profile not found" });
    if (profile.account_paused) return res.status(400).json({ error: "Account is already paused" });

    await db.prepare(`
      UPDATE caregiver_profiles SET
        is_available = 0, account_paused = 1,
        account_paused_reason = ?,
        account_paused_at = NOW()
      WHERE user_id = ?
    `).run(reason.trim(), req.params.userId);

    await logAdminAction(req, "freeze_caregiver", "caregiver", req.params.userId, { reason: reason.trim() });

    console.log(`[admin] Froze caregiver ${req.params.userId} by ${req.user.email}: ${reason.trim()}`);
    res.json({ success: true, message: "Caregiver account frozen" });
  } catch (err) {
    console.error("Freeze caregiver error:", err);
    res.status(500).json({ error: "Failed to freeze caregiver" });
  }
});

// ─── GET /api/admin/safety-flags — List all safety flags for review ───
router.get("/safety-flags", authenticate, checkAdmin, requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const flags = await db.prepare(`
      SELECT sf.*, u.first_name, u.last_name, u.email,
        ru.first_name AS reviewer_first, ru.last_name AS reviewer_last
      FROM safety_flags sf
      JOIN users u ON sf.user_id = u.id
      LEFT JOIN users ru ON sf.reviewed_by = ru.id
      ORDER BY sf.created_at DESC
      LIMIT 50
    `).all();

    // Enrich each flag with conversation participants (so admin can message anyone involved)
    for (const flag of flags) {
      if (flag.conversation_id) {
        const participants = await db.prepare(`
          SELECT u.id AS user_id, u.first_name, u.last_name, u.email, u.role
          FROM conversation_members cm
          JOIN users u ON cm.user_id = u.id
          WHERE cm.conversation_id = ?
        `).all(flag.conversation_id);
        flag.participants = participants;
      } else {
        flag.participants = [];
      }
    }

    res.json({ flags });
  } catch (err) {
    console.error("Safety flags error:", err);
    res.status(500).json({ error: "Failed to load safety flags" });
  }
});

// ─── PUT /api/admin/safety-flags/:id — Review a safety flag ───
router.put("/safety-flags/:id", authenticate, checkAdmin, requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const { status, admin_notes } = req.body;
    if (!status) return res.status(400).json({ error: "Status is required" });

    await db.prepare(`
      UPDATE safety_flags SET status = ?, admin_notes = ?, reviewed_by = ?, reviewed_at = NOW()
      WHERE id = ?
    `).run(status, admin_notes || null, req.user.id, req.params.id);

    // Log status change as audit event
    await db.prepare(
      "INSERT INTO safety_flag_events (id, safety_flag_id, event_type, actor_id, actor_label, content, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())"
    ).run(uuid(), req.params.id, `status_${status}`, req.user.id, "Admin",
      admin_notes ? `Status changed to ${status}. Notes: ${admin_notes}` : `Status changed to ${status}`
    ).catch(() => {});

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to update safety flag" });
  }
});

// ─── POST /api/admin/safety-flags/:id/challenge — Generate passkey challenge for resolve/dismiss ───
router.post("/safety-flags/:id/challenge", authenticate, checkAdmin, requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const flag = await db.prepare("SELECT id FROM safety_flags WHERE id = ?").get(req.params.id);
    if (!flag) return res.status(404).json({ error: "Safety flag not found" });

    const passkeys = await db.prepare(
      "SELECT credential_id, transports FROM user_passkeys WHERE user_id = ?"
    ).all(req.user.id);
    if (passkeys.length === 0) {
      return res.status(400).json({ error: "You need a registered passkey. Set one up in My Account → Security." });
    }

    const allowCredentials = passkeys.map(pk => ({
      id: pk.credential_id,
      transports: pk.transports ? JSON.parse(pk.transports) : [],
    }));

    const options = await generateAuthenticationOptions({
      rpID: RP_ID,
      allowCredentials,
      userVerification: "required",
    });

    const challengeKey = `safetyflag_${req.user.id}_${req.params.id}_${Date.now()}`;
    setPasskeyChallenge(challengeKey, {
      challenge: options.challenge,
      adminId: req.user.id,
      flagId: req.params.id,
    });

    res.json({ ...options, _challengeKey: challengeKey });
  } catch (err) {
    console.error("Safety flag challenge error:", err);
    res.status(500).json({ error: "Failed to generate passkey challenge" });
  }
});

// ─── PUT /api/admin/safety-flags/:id/verified — Resolve/dismiss safety flag (requires passkey) ───
router.put("/safety-flags/:id/verified", authenticate, checkAdmin, requireAdmin, async (req, res) => {
  try {
    const { _challengeKey, status, admin_notes, ...authResponse } = req.body;
    if (!status) return res.status(400).json({ error: "Status is required" });

    // 1. Verify passkey challenge
    const stored = getPasskeyChallenge(_challengeKey);
    if (!stored) {
      return res.status(401).json({ error: "Passkey challenge expired. Please try again." });
    }
    if (stored.adminId !== req.user.id || stored.flagId !== req.params.id) {
      return res.status(401).json({ error: "Challenge mismatch." });
    }

    const db = await getDb();
    const passkey = await db.prepare(
      "SELECT pk.*, u.id as uid FROM user_passkeys pk JOIN users u ON pk.user_id = u.id WHERE pk.credential_id = ?"
    ).get(authResponse.id);
    if (!passkey || passkey.uid !== req.user.id) {
      return res.status(401).json({ error: "Passkey not found or doesn't belong to you." });
    }

    const verification = await verifyAuthenticationResponse({
      response: authResponse,
      expectedChallenge: stored.challenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      credential: { id: passkey.credential_id, publicKey: Buffer.from(passkey.public_key, "base64"), counter: passkey.counter || 0 },
    });

    if (!verification.verified) {
      return res.status(401).json({ error: "Passkey verification failed." });
    }

    // Update counter
    await db.prepare("UPDATE user_passkeys SET counter = ? WHERE credential_id = ?")
      .run(verification.authenticationInfo.newCounter, passkey.credential_id).catch(() => {});

    // 2. Perform the actual flag update
    await db.prepare(`
      UPDATE safety_flags SET status = ?, admin_notes = ?, reviewed_by = ?, reviewed_at = NOW()
      WHERE id = ?
    `).run(status, admin_notes || null, req.user.id, req.params.id);

    await db.prepare(
      "INSERT INTO safety_flag_events (id, safety_flag_id, event_type, actor_id, actor_label, content, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())"
    ).run(uuid(), req.params.id, `status_${status}`, req.user.id, "Admin (passkey verified)",
      admin_notes ? `Status changed to ${status} (passkey verified). Notes: ${admin_notes}` : `Status changed to ${status} (passkey verified)`
    ).catch(() => {});

    res.json({ success: true });
  } catch (err) {
    console.error("Safety flag verified review error:", err);
    res.status(500).json({ error: "Failed to update safety flag" });
  }
});

// ─── GET /api/admin/safety-flags/:id/thread — Full evidence thread for a safety flag ───
// Returns: original conversation messages, admin outreach threads, audit events — all in chronological order
router.get("/safety-flags/:id/thread", authenticate, checkAdmin, requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const flagId = req.params.id;

    // Get the safety flag itself
    const flag = await db.prepare(`
      SELECT sf.*, u.first_name, u.last_name, u.email
      FROM safety_flags sf JOIN users u ON sf.user_id = u.id
      WHERE sf.id = ?
    `).get(flagId);
    if (!flag) return res.status(404).json({ error: "Safety flag not found" });

    // Mark as read by admin
    if (!flag.admin_read_at) {
      await db.prepare("UPDATE safety_flags SET admin_read_at = NOW() WHERE id = ?").run(flagId);
      // Log read event
      await db.prepare(
        "INSERT INTO safety_flag_events (id, safety_flag_id, event_type, actor_id, actor_label, created_at) VALUES (?, ?, 'admin_viewed', ?, 'Admin', NOW())"
      ).run(uuid(), flagId, req.user.id);
    }

    // 1. Original conversation messages (evidence)
    let evidenceMessages = [];
    if (flag.conversation_id) {
      evidenceMessages = await db.prepare(`
        SELECT m.id, m.sender_id, m.content, m.created_at, m.sender_label,
          u.first_name, u.last_name, u.email, u.role
        FROM messages m
        LEFT JOIN users u ON m.sender_id = u.id
        WHERE m.conversation_id = ?
        ORDER BY m.created_at ASC
      `).all(flag.conversation_id);
    }

    // 2. Admin outreach threads (conversations linked to this safety flag)
    const linkedThreads = await db.prepare(`
      SELECT sft.*, c.name AS conv_name,
        u.first_name AS participant_first, u.last_name AS participant_last, u.email AS participant_email
      FROM safety_flag_threads sft
      JOIN conversations c ON sft.conversation_id = c.id
      JOIN users u ON sft.participant_user_id = u.id
      WHERE sft.safety_flag_id = ?
    `).all(flagId);

    // Get messages for each linked thread
    const outreachMessages = [];
    for (const thread of linkedThreads) {
      const msgs = await db.prepare(`
        SELECT m.id, m.sender_id, m.content, m.created_at, m.sender_label,
          u.first_name, u.last_name, u.email, u.role
        FROM messages m
        LEFT JOIN users u ON m.sender_id = u.id
        WHERE m.conversation_id = ?
        ORDER BY m.created_at ASC
      `).all(thread.conversation_id);
      outreachMessages.push({
        threadId: thread.id,
        conversationId: thread.conversation_id,
        participant: {
          userId: thread.participant_user_id,
          firstName: thread.participant_first,
          lastName: thread.participant_last,
          email: thread.participant_email,
        },
        messages: msgs,
      });
    }

    // 3. Audit events (status changes, notes, admin views)
    const events = await db.prepare(`
      SELECT e.*, u.first_name AS actor_first, u.last_name AS actor_last
      FROM safety_flag_events e
      LEFT JOIN users u ON e.actor_id = u.id
      WHERE e.safety_flag_id = ?
      ORDER BY e.created_at ASC
    `).all(flagId);

    // 4. Conversation participants
    let participants = [];
    if (flag.conversation_id) {
      participants = await db.prepare(`
        SELECT u.id AS user_id, u.first_name, u.last_name, u.email, u.role
        FROM conversation_members cm
        JOIN users u ON cm.user_id = u.id
        WHERE cm.conversation_id = ?
      `).all(flag.conversation_id);
    }

    res.json({
      flag,
      evidenceMessages,
      outreachMessages,
      events,
      participants,
    });
  } catch (err) {
    console.error("Safety flag thread error:", err);
    res.status(500).json({ error: "Failed to load thread" });
  }
});

// ─── POST /api/admin/safety-flags/:id/message/:userId — Send outreach message linked to safety flag ───
router.post("/safety-flags/:id/message/:userId", authenticate, checkAdmin, requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const flagId = req.params.id;
    const targetUserId = req.params.userId;
    const { message } = req.body;
    if (!message || !message.trim()) return res.status(400).json({ error: "Message is required" });

    const flag = await db.prepare("SELECT id, conversation_id FROM safety_flags WHERE id = ?").get(flagId);
    if (!flag) return res.status(404).json({ error: "Safety flag not found" });

    const targetUser = await db.prepare("SELECT id, first_name, last_name FROM users WHERE id = ?").get(targetUserId);
    if (!targetUser) return res.status(404).json({ error: "User not found" });

    // Check if we already have a linked thread for this participant
    let thread = await db.prepare(
      "SELECT * FROM safety_flag_threads WHERE safety_flag_id = ? AND participant_user_id = ?"
    ).get(flagId, targetUserId);

    let convId;
    if (thread) {
      convId = thread.conversation_id;
    } else {
      // Find existing InPlace Support conversation with this user, or create one
      const existing = await db.prepare(`
        SELECT c.id FROM conversations c
        JOIN conversation_members cm1 ON cm1.conversation_id = c.id AND cm1.user_id = ?
        JOIN conversation_members cm2 ON cm2.conversation_id = c.id AND cm2.user_id = ?
        WHERE c.type = 'direct' AND c.name = 'InPlace Support'
      `).get(req.user.id, targetUserId);

      if (existing) {
        convId = existing.id;
      } else {
        convId = uuid();
        await db.prepare("INSERT INTO conversations (id, type, name, created_by) VALUES (?, 'direct', 'InPlace Support', ?)").run(convId, req.user.id);
        await db.prepare("INSERT INTO conversation_members (id, conversation_id, user_id, role) VALUES (?, ?, ?, 'member')").run(uuid(), convId, req.user.id);
        await db.prepare("INSERT INTO conversation_members (id, conversation_id, user_id, role) VALUES (?, ?, ?, 'member')").run(uuid(), convId, targetUserId);
      }

      // Link this conversation to the safety flag
      await db.prepare(
        "INSERT INTO safety_flag_threads (id, safety_flag_id, conversation_id, participant_user_id, created_at) VALUES (?, ?, ?, ?, NOW())"
      ).run(uuid(), flagId, convId, targetUserId);
    }

    // Send the message
    const msgId = uuid();
    await db.prepare(
      "INSERT INTO messages (id, sender_id, recipient_id, content, conversation_id, sender_label, created_at) VALUES (?, ?, ?, ?, ?, 'InPlace Support', NOW())"
    ).run(msgId, req.user.id, targetUserId, message.trim(), convId);
    await db.prepare("UPDATE conversations SET updated_at = NOW() WHERE id = ?").run(convId);

    // Log as audit event
    await db.prepare(
      "INSERT INTO safety_flag_events (id, safety_flag_id, event_type, actor_id, actor_label, content, metadata, created_at) VALUES (?, ?, 'admin_message', ?, 'InPlace Support', ?, ?::jsonb, NOW())"
    ).run(uuid(), flagId, req.user.id, message.trim().substring(0, 500),
      JSON.stringify({ recipientId: targetUserId, recipientName: `${targetUser.first_name} ${targetUser.last_name}`, conversationId: convId })
    );

    // Push + WebSocket to recipient
    const emitToUser = req.app.get("emitToUser");
    if (emitToUser) {
      emitToUser(targetUserId, "new_message", {
        messageId: msgId, conversationId: convId,
        senderId: req.user.id, senderName: "InPlace Support",
        content: message.trim(),
      });
    }
    try {
      const { sendPushToUser } = require("./push");
      sendPushToUser(targetUserId, {
        title: "InPlace Support",
        body: message.trim().substring(0, 100),
        data: { type: "message", conversationId: convId },
      }).catch(() => {});
    } catch {}

    await logAdminAction(req, "safety_flag_message", "safety_flag", flagId, {
      recipientId: targetUserId, conversationId: convId,
    });

    res.json({ success: true, messageId: msgId, conversationId: convId });
  } catch (err) {
    console.error("Safety flag message error:", err);
    res.status(500).json({ error: "Failed to send message" });
  }
});

// ─── POST /api/admin/safety-flags/:id/note — Add internal admin note (not sent to anyone) ───
router.post("/safety-flags/:id/note", authenticate, checkAdmin, requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const { note } = req.body;
    if (!note || !note.trim()) return res.status(400).json({ error: "Note is required" });

    await db.prepare(
      "INSERT INTO safety_flag_events (id, safety_flag_id, event_type, actor_id, actor_label, content, created_at) VALUES (?, ?, 'admin_note', ?, 'Admin', ?, NOW())"
    ).run(uuid(), req.params.id, req.user.id, note.trim());

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to add note" });
  }
});

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

module.exports = router;
