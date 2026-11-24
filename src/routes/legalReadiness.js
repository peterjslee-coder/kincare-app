// ─── Legal & Financial Readiness, phase 1 (migration 051_legal_readiness) ───
//
// Three things, all FAMILY-only:
//
//   1. A readiness checklist per care recipient — is there a durable financial power of
//      attorney, and a health care power of attorney / advance directive? Computed from
//      verified_documents; when nothing is uploaded, the family's own answer fills the gap.
//      A checklist item has three states — done, not done, NOT KNOWN YET — and an item nobody
//      has answered is the third, never the second.
//   2. "Get help nearby" — a hand-kept directory of public and institutional resources, local
//      first, then statewide, then national. Nobody pays to be listed and InPlace receives
//      nothing for a listing; every response says so.
//   3. Money-safety concerns — a family's own report ("worried about a scam?"), and the admin's
//      choice to share resources with a family after the message screener raised an
//      exploitation_signal flag. A flag reaches nobody but admins until an admin decides to
//      share; the family card never carries the flagged message or who sent it.
//
// InPlace is not a law firm or a financial adviser. Everything here is general information and
// says so. Caregivers never see any of it: financial vulnerability is exactly the information a
// bad actor in the home would want (same rule as the iPAi intelligence report).
const express = require("express");
const { v4: uuid } = require("uuid");
const { isCaregiverUser } = require("../utils/medicalAccess");
const { getDb } = require("../models/database");
const { authenticate, requireAdmin } = require("../middleware/auth");
const { blockWhileImpersonating } = require("../middleware/noImpersonation");
const { recipientCapabilities } = require("../utils/access");
const { captureException } = require("../utils/sentry");
const { checkAdmin } = require("./admin/shared");
const push = require("./push"); // property access at call time, so tests can stub it
const { TRUSTED_LINK_SQL } = require("../utils/linkedAccount"); // stale-link sweep

const router = express.Router();
const adminRouter = express.Router();

const DISCLAIMER = "This is general information, not legal or financial advice.";
const DIRECTORY_FOOTER = "InPlace doesn't receive payment for these listings.";

// ─── The checklist ───
const ANSWERS = ["have_not_uploaded", "not_sure", "dont_have"];
const ITEMS = [
  {
    key: "financial_poa",
    docTypes: ["POA"],
    uploadType: "POA",
    title: "Durable financial power of attorney",
    what: (n) => `${n} names someone they trust to handle bank accounts, bills and property if they can't do it themselves.`,
    when: (n) => `It has to be signed while ${n} can still understand it and decide for themselves. If that ability goes first, the usual route is asking a court to appoint a guardian or conservator, which is generally slower, costlier and more public. In Virginia a power of attorney keeps working if the person later loses capacity, unless the document says otherwise.`,
    how: "An elder-law attorney can draft one and make sure it is signed properly. It's also worth asking your loved one's bank whether it needs anything extra on file.",
    links: [
      { label: "Virginia Uniform Power of Attorney Act (Va. Code § 64.2-1600 and following)", url: "https://law.lis.virginia.gov/vacodepopularnames/uniform-power-of-attorney-act/" },
    ],
  },
  {
    key: "healthcare_directive",
    docTypes: ["Healthcare_POA", "Living_Will"],
    uploadType: "Healthcare_POA",
    title: "Health care power of attorney or advance directive",
    what: (n) => `Names who can make medical decisions for ${n} if they can't speak for themselves, and can write down their wishes about treatment.`,
    when: (n) => `Best done while ${n} can still make and explain their own choices. Without one, Virginia law sets an order of who doctors turn to — a guardian, then a spouse, then adult children, and so on — which can leave relatives guessing or disagreeing.`,
    how: "Virginia has a standard Advance Medical Directive form, and the Virginia State Bar publishes it free along with instructions for signing and witnessing. An elder-law attorney can help if things are complicated.",
    links: [
      { label: "Virginia State Bar — Advance Medical Directive forms", url: "https://www.vsb.org/Site/news/healthcare-decisions.aspx" },
    ],
  },
];
const ITEM_KEYS = ITEMS.map((i) => i.key);
const IN_REVIEW = ["pending", "ai_review", "ai_flagged"];

