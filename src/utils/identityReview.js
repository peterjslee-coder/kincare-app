/**
 * One identity check per person (v1.128.3).
 *
 * Pete, 11/16 (feedback 2cbb633c, d19b081e):
 *   "Why do I get four different notifications for one ID approval. I don't want to approve the
 *    back of somebody's ID. It should be one card with the selfie, the front and back of the ID
 *    and an AI analysis of whether or not these are the same people and whether or not they are
 *    valid documents."
 *   "Why does the document review not link people's IDs to their application. It just shows
 *    unknown recipient uploaded by Ryan Huber … and where's the AI review."
 *
 * What it was: a caregiver's ID arrived as up to FOUR verified_documents rows from two routes —
 * onboarding step 7 (`POST /caregiver-onboarding/documents`: DL_Front, DL_Back, written with no
 * AI at all) and `/verify-id` (the ID photo + a selfie). Document Review listed each row on its
 * own, named only care-recipient owners ("Unknown recipient" for everyone else), and the admin
 * alert counted rows: four "IDs waiting" for one person.
 *
 * What it is now:
 *   • groupPendingIdentity() — pending identity rows grouped by OWNER (owner_type + owner_id:
 *     every route above writes the same owner for one person), named, slotted selfie/front/back.
 *   • analyzeIdentitySet() — ONE model call over the selfie, front and back together, stored in
 *     identity_reviews against the exact set of document ids it looked at. Name, date of birth
 *     and expiry are compared HERE in code, never by the model (src/utils/dateMatch.js).
 *   • reviewIdentityGroup() — one decision writes every row in the set, compare-and-set on the
 *     ids the admin saw, so a photo that arrives after the card was opened is never approved
 *     unseen.
 *
 * Unchanged and still true (src/utils/identityDecision.js): the AI never writes `approved`;
 * below 90% it offers no opinion; only an admin decides.
 */
const { getDb } = require("../models/database");
const { identityDecision, VERDICT } = require("./identityDecision");
const { sameBirthDate, parseDateParts, formatUS } = require("./dateMatch");

const PENDING = ["ai_review", "pending", "ai_flagged"];

const BACK_TYPES = /(^|_)back$/i;
const FRONT_TYPES = /(^|_)front$|^(drivers_license|state_id|passport|ead|permanent_resident_card|id|government_id)$/i;

function slotFor(documentType) {
  const t = String(documentType || "");
  if (t.toLowerCase() === "selfie") return "selfie";
  if (BACK_TYPES.test(t)) return "back";
  if (FRONT_TYPES.test(t)) return "front";
  return "other";
}

function ownerKey(ownerType, ownerId) {
  return `${ownerType}:${ownerId}`;
}

function parseKey(key) {
  const i = String(key || "").indexOf(":");
  if (i <= 0) return null;
  const ownerType = key.slice(0, i);
  const ownerId = key.slice(i + 1);
  if (!["caregiver", "user", "care_recipient"].includes(ownerType) || !ownerId) return null;
  return { ownerType, ownerId };
}

function json(v) {
  if (!v) return null;
  if (typeof v === "object") return v;
  try { return JSON.parse(v); } catch { return null; }
}

/** Sorted, comma-joined ids — the identity of "the set the AI looked at / the admin saw". */
function idSet(ids) {
  return [...new Set(ids.map(String))].sort().join(",");
}

/**
 * Who the documents belong to: name, role, the date of birth they gave at signup.
 * Never throws; unknown fields come back null.
 */
async function ownerFacts(db, ownerType, ownerId) {
  try {
    if (ownerType === "caregiver") {
      const r = await db.prepare(`
        SELECT u.id AS user_id, u.first_name, u.last_name, u.is_demo, cp.date_of_birth
        FROM caregiver_profiles cp LEFT JOIN users u ON u.id = cp.user_id WHERE cp.id = ?
      `).get(ownerId);
      if (r) return { userId: r.user_id, firstName: r.first_name, lastName: r.last_name, role: "Caregiver applicant", dob: r.date_of_birth, isDemo: !!r.is_demo };
    } else if (ownerType === "user") {
      const r = await db.prepare(`SELECT id, first_name, last_name, role, is_demo, date_of_birth FROM users WHERE id = ?`).get(ownerId);
      if (r) return { userId: r.id, firstName: r.first_name, lastName: r.last_name, role: r.role === "caregiver" ? "Caregiver" : r.role === "care_for" ? "Receives care" : "Family member", dob: r.date_of_birth, isDemo: !!r.is_demo };
    } else if (ownerType === "care_recipient") {
      // A care recipient is demo when the account that owns the record is.
      const r = await db.prepare(`
        SELECT cr.first_name, cr.last_name, cr.called_by, cr.date_of_birth, fu.is_demo
        FROM care_recipients cr LEFT JOIN users fu ON fu.id = cr.family_user_id WHERE cr.id = ?
      `).get(ownerId);
      if (r) return { userId: null, firstName: r.first_name, lastName: r.last_name, role: "Receives care", dob: r.date_of_birth, isDemo: !!r.is_demo };
    }
  } catch (e) { /* fall through to unknown */ }
  return { userId: null, firstName: null, lastName: null, role: null, dob: null, isDemo: false };
}

