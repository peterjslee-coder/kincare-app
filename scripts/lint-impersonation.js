#!/usr/bin/env node
/**
 * lint:impersonation — an impersonation window stays a window.
 *
 * v1.106.40. Impersonation is passkey-gated, short-lived and audited on every start
 * ("no impersonation without passkey. period."). None of that is worth anything if, from
 * inside the window, an admin can write to WHO SOMEONE IS — because under an impersonation
 * token `req.user.id` is the impersonated person, so:
 *
 *   · registering a passkey puts the ADMIN's biometric on her account, permanently;
 *   · 2FA setup binds the ADMIN's authenticator app to it;
 *   · "Link Apple ID" attaches the ADMIN's Apple sign-in to it;
 *   · DELETE /api/auth/me deletes her.
 *
 * Every one of those converts an expensive, temporary, attributable window into a cheap,
 * permanent, anonymous key. They are now refused by
 * middleware/noImpersonation.blockWhileImpersonating, and this keeps them refused.
 *
 * Two rules, because the files differ in kind:
 *
 *   1. STRUCTURAL — passkeys.js and twoFactor.js exist only to manage credentials, so every
 *      authenticated non-GET route in them must carry the guard. A new one inherits the rule
 *      by being written, which is the property a hardcoded list can never have.
 *
 *   2. NAMED — auth.js and oauth.js hold plenty of routes that are nothing to do with this
 *      (login, register, verify-email), most of them unauthenticated, so requiring a marker
 *      on all of them would be noise nobody reads. The handful that matter are named here.
 *
 * A genuine exception marks itself on the route line:
 *
 *     router.post("/ping", authenticate, handler);  // impersonation-ok: writes nothing
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const R = (p) => path.join(ROOT, p);
const ALLOW = /impersonation-ok:/;
const GUARD = /blockWhileImpersonating\s*\(/;

const CREDENTIAL_FILES = ["src/routes/passkeys.js", "src/routes/twoFactor.js"];

// [file, a regex matching the route's declaration, what it is]
const NAMED = [
  ["src/routes/auth.js", /router\.post\(\s*["']\/add-role["'][^\n]*/, "POST /api/auth/add-role"],
  ["src/routes/auth.js", /router\.post\(\s*["']\/remove-role["'][^\n]*/, "POST /api/auth/remove-role"],
  ["src/routes/auth.js", /router\.delete\(\s*["']\/me["'][^\n]*/, "DELETE /api/auth/me"],
];

const findings = [];

// ── Rule 1 ──
for (const rel of CREDENTIAL_FILES) {
  const abs = R(rel);
  if (!fs.existsSync(abs)) { findings.push({ file: rel, line: 0, why: "file is gone — has it moved? update this lint" }); continue; }
  const lines = fs.readFileSync(abs, "utf8").split("\n");
  lines.forEach((line, i) => {
    const m = line.match(/router\.(post|put|patch|delete)\s*\(\s*["'`]([^"'`]+)["'`]/);
    if (!m) return;
    // The declaration can wrap; look at it plus the next couple of lines. The quoted path is
    // removed FIRST: /authenticate/options is the sign-in route and has no `authenticate`
    // middleware at all, but the word sits in its path and the first cut of this lint flagged
    // both sign-in routes as unguarded credential writes.
    const decl = lines.slice(i, i + 3).join(" ").replace(/["'`][^"'`]*["'`]/g, '""');
    if (!/\bauthenticate\b/.test(decl)) return;   // unauthenticated routes are a different question
    if (GUARD.test(decl)) return;
    if (ALLOW.test(lines.slice(i, i + 3).join("\n"))) return;
    findings.push({ file: rel, line: i + 1, why: `${m[1].toUpperCase()} ${m[2]} is an authenticated credential write with no guard` });
  });
}

// ── Rule 2 ──
for (const [rel, pattern, label] of NAMED) {
  const abs = R(rel);
  const src = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : "";
  const m = src.match(pattern);
  if (!m) { findings.push({ file: rel, line: 0, why: `${label} not found — renamed or removed? update this lint` }); continue; }
  if (!GUARD.test(m[0]) && !ALLOW.test(m[0])) {
    const line = src.slice(0, m.index).split("\n").length;
    findings.push({ file: rel, line, why: `${label} lost its blockWhileImpersonating guard` });
  }
}

// ── Rule 2b: the OAuth link decision ──
{
  const rel = "src/routes/oauth.js";
  const src = fs.existsSync(R(rel)) ? fs.readFileSync(R(rel), "utf8") : "";
  const i = src.indexOf("|link|");
  if (i === -1) {
    findings.push({ file: rel, line: 0, why: "the Apple link flow is gone — update this lint" });
  } else {
    const branch = src.slice(i, src.indexOf("if (!id_token)", i) + 1 || i + 4000);
    if (!/linkTargetFromToken\s*\(/.test(branch)) {
      findings.push({
        file: rel, line: src.slice(0, i).split("\n").length,
        why: "the Apple link callback decides its own link target instead of asking linkTargetFromToken — an impersonation token would attach the ADMIN's Apple ID to the impersonated account",
      });
    }
  }
}

// ── Rule 3: the door itself (v1.109.1) ──
//
// Per-route guards covered 17 of 314 write routes. The rule that matters now lives in
// authenticate: under an impersonation token, anything that is not a read is refused. These
// three assertions are the ones that, if they break, silently make "view as user" writable
// again — which is exactly how this class of bug came back the last two times.
{
  const authRel = "src/middleware/auth.js";
  const auth = fs.existsSync(R(authRel)) ? fs.readFileSync(R(authRel), "utf8") : "";
  if (!/readOnlyRefusal\s*\(\s*req\.method/.test(auth) || !/IMPERSONATION_BLOCKED/.test(auth)) {
    findings.push({ file: authRel, line: 0, why: "authenticate no longer refuses writes under an impersonation token (readOnlyRefusal + IMPERSONATION_BLOCKED)" });
  }

  const meRel = "src/routes/auth.js";
  const me = fs.existsSync(R(meRel)) ? fs.readFileSync(R(meRel), "utf8") : "";
  if (!/const token = req\.user\.impersonatedBy \? null : generateToken\(user\)/.test(me)) {
    findings.push({ file: meRel, line: 0, why: "GET /api/auth/me mints a token again — an impersonation window converts into an ordinary 7-day token for that account, and every guard above becomes decorative" });
  }

  const srvRel = "src/server.js";
  const srv = fs.existsSync(R(srvRel)) ? fs.readFileSync(R(srvRel), "utf8") : "";
  const handshake = srv.slice(srv.indexOf("io.use((socket, next)"), srv.indexOf("// Track connected users"));
  if (!/decoded\.impersonatedBy/.test(handshake)) {
    findings.push({ file: srvRel, line: 0, why: "the socket handshake accepts an impersonation token — it would ring phones and show typing/read receipts as her" });
  }
}

if (findings.length === 0) {
  console.log("  [lint:impersonation] ✓ viewing as someone is read-only: the door refuses writes, /me mints no token, the socket refuses the handshake");
  process.exit(0);
}

console.error(`\n  [lint:impersonation] ✗ ${findings.length} identity-write route(s) reachable under impersonation.`);
console.error("  An admin inside an impersonation window could make a permanent credential on someone");
console.error("  else's account. Add blockWhileImpersonating(\"<what>\") from middleware/noImpersonation,");
console.error("  or mark a genuine exception with `// impersonation-ok: <why>`.\n");
for (const f of findings) console.error(`    ${f.file}:${f.line}  ${f.why}`);
console.error("");
process.exit(1);