// ─── Who may see this: the family, never a caregiver ───
//
// recipientCapabilities() is the base: no access → 404 (the codebase's rule: a failed check
// does not confirm the row exists). Then two narrowings, both of which can only REMOVE access:
//   · read_profile is required — a helper invited to leave notes does not get this;
//   · anyone who works as a caregiver is out unless they OWN the recipient record. A paid
//     caregiver on the care team (Julia on Betty's) holds read_profile through the team,
//     which is exactly why this check exists.
// The care recipient's own linked account is out in phase 1 too (see the handoff note).
async function familyAccess(db, recipientId, userId) {
  const caps = await recipientCapabilities(db, recipientId, userId);
  if (!caps.length) return { status: 404 };
  const cr = await db.prepare("SELECT id, first_name, family_user_id, linked_user_id FROM care_recipients WHERE id = ?").get(recipientId);
  if (!cr) return { status: 404 };
  const me = await db.prepare("SELECT is_admin FROM users WHERE id = ?").get(userId);
  const isOwner = cr.family_user_id === userId;
  if (me?.is_admin || isOwner) return { status: 200, cr, isOwner, isAdmin: !!me?.is_admin };
  if (!caps.includes("read_profile")) return { status: 403 };
  if (cr.linked_user_id === userId) return { status: 403 };
  const cg = await db.prepare("SELECT id FROM caregiver_profiles WHERE user_id = ?").get(userId);
  if (cg) return { status: 403 };
  const assigned = await db.prepare("SELECT 1 FROM caregiver_assignments ca JOIN caregiver_profiles cp ON cp.id = ca.caregiver_profile_id WHERE ca.care_recipient_id = ? AND cp.user_id = ? LIMIT 1").get(recipientId, userId);
  if (assigned) return { status: 403 };
  return { status: 200, cr, isOwner: false, isAdmin: false };
}

function refuse(res, status) {
  if (status === 404) return res.status(404).json({ error: "Not found" });
  return res.status(403).json({ error: "This is only shown to the family." });
}

// The person a shared concern is addressed to: the care team leader, else the record's owner.
async function leaderFor(db, recipientId) {
  const leader = await db.prepare(`
    SELECT ctm.user_id FROM care_team_members ctm
    JOIN care_teams ct ON ct.id = ctm.care_team_id
    WHERE ct.care_recipient_id = ? AND ctm.role = 'leader'
    ORDER BY ctm.created_at LIMIT 1
  `).get(recipientId);
  if (leader?.user_id) return leader.user_id;
  const cr = await db.prepare("SELECT family_user_id FROM care_recipients WHERE id = ?").get(recipientId);
  return cr?.family_user_id || null;
}

// Checklist item → the authority it names. Recorded and shown only; it grants nothing.
const AGENT_KIND = { financial_poa: "financial_poa", healthcare_directive: "healthcare_agent" };

// May this person record who the document names? The record's owner or the care team leader.
async function canSetAgent(db, cr, userId) {
  if (cr.family_user_id === userId) return true;
  const row = await db.prepare(`
    SELECT 1 FROM care_team_members ctm JOIN care_teams ct ON ct.id = ctm.care_team_id
    WHERE ct.care_recipient_id = ? AND ctm.user_id = ? AND ctm.role = 'leader' LIMIT 1
  `).get(cr.id, userId);
  return !!row;
}

async function agentCandidates(db, careRecipientId) {
  const rows = await db.prepare(`
    SELECT DISTINCT u.id, u.first_name, u.last_name FROM care_team_members ctm
    JOIN care_teams ct ON ct.id = ctm.care_team_id JOIN users u ON u.id = ctm.user_id
    WHERE ct.care_recipient_id = ?
    ORDER BY u.first_name
  `).all(careRecipientId);
  // Family only: a hired caregiver is never offered as the agent, and her id never reaches
  // this family-only response. The leader or owner stays in the list even if they also hold
  // the caregiver role (Pete does). Anyone else can be typed by name.
  const cr = await db.prepare("SELECT family_user_id FROM care_recipients WHERE id = ?").get(careRecipientId);
  const leaders = new Set((await db.prepare(`
    SELECT ctm.user_id FROM care_team_members ctm JOIN care_teams ct ON ct.id = ctm.care_team_id
    WHERE ct.care_recipient_id = ? AND ctm.role = 'leader'
  `).all(careRecipientId)).map((r) => r.user_id));
  if (cr?.family_user_id) leaders.add(cr.family_user_id);
  const out = [];
  for (const r of rows) {
    if (!leaders.has(r.id) && (await isCaregiverUser(db, r.id))) continue;
    out.push({ userId: r.id, name: [r.first_name, r.last_name].filter(Boolean).join(" ") });
  }
  return out;
}

