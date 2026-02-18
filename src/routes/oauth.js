const express = require("express");
const { v4: uuid } = require("uuid");
const { getDb } = require("../models/database");
const { generateToken } = require("../middleware/auth");

const router = express.Router();

// Google OAuth configuration
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const APP_URL = process.env.APP_URL || "https://yourinplace.com";

// ─── GET /api/oauth/google ─── Redirect to Google consent screen
router.get("/google", (req, res) => {
  if (!GOOGLE_CLIENT_ID) {
    return res.status(503).json({ error: "Google Sign-In is not configured" });
  }

  const redirectUri = `${APP_URL}/api/oauth/google/callback`;
  const scope = encodeURIComponent("openid email profile");
  const state = require("crypto").randomBytes(16).toString("hex");

  // Store state in a short-lived cookie for CSRF protection
  res.cookie("oauth_state", state, { httpOnly: true, maxAge: 600000, sameSite: "lax" });

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${GOOGLE_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scope}&state=${state}&access_type=offline&prompt=consent`;

  res.redirect(authUrl);
});

// ─── GET /api/oauth/google/callback ─── Handle Google's redirect
router.get("/google/callback", async (req, res) => {
  try {
    const { code, state } = req.query;

    if (!code) {
      return res.redirect(`${APP_URL}?oauth_error=no_code`);
    }

    // Exchange authorization code for tokens
    const redirectUri = `${APP_URL}/api/oauth/google/callback`;
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenResponse.ok) {
      console.error("Google token exchange failed:", await tokenResponse.text());
      return res.redirect(`${APP_URL}?oauth_error=token_exchange_failed`);
    }

    const tokens = await tokenResponse.json();

    // Get user info from Google
    const userInfoResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!userInfoResponse.ok) {
      return res.redirect(`${APP_URL}?oauth_error=userinfo_failed`);
    }

    const googleUser = await userInfoResponse.json();
    const { id: googleId, email, given_name: firstName, family_name: lastName, picture } = googleUser;

    const db = await getDb();

    // Check if this Google account is already linked
    const existingOAuth = await db.prepare(
      "SELECT user_id FROM oauth_accounts WHERE provider = 'google' AND provider_user_id = ?"
    ).get(googleId);

    let user;

    if (existingOAuth) {
      // Google account already linked — log in
      user = await db.prepare("SELECT * FROM users WHERE id = ? AND is_active = 1").get(existingOAuth.user_id);
      if (!user) {
        return res.redirect(`${APP_URL}?oauth_error=account_disabled`);
      }
    } else {
      // Check if a user with this email already exists
      const existingUser = await db.prepare("SELECT * FROM users WHERE email = ? AND is_active = 1").get(email);

      if (existingUser) {
        // Link Google account to existing user
        user = existingUser;
        await db.prepare(
          "INSERT INTO oauth_accounts (id, user_id, provider, provider_user_id, provider_email, access_token, refresh_token) VALUES (?, ?, 'google', ?, ?, ?, ?)"
        ).run(uuid(), user.id, googleId, email, tokens.access_token, tokens.refresh_token || null);

        // Auto-verify email since Google verified it
        if (!user.email_verified) {
          await db.prepare("UPDATE users SET email_verified = 1, email_verified_at = NOW() WHERE id = ?").run(user.id);
        }
      } else {
        // Create new user via Google
        const userId = uuid();
        // Generate a random password hash (user can set a real password later if they want)
        const bcrypt = require("bcryptjs");
        const randomPassword = require("crypto").randomBytes(32).toString("hex");
        const passwordHash = await bcrypt.hash(randomPassword, 10);

        await db.prepare(`
          INSERT INTO users (id, email, password_hash, role, first_name, last_name, avatar_url, email_verified, email_verified_at)
          VALUES (?, ?, ?, 'family', ?, ?, ?, 1, NOW())
        `).run(userId, email, passwordHash, firstName || "User", lastName || "", picture || null);

        // Link Google account
        await db.prepare(
          "INSERT INTO oauth_accounts (id, user_id, provider, provider_user_id, provider_email, access_token, refresh_token) VALUES (?, ?, 'google', ?, ?, ?, ?)"
        ).run(uuid(), userId, googleId, email, tokens.access_token, tokens.refresh_token || null);

        user = await db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
      }
    }

    // Generate JWT
    const token = generateToken(user);

    // Redirect to app with token (frontend will pick it up from URL)
    res.redirect(`${APP_URL}?oauth_token=${token}&oauth_user=${encodeURIComponent(JSON.stringify({
      id: user.id,
      email: user.email,
      role: user.role,
      firstName: user.first_name,
      lastName: user.last_name,
      emailVerified: true,
      isDemo: !!user.is_demo,
    }))}`);
  } catch (err) {
    console.error("Google OAuth callback error:", err);
    res.redirect(`${APP_URL}?oauth_error=server_error`);
  }
});

// ─── GET /api/oauth/config ─── Return whether Google OAuth is configured (public)
router.get("/config", (req, res) => {
  res.json({
    google: !!GOOGLE_CLIENT_ID,
  });
});

module.exports = router;
