// ─── /api/medical-records — Documents Center Phase 1 ───
//
// Medical records are verified_documents rows with category='medical', owner_type=
// 'care_recipient'. They are STORED, not verified: no admin queue, no documentAI, no admin
// read. Upload goes through the existing multipart route (POST /api/documents/upload with
// category=medical); everything else a medical record needs lives here.
//
// Access — utils/medicalAccess.js, and nowhere else:
//   member (linked account) · leader/owner · family members the leader allows one by one.
//   Caregivers never. Admins never by default.
// Step-up — utils/medicalStepUp.js: open/download needs a passkey within ~10 min; changing the
//   iPAi key needs a passkey assertion every time. No passkey → clear error, no bypass.
// Impersonation — reads of record CONTENT (open, download, suggestions) are refused, and every
//   write is refused at the door (middleware/auth.js) and again here.
// Audit — every upload/open/download/delete/grant/revoke/consent change/AI read is written to
//   medical_record_audit and shown to the key holder and leader.
const express = require("express");
const { v4: uuid } = require("uuid");
const { getDb } = require("../models/database");
const { authenticate } = require("../middleware/auth");
const { blockWhileImpersonating, isImpersonating } = require("../middleware/noImpersonation");
const storage = require("../utils/storage");
const {
  medicalRole, aiConsentOn, grantableReason, logMedicalAudit, recipientRow,
  trustedLinkedUserId,
} = require("../utils/medicalAccess");
const stepUp = require("../utils/medicalStepUp");
const { extractSuggestions } = require("../utils/medicalDocAI");
const { eventStartInstant } = require("../utils/careEventUtils");
const { hasAccess, canScheduleEvents } = require("./careTasks")._shared;
const { TRUSTED_LINK_SQL } = require("../utils/medicalAccess"); // stale-link sweep

const router = express.Router();
router.use(authenticate);

const DEFAULT_TZ = "America/New_York";
const AI_ACK_TEXT = "iPAi is not medical care. It can only reflect what's written in this document, and it can be wrong. Check every suggestion against the original.";
const NO_ACCESS = "You don't have access to this person's medical records.";

const nameOf = (u) => (u ? [u.first_name, u.last_name].filter(Boolean).join(" ").trim() || "Someone" : null);
const recipientName = (cr) => cr ? (cr.called_by || [cr.first_name, cr.last_name].filter(Boolean).join(" ").trim() || "your loved one") : "";

async function userName(db, id) {
  if (!id) return null;
  return nameOf(await db.prepare("SELECT first_name, last_name FROM users WHERE id = ?").get(id));
}

function impersonationRefusal(res) {
  return res.status(403).json({
    error: "You're viewing this account as an admin. Medical records can't be opened from Test Mode.",
    code: "IMPERSONATION_BLOCKED",
  });
}

async function requireStepUp(db, req, res) {
  const expiresAt = await stepUp.stepUpExpiresAt(db, req.user);
  if (expiresAt) return true;
  res.status(401).json({ error: "Confirm with your passkey to open medical records.", needsStepUp: true });
  return false;
}

async function medicalDoc(db, careRecipientId, docId) {
  return db.prepare(`
    SELECT id, owner_id, uploaded_by, document_type, file_data, file_name, file_size, mime_type, created_at
    FROM verified_documents
    WHERE id = ? AND category = 'medical' AND owner_type = 'care_recipient' AND owner_id = ?
  `).get(docId, careRecipientId);
}

// ─── GET /recipients — the loved ones this person can open the Documents Center for ───
router.get("/recipients", async (req, res) => {
  try {
    const db = await getDb();
    const rows = await db.prepare(`
      SELECT DISTINCT cr.id, cr.first_name, cr.last_name, cr.called_by
      FROM care_recipients cr
      LEFT JOIN care_teams ct ON ct.care_recipient_id = cr.id
      LEFT JOIN care_team_members ctm ON ctm.care_team_id = ct.id AND ctm.user_id = ?
      WHERE cr.family_user_id = ? OR (cr.linked_user_id = ? AND ${TRUSTED_LINK_SQL}) OR ctm.user_id IS NOT NULL
    `).all(req.user.id, req.user.id, req.user.id);
    const out = [];
    for (const r of rows) {
      const role = await medicalRole(db, r.id, req.user.id);
      out.push({
        id: r.id, name: recipientName(r),
        canViewMedical: role.canView, canManageAccess: role.canManageAccess,
        isLeader: role.isLeader, isMember: role.isMember, isKeyHolder: role.isKeyHolder,
      });
    }
    res.json({ recipients: out });
  } catch (err) {
    console.error("Medical recipients error:", err);
    res.status(500).json({ error: "Failed to load your loved ones" });
  }
});

