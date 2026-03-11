const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error("JWT_SECRET environment variable is required");
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || null;

function generateToken(user) {
  // Dual-role support: encode roles array in JWT
  // Parse roles from DB (JSON string) or fall back to single role
  let roles;
  if (user.roles) {
    roles = typeof user.roles === "string" ? JSON.parse(user.roles) : user.roles;
  } else {
    roles = [user.role || "family"];
  }

  return jwt.sign(
    { id: user.id, email: user.email, roles, role: roles[0] },
    JWT_SECRET,
    { expiresIn: "15m" }
  );
}

async function authenticate(req, res, next) {
  // Option 1: Admin API key + TOTP code (for automated scripts)
  const apiKey = req.headers["x-admin-api-key"];
  if (apiKey && ADMIN_API_KEY && apiKey === ADMIN_API_KEY) {
    // Require a valid TOTP code from an admin user's authenticator app
    const totpCode = req.headers["x-admin-totp"];
    if (!totpCode) {
      return res.status(401).json({ error: "Admin TOTP code required (x-admin-totp header)" });
    }
    try {
      const { getDb } = require("../models/database");
      const db = await getDb();
      // Find any admin user with 2FA enabled to validate the TOTP code against
      const adminUser = await db.prepare(
        "SELECT u.id, u.email, t.totp_secret FROM users u JOIN user_2fa t ON u.id = t.user_id WHERE u.is_admin = 1 AND t.is_enabled = 1 LIMIT 1"
      ).get();
      if (!adminUser || !adminUser.totp_secret) {
        return res.status(401).json({ error: "No admin 2FA configured — cannot validate TOTP" });
      }
      const otplib = require("otplib");
      const verifyResult = otplib.verifySync({ token: totpCode, secret: adminUser.totp_secret });
      if (!verifyResult.valid) {
        return res.status(401).json({ error: "Invalid TOTP code" });
      }
      req.user = { id: adminUser.id, email: adminUser.email, roles: ["family"], role: "family" };
      req.isAdmin = true;
      return next();
    } catch (err) {
      return res.status(401).json({ error: "TOTP verification failed" });
    }
  }

  // Option 2: Bearer JWT token (header or httpOnly cookie)
  const header = req.headers.authorization;
  const cookieToken = req.cookies?.auth_token;
  const tokenSource = header?.startsWith("Bearer ") ? header.split(" ")[1] : cookieToken;
  if (!tokenSource) {
    return res.status(401).json({ error: "Authentication required" });
  }

  try {
    const token = tokenSource;
    const decoded = jwt.verify(token, JWT_SECRET);

    // Block soft-deleted accounts — JWT was issued before deletion so it's still valid,
    // but the account has been deactivated in the DB. Quick check on every request.
    if (decoded.id && decoded.id !== 'api-key-admin') {
      const { getDb } = require("../models/database");
      const db = await getDb();
      const userCheck = await db.prepare("SELECT is_active FROM users WHERE id = ?").get(decoded.id);
      if (!userCheck || !userCheck.is_active) {
        return res.status(401).json({ error: "Account has been deleted" });
      }
    }

    // Backward compat: old tokens have role but not roles
    if (!decoded.roles && decoded.role) {
      decoded.roles = [decoded.role];
    }
    if (decoded.roles && !decoded.role) {
      decoded.role = decoded.roles[0];
    }

    // Active role: frontend can send X-Active-Role header to select which role view
    const activeRole = req.headers["x-active-role"];
    if (activeRole && decoded.roles && decoded.roles.includes(activeRole)) {
      decoded.activeRole = activeRole;
    } else {
      decoded.activeRole = decoded.roles ? decoded.roles[0] : decoded.role;
    }

    req.user = decoded;
    next();
  } catch (err) {
    const isExpired = err.name === 'TokenExpiredError';
    return res.status(401).json({ error: isExpired ? "Your session has expired. Please sign in again." : "Authentication failed. Please sign in again.", code: isExpired ? "TOKEN_EXPIRED" : "TOKEN_INVALID" });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    // Dual-role: check if ANY of the user's roles match the required roles
    const userRoles = req.user.roles || [req.user.role];
    const hasRole = userRoles.some(r => roles.includes(r));
    if (!hasRole) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    next();
  };
}

