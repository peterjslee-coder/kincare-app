const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { v4: uuid } = require("uuid");
const { getDb } = require("../models/database");
const { generateToken, authenticate, setAuthCookie, clearAuthCookie, generateRefreshToken, setRefreshCookie, revokeRefreshToken, revokeAllUserRefreshTokens, setCsrfCookie } = require("../middleware/auth");
const { validateRegister, validateLogin, validateProfileUpdate } = require("../middleware/validate");
const { sendEmail, brandedHtml } = require("../utils/email");
const { sendPushToAdmins, notifyAdmins } = require("./push");
const { registerTrustedIp } = require("../utils/trustedIps");
const { getClientIp } = require("../middleware/auditLog");

const router = express.Router();

// ─── POST /api/auth/signup-intent ───
// Email-first signup: captures email + role, sends confirmation link
router.post("/signup-intent", async (req, res) => {
  try {
    const { email, role = "family" } = req.body;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Valid email is required" });
    }
    if (!["family", "caregiver", "care_for"].includes(role)) {
      return res.status(400).json({ error: "Role must be 'family', 'caregiver', or 'care_for'" });
    }

    const db = await getDb();

    // Check if email is blocked
    const blocked = await db.prepare("SELECT id FROM blocked_emails WHERE LOWER(email) = LOWER(?)").get(email);
    if (blocked) {
      return res.status(403).json({ error: "This email address is not permitted to register. Contact support if you believe this is an error." });
    }

    // Check if already registered (exclude soft-deleted accounts, case-insensitive)
    const existing = await db.prepare("SELECT id FROM users WHERE LOWER(email) = LOWER(?) AND is_active = 1").get(email);
    if (existing) {
      return res.status(409).json({ error: "This email is already registered. Try signing in instead." });
    }
    // Clean up any ghost soft-deleted accounts still holding this email
    await db.prepare("DELETE FROM users WHERE LOWER(email) = LOWER(?) AND is_active = 0").run(email);

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

    // Notify admins (push + email based on preferences)
    notifyAdmins("new_signup_intent", {
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

    // Check if someone already registered with this email (exclude soft-deleted, case-insensitive)
    const existing = await db.prepare("SELECT id, role FROM users WHERE LOWER(email) = LOWER(?) AND is_active = 1").get(intent.email);
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
    // Clean up ghost soft-deleted accounts still holding this email
    await db.prepare("DELETE FROM users WHERE LOWER(email) = LOWER(?) AND is_active = 0").run(intent.email);

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

    const existing = await db.prepare("SELECT id FROM users WHERE LOWER(email) = LOWER(?) AND is_active = 1").get(email);
    if (existing) {
      return res.status(409).json({ error: "Email already registered" });
    }
    // Clean up ghost soft-deleted accounts still holding this email
    await db.prepare("DELETE FROM users WHERE LOWER(email) = LOWER(?) AND is_active = 0").run(email);

    // Check if email is blocked
    const blocked = await db.prepare("SELECT id FROM blocked_emails WHERE LOWER(email) = LOWER(?)").get(email);
    if (blocked) {
      return res.status(403).json({ error: "This email address is not permitted to register. Contact support if you believe this is an error." });
    }

    const id = uuid();
    const passwordHash = await bcrypt.hash(password, 10);

    // Test account shortcut: last name ending in "Tester" auto-verifies + gets is_tester flag
    const isTestAccount = /tester$/i.test((lastName || "").trim());

    const roles = JSON.stringify([role]);
    await db.prepare(`
      INSERT INTO users (id, email, password_hash, role, roles, first_name, last_name, phone, email_verified, is_tester)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, email, passwordHash, role, roles, firstName, lastName, phone || null, isTestAccount ? 1 : 0, isTestAccount ? 1 : 0);

    const user = { id, email, role, roles: [role], firstName, lastName, emailVerified: isTestAccount };
    const token = generateToken(user);

    // Clean up signup intent if one was used
    if (signupToken) {
      await db.prepare("DELETE FROM signup_intents WHERE token = ?").run(signupToken).catch(() => {});
    }

    // Verification email is sent AFTER admin approval (not at signup).
    // This prevents burning the token before the account is approved.
    // See: admin.js PUT /users/:id/approve

    // Auto-create care_recipient record for care_for signups (self-signup = Tier 1, auto-verified)
    // v1.71.0 claim-by-invite: if a pending care_recipient invite exists for this email,
    // skip the auto-create — accepting the invite links them to the family-created
    // profile instead (prevents a duplicate recipient row).
    let pendingClaimInvite = null;
    if (role === "care_for") {
      try {
        pendingClaimInvite = await db.prepare(
          "SELECT id FROM care_team_invites WHERE LOWER(invited_email) = LOWER(?) AND status = 'pending' AND role = 'care_recipient' AND expires_at > NOW()"
        ).get(email);
      } catch (e) { pendingClaimInvite = null; }
      if (pendingClaimInvite) console.log("  [auth] care_for signup has a pending care_recipient invite — skipping auto-create; profile links at invite acceptance");
    }
    if (role === "care_for" && !pendingClaimInvite) {
      try {
        const crId = uuid();
        await db.prepare(`
          INSERT INTO care_recipients
          (id, family_user_id, first_name, last_name, linked_user_id,
           authorization_tier, consent_status, consent_method, consent_verified_at)
          VALUES (?, ?, ?, ?, ?, 'tier1', 'verified', 'self_signup', NOW())
        `).run(crId, id, firstName, lastName, id);

        // Auto-create care team
        const teamId = uuid();
        await db.prepare(
          "INSERT INTO care_teams (id, name, care_recipient_id, created_by) VALUES (?, ?, ?, ?)"
        ).run(teamId, `${firstName} ${lastName}'s Care Team`, crId, id);
        await db.prepare(
          "INSERT INTO care_team_members (id, care_team_id, user_id, role, invited_by) VALUES (?, ?, ?, 'leader', ?)"
        ).run(uuid(), teamId, id, id);

        // Auto-create care team conversation
        const convId = uuid();
        await db.prepare(
          "INSERT INTO conversations (id, type, name, care_team_id, created_by) VALUES (?, 'care_team', ?, ?, ?)"
        ).run(convId, `${firstName} ${lastName}'s Care Team`, teamId, id);
        await db.prepare(
          "INSERT INTO conversation_members (id, conversation_id, user_id, role) VALUES (?, ?, ?, 'admin')"
        ).run(uuid(), convId, id);
      } catch (crErr) {
        console.error("  [auth] Failed to auto-create care recipient for care_for user:", crErr.message);
        // Non-fatal — user account is already created, they can add recipient manually
      }
    }

    // Notify admins — new signup needs approval
    const roleName = role === "caregiver" ? "Caregiver" : role === "care_for" ? "Care Recipient" : "Family";
    notifyAdmins("new_registration", {
      title: "New Signup — Approval Needed",
      body: `${firstName} ${lastName} (${roleName}) signed up and needs your approval to continue.`,
      data: { type: "new_registration", userId: id, email, needsApproval: true },
    });

    setAuthCookie(res, token);
    setCsrfCookie(res);
    const refreshToken = await generateRefreshToken(id);
    setRefreshCookie(res, refreshToken);
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

    // Check for deactivated account first (separate from "not found")
    const anyUser = await db.prepare("SELECT id, is_active FROM users WHERE LOWER(email) = LOWER(?)").get(email);
    if (anyUser && !anyUser.is_active) {
      return res.status(401).json({ error: "This account has been deactivated. Contact support if you need help.", code: "ACCOUNT_DEACTIVATED" });
    }

    const user = await db.prepare("SELECT * FROM users WHERE LOWER(email) = LOWER(?) AND is_active = 1").get(email);

    if (!user) {
      // Generic message: do not reveal whether an email is registered (anti-enumeration).
      return res.status(401).json({ error: "Incorrect email or password.", code: "INVALID_CREDENTIALS" });
    }

    // Account lockout: 5 failed attempts → 15 minute cooldown
    const MAX_ATTEMPTS = 5;
    const LOCKOUT_MINUTES = 15;
    if (user.failed_login_attempts >= MAX_ATTEMPTS && user.last_failed_login) {
      const lockoutUntil = new Date(user.last_failed_login).getTime() + LOCKOUT_MINUTES * 60 * 1000;
      if (Date.now() < lockoutUntil) {
        const minsLeft = Math.ceil((lockoutUntil - Date.now()) / 60000);
        return res.status(429).json({ error: `Too many failed attempts. Try again in ${minsLeft} minute${minsLeft !== 1 ? "s" : ""}, or use "Forgot password" to reset.`, code: "ACCOUNT_LOCKED" });
      }
    }

    // Check if password was force-reset (must_change_password + recent password_changed_at = admin reset)
    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      // Track failed attempt
      await db.prepare("UPDATE users SET failed_login_attempts = COALESCE(failed_login_attempts, 0) + 1, last_failed_login = CURRENT_TIMESTAMP WHERE id = ?").run(user.id);
      // Check if there's a pending password reset token (admin-initiated or user-initiated)
      const pendingReset = await db.prepare(
        "SELECT id FROM password_reset_tokens WHERE user_id = ? AND expires_at > NOW()"
      ).get(user.id);
      if (pendingReset || user.must_change_password) {
        return res.status(401).json({ error: "Your password was recently reset. Check your email for a reset link, or use \"Forgot password\" below.", code: "PASSWORD_RESET_PENDING" });
      }
      return res.status(401).json({ error: "Incorrect email or password.", code: "INVALID_CREDENTIALS" });
    }

    // Reset failed attempts on successful login
    if (user.failed_login_attempts > 0) {
      await db.prepare("UPDATE users SET failed_login_attempts = 0, last_failed_login = NULL WHERE id = ?").run(user.id);
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
        const JWT_SECRET = process.env.JWT_SECRET;
        const tempToken = jwtLib.sign({ id: user.id }, JWT_SECRET + "-2fa-temp", { expiresIn: "5m" });

        return res.json({
          requires2FA: true,
          tempToken,
          message: "Enter the code from your authenticator app",
        });
      }
    }

    const token = generateToken(user);

    // Parse roles array from DB (backfill if needed)
    let userRoles;
    try { userRoles = user.roles ? JSON.parse(user.roles) : [user.role]; }
    catch { userRoles = [user.role]; }

    const responseData = {
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        roles: userRoles,
        firstName: user.first_name,
        lastName: user.last_name,
        emailVerified: !!user.email_verified,
        isDemo: !!user.is_demo,
        isAdmin: !!user.is_admin,
        companionAccess: !!user.companion_access,
      },
      token,
    };

    // Check if password change is required
    if (user.must_change_password) {
      responseData.mustChangePassword = true;
    }

    setAuthCookie(res, token);
    setCsrfCookie(res);
    const refreshToken = await generateRefreshToken(user.id);
    setRefreshCookie(res, refreshToken);

    // NOTE: Do NOT auto-trust admin IPs on login.
    // Unknown IPs should trigger a passkey challenge in the admin panel
    // so new networks are always verified explicitly.

    res.json(responseData);
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Login failed" });
  }
});