/** Every pending identity row, grouped one card per owner. No file data is read. */
async function groupPendingIdentity(db) {
  const rows = await db.prepare(`
    SELECT vd.id, vd.owner_type, vd.owner_id, vd.uploaded_by, vd.document_type, vd.status,
           vd.mime_type, vd.file_name, vd.file_size, vd.created_at,
           vd.ai_classification, vd.ai_recommendation, vd.ai_recommendation_reason, vd.ai_confidence
    FROM verified_documents vd
    WHERE vd.category = 'identity' AND vd.status IN ('ai_review', 'pending', 'ai_flagged') -- identity-read-ok: admin review queue, not a verdict
    ORDER BY vd.created_at ASC
  `).all();

  const groups = new Map();
  for (const r of rows) {
    const key = ownerKey(r.owner_type, r.owner_id);
    if (!groups.has(key)) groups.set(key, { key, ownerType: r.owner_type, ownerId: String(r.owner_id), docs: [] });
    groups.get(key).docs.push(r);
  }

  const keys = [...groups.keys()];
  const stored = new Map();
  if (keys.length) {
    const saved = await db.prepare(
      `SELECT owner_key, doc_ids, analysis, created_at FROM identity_reviews WHERE owner_key IN (${keys.map(() => "?").join(",")})`
    ).all(...keys).catch(() => []);
    for (const s of saved) stored.set(s.owner_key, s);
  }

  const out = [];
  for (const g of groups.values()) {
    const facts = await ownerFacts(db, g.ownerType, g.ownerId);
    const docs = g.docs.map((d) => ({
      id: d.id, documentType: d.document_type, slot: slotFor(d.document_type), status: d.status,
      mimeType: d.mime_type, fileName: d.file_name, fileSize: d.file_size, createdAt: d.created_at,
    }));
    // The newest of each slot is the one shown large; older ones are still listed and still
    // decided together (nothing in the set is left pending behind the card).
    const pick = (slot) => [...docs].reverse().find((d) => d.slot === slot) || null;
    const ids = idSet(docs.map((d) => d.id));
    const saved = stored.get(g.key);
    const analysis = saved ? json(saved.analysis) : null;

    out.push({
      key: g.key,
      ownerType: g.ownerType,
      personUserId: facts.userId,
      personName: [facts.firstName, facts.lastName].filter(Boolean).join(" ") || null,
      role: facts.role,
      submittedAt: docs.length ? docs[docs.length - 1].createdAt : null,
      selfie: pick("selfie"),
      front: pick("front"),
      back: pick("back"),
      docs,
      docIds: docs.map((d) => d.id),
      analysis,
      // The analysis is only about the photos it looked at. A new upload since then makes it stale.
      analysisCurrent: !!(analysis && saved.doc_ids === ids),
      analyzedAt: saved ? saved.created_at : null,
      isDemo: facts.isDemo,
    });
  }
  // Newest submission first.
  out.sort((a, b) => String(b.submittedAt || "").localeCompare(String(a.submittedAt || "")));
  return out;
}

/** How many PEOPLE are waiting (the admin alert counted photos). */
async function countPendingPeople(db) {
  const row = await db.prepare(`
    SELECT COUNT(DISTINCT owner_type || ':' || owner_id::text) AS count FROM verified_documents
    WHERE category = 'identity' AND status IN ('ai_review', 'pending', 'ai_flagged') -- identity-read-ok: admin queue count, people not photos
  `).get();
  return Number(row && row.count) || 0;
}

// ─── The model call ───

