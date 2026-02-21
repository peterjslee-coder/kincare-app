const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "inplace-dev-secret-change-me";
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || null;

function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function authenticate(req, res, next) {
  // Option 1: Admin API key (for automated scripts — bypasses JWT + 2FA)
  const apiKey = req.headers["x-admin-api-key"];
  if (apiKey && ADMIN_API_KEY && apiKey === ADMIN_API_KEY) {
    req.user = { id: "api-key-admin", email: "admin@api", role: "family" };
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
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
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