// ─── POST /api/auth/demo-login ───
// Passwordless login for demo accounts only — no credentials exposed in client JS
const DEMO_EMAILS = [
  'paul@inplace.care', 'maria@inplace.care', 'barbara@inplace.care',
  'david.lowe@inplace.care', 'susan.lowe@inplace.care',
];
router.post("/demo-login", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || !DEMO_EMAILS.includes(email.toLowerCase())) {
      return res.status(400).json({ error: "Invalid demo account" });
    }
    const db = await getDb();
    const user = await db.prepare("SELECT * FROM users WHERE LOWER(email) = LOWER(?) AND is_demo = 1").get(email);
    if (!user) {
      return res.status(404).json({ error: "Demo account not found" });
    }
    const token = generateToken(user);
    let roles;
    try { roles = user.roles ? JSON.parse(user.roles) : [user.role]; } catch { roles = [user.role]; }
    // Demo sessions: clear any persistent cookie (don't persist demo logins)
    clearAuthCookie(res);
    res.json({
      user: {
        id: user.id, email: user.email, role: user.role, roles,
        first_name: user.first_name, last_name: user.last_name,
        profile_photo: user.profile_photo || null,
        is_demo: true,
      },
      token,
    });
  } catch (err) {
    console.error("Demo login error:", err);
    res.status(500).json({ error: "Demo login failed" });
  }
});

