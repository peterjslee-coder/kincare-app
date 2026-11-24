// ─── v1.156.0 — drop-in and awake noticing on the InPlace Hub: who may, and on whose word ───
//
// Pete, 11/23–24:
//   • "I need the ability to 'drop in' and have her mic and camera on...probably requires a
//     managed care account where that access is restricted and purposeful."
//   • "we just need an acknowledgment that someone with a durable POA or that person has signed
//     up for drop-ins that might include microphone and camera usage without their active
//     consent at the time. That is a risk decision that me and the lawyer have made...We just
//     wanna make sure it is recorded as purposeful."
//   • Who may drop in: "anyone I select."
//   • Listening: "don't record audio. Speaking enough to be awake, call it 10 seconds, should be
//     noted and with movement or other noise be considered awake."
//
// So:
//   1. Nothing happens without a signed consent: the person herself (her own trusted account) or
//      the agent recorded under her durable power of attorney or as her healthcare agent
//      (recipient_authorities, Legal readiness). The leader cannot sign for her unless the
//      leader IS that agent.
//   2. The consent row keeps the exact wording signed, who signed, in what capacity, and when.
//      Revoking stamps it; nothing is ever deleted or edited. Every step also lands in
//      consent_audit_log.
//   3. The leader chooses who may drop in (care team only, never a hired caregiver unless the
//      leader is also one). Chosen ≠ allowed: the consent must also be live.
//   4. Awake noticing needs the same consent and keeps only times and which signals.

const { v4: uuid } = require("uuid");

const WORDING_VERSION = "2026-11-24";
const wordingFor = (name) => [
  `I agree that the InPlace Hub (the tablet in ${name}'s home) may be used in these two ways, without asking ${name} at the time:`,
  `1. Drop-in. The people the care team leader chooses may open the Hub's camera and microphone to see and talk with ${name}. The Hub chimes and shows who is checking in whenever this happens.`,
  `2. Noticing when ${name} is up. The Hub may use its camera and microphone to notice movement and talking, so the care team knows when ${name} was awake (for example, up from 2 to 5 AM). Only the times are kept. No pictures, video or sound are recorded or saved.`,
  `I am ${name}, or I hold ${name}'s durable power of attorney or am ${name}'s healthcare agent, and I am making this choice on purpose. It stays in place until it is withdrawn, which anyone signing it, ${name}, or the care team leader can do at any time in InPlace.`,
].join("\n\n");

const CAPACITY_LABEL = {
  self: "themselves",
  financial_poa: "agent under the durable power of attorney",
  healthcare_poa: "healthcare agent",
};

async function recipient(db, id) {
  return db.prepare("SELECT id, first_name, family_user_id, linked_user_id, simple_mode FROM care_recipients WHERE id = ?").get(id);
}

/** In what capacity may this user sign for her? 'self' | 'financial_poa' | 'healthcare_poa' | null */
async function signerCapacity(db, cr, userId) {
  const { trustedLinkedUserId } = require("./linkedAccount");
  if ((await trustedLinkedUserId(db, cr)) === userId) return "self";
  const rows = await db.prepare(
    "SELECT kind FROM recipient_authorities WHERE care_recipient_id = ? AND user_id = ? AND kind IN ('financial_poa', 'healthcare_poa')"
  ).all(cr.id, userId);
  const kinds = rows.map((r) => r.kind);
  if (kinds.includes("financial_poa")) return "financial_poa";
  if (kinds.includes("healthcare_poa")) return "healthcare_poa";
  return null;
}

async function isLeader(db, cr, userId) {
  if (cr.family_user_id === userId) return true;
  const row = await db.prepare(`
    SELECT 1 FROM care_team_members ctm JOIN care_teams ct ON ct.id = ctm.care_team_id
    WHERE ct.care_recipient_id = ? AND ctm.user_id = ? AND ctm.role = 'leader' LIMIT 1
  `).get(cr.id, userId);
  return !!row;
}

async function activeConsent(db, recipientId) {
  return db.prepare(
    "SELECT * FROM drop_in_consents WHERE care_recipient_id = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1"
  ).get(recipientId);
}

/** Care team members the leader may choose for drop-in (family; the leader even if also a caregiver). */
async function dropInCandidates(db, cr) {
  const rows = await db.prepare(`
    SELECT DISTINCT u.id, u.first_name, u.last_name, ctm.role FROM care_team_members ctm
    JOIN care_teams ct ON ct.id = ctm.care_team_id JOIN users u ON u.id = ctm.user_id
    WHERE ct.care_recipient_id = ? ORDER BY u.first_name
  `).all(cr.id);
  const { trustedLinkedUserId } = require("./linkedAccount");
  const herself = await trustedLinkedUserId(db, cr);
  const out = [];
  for (const r of rows) {
    if (r.id === herself) continue;
    const leader = r.role === "leader" || r.id === cr.family_user_id;
    const cg = await db.prepare("SELECT 1 FROM caregiver_profiles WHERE user_id = ? LIMIT 1").get(r.id);
    if (cg && !leader) continue;
    out.push({ userId: r.id, firstName: r.first_name, name: `${r.first_name || ""} ${r.last_name || ""}`.trim() });
  }
  return out;
}

function chosenIds(cr) {
  const { parseSimpleMode } = require("./simpleMode");
  const hub = parseSimpleMode(cr.simple_mode).hub || {};
  return Array.isArray(hub.dropInUserIds) ? hub.dropInUserIds : [];
}

/** May this user drop in right now? Consent live, Hub on, user chosen and still on the team. */
async function mayDropIn(db, recipientId, userId) {
  const cr = await recipient(db, recipientId);
  if (!cr) return false;
  const { hubOn } = require("./hubPhotos");
  if (!(await hubOn(db, cr.id))) return false;
  if (!(await activeConsent(db, cr.id))) return false;
  if (!chosenIds(cr).includes(userId)) return false;
  return (await dropInCandidates(db, cr)).some((c) => c.userId === userId);
}

/** May the Hub notice when she is up? Consent live and the leader turned it on. */
async function mayNotice(db, recipientId) {
  const cr = await recipient(db, recipientId);
  if (!cr) return false;
  const { parseSimpleMode } = require("./simpleMode");
  const hub = parseSimpleMode(cr.simple_mode).hub || {};
  if (!hub.noticeAwake) return false;
  return !!(await activeConsent(db, cr.id));
}

async function audit(db, recipientId, actorId, eventType, description, metadata) {
  try {
    await db.prepare(`
      INSERT INTO consent_audit_log (id, care_recipient_id, actor_id, actor_role, event_type, description, metadata)
      VALUES (?, ?, ?, 'family', ?, ?, ?)
    `).run(uuid(), recipientId, actorId, eventType, description, JSON.stringify(metadata || {}));
  } catch (e) { try { require("./sentry").captureException(e, { where: "dropIn: audit" }); } catch { /* best effort */ } }
}

module.exports = {
  WORDING_VERSION, wordingFor, CAPACITY_LABEL,
  recipient, signerCapacity, isLeader, activeConsent, dropInCandidates, chosenIds, mayDropIn, mayNotice, audit,
};
