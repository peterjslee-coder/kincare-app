const express = require("express");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { v4: uuid } = require("uuid");
const { getDb } = require("../models/database");
const { generateToken, setAuthCookie, setCsrfCookie, generateRefreshToken, setRefreshCookie } = require("../middleware/auth");
const { notifyAdmins } = require("./push");
const { captureException } = require("../utils/sentry");
const { cookiesSecure } = require("../utils/env");  // v1.105.3 — NODE_ENV is unset on Railway

const router = express.Router();

// In-memory store for single-use OAuth auth codes (code → { token, user, expiresAt })
const oauthCodes = new Map();
// In-memory store for pending OAuth signups (new users → redirect to registration)
const oauthSignups = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [code, data] of oauthCodes) {
    if (now > data.expiresAt) oauthCodes.delete(code);
  }
  for (const [code, data] of oauthSignups) {
    if (now > data.expiresAt) oauthSignups.delete(code);
  }
}, 60 * 1000);

// Google OAuth configuration
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const APP_URL = process.env.APP_URL || "https://yourinplace.com";

// ─── Native-app OAuth return helpers (v1.89.1) ───
// The Capacitor app opens OAuth in a system browser (Chrome Custom Tab on Android,
// SFSafariViewController on iOS) with ?from_app=1 (Android) or ?from_app=ios (iOS).
// The flag rides the OAuth `state` param, and the callback returns the result to the
// app via the inplace:// custom scheme instead of loading the web app in the browser.
// v1.89.1 extends this to iOS: previously the iOS app navigated its main WebView to
// Google, Capacitor pushed that external navigation out to Safari, and the user's
// whole session ended up in Safari — "like the first time I've ever signed in".
function appStateFlag(state) {
  if (typeof state !== "string") return null;
  if (state.includes("|app-ios")) return "ios";
  if (state.includes("|app")) return "android";
  return null;
}
function fromAppStateSuffix(fromAppParam) {
  if (fromAppParam === "ios") return "|app-ios";
  if (fromAppParam === "1") return "|app";
  return "";
}
function redirectToApp(res, appFlag, params) {
  // params is built server-side from hex codes / fixed error slugs — never raw user input.
  const target = `inplace://oauth?${params}`;
  if (appFlag === "ios") {
    // SFSafariViewController is unreliable with server-side 302s to custom schemes —
    // serve a tiny interstitial that auto-attempts the scheme and offers a tap fallback.
    return res.status(200).type("html").send(`<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Returning to InPlace</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:80vh;background:#f6faf9;color:#1b3b34;margin:0;padding:24px;text-align:center}a{display:inline-block;margin-top:18px;padding:14px 28px;background:#1b6b5a;color:#fff;border-radius:10px;text-decoration:none;font-weight:600;font-size:16px}</style></head>
<body><p>Signing you in&hellip;</p><a href="${target}">Return to InPlace</a>
<script>setTimeout(function(){window.location.href=${JSON.stringify(target)};},60);</script></body></html>`);
  }
  return res.redirect(target);
}

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
  // Encode from_app flag into state so it survives the Google round-trip
  // ("1" = Android, "ios" = iOS — see redirectToApp)
  const state = crypto.randomBytes(16).toString("hex") + fromAppStateSuffix(req.query.from_app);

  // Store state in a short-lived cookie for CSRF protection
  const isProduction = cookiesSecure;  // v1.105.3 — see utils/env.js
  res.cookie("oauth_state", state, { httpOnly: true, maxAge: 600000, sameSite: "lax", secure: isProduction });

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${GOOGLE_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scope}&state=${state}&prompt=select_account`;

  res.redirect(authUrl);
});

// ─── GET /api/oauth/google/callback ─── Handle Google's redirect
router.get("/google/callback", async (req, res) => {
  // v1.89.1 — when the flow started from the native app, EVERY outcome (success,
  // signup, error) must return to the app via inplace://, not strand the user in
  // the system browser. appFlag comes from the state param; error slugs are fixed
  // strings, so routing errors back through the scheme is safe even pre-validation.
  const appFlag = appStateFlag(req.query.state);
  const failTo = (slug) => appFlag
    ? redirectToApp(res, appFlag, `oauth_error=${slug}`)
    : res.redirect(`${APP_URL}?oauth_error=${slug}`);
  try {
    const { code, state } = req.query;

    // Validate CSRF state parameter
    const savedState = req.cookies?.oauth_state;
    if (!state || !savedState || state !== savedState) {
      return failTo("invalid_state");
    }
    res.clearCookie("oauth_state");

    if (!code) {
      return failTo("no_code");
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
      return failTo("token_exchange_failed");
    }

    const tokens = await tokenResponse.json();

    // Get user info from Google
    const userInfoResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!userInfoResponse.ok) {
      return failTo("userinfo_failed");
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
        return failTo("account_disabled");
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
        // No existing account — redirect to registration with Google info pre-filled
        const signupCode = crypto.randomBytes(32).toString("hex");
        oauthSignups.set(signupCode, {
          provider: "google",
          providerId: googleId,
          email,
          firstName: firstName || "",
          lastName: lastName || "",
          avatarUrl: picture || null,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token || null,
          expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes
        });
        return appFlag ? redirectToApp(res, appFlag, `oauth_signup=${signupCode}`) : res.redirect(`${APP_URL}?oauth_signup=${signupCode}`);
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

    // Native app (Android or iOS): return the auth code via the inplace:// custom
    // scheme so the app's appUrlOpen deep-link handler completes the sign-in.
    if (appFlag) {
      redirectToApp(res, appFlag, `oauth_code=${authCode}`);
    } else {
      res.redirect(`${APP_URL}?oauth_code=${authCode}`);
    }
  } catch (err) {
    console.error("Google OAuth callback error:", err);
    failTo("server_error");
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
// ?link_mode=1&link_token=<jwt> — used from My Account to link Apple ID to existing account
router.get("/apple", (req, res) => {
  if (!APPLE_CLIENT_ID || !APPLE_TEAM_ID || !APPLE_KEY_ID || !APPLE_PRIVATE_KEY) {
    return res.status(503).json({ error: "Apple Sign-In is not configured" });
  }

  // If link_mode, encode the user's auth token into the state so the callback
  // can attach the Apple ID to the correct account (regardless of relay email)
  // v1.89.1 — also carry the native-app flag (must come before |link| so the
  // link-mode split('|link|') keeps working).
  const linkToken = req.query.link_mode === '1' ? (req.query.link_token || '') : '';
  const statePayload = crypto.randomBytes(16).toString("hex") + fromAppStateSuffix(req.query.from_app) + (linkToken ? `|link|${linkToken}` : '');

  // Apple uses form_post (cross-site POST), so sameSite must be "none" + secure
  // (lax cookies are not sent on cross-site POSTs, only top-level GET navigations)
  res.cookie("apple_oauth_state", statePayload, { httpOnly: true, maxAge: 600000, sameSite: "none", secure: true });

  const redirectUri = `${APP_URL}/api/oauth/apple/callback`;
  const params = new URLSearchParams({
    client_id: APPLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code id_token",
    response_mode: "form_post",
    scope: "name email",
    state: statePayload,
  });

  res.redirect(`https://appleid.apple.com/auth/authorize?${params.toString()}`);
});