// ─── POST /api/auth/logout ───
router.post("/logout", async (req, res) => {
  // Revoke the refresh token if present
  const refreshCookie = req.cookies?.refresh_token;
  if (refreshCookie) {
    await revokeRefreshToken(refreshCookie).catch(() => {});
  }
  clearAuthCookie(res);
  res.json({ ok: true });
});

// ─── POST /api/auth/refresh ─── (silent token refresh using httpOnly refresh_token cookie)
router.post("/refresh", async (req, res) => {
  try {
    const rawToken = req.cookies?.refresh_token;
    if (!rawToken) {
      console.log(`[Auth Refresh] No refresh_token cookie — cookieKeys: ${Object.keys(req.cookies || {}).join(',')}`);
      return res.status(401).json({ error: "No refresh token", code: "NO_REFRESH_TOKEN" });
    }

    const db = await getDb();
    const tokenHash = require("crypto").createHash("sha256").update(rawToken).digest("hex");
    const stored = await db.prepare(
      "SELECT rt.*, u.id as uid, u.email, u.role, u.roles, u.first_name, u.last_name, u.is_admin, u.is_demo, u.email_verified, u.is_active FROM refresh_tokens rt JOIN users u ON rt.user_id = u.id WHERE rt.token_hash = ?"
    ).get(tokenHash);

    if (!stored) {
      return res.status(401).json({ error: "Invalid refresh token", code: "INVALID_REFRESH_TOKEN" });
    }
    if (new Date(stored.expires_at) < new Date()) {
      await db.prepare("DELETE FROM refresh_tokens WHERE token_hash = ?").run(tokenHash);
      return res.status(401).json({ error: "Refresh token expired", code: "REFRESH_TOKEN_EXPIRED" });
    }
    if (!stored.is_active) {
      return res.status(401).json({ error: "Account deactivated", code: "ACCOUNT_DEACTIVATED" });
    }

    // Rotate: delete old refresh token, issue new one
    await db.prepare("DELETE FROM refresh_tokens WHERE token_hash = ?").run(tokenHash);

    let userRoles;
    try { userRoles = stored.roles ? JSON.parse(stored.roles) : [stored.role]; }
    catch { userRoles = [stored.role]; }

    const user = { id: stored.uid, email: stored.email, role: stored.role, roles: userRoles };
    const newAccessToken = generateToken(user);
    setAuthCookie(res, newAccessToken);
    setCsrfCookie(res);

    const newRefreshToken = await generateRefreshToken(stored.uid);
    setRefreshCookie(res, newRefreshToken);

    res.json({
      user: {
        id: stored.uid, email: stored.email, role: stored.role, roles: userRoles,
        firstName: stored.first_name, lastName: stored.last_name,
        emailVerified: !!stored.email_verified, isDemo: !!stored.is_demo, isAdmin: !!stored.is_admin,
      },
      token: newAccessToken,
    });
  } catch (err) {
    console.error("Token refresh error:", err);
    res.status(500).json({ error: "Token refresh failed" });
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
    "SELECT id, email, role, roles, first_name, last_name, phone, avatar_url, profile_photo, notification_prefs, accessibility_prefs, email_verified, is_demo, is_admin, is_tester, account_approved, companion_access, password_changed_at, disclaimer_accepted_at, disclaimer_version, pets, pet_allergies, food_allergies, medical_conditions, address_line1, address_line2, city, state, zip, created_at FROM users WHERE id = ?"
  ).get(req.user.id);

  if (!user) return res.status(404).json({ error: "User not found" });

  // Parse roles array
  let userRoles;
  try { userRoles = user.roles ? JSON.parse(user.roles) : [user.role]; }
  catch { userRoles = [user.role]; }

  // Check 2FA status
  const twoFa = await db.prepare("SELECT is_enabled FROM user_2fa WHERE user_id = ?").get(req.user.id);

  // Check linked OAuth accounts
  const oauthAccounts = await db.prepare("SELECT provider, provider_email FROM oauth_accounts WHERE user_id = ?").all(req.user.id);

  // Check caregiver onboarding status
  let onboardingComplete = null;
  if (userRoles.includes('caregiver')) {
    const cgProfile = await db.prepare("SELECT onboarding_complete FROM caregiver_profiles WHERE user_id = ?").get(req.user.id);
    onboardingComplete = cgProfile ? !!cgProfile.onboarding_complete : false;
  }

  // Check care_for (self-onboarding) status
  let selfOnboardingComplete = null;
  let careRecipientId = null;
  if (userRoles.includes('care_for')) {
    const cr = await db.prepare("SELECT id, self_onboarding_complete FROM care_recipients WHERE linked_user_id = ?").get(req.user.id);
    if (cr) {
      selfOnboardingComplete = !!cr.self_onboarding_complete;
      careRecipientId = cr.id;
    }
  }

  // Check identity verification status (selfie + ID in verified_documents)
  let identityVerified = false;
  let identityStatus = 'not_started'; // 'not_started' | 'pending' | 'verified' | 'rejected'
  try {
    // Check docs uploaded BY this user or docs owned by their care recipient record
    const idDoc = await db.prepare(
      `SELECT status, is_verified FROM verified_documents
       WHERE category = 'identity' AND document_type != 'selfie'
         AND (uploaded_by = ? ${careRecipientId ? `OR owner_id = ?` : ''})
       ORDER BY created_at DESC LIMIT 1`
    ).get(...[req.user.id, ...(careRecipientId ? [careRecipientId] : [])]);
    if (idDoc) {
      if (idDoc.status === 'approved' || idDoc.is_verified) {
        identityVerified = true;
        identityStatus = 'verified';
      } else if (idDoc.status === 'rejected') {
        identityStatus = 'rejected';
      } else {
        identityStatus = 'pending';
      }
    }
  } catch (e) { /* verified_documents table may not exist yet */ }

  // Check for pending legal documents that need acceptance
  let pendingLegalDocs = [];
  try {
    const activeDocs = await db.prepare(
      "SELECT id, doc_type, version, title, content, change_summary, previous_version FROM legal_documents WHERE is_active = 1"
    ).all();
    const acceptances = await db.prepare(
      "SELECT DISTINCT ON (doc_type) doc_type, version FROM user_legal_acceptances WHERE user_id = ? ORDER BY doc_type, accepted_at DESC"
    ).all(req.user.id);
    const acceptMap = {};
    for (const a of acceptances) acceptMap[a.doc_type] = a.version;
    // v1.65.0: role-scoped agreements — the Caregiver Agreement only binds
    // caregivers; the Client Services Agreement only binds families and care
    // recipients. Platform-wide docs (terms/privacy/etc.) apply to everyone.
    const DOC_ROLES = { caregiver_agreement: ["caregiver"], client_services: ["family", "care_for"] };
    pendingLegalDocs = activeDocs
      .filter(d => acceptMap[d.doc_type] !== d.version)
      .filter(d => {
        const required = DOC_ROLES[d.doc_type];
        return !required || required.some(r => userRoles.includes(r));
      });
  } catch (e) { /* legal docs table may not exist yet */ }

  // Include token for in-memory use (WebSocket auth) — cookie handles persistence
  const token = generateToken(user);
  // Don't overwrite admin's auth cookie when impersonating another user
  if (!req.user.impersonatedBy) {
    setAuthCookie(res, token);
    setCsrfCookie(res);
  }

  // ─── Track client version info (non-blocking) ───
  // Read app version from header, detect platform from user-agent
  const appVersion = req.headers['x-app-version'] || null;
  const userAgent = req.headers['user-agent'] || '';
  let platform = 'web';
  if (userAgent.includes('InPlace-Android')) {
    platform = 'android';
  } else if (userAgent.includes('InPlace-iOS')) {
    platform = 'ios';
  }
  // Upsert into user_client_info (non-blocking)
  db.prepare(
    `INSERT INTO user_client_info (user_id, app_version, user_agent, platform, last_seen_at, updated_at)
     VALUES (?, ?, ?, ?, NOW(), NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       app_version = EXCLUDED.app_version,
       user_agent = EXCLUDED.user_agent,
       platform = EXCLUDED.platform,
       last_seen_at = NOW(),
       updated_at = NOW()`
  ).run(req.user.id, appVersion, userAgent, platform).catch(err => {
    // Silent fail — don't let tracking errors break auth
    console.warn('Client info tracking error:', err.message);
  });

  res.json({
    user: {
      ...user,
      roles: userRoles,
      email_verified: !!user.email_verified,
      is_demo: !!user.is_demo,
      is_admin: !!user.is_admin,
      is_tester: !!user.is_tester,
      account_approved: !!user.account_approved,
      companion_access: !!user.companion_access,
      twoFactorEnabled: !!(twoFa?.is_enabled),
      linkedAccounts: oauthAccounts || [],
      onboarding_complete: onboardingComplete,
      selfOnboardingComplete,
      careRecipientId,
      identityVerified,
      identityStatus,
      pendingLegalDocs,
    },
    token,
  });
});

