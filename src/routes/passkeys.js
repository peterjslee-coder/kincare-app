const express = require("express");
const { v4: uuid } = require("uuid");
const { getDb } = require("../models/database");
const { generateToken, authenticate, setAuthCookie, setCsrfCookie, generateRefreshToken, setRefreshCookie } = require("../middleware/auth");
const { registerTrustedIp } = require("../utils/trustedIps");
const { getClientIp } = require("../middleware/auditLog");
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require("@simplewebauthn/server");

const router = express.Router();

// ─── Config ───
const RP_NAME = "InPlace";
const RP_ID = process.env.RP_ID || (process.env.APP_URL ? new URL(process.env.APP_URL).hostname : "yourinplace.com");
const WEB_ORIGIN = process.env.APP_URL || "https://yourinplace.com";

// Android native app origins — WebAuthn in Android WebView sends
// "android:apk-key-hash:<base64url-sha256>" instead of the web origin.
// These are the Play Console app-signing key and upload key fingerprints.
const ANDROID_ORIGINS = [
  "android:apk-key-hash:hpyhjCoVHafi-GJCSzU-2WT4zr8VJ3O3E747UQW3H7E", // app signing key
  "android:apk-key-hash:QJpqoHIPuWAJ2g4viQdax3QUYJqRdHypAdxp-4ZKCyI", // upload key
];

// SimpleWebAuthn accepts an array of expected origins
const EXPECTED_ORIGINS = [WEB_ORIGIN, ...ANDROID_ORIGINS];

// In-memory challenge store (short-lived, ~5 min TTL)
// In production at scale, use Redis. Fine for current user base.
const challengeStore = new Map();
function setChallenge(key, value) {
  challengeStore.set(key, { value, expires: Date.now() + 5 * 60 * 1000 });
  // Cleanup expired entries periodically
  if (challengeStore.size > 100) {
    for (const [k, v] of challengeStore) {
      if (v.expires < Date.now()) challengeStore.delete(k);
    }
  }
}
function getChallenge(key) {
  const entry = challengeStore.get(key);
  if (!entry) return null;
  challengeStore.delete(key); // one-time use
  if (entry.expires < Date.now()) return null;
  return entry.value;
}

// ─── Helper: get user's passkeys from DB ───
async function getUserPasskeys(db, userId) {
  const rows = await db.prepare(
    "SELECT id, credential_id, public_key, counter, transports, device_type, backed_up, name, created_at, last_used FROM user_passkeys WHERE user_id = ? ORDER BY created_at DESC"
  ).all(userId);
  return rows.map(r => ({
    ...r,
    transports: r.transports ? JSON.parse(r.transports) : [],
    counter: Number(r.counter),
    backed_up: !!r.backed_up,
  }));
}

// ─── GET /api/passkeys ─── List user's registered passkeys
router.get("/", authenticate, async (req, res) => {
  try {
    const db = await getDb();
    const passkeys = await getUserPasskeys(db, req.user.id);
    res.json({
      passkeys: passkeys.map(p => ({
        id: p.id,
        name: p.name,
        deviceType: p.device_type,
        backedUp: p.backed_up,
        createdAt: p.created_at,
        lastUsed: p.last_used,
      })),
    });
  } catch (err) {
    console.error("List passkeys error:", err);
    res.status(500).json({ error: "Failed to list passkeys" });
  }
});

// ─── POST /api/passkeys/register/options ─── Generate registration options
router.post("/register/options", authenticate, async (req, res) => {
  try {
    const db = await getDb();
    const user = await db.prepare("SELECT id, email, first_name, last_name FROM users WHERE id = ?").get(req.user.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    const existingPasskeys = await getUserPasskeys(db, user.id);

    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: RP_ID,
      userName: user.email,
      userDisplayName: `${user.first_name} ${user.last_name}`,
      // Prevent re-registering the same authenticator
      excludeCredentials: existingPasskeys.map(pk => ({
        id: pk.credential_id,
        transports: pk.transports,
      })),
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "preferred",
      },
      attestationType: "none",
    });

    // Store challenge for verification
    setChallenge(`reg_${req.user.id}`, options.challenge);

    res.json(options);
  } catch (err) {
    console.error("Passkey register options error:", err);
    res.status(500).json({ error: "Failed to generate registration options" });
  }
});

