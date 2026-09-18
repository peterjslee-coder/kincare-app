// ─── Impersonation is a window to look through, not a seat to sit in (v1.106.40) ───
//
// Pete, seeing a linked-accounts control on Tina's My Account while impersonating her:
// "Is the ability to link her Google account supposed to be here? Is this because I was
// impersonating on an iOS device?"
//
// The instinct was right and the answer is worse than the question. Impersonation is
// deliberately expensive — Pete, v1.106.3: "no impersonation without passkey. period." An
// admin must pass a passkey challenge, the token is short-lived, and every start is written
// to audit_log. That is the whole design: a temporary, attributable window for "help me see
// what she is seeing on her phone."
//
// Nothing stopped that window from being converted into a permanent key. Under an
// impersonation token, `req.user.id` IS the impersonated person everywhere downstream, so:
//
//   · "Link Apple ID" in My Account posts the CURRENT token as link_token, and the OAuth
//     callback attaches whatever Apple ID completes the flow — the ADMIN's — to Tina's
//     account. From then on the admin signs in as Tina with their own Face ID. No passkey
//     challenge, no impersonation record, no expiry.
//   · POST /api/passkeys/register/verify registers the admin's biometric as a passkey on
//     Tina's account. Same outcome, one step shorter.
//   · /api/2fa/setup + /verify-setup binds the admin's authenticator app to her account;
//     /disable takes hers off.
//   · DELETE /api/auth/me deletes her account outright.
//   · add-role / remove-role rewrite what she is.
//
// Every one of those is a write to WHO SOMEONE IS, and none of them is diagnosis. An admin
// who genuinely needs to change a person's account does it as themselves, through the admin
// panel, where it is their name on the record.
//
// Reads are untouched. Pete's actual use — open her phone's view and look — is unaffected;
// so is anything that writes ordinary app data, because that is what he is there to test.
//
// (change-password is not on the list and does not need to be: it already requires the
// current password, which an impersonator does not have.)
const { writeAuditLog, getClientIp } = require("./auditLog");

/**
 * Refuse this request when it is running under an impersonation token.
 * @param {string} what  short description for the refusal message and the audit row
 */
function blockWhileImpersonating(what) {
  return async function impersonationGuard(req, res, next) {
    const admin = req.user && req.user.impersonatedBy;
    if (!admin) return next();

    // Logged at "warning": this is an admin reaching for a credential write on someone
    // else's account, which is worth seeing in the log even though it was refused.
    writeAuditLog({
      userId: req.user.id,
      userEmail: req.user.email,
      userRole: Array.isArray(req.user.roles) ? req.user.roles.join(",") : req.user.role,
      action: "impersonation_blocked_write",
      endpoint: req.originalUrl || req.url,
      method: req.method,
      ipAddress: getClientIp(req),
      userAgent: req.headers["user-agent"] || null,
      details: { impersonatedBy: admin, blocked: what },
      severity: "warning",
    }).catch(() => { /* a refusal must not depend on the log succeeding */ });

    return res.status(403).json({
      error: `You're viewing this account as an admin, so you can't ${what} here. Do it from the admin panel under your own name.`,
      code: "IMPERSONATION_BLOCKED",
    });
  };
}

/** The same question, for a handler that has to decide mid-flight. */
function isImpersonating(req) {
  return !!(req.user && req.user.impersonatedBy);
}

/**
 * Who an OAuth "link" flow may attach the provider account to.
 *
 * The Apple link flow carries the caller's own JWT through the redirect as `link_token`, and
 * the callback attaches whatever Apple ID completes the flow to `decoded.id`. Under an
 * impersonation token `decoded.id` is the impersonated PERSON while the Apple ID belongs to
 * the ADMIN — one tap and the admin can sign in as her with Face ID forever, with no passkey
 * challenge, no expiry, and nothing in the audit log. It is the single worst thing that
 * window could be used for, so the decision lives here beside the rest of the rule rather
 * than inline in a callback nobody can test.
 *
 * @returns {{ ok: true, userId: string } | { ok: false, reason: 'invalid' | 'impersonation', impersonatedBy?: string, userId?: string, email?: string }}
 */
function linkTargetFromToken(token, verify) {
  let decoded;
  try {
    decoded = verify(token);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (!decoded || !decoded.id) return { ok: false, reason: "invalid" };
  if (decoded.impersonatedBy) {
    return { ok: false, reason: "impersonation", impersonatedBy: decoded.impersonatedBy, userId: decoded.id, email: decoded.email };
  }
  return { ok: true, userId: decoded.id };
}

// ─── v1.109.1 — viewing as someone changes nothing ───
//
// Pete, 9/18: "View as user should be read only ... It is intended to allow me to help
// troubleshoot what other roles are seeing when they log in, not to change anything."
//
// Per-route guards covered 17 of 314 write routes, so the answer had to move to the one place
// every request passes through (middleware/auth.js). This is the rule that lives there.
//
// Two things stay allowed, and neither writes anything of hers: ending the session, and the
// cookie-only refresh that hands the admin their own token back when they stop.
const IMPERSONATION_ALLOWED = [
  { method: "POST", path: "/api/auth/logout" },
  { method: "POST", path: "/api/auth/refresh" },
];

/**
 * May this request proceed under an impersonation token? Reads always; writes never, apart
 * from the two above.
 * @returns {null | string} null to proceed, or a short description for the refusal.
 */
function readOnlyRefusal(method, url) {
  const m = String(method || "").toUpperCase();
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return null;
  const path = String(url || "").split("?")[0].replace(/\/+$/, "") || "/";
  if (IMPERSONATION_ALLOWED.some((a) => a.method === m && a.path === path)) return null;
  return "change anything";
}

module.exports = { blockWhileImpersonating, isImpersonating, linkTargetFromToken, readOnlyRefusal, IMPERSONATION_ALLOWED };
