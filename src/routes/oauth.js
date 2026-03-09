const express = require("express");
const crypto = require("crypto");
const { v4: uuid } = require("uuid");
const { getDb } = require("../models/database");
const { generateToken, setAuthCookie, setCsrfCookie, generateRefreshToken, setRefreshCookie } = require("../middleware/auth");

const router = express.Router();

// In-memory store for single-use OAuth auth codes (code → { token, user, expiresAt })
const oauthCodes = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [code, data] of oauthCodes) {
    if (now > data.expiresAt) oauthCodes.delete(code);
  }
}, 60 * 1000);

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
  const state = crypto.randomBytes(16).toString("hex");

  // Store state in a short-lived cookie for CSRF protection
  const isProduction = process.env.NODE_ENV === "production";
  res.cookie("oauth_state", state, { httpOnly: true, maxAge: 600000, sameSite: "lax", secure: isProduction });

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${GOOGLE_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scope}&state=${state}&access_type=offline&prompt=consent`;

  res.redirect(authUrl);
});

// ─── GET /api/oauth/google/callback ─── Handle Google's redirect
router.get("/google/callback", async (req, res) => {
  try {
    const { code, state } = req.query;

    // Validate CSRF state parameter
    const savedState = req.cookies?.oauth_state;
    if (!state || !savedState || state !== savedState) {
      return res.redirect(`${APP_URL}?oauth_error=invalid_state`);
    }
    res.clearCookie("oauth_state");

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

    // Generate JWT and a single-use auth code (never put JWT in URL)
    const token = generateToken(user);
    const authCode = crypto.randomBytes(32).toString("hex");
    oauthCodes.set(authCode, {
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        firstName: user.first_name,
        lastName: user.last_name,
        emailVerified: true,
        isDemo: !!user.is_demo,
      },
      expiresAt: Date.now() + 60 * 1000, // 60 seconds
    });

    res.redirect(`${APP_URL}?oauth_code=${authCode}`);
  } catch (err) {
    console.error("Google OAuth callback error:", err);
    res.redirect(`${APP_URL}?oauth_error=server_error`);
  }
});

// ─── POST /api/oauth/exchange ─── Exchange single-use auth code for JWT
router.post("/exchange", (req, res) => {
  const { code } = req.body;
  if (!code || !oauthCodes.has(code)) {
    return res.status(400).json({ error: "Invalid or expired auth code" });
  }
  const data = oauthCodes.get(code);
  oauthCodes.delete(code); // single-use
  if (Date.now() > data.expiresAt) {
    return res.status(400).json({ error: "Auth code expired" });
  }
  setAuthCookie(res, data.token);
  setCsrfCookie(res);
  const refreshToken = await generateRefreshToken(data.user.id);
  setRefreshCookie(res, refreshToken);
  res.json({ token: data.token, user: data.user });
});

// ─── GET /api/oauth/config ─── Return whether Google OAuth is configured (public)
router.get("/config", (req, res) => {
  res.json({
    google: !!GOOGLE_CLIENT_ID,
  });
});

module.exports = router;