// ─── POST /step-up/challenge — passkey options for { purpose: 'open' | 'ai_consent' } ───
router.post("/step-up/challenge", blockWhileImpersonating("open medical records"), async (req, res) => {
  try {
    const db = await getDb();
    const purpose = (req.body && req.body.purpose) || "open";
    const r = await stepUp.createChallenge(db, req.user.id, purpose);
    if (r.badPurpose) return res.status(400).json({ error: "Unknown passkey purpose" });
    if (r.needsPasskey) return res.status(403).json({ error: stepUp.NO_PASSKEY_ERROR, needsPasskey: true });
    res.json(r.options);
  } catch (err) {
    console.error("Medical step-up challenge error:", err);
    res.status(500).json({ error: "Couldn't start passkey confirmation" });
  }
});

// ─── POST /step-up/verify — passkey assertion → ~10 minutes to open/download ───
router.post("/step-up/verify", blockWhileImpersonating("open medical records"), async (req, res) => {
  try {
    const db = await getDb();
    const v = await stepUp.verifyAssertion(db, req.user.id, "open", req.body || {});
    if (!v.ok) return res.status(v.status).json({ error: v.error, needsPasskey: !!v.needsPasskey });
    const expiresAt = await stepUp.recordStepUp(db, req.user);
    res.json({ ok: true, expiresAt, minutes: stepUp.STEP_UP_MINUTES });
  } catch (err) {
    console.error("Medical step-up verify error:", err);
    res.status(500).json({ error: "Passkey confirmation failed" });
  }
});

// ─── GET /:crId — titles + metadata (normal sign-in), key state, sharing list for the leader ───
router.get("/:crId", async (req, res) => {
  try {
    const db = await getDb();
    const crId = req.params.crId;
    const role = await medicalRole(db, crId, req.user.id);
    if (!role.exists) return res.status(404).json({ error: "Not found" });
    if (!role.canView) return res.status(403).json({ error: NO_ACCESS });
    const cr = await recipientRow(db, crId);

    const docs = await db.prepare(`
      SELECT vd.id, vd.document_type, vd.file_name, vd.file_size, vd.mime_type, vd.created_at, vd.uploaded_by,
        u.first_name AS uploader_first, u.last_name AS uploader_last
      FROM verified_documents vd LEFT JOIN users u ON u.id = vd.uploaded_by
      WHERE vd.category = 'medical' AND vd.owner_type = 'care_recipient' AND vd.owner_id = ?
      ORDER BY vd.created_at DESC
    `).all(crId);

    const consentRow = await db.prepare(
      "SELECT granted, decided_by, decided_at, method FROM medical_ai_consent WHERE care_recipient_id = ?"
    ).get(crId);
    const pending = await db.prepare(
      "SELECT COUNT(*) AS n FROM medical_doc_suggestions WHERE care_recipient_id = ? AND status = 'pending'"
    ).get(crId);

    let sharing = null;
    if (role.canManageAccess) {
      const members = await db.prepare(`
        SELECT DISTINCT u.id, u.first_name, u.last_name, ctm.role,
          mra.granted_at
        FROM care_team_members ctm
        JOIN care_teams ct ON ct.id = ctm.care_team_id
        JOIN users u ON u.id = ctm.user_id
        LEFT JOIN medical_record_access mra ON mra.care_recipient_id = ct.care_recipient_id AND mra.user_id = u.id
        WHERE ct.care_recipient_id = ?
      `).all(crId);
      sharing = [];
      for (const m of members) {
        const reason = await grantableReason(db, crId, m.id);
        sharing.push({
          userId: m.id, name: nameOf(m),
          status: reason === "caregiver" ? "caregiver" : reason === "already" ? "always" : (m.granted_at ? "allowed" : "not_allowed"),
          grantedAt: m.granted_at || null,
        });
      }
    }

    const linkedId = await trustedLinkedUserId(db, cr); // v1.111.2 — a stale link is not her
    res.json({
      recipient: { id: crId, name: recipientName(cr), hasOwnAccount: !!linkedId },
      me: {
        canManageAccess: role.canManageAccess, isLeader: role.isLeader, isMember: role.isMember,
        isKeyHolder: role.isKeyHolder, canSeeAudit: role.isKeyHolder || role.isLeader || role.isMember,
        stepUpExpiresAt: await stepUp.stepUpExpiresAt(db, req.user),
      },
      aiKey: {
        on: !!(consentRow && Number(consentRow.granted) === 1),
        holderId: role.keyHolderId,
        holderName: await userName(db, role.keyHolderId),
        holderIsMember: !!linkedId && linkedId === role.keyHolderId,
        decidedBy: consentRow ? await userName(db, consentRow.decided_by) : null,
        decidedAt: consentRow ? consentRow.decided_at : null,
      },
      documents: docs.map((d) => ({
        id: d.id, documentType: d.document_type, fileName: d.file_name, fileSize: d.file_size,
        mimeType: d.mime_type, createdAt: d.created_at,
        uploadedBy: nameOf({ first_name: d.uploader_first, last_name: d.uploader_last }),
        mine: d.uploaded_by === req.user.id,
      })),
      pendingSuggestions: parseInt(pending && pending.n, 10) || 0,
      sharing,
    });
  } catch (err) {
    console.error("Medical records list error:", err);
    res.status(500).json({ error: "Failed to load medical records" });
  }
});

