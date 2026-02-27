const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "inplace-dev-secret-change-me";
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
    { expiresIn: "7d" }
  );
}

async function authenticate(req, res, next) {
  // Option 1: Admin API key (for automated scripts — bypasses JWT + 2FA)
  const apiKey = req.headers["x-admin-api-key"];
  if (apiKey && ADMIN_API_KEY && apiKey === ADMIN_API_KEY) {
    req.user = { id: "api-key-admin", email: "admin@api", roles: ["family"], role: "family" };
    req.isAdmin = true;
    return next();
  }

  // Option 2: Bearer JWT token
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Authentication required" });
  }

  try {
    const token = header.split(" ")[1];
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

module.exports = { generateToken, authenticate, requireRole, requireAdmin };