async function readinessFor(db, cr) {
  // Any category: the Documents page files a POA under 'consent' by default, this card under
  // 'legal'. The document type is what decides.
  const docs = await db.prepare(`
    SELECT id, document_type, status, created_at FROM verified_documents
    WHERE owner_type = 'care_recipient' AND owner_id = ? AND replaced_by IS NULL
    ORDER BY created_at DESC
  `).all(cr.id);
  // The consent-verification flow keeps its own uploads. A "POA" there proves someone may act
  // for the person, but not WHICH kind of POA it is — so it never counts as a financial POA on
  // its own; it moves the item to "check it covers money", which is still not-done.
  const consentPoa = await db.prepare(`
    SELECT id FROM authorization_documents
    WHERE care_recipient_id = ? AND document_type = 'POA' AND COALESCE(upload_status, 'uploaded') != 'rejected'
    ORDER BY created_at DESC LIMIT 1
  `).get(cr.id);
  const answers = await db.prepare(
    "SELECT item, answer, answered_at FROM legal_readiness_answers WHERE care_recipient_id = ?"
  ).all(cr.id);
  const byItem = Object.fromEntries(answers.map((a) => [a.item, a]));
  // v1.111.2 — who the document names (Pete: "IP should know that Sara Huber is the Durable POA")
  const agents = await db.prepare(
    "SELECT kind, user_id, agent_name, set_at FROM recipient_authorities WHERE care_recipient_id = ?"
  ).all(cr.id);
  const agentBy = Object.fromEntries(agents.map((a) => [a.kind, a]));
  const name = cr.first_name || "Your loved one";
  return ITEMS.map((it) => {
    const mine = docs.filter((d) => it.docTypes.includes(d.document_type));
    const approved = mine.find((d) => d.status === "approved");
    const inReview = mine.find((d) => IN_REVIEW.includes(d.status));
    const rejected = mine.find((d) => d.status === "rejected");
    const ans = byItem[it.key];
    // Order matters: a document beats an answer, and an approved one beats one in review.
    let state;
    if (approved) state = "on_file";
    else if (inReview) state = "in_review";
    else if (it.key === "financial_poa" && consentPoa && !ans?.answer) state = "check_type";
    else if (ans?.answer === "have_not_uploaded") state = "have_it";
    else if (ans?.answer === "dont_have") state = "missing";
    else if (ans?.answer === "not_sure") state = "not_sure";
    else state = "unknown";
    const done = state === "on_file" || state === "in_review" || state === "have_it";
    return {
      key: it.key,
      title: it.title,
      state,
      done,
      answer: ans?.answer || null,
      answeredAt: ans?.answered_at || null,
      documentId: (approved || inReview)?.id || null,
      lastUploadRejected: !approved && !inReview && !!rejected,
      agentKind: AGENT_KIND[it.key] || null,
      agent: AGENT_KIND[it.key] && agentBy[AGENT_KIND[it.key]]
        ? { userId: agentBy[AGENT_KIND[it.key]].user_id || null, name: agentBy[AGENT_KIND[it.key]].agent_name, setAt: agentBy[AGENT_KIND[it.key]].set_at }
        : null,
      uploadType: it.uploadType,
      what: it.what(name),
      when: it.when(name),
      how: it.how,
      links: it.links,
    };
  });
}

// ─── Where is this person? ───
//
// care_recipients has city / state / zip and no county. Resources are keyed by Virginia
// county or independent-city name, so the zip and city become candidate locality names.
// The zip table covers only the New River Valley, which is the one region with a seeded local
// entry; anywhere else falls through to statewide, which is the honest default.
const NRV_ZIPS = {
  "montgomery county": ["24060", "24061", "24062", "24063", "24068", "24073", "24087", "24138", "24149", "24162"],
  "floyd county": ["24072", "24091", "24105", "24380"],
  "giles county": ["24086", "24093", "24124", "24128", "24134", "24136", "24147", "24150", "24167"],
  "pulaski county": ["24058", "24084", "24301", "24324", "24347"],
  "radford city": ["24141", "24142", "24143"],
};
const ZIP_TO_LOCALITY = Object.fromEntries(Object.entries(NRV_ZIPS).flatMap(([loc, zips]) => zips.map((z) => [z, loc])));
const VA_INDEPENDENT_CITIES = ["alexandria", "bristol", "buena vista", "charlottesville", "chesapeake", "colonial heights", "covington", "danville", "emporia", "fairfax", "falls church", "franklin", "fredericksburg", "galax", "hampton", "harrisonburg", "hopewell", "lexington", "lynchburg", "manassas", "manassas park", "martinsville", "newport news", "norfolk", "norton", "petersburg", "poquoson", "portsmouth", "radford", "richmond", "roanoke", "salem", "staunton", "suffolk", "virginia beach", "waynesboro", "williamsburg", "winchester"];

const norm = (s) => String(s || "").toLowerCase().replace(/^city of\s+/, "").replace(/\s+/g, " ").trim();
const normKey = (s) => {
  const n = norm(s);
  return /^city of\s+/i.test(String(s || "").trim()) ? `${n} city` : n;
};

function localityFor(cr) {
  const zip = String(cr.location_zip || "").slice(0, 5);
  const state = String(cr.location_state || "").trim().toLowerCase();
  const zipNum = Number(zip);
  const inVirginia = state === "va" || state === "virginia" || (!state && zipNum >= 22000 && zipNum <= 24699);
  const candidates = new Set();
  const city = norm(cr.location_city);
  if (city) {
    candidates.add(city);
    if (VA_INDEPENDENT_CITIES.includes(city)) candidates.add(`${city} city`);
  }
  if (inVirginia && ZIP_TO_LOCALITY[zip]) candidates.add(ZIP_TO_LOCALITY[zip]);
  return { inVirginia, candidates: [...candidates], label: cr.location_city || null };
}

const KINDS = ["elder_law", "financial_advisor", "aps", "aaa", "legal_aid", "other"];
const PER_KIND = 3;