const ANALYSIS_PROMPT = `You review identity photos for InPlace, a care-coordination service. A person sent some of: a live selfie, the FRONT of a government photo ID, and the BACK of that ID. Look at all of them together.

Answer only what the photos show. Do not compare names or dates with anything; just read them off the ID as printed. REAL ID compliance does not matter here: never mention it.

Respond with ONLY a JSON object (no markdown):
{
  "samePerson": { "answer": "yes" | "no" | "unsure" | "no_selfie", "confidence": 0.0-1.0, "why": "short reason" },
  "document": { "type": "drivers_license" | "state_id" | "passport" | "ead" | "permanent_resident_card" | "other_id" | "not_an_id", "issuer": "e.g. Virginia", "looksGenuine": "yes" | "no" | "unsure", "confidence": 0.0-1.0, "why": "short reason" },
  "frontBack": { "answer": "yes" | "no" | "unsure" | "no_back", "why": "do the front and back belong to the same card (number, name, layout)?" },
  "editing": { "answer": "none_seen" | "signs_of_editing" | "unsure", "why": "short reason" },
  "readFromId": { "name": "", "dateOfBirth": "MM/DD/YYYY as printed", "expirationDate": "MM/DD/YYYY as printed" },
  "concerns": ["anything else a reviewer should look at; empty if nothing"],
  "summary": "one plain sentence"
}`;

async function loadImage(db, docId) {
  const row = await db.prepare("SELECT file_data, mime_type FROM verified_documents WHERE id = ?").get(docId);
  if (!row || !row.file_data) return null;
  const { resolveFileData } = require("./storage");
  const data = await resolveFileData(row.file_data);
  if (!data || typeof data !== "string") return null;
  const m = data.match(/^data:([^;]+);base64,(.*)$/s);
  if (!m) return null;
  const mime = m[1];
  if (!/^image\/(jpeg|png|gif|webp)$/.test(mime)) return { unsupported: mime };
  return { mime, base64: m[2] };
}

function nameMatches(registeredFirst, registeredLast, idName) {
  const last = String(registeredLast || "").toLowerCase().trim();
  const read = String(idName || "").toLowerCase();
  if (!last || !read) return null;
  return read.includes(last);
}

/**
 * The checks the card shows, in the order it shows them. state: pass | fail | unknown.
 * Pure — exported for tests.
 */
function buildChecks(model, facts, has, today = new Date()) {
  const checks = [];
  const sp = model.samePerson || {};
  checks.push({
    key: "samePerson", label: "Same person",
    state: !has.selfie || sp.answer === "no_selfie" ? "unknown" : sp.answer === "yes" ? "pass" : sp.answer === "no" ? "fail" : "unknown",
    detail: !has.selfie ? "No selfie was sent" : `${sp.why || ""}${typeof sp.confidence === "number" ? ` (${Math.round(sp.confidence * 100)}%)` : ""}`.trim(),
  });
  const doc = model.document || {};
  const type = String(doc.type || "").replace(/_/g, " ");
  checks.push({
    key: "document", label: "Valid document",
    state: doc.type === "not_an_id" || doc.looksGenuine === "no" ? "fail" : doc.looksGenuine === "yes" ? "pass" : "unknown",
    detail: [doc.issuer, type].filter(Boolean).join(" ") + (doc.why ? ` — ${doc.why}` : ""),
  });
  const read = model.readFromId || {};
  const nm = nameMatches(facts.firstName, facts.lastName, read.name);
  const registered = [facts.firstName, facts.lastName].filter(Boolean).join(" ");
  checks.push({
    key: "name", label: "Name",
    state: nm === true ? "pass" : nm === false ? "fail" : "unknown",
    detail: nm === null ? `Couldn't read a name to compare${registered ? ` with ${registered}` : ""}` : nm ? `"${read.name}" matches the account` : `ID says "${read.name}", account says "${registered}"`,
  });
  const dob = facts.dob ? sameBirthDate(facts.dob, read.dateOfBirth) : null;
  checks.push({
    key: "dob", label: "Date of birth",
    state: dob === true ? "pass" : dob === false ? "fail" : "unknown",
    detail: dob === true ? `${formatUS(read.dateOfBirth)} on the ID = ${formatUS(facts.dob)} at signup`
      : dob === false ? `ID shows ${formatUS(read.dateOfBirth)}, signup has ${formatUS(facts.dob)}`
      : !facts.dob ? "No date of birth on the account to compare" : `Couldn't read a date of birth on the ID`,
  });
  const exp = parseDateParts(read.expirationDate);
  let expState = "unknown";
  let expDetail = "Couldn't read an expiration date";
  if (exp && exp.y >= 1000) {
    const t = { y: today.getFullYear(), m: today.getMonth() + 1, d: today.getDate() };
    const expired = exp.y < t.y || (exp.y === t.y && (exp.m < t.m || (exp.m === t.m && exp.d < t.d)));
    expState = expired ? "fail" : "pass";
    expDetail = expired ? `Expired ${formatUS(read.expirationDate)}` : `Not expired (${formatUS(read.expirationDate)})`;
  }
  checks.push({ key: "expiry", label: "Not expired", state: expState, detail: expDetail });
  const fb = model.frontBack || {};
  checks.push({
    key: "frontBack", label: "Front and back match",
    state: !has.back || fb.answer === "no_back" ? "unknown" : fb.answer === "yes" ? "pass" : fb.answer === "no" ? "fail" : "unknown",
    detail: !has.back ? "No back of the ID was sent" : fb.why || "",
  });
  const ed = model.editing || {};
  checks.push({
    key: "editing", label: "No signs of editing",
    state: ed.answer === "none_seen" ? "pass" : ed.answer === "signs_of_editing" ? "fail" : "unknown",
    detail: ed.why || "",
  });
  return checks;
}

