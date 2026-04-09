const express = require("express");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
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

// Apple Sign In configuration
const APPLE_CLIENT_ID = process.env.APPLE_CLIENT_ID; // Services ID (e.g. com.yourinplace.app.web)
const APPLE_TEAM_ID = process.env.APPLE_TEAM_ID;     // e.g. 7964RAMZJL
const APPLE_KEY_ID = process.env.APPLE_KEY_ID;        // Key ID from Apple Developer
const APPLE_PRIVATE_KEY = process.env.APPLE_PRIVATE_KEY; // .p8 key contents (with \n line breaks)

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

// ─── Apple Sign In Helpers ───

// Generate Apple client_secret (a short-lived JWT signed with your .p8 key)
function generateAppleClientSecret() {
  const privateKey = APPLE_PRIVATE_KEY.replace(/\\n/g, "\n");
  const payload = {
    iss: APPLE_TEAM_ID,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 86400 * 180, // 6 months max
    aud: "https://appleid.apple.com",
    sub: APPLE_CLIENT_ID,
  };
  return jwt.sign(payload, privateKey, { algorithm: "ES256", keyid: APPLE_KEY_ID });
}

// Cache Apple's public keys (JWKS) for id_token verification
let appleKeysCache = null;
let appleKeysCacheTime = 0;
const APPLE_KEYS_TTL = 86400 * 1000; // 24 hours

async function getApplePublicKeys() {
  if (appleKeysCache && Date.now() - appleKeysCacheTime < APPLE_KEYS_TTL) {
    return appleKeysCache;
  }
  const res = await fetch("https://appleid.apple.com/auth/keys");
  if (!res.ok) throw new Error("Failed to fetch Apple JWKS");
  const data = await res.json();
  appleKeysCache = data.keys;
  appleKeysCacheTime = Date.now();
  return appleKeysCache;
}

// Convert JWK to PEM for jsonwebtoken verification
function jwkToPem(jwk) {
  // For RSA keys — Apple uses RS256
  const { n, e } = jwk;
  const nBuf = Buffer.from(n, "base64url");
  const eBuf = Buffer.from(e, "base64url");

  // Build DER-encoded RSA public key
  function encodeLengthHex(n) {
    if (n <= 127) return Buffer.from([n]);
    const hex = n.toString(16);
    const len = Math.ceil(hex.length / 2);
    const buf = Buffer.alloc(len + 1);
    buf[0] = 0x80 | len;
    Buffer.from(hex.padStart(len * 2, "0"), "hex").copy(buf, 1);
    return buf;
  }
  function derSequence(...parts) {
    const body = Buffer.concat(parts);
    return Buffer.concat([Buffer.from([0x30]), encodeLengthHex(body.length), body]);
  }
  function derInteger(buf) {
    // Prepend 0x00 if high bit set (positive integer)
    const needsPad = buf[0] & 0x80;
    const content = needsPad ? Buffer.concat([Buffer.from([0x00]), buf]) : buf;
    return Buffer.concat([Buffer.from([0x02]), encodeLengthHex(content.length), content]);
  }
  function derBitString(buf) {
    const content = Buffer.concat([Buffer.from([0x00]), buf]);
    return Buffer.concat([Buffer.from([0x03]), encodeLengthHex(content.length), content]);
  }

  // RSA OID: 1.2.840.113549.1.1.1
  const rsaOid = Buffer.from("300d06092a864886f70d0101010500", "hex");
  const rsaPubKey = derSequence(derInteger(nBuf), derInteger(eBuf));
  const spki = derSequence(rsaOid, derBitString(rsaPubKey));

  const pem = `-----BEGIN PUBLIC KEY-----\n${spki.toString("base64").match(/.{1,64}/g).join("\n")}\n-----END PUBLIC KEY-----`;
  return pem;
}

// Verify Apple's id_token
async function verifyAppleIdToken(idToken) {
  const decoded = jwt.decode(idToken, { complete: true });
  if (!decoded) throw new Error("Invalid id_token");

  const keys = await getApplePublicKeys();
  const key = keys.find(k => k.kid === decoded.header.kid);
  if (!key) throw new Error("Apple signing key not found");

  const pem = jwkToPem(key);
  const payload = jwt.verify(idToken, pem, {
    algorithms: ["RS256"],
    issuer: "https://appleid.apple.com",
    audience: APPLE_CLIENT_ID,
  });
  return payload;
}

// ─── GET /api/oauth/apple ─── Redirect to Apple Sign In
router.get("/apple", (req, res) => {
  if (!APPLE_CLIENT_ID || !APPLE_TEAM_ID || !APPLE_KEY_ID || !APPLE_PRIVATE_KEY) {
    return res.status(503).json({ error: "Apple Sign-In is not configured" });
  }

  const state = crypto.randomBytes(16).toString("hex");
  // Apple uses form_post (cross-site POST), so sameSite must be "none" + secure
  // (lax cookies are not sent on cross-site POSTs, only top-level GET navigations)
  res.cookie("apple_oauth_state", state, { httpOnly: true, maxAge: 600000, sameSite: "none", secure: true });

  const redirectUri = `${APP_URL}/api/oauth/apple/callback`;
  const params = new URLSearchParams({
    client_id: APPLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code id_token",
    response_mode: "form_post",
    scope: "name email",
    state,
  });

  res.redirect(`https://appleid.apple.com/auth/authorize?${params.toString()}`);
});