async function directoryFor(db, cr) {
  const loc = localityFor(cr);
  const rows = await db.prepare(
    "SELECT id, kind, name, phone, url, region_key, notes FROM local_resources WHERE is_active = 1 ORDER BY created_at, name"
  ).all();
  const tierOf = (r) => {
    const keys = String(r.region_key || "").split(/[;,]/).map(normKey).filter(Boolean);
    if (keys.includes("us")) return 3;
    if (keys.includes("va")) return loc.inVirginia ? 2 : null;
    return loc.inVirginia && keys.some((k) => loc.candidates.includes(k)) ? 1 : null;
  };
  const out = {};
  let anyLocal = false;
  for (const kind of KINDS) {
    const picked = rows
      .map((r) => ({ r, tier: tierOf(r) }))
      .filter((x) => x.r.kind === kind && x.tier !== null)
      .sort((a, b) => a.tier - b.tier)
      .slice(0, PER_KIND)
      .map(({ r, tier }) => {
        if (tier === 1) anyLocal = true;
        return { id: r.id, kind: r.kind, name: r.name, phone: r.phone, url: r.url, notes: r.notes, scope: tier === 1 ? "local" : tier === 2 ? "statewide" : "national" };
      });
    out[kind] = picked;
  }
  return {
    region: { label: loc.label, inVirginia: loc.inVirginia, matched: anyLocal ? "local" : loc.inVirginia ? "statewide" : "national" },
    resources: out,
    footer: DIRECTORY_FOOTER,
  };
}

const CONCERN_STEPS = [
  "If money or property may be leaving right now, call the bank or card company's fraud line — the number on the back of the card — and ask them to watch or freeze the account.",
  "Don't confront anyone you suspect on your own. Write down what you noticed and when, and keep any letters, texts or statements.",
  "Virginia Adult Protective Services takes reports of financial exploitation of older adults, 24 hours a day. You don't need proof to call.",
  "An elder-law attorney or a fee-only financial advisor can help you protect accounts and plan next steps.",
];

// ═══════════════════════════════════════════════════════════
// Family routes — /api/legal-readiness
// ═══════════════════════════════════════════════════════════

// POST /concerns/:id/acknowledge — the family has seen resources an admin shared. Clears the
// Needs-you item. 409 when already acknowledged (Needs-you contract).
router.post("/concerns/:id/acknowledge", authenticate, blockWhileImpersonating("acknowledge a shared note"), async (req, res) => {
  try {
    const db = await getDb();
    const c = await db.prepare("SELECT id, care_recipient_id, shared_with_user_id, shared_at, acknowledged_at FROM financial_concerns WHERE id = ?").get(req.params.id);
    if (!c || !c.shared_at) return res.status(404).json({ error: "Not found" });
    const acc = await familyAccess(db, c.care_recipient_id, req.user.id);
    if (acc.status !== 200) return refuse(res, acc.status);
    if (c.acknowledged_at) return res.status(409).json({ error: "Already marked as seen.", alreadyAnswered: true });
    const r = await db.prepare(
      "UPDATE financial_concerns SET acknowledged_at = NOW(), acknowledged_by = ? WHERE id = ? AND acknowledged_at IS NULL"
    ).run(req.user.id, c.id);
    if (!r.changes) return res.status(409).json({ error: "Already marked as seen.", alreadyAnswered: true });
    res.json({ ok: true });
  } catch (err) {
    captureException(err, { where: "legalReadiness: acknowledge" });
    res.status(500).json({ error: "Couldn't save that. Please try again." });
  }
});

// GET /:careRecipientId — the checklist, plus any resources an admin shared and not yet seen.
router.get("/:careRecipientId", authenticate, async (req, res) => {
  try {
    const db = await getDb();
    const acc = await familyAccess(db, req.params.careRecipientId, req.user.id);
    if (acc.status !== 200) return refuse(res, acc.status);
    const items = await readinessFor(db, acc.cr);
    const shared = await db.prepare(`
      SELECT id, shared_at FROM financial_concerns
      WHERE care_recipient_id = ? AND source = 'safety_flag' AND shared_at IS NOT NULL AND acknowledged_at IS NULL
      ORDER BY shared_at
    `).all(acc.cr.id);
    const myReports = await db.prepare(`
      SELECT id, status, created_at FROM financial_concerns
      WHERE care_recipient_id = ? AND source = 'family_report' AND reported_by = ?
      ORDER BY created_at DESC LIMIT 5
    `).all(acc.cr.id, req.user.id);
    const mayName = await canSetAgent(db, acc.cr, req.user.id);
    res.json({
      recipient: { id: acc.cr.id, firstName: acc.cr.first_name },
      items,
      canSetAgent: mayName,
      agentCandidates: mayName ? await agentCandidates(db, acc.cr.id) : [],
      complete: items.every((i) => i.done),
      sharedConcerns: shared.map((s) => ({ id: s.id, sharedAt: s.shared_at, steps: CONCERN_STEPS })),
      myReports: myReports.map((r) => ({ id: r.id, status: r.status, createdAt: r.created_at })),
      disclaimer: DISCLAIMER,
    });
  } catch (err) {
    captureException(err, { where: "legalReadiness: get" });
    res.status(500).json({ error: "Couldn't load the checklist." });
  }
});

