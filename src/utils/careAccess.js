// ─── The identity gate in front of every care record (v1.112.0) ───
//
// Pete, 10/12: "We should absolutely require someone to verify their ID before they are able
// to sign up for care."
//
// Why: an unrelated account (Kit Conn) had been linked to Betty's care profile since a March
// self-signup and was treated as her. His worry, in his words, is "bleedover where some random
// dude signs up and ends up seeing my mom's profile or getting notifications." Nothing about
// that account was ever checked by a person. Identity is the one thing in this product a
// human does check (src/utils/identityDecision.js — the AI never approves an ID), so it is the
// gate.
//
// Scope: EVERYONE — family, helpers/viewers, care recipients who sign themselves up, caregivers.
// While someone is not allowed they have their ACCOUNT and nothing else: sign in, finish their
// profile, upload their ID. No care recipient, care team, messages, visits, documents, care
// notifications, and no booking.
//
// ── The states ──
//   exempt          users.is_admin or users.is_demo. Never gated (do not lock Pete out; demo
//                   accounts are fiction and have no ID to show).
//   verified        an APPROVED identity document under one of this person's own shapes
//                   (identity.js personIdentityStatus — the single answer; not redefined here).
//   grace           not verified, but users.id_gate_grace_until is in the future. Migration 056
//                   gave every account that existed on deploy day 14 days. New accounts get none.
//   pending_review  submitted, waiting on a person. Not allowed.
//   needs_id        nothing submitted, or the last one was rejected. Not allowed.
//
// allowed = exempt | verified | grace.
//
// ── Where it is enforced (ONE choke point, plus the paths that do not go through it) ──
//   1. middleware/auth.js authenticate() → careGateRefusal() below. Every authenticated request
//      to a care-data path answers 403 { code: 'ID_REQUIRED' } before the route runs. That is
//      why accept-invite cannot consume an invite for a blocked user: the handler never runs.
//   2. utils/access.js — recipientAccess/recipientCapabilities return no access, and
//      usersWithCapability drops blocked users from every capability-scoped fan-out.
//   3. utils/pushPermission.js mayBeNotified — the push floor: a blocked user gets only
//      account/identity pushes about themselves.
//   4. server.js socket handshake — no live socket (no care events) for a blocked user.
//   5. routes/auth.js register (care_for) — a self-signup's care profile is NOT created until
//      the ID is approved (materializeSelfCare below).

const { v4: uuid } = require("uuid");
const { personIdentityStatus, approvedIdName } = require("./identity");
const { captureException } = require("./sentry");

const GRACE_DAYS = 14;

const ALLOWED = new Set(["exempt", "verified", "grace"]);

/**
 * @returns {Promise<{status: 'exempt'|'verified'|'grace'|'pending_review'|'needs_id',
 *                    allowed: boolean, graceUntil: string|null, identityStatus: string|null}>}
 */
async function careAccessFor(db, userId) {
  if (!userId) return { status: "needs_id", allowed: false, graceUntil: null, identityStatus: null };
  const u = await db.prepare(
    "SELECT is_admin, is_demo, id_gate_grace_until FROM users WHERE id = ?"
  ).get(userId);
  if (!u) return { status: "needs_id", allowed: false, graceUntil: null, identityStatus: null };
  if (u.is_admin || u.is_demo) return { status: "exempt", allowed: true, graceUntil: null, identityStatus: null };

  const { identityStatus } = await personIdentityStatus(db, userId);
  if (identityStatus === "verified") {
    return { status: "verified", allowed: true, graceUntil: null, identityStatus };
  }

  const graceMs = u.id_gate_grace_until ? new Date(u.id_gate_grace_until).getTime() : NaN;
  if (Number.isFinite(graceMs) && graceMs > Date.now()) {
    return { status: "grace", allowed: true, graceUntil: new Date(graceMs).toISOString(), identityStatus };
  }
  const graceUntil = Number.isFinite(graceMs) ? new Date(graceMs).toISOString() : null;
  if (identityStatus === "pending") return { status: "pending_review", allowed: false, graceUntil, identityStatus };
  return { status: "needs_id", allowed: false, graceUntil, identityStatus };
}

async function careAccessAllowed(db, userId) {
  return (await careAccessFor(db, userId)).allowed;
}