// ─── POST /api/oauth/apple/callback ─── Handle Apple's form_post redirect
router.post("/apple/callback", express.urlencoded({ extended: false }), async (req, res) => {
  // v1.89.1 — same native-app return contract as the Google callback.
  const appFlag = appStateFlag(req.body?.state);
  const failTo = (slug) => appFlag
    ? redirectToApp(res, appFlag, `oauth_error=${slug}`)
    : res.redirect(`${APP_URL}?oauth_error=${slug}`);
  try {
    const { code, id_token, state, user: userJson } = req.body;

    console.log("[Apple OAuth] callback hit, body keys:", Object.keys(req.body || {}));

    // Validate CSRF state
    const savedState = req.cookies?.apple_oauth_state;
    if (!state || !savedState || state !== savedState) {
      console.error("[Apple OAuth] CSRF state mismatch — state:", !!state, "savedState:", !!savedState, "match:", state === savedState);
      return failTo("invalid_state");
    }
    res.clearCookie("apple_oauth_state");

    // Check if this is a "link" flow (user linking Apple from My Account settings)
    let linkUserId = null;
    if (savedState.includes('|link|')) {
      const linkToken = savedState.split('|link|')[1];
      if (linkToken) {
        try {
          const decoded = jwt.verify(linkToken, process.env.JWT_SECRET);
          linkUserId = decoded.id;
          console.log(`[Apple OAuth] Link mode — attaching to user ${linkUserId?.slice(0, 8)}`);
        } catch (e) {
          console.error("[Apple OAuth] Link mode token invalid:", e.message);
          return failTo("link_expired");
        }
      }
    }

    if (!id_token) {
      console.error("[Apple OAuth] No id_token in callback body");
      return failTo("no_token");
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

    // Check if Apple account is already linked to any user
    const existingOAuth = await db.prepare(
      "SELECT user_id FROM oauth_accounts WHERE provider = 'apple' AND provider_user_id = ?"
    ).get(appleUserId);

    let user;

    // ─── LINK MODE: user is linking Apple from My Account settings ───
    if (linkUserId) {
      const linkUser = await db.prepare("SELECT * FROM users WHERE id = ? AND is_active = 1").get(linkUserId);
      if (!linkUser) {
        return failTo("account_disabled");
      }

      if (existingOAuth) {
        if (existingOAuth.user_id === linkUserId) {
          // Already linked to this user — just log in
          console.log(`[Apple OAuth] Link mode — already linked to ${linkUserId.slice(0, 8)}`);
          user = linkUser;
        } else {
          // Apple ID is linked to a different account
          console.log(`[Apple OAuth] Link mode — Apple ID already linked to different user ${existingOAuth.user_id.slice(0, 8)}`);
          return failTo("apple_already_linked");
        }
      } else {
        // Link Apple ID to this user (works regardless of relay email)
        await db.prepare(
          "INSERT INTO oauth_accounts (id, user_id, provider, provider_user_id, provider_email, access_token) VALUES (?, ?, 'apple', ?, ?, ?)"
        ).run(uuid(), linkUserId, appleUserId, email || null, code || null);
        console.log(`[Apple OAuth] Linked Apple ID to user ${linkUserId.slice(0, 8)} (${linkUser.email})`);
        user = linkUser;
      }
      // Redirect to account settings with success flag instead of normal login
      const token = generateToken(user);
      const authCode = crypto.randomBytes(32).toString("hex");
      oauthCodes.set(authCode, { token, user: { id: user.id, email: user.email, role: user.role }, expiresAt: Date.now() + 60000 });
      setAuthCookie(res, token);
      setCsrfCookie(res);
      const refreshToken = generateRefreshToken(user);
      setRefreshCookie(res, refreshToken);
      return res.redirect(`${APP_URL}?oauth_code=${authCode}&apple_linked=1`);
    }

    // ─── NORMAL LOGIN/SIGNUP MODE ───
    if (existingOAuth) {
      user = await db.prepare("SELECT * FROM users WHERE id = ? AND is_active = 1").get(existingOAuth.user_id);
      if (!user) {
        return failTo("account_disabled");
      }
    } else {
      // No existing OAuth link — try to match by email.
      //
      // v1.105.5 — Apple "Hide My Email" addresses (@privaterelay.appleid.com) used to be
      // BLOCKED here for new signups: the user was bounced with `apple_hidden_email` and told
      // to sign in again choosing "Share My Email". Apple REQUIRES Hide My Email support —
      // pushing users to reveal a real address is exactly what App Review guideline 4.8 /
      // 5.1.1(v) prohibits, and it would very likely have been a rejection. It also only
      // affected NEW account creation, which is precisely the path a reviewer walks.
      //
      // A relay address is a real, deliverable address that Apple forwards, so it needs no
      // special case at all: it now follows the same "redirect to registration with Apple
      // info pre-filled" path as any other new Apple user. Returning users are unaffected
      // either way because the lookup above keys on `provider_user_id` (Apple's stable `sub`),
      // not the email — which matters because Apple only sends the email on the FIRST
      // authorization.
      //
      // ⚠️ OPERATIONAL DEPENDENCY: mail only reaches @privaterelay.appleid.com if the sending
      // domain is registered under "Sign in with Apple for Email Communication" in the Apple
      // Developer portal. Until FROM_EMAIL's domain is registered there, these users receive
      // NOTHING — no verification mail, no welcome-call email, no notifications.
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
        // No existing account — redirect to registration with Apple info pre-filled
        const signupCode = crypto.randomBytes(32).toString("hex");
        oauthSignups.set(signupCode, {
          provider: "apple",
          providerId: appleUserId,
          email,
          firstName: firstName || "",
          lastName: lastName || "",
          avatarUrl: null,
          accessToken: code || null,
          refreshToken: null,
          emailVerified: email_verified,
          expiresAt: Date.now() + 5 * 60 * 1000,
        });
        return appFlag ? redirectToApp(res, appFlag, `oauth_signup=${signupCode}`) : res.redirect(`${APP_URL}?oauth_signup=${signupCode}`);
      } else {
        // Apple didn't share email and no existing link — can't create account
        return failTo("no_email");
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
    if (appFlag) {
      redirectToApp(res, appFlag, `oauth_code=${authCode}`);
    } else {
      res.redirect(`${APP_URL}?oauth_code=${authCode}`);
    }
  } catch (err) {
    console.error("[Apple OAuth] callback error:", err.message, err.stack);
    failTo("server_error");
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

// ─── GET /api/oauth/pending-signup ─── Retrieve pending OAuth signup info for registration
router.get("/pending-signup", (req, res) => {
  const { code } = req.query;
  if (!code || !oauthSignups.has(code)) {
    return res.status(400).json({ error: "Invalid or expired signup code" });
  }
  const data = oauthSignups.get(code);
  if (Date.now() > data.expiresAt) {
    oauthSignups.delete(code);
    return res.status(400).json({ error: "Signup code expired" });
  }
  // Don't delete yet — we need it when they complete registration
  res.json({
    email: data.email,
    firstName: data.firstName,
    lastName: data.lastName,
    provider: data.provider,
  });
});

// ─── POST /api/oauth/complete-signup ─── Complete registration for an OAuth user
router.post("/complete-signup", async (req, res) => {
  const { code, role, firstName, lastName, phone, password } = req.body;
  if (!code || !oauthSignups.has(code)) {
    return res.status(400).json({ error: "Invalid or expired signup code" });
  }
  const data = oauthSignups.get(code);
  if (Date.now() > data.expiresAt) {
    oauthSignups.delete(code);
    return res.status(400).json({ error: "Signup code expired" });
  }
  oauthSignups.delete(code); // single-use

  if (!role || !["family", "caregiver", "care_for"].includes(role)) {
    return res.status(400).json({ error: "Invalid role" });
  }

  try {
    const db = await getDb();
    const bcrypt = require("bcryptjs");
    const passwordHash = await bcrypt.hash(password, 10);
    const userId = uuid();
    const finalFirst = firstName || data.firstName;
    const finalLast = lastName || data.lastName;
    const roles = JSON.stringify([role]);

    // Email is already verified by Google/Apple — no confirmation email needed.
    // But account_approved defaults to false — admin must still approve.
    await db.prepare(`
      INSERT INTO users (id, email, password_hash, role, roles, first_name, last_name, phone, avatar_url, email_verified, email_verified_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NOW())
    `).run(userId, data.email, passwordHash, role, roles, finalFirst, finalLast, phone || null, data.avatarUrl);

    // Link OAuth account
    await db.prepare(
      "INSERT INTO oauth_accounts (id, user_id, provider, provider_user_id, provider_email, access_token, refresh_token) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(uuid(), userId, data.provider, data.providerId, data.email, data.accessToken, data.refreshToken);

    // Auto-create care_recipient record for care_for signups (same as normal registration)
    // v1.71.0 claim-by-invite: skip when a pending care_recipient invite exists (see auth.js)
    let pendingClaimInvite = null;
    if (role === "care_for") {
      try {
        pendingClaimInvite = await db.prepare(
          "SELECT id FROM care_team_invites WHERE LOWER(invited_email) = LOWER(?) AND status = 'pending' AND role = 'care_recipient' AND expires_at > NOW()"
        ).get(data.email);
      } catch (e) { pendingClaimInvite = null; }
    }
    if (role === "care_for" && !pendingClaimInvite) {
      try {
        const crId = uuid();
        await db.prepare(`
          INSERT INTO care_recipients
          (id, family_user_id, first_name, last_name, linked_user_id,
           authorization_tier, consent_status, consent_method, consent_verified_at)
          VALUES (?, ?, ?, ?, ?, 'tier1', 'verified', 'self_signup', NOW())
        `).run(crId, userId, finalFirst, finalLast, userId);
        const teamId = uuid();
        await db.prepare(
          "INSERT INTO care_teams (id, name, care_recipient_id, created_by) VALUES (?, ?, ?, ?)"
        ).run(teamId, `${finalFirst} ${finalLast}'s Care Team`, crId, userId);
        await db.prepare(
          "INSERT INTO care_team_members (id, care_team_id, user_id, role, invited_by) VALUES (?, ?, ?, 'leader', ?)"
        ).run(uuid(), teamId, userId, userId);
      } catch (e) {
        console.error("OAuth care_for auto-setup error:", e);
      }
    }

    // Notify admins — new signup needs approval (same as normal registration)
    const roleName = role === "caregiver" ? "Caregiver" : role === "care_for" ? "Care Recipient" : "Family";
    const providerName = data.provider === "google" ? "Google" : "Apple";
    notifyAdmins("new_registration", {
      title: "New Signup — Approval Needed",
      body: `${finalFirst} ${finalLast} (${roleName}) signed up via ${providerName} and needs your approval to continue.`,
      data: { type: "new_registration", userId, email: data.email, needsApproval: true },
    });

    // v1.88.0: limited-early-signups flow — email Pete so he can arrange a
    // personal welcome call with every new member. Reply-to is the new user,
    // so replying to the email starts the conversation directly. Non-fatal.
    try {
      const { sendEmail, brandedHtml } = require("../utils/email");
      sendEmail({
        to: "peter@yourinplace.com",
        replyTo: data.email,
        subject: `New signup: ${finalFirst + " " + finalLast} (${roleName}) — arrange welcome call`,
        html: brandedHtml({
          title: "New inPlace Signup",
          greeting: "Hi Pete,",
          body: `<strong>${finalFirst + " " + finalLast}</strong> just signed up as a <strong>${roleName}</strong> via ${providerName}.<br><br>Email: ${data.email}<br>Phone: ${"not provided"}<br><br>Reply to this email to reach them directly and arrange their welcome call.`,
        }),
      }).catch((e) => captureException(e, { where: "oauth: signup welcome-call email" }));
    } catch (e) { captureException(e, { where: "oauth: signup welcome-call email" }); }

    const user = { id: userId, email: data.email, role, roles: [role], firstName: finalFirst, lastName: finalLast, emailVerified: true };
    const token = generateToken(user);

    setAuthCookie(res, token);
    setCsrfCookie(res);
    const refreshToken = await generateRefreshToken(userId);
    setRefreshCookie(res, refreshToken);

    res.status(201).json({
      token,
      user: {
        id: userId,
        email: data.email,
        role,
        firstName: finalFirst,
        lastName: finalLast,
        emailVerified: true,
        isDemo: false,
      },
    });
  } catch (err) {
    console.error("OAuth complete-signup error:", err);
    res.status(500).json({ error: "Registration failed" });
  }
});

// ─── GET /api/oauth/config ─── Return which OAuth providers are configured (public)
router.get("/config", (req, res) => {
  res.json({
    google: !!GOOGLE_CLIENT_ID,
    apple: !!(APPLE_CLIENT_ID && APPLE_TEAM_ID && APPLE_KEY_ID && APPLE_PRIVATE_KEY),
  });
});

module.exports = router;