// PUT /:careRecipientId/answers/:item — { answer: have_not_uploaded | not_sure | dont_have | null }
router.put("/:careRecipientId/answers/:item", authenticate, blockWhileImpersonating("answer the readiness checklist"), async (req, res) => {
  try {
    const { item } = req.params;
    const answer = req.body?.answer ?? null;
    if (!ITEM_KEYS.includes(item)) return res.status(400).json({ error: "Unknown checklist item." });
    if (answer !== null && !ANSWERS.includes(answer)) return res.status(400).json({ error: `answer must be one of: ${ANSWERS.join(", ")}` });
    const db = await getDb();
    const acc = await familyAccess(db, req.params.careRecipientId, req.user.id);
    if (acc.status !== 200) return refuse(res, acc.status);
    if (answer === null) {
      await db.prepare("DELETE FROM legal_readiness_answers WHERE care_recipient_id = ? AND item = ?").run(acc.cr.id, item);
    } else {
      await db.prepare(`
        INSERT INTO legal_readiness_answers (id, care_recipient_id, item, answer, answered_by, answered_at)
        VALUES (?, ?, ?, ?, ?, NOW())
        ON CONFLICT (care_recipient_id, item) DO UPDATE SET answer = EXCLUDED.answer, answered_by = EXCLUDED.answered_by, answered_at = NOW()
      `).run(uuid(), acc.cr.id, item, answer, req.user.id);
    }
    res.json({ items: await readinessFor(db, acc.cr) });
  } catch (err) {
    captureException(err, { where: "legalReadiness: answer" });
    res.status(500).json({ error: "Couldn't save your answer." });
  }
});

// PUT /:careRecipientId/agents/:item — { userId } (a care team member) or { name }, or {} to clear.
// v1.111.2 — Pete, 10/12: "IP should know that Sara Huber is the Durable POA." Owner or leader.
router.put("/:careRecipientId/agents/:item", authenticate, blockWhileImpersonating("record who a legal document names"), async (req, res) => {
  try {
    const kind = AGENT_KIND[req.params.item];
    if (!kind) return res.status(400).json({ error: "This item doesn't name an agent." });
    const db = await getDb();
    const acc = await familyAccess(db, req.params.careRecipientId, req.user.id);
    if (acc.status !== 200) return refuse(res, acc.status);
    if (!(await canSetAgent(db, acc.cr, req.user.id))) {
      return res.status(403).json({ error: "Only the care team leader can record who the document names." });
    }
    const userId = req.body?.userId || null;
    const typed = String(req.body?.name || "").trim().slice(0, 120);
    let agentName = typed;
    if (userId) {
      const c = (await agentCandidates(db, acc.cr.id)).find((x) => x.userId === userId);
      if (!c) return res.status(400).json({ error: "Choose someone on the care team, or type the name." });
      agentName = c.name;
    }
    if (!userId && !agentName) {
      await db.prepare("DELETE FROM recipient_authorities WHERE care_recipient_id = ? AND kind = ?").run(acc.cr.id, kind);
    } else {
      const items0 = await readinessFor(db, acc.cr);
      const docId = items0.find((i) => i.key === req.params.item)?.documentId || null;
      await db.prepare(`
        INSERT INTO recipient_authorities (care_recipient_id, kind, user_id, agent_name, document_id, set_by, set_at)
        VALUES (?, ?, ?, ?, ?, ?, NOW())
        ON CONFLICT (care_recipient_id, kind) DO UPDATE SET user_id = EXCLUDED.user_id, agent_name = EXCLUDED.agent_name,
          document_id = EXCLUDED.document_id, set_by = EXCLUDED.set_by, set_at = NOW()
      `).run(acc.cr.id, kind, userId, agentName, docId, req.user.id);
    }
    try {
      await db.prepare(`
        INSERT INTO consent_audit_log (id, care_recipient_id, actor_id, actor_role, event_type, description, metadata)
        VALUES (?, ?, ?, 'family', 'authority_recorded', ?, ?)
      `).run(uuid(), acc.cr.id, req.user.id,
        agentName ? `Recorded ${agentName} as ${kind === "financial_poa" ? "agent under the durable power of attorney" : "healthcare agent"}` : `Cleared the ${kind.replace(/_/g, " ")}`,
        JSON.stringify({ kind, userId }));
    } catch (e) { captureException(e, { where: "legalReadiness: authority audit" }); }
    res.json({ items: await readinessFor(db, acc.cr) });
  } catch (err) {
    captureException(err, { where: "legalReadiness: agent" });
    res.status(500).json({ error: "Couldn't save that." });
  }
});