// ── Which paths are care data ──
//
// Prefixes, matched against the full path (query stripped). Deliberately listed rather than
// "everything except an allowlist": the account-only screens a blocked person still needs —
// sign-in, My Account, 2FA, passkeys, push subscribe, legal acceptance, caregiver onboarding,
// Stripe Connect and Checkr setup — are many and scattered, and refusing one of those would
// strand someone halfway through doing exactly what we are asking them to do.
// A NEW care-data router must be added here; tests/integration/idGate.itest.js lists the ones
// it proves.
const CARE_PREFIXES = [
  "/api/care-recipients", "/api/care-teams", "/api/sessions", "/api/messages", "/api/notes",
  "/api/documents", "/api/medical-records", "/api/family-visits", "/api/care-tasks",
  "/api/care-events", "/api/care-todos", "/api/care-intelligence", "/api/activity",
  "/api/dashboard", "/api/reactions", "/api/photos", "/api/kindred", "/api/ipai",
  "/api/reimbursements", "/api/costs", "/api/assignments", "/api/connections",
  "/api/scheduling", "/api/video", "/api/reports", "/api/legal-readiness",
  "/api/known-caregivers", "/api/accountability", "/api/consent", "/api/interviews",
  "/api/matching",
  // Narrower slices of otherwise account-level routers:
  "/api/media/recipient",          // a care recipient's photo
  "/api/push/notifications",       // the in-app notification list is care events
  "/api/caregivers/nearby",        // measured from a care recipient's address
  "/api/payments/checkout", "/api/payments/session", "/api/payments/history",
  "/api/payments/earnings", "/api/payments/manual",
];

function pathOf(url) {
  return String(url || "").split("?")[0].replace(/\/+$/, "");
}

/** Is this request path care data? */
function isCarePath(url) {
  const p = pathOf(url);
  return CARE_PREFIXES.some((pre) => p === pre || p.startsWith(pre + "/"));
}

/**
 * A blocked person may still list THEIR OWN documents (My Account → Documents). Nothing else
 * under a care prefix is theirs alone.
 */
function isSelfOnlyPath(method, url, userId) {
  const p = pathOf(url);
  return method === "GET" && !!userId && p === `/api/documents/owner/user/${userId}`;
}

const MESSAGES = {
  needs_id: "Verify your ID to see care. Upload a photo ID from My Account — a person on the InPlace team reviews it.",
  pending_review: "Thanks — your ID is waiting for review. You'll be able to see care as soon as it's approved.",
};

function refusalBody(access) {
  return {
    error: MESSAGES[access.status] || MESSAGES.needs_id,
    message: MESSAGES[access.status] || MESSAGES.needs_id,
    code: "ID_REQUIRED",
    status: access.status,
    graceUntil: access.graceUntil || null,
  };
}

/**
 * The choke point, called from authenticate() once req.user is known.
 * @returns {Promise<object|null>} a 403 body to send, or null to let the request through.
 */
async function careGateRefusal(db, req) {
  const url = req.originalUrl || req.url || req.path;
  if (!isCarePath(url)) return null;
  const userId = req.user && req.user.id;
  if (!userId || req.isAdmin) return null;
  if (isSelfOnlyPath(req.method, url, userId)) return null;
  const access = await careAccessFor(db, userId);
  if (access.allowed) return null;
  return refusalBody(access);
}

// ── Pushes a blocked person may still receive: about their own account, never about care ──
const ACCOUNT_PUSH_TYPES = new Set([
  "account_approved", "account_onboarding", "identity_approved", "identity_rejected",
  "role_added", "test", "totp", "background_check", "bgcheck_rejected", "checkr_blocked",
  "blocked", "unblocked",
]);

function isAccountPush(data) {
  const type = data && data.type;
  return !!type && ACCOUNT_PUSH_TYPES.has(type);
}

// ── A care_for self-signup's profile, created only once a person has approved the ID ──
//
// Before v1.112.0, registering as care_for created a care recipient, a care team led by the
// new account, and a team conversation, in the same request — no ID, no review. That is the
// exact door Kit Conn's account came through. Now register records the intent in
// users.pending_self_care (JSON), the self-onboarding wizard adds the profile to it, and this
// function turns it into the real records the first time the person is allowed: from the
// admin approval itself, and again on /api/auth/me as a backstop (idempotent — the claim is
// an atomic UPDATE ... RETURNING, so two callers cannot both create one).

function titleCase(s) {
  const t = String(s || "").trim();
  if (!t) return t;
  // An ID prints names in capitals; a person typed theirs. Only re-case the shouting.
  if (t !== t.toUpperCase()) return t;
  return t.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (m, a, b) => a + b.toUpperCase());
}

/** "DOE, JANE Q" or "JANE Q DOE" → { first, last } */
function splitIdName(full) {
  const raw = String(full || "").trim();
  if (!raw) return null;
  let first, last;
  if (raw.includes(",")) {
    const [l, rest] = raw.split(",", 2);
    last = l.trim();
    first = String(rest || "").trim().split(/\s+/)[0] || "";
  } else {
    const parts = raw.split(/\s+/);
    if (parts.length < 2) return null;
    first = parts[0];
    last = parts[parts.length - 1];
  }
  if (!first || !last) return null;
  return { first: titleCase(first), last: titleCase(last) };
}