function requireAdmin(req, res, next) {
  // Check is_admin flag from DB (set on req by admin routes after authenticate)
  if (!req.isAdmin) {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}

// Set JWT as httpOnly cookie (used by login, register, OAuth exchange)
function setAuthCookie(res, token) {
  const isProduction = process.env.NODE_ENV === "production";
  res.cookie("auth_token", token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    maxAge: 15 * 60 * 1000, // 15 minutes (matches JWT expiry)
    path: "/",
  });
}

// Refresh tokens — long-lived, revocable, stored hashed in DB
async function generateRefreshToken(userId) {
  const { getDb } = require("../models/database");
  const db = await getDb();
  const rawToken = crypto.randomBytes(48).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days
  await db.prepare(
    "INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)"
  ).run(id, userId, tokenHash, expiresAt);
  return rawToken;
}

function setRefreshCookie(res, refreshToken) {
  const isProduction = process.env.NODE_ENV === "production";
  res.cookie("refresh_token", refreshToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    path: "/api/auth/refresh", // only sent to refresh endpoint
  });
}

async function revokeRefreshToken(rawToken) {
  if (!rawToken) return;
  const { getDb } = require("../models/database");
  const db = await getDb();
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  await db.prepare("DELETE FROM refresh_tokens WHERE token_hash = ?").run(tokenHash);
}

async function revokeAllUserRefreshTokens(userId) {
  const { getDb } = require("../models/database");
  const db = await getDb();
  await db.prepare("DELETE FROM refresh_tokens WHERE user_id = ?").run(userId);
}

function clearAuthCookie(res) {
  res.clearCookie("auth_token", { path: "/" });
  res.clearCookie("refresh_token", { path: "/api/auth/refresh" });
}

// CSRF protection — double-submit cookie pattern
// Server sets a JS-readable csrf_token cookie; frontend reads it and sends as X-CSRF-Token header.
// Server compares header to cookie. An attacker on a different origin can't read the cookie.
function setCsrfCookie(res) {
  const token = crypto.randomBytes(32).toString("hex");
  const isProduction = process.env.NODE_ENV === "production";
  res.cookie("csrf_token", token, {
    httpOnly: false, // must be readable by frontend JS
    secure: isProduction,
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
  });
  return token;
}

function verifyCsrf(req, res, next) {
  // Skip for safe methods (GET, HEAD, OPTIONS)
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  // Skip for admin API key auth (server-to-server, no cookie)
  if (req.headers["x-admin-api-key"]) return next();
  // Skip for public auth endpoints (login, register, demo-login, etc.)
  // These are entry points that may be called with a stale auth cookie from a previous session
  const publicAuthPaths = ["/api/auth/login", "/api/auth/register", "/api/auth/demo-login",
    "/api/auth/verify-email", "/api/auth/refresh", "/api/auth/passkey-login",
    "/api/auth/passkey-login-verify", "/api/auth/logout"];
  if (publicAuthPaths.some(p => req.path === p)) return next();
  // Skip if no auth cookie present
  if (!req.cookies?.auth_token) return next();

  const cookieToken = req.cookies?.csrf_token;
  const headerToken = req.headers["x-csrf-token"];
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res.status(403).json({ error: "Invalid CSRF token" });
  }
  next();
}

module.exports = { generateToken, authenticate, requireRole, requireAdmin, setAuthCookie, clearAuthCookie, generateRefreshToken, setRefreshCookie, revokeRefreshToken, revokeAllUserRefreshTokens, setCsrfCookie, verifyCsrf };
