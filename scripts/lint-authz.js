#!/usr/bin/env node
/**
 * lint:authz — a role string is not an authorization check.
 *
 * Twice now, the same bug: a route decided what you may do by reading the role in YOUR OWN
 * token. `activeRole === "caregiver"` does not mean "the caregiver on this session"; it means
 * "holds the caregiver role", and that role is free — anyone can register with it or add it to
 * an existing account via POST /api/auth/add-role, with no vetting.
 *
 *   Aug  4 2026: six endpoints were `authenticate`-gated and nothing more (fixed in v1.105.35
 *                with utils/access.js).
 *   Sep 13 2026: the same shape had regrown in seven more places. Any account could cancel,
 *                reschedule or re-negotiate ANY confirmed visit on the platform, and any account
 *                holding the self-assignable `care_for` role could append text to ANY session's
 *                special instructions — which the caregiver reads at check-in.
 *
 * Authentication answers "who are you". Authorization asks "and does this row have anything to
 * do with you", which only a lookup against the row can answer: sessionAccess(),
 * recipientAccess(), recipientCapabilities() in src/utils/access.js.
 *
 * This lint bans the shape. Comparing a role to decide *what to show* is fine; comparing it to
 * decide *what someone may do* is not, and the two are indistinguishable from here — so a
 * genuine display-only use is marked explicitly:
 *
 *     const label = activeRole === "caregiver" ? "Your visit" : "Their visit"; // authz-ok: display only
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const ROUTES = path.join(ROOT, "src", "routes");

// `x === "caregiver"`, `roles.includes('admin')`, `activeRole !== "family"`, etc.
const ROLE_COMPARE = /(?:activeRole|req\.user\.role|userRole|\brole\b)\s*[=!]==?\s*["'`](admin|caregiver|family|care_for|helper)["'`]|["'`](admin|caregiver|family|care_for|helper)["'`]\s*[=!]==?\s*(?:activeRole|req\.user\.role|userRole)|\broles\s*\)?\s*\.includes\(\s*["'`](admin|caregiver|family|care_for|helper)["'`]/;

// Lines that make a role comparison load-bearing for access.
const GATE_NEARBY = /res\.status\(\s*(?:401|403|404)\s*\)|return\s+res\.status|\bcanManage\b|\bcanView\b|authoriz|not your|access denied/i;

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith(".js")) acc.push(p);
  }
  return acc;
}

// A role comparison is only dangerous when it stands ALONE. These say the line also consulted
// something real about the caller's relationship to the row, so the role is a refinement, not
// the gate.
const IDENTITY_NEARBY = /req\.user\.id|\buserId\s*[=!]==|\bis_admin\b|sessionAccess|recipientAccess|recipientCapabilities|uploaded_by|\bmember\b|owner_id|family_user_id|caregiver_user_id|linked_user_id|\.user_id\b/;

const findings = [];
for (const file of walk(ROUTES)) {
  const rel = path.relative(ROOT, file);
  const lines = fs.readFileSync(file, "utf8").split("\n");

  // Which route are we inside, and does it act on a row named in the URL?
  let routePath = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const rm = line.match(/^\s*router\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/);
    if (rm) routePath = rm[2];

    if (line.trim().startsWith("//") || line.trim().startsWith("*")) continue;
    if (!ROLE_COMPARE.test(line)) continue;
    // The marker may sit anywhere in the comment block directly above, not just one line up.
    if (/authz-ok/.test(line)) continue;
    let marked = false;
    for (let k = i - 1; k >= 0 && k >= i - 6; k--) {
      const t = (lines[k] || "").trim();
      if (!t.startsWith("//")) break;
      if (/authz-ok/.test(t)) { marked = true; break; }
    }
    if (marked) continue;

    // Only routes that address a specific row. A role check on a collection endpoint is an
    // eligibility question ("are you a caregiver at all"), which is a different thing.
    if (!routePath || !routePath.includes(":")) continue;

    // Is the comparison load-bearing for access?
    const window = lines.slice(i, i + 6).join("\n");
    if (!GATE_NEARBY.test(window)) continue;

    // Accompanied by a real identity check, in the statement or the two lines around it?
    const stmt = lines.slice(Math.max(0, i - 2), i + 3).join("\n");
    if (IDENTITY_NEARBY.test(stmt)) continue;

    findings.push({ rel, line: i + 1, route: routePath, text: line.trim().slice(0, 120) });
  }
}

// Known, reviewed exceptions. Every entry needs a reason; none of these grant access on a role.
const BASELINE = new Set([]);

const unexpected = findings.filter((f) => !BASELINE.has(`${f.rel}:${f.line}`));

if (unexpected.length) {
  console.error(`\n[lint:authz] ✗ ${unexpected.length} place(s) appear to authorize on a role string:\n`);
  for (const f of unexpected) console.error(`  ${f.rel}:${f.line}  (route "${f.route}")\n      ${f.text}`);
  console.error(`
  A role in the caller's own token says nothing about the row being acted on, and every role
  except admin is self-assignable. Use src/utils/access.js:

      const access = await sessionAccess(db, req.params.id, req.user.id);
      if (!access) return res.status(404).json({ error: "Session not found" });
      if (access.isCaregiver) { ... }

  Answer 404, not 403, so probing ids reveals nothing. If the comparison only chooses what to
  DISPLAY and grants nothing, mark it: // authz-ok: <reason>
`);
  process.exit(1);
}

console.log(`  [lint:authz] ✓ no route authorizes on a role string (${findings.length} reviewed exception(s))`);
