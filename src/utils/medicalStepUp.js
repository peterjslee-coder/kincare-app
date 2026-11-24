// ─── Passkey step-up for medical records (Documents Center Phase 1) ───
//
// Pete: listing titles needs only a normal sign-in. OPENING or DOWNLOADING a medical record
// needs a fresh passkey assertion; GRANTING or REVOKING the iPAi key needs one EVERY time.
// No passkey on the account → a clear "add one under Account → Security" error. No bypass.
//
// Same challenge/verify shape as admin/access.js (Test Mode): one-time, short-lived challenge
// held in-process, verified with @simplewebauthn/server against the account's own passkeys.
//
// The open/download window (~10 min) is stored SERVER-SIDE in medical_step_ups, keyed to the
// user and to this sign-in session (the JWT's iat), so a different device or a fresh sign-in
// has to step up on its own.
const crypto = require("crypto");
const {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require("@simplewebauthn/server");
const passkeysRouter = require("../routes/passkeys");

const STEP_UP_MINUTES = 10;
const CHALLENGE_TTL_MS = 2 * 60 * 1000;
const PURPOSES = ["open", "ai_consent"];

const NO_PASSKEY_ERROR = "Opening medical records and changing iPAi access needs a passkey. Add one under Account → Security on this device, then try again.";

const challenges = new Map();
function setChallenge(key, value) {
  challenges.set(key, { value, expires: Date.now() + CHALLENGE_TTL_MS });
  for (const [k, v] of challenges) if (v.expires < Date.now()) challenges.delete(k);
}
function takeChallenge(key) {
  const e = challenges.get(key);
  if (!e) return null;
  challenges.delete(key); // one-time use
  return e.expires < Date.now() ? null : e.value;
}

/** One sign-in session = one user + one token issue time. */
function sessionKeyFor(user) {
  return crypto.createHash("sha256").update(`${user && user.id}:${(user && user.iat) || ""}`).digest("hex");
}

async function passkeysFor(db, userId) {
  return db.prepare("SELECT credential_id, transports FROM user_passkeys WHERE user_id = ?").all(userId);
}

/** Passkey options for a step-up, or { needsPasskey: true }. */
async function createChallenge(db, userId, purpose) {
  if (!PURPOSES.includes(purpose)) return { badPurpose: true };
  const pks = await passkeysFor(db, userId);
  if (pks.length === 0) return { needsPasskey: true };
  const options = await generateAuthenticationOptions({
    rpID: passkeysRouter.RP_ID,
    allowCredentials: pks.map((pk) => ({ id: pk.credential_id, transports: pk.transports ? JSON.parse(pk.transports) : undefined })),
    userVerification: "required",
  });
  const key = `medical_${purpose}_${userId}_${crypto.randomBytes(6).toString("hex")}`;
  setChallenge(key, { challenge: options.challenge, userId, purpose });
  return { options: { ...options, _challengeKey: key } };
}

async function realVerifier(db, userId, stored, body) {
  const passkey = await db.prepare(
    "SELECT * FROM user_passkeys WHERE credential_id = ? AND user_id = ?"
  ).get(body && body.id, userId);
  if (!passkey) return false;
  const verification = await verifyAuthenticationResponse({
    response: body,
    expectedChallenge: stored.challenge,
    expectedOrigin: passkeysRouter.EXPECTED_ORIGINS,
    expectedRPID: passkeysRouter.RP_ID,
    credential: {
      id: passkey.credential_id,
      publicKey: Buffer.from(passkey.public_key, "base64url"),
      counter: Number(passkey.counter) || 0,
      transports: passkey.transports ? JSON.parse(passkey.transports) : [],
    },
  });
  if (!verification.verified) return false;
  await db.prepare("UPDATE user_passkeys SET counter = ?, last_used = NOW() WHERE id = ?")
    .run(verification.authenticationInfo.newCounter, passkey.id);
  return true;
}
let verifier = realVerifier;

/**
 * Verify a passkey assertion for `purpose`. Consumes the challenge.
 * @returns {Promise<{ok: true} | {ok: false, status: number, error: string, needsPasskey?: boolean}>}
 */
async function verifyAssertion(db, userId, purpose, body) {
  const pks = await passkeysFor(db, userId);
  if (pks.length === 0) return { ok: false, status: 403, error: NO_PASSKEY_ERROR, needsPasskey: true };
  const key = body && body._challengeKey;
  if (!key) return { ok: false, status: 401, error: "Passkey confirmation required.", needsStepUp: true };
  const stored = takeChallenge(key);
  if (!stored || stored.userId !== userId || stored.purpose !== purpose) {
    return { ok: false, status: 401, error: "That passkey request expired. Please try again.", needsStepUp: true };
  }
  let ok = false;
  try { ok = await verifier(db, userId, stored, body); } catch (err) {
    console.error("[medical-step-up] verify error:", err.message);
    ok = false;
  }
  return ok ? { ok: true } : { ok: false, status: 401, error: "Passkey verification failed.", needsStepUp: true };
}

async function recordStepUp(db, user) {
  const expires = new Date(Date.now() + STEP_UP_MINUTES * 60 * 1000).toISOString();
  await db.prepare(`
    INSERT INTO medical_step_ups (user_id, session_key, verified_at, expires_at)
    VALUES (?, ?, NOW(), ?)
    ON CONFLICT (user_id, session_key) DO UPDATE SET verified_at = NOW(), expires_at = EXCLUDED.expires_at
  `).run(user.id, sessionKeyFor(user), expires);
  return expires;
}

/** When the current session's open/download window ends, or null if there is none. */
async function stepUpExpiresAt(db, user) {
  const row = await db.prepare(
    "SELECT expires_at FROM medical_step_ups WHERE user_id = ? AND session_key = ? AND expires_at > NOW()"
  ).get(user.id, sessionKeyFor(user));
  return row ? row.expires_at : null;
}

const exported = {
  createChallenge, verifyAssertion, recordStepUp, stepUpExpiresAt, sessionKeyFor,
  NO_PASSKEY_ERROR, STEP_UP_MINUTES,
};
// Test-only seam: lets integration tests stand in for a WebAuthn authenticator. It does not
// exist outside NODE_ENV=test, so production code cannot reach it.
if (process.env.NODE_ENV === "test") {
  exported._setVerifierForTests = (fn) => { verifier = fn || realVerifier; };
  exported._issueChallengeForTests = (userId, purpose) => {
    const key = `medical_${purpose}_${userId}_test_${crypto.randomBytes(4).toString("hex")}`;
    setChallenge(key, { challenge: "test", userId, purpose });
    return key;
  };
}
module.exports = exported;