// ─── GET /:crId/docs/:docId/open — the file itself; ?download=1 for an attachment ───
router.get("/:crId/docs/:docId/open", async (req, res) => {
  try {
    if (isImpersonating(req)) return impersonationRefusal(res);
    const db = await getDb();
    const { crId, docId } = req.params;
    const role = await medicalRole(db, crId, req.user.id);
    if (!role.canView) return res.status(403).json({ error: NO_ACCESS });
    if (!(await requireStepUp(db, req, res))) return;
    const doc = await medicalDoc(db, crId, docId);
    if (!doc) return res.status(404).json({ error: "Document not found" });

    const download = req.query.download === "1";
    const data = await storage.resolveFileData(doc.file_data);
    const buffer = Buffer.from(String(data || "").replace(/^data:[^;]+;base64,/, ""), "base64");
    await logMedicalAudit(db, {
      careRecipientId: crId, documentId: doc.id, actorId: req.user.id,
      eventType: download ? "downloaded" : "viewed",
      detail: { documentType: doc.document_type, fileName: doc.file_name },
    });
    const safeName = String(doc.file_name || "medical-record").replace(/["\r\n]/g, "");
    res.set({
      "Content-Type": doc.mime_type || "application/octet-stream",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${safeName}"`,
      "Content-Length": buffer.length,
      "Cache-Control": "no-store",
    });
    res.send(buffer);
  } catch (err) {
    console.error("Medical record open error:", err);
    res.status(500).json({ error: "Failed to open this record" });
  }
});

// ─── PUT /:crId/access/:userId — the leader allows a family member, one by one ───
router.put("/:crId/access/:userId", blockWhileImpersonating("change who sees medical records"), async (req, res) => {
  try {
    const db = await getDb();
    const { crId, userId } = req.params;
    const role = await medicalRole(db, crId, req.user.id);
    if (!role.exists) return res.status(404).json({ error: "Not found" });
    if (!role.canManageAccess) return res.status(403).json({ error: "Only the care team leader can choose who sees medical records." });
    if (!(await requireStepUp(db, req, res))) return;
    const allowed = !!(req.body && req.body.allowed);
    if (allowed) {
      const reason = await grantableReason(db, crId, userId);
      if (reason === "caregiver") return res.status(400).json({ error: "Caregivers can't be given access to medical records." });
      if (reason === "not_on_team") return res.status(400).json({ error: "Only people on the care team can be given access." });
      if (reason === "already") return res.status(400).json({ error: "This person can already see the records." });
      if (reason) return res.status(404).json({ error: "Not found" });
      await db.prepare(`
        INSERT INTO medical_record_access (care_recipient_id, user_id, granted_by, granted_at)
        VALUES (?, ?, ?, NOW()) ON CONFLICT (care_recipient_id, user_id) DO NOTHING
      `).run(crId, userId, req.user.id);
    } else {
      await db.prepare("DELETE FROM medical_record_access WHERE care_recipient_id = ? AND user_id = ?").run(crId, userId);
    }
    await logMedicalAudit(db, {
      careRecipientId: crId, actorId: req.user.id,
      eventType: allowed ? "access_granted" : "access_revoked",
      detail: { userId, name: await userName(db, userId) },
    });
    res.json({ ok: true, allowed });
  } catch (err) {
    console.error("Medical access change error:", err);
    res.status(500).json({ error: "Failed to change access" });
  }
});

// ─── PUT /:crId/ai-consent — the iPAi key. Key holder only, passkey EVERY time ───
router.put("/:crId/ai-consent", blockWhileImpersonating("change iPAi access"), async (req, res) => {
  try {
    const db = await getDb();
    const crId = req.params.crId;
    const role = await medicalRole(db, crId, req.user.id);
    if (!role.exists) return res.status(404).json({ error: "Not found" });
    if (!role.isKeyHolder) {
      const holder = await userName(db, role.keyHolderId);
      return res.status(403).json({ error: `Only ${holder || "the key holder"} can decide whether iPAi may read these records.` });
    }
    const v = await stepUp.verifyAssertion(db, req.user.id, "ai_consent", req.body || {});
    if (!v.ok) return res.status(v.status).json({ error: v.error, needsPasskey: !!v.needsPasskey, needsStepUp: !!v.needsStepUp });

    const granted = !!(req.body && req.body.granted);
    await db.prepare(`
      INSERT INTO medical_ai_consent (care_recipient_id, granted, decided_by, decided_at, method)
      VALUES (?, ?, ?, NOW(), 'passkey')
      ON CONFLICT (care_recipient_id) DO UPDATE SET granted = EXCLUDED.granted, decided_by = EXCLUDED.decided_by,
        decided_at = NOW(), method = 'passkey'
    `).run(crId, granted ? 1 : 0, req.user.id);
    let cleared = 0;
    if (!granted) {
      // Revoking the key stops future reads AND withdraws what iPAi has already proposed.
      const r = await db.prepare(
        "DELETE FROM medical_doc_suggestions WHERE care_recipient_id = ? AND status = 'pending'"
      ).run(crId);
      cleared = (r && (r.changes || r.rowCount)) || 0;
    }
    await logMedicalAudit(db, {
      careRecipientId: crId, actorId: req.user.id,
      eventType: granted ? "ai_consent_granted" : "ai_consent_revoked",
      detail: granted ? { method: "passkey" } : { method: "passkey", pendingSuggestionsRemoved: cleared },
    });
    res.json({ ok: true, on: granted, pendingSuggestionsRemoved: cleared });
  } catch (err) {
    console.error("Medical AI consent error:", err);
    res.status(500).json({ error: "Failed to change iPAi access" });
  }
});

// ─── GET /:crId/audit — the trail, for the key holder, the leader and the member ───
router.get("/:crId/audit", async (req, res) => {
  try {
    const db = await getDb();
    const crId = req.params.crId;
    const role = await medicalRole(db, crId, req.user.id);
    if (!role.exists) return res.status(404).json({ error: "Not found" });
    if (!(role.isKeyHolder || role.isLeader || role.isMember)) {
      return res.status(403).json({ error: "Only the key holder and the care team leader can see the record trail." });
    }
    const rows = await db.prepare(`
      SELECT a.id, a.document_id, a.event_type, a.detail, a.created_at, a.actor_id,
        u.first_name, u.last_name, vd.document_type, vd.file_name
      FROM medical_record_audit a
      LEFT JOIN users u ON u.id = a.actor_id
      LEFT JOIN verified_documents vd ON vd.id = a.document_id
      WHERE a.care_recipient_id = ?
      ORDER BY a.created_at DESC
      LIMIT 300
    `).all(crId);
    res.json({
      entries: rows.map((r) => {
        let detail = null;
        try { detail = r.detail ? JSON.parse(r.detail) : null; } catch { detail = null; }
        return {
          id: r.id, eventType: r.event_type, createdAt: r.created_at, documentId: r.document_id,
          actor: r.actor_id === "ipai" ? "iPAi" : nameOf(r),
          documentType: r.document_type || (detail && detail.documentType) || null,
          fileName: r.file_name || (detail && detail.fileName) || null,
          detail,
        };
      }),
    });
  } catch (err) {
    console.error("Medical audit error:", err);
    res.status(500).json({ error: "Failed to load the record trail" });
  }
});

// ─── GET /:crId/suggestions — what iPAi quoted from the documents (record content: step-up) ───
router.get("/:crId/suggestions", async (req, res) => {
  try {
    if (isImpersonating(req)) return impersonationRefusal(res);
    const db = await getDb();
    const crId = req.params.crId;
    const role = await medicalRole(db, crId, req.user.id);
    if (!role.canView) return res.status(403).json({ error: NO_ACCESS });
    if (!(await requireStepUp(db, req, res))) return;
    const rows = await db.prepare(`
      SELECT s.id, s.document_id, s.kind, s.title, s.detail, s.source_quote, s.suggested_date, s.status,
        s.created_at, s.decided_at, s.result_ref, vd.file_name, vd.document_type,
        u.first_name, u.last_name
      FROM medical_doc_suggestions s
      LEFT JOIN verified_documents vd ON vd.id = s.document_id
      LEFT JOIN users u ON u.id = s.decided_by
      WHERE s.care_recipient_id = ?
      ORDER BY s.status = 'pending' DESC, s.created_at DESC
      LIMIT 200
    `).all(crId);
    res.json({
      aiOn: await aiConsentOn(db, crId),
      suggestions: rows.map((r) => ({
        id: r.id, documentId: r.document_id, kind: r.kind, title: r.title, detail: r.detail,
        sourceQuote: r.source_quote, suggestedDate: r.suggested_date, status: r.status,
        createdAt: r.created_at, decidedAt: r.decided_at, decidedBy: r.decided_at ? nameOf(r) : null,
        resultRef: r.result_ref, fileName: r.file_name, documentType: r.document_type,
      })),
    });
  } catch (err) {
    console.error("Medical suggestions error:", err);
    res.status(500).json({ error: "Failed to load suggestions" });
  }
});

// ─── POST /:crId/docs/:docId/review — "Review with iPAi" (key ON + acknowledgment + step-up) ───
router.post("/:crId/docs/:docId/review", async (req, res) => {
  try {
    const db = await getDb();
    const { crId, docId } = req.params;
    const role = await medicalRole(db, crId, req.user.id);
    if (!role.canView) return res.status(403).json({ error: NO_ACCESS });
    if (!(await aiConsentOn(db, crId))) {
      return res.status(403).json({ error: "iPAi isn't allowed to read these records. The key holder can turn it on.", code: "AI_KEY_OFF" });
    }
    if (!(req.body && req.body.acknowledged === true)) {
      return res.status(400).json({ error: "Please tick the acknowledgment first.", ackText: AI_ACK_TEXT, code: "ACK_REQUIRED" });
    }
    if (!(await requireStepUp(db, req, res))) return;
    const doc = await medicalDoc(db, crId, docId);
    if (!doc) return res.status(404).json({ error: "Document not found" });

    // The acknowledgment is recorded at the point of generation, every run.
    await db.prepare(`
      INSERT INTO medical_ai_acks (id, care_recipient_id, document_id, user_id, ack_text, acknowledged_at)
      VALUES (?, ?, ?, ?, ?, NOW())
    `).run(uuid(), crId, doc.id, req.user.id, AI_ACK_TEXT);

    const data = await storage.resolveFileData(doc.file_data);
    const result = await extractSuggestions(data, doc.mime_type);
    await logMedicalAudit(db, {
      careRecipientId: crId, documentId: doc.id, actorId: req.user.id, eventType: "ai_read",
      detail: {
        documentType: doc.document_type, fileName: doc.file_name,
        outcome: result.skipped ? "unavailable" : result.error ? "failed" : "ok",
        items: result.items ? result.items.length : 0,
      },
    });
    if (result.skipped) return res.status(503).json({ error: result.reason, code: "AI_UNAVAILABLE" });
    if (result.error) return res.status(502).json({ error: result.reason, code: "AI_FAILED" });

    // A re-run replaces this document's still-pending suggestions; decided ones stay as history.
    await db.prepare("DELETE FROM medical_doc_suggestions WHERE document_id = ? AND status = 'pending'").run(doc.id);
    for (const it of result.items) {
      await db.prepare(`
        INSERT INTO medical_doc_suggestions (id, document_id, care_recipient_id, kind, title, detail,
          source_quote, suggested_date, status, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, NOW())
      `).run(uuid(), doc.id, crId, it.kind, it.title, it.detail, it.source_quote, it.suggested_date, req.user.id);
    }
    res.json({ ok: true, count: result.items.length });
  } catch (err) {
    console.error("Medical iPAi review error:", err);
    res.status(500).json({ error: "iPAi review failed" });
  }
});

// ─── POST /:crId/suggestions/:id/decide — a human taps Accept or Dismiss ───
//   appointment + accept → a care event on the calendar (needs a date)
//   medication / review_item + accept → marked reviewed (nothing else is created)
router.post("/:crId/suggestions/:id/decide", async (req, res) => {
  try {
    const db = await getDb();
    const { crId, id } = req.params;
    const role = await medicalRole(db, crId, req.user.id);
    if (!role.canView) return res.status(403).json({ error: NO_ACCESS });
    const s = await db.prepare(
      "SELECT * FROM medical_doc_suggestions WHERE id = ? AND care_recipient_id = ?"
    ).get(id, crId);
    if (!s) return res.status(404).json({ error: "Suggestion not found" });
    if (s.status !== "pending") return res.status(409).json({ error: "This suggestion was already decided." });
    const action = req.body && req.body.action;
    if (!["accept", "dismiss"].includes(action)) return res.status(400).json({ error: "action must be accept or dismiss" });

    let resultRef = null;
    if (action === "accept" && s.kind === "appointment") {
      const access = await hasAccess(db, crId, req.user.id);
      if (!role.isMember && !canScheduleEvents(access)) {
        return res.status(403).json({ error: "You don't have permission to add appointments for this person." });
      }
      const eventDate = (req.body.event_date || s.suggested_date || "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) return res.status(400).json({ error: "Pick a date for this appointment first.", code: "DATE_REQUIRED" });
      const eventTime = /^\d{2}:\d{2}$/.test(req.body.event_time || "") ? req.body.event_time : null;
      const cr = await db.prepare("SELECT timezone FROM care_recipients WHERE id = ?").get(crId);
      const tz = (cr && cr.timezone) || DEFAULT_TZ;
      const startsAt = eventStartInstant({ event_date: eventDate, event_time: eventTime, tz });
      resultRef = uuid();
      await db.prepare(`
        INSERT INTO care_events (id, care_recipient_id, created_by, title, category,
          event_date, event_time, end_time, tz, starts_at, location, details, source, source_meta)
        VALUES (?, ?, ?, ?, 'medical', ?, ?, NULL, ?, ?, NULL, ?, 'medical_record', ?)
      `).run(
        resultRef, crId, req.user.id, String(s.title).slice(0, 200), eventDate, eventTime, tz,
        startsAt.toISOString(), s.detail ? String(s.detail).slice(0, 1000) : null,
        JSON.stringify({ suggestionId: s.id, documentId: s.document_id })
      );
    }
    const status = action === "accept" ? "accepted" : "dismissed";
    await db.prepare(`
      UPDATE medical_doc_suggestions SET status = ?, decided_by = ?, decided_at = NOW(), result_ref = ?
      WHERE id = ? AND status = 'pending'
    `).run(status, req.user.id, resultRef, s.id);
    await logMedicalAudit(db, {
      careRecipientId: crId, documentId: s.document_id, actorId: req.user.id,
      eventType: `suggestion_${status}`, detail: { kind: s.kind, careEventId: resultRef },
    });
    res.json({ ok: true, status, careEventId: resultRef });
  } catch (err) {
    console.error("Medical suggestion decide error:", err);
    res.status(500).json({ error: "Failed to save your decision" });
  }
});

module.exports = router;
module.exports.AI_ACK_TEXT = AI_ACK_TEXT;
