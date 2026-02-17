const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { v4: uuid } = require("uuid");
const { getDb } = require("../models/database");
const { generateToken, authenticate } = require("../middleware/auth");
const { validateRegister, validateLogin, validateProfileUpdate } = require("../middleware/validate");
const { sendEmail, brandedHtml } = require("../utils/email");

const router = express.Router();

// ─── POST /api/auth/register ───
router.post("/register", validateRegister, async (req, res) => {
  try {
    const { email, password, firstName, lastName, phone, role = "family" } = req.body;

    if (!email || !password || !firstName || !lastName) {
      return res.status(400).json({ error: "Missing required fields: email, password, firstName, lastName" });
    }

    if (!["family", "caregiver", "care_for"].includes(role)) {
      return res.status(400).json({ error: "Role must be 'family', 'caregiver', or 'care_for'" });
    }

    const db = await getDb();
    const existing = await db.prepare("SELECT id FROM users WHERE email = ?").get(email);
    if (existing) {
      return res.status(409).json({ error: "Email already registered" });
    }

    const id = uuid();
    const passwordHash = await bcrypt.hash(password, 10);

    await db.prepare(`
      INSERT INTO users (id, email, password_hash, role, first_name, last_name, phone, email_verified)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0)
    `).run(id, email, passwordHash, role, firstName, lastName, phone || null);

    const user = { id, email, role, firstName, lastName, emailVerified: false };
    const token = generateToken(user);

    // Send verification email (fire-and-forget)
    sendVerificationEmail(db, id, email, firstName).catch(err =>
      console.error("  [email] Failed to queue verification email:", err.message)
    );

    res.status(201).json({ user, token });
  } catch (err) {
    console.error("Registration error:", err);
    res.status(500).json({ error: "Registration failed" });
  }
});

// ─── POST /api/auth/login ───
router.post("/login", validateLogin, async (req, res) => {
  try {
    const { email, password } = req.body;

    const db = await getDb();
    const user = await db.prepare("SELECT * FROM users WHERE email = ? AND is_active = 1").get(email);

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = generateToken(user);

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
    console.error("Login error:", err);
    res.status(500).json({ error: "Login failed" });
  }
});

// ─── GET /api/auth/me ───
router.get("/me", authenticate, async (req, res) => {
  const db = await getDb();
  const user = await db.prepare(
    "SELECT id, email, role, first_name, last_name, phone, avatar_url, notification_prefs, email_verified, created_at FROM users WHERE id = ?"
  ).get(req.user.id);

  if (!user) return res.status(404).json({ error: "User not found" });

  res.json({ user: { ...user, email_verified: !!user.email_verified } });
});

// ─── PUT /api/auth/me ───
router.put("/me", authenticate, validateProfileUpdate, async (req, res) => {
  try {
    const { firstName, lastName, phone, notificationPrefs } = req.body;
    const db = await getDb();

    // Build dynamic update
    const fields = [];
    const values = [];

    if (firstName !== undefined) { fields.push("first_name = ?"); values.push(firstName); }
    if (lastName !== undefined) { fields.push("last_name = ?"); values.push(lastName); }
    if (phone !== undefined) { fields.push("phone = ?"); values.push(phone || null); }
    if (notificationPrefs !== undefined) {
      fields.push("notification_prefs = ?");
      values.push(JSON.stringify(notificationPrefs));
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    values.push(req.user.id);
    await db.prepare(`UPDATE users SET ${fields.join(", ")} WHERE id = ?`).run(...values);

    // Return updated user
    const user = await db.prepare(
      "SELECT id, email, role, first_name, last_name, phone, avatar_url, notification_prefs, created_at FROM users WHERE id = ?"
    ).get(req.user.id);

    res.json({ user });
  } catch (err) {
    console.error("Update profile error:", err);
    res.status(500).json({ error: "Failed to update profile" });
  }
});

// ─── Helper: send verification email ───
async function sendVerificationEmail(db, userId, email, firstName) {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours

  // Delete any existing tokens for this user
  await db.prepare("DELETE FROM email_verification_tokens WHERE user_id = ?").run(userId);

  // Insert new token
  await db.prepare(
    "INSERT INTO email_verification_tokens (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)"
  ).run(crypto.randomUUID(), userId, token, expiresAt);

  const verifyUrl = `${process.env.APP_URL || "https://yourinplace.com"}?verify=${token}`;

  return sendEmail({
    to: email,
    subject: "Verify your InPlace email",
    html: brandedHtml({
      title: "InPlace",
      greeting: `Welcome, ${firstName}!`,
      body: "Thanks for joining InPlace. Please verify your email address to get the most out of your account:",
      ctaUrl: verifyUrl,
      ctaText: "Verify Email",
      footnote: "This link expires in 24 hours. If you didn't create an InPlace account, you can safely ignore this email.",
    }),
  });
}

// ─── GET /api/auth/verify?token=xxx ───
router.get("/verify", async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({ error: "Verification token required" });

    const db = await getDb();
    const record = await db.prepare(
      "SELECT * FROM email_verification_tokens WHERE token = ?"
    ).get(token);

    if (!record) {
      return res.status(400).json({ error: "Invalid or expired verification link." });
    }

    if (new Date(record.expires_at) < new Date()) {
      await db.prepare("DELETE FROM email_verification_tokens WHERE id = ?").run(record.id);
      return res.status(400).json({ error: "This verification link has expired. Please request a new one." });
    }

    // Mark user as verified
    await db.prepare("UPDATE users SET email_verified = 1, email_verified_at = NOW() WHERE id = ?").run(record.user_id);

    // Delete the used token
    await db.prepare("DELETE FROM email_verification_tokens WHERE user_id = ?").run(record.user_id);

    console.log(`  [auth] Email verified for user ${record.user_id}`);
    res.json({ message: "Email verified successfully!" });
  } catch (err) {
    console.error("Email verification error:", err);
    res.status(500).json({ error: "Verification failed. Please try again." });
  }
});

// ─── POST /api/auth/resend-verification ───
router.post("/resend-verification", authenticate, async (req, res) => {
  try {
    const db = await getDb();
    const user = await db.prepare("SELECT id, email, first_name, email_verified FROM users WHERE id = ?").get(req.user.id);

    if (!user) return res.status(404).json({ error: "User not found" });
    if (user.email_verified) return res.json({ message: "Email is already verified." });

    await sendVerificationEmail(db, user.id, user.email, user.first_name);
    res.json({ message: "Verification email sent! Check your inbox." });
  } catch (err) {
    console.error("Resend verification error:", err);
    res.status(500).json({ error: "Failed to send verification email." });
  }
});

module.exports = router;