// ─── POST /api/oauth/apple/callback ─── Handle Apple's form_post redirect
router.post("/apple/callback", express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const { code, id_token, state, user: userJson } = req.body;

    console.log("[Apple OAuth] callback hit, body keys:", Object.keys(req.body || {}));

    // Validate CSRF state
    const savedState = req.cookies?.apple_oauth_state;
    if (!state || !savedState || state !== savedState) {
      console.error("[Apple OAuth] CSRF state mismatch — state:", !!state, "savedState:", !!savedState, "match:", state === savedState);
      return res.redirect(`${APP_URL}?oauth_error=invalid_state`);
    }
    res.clearCookie("apple_oauth_state");

    if (!id_token) {
      console.error("[Apple OAuth] No id_token in callback body");
      return res.redirect(`${APP_URL}?oauth_error=no_token`);
    }

    // Verify the id_token JWT against Apple's public keys
    const applePayload = await verifyAppleIdToken(id_token);
    const { sub: appleUserId, email, email_verified } = applePayload;

    // Apple only sends name on FIRST authorization — parse it if present
    let firstName = null, lastName = null;
    if (userJson) {
      try {
        const userData = typeof userJson === "string" ? JSON.parse(userJson) : userJson;
        firstName = userData.name?.firstName || null;
        lastName = userData.name?.lastName || null;
      } catch (e) { /* ignore parse errors */ }
    }

    const db = await getDb();

    // Check if Apple account is already linked
    const existingOAuth = await db.prepare(
      "SELECT user_id FROM oauth_accounts WHERE provider = 'apple' AND provider_user_id = ?"
    ).get(appleUserId);

    let user;

    if (existingOAuth) {
      user = await db.prepare("SELECT * FROM users WHERE id = ? AND is_active = 1").get(existingOAuth.user_id);
      if (!user) {
        return res.redirect(`${APP_URL}?oauth_error=account_disabled`);
      }
    } else {
      // Check if a user with this email already exists
      const existingUser = email
        ? await db.prepare("SELECT * FROM users WHERE LOWER(email) = LOWER(?) AND is_active = 1").get(email)
        : null;

      if (existingUser) {
        // Link Apple account to existing user
        user = existingUser;
        await db.prepare(
          "INSERT INTO oauth_accounts (id, user_id, provider, provider_user_id, provider_email, access_token) VALUES (?, ?, 'apple', ?, ?, ?)"
        ).run(uuid(), user.id, appleUserId, email || null, code || null);

        if (email_verified && !user.email_verified) {
          await db.prepare("UPDATE users SET email_verified = 1, email_verified_at = NOW() WHERE id = ?").run(user.id);
        }
      } else if (email) {
        // Create new user via Apple
        const userId = uuid();
        const bcrypt = require("bcryptjs");
        const randomPassword = crypto.randomBytes(32).toString("hex");
        const passwordHash = await bcrypt.hash(randomPassword, 10);

        await db.prepare(`
          INSERT INTO users (id, email, password_hash, role, first_name, last_name, email_verified, email_verified_at)
          VALUES (?, ?, ?, 'family', ?, ?, ?, ${email_verified ? "NOW()" : "NULL"})
        `).run(userId, email, passwordHash, firstName || "User", lastName || "", email_verified ? 1 : 0);

        await db.prepare(
          "INSERT INTO oauth_accounts (id, user_id, provider, provider_user_id, provider_email, access_token) VALUES (?, ?, 'apple', ?, ?, ?)"
        ).run(uuid(), userId, appleUserId, email, code || null);

        user = await db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
      } else {
        // Apple didn't share email and no existing link — can't create account
        return res.redirect(`${APP_URL}?oauth_error=no_email`);
      }
    }

    // Generate JWT + single-use auth code (same pattern as Google)
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
      expiresAt: Date.now() + 60 * 1000,
    });

    console.log("[Apple OAuth] success — redirecting with auth code for user:", user.email);
    res.redirect(`${APP_URL}?oauth_code=${authCode}`);
  } catch (err) {
    console.error("[Apple OAuth] callback error:", err.message, err.stack);
    res.redirect(`${APP_URL}?oauth_error=server_error`);
  }
});

// ─── POST /api/oauth/exchange ─── Exchange single-use auth code for JWT
router.post("/exchange", async (req, res) => {
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

// ─── GET /api/oauth/config ─── Return which OAuth providers are configured (public)
router.get("/config", (req, res) => {
  res.json({
    google: !!GOOGLE_CLIENT_ID,
    apple: !!(APPLE_CLIENT_ID && APPLE_TEAM_ID && APPLE_KEY_ID && APPLE_PRIVATE_KEY),
  });
});

module.exports = router;
