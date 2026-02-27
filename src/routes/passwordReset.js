const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { getDb } = require("../models/database");
const { sendEmail, brandedHtml } = require("../utils/email");

const router = express.Router();

// POST /api/password-reset/request — Send a reset email
router.post("/request", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required" });

    const db = await getDb();
    const user = await db.prepare("SELECT id, first_name, email FROM users WHERE email = ? AND is_active = 1").get(email.toLowerCase().trim());

    // Always return success (don't reveal whether email exists)
    if (!user) {
      return res.json({ message: "If that email is registered, you'll receive a reset link shortly." });
    }

    // Generate a secure token (64 hex chars)
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

    // Delete any existing tokens for this user
    await db.prepare("DELETE FROM password_reset_tokens WHERE user_id = ?").run(user.id);

    // Insert new token
    await db.prepare(
      "INSERT INTO password_reset_tokens (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)"
    ).run(crypto.randomUUID(), user.id, token, expiresAt);

    // Send reset email via Resend
    const baseUrl = (process.env.APP_URL || "https://yourinplace.com").replace(/\/$/, "");
    const resetUrl = `${baseUrl}/?reset=${token}`;

    await sendEmail({
      to: user.email,
      subject: "Reset your InPlace password",
      html: brandedHtml({
        title: "InPlace",
        greeting: `Hi ${user.first_name},`,
        body: "We received a request to reset your password. Click the button below to choose a new one:",
        ctaUrl: resetUrl,
        ctaText: "Reset Password",
        footnote: "This link expires in 1 hour. If you didn't request a reset, you can safely ignore this email.",
      }),
    });

    res.json({ message: "If that email is registered, you'll receive a reset link shortly." });
  } catch (err) {
    console.error("Password reset request error:", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// POST /api/password-reset/confirm — Reset the password with token
router.post("/confirm", async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: "Token and new password are required" });
    if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });
    if (!/[A-Z]/.test(password)) return res.status(400).json({ error: "Password must include an uppercase letter" });
    if (!/[0-9]/.test(password)) return res.status(400).json({ error: "Password must include a number" });
    if (!/[^A-Za-z0-9]/.test(password)) return res.status(400).json({ error: "Password must include a special character" });

    const db = await getDb();
    const resetToken = await db.prepare(
      "SELECT * FROM password_reset_tokens WHERE token = ?"
    ).get(token);

    if (!resetToken) {
      return res.status(400).json({ error: "Invalid or expired reset link. Please request a new one." });
    }

    // Check expiry
    if (new Date(resetToken.expires_at) < new Date()) {
      await db.prepare("DELETE FROM password_reset_tokens WHERE id = ?").run(resetToken.id);
      return res.status(400).json({ error: "This reset link has expired. Please request a new one." });
    }

    // Update the password and clear force-change flag
    const passwordHash = await bcrypt.hash(password, 10);
    await db.prepare("UPDATE users SET password_hash = ?, must_change_password = 0, password_changed_at = NOW(), updated_at = NOW() WHERE id = ?").run(passwordHash, resetToken.user_id);

    // Delete the used token
    await db.prepare("DELETE FROM password_reset_tokens WHERE user_id = ?").run(resetToken.user_id);

    console.log(`  [password-reset] Password reset for user ${resetToken.user_id}`);
    res.json({ message: "Password reset successfully. You can now sign in with your new password." });
  } catch (err) {
    console.error("Password reset confirm error:", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

module.exports = router;