// ─── POST /api/passkeys/register/verify ─── Verify registration response
router.post("/register/verify", authenticate, async (req, res) => {
  try {
    const expectedChallenge = getChallenge(`reg_${req.user.id}`);
    if (!expectedChallenge) {
      return res.status(400).json({ error: "Registration challenge expired. Please try again." });
    }

    const verification = await verifyRegistrationResponse({
      response: req.body,
      expectedChallenge,
      expectedOrigin: EXPECTED_ORIGINS,
      expectedRPID: RP_ID,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return res.status(400).json({ error: "Passkey verification failed" });
    }

    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

    // Store the new passkey
    const db = await getDb();
    const passkeyId = uuid();

    // credential.id is already base64url string in SimpleWebAuthn v11
    // credential.publicKey is Uint8Array — encode it for storage
    const credentialIdB64 = credential.id;
    const publicKeyB64 = Buffer.from(credential.publicKey).toString("base64url");

    const passkeyName = req.body.passkeyName || "Passkey";

    await db.prepare(
      "INSERT INTO user_passkeys (id, user_id, credential_id, public_key, counter, device_type, backed_up, transports, name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      passkeyId,
      req.user.id,
      credentialIdB64,
      publicKeyB64,
      credential.counter,
      credentialDeviceType || "unknown",
      credentialBackedUp ? 1 : 0,
      JSON.stringify(credential.transports || []),
      passkeyName
    );

    console.log(`  [passkey] Registered passkey for user ${req.user.id}: ${passkeyName}`);

    res.json({
      verified: true,
      passkey: {
        id: passkeyId,
        name: passkeyName,
        deviceType: credentialDeviceType,
        backedUp: credentialBackedUp,
      },
    });
  } catch (err) {
    console.error("Passkey register verify error:", err);
    console.error("  [passkey] RP_ID:", RP_ID, "ORIGINS:", EXPECTED_ORIGINS, "APP_URL:", process.env.APP_URL, "NODE_ENV:", process.env.NODE_ENV);
    console.error('Passkey verify error:', err.message); res.status(500).json({ error: 'Passkey verification failed' });
  }
});

// ─── POST /api/passkeys/authenticate/options ─── Generate authentication options (no auth required)
router.post("/authenticate/options", async (req, res) => {
  try {
    const { email } = req.body;
    const db = await getDb();

    let allowCredentials = [];
    let userId = null;

    if (email) {
      // User provided email — find their passkeys
      const user = await db.prepare("SELECT id FROM users WHERE email = ? AND is_active = 1").get(email);
      if (user) {
        userId = user.id;
        const passkeys = await getUserPasskeys(db, user.id);
        allowCredentials = passkeys.map(pk => ({
          id: pk.credential_id,
          transports: pk.transports,
        }));
      }
    }
    // If no email or no passkeys found, still generate options (discoverable credentials)

    const options = await generateAuthenticationOptions({
      rpID: RP_ID,
      allowCredentials,
      userVerification: "preferred",
    });

    // Store challenge keyed by the challenge itself (since we don't know user yet for discoverable)
    const challengeKey = email ? `auth_${email}` : `auth_disc_${options.challenge}`;
    setChallenge(challengeKey, { challenge: options.challenge, userId });

    res.json({ ...options, _challengeKey: challengeKey });
  } catch (err) {
    console.error("Passkey auth options error:", err);
    res.status(500).json({ error: "Failed to generate authentication options" });
  }
});

// ─── POST /api/passkeys/authenticate/verify ─── Verify authentication response (no auth required)
router.post("/authenticate/verify", async (req, res) => {
  try {
    const { _challengeKey } = req.body;
    const stored = getChallenge(_challengeKey);
    if (!stored) {
      return res.status(400).json({ error: "Authentication challenge expired. Please try again." });
    }

    const db = await getDb();

    // Find the passkey by credential ID
    const credentialIdB64 = req.body.id; // SimpleWebAuthn sends this as base64url
    const passkey = await db.prepare(
      "SELECT pk.*, u.id as uid, u.email, u.role, u.roles, u.first_name, u.last_name, u.email_verified, u.is_demo, u.is_admin, u.is_active FROM user_passkeys pk JOIN users u ON pk.user_id = u.id WHERE pk.credential_id = ?"
    ).get(credentialIdB64);

    if (!passkey) {
      return res.status(401).json({ error: "Passkey not recognized. Please sign in with your password." });
    }

    // Security: if user provided an email, verify the passkey belongs to that user
    // This prevents cross-account login when a device has multiple users' passkeys
    if (stored.userId && stored.userId !== passkey.uid) {
      console.warn(`  [passkey] BLOCKED cross-account login: email user ${stored.userId} but passkey belongs to ${passkey.uid} (${passkey.email})`);
      return res.status(401).json({
        error: "This passkey belongs to a different account. Please use the correct passkey or sign in with your password.",
      });
    }

    if (!passkey.is_active) {
      return res.status(401).json({ error: "Account is deactivated" });
    }

    const verification = await verifyAuthenticationResponse({
      response: req.body,
      expectedChallenge: stored.challenge,
      expectedOrigin: EXPECTED_ORIGINS,
      expectedRPID: RP_ID,
      credential: {
        id: passkey.credential_id,
        publicKey: Buffer.from(passkey.public_key, "base64url"),
        counter: passkey.counter,
        transports: passkey.transports ? JSON.parse(passkey.transports) : [],
      },
    });

    if (!verification.verified) {
      return res.status(401).json({ error: "Passkey verification failed" });
    }

    // Update counter and last_used
    await db.prepare(
      "UPDATE user_passkeys SET counter = ?, last_used = NOW() WHERE id = ?"
    ).run(verification.authenticationInfo.newCounter, passkey.id);

    // Generate JWT token — passkeys bypass 2FA (they ARE the strong auth)
    let userRoles;
    try { userRoles = passkey.roles ? JSON.parse(passkey.roles) : [passkey.role]; }
    catch { userRoles = [passkey.role]; }

    const token = generateToken({
      id: passkey.uid,
      email: passkey.email,
      role: passkey.role,
      roles: userRoles,
    });

    console.log(`  [passkey] Authenticated ${passkey.email} via passkey "${passkey.name}"`);

    setAuthCookie(res, token);
    setCsrfCookie(res);
    const refreshToken = await generateRefreshToken(passkey.uid);
    setRefreshCookie(res, refreshToken);

    // NOTE: Do NOT auto-trust admin IPs on passkey login.
    // Unknown IPs should trigger a passkey challenge in the admin panel
    // so new networks are always verified explicitly.
    // The ip-verify/verify endpoint in admin.js is the ONLY path to trust a new IP.

    res.json({
      token,
      user: {
        id: passkey.uid,
        email: passkey.email,
        role: passkey.role,
        roles: userRoles,
        firstName: passkey.first_name,
        lastName: passkey.last_name,
        emailVerified: !!passkey.email_verified,
        isDemo: !!passkey.is_demo,
        isAdmin: !!passkey.is_admin,
      },
    });
  } catch (err) {
    console.error("Passkey auth verify error:", err);
    console.error("  [passkey] RP_ID:", RP_ID, "ORIGINS:", EXPECTED_ORIGINS, "APP_URL:", process.env.APP_URL);
    console.error('Passkey auth error:', err.message); res.status(500).json({ error: 'Passkey authentication failed' });
  }
});

// ─── DELETE /api/passkeys/:id ─── Remove a passkey
router.delete("/:id", authenticate, async (req, res) => {
  try {
    const db = await getDb();
    const passkey = await db.prepare(
      "SELECT id FROM user_passkeys WHERE id = ? AND user_id = ?"
    ).get(req.params.id, req.user.id);

    if (!passkey) {
      return res.status(404).json({ error: "Passkey not found" });
    }

    await db.prepare("DELETE FROM user_passkeys WHERE id = ?").run(req.params.id);
    console.log(`  [passkey] Removed passkey ${req.params.id} for user ${req.user.id}`);
    res.json({ message: "Passkey removed" });
  } catch (err) {
    console.error("Delete passkey error:", err);
    res.status(500).json({ error: "Failed to remove passkey" });
  }
});

// ─── PUT /api/passkeys/:id ─── Rename a passkey
router.put("/:id", authenticate, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || name.length > 50) {
      return res.status(400).json({ error: "Name is required (max 50 chars)" });
    }

    const db = await getDb();
    const passkey = await db.prepare(
      "SELECT id FROM user_passkeys WHERE id = ? AND user_id = ?"
    ).get(req.params.id, req.user.id);

    if (!passkey) {
      return res.status(404).json({ error: "Passkey not found" });
    }

    await db.prepare("UPDATE user_passkeys SET name = ? WHERE id = ?").run(name, req.params.id);
    res.json({ message: "Passkey renamed" });
  } catch (err) {
    console.error("Rename passkey error:", err);
    res.status(500).json({ error: "Failed to rename passkey" });
  }
});

module.exports = router;
