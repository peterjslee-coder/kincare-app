const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { getDb } = require("../models/database");
const { Resend } = require("resend");

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
    const resetUrl = `${process.env.APP_URL || "https://yourinplace.com"}?reset=${token}`;

    if (process.env.RESEND_API_KEY) {
      const resend = new Resend(process.env.RESEND_API_KEY);
      try {
        await resend.emails.send({
          from: "InPlace <onboarding@resend.dev>",
          to: user.email,
          subject: "Reset your InPlace password",
          html: [
            `<div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto;">`,
            `<div style="background: #1b6b5a; padding: 24px; border-radius: 12px 12px 0 0; text-align: center;">`,
            `<h1 style="color: white; margin: 0; font-size: 24px;">InPlace</h1>`,
            `</div>`,
            `<div style="padding: 32px 24px; background: #ffffff; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 12px 12px;">`,
            `<p style="color: #333; font-size: 16px;">Hi ${user.first_name},</p>`,
            `<p style="color: #555;">We received a request to reset your password. Click the button below to choose a new one:</p>`,
            `<div style="text-align: center; margin: 28px 0;">`,
            `<a href="${resetUrl}" style="background: #1b6b5a; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px; display: inline-block;">Reset Password</a>`,
            `</div>`,
            `<p style="color: #888; font-size: 13px;">This link expires in 1 hour. If you didn't request a reset, you can safely ignore this email.</p>`,
            `<hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />`,
            `<p style="color: #aaa; font-size: 12px; text-align: center;">InPlace — On-demand care for your loved ones</p>`,
            `</div>`,
            `</div>`,
          ].join("\n"),
        });
        console.log(`  [email] Password reset email sent to ${user.email}`);
      } catch (err) {
        console.error("  [email] Failed to send reset email:", err.message);
      }
    } else {
      console.log(`  [password-reset] Token for ${user.email}: ${token} (no RESEND_API_KEY configured)`);
    }

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
    if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });

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

    // Update the password
    const passwordHash = await bcrypt.hash(password, 10);
    await db.prepare("UPDATE users SET password_hash = ?, updated_at = NOW() WHERE id = ?").run(passwordHash, resetToken.user_id);

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