// ─── PUT /api/auth/me ───
router.put("/me", authenticate, validateProfileUpdate, async (req, res) => {
  try {
    const { firstName, lastName, phone, notificationPrefs, accessibilityPrefs, pets, petAllergies, foodAllergies, medicalConditions, addressLine1, addressLine2, city, state, zip } = req.body;
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
    if (addressLine1 !== undefined) { fields.push("address_line1 = ?"); values.push(addressLine1 || null); }
    if (addressLine2 !== undefined) { fields.push("address_line2 = ?"); values.push(addressLine2 || null); }
    if (city !== undefined) { fields.push("city = ?"); values.push(city || null); }
    if (state !== undefined) { fields.push("state = ?"); values.push(state || null); }
    if (zip !== undefined) { fields.push("zip = ?"); values.push(zip || null); }
    if (accessibilityPrefs !== undefined) {
      fields.push("accessibility_prefs = ?");
      values.push(JSON.stringify(accessibilityPrefs));
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    values.push(req.user.id);
    await db.prepare(`UPDATE users SET ${fields.join(", ")} WHERE id = ?`).run(...values);

    // Return updated user
    const user = await db.prepare(
      "SELECT id, email, role, roles, first_name, last_name, phone, avatar_url, profile_photo, notification_prefs, accessibility_prefs, pets, pet_allergies, food_allergies, medical_conditions, address_line1, address_line2, city, state, zip, created_at FROM users WHERE id = ?" /* v1.74.5: profile_photo was missing — saving an address blanked the avatar in the UI */
    ).get(req.user.id);

    // Parse roles
    let parsedRoles;
    try { parsedRoles = user.roles ? JSON.parse(user.roles) : [user.role]; }
    catch { parsedRoles = [user.role]; }

    res.json({ user: { ...user, roles: parsedRoles } });
  } catch (err) {
    console.error("Update profile error:", err);
    res.status(500).json({ error: "Failed to update profile" });
  }
});

// ─── POST /api/auth/add-role ───
// Add a second role to the current user's account
router.post("/add-role", authenticate, async (req, res) => {
  try {
    const { role: newRole } = req.body;

    if (!["family", "caregiver", "care_for"].includes(newRole)) {
      return res.status(400).json({ error: "Role must be 'family', 'caregiver', or 'care_for'" });
    }

    const db = await getDb();
    const user = await db.prepare("SELECT id, role, roles, first_name, last_name, email FROM users WHERE id = ?").get(req.user.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    // Parse existing roles
    let currentRoles;
    try { currentRoles = user.roles ? JSON.parse(user.roles) : [user.role]; }
    catch { currentRoles = [user.role]; }

    if (currentRoles.includes(newRole)) {
      return res.status(409).json({ error: "You already have this role" });
    }

    // Add the new role
    currentRoles.push(newRole);
    await db.prepare("UPDATE users SET roles = ? WHERE id = ?").run(JSON.stringify(currentRoles), user.id);

    // If adding caregiver role, create a blank caregiver_profiles row
    if (newRole === "caregiver") {
      const existingProfile = await db.prepare("SELECT id FROM caregiver_profiles WHERE user_id = ?").get(user.id);
      if (!existingProfile) {
        await db.prepare(
          "INSERT INTO caregiver_profiles (id, user_id, hourly_rate, is_available) VALUES (?, ?, 25, 0)"
        ).run(uuid(), user.id);
      }
    }

    // Generate new token with updated roles
    const token = generateToken({ ...user, roles: currentRoles });

    // Notify admins
    const roleLabel = newRole === "caregiver" ? "Caregiver" : newRole === "care_for" ? "Care Recipient" : "Family";
    notifyAdmins("new_registration", {
      title: "User Added a Role",
      body: `${user.first_name} ${user.last_name} added the ${roleLabel} role to their account`,
      data: { type: "role_added", userId: user.id },
    });

    setAuthCookie(res, token);
    setCsrfCookie(res);
    res.json({ roles: currentRoles, token });
  } catch (err) {
    console.error("Add role error:", err);
    res.status(500).json({ error: "Failed to add role" });
  }
});

// ─── POST /api/auth/remove-role ───
// Remove a role from the current user's account (must keep at least one)
router.post("/remove-role", authenticate, async (req, res) => {
  try {
    const { role: removeRole } = req.body;

    if (!["family", "caregiver", "care_for"].includes(removeRole)) {
      return res.status(400).json({ error: "Invalid role" });
    }

    const db = await getDb();
    const user = await db.prepare("SELECT id, role, roles, first_name, last_name, email FROM users WHERE id = ?").get(req.user.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    // Parse existing roles
    let currentRoles;
    try { currentRoles = user.roles ? JSON.parse(user.roles) : [user.role]; }
    catch { currentRoles = [user.role]; }

    if (!currentRoles.includes(removeRole)) {
      return res.status(400).json({ error: "You don't have this role" });
    }

    if (currentRoles.length <= 1) {
      return res.status(400).json({ error: "You must keep at least one role. To fully remove your account, use Delete Account instead." });
    }

    // Remove the role
    const newRoles = currentRoles.filter(r => r !== removeRole);
    const newPrimaryRole = newRoles[0];
    await db.prepare("UPDATE users SET roles = ?, role = ? WHERE id = ?").run(JSON.stringify(newRoles), newPrimaryRole, user.id);

    // Clean up role-specific data
    if (removeRole === "caregiver") {
      // Remove caregiver profile, availability, and assignments
      await db.prepare("DELETE FROM availability WHERE caregiver_id = ?").run(user.id);
      await db.prepare("DELETE FROM caregiver_assignments WHERE caregiver_id = ?").run(user.id);
      await db.prepare("DELETE FROM caregiver_profiles WHERE user_id = ?").run(user.id);
    }

    // Generate new token with updated roles
    const token = generateToken({ ...user, role: newPrimaryRole, roles: newRoles });

    // Log the removal
    await db.prepare(
      "INSERT INTO activity_feed (id, user_id, type, title, body, created_at) VALUES (?, ?, 'role_removed', ?, ?, NOW())"
    ).run(uuid(), user.id, "Role Removed", `Removed ${removeRole} role from account`);

    setAuthCookie(res, token);
    setCsrfCookie(res);
    res.json({ roles: newRoles, token, primaryRole: newPrimaryRole });
  } catch (err) {
    console.error("Remove role error:", err);
    res.status(500).json({ error: "Failed to remove role" });
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

// ─── PUT /api/auth/me/photo ─── Upload profile photo (base64)
router.put("/me/photo", authenticate, async (req, res) => {
  try {
    const db = await getDb();
    const { photo } = req.body; // base64 data URL
    if (!photo) return res.status(400).json({ error: "No photo provided" });
    if (photo.length > 2 * 1024 * 1024) return res.status(400).json({ error: "Photo too large (max 1.5MB)" });
    await db.prepare("UPDATE users SET profile_photo = ?, avatar_url = ?, updated_at = NOW() WHERE id = ?").run(photo, photo, req.user.id);
    res.json({ message: "Profile photo updated", photoUrl: photo });
  } catch (err) {
    console.error("Photo upload error:", err);
    res.status(500).json({ error: "Failed to upload photo" });
  }
});

// ─── DELETE /api/auth/me/photo ─── Remove profile photo
router.delete("/me/photo", authenticate, async (req, res) => {
  try {
    const db = await getDb();
    await db.prepare("UPDATE users SET profile_photo = NULL, avatar_url = NULL, updated_at = NOW() WHERE id = ?").run(req.user.id);
    res.json({ message: "Profile photo removed" });
  } catch (err) {
    console.error("Photo delete error:", err);
    res.status(500).json({ error: "Failed to remove photo" });
  }
});

// ─── PUT /api/auth/me/disclaimer ─── Accept platform disclaimer
router.put("/me/disclaimer", authenticate, async (req, res) => {
  try {
    const db = await getDb();
    const version = "1.0";
    await db.prepare(
      "UPDATE users SET disclaimer_accepted_at = NOW(), disclaimer_version = ?, updated_at = NOW() WHERE id = ?"
    ).run(version, req.user.id);
    res.json({ message: "Disclaimer acknowledged", version });
  } catch (err) {
    console.error("Disclaimer accept error:", err);
    res.status(500).json({ error: "Failed to accept disclaimer" });
  }
});

// ─── DELETE /api/auth/me — Self-service account deletion (soft-delete) ───
// Anonymizes PII and deactivates the account. Retains messages, session
// history, payment records, and activity feed for legal/audit purposes.
router.delete("/me", authenticate, async (req, res) => {
  try {
    const db = await getDb();
    const userId = req.user.id;
    const user = await db.prepare("SELECT id, email, role, is_demo FROM users WHERE id = ?").get(userId);
    if (!user) return res.status(404).json({ error: "User not found" });
    if (user.is_demo) return res.status(403).json({ error: "Cannot delete demo accounts" });

    // Store exit reason if provided
    const { reason, reasonDetail } = req.body || {};

    const anonEmail = `deleted_${userId.slice(0, 8)}@deleted.inplace`;

    // ── Run everything in a transaction so it's all-or-nothing ──
    await db.transaction(async (tx) => {
      // Get caregiver profile ID if exists
      const cgProfile = await tx.prepare("SELECT id FROM caregiver_profiles WHERE user_id = ?").get(userId);
      const cgId = cgProfile?.id;

      // 1. Caregiver-specific cleanup
      if (cgId) {
        // Unassign ALL non-completed/cancelled sessions back to 'requested' so families don't lose them
        await tx.prepare(`
          UPDATE care_sessions
          SET caregiver_id = NULL, status = 'requested', updated_at = NOW()
          WHERE caregiver_id = ? AND status NOT IN ('completed', 'cancelled')
        `).run(cgId);
        // Cancel pending offers
        await tx.prepare("UPDATE session_offers SET status = 'expired' WHERE (from_user_id = ? OR to_user_id = ?) AND status = 'pending'").run(userId, userId);
        // Remove active assignments
        await tx.prepare("DELETE FROM caregiver_assignments WHERE caregiver_profile_id = ?").run(cgId);
        // Remove availability (no longer accepting work)
        await tx.prepare("DELETE FROM availability WHERE caregiver_id = ?").run(cgId);
        // Anonymize caregiver profile PII but keep the record (linked to session history)
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

      // 2. Delete sensitive auth & device data (no audit value)
      await tx.prepare("DELETE FROM password_reset_tokens WHERE user_id = ?").run(userId);
      await tx.prepare("DELETE FROM email_verification_tokens WHERE user_id = ?").run(userId);
      await tx.prepare("DELETE FROM push_subscriptions WHERE user_id = ?").run(userId);
      await tx.prepare("DELETE FROM oauth_accounts WHERE user_id = ?").run(userId);
      await tx.prepare("DELETE FROM user_2fa WHERE user_id = ?").run(userId);
      await tx.prepare("DELETE FROM trusted_devices WHERE user_id = ?").run(userId);
      await tx.prepare("DELETE FROM user_passkeys WHERE user_id = ?").run(userId);

      // 3. Retain personal documents for fraud/audit protection (don't delete)
      await tx.prepare("UPDATE caregiver_documents SET retained_from_deleted = 1, deleted_user_email = ? WHERE user_id = ?").run(user.email, userId);
      await tx.prepare("UPDATE verified_documents SET retained_from_deleted = 1, deleted_user_email = ? WHERE uploaded_by = ?").run(user.email, userId);
      await tx.prepare("UPDATE authorization_documents SET retained_from_deleted = 1, deleted_user_email = ? WHERE uploaded_by_user_id = ?").run(user.email, userId);

      // 4. Remove from active teams & connections (but keep invite history)
      await tx.prepare("DELETE FROM care_team_members WHERE user_id = ?").run(userId);
      await tx.prepare("DELETE FROM connections WHERE requester_id = ? OR recipient_id = ?").run(userId, userId);
      await tx.prepare("DELETE FROM conversation_members WHERE user_id = ?").run(userId);
      await tx.prepare("DELETE FROM care_recipient_shares WHERE shared_with_user_id = ? OR shared_by_user_id = ?").run(userId, userId);
      await tx.prepare("UPDATE care_recipients SET linked_user_id = NULL WHERE linked_user_id = ?").run(userId);

      // 5. RETAIN for audit: messages, activity_feed, feedback, reviews, payments,
      //    care_sessions (completed), background_check_payments, payout_preferences,
      //    recipient_notes — all stay linked to the anonymized user row

      // 5b. Log the exit reason as an activity feed entry (before anonymizing)
      if (reason) {
        const { v4: uuidv4 } = require("uuid");
        await tx.prepare(`
          INSERT INTO activity_feed (id, family_user_id, event_type, title, message, metadata, created_at)
          VALUES (?, ?, 'account_deleted', 'Account deleted', ?, ?, NOW())
        `).run(uuidv4(), userId, reason === 'other' ? (reasonDetail || 'No reason given') : reason, JSON.stringify({ reason, reasonDetail: reasonDetail || null, role: user.role }));
      }

      // 6. Anonymize the user row — strip PII, deactivate, preserve the ID
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
      `).run(anonEmail, userId);
    }); // end transaction

    console.log(`Account soft-deleted: ${user.email} (${userId}) → ${anonEmail}`);
    res.json({ success: true, message: "Account deleted" });
  } catch (err) {
    console.error("Account deletion error:", err);
    console.error("Account deletion error:", err.message); res.status(500).json({ error: "Failed to delete account" });
  }
});

router.sendVerificationEmail = sendVerificationEmail;
module.exports = router;
