const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { v4: uuid } = require("uuid");
const { getDb } = require("../models/database");
const { generateToken, authenticate } = require("../middleware/auth");
const { validateRegister, validateLogin, validateProfileUpdate } = require("../middleware/validate");
const { sendEmail, brandedHtml } = require("../utils/email");
const { sendPushToAdmins } = require("./push");

const router = express.Router();

// ─── POST /api/auth/signup-intent ───
// Email-first signup: captures email + role, sends confirmation link
router.post("/signup-intent", async (req, res) => {
  try {
    const { email, role = "family" } = req.body;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Valid email is required" });
    }
    if (!["family", "caregiver"].includes(role)) {
      return res.status(400).json({ error: "Role must be 'family' or 'caregiver'" });
    }

    const db = await getDb();

    // Check if already registered
    const existing = await db.prepare("SELECT id FROM users WHERE email = ?").get(email);
    if (existing) {
      return res.status(409).json({ error: "This email is already registered. Try signing in instead." });
    }

    // Check for existing pending intent — reuse token if still valid
    const pendingIntent = await db.prepare(
      "SELECT id, token, expires_at FROM signup_intents WHERE email = ?"
    ).get(email);

    let token;
    if (pendingIntent && new Date(pendingIntent.expires_at) > new Date()) {
      token = pendingIntent.token;
      // Update role in case they changed their mind
      await db.prepare("UPDATE signup_intents SET role = ? WHERE id = ?").run(role, pendingIntent.id);
    } else {
      // Delete any expired intent
      if (pendingIntent) {
        await db.prepare("DELETE FROM signup_intents WHERE id = ?").run(pendingIntent.id);
      }
      // Create new intent
      token = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days
      await db.prepare(
        "INSERT INTO signup_intents (id, email, role, token, expires_at) VALUES (?, ?, ?, ?, ?)"
      ).run(uuid(), email, role, token, expiresAt);
    }

    const APP_URL = process.env.APP_URL || "https://yourinplace.com";
    const signupUrl = `${APP_URL}?signupToken=${token}`;
    const roleName = role === "caregiver" ? "a caregiver" : "a family member";

    // Send confirmation email
    sendEmail({
      to: email,
      subject: "Complete Your InPlace Signup",
      html: brandedHtml({
        title: "InPlace",
        greeting: "Welcome!",
        body: `You're one step away from joining InPlace as ${roleName}. Click the button below to create your account:`,
        ctaUrl: signupUrl,
        ctaText: "Complete Your Signup",
        footnote: "This link expires in 7 days. If you didn't request this, you can safely ignore this email.",
      }),
    }).catch(err => console.error("  [email] Signup intent email failed:", err.message));

    // Notify Pete (same as waitlist)
    const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || "peterjslee@gmail.com";
    sendEmail({
      to: NOTIFY_EMAIL,
      subject: `New InPlace signup interest: ${email} (${role})`,
      html: brandedHtml({
        title: "New Signup Interest",
        greeting: "Hey Pete,",
        body: `<strong>${email}</strong> wants to sign up as <strong>${roleName}</strong>.<br/>A confirmation email has been sent to them.`,
      }),
    }).catch(() => {});

    // Push notification to admins
    sendPushToAdmins("new_signup_intent", {
      title: "New Signup Interest",
      body: `${email} wants to join as ${roleName}`,
      data: { type: "new_signup_intent", email, role },
    });

    console.log(`  [auth] Signup intent: ${email} (${role})`);
    res.json({ message: "Check your email! We sent you a link to finish signing up." });
  } catch (err) {
    console.error("Signup intent error:", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// ─── GET /api/auth/confirm-signup?token=xxx ───
// Validates a signup intent token, returns email + role for frontend
router.get("/confirm-signup", async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({ error: "Signup token required" });

    const db = await getDb();
    const intent = await db.prepare("SELECT * FROM signup_intents WHERE token = ?").get(token);

    if (!intent) {
      return res.status(400).json({ error: "Invalid or expired signup link. Please sign up again." });
    }
    if (new Date(intent.expires_at) < new Date()) {
      await db.prepare("DELETE FROM signup_intents WHERE id = ?").run(intent.id);
      return res.status(400).json({ error: "This signup link has expired. Please sign up again." });
    }

    // Check if someone already registered with this email
    const existing = await db.prepare("SELECT id, role FROM users WHERE email = ?").get(intent.email);
    if (existing) {
      await db.prepare("DELETE FROM signup_intents WHERE id = ?").run(intent.id);
      // Check if caregiver has completed profile
      let hasProfile = true;
      if (existing.role === 'caregiver') {
        const profile = await db.prepare("SELECT id FROM caregiver_profiles WHERE user_id = ?").get(existing.id);
        hasProfile = !!profile;
      }
      return res.status(409).json({
        error: hasProfile
          ? "This email is already registered. Try signing in."
          : "This email is already registered but your profile isn't complete yet. Sign in to finish setting up your account.",
        alreadyRegistered: true,
        needsProfile: !hasProfile,
        email: intent.email,
      });
    }

    res.json({ email: intent.email, role: intent.role });
  } catch (err) {
    console.error("Confirm signup error:", err);
    res.status(500).json({ error: "Verification failed. Please try again." });
  }
});

// ─── POST /api/auth/register ───
router.post("/register", validateRegister, async (req, res) => {
  try {
    const { email, password, firstName, lastName, phone, role = "family", signupToken } = req.body;

    if (!email || !password || !firstName || !lastName) {
      return res.status(400).json({ error: "Missing required fields: email, password, firstName, lastName" });
    }

    if (!["family", "caregiver", "care_for"].includes(role)) {
      return res.status(400).json({ error: "Role must be 'family', 'caregiver', or 'care_for'" });
    }

    const db = await getDb();

    // Validate signup token if provided
    if (signupToken) {
      const intent = await db.prepare(
        "SELECT * FROM signup_intents WHERE token = ? AND email = ?"
      ).get(signupToken, email);
      if (!intent || new Date(intent.expires_at) < new Date()) {
        return res.status(400).json({ error: "Signup link expired or invalid. Please sign up again." });
      }
    }

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

    // Clean up signup intent if one was used
    if (signupToken) {
      await db.prepare("DELETE FROM signup_intents WHERE token = ?").run(signupToken).catch(() => {});
    }

    // Send verification email (fire-and-forget)
    sendVerificationEmail(db, id, email, firstName).catch(err =>
      console.error("  [email] Failed to queue verification email:", err.message)
    );

    // Push notification to admins (fire-and-forget)
    const roleName = role === "caregiver" ? "Caregiver" : role === "care_for" ? "Care Recipient" : "Family";
    sendPushToAdmins("new_registration", {
      title: "New User Registration",
      body: `${firstName} ${lastName} (${roleName}) just created an account`,
      data: { type: "new_registration", userId: id, email },
    });

    res.status(201).json({ user, token });
  } catch (err) {
    console.error("Registration error:", err);
    res.status(500).json({ error: "Registration failed" });
  }
});

// ─── POST /api/auth/login ───
router.post("/login", validateLogin, async (req, res) => {
  try {
    const { email, password, deviceFingerprint } = req.body;

    const db = await getDb();
    const user = await db.prepare("SELECT * FROM users WHERE email = ? AND is_active = 1").get(email);

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // Check if 2FA is enabled
    const twoFa = await db.prepare("SELECT is_enabled FROM user_2fa WHERE user_id = ? AND is_enabled = 1").get(user.id);
    if (twoFa) {
      // Check for trusted device
      let deviceTrusted = false;
      if (deviceFingerprint) {
        const device = await db.prepare(
          "SELECT id FROM trusted_devices WHERE user_id = ? AND device_fingerprint = ? AND expires_at > NOW()"
        ).get(user.id, deviceFingerprint);
        if (device) {
          deviceTrusted = true;
          await db.prepare("UPDATE trusted_devices SET last_used = NOW() WHERE id = ?").run(device.id);
        }
      }

      if (!deviceTrusted) {
        // Return temp token for 2FA verification (5 min expiry)
        const jwtLib = require("jsonwebtoken");
        const JWT_SECRET = process.env.JWT_SECRET || "inplace-dev-secret-change-me";
        const tempToken = jwtLib.sign({ id: user.id }, JWT_SECRET + "-2fa-temp", { expiresIn: "5m" });

        return res.json({
          requires2FA: true,
          tempToken,
          message: "Enter the code from your authenticator app",
        });
      }
    }

    const token = generateToken(user);

    const responseData = {
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        firstName: user.first_name,
        lastName: user.last_name,
        emailVerified: !!user.email_verified,
        isDemo: !!user.is_demo,
        isAdmin: !!user.is_admin,
      },
      token,
    };

    // Check if password change is required
    if (user.must_change_password) {
      responseData.mustChangePassword = true;
    }

    res.json(responseData);
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Login failed" });
  }
});

