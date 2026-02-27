const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { v4: uuid } = require("uuid");
// otplib v13+ uses top-level exports (no .authenticator)
let _otplib, _QRCode;
const getOtplib = () => { if (!_otplib) _otplib = require("otplib"); return _otplib; };
const getQRCode = () => { if (!_QRCode) _QRCode = require("qrcode"); return _QRCode; };
const { getDb } = require("../models/database");
const { authenticate } = require("../middleware/auth");

const router = express.Router();

// Rate limit 2FA verification attempts
const twoFaAttempts = new Map(); // userId -> { count, resetAt }
const MAX_2FA_ATTEMPTS = 5;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

function check2faRateLimit(userId) {
  const now = Date.now();
  const record = twoFaAttempts.get(userId);
  if (!record || now > record.resetAt) {
    twoFaAttempts.set(userId, { count: 1, resetAt: now + ATTEMPT_WINDOW_MS });
    return true;
  }
  if (record.count >= MAX_2FA_ATTEMPTS) return false;
  record.count++;
  return true;
}

function reset2faRateLimit(userId) {
  twoFaAttempts.delete(userId);
}

// ─── POST /api/auth/2fa/setup ─── Generate TOTP secret + QR code
router.post("/setup", authenticate, async (req, res) => {
  try {
    const db = await getDb();

    // Check if 2FA is already enabled
    const existing = await db.prepare("SELECT * FROM user_2fa WHERE user_id = ?").get(req.user.id);
    if (existing?.is_enabled) {
      return res.status(400).json({ error: "Two-factor authentication is already enabled" });
    }

    // Generate secret
    const otp = getOtplib();
    const secret = otp.generateSecret();
    const otpauth = otp.generateURI({ type: "totp", label: req.user.email, issuer: "InPlace", secret });

    // Generate QR code as data URL
    const qrCodeDataUrl = await getQRCode().toDataURL(otpauth);

    // Store secret (not yet enabled — user must verify first)
    if (existing) {
      await db.prepare("UPDATE user_2fa SET totp_secret = ?, is_enabled = 0, updated_at = NOW() WHERE user_id = ?")
        .run(secret, req.user.id);
    } else {
      await db.prepare("INSERT INTO user_2fa (id, user_id, totp_secret, is_enabled) VALUES (?, ?, ?, 0)")
        .run(uuid(), req.user.id, secret);
    }

    res.json({
      secret,
      qrCode: qrCodeDataUrl,
      message: "Scan the QR code with your authenticator app, then verify with a code",
    });
  } catch (err) {
    console.error("2FA setup error:", err);
    res.status(500).json({ error: "Failed to set up 2FA" });
  }
});

// ─── POST /api/auth/2fa/verify-setup ─── Verify TOTP code and enable 2FA
router.post("/verify-setup", authenticate, async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: "Verification code required" });

    const db = await getDb();
    const record = await db.prepare("SELECT * FROM user_2fa WHERE user_id = ?").get(req.user.id);

    if (!record) {
      return res.status(400).json({ error: "2FA setup not started. Call /setup first." });
    }
    if (record.is_enabled) {
      return res.status(400).json({ error: "2FA is already enabled" });
    }

    // Verify the code
    const verifyResult = getOtplib().verifySync({ token: code, secret: record.totp_secret });
    if (!verifyResult.valid) {
      return res.status(400).json({ error: "Invalid verification code. Try again." });
    }

    // Generate backup codes (8 codes, 8 chars each)
    const backupCodes = [];
    const hashedCodes = [];
    for (let i = 0; i < 8; i++) {
      const raw = crypto.randomBytes(4).toString("hex"); // 8 hex chars
      backupCodes.push(raw);
      hashedCodes.push(await bcrypt.hash(raw, 10));
    }

    // Enable 2FA and store hashed backup codes
    await db.prepare(
      "UPDATE user_2fa SET is_enabled = 1, backup_codes = ?, updated_at = NOW() WHERE user_id = ?"
    ).run(JSON.stringify(hashedCodes), req.user.id);

    res.json({
      message: "Two-factor authentication enabled successfully!",
      backupCodes,
      warning: "Save these backup codes in a safe place. They won't be shown again.",
    });
  } catch (err) {
    console.error("2FA verify-setup error:", err);
    res.status(500).json({ error: "Failed to verify 2FA setup" });
  }
});