async function materializeSelfCare(db, userId) {
  if (!userId) return null;
  const pending = await db.prepare("SELECT pending_self_care FROM users WHERE id = ?").get(userId);
  if (!pending || pending.pending_self_care == null) return null;
  if (!(await careAccessAllowed(db, userId))) return null;

  // Already linked to a profile (e.g. accepted a care_recipient invite meanwhile): nothing to make.
  const linked = await db.prepare("SELECT id FROM care_recipients WHERE linked_user_id = ? LIMIT 1").get(userId);
  if (linked) {
    await db.prepare("UPDATE users SET pending_self_care = NULL WHERE id = ?").run(userId);
    return null;
  }

  // Claim it atomically: whoever clears the column builds the records.
  const claimed = await db.prepare(
    "UPDATE users SET pending_self_care = NULL WHERE id = ? AND pending_self_care IS NOT NULL RETURNING pending_self_care, first_name, last_name"
  ).get(userId);
  // RETURNING gives the NEW row; re-read the intent from what we fetched above.
  if (!claimed) return null;
  let intent = {};
  try { intent = JSON.parse(pending.pending_self_care) || {}; } catch { intent = {}; }

  const fromId = splitIdName(await approvedIdName(db, userId));
  const firstName = (fromId && fromId.first) || claimed.first_name || "";
  const lastName = (fromId && fromId.last) || claimed.last_name || "";

  const crId = uuid();
  try {
    await db.prepare(`
      INSERT INTO care_recipients
      (id, family_user_id, first_name, last_name, linked_user_id,
       authorization_tier, consent_status, consent_method, consent_verified_at)
      VALUES (?, ?, ?, ?, ?, 'tier1', 'verified', 'self_signup', NOW())
    `).run(crId, userId, firstName, lastName, userId);
    const teamId = uuid();
    const teamName = `${firstName} ${lastName}'s Care Team`.trim();
    await db.prepare(
      "INSERT INTO care_teams (id, name, care_recipient_id, created_by) VALUES (?, ?, ?, ?)"
    ).run(teamId, teamName, crId, userId);
    await db.prepare(
      "INSERT INTO care_team_members (id, care_team_id, user_id, role, invited_by) VALUES (?, ?, ?, 'leader', ?)"
    ).run(uuid(), teamId, userId, userId);
    const convId = uuid();
    await db.prepare(
      "INSERT INTO conversations (id, type, name, care_team_id, created_by) VALUES (?, 'care_team', ?, ?, ?)"
    ).run(convId, teamName, teamId, userId);
    await db.prepare(
      "INSERT INTO conversation_members (id, conversation_id, user_id, role) VALUES (?, ?, ?, 'admin')"
    ).run(uuid(), convId, userId);

    if (intent && intent.profile) {
      const { applySelfCareProfile } = require("../routes/selfOnboarding");
      await applySelfCareProfile(db, crId, intent.profile);
    }
    return crId;
  } catch (e) {
    // Put the intent back so the next attempt can finish the job, and say so loudly.
    await db.prepare("UPDATE users SET pending_self_care = ? WHERE id = ? AND pending_self_care IS NULL")
      .run(pending.pending_self_care, userId).catch(() => {});
    await db.prepare("DELETE FROM care_recipients WHERE id = ?").run(crId).catch(() => {});
    throw e;
  }
}

/**
 * After an admin approves an identity document: who is the person it belongs to?
 * owner 'user' → that user; 'caregiver' → the profile's user; 'care_recipient' → the uploader
 * (the only case personIdentityDoc counts).
 */
async function personForIdentityDoc(db, doc) {
  if (!doc) return null;
  if (doc.owner_type === "user") return doc.owner_id;
  if (doc.owner_type === "caregiver") {
    const cp = await db.prepare("SELECT user_id FROM caregiver_profiles WHERE id = ?").get(doc.owner_id);
    return cp ? cp.user_id : null;
  }
  if (doc.owner_type === "care_recipient") return doc.uploaded_by || null;
  return null;
}

/** Everything that should happen the moment a person's ID is approved. Never throws. */
async function onIdentityApproved(db, userId) {
  if (!userId) return;
  try { await materializeSelfCare(db, userId); }
  catch (e) {
    captureException(e, { where: "careAccess: materializeSelfCare", userId });
  }
  try {
    const { sendPushToUser } = require("../routes/push");
    sendPushToUser(userId, {
      title: "Your ID is approved",
      body: "Thanks for verifying. You can now see your care team in InPlace.",
      data: { type: "identity_approved", page: "dashboard" },
    }, "identity_approved").catch(() => {});
  } catch { /* a courtesy push is never load-bearing */ }
}

module.exports = {
  GRACE_DAYS, CARE_PREFIXES, ALLOWED,
  careAccessFor, careAccessAllowed, careGateRefusal, refusalBody,
  isCarePath, isAccountPush, materializeSelfCare, onIdentityApproved, personForIdentityDoc,
  splitIdName,
};