// ─── POST /api/auth/change-password ───
router.post("/change-password", authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Current password and new password required" });
    }

    if (newPassword.length < 8 || newPassword.length > 128) {
      return res.status(400).json({ error: "New password must be 8-128 characters" });
    }

    // Enforce password strength for non-demo accounts
    if (!/[A-Z]/.test(newPassword)) {
      return res.status(400).json({ error: "Password must contain at least one uppercase letter" });
    }
    if (!/[0-9]/.test(newPassword)) {
      return res.status(400).json({ error: "Password must contain at least one number" });
    }
    if (!/[^A-Za-z0-9]/.test(newPassword)) {
      return res.status(400).json({ error: "Password must contain at least one special character" });
    }

    const db = await getDb();
    const user = await db.prepare("SELECT password_hash FROM users WHERE id = ?").get(req.user.id);

    if (!user || !(await bcrypt.compare(currentPassword, user.password_hash))) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await db.prepare(
      "UPDATE users SET password_hash = ?, must_change_password = 0, password_changed_at = NOW(), updated_at = NOW() WHERE id = ?"
    ).run(newHash, req.user.id);

    res.json({ message: "Password changed successfully" });
  } catch (err) {
    console.error("Change password error:", err);
    res.status(500).json({ error: "Failed to change password" });
  }
});