// GET /:careRecipientId/resources — up to three per kind, local → statewide → national.
router.get("/:careRecipientId/resources", authenticate, async (req, res) => {
  try {
    const db = await getDb();
    const acc = await familyAccess(db, req.params.careRecipientId, req.user.id);
    if (acc.status !== 200) return refuse(res, acc.status);
    const cr = await db.prepare("SELECT id, location_city, location_state, location_zip FROM care_recipients WHERE id = ?").get(acc.cr.id);
    res.json({ ...(await directoryFor(db, cr)), disclaimer: DISCLAIMER });
  } catch (err) {
    captureException(err, { where: "legalReadiness: resources" });
    res.status(500).json({ error: "Couldn't load local resources." });
  }
});

// POST /:careRecipientId/concerns — "Worried about a scam or someone taking advantage?"
router.post("/:careRecipientId/concerns", authenticate, blockWhileImpersonating("report a money concern"), async (req, res) => {
  try {
    const description = String(req.body?.description || "").trim();
    if (description.length < 5) return res.status(400).json({ error: "Tell us a little about what you noticed." });
    if (description.length > 2000) return res.status(400).json({ error: "Please keep it under 2,000 characters." });
    const db = await getDb();
    const acc = await familyAccess(db, req.params.careRecipientId, req.user.id);
    if (acc.status !== 200) return refuse(res, acc.status);
    const id = uuid();
    await db.prepare(`
      INSERT INTO financial_concerns (id, care_recipient_id, reported_by, source, description, status, created_at)
      VALUES (?, ?, ?, 'family_report', ?, 'open', NOW())
    `).run(id, acc.cr.id, req.user.id, description);

    // Admins: a feed row (durable) and a push/email (best effort). Neither carries the
    // description — it is read inside Admin, not on a lock screen or in an inbox preview.
    try {
      const admins = await db.prepare("SELECT id FROM users WHERE is_admin = 1 AND COALESCE(is_demo, 0) = 0").all();
      for (const a of admins) {
        await db.prepare(
          "INSERT INTO activity_feed (id, family_user_id, care_recipient_id, event_type, title, message, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)"
        ).run(uuid(), a.id, acc.cr.id, "financial_concern_reported", "A family raised a money-safety concern", "Open Admin → Local Help to review.", JSON.stringify({ concernId: id }));
      }
    } catch (e) { captureException(e, { where: "legalReadiness: admin feed" }); }
    try {
      push.notifyAdmins("financial_concern_reported", {
        title: "A family raised a money-safety concern",
        body: "Open Admin → Local Help in InPlace to review.",
        data: { type: "financial_concern_reported", page: "admin" },
      });
    } catch (e) { captureException(e, { where: "legalReadiness: notifyAdmins" }); }

    const cr = await db.prepare("SELECT id, location_city, location_state, location_zip FROM care_recipients WHERE id = ?").get(acc.cr.id);
    res.status(201).json({
      concern: { id, status: "open" },
      steps: CONCERN_STEPS,
      directory: await directoryFor(db, cr),
      disclaimer: DISCLAIMER,
    });
  } catch (err) {
    captureException(err, { where: "legalReadiness: report concern" });
    res.status(500).json({ error: "Couldn't send that. Please try again." });
  }
});

// ═══════════════════════════════════════════════════════════
// Admin routes — /api/admin/legal-readiness (behind the /api/admin network gate in prod)
// ═══════════════════════════════════════════════════════════
adminRouter.use(authenticate, checkAdmin, requireAdmin);

