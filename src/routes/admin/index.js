// Admin API router — split from the 5,5xx-line routes/admin.js (v1.92.0, tier-2 #3).
// Zero behavior change: global middleware runs first (verbatim), then each
// module registers its routes on THIS router in the original file order.
const express = require("express");
const { authenticate, requireAdmin, API_KEY_SAFE_PATHS } = require("../../middleware/auth");
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

  // ─── v1.106.37 — a provisioned machine credential is not a hijacked session ───
  //
  // This gate exists so a STOLEN SESSION COOKIE cannot be replayed from an unfamiliar
  // network. An admin API key is the opposite thing: a secret deliberately issued to a
  // machine, held in an env var, never in a browser. verifyCsrf in middleware/auth.js
  // already draws exactly this distinction and exempts key callers — "server-to-server, no
  // cookie" — and CSRF is the same class of browser-session control.
  //
  // Until now the gate did not know keys existed, so it refused them and told the caller to
  // go find a passkey. scripts/collect-feedback.js sends the key on every call and could
  // never get past this, which is how Pete spent a day being asked to verify addresses in a
  // browser that could not reach them. The designed path for machine access was dead on
  // arrival.
  //
  // Scoped hard: ONLY the paths an API key may already reach without TOTP — the same
  // exported list, so the two cannot drift. Anything sensitive still demands a TOTP code,
  // and every cookie-authenticated admin request still demands a verified network.
  if (req.authVia === "admin_api_key") {
    const fullPath = req.originalUrl || req.path;
    if (API_KEY_SAFE_PATHS.some(p => fullPath.startsWith(p))) {
      req.trustedIp = true;
      return next();
    }
  }

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
