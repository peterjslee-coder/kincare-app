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
};