// ─── GET /api/auth/me ───
router.get("/me", authenticate, async (req, res) => {
  const db = await getDb();
  const user = await db.prepare(
    "SELECT id, email, role, first_name, last_name, phone, avatar_url, notification_prefs, email_verified, is_demo, is_admin, password_changed_at, created_at FROM users WHERE id = ?"
  ).get(req.user.id);

  if (!user) return res.status(404).json({ error: "User not found" });

  // Check 2FA status
  const twoFa = await db.prepare("SELECT is_enabled FROM user_2fa WHERE user_id = ?").get(req.user.id);

  // Check linked OAuth accounts
  const oauthAccounts = await db.prepare("SELECT provider, provider_email FROM oauth_accounts WHERE user_id = ?").all(req.user.id);

  res.json({
    user: {
      ...user,
      email_verified: !!user.email_verified,
      is_demo: !!user.is_demo,
      is_admin: !!user.is_admin,
      twoFactorEnabled: !!(twoFa?.is_enabled),
      linkedAccounts: oauthAccounts || [],
    },
  });
});

// ─── PUT /api/auth/me ───
router.put("/me", authenticate, validateProfileUpdate, async (req, res) => {
  try {
    const { firstName, lastName, phone, notificationPrefs, pets, petAllergies, foodAllergies, medicalConditions } = req.body;
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
    if (pets !== undefined) { fields.push("pets = ?"); values.push(pets || null); }
    if (petAllergies !== undefined) { fields.push("pet_allergies = ?"); values.push(petAllergies || null); }
    if (foodAllergies !== undefined) { fields.push("food_allergies = ?"); values.push(foodAllergies || null); }
    if (medicalConditions !== undefined) { fields.push("medical_conditions = ?"); values.push(medicalConditions || null); }

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

// ─── DELETE /api/auth/me — Self-service account deletion ───
router.delete("/me", authenticate, async (req, res) => {
  try {
    const db = await getDb();
    const userId = req.user.id;
    const user = await db.prepare("SELECT id, email, role, is_demo FROM users WHERE id = ?").get(userId);
    if (!user) return res.status(404).json({ error: "User not found" });
    if (user.is_demo) return res.status(403).json({ error: "Cannot delete demo accounts" });

    // Get caregiver profile ID if exists (needed for cascading deletes)
    const cgProfile = await db.prepare("SELECT id FROM caregiver_profiles WHERE user_id = ?").get(userId);
    const cgId = cgProfile?.id;

    // Delete in FK-safe order
    // 1. Tables referencing caregiver_profiles
    if (cgId) {
      await db.prepare("DELETE FROM visit_photos WHERE visit_log_id IN (SELECT id FROM visit_logs WHERE caregiver_id = ?)").run(cgId);
      await db.prepare("DELETE FROM visit_logs WHERE caregiver_id = ?").run(cgId);
      await db.prepare("DELETE FROM availability WHERE caregiver_id = ?").run(cgId);
      await db.prepare("DELETE FROM reviews WHERE caregiver_id = ?").run(cgId);
      await db.prepare("DELETE FROM payments WHERE caregiver_id = ?").run(cgId);
      await db.prepare("DELETE FROM caregiver_assignments WHERE caregiver_profile_id = ?").run(cgId);
      await db.prepare("DELETE FROM care_sessions WHERE caregiver_id = ?").run(cgId);
      await db.prepare("DELETE FROM caregiver_profiles WHERE id = ?").run(cgId);
    }

    // 2. Tables referencing users(id) directly
    await db.prepare("DELETE FROM caregiver_documents WHERE user_id = ?").run(userId);
    await db.prepare("DELETE FROM password_reset_tokens WHERE user_id = ?").run(userId);
    await db.prepare("DELETE FROM email_verification_tokens WHERE user_id = ?").run(userId);
    await db.prepare("DELETE FROM push_subscriptions WHERE user_id = ?").run(userId);
    await db.prepare("DELETE FROM oauth_accounts WHERE user_id = ?").run(userId);
    await db.prepare("DELETE FROM user_2fa WHERE user_id = ?").run(userId);
    await db.prepare("DELETE FROM trusted_devices WHERE user_id = ?").run(userId);
    await db.prepare("DELETE FROM care_team_members WHERE user_id = ?").run(userId);
    await db.prepare("DELETE FROM conversation_members WHERE user_id = ?").run(userId);
    await db.prepare("DELETE FROM activity_feed WHERE family_user_id = ?").run(userId);
    await db.prepare("DELETE FROM care_recipient_shares WHERE shared_with_user_id = ? OR shared_by_user_id = ?").run(userId, userId);
    await db.prepare("DELETE FROM recipient_notes WHERE author_id = ?").run(userId);
    await db.prepare("DELETE FROM messages WHERE sender_id = ? OR recipient_id = ?").run(userId, userId);

    // 3. Delete user
    await db.prepare("DELETE FROM users WHERE id = ?").run(userId);

    console.log(`Account deleted: ${user.email} (${userId})`);
    res.json({ success: true, message: "Account deleted" });
  } catch (err) {
    console.error("Account deletion error:", err);
    res.status(500).json({ error: "Failed to delete account. " + (err.message || "") });
  }
});

module.exports = router;