// ─── POST /api/auth/2fa/verify ─── Verify TOTP code during login (uses tempToken, not JWT)
router.post("/verify", async (req, res) => {
  try {
    const { tempToken, code, deviceFingerprint, rememberDevice } = req.body;
    if (!tempToken || !code) {
      return res.status(400).json({ error: "Temporary token and verification code required" });
    }

    // Decode the temp token (it contains userId, stored as a signed value)
    const jwt = require("jsonwebtoken");
    const JWT_SECRET = process.env.JWT_SECRET || "inplace-dev-secret-change-me";
    let decoded;
    try {
      decoded = jwt.verify(tempToken, JWT_SECRET + "-2fa-temp");
    } catch {
      return res.status(401).json({ error: "Your login session timed out. Go back and sign in again.", code: "TEMP_TOKEN_EXPIRED" });
    }

    // Rate limit
    if (!check2faRateLimit(decoded.id)) {
      return res.status(429).json({ error: "Too many attempts. Please wait 15 minutes." });
    }

    const db = await getDb();
    const record = await db.prepare("SELECT * FROM user_2fa WHERE user_id = ? AND is_enabled = 1").get(decoded.id);
    if (!record) {
      return res.status(400).json({ error: "2FA not enabled for this account" });
    }

    // Try TOTP code first
    const verifyResult = getOtplib().verifySync({ token: code, secret: record.totp_secret });
    let isValid = verifyResult.valid;

    // If TOTP fails, try backup codes
    if (!isValid && record.backup_codes) {
      const hashedCodes = JSON.parse(record.backup_codes);
      for (let i = 0; i < hashedCodes.length; i++) {
        if (hashedCodes[i] && await bcrypt.compare(code, hashedCodes[i])) {
          // Burn the backup code
          hashedCodes[i] = null;
          await db.prepare("UPDATE user_2fa SET backup_codes = ?, updated_at = NOW() WHERE user_id = ?")
            .run(JSON.stringify(hashedCodes), decoded.id);
          isValid = true;
          break;
        }
      }
    }

    if (!isValid) {
      return res.status(400).json({ error: "That code didn't work. Check your authenticator app for a fresh code, or try a backup code.", code: "INVALID_2FA_CODE" });
    }

    // 2FA passed — reset rate limit
    reset2faRateLimit(decoded.id);

    // Get full user for token generation
    const user = await db.prepare("SELECT * FROM users WHERE id = ?").get(decoded.id);
    const { generateToken } = require("../middleware/auth");
    const token = generateToken(user);

    // Remember device if requested
    if (rememberDevice && deviceFingerprint) {
      const deviceId = uuid();
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days
      const deviceName = req.headers["user-agent"]
        ? req.headers["user-agent"].substring(0, 100)
        : "Unknown device";

      await db.prepare(
        "INSERT INTO trusted_devices (id, user_id, device_fingerprint, device_name, expires_at) VALUES (?, ?, ?, ?, ?)"
      ).run(deviceId, decoded.id, deviceFingerprint, deviceName, expiresAt);
    }

    res.json({
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        firstName: user.first_name,
        lastName: user.last_name,
        emailVerified: !!user.email_verified,
      },
      token,
    });
  } catch (err) {
    console.error("2FA verify error:", err);
    res.status(500).json({ error: "Verification failed" });
  }
});