/** What the AI may suggest from those checks. Same 90% rule as every identity decision. */
function suggestionFrom(checks, model, has) {
  const failed = checks.filter((c) => c.state === "fail");
  const unknown = checks.filter((c) => c.state === "unknown");
  const decision = identityDecision({
    looksRight: failed.length === 0,
    docConfidence: model.document && model.document.confidence,
    faceConfidence: model.samePerson && model.samePerson.confidence,
    faceSkipped: !has.selfie,
  });
  // Something it could not confirm is not a pass, and not a reason to reject: no opinion.
  if (failed.length === 0 && unknown.length > 0) {
    return { verdict: VERDICT.ABSTAIN, confidence: decision.confidence, reason: `Couldn't confirm: ${unknown.map((c) => c.label.toLowerCase()).join(", ")}.` };
  }
  return { verdict: decision.verdict, confidence: decision.confidence, reason: failed.length ? `Doesn't match: ${failed.map((c) => c.label.toLowerCase()).join(", ")}.` : decision.reason };
}

/**
 * Run (or re-run) the one analysis for an owner's pending identity photos and store it.
 * @returns {object|null} the stored analysis, or null when there is nothing to analyze.
 */
async function analyzeIdentitySet(ownerKeyValue, { db: dbIn } = {}) {
  const parsed = parseKey(ownerKeyValue);
  if (!parsed) return null;
  const db = dbIn || (await getDb());
  const all = await groupPendingIdentity(db);
  const g = all.find((x) => x.key === ownerKeyValue);
  if (!g) return null;
  const facts = await ownerFacts(db, g.ownerType, g.ownerId);
  const has = { selfie: !!g.selfie, front: !!g.front, back: !!g.back };
  const docIds = idSet(g.docIds);

  let model = null;
  let error = null;
  if (facts.isDemo) {
    error = "Demo account — no AI analysis";
  } else if (!process.env.ANTHROPIC_API_KEY) {
    error = "AI analysis unavailable on this server";
  } else if (!g.front) {
    error = "No photo of the front of an ID yet";
  } else {
    const parts = [];
    const add = async (doc, label) => {
      if (!doc) return;
      const img = await loadImage(db, doc.id);
      if (img && img.base64) {
        parts.push({ type: "image", source: { type: "base64", media_type: img.mime, data: img.base64 } });
        parts.push({ type: "text", text: `The image above is the ${label}.` });
      }
    };
    await add(g.selfie, "SELFIE");
    await add(g.front, "FRONT of the ID");
    await add(g.back, "BACK of the ID");
    if (!parts.length) {
      error = "Couldn't open the photos";
    } else {
      try {
        const { MODEL_SONNET, getAnthropic } = require("./aiModels");
        const client = getAnthropic(process.env.ANTHROPIC_API_KEY);
        const resp = await client.messages.create({
          model: MODEL_SONNET, max_tokens: 1200, system: ANALYSIS_PROMPT,
          messages: [{ role: "user", content: [...parts, { type: "text", text: "Review these together and answer in the JSON shape." }] }],
        });
        const text = resp.content.filter((b) => b.type === "text").map((b) => b.text).join("");
        model = JSON.parse(text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim());
      } catch (e) {
        error = `AI analysis failed: ${e.message}`;
      }
    }
  }

  const { isRealIdNoise } = require("./documentAI");
  let analysis;
  if (model) {
    const checks = buildChecks(model, facts, has);
    const suggestion = suggestionFrom(checks, model, has);
    analysis = {
      ok: true, checks, suggestion,
      summary: model.summary || "",
      concerns: (Array.isArray(model.concerns) ? model.concerns : []).filter((c) => c && !isRealIdNoise(c)),
      readFromId: model.readFromId || {},
      looked: has,
    };
  } else {
    analysis = { ok: false, error, looked: has, suggestion: { verdict: VERDICT.ABSTAIN, confidence: 0, reason: error } };
  }

  await db.prepare(`
    INSERT INTO identity_reviews (owner_key, doc_ids, analysis, created_at) VALUES (?, ?, ?, NOW())
    ON CONFLICT (owner_key) DO UPDATE SET doc_ids = EXCLUDED.doc_ids, analysis = EXCLUDED.analysis, created_at = NOW()
  `).run(ownerKeyValue, docIds, JSON.stringify(analysis));
  return analysis;
}

