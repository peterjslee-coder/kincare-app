// Admin API router — split from the 5,5xx-line routes/admin.js (v1.92.0, tier-2 #3).
// Zero behavior change: global middleware runs first (verbatim), then each
// module registers its routes on THIS router in the original file order.
const express = require("express");
const { authenticate, requireAdmin } = require("../../middleware/auth");
const { getDb } = require("../../models/database");
const { isTrustedIp, registerTrustedIp } = require("../../utils/trustedIps");
const { getClientIp } = require("../../middleware/auditLog");
const { checkAdmin } = require("./shared");

const router = express.Router();

// All admin routes require auth + admin check + admin flag
router.use(authenticate, checkAdmin, requireAdmin);

// ─── IP Trust Verification Middleware ───
// Checks if admin is on a trusted IP. If not, requires passkey re-verification.
// Exempts the IP-verification challenge/verify endpoints themselves.
const IP_CHECK_EXEMPT = [
  "/ip-verify/challenge",
  "/ip-verify/verify",
  "/ip-verify/status",
  "/security/trusted-ips",
];

router.use(async (req, res, next) => {
  const path = req.path;
  // Skip IP check for exempt endpoints
  if (IP_CHECK_EXEMPT.some(p => path === p || path.startsWith(p))) return next();

  try {
    const ip = getClientIp(req);
    const trusted = await isTrustedIp(req.user.id, ip);
    if (trusted) {
      req.trustedIp = true;
      return next();
    }

    // Bootstrap: if NO admin has ANY trusted IPs yet, auto-trust this admin
    // (fresh deploy / empty table — can't lock everyone out)
    const db = await getDb();
    const anyTrusted = await db.prepare("SELECT COUNT(*) as cnt FROM trusted_admin_ips").get();
    if (!anyTrusted || Number(anyTrusted.cnt) === 0) {
      await registerTrustedIp(req.user.id, ip, {
        userAgent: (req.headers["user-agent"] || "").substring(0, 200),
        verifiedVia: "bootstrap_first_admin",
      });
      console.log(`  [ip-trust] Bootstrap: auto-trusted ${req.user.email} at ${ip} (empty trusted_admin_ips table)`);
      req.trustedIp = true;
      return next();
    }

    // Unknown IP — require passkey verification
    return res.status(403).json({
      error: "Admin access from an unrecognized network. Please verify your identity with a passkey.",
      code: "IP_VERIFICATION_REQUIRED",
      ip: ip,
    });
  } catch (err) {
    // If IP check itself fails (DB error, table missing, etc.), don't lock out admin
    console.error("IP trust check error (allowing through):", err.message);
    return next();
  }
});

// ─── Route modules, in original registration order ───
require("./access")(router);
require("./overview")(router);
require("./people")(router);
require("./reviews")(router);
require("./monitoring")(router);
require("./userFlags")(router);
require("./demoTools")(router);
require("./sessionsFeedback")(router);
require("./verification")(router);
require("./sessionOps")(router);
require("./safety")(router);
require("./maintenance")(router);

module.exports = router;