// ─── POST /api/auth/2fa/disable ─── Disable 2FA (requires current TOTP code)
router.post("/disable", authenticate, async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: "Current 2FA code required to disable" });

    const db = await getDb();
    const record = await db.prepare("SELECT * FROM user_2fa WHERE user_id = ? AND is_enabled = 1").get(req.user.id);
    if (!record) {
      return res.status(400).json({ error: "2FA is not enabled" });
    }

    const disableVerify = getOtplib().verifySync({ token: code, secret: record.totp_secret });
    if (!disableVerify.valid) {
      return res.status(400).json({ error: "Invalid verification code" });
    }

    await db.prepare("DELETE FROM user_2fa WHERE user_id = ?").run(req.user.id);

    // Clean up trusted devices
    await db.prepare("DELETE FROM trusted_devices WHERE user_id = ?").run(req.user.id);

    res.json({ message: "Two-factor authentication has been disabled" });
  } catch (err) {
    console.error("2FA disable error:", err);
    res.status(500).json({ error: "Failed to disable 2FA" });
  }
});

// ─── POST /api/auth/2fa/backup-codes ─── Regenerate backup codes
router.post("/backup-codes", authenticate, async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: "Current 2FA code required" });

    const db = await getDb();
    const record = await db.prepare("SELECT * FROM user_2fa WHERE user_id = ? AND is_enabled = 1").get(req.user.id);
    if (!record) {
      return res.status(400).json({ error: "2FA is not enabled" });
    }

    const backupVerify = getOtplib().verifySync({ token: code, secret: record.totp_secret });
    if (!backupVerify.valid) {
      return res.status(400).json({ error: "Invalid verification code" });
    }

    // Generate new backup codes
    const backupCodes = [];
    const hashedCodes = [];
    for (let i = 0; i < 8; i++) {
      const raw = crypto.randomBytes(4).toString("hex");
      backupCodes.push(raw);
      hashedCodes.push(await bcrypt.hash(raw, 10));
    }

    await db.prepare("UPDATE user_2fa SET backup_codes = ?, updated_at = NOW() WHERE user_id = ?")
      .run(JSON.stringify(hashedCodes), req.user.id);

    res.json({
      backupCodes,
      warning: "Save these new backup codes. Previous codes are now invalid.",
    });
  } catch (err) {
    console.error("Backup codes regeneration error:", err);
    res.status(500).json({ error: "Failed to regenerate backup codes" });
  }
});

// ─── GET /api/auth/2fa/status ─── Check if 2FA is enabled for current user
router.get("/status", authenticate, async (req, res) => {
  try {
    const db = await getDb();
    const record = await db.prepare("SELECT is_enabled, created_at FROM user_2fa WHERE user_id = ?").get(req.user.id);

    res.json({
      enabled: !!(record?.is_enabled),
      setupAt: record?.created_at || null,
    });
  } catch (err) {
    console.error("2FA status error:", err);
    res.status(500).json({ error: "Failed to check 2FA status" });
  }
});

// ─── GET /api/auth/2fa/devices ─── List trusted devices
router.get("/devices", authenticate, async (req, res) => {
  try {
    const db = await getDb();
    const devices = await db.prepare(
      "SELECT id, device_name, last_used, expires_at, created_at FROM trusted_devices WHERE user_id = ? AND expires_at > NOW() ORDER BY last_used DESC"
    ).all(req.user.id);

    res.json({ devices });
  } catch (err) {
    console.error("List devices error:", err);
    res.status(500).json({ error: "Failed to list devices" });
  }
});

// ─── DELETE /api/auth/2fa/devices/:id ─── Revoke a trusted device
router.delete("/devices/:id", authenticate, async (req, res) => {
  try {
    const db = await getDb();
    await db.prepare("DELETE FROM trusted_devices WHERE id = ? AND user_id = ?").run(req.params.id, req.user.id);
    res.json({ message: "Device revoked" });
  } catch (err) {
    console.error("Revoke device error:", err);
    res.status(500).json({ error: "Failed to revoke device" });
  }
});

module.exports = router;