// Uploads for one person arrive in bursts (front, back, then ID + selfie). Coalesce them so the
// model runs once on the full set rather than once per photo. In-process: one replica (CLAUDE.md).
const timers = new Map();
const DEBOUNCE_MS = 15000;

function scheduleIdentityAnalysis(ownerType, ownerId, delayMs = DEBOUNCE_MS) {
  if (!ownerType || !ownerId) return;
  const key = ownerKey(ownerType, ownerId);
  if (timers.has(key)) clearTimeout(timers.get(key));
  const t = setTimeout(() => {
    timers.delete(key);
    analyzeIdentitySet(key).catch((e) => console.error("[identityReview] analysis failed:", e.message));
  }, delayMs);
  if (t.unref) t.unref();
  timers.set(key, t);
}

/**
 * One decision for the whole set. `docIds` are the ids the admin was shown; if the pending set
 * has changed since, nothing is written and `stale` comes back.
 */
async function reviewIdentityGroup(db, { key, docIds, action, notes, adminId }) {
  const parsed = parseKey(key);
  if (!parsed) return { error: "bad_key" };
  if (!["approve", "reject", "request_new"].includes(action)) return { error: "bad_action" };
  const want = idSet(docIds || []);
  let result = null;
  await db.transaction(async (tx) => {
    const rows = await tx.prepare(`
      SELECT id, status, document_type, owner_type, owner_id, uploaded_by FROM verified_documents
      WHERE owner_type = ? AND owner_id::text = ? AND category = 'identity' AND status IN ('ai_review', 'pending', 'ai_flagged') -- identity-read-ok: the set an admin is deciding
      FOR UPDATE
    `).all(parsed.ownerType, parsed.ownerId);
    if (!rows.length) { result = { error: "nothing_pending" }; return; }
    if (idSet(rows.map((r) => r.id)) !== want) { result = { error: "stale", currentIds: rows.map((r) => r.id) }; return; }
    const newStatus = action === "approve" ? "approved" : "rejected";
    const note = action === "request_new" ? `Asked for a new photo${notes ? `: ${notes}` : ""}` : (notes || null);
    for (const r of rows) {
      await tx.prepare(`
        UPDATE verified_documents SET status = ?, admin_reviewed_by = ?, admin_reviewed_at = NOW(), admin_notes = ?,
          is_verified = ?, verified_at = ${action === "approve" ? "NOW()" : "NULL"}, updated_at = NOW()
        WHERE id = ?
      `).run(newStatus, adminId, note, action === "approve" ? 1 : 0, r.id);
    }
    result = { ok: true, status: newStatus, count: rows.length, sample: rows.find((r) => r.document_type !== "selfie") || rows[0] };
  });
  return result;
}

module.exports = {
  groupPendingIdentity, countPendingPeople, analyzeIdentitySet, scheduleIdentityAnalysis,
  reviewIdentityGroup, buildChecks, suggestionFrom, slotFor, ownerKey, parseKey, idSet,
};