const cleanResource = (b = {}) => ({
  kind: b.kind,
  name: String(b.name || "").trim(),
  phone: b.phone ? String(b.phone).trim().slice(0, 40) : null,
  url: b.url ? String(b.url).trim().slice(0, 500) : null,
  region_key: String(b.region_key || "VA").trim().slice(0, 300) || "VA",
  notes: b.notes ? String(b.notes).trim().slice(0, 1000) : null,
});
function resourceError(r) {
  if (!KINDS.includes(r.kind)) return `kind must be one of: ${KINDS.join(", ")}`;
  if (!r.name) return "name is required";
  if (r.url && !/^https:\/\//i.test(r.url)) return "url must start with https://";
  return null;
}

adminRouter.get("/resources", async (req, res) => {
  try {
    const db = await getDb();
    const rows = await db.prepare("SELECT * FROM local_resources ORDER BY is_active DESC, kind, name").all();
    res.json({ resources: rows, kinds: KINDS, footer: DIRECTORY_FOOTER });
  } catch (err) {
    captureException(err, { where: "legalReadiness admin: list resources" });
    res.status(500).json({ error: "Failed to load resources" });
  }
});

adminRouter.post("/resources", async (req, res) => {
  try {
    const r = cleanResource(req.body);
    const bad = resourceError(r);
    if (bad) return res.status(400).json({ error: bad });
    const db = await getDb();
    const id = uuid();
    await db.prepare(`
      INSERT INTO local_resources (id, kind, name, phone, url, region_key, notes, is_active, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, NOW(), NOW())
    `).run(id, r.kind, r.name, r.phone, r.url, r.region_key, r.notes, req.user.id);
    res.status(201).json({ resource: await db.prepare("SELECT * FROM local_resources WHERE id = ?").get(id) });
  } catch (err) {
    captureException(err, { where: "legalReadiness admin: create resource" });
    res.status(500).json({ error: "Failed to add resource" });
  }
});

adminRouter.put("/resources/:id", async (req, res) => {
  try {
    const db = await getDb();
    const existing = await db.prepare("SELECT * FROM local_resources WHERE id = ?").get(req.params.id);
    if (!existing) return res.status(404).json({ error: "Not found" });
    const r = cleanResource({ ...existing, ...req.body });
    const bad = resourceError(r);
    if (bad) return res.status(400).json({ error: bad });
    const isActive = req.body?.is_active === undefined ? existing.is_active : (req.body.is_active ? 1 : 0);
    await db.prepare(`
      UPDATE local_resources SET kind = ?, name = ?, phone = ?, url = ?, region_key = ?, notes = ?, is_active = ?, updated_at = NOW()
      WHERE id = ?
    `).run(r.kind, r.name, r.phone, r.url, r.region_key, r.notes, isActive, existing.id);
    res.json({ resource: await db.prepare("SELECT * FROM local_resources WHERE id = ?").get(existing.id) });
  } catch (err) {
    captureException(err, { where: "legalReadiness admin: update resource" });
    res.status(500).json({ error: "Failed to update resource" });
  }
});

// DELETE is a soft delete — hide the listing, keep the record of who added it.
adminRouter.delete("/resources/:id", async (req, res) => {
  try {
    const db = await getDb();
    const existing = await db.prepare("SELECT id, is_active FROM local_resources WHERE id = ?").get(req.params.id);
    if (!existing) return res.status(404).json({ error: "Not found" });
    if (!existing.is_active) return res.status(409).json({ error: "Already hidden." });
    await db.prepare("UPDATE local_resources SET is_active = 0, updated_at = NOW() WHERE id = ?").run(existing.id);
    res.json({ ok: true });
  } catch (err) {
    captureException(err, { where: "legalReadiness admin: hide resource" });
    res.status(500).json({ error: "Failed to hide resource" });
  }
});

adminRouter.get("/concerns", async (req, res) => {
  try {
    const db = await getDb();
    const rows = await db.prepare(`
      SELECT fc.id, fc.care_recipient_id, fc.source, fc.safety_flag_id, fc.description, fc.status,
             fc.admin_notes, fc.shared_at, fc.acknowledged_at, fc.created_at, fc.reviewed_at,
             cr.first_name AS recipient_first, cr.last_name AS recipient_last,
             ru.first_name AS reporter_first, ru.last_name AS reporter_last, ru.email AS reporter_email,
             su.first_name AS shared_first, su.last_name AS shared_last
      FROM financial_concerns fc
      JOIN care_recipients cr ON cr.id = fc.care_recipient_id
      LEFT JOIN users ru ON ru.id = fc.reported_by
      LEFT JOIN users su ON su.id = fc.shared_with_user_id
      ORDER BY (fc.status = 'open') DESC, fc.created_at DESC
      LIMIT 100
    `).all();
    res.json({ concerns: rows });
  } catch (err) {
    captureException(err, { where: "legalReadiness admin: list concerns" });
    res.status(500).json({ error: "Failed to load concerns" });
  }
});

const CONCERN_STATUSES = ["open", "reviewed", "closed"];
adminRouter.put("/concerns/:id", async (req, res) => {
  try {
    const { status, admin_notes } = req.body || {};
    if (!CONCERN_STATUSES.includes(status)) return res.status(400).json({ error: `status must be one of: ${CONCERN_STATUSES.join(", ")}` });
    const db = await getDb();
    const c = await db.prepare("SELECT id, status FROM financial_concerns WHERE id = ?").get(req.params.id);
    if (!c) return res.status(404).json({ error: "Not found" });
    if (c.status === status && admin_notes === undefined) return res.status(409).json({ error: `Already ${status}.`, alreadyAnswered: true });
    await db.prepare(`
      UPDATE financial_concerns SET status = ?, admin_notes = COALESCE(?, admin_notes), reviewed_by = ?, reviewed_at = NOW() WHERE id = ?
    `).run(status, admin_notes === undefined ? null : String(admin_notes).slice(0, 2000), req.user.id, c.id);
    res.json({ ok: true });
  } catch (err) {
    captureException(err, { where: "legalReadiness admin: update concern" });
    res.status(500).json({ error: "Failed to update concern" });
  }
});

// GET /safety-flags/:flagId/recipients — which care recipients could this flag be about?
// The flag names a message author and a conversation, never a care recipient, so the admin
// picks. Candidates: every recipient the author or any conversation member is connected to.
adminRouter.get("/safety-flags/:flagId/recipients", async (req, res) => {
  try {
    const db = await getDb();
    const flag = await db.prepare("SELECT id, user_id, flag_type, conversation_id FROM safety_flags WHERE id = ?").get(req.params.flagId);
    if (!flag) return res.status(404).json({ error: "Not found" });
    const people = new Set([flag.user_id]);
    if (flag.conversation_id) {
      const members = await db.prepare("SELECT user_id FROM conversation_members WHERE conversation_id = ?").all(flag.conversation_id);
      members.forEach((m) => people.add(m.user_id));
    }
    const ids = [...people];
    const ph = ids.map(() => "?").join(",");
    const rows = await db.prepare(`
      SELECT DISTINCT cr.id, cr.first_name, cr.last_name FROM care_recipients cr
      WHERE cr.family_user_id IN (${ph}) OR (cr.linked_user_id IN (${ph}) AND ${TRUSTED_LINK_SQL})
         OR cr.id IN (SELECT ct.care_recipient_id FROM care_teams ct JOIN care_team_members ctm ON ctm.care_team_id = ct.id WHERE ctm.user_id IN (${ph}))
         OR cr.id IN (SELECT cs.care_recipient_id FROM care_sessions cs JOIN caregiver_profiles cp ON cp.id = cs.caregiver_id WHERE cp.user_id IN (${ph}))
      ORDER BY cr.first_name
      LIMIT 25
    `).all(...ids, ...ids, ...ids, ...ids);
    const shared = await db.prepare("SELECT care_recipient_id FROM financial_concerns WHERE safety_flag_id = ?").all(flag.id);
    const sharedSet = new Set(shared.map((s) => s.care_recipient_id));
    res.json({
      flagType: flag.flag_type,
      shareable: flag.flag_type === "exploitation_signal",
      recipients: rows.map((r) => ({ id: r.id, name: [r.first_name, r.last_name].filter(Boolean).join(" "), alreadyShared: sharedSet.has(r.id) })),
    });
  } catch (err) {
    captureException(err, { where: "legalReadiness admin: flag recipients" });
    res.status(500).json({ error: "Failed to load care recipients" });
  }
});

// POST /safety-flags/:flagId/share — { careRecipientId } — "Share financial-safety resources
// with the family." Creates the concern, addresses it to the leader, and puts a Needs-you item
// in front of them. The family sees resources and next steps, never the flagged message, the
// sender, or the word "flag".
adminRouter.post("/safety-flags/:flagId/share", async (req, res) => {
  try {
    const careRecipientId = req.body?.careRecipientId;
    if (!careRecipientId) return res.status(400).json({ error: "careRecipientId is required" });
    const db = await getDb();
    const flag = await db.prepare("SELECT id, flag_type FROM safety_flags WHERE id = ?").get(req.params.flagId);
    if (!flag) return res.status(404).json({ error: "Flag not found" });
    if (flag.flag_type !== "exploitation_signal") return res.status(422).json({ error: "Only financial-exploitation flags can be shared this way." });
    const cr = await db.prepare("SELECT id FROM care_recipients WHERE id = ?").get(careRecipientId);
    if (!cr) return res.status(404).json({ error: "Care recipient not found" });
    const existing = await db.prepare("SELECT id FROM financial_concerns WHERE safety_flag_id = ? AND care_recipient_id = ?").get(flag.id, cr.id);
    if (existing) return res.status(409).json({ error: "Already shared with this family.", alreadyAnswered: true, concernId: existing.id });
    const leaderId = await leaderFor(db, cr.id);
    if (!leaderId) return res.status(422).json({ error: "This care recipient has no family leader to share with." });
    const id = uuid();
    try {
      await db.prepare(`
        INSERT INTO financial_concerns (id, care_recipient_id, reported_by, source, safety_flag_id, status, admin_notes,
          shared_with_user_id, shared_at, reviewed_by, reviewed_at, created_at)
        VALUES (?, ?, ?, 'safety_flag', ?, 'reviewed', ?, ?, NOW(), ?, NOW(), NOW())
      `).run(id, cr.id, req.user.id, flag.id, req.body?.admin_notes ? String(req.body.admin_notes).slice(0, 2000) : null, leaderId, req.user.id);
    } catch (e) {
      if (String(e.code) === "23505") return res.status(409).json({ error: "Already shared with this family.", alreadyAnswered: true });
      throw e;
    }
    // Lock-screen safe: no name, no money words, nothing about the message.
    push.sendPushToUser(leaderId, {
      title: "A note from the InPlace team",
      body: "Tap to open it in InPlace.",
      data: { type: "financial_resources_shared", page: "care-profile", focus: `legalReadiness:${cr.id}` },
    }).catch(() => {});
    res.status(201).json({ concern: { id, sharedWithUserId: leaderId } });
  } catch (err) {
    captureException(err, { where: "legalReadiness admin: share" });
    res.status(500).json({ error: "Failed to share resources" });
  }
});

module.exports = router;
module.exports.adminRouter = adminRouter;
module.exports.localityFor = localityFor;
module.exports.DISCLAIMER = DISCLAIMER;
