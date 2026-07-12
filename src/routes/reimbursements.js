// ─── Reimbursements (v1.72.0) ───
// Family expense ledger: a care-team member fronts money for the care recipient
// (pharmacy, groceries, supplies), uploads the receipt, and requests reimbursement.
// The team's billing contact (leader fallback) approves and settles OUTSIDE the
// platform (Venmo/Zelle/check/cash) — the app records who approved what, when,
// and how it was paid. No platform money movement, no processing fees.
// Everyone on the team (including viewers and the care recipient) can see the ledger.
const express = require("express");
const { v4: uuid } = require("uuid");
const { getDb } = require("../models/database");
const { authenticate } = require("../middleware/auth");
const { captureException } = require("../utils/sentry");
const { validateMagicBytes } = require("../utils/fileValidation");
const { writeAuditLog, getClientIp } = require("../middleware/auditLog");
const storage = require("../utils/storage"); // v1.91.0 — env-gated R2 offload for receipt blobs

const router = express.Router();
router.use(authenticate);

const MAX_AMOUNT = 10000;
const MAX_RECEIPTS = 5;
const MAX_RECEIPT_BYTES = 5 * 1024 * 1024; // 5MB decoded
const ALLOWED_MIMES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
const PAID_METHODS = ["venmo", "zelle", "check", "cash", "bank", "other"];

// ── Access helpers ──
// Returns { team, role, isRecipient, canView, canSubmit, isApprover } or null.
async function teamAccess(db, teamId, userId) {
  const team = await db.prepare(`
    SELECT ct.id, ct.billing_user_id, ct.care_recipient_id, ct.name,
           cr.family_user_id, cr.linked_user_id, cr.first_name AS recipient_first_name
    FROM care_teams ct JOIN care_recipients cr ON ct.care_recipient_id = cr.id
    WHERE ct.id = ?
  `).get(teamId);
  if (!team) return null;
  const membership = await db.prepare(
    "SELECT role FROM care_team_members WHERE care_team_id = ? AND user_id = ?"
  ).get(teamId, userId);
  const isRecipient = team.linked_user_id === userId;
  const role = membership ? membership.role : null;
  const isApprover = team.billing_user_id
    ? team.billing_user_id === userId
    : role === "leader";
  return {
    team,
    role,
    isRecipient,
    canView: !!membership || isRecipient,
    canSubmit: role === "leader" || role === "member",
    isApprover,
  };
}

function parseReceipts(receipts) {
  if (!receipts) return [];
  if (!Array.isArray(receipts) || receipts.length > MAX_RECEIPTS) {
    throw Object.assign(new Error(`At most ${MAX_RECEIPTS} receipts per request`), { status: 400 });
  }
  return receipts.map((r) => {
    const m = typeof r.data === "string" && r.data.match(/^data:([^;]+);base64,(.+)$/s);
    if (!m) throw Object.assign(new Error("Each receipt must be a base64 data URI"), { status: 400 });
    const mime = m[1].toLowerCase();
    if (!ALLOWED_MIMES.includes(mime)) {
      throw Object.assign(new Error(`Receipt type ${mime} not allowed (photo or PDF only)`), { status: 400 });
    }
    const buf = Buffer.from(m[2], "base64");
    if (buf.length > MAX_RECEIPT_BYTES) {
      throw Object.assign(new Error("Receipt too large (5MB max — photos are resized automatically, large PDFs must be shrunk)"), { status: 400 });
    }
    const magic = validateMagicBytes(buf, mime);
    if (!magic.valid) {
      throw Object.assign(new Error("Receipt file content does not match its type"), { status: 400 });
    }
    return { data: r.data, mime, size: buf.length, name: (r.name || "receipt").slice(0, 200) };
  });
}

function validateCore(body) {
  const amount = Math.round(parseFloat(body.amount) * 100) / 100;
  if (!isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) {
    throw Object.assign(new Error(`Amount must be between $0.01 and $${MAX_AMOUNT}`), { status: 400 });
  }
  const description = (body.description || "").trim();
  if (!description) throw Object.assign(new Error("Description is required (what was purchased?)"), { status: 400 });
  const category = ["pharmacy", "groceries", "medical", "supplies", "transport", "other"].includes(body.category)
    ? body.category : "other";
  let expenseDate = null;
  if (body.expenseDate && /^\d{4}-\d{2}-\d{2}$/.test(body.expenseDate)) expenseDate = body.expenseDate;
  return { amount, description: description.slice(0, 500), category, expenseDate };
}

async function insertReimbursement(db, fields, receipts) {
  const id = uuid();
  await db.prepare(`
    INSERT INTO reimbursements
      (id, care_team_id, care_recipient_id, requested_by, payee_user_id, amount, description,
       category, expense_date, status, self_recorded, approved_by, approved_at,
       paid_at, paid_method, paid_reference, paid_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, fields.careTeamId, fields.careRecipientId, fields.requestedBy, fields.payeeUserId,
    fields.amount, fields.description, fields.category, fields.expenseDate,
    fields.status, fields.selfRecorded ? 1 : 0, fields.approvedBy || null, fields.approvedAt || null,
    fields.paidAt || null, fields.paidMethod || null, fields.paidReference || null, fields.paidBy || null
  );
  for (const r of receipts) {
    // v1.91.0 — with R2 configured, the blob goes to object storage and the
    // column stores an "r2:<key>" marker; otherwise the data URI as before.
    const stored = await storage.storeFileData("receipts", r.data);
    await db.prepare(
      "INSERT INTO reimbursement_receipts (id, reimbursement_id, file_data, file_name, mime_type, file_size, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(uuid(), id, stored, r.name, r.mime, r.size, fields.requestedBy);
  }
  return id;
}

async function notify(req, userId, title, body, data) {
  try {
    const { sendPushToUser } = require("./push");
    sendPushToUser(userId, { title, body, data }, data.type).catch(() => {});
  } catch (e) { captureException(e, { where: "reimbursements: push" }); }
}

async function feedEntry(db, team, title, message) {
  try {
    if (!team.family_user_id) return;
    await db.prepare(
      "INSERT INTO activity_feed (id, family_user_id, care_recipient_id, event_type, title, message) VALUES (?, ?, ?, 'reimbursement', ?, ?)"
    ).run(uuid(), team.family_user_id, team.care_recipient_id, title, message);
  } catch (e) { captureException(e, { where: "reimbursements: activity feed" }); }
}

function audit(req, action, details) {
  writeAuditLog({
    userId: req.user.id, userEmail: req.user.email, userRole: req.user.role,
    action, endpoint: req.originalUrl, method: req.method,
    ipAddress: getClientIp(req), userAgent: req.headers["user-agent"],
    details, severity: "info",
  });
}

// ── POST /api/reimbursements — submit a request ──
router.post("/", async (req, res) => {
  try {
    const db = await getDb();
    const access = await teamAccess(db, req.body.careTeamId, req.user.id);
    if (!access || !access.canView) return res.status(404).json({ error: "Care team not found" });
    if (!access.canSubmit) return res.status(403).json({ error: "Only care team members can request reimbursements" });

    const core = validateCore(req.body);
    const receipts = parseReceipts(req.body.receipts);

    // Optional: save the requester's payout details for the settlement step
    if (typeof req.body.venmoHandle === "string" && req.body.venmoHandle.trim()) {
      const handle = req.body.venmoHandle.trim().replace(/^@/, "").slice(0, 60);
      await db.prepare("UPDATE users SET venmo_handle = ? WHERE id = ?").run(handle, req.user.id);
    }
    if (typeof req.body.zelleContact === "string" && req.body.zelleContact.trim()) {
      const zelle = req.body.zelleContact.trim().slice(0, 100);
      await db.prepare("UPDATE users SET zelle_contact = ? WHERE id = ?").run(zelle, req.user.id);
    }

    const id = await insertReimbursement(db, {
      careTeamId: access.team.id, careRecipientId: access.team.care_recipient_id,
      requestedBy: req.user.id, payeeUserId: req.user.id,
      ...core, status: "pending", selfRecorded: false,
    }, receipts);

    audit(req, "reimbursement_requested", { id, amount: core.amount, receipts: receipts.length });
    const requester = await db.prepare("SELECT first_name, last_name FROM users WHERE id = ?").get(req.user.id);
    const rName = requester ? `${requester.first_name} ${requester.last_name}` : "A team member";
    await feedEntry(db, access.team, "Reimbursement requested",
      `${rName} requested $${core.amount.toFixed(2)} — ${core.description}`);

    // Notify the approver
    const approverId = access.team.billing_user_id
      || (await db.prepare("SELECT user_id FROM care_team_members WHERE care_team_id = ? AND role = 'leader' LIMIT 1").get(access.team.id))?.user_id;
    if (approverId && approverId !== req.user.id) {
      notify(req, approverId, "Reimbursement request",
        `${rName} requested $${core.amount.toFixed(2)} — ${core.description}`,
        { type: "reimbursement_request", reimbursementId: id, careTeamId: access.team.id, page: "careteam" });
    }

    res.status(201).json({ id, message: "Reimbursement request submitted" });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error("Create reimbursement error:", err);
    captureException(err, { where: "reimbursements: create" });
    res.status(500).json({ error: "Failed to create reimbursement request" });
  }
});

// ── POST /api/reimbursements/record — approver records an already-settled expense ──
router.post("/record", async (req, res) => {
  try {
    const db = await getDb();
    const access = await teamAccess(db, req.body.careTeamId, req.user.id);
    if (!access || !access.canView) return res.status(404).json({ error: "Care team not found" });
    if (!access.isApprover) return res.status(403).json({ error: "Only the billing contact (or team leader) can record reimbursements directly" });

    const core = validateCore(req.body);
    const receipts = parseReceipts(req.body.receipts);
    const payeeUserId = req.body.payeeUserId || req.user.id;
    const payeeMember = await db.prepare(
      "SELECT user_id FROM care_team_members WHERE care_team_id = ? AND user_id = ?"
    ).get(access.team.id, payeeUserId);
    if (!payeeMember) return res.status(400).json({ error: "Payee must be a member of this care team" });
    const paidMethod = PAID_METHODS.includes(req.body.paidMethod) ? req.body.paidMethod : "other";

    const id = await insertReimbursement(db, {
      careTeamId: access.team.id, careRecipientId: access.team.care_recipient_id,
      requestedBy: req.user.id, payeeUserId,
      ...core, status: "paid", selfRecorded: true,
      approvedBy: req.user.id, approvedAt: new Date().toISOString(),
      paidAt: new Date().toISOString(), paidMethod,
      paidReference: (req.body.paidReference || "").slice(0, 200) || null, paidBy: req.user.id,
    }, receipts);

    audit(req, "reimbursement_recorded", { id, amount: core.amount, payeeUserId, paidMethod });
    const payee = await db.prepare("SELECT first_name, last_name FROM users WHERE id = ?").get(payeeUserId);
    await feedEntry(db, access.team, "Reimbursement recorded",
      `$${core.amount.toFixed(2)} to ${payee ? payee.first_name + " " + payee.last_name : "a team member"} — ${core.description} (recorded by approver)`);

    res.status(201).json({ id, message: "Reimbursement recorded" });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error("Record reimbursement error:", err);
    captureException(err, { where: "reimbursements: record" });
    res.status(500).json({ error: "Failed to record reimbursement" });
  }
});

// ── GET /api/reimbursements/my-payout-info — prefill for the request form ──
router.get("/my-payout-info", async (req, res) => {
  try {
    const db = await getDb();
    const u = await db.prepare("SELECT venmo_handle, zelle_contact FROM users WHERE id = ?").get(req.user.id);
    res.json({ venmoHandle: u?.venmo_handle || "", zelleContact: u?.zelle_contact || "" });
  } catch (err) {
    captureException(err, { where: "reimbursements: payout info" });
    res.status(500).json({ error: "Failed to load payout info" });
  }
});

// ── GET /api/reimbursements/mine — the viewer's own requests across teams (payments page) ──
router.get("/mine", async (req, res) => {
  try {
    const db = await getDb();
    const rows = await db.prepare(`
      SELECT r.id, r.care_team_id, r.amount, r.description, r.status, r.self_recorded,
             r.created_at, r.paid_at, r.paid_method,
             cr.first_name AS recipient_first_name, cr.last_name AS recipient_last_name
      FROM reimbursements r
      LEFT JOIN care_recipients cr ON r.care_recipient_id = cr.id
      WHERE r.payee_user_id = ? OR r.requested_by = ?
      ORDER BY r.created_at DESC
      LIMIT 20
    `).all(req.user.id, req.user.id);
    res.json({ reimbursements: rows });
  } catch (err) {
    captureException(err, { where: "reimbursements: mine" });
    res.status(500).json({ error: "Failed to load reimbursements" });
  }
});

// ── GET /api/reimbursements/team/:teamId — the team ledger (no file blobs!) ──
router.get("/team/:teamId", async (req, res) => {
  try {
    const db = await getDb();
    const access = await teamAccess(db, req.params.teamId, req.user.id);
    if (!access || !access.canView) return res.status(404).json({ error: "Care team not found" });

    const rows = await db.prepare(`
      SELECT r.id, r.amount, r.description, r.category, r.expense_date, r.status,
             r.self_recorded, r.created_at, r.approved_at, r.declined_reason,
             r.paid_at, r.paid_method, r.paid_reference,
             r.requested_by, ru.first_name AS requester_first_name, ru.last_name AS requester_last_name,
             r.payee_user_id, pu.first_name AS payee_first_name, pu.last_name AS payee_last_name,
             pu.venmo_handle AS payee_venmo_handle, pu.zelle_contact AS payee_zelle_contact,
             r.approved_by, au.first_name AS approver_first_name, au.last_name AS approver_last_name
      FROM reimbursements r
      JOIN users ru ON r.requested_by = ru.id
      JOIN users pu ON r.payee_user_id = pu.id
      LEFT JOIN users au ON r.approved_by = au.id
      WHERE r.care_team_id = ?
      ORDER BY r.created_at DESC
      LIMIT 200
    `).all(req.params.teamId);

    const ids = rows.map((r) => r.id);
    let receiptMeta = [];
    if (ids.length) {
      receiptMeta = await db.prepare(
        `SELECT id, reimbursement_id, file_name, mime_type, file_size FROM reimbursement_receipts WHERE reimbursement_id = ANY(?)`
      ).all(ids);
    }
    const byReimb = {};
    for (const m of receiptMeta) (byReimb[m.reimbursement_id] = byReimb[m.reimbursement_id] || []).push(m);

    res.json({
      reimbursements: rows.map((r) => ({ ...r, receipts: byReimb[r.id] || [] })),
      isApprover: access.isApprover,
      canSubmit: access.canSubmit,
      billingUserId: access.team.billing_user_id,
    });
  } catch (err) {
    console.error("List reimbursements error:", err);
    captureException(err, { where: "reimbursements: list" });
    res.status(500).json({ error: "Failed to load reimbursements" });
  }
});

// ── GET /api/reimbursements/receipt/:receiptId — stream one receipt (team only) ──
router.get("/receipt/:receiptId", async (req, res) => {
  try {
    const db = await getDb();
    const receipt = await db.prepare(
      "SELECT rr.file_data, rr.file_name, rr.mime_type, r.care_team_id FROM reimbursement_receipts rr JOIN reimbursements r ON rr.reimbursement_id = r.id WHERE rr.id = ?"
    ).get(req.params.receiptId);
    if (!receipt) return res.status(404).json({ error: "Receipt not found" });
    const access = await teamAccess(db, receipt.care_team_id, req.user.id);
    if (!access || !access.canView) return res.status(404).json({ error: "Receipt not found" });

    const fileData = await storage.resolveFileData(receipt.file_data); // v1.91.0 — fetches from R2 when marker
    const m = fileData.match(/^data:([^;]+);base64,(.+)$/s);
    if (!m) return res.status(500).json({ error: "Stored receipt is corrupt" });
    const buf = Buffer.from(m[2], "base64");
    res.set("Content-Type", receipt.mime_type || m[1]);
    res.set("Content-Disposition", `inline; filename="${(receipt.file_name || "receipt").replace(/[^\w.\- ]/g, "_")}"`);
    res.set("Cache-Control", "private, max-age=86400");
    res.send(buf);
  } catch (err) {
    console.error("Receipt fetch error:", err);
    captureException(err, { where: "reimbursements: receipt" });
    res.status(500).json({ error: "Failed to load receipt" });
  }
});

// ── Approver actions ──
async function loadForApprover(db, req, res) {
  const row = await db.prepare("SELECT * FROM reimbursements WHERE id = ?").get(req.params.id);
  if (!row) { res.status(404).json({ error: "Reimbursement not found" }); return null; }
  const access = await teamAccess(db, row.care_team_id, req.user.id);
  if (!access || !access.canView) { res.status(404).json({ error: "Reimbursement not found" }); return null; }
  if (!access.isApprover) { res.status(403).json({ error: "Only the billing contact (or team leader) can do this" }); return null; }
  return { row, access };
}

router.post("/:id/approve", async (req, res) => {
  try {
    const db = await getDb();
    const ctx = await loadForApprover(db, req, res);
    if (!ctx) return;
    if (ctx.row.status !== "pending") return res.status(400).json({ error: `Cannot approve a ${ctx.row.status} request` });
    await db.prepare("UPDATE reimbursements SET status = 'approved', approved_by = ?, approved_at = NOW(), updated_at = NOW() WHERE id = ? AND status = 'pending'")
      .run(req.user.id, req.params.id);
    audit(req, "reimbursement_approved", { id: req.params.id, amount: ctx.row.amount });
    await feedEntry(db, ctx.access.team, "Reimbursement approved", `$${Number(ctx.row.amount).toFixed(2)} — ${ctx.row.description}`);
    notify(req, ctx.row.payee_user_id, "Reimbursement approved",
      `Your $${Number(ctx.row.amount).toFixed(2)} request was approved — payment on its way`,
      { type: "reimbursement_approved", reimbursementId: req.params.id, page: "careteam" });
    res.json({ message: "Approved" });
  } catch (err) {
    console.error("Approve reimbursement error:", err);
    captureException(err, { where: "reimbursements: approve" });
    res.status(500).json({ error: "Failed to approve" });
  }
});

router.post("/:id/decline", async (req, res) => {
  try {
    const db = await getDb();
    const ctx = await loadForApprover(db, req, res);
    if (!ctx) return;
    if (ctx.row.status !== "pending") return res.status(400).json({ error: `Cannot decline a ${ctx.row.status} request` });
    const reason = (req.body.reason || "").slice(0, 300) || null;
    await db.prepare("UPDATE reimbursements SET status = 'declined', approved_by = ?, declined_reason = ?, updated_at = NOW() WHERE id = ? AND status = 'pending'")
      .run(req.user.id, reason, req.params.id);
    audit(req, "reimbursement_declined", { id: req.params.id, reason });
    notify(req, ctx.row.payee_user_id, "Reimbursement declined",
      reason ? `Declined: ${reason}` : "Your reimbursement request was declined",
      { type: "reimbursement_declined", reimbursementId: req.params.id, page: "careteam" });
    res.json({ message: "Declined" });
  } catch (err) {
    console.error("Decline reimbursement error:", err);
    captureException(err, { where: "reimbursements: decline" });
    res.status(500).json({ error: "Failed to decline" });
  }
});

router.post("/:id/mark-paid", async (req, res) => {
  try {
    const db = await getDb();
    const ctx = await loadForApprover(db, req, res);
    if (!ctx) return;
    if (!["approved", "pending"].includes(ctx.row.status)) return res.status(400).json({ error: `Cannot mark a ${ctx.row.status} request paid` });
    const method = PAID_METHODS.includes(req.body.method) ? req.body.method : "other";
    const reference = (req.body.reference || "").slice(0, 200) || null;
    await db.prepare(`
      UPDATE reimbursements SET status = 'paid', paid_at = NOW(), paid_method = ?, paid_reference = ?, paid_by = ?,
        approved_by = COALESCE(approved_by, ?), approved_at = COALESCE(approved_at, NOW()), updated_at = NOW()
      WHERE id = ? AND status IN ('approved', 'pending')
    `).run(method, reference, req.user.id, req.user.id, req.params.id);
    audit(req, "reimbursement_paid", { id: req.params.id, amount: ctx.row.amount, method, reference });
    await feedEntry(db, ctx.access.team, "Reimbursement paid",
      `$${Number(ctx.row.amount).toFixed(2)} — ${ctx.row.description} (via ${method})`);
    notify(req, ctx.row.payee_user_id, "Reimbursement paid",
      `$${Number(ctx.row.amount).toFixed(2)} sent via ${method}`,
      { type: "reimbursement_paid", reimbursementId: req.params.id, page: "careteam" });
    res.json({ message: "Marked paid" });
  } catch (err) {
    console.error("Mark-paid reimbursement error:", err);
    captureException(err, { where: "reimbursements: mark-paid" });
    res.status(500).json({ error: "Failed to mark paid" });
  }
});

// ── POST /:id/cancel — requester withdraws a pending request ──
router.post("/:id/cancel", async (req, res) => {
  try {
    const db = await getDb();
    const row = await db.prepare("SELECT * FROM reimbursements WHERE id = ?").get(req.params.id);
    if (!row) return res.status(404).json({ error: "Reimbursement not found" });
    if (row.requested_by !== req.user.id) return res.status(403).json({ error: "Only the requester can cancel" });
    if (row.status !== "pending") return res.status(400).json({ error: `Cannot cancel a ${row.status} request` });
    await db.prepare("UPDATE reimbursements SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW() WHERE id = ? AND status = 'pending'")
      .run(req.params.id);
    audit(req, "reimbursement_cancelled", { id: req.params.id });
    res.json({ message: "Cancelled" });
  } catch (err) {
    console.error("Cancel reimbursement error:", err);
    captureException(err, { where: "reimbursements: cancel" });
    res.status(500).json({ error: "Failed to cancel" });
  }
});


// ═══ Recurring reimbursements (v1.74.0) ═══
// Standing approval: the approver OKs the series once; each cycle an occurrence
// is generated PRE-APPROVED (status 'approved'), ready for the approver to pay
// and mark paid. Either side can pause/cancel the series at any time.

// Next date (>= today) whose day-of-month equals min(dayOfMonth, days in month).
// Dates use server time (UTC) — a few hours' skew vs. US time zones is fine for bills.
function nextRunDate(dayOfMonth, from = new Date()) {
  const base = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const d = new Date(base.getFullYear(), base.getMonth(), 1);
  for (let i = 0; i < 3; i++) {
    const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    const candidate = new Date(d.getFullYear(), d.getMonth(), Math.min(dayOfMonth, daysInMonth));
    if (candidate >= base) {
      return `${candidate.getFullYear()}-${String(candidate.getMonth() + 1).padStart(2, "0")}-${String(candidate.getDate()).padStart(2, "0")}`;
    }
    d.setMonth(d.getMonth() + 1);
  }
}

function advanceNextRun(currentISO, dayOfMonth) {
  const [y, m] = currentISO.split("-").map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const daysInMonth = new Date(ny, nm, 0).getDate();
  return `${ny}-${String(nm).padStart(2, "0")}-${String(Math.min(dayOfMonth, daysInMonth)).padStart(2, "0")}`;
}

function monthLabel(iso) {
  const [y, m] = iso.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

// Called hourly from server.js. Generates due occurrences atomically:
// the schedule row is advanced with an optimistic lock inside the same
// transaction as the occurrence insert, so a crash can't double-generate.
async function generateRecurringReimbursements() {
  const db = await getDb();
  const due = await db.prepare(
    "SELECT * FROM reimbursement_schedules WHERE status = 'active' AND next_run_date <= to_char(CURRENT_DATE, 'YYYY-MM-DD')"
  ).all();
  for (const sch of due) {
    try {
      let occurrenceId = null;
      await db.transaction(async (tx) => {
        const upd = await tx.prepare(
          "UPDATE reimbursement_schedules SET next_run_date = ?, last_run_at = NOW(), updated_at = NOW() WHERE id = ? AND next_run_date = ? AND status = 'active'"
        ).run(advanceNextRun(sch.next_run_date, sch.day_of_month), sch.id, sch.next_run_date);
        if (!upd.changes) return; // another pass already handled it
        occurrenceId = uuid();
        await tx.prepare(`
          INSERT INTO reimbursements
            (id, care_team_id, care_recipient_id, requested_by, payee_user_id, amount, description,
             category, expense_date, status, self_recorded, approved_by, approved_at, schedule_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', 0, ?, NOW(), ?)
        `).run(
          occurrenceId, sch.care_team_id, sch.care_recipient_id, sch.payee_user_id, sch.payee_user_id,
          sch.amount, `${sch.description} (recurring — ${monthLabel(sch.next_run_date)})`,
          sch.category, sch.next_run_date, sch.approved_by, sch.id
        );
      });
      if (!occurrenceId) continue;
      writeAuditLog({
        userId: sch.payee_user_id, action: "reimbursement_recurring_generated",
        endpoint: "cron", method: "CRON", ipAddress: "server",
        details: { scheduleId: sch.id, occurrenceId, amount: sch.amount }, severity: "info",
      });
      try {
        const team = await db.prepare(
          "SELECT ct.billing_user_id, cr.family_user_id, cr.id AS care_recipient_id FROM care_teams ct JOIN care_recipients cr ON ct.care_recipient_id = cr.id WHERE ct.id = ?"
        ).get(sch.care_team_id);
        const payee = await db.prepare("SELECT first_name, last_name FROM users WHERE id = ?").get(sch.payee_user_id);
        const pName = payee ? `${payee.first_name} ${payee.last_name}` : "a team member";
        await feedEntry(db, team, "Recurring reimbursement due",
          `$${Number(sch.amount).toFixed(2)} to ${pName} — ${sch.description}`);
        const approverId = team.billing_user_id || sch.approved_by;
        if (approverId) {
          const { sendPushToUser } = require("./push");
          sendPushToUser(approverId, {
            title: "Recurring reimbursement due",
            body: `$${Number(sch.amount).toFixed(2)} to ${pName} — ${sch.description} (pre-approved, ready to pay)`,
            data: { type: "reimbursement_recurring", reimbursementId: occurrenceId, page: "careteam" },
          }, "reimbursement_recurring").catch(() => {});
        }
      } catch (e) { captureException(e, { where: "reimbursements: recurring notify" }); }
    } catch (e) {
      captureException(e, { where: "reimbursements: recurring generate", scheduleId: sch.id });
    }
  }
}

// ── POST /api/reimbursements/schedules — create a recurring series ──
router.post("/schedules", async (req, res) => {
  try {
    const db = await getDb();
    const access = await teamAccess(db, req.body.careTeamId, req.user.id);
    if (!access || !access.canView) return res.status(404).json({ error: "Care team not found" });
    if (!access.canSubmit) return res.status(403).json({ error: "Only care team members can set up recurring reimbursements" });

    const core = validateCore(req.body);
    const day = parseInt(req.body.dayOfMonth);
    if (!Number.isInteger(day) || day < 1 || day > 31) {
      return res.status(400).json({ error: "Day of month must be 1–31" });
    }

    const id = uuid();
    await db.prepare(`
      INSERT INTO reimbursement_schedules
        (id, care_team_id, care_recipient_id, payee_user_id, created_by, amount, description, category, day_of_month, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_approval')
    `).run(id, access.team.id, access.team.care_recipient_id, req.user.id, req.user.id,
      core.amount, core.description, core.category, day);

    audit(req, "reimbursement_schedule_requested", { id, amount: core.amount, dayOfMonth: day });
    const requester = await db.prepare("SELECT first_name, last_name FROM users WHERE id = ?").get(req.user.id);
    const rName = requester ? `${requester.first_name} ${requester.last_name}` : "A team member";
    const approverId = access.team.billing_user_id
      || (await db.prepare("SELECT user_id FROM care_team_members WHERE care_team_id = ? AND role = 'leader' LIMIT 1").get(access.team.id))?.user_id;
    if (approverId && approverId !== req.user.id) {
      notify(req, approverId, "Recurring reimbursement request",
        `${rName} wants $${core.amount.toFixed(2)}/month on day ${day} — ${core.description}`,
        { type: "reimbursement_schedule_request", scheduleId: id, careTeamId: access.team.id, page: "careteam" });
    }
    res.status(201).json({ id, message: "Recurring reimbursement submitted for approval" });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error("Create schedule error:", err);
    captureException(err, { where: "reimbursements: create schedule" });
    res.status(500).json({ error: "Failed to create recurring reimbursement" });
  }
});

// ── GET /api/reimbursements/schedules/team/:teamId ──
router.get("/schedules/team/:teamId", async (req, res) => {
  try {
    const db = await getDb();
    const access = await teamAccess(db, req.params.teamId, req.user.id);
    if (!access || !access.canView) return res.status(404).json({ error: "Care team not found" });
    const rows = await db.prepare(`
      SELECT s.*, pu.first_name AS payee_first_name, pu.last_name AS payee_last_name
      FROM reimbursement_schedules s JOIN users pu ON s.payee_user_id = pu.id
      WHERE s.care_team_id = ? AND s.status != 'cancelled'
      ORDER BY s.created_at DESC LIMIT 50
    `).all(req.params.teamId);
    res.json({ schedules: rows, isApprover: access.isApprover });
  } catch (err) {
    console.error("List schedules error:", err);
    captureException(err, { where: "reimbursements: list schedules" });
    res.status(500).json({ error: "Failed to load recurring reimbursements" });
  }
});

// ── Schedule actions ──
async function loadSchedule(db, req, res) {
  const sch = await db.prepare("SELECT * FROM reimbursement_schedules WHERE id = ?").get(req.params.id);
  if (!sch) { res.status(404).json({ error: "Recurring reimbursement not found" }); return null; }
  const access = await teamAccess(db, sch.care_team_id, req.user.id);
  if (!access || !access.canView) { res.status(404).json({ error: "Recurring reimbursement not found" }); return null; }
  return { sch, access };
}

router.post("/schedules/:id/approve", async (req, res) => {
  try {
    const db = await getDb();
    const ctx = await loadSchedule(db, req, res);
    if (!ctx) return;
    if (!ctx.access.isApprover) return res.status(403).json({ error: "Only the billing contact (or team leader) can approve" });
    if (ctx.sch.status !== "pending_approval") return res.status(400).json({ error: `Cannot approve a ${ctx.sch.status} series` });
    const next = nextRunDate(ctx.sch.day_of_month);
    await db.prepare("UPDATE reimbursement_schedules SET status = 'active', approved_by = ?, approved_at = NOW(), next_run_date = ?, updated_at = NOW() WHERE id = ? AND status = 'pending_approval'")
      .run(req.user.id, next, req.params.id);
    audit(req, "reimbursement_schedule_approved", { id: req.params.id, nextRunDate: next });
    await feedEntry(db, ctx.access.team, "Recurring reimbursement approved",
      `$${Number(ctx.sch.amount).toFixed(2)}/month — ${ctx.sch.description}`);
    notify(req, ctx.sch.payee_user_id, "Recurring reimbursement approved",
      `$${Number(ctx.sch.amount).toFixed(2)}/month for ${ctx.sch.description} — first on ${next}`,
      { type: "reimbursement_schedule_approved", scheduleId: req.params.id, page: "careteam" });
    res.json({ message: "Series approved", nextRunDate: next });
  } catch (err) {
    console.error("Approve schedule error:", err);
    captureException(err, { where: "reimbursements: approve schedule" });
    res.status(500).json({ error: "Failed to approve" });
  }
});

router.post("/schedules/:id/decline", async (req, res) => {
  try {
    const db = await getDb();
    const ctx = await loadSchedule(db, req, res);
    if (!ctx) return;
    if (!ctx.access.isApprover) return res.status(403).json({ error: "Only the billing contact (or team leader) can decline" });
    if (ctx.sch.status !== "pending_approval") return res.status(400).json({ error: `Cannot decline a ${ctx.sch.status} series` });
    const reason = (req.body.reason || "").slice(0, 300) || null;
    await db.prepare("UPDATE reimbursement_schedules SET status = 'declined', approved_by = ?, declined_reason = ?, updated_at = NOW() WHERE id = ? AND status = 'pending_approval'")
      .run(req.user.id, reason, req.params.id);
    audit(req, "reimbursement_schedule_declined", { id: req.params.id, reason });
    notify(req, ctx.sch.payee_user_id, "Recurring reimbursement declined",
      reason ? `Declined: ${reason}` : "Your recurring reimbursement was declined",
      { type: "reimbursement_schedule_declined", scheduleId: req.params.id, page: "careteam" });
    res.json({ message: "Declined" });
  } catch (err) {
    console.error("Decline schedule error:", err);
    captureException(err, { where: "reimbursements: decline schedule" });
    res.status(500).json({ error: "Failed to decline" });
  }
});

// Pause / resume / cancel — the payee OR the approver can manage a series
router.post("/schedules/:id/:action(pause|resume|cancel)", async (req, res) => {
  try {
    const db = await getDb();
    const ctx = await loadSchedule(db, req, res);
    if (!ctx) return;
    const mine = ctx.sch.payee_user_id === req.user.id;
    if (!mine && !ctx.access.isApprover) return res.status(403).json({ error: "Only the payee or the billing contact can manage this series" });
    const a = req.params.action;
    if (a === "pause") {
      if (ctx.sch.status !== "active") return res.status(400).json({ error: `Cannot pause a ${ctx.sch.status} series` });
      await db.prepare("UPDATE reimbursement_schedules SET status = 'paused', updated_at = NOW() WHERE id = ? AND status = 'active'").run(req.params.id);
    } else if (a === "resume") {
      if (ctx.sch.status !== "paused") return res.status(400).json({ error: `Cannot resume a ${ctx.sch.status} series` });
      // recompute so paused months are skipped, not back-filled
      await db.prepare("UPDATE reimbursement_schedules SET status = 'active', next_run_date = ?, updated_at = NOW() WHERE id = ? AND status = 'paused'")
        .run(nextRunDate(ctx.sch.day_of_month), req.params.id);
    } else {
      if (!["pending_approval", "active", "paused"].includes(ctx.sch.status)) return res.status(400).json({ error: `Cannot cancel a ${ctx.sch.status} series` });
      await db.prepare("UPDATE reimbursement_schedules SET status = 'cancelled', updated_at = NOW() WHERE id = ?").run(req.params.id);
    }
    audit(req, `reimbursement_schedule_${a}`, { id: req.params.id });
    res.json({ message: a === "pause" ? "Paused" : a === "resume" ? "Resumed" : "Cancelled" });
  } catch (err) {
    console.error("Schedule action error:", err);
    captureException(err, { where: "reimbursements: schedule action" });
    res.status(500).json({ error: "Action failed" });
  }
});

// ── GET /api/reimbursements/money/:teamId — the Money view (v1.96.0) ──
// One financial picture per care team for the LEADER + BILLING CONTACT:
// every reimbursement (requested / approved / paid / declined, with notes and
// receipts) plus the team's care-session payments, with summary totals.
// From Pete's 7/12 feedback; folds in the "Payments page v2" intent.
router.get("/money/:teamId", async (req, res) => {
  try {
    const db = await getDb();
    const access = await teamAccess(db, req.params.teamId, req.user.id);
    if (!access || !access.canView) return res.status(404).json({ error: "Care team not found" });
    const isMoneyViewer = access.isApprover || access.role === "leader";
    if (!isMoneyViewer) return res.status(403).json({ error: "The Money view is available to the team leader and billing contact" });

    // Full reimbursement ledger (same shape as the team endpoint, deeper limit)
    const reimbursements = await db.prepare(`
      SELECT r.id, r.amount, r.description, r.category, r.expense_date, r.status,
             r.self_recorded, r.created_at, r.approved_at, r.declined_reason,
             r.paid_at, r.paid_method, r.paid_reference,
             r.requested_by, ru.first_name AS requester_first_name, ru.last_name AS requester_last_name,
             r.payee_user_id, pu.first_name AS payee_first_name, pu.last_name AS payee_last_name,
             r.approved_by, au.first_name AS approver_first_name, au.last_name AS approver_last_name
      FROM reimbursements r
      JOIN users ru ON r.requested_by = ru.id
      JOIN users pu ON r.payee_user_id = pu.id
      LEFT JOIN users au ON r.approved_by = au.id
      WHERE r.care_team_id = ?
      ORDER BY r.created_at DESC
      LIMIT 500
    `).all(req.params.teamId);

    const ids = reimbursements.map((r) => r.id);
    let receiptMeta = [];
    if (ids.length) {
      receiptMeta = await db.prepare(
        `SELECT id, reimbursement_id, file_name, mime_type, file_size FROM reimbursement_receipts WHERE reimbursement_id = ANY(?)`
      ).all(ids);
    }
    const byReimb = {};
    for (const m of receiptMeta) (byReimb[m.reimbursement_id] = byReimb[m.reimbursement_id] || []).push(m);

    // Care-session payments for this team's care recipient (who paid + status)
    let payments = [];
    try {
      payments = await db.prepare(`
        SELECT p.id, p.amount, p.status, p.payment_method, p.created_at,
               cs.service_type, cs.scheduled_date,
               cu.first_name || ' ' || cu.last_name AS caregiver_name,
               fu.first_name || ' ' || fu.last_name AS paid_by_name
        FROM payments p
        JOIN care_sessions cs ON p.session_id = cs.id
        LEFT JOIN caregiver_profiles cp ON p.caregiver_id = cp.id
        LEFT JOIN users cu ON cp.user_id = cu.id
        LEFT JOIN users fu ON p.family_user_id = fu.id
        WHERE cs.care_recipient_id = ?
        ORDER BY p.created_at DESC
        LIMIT 200
      `).all(access.team.care_recipient_id);
    } catch (e) { /* payments table shape may vary in older DBs — Money view still works */ }

    // Summary totals (reimbursements by status; payments completed total)
    const sum = (rows) => Math.round(rows.reduce((t, r) => t + (Number(r.amount) || 0), 0) * 100) / 100;
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const yearStart = new Date(monthStart.getFullYear(), 0, 1);
    const paidRows = reimbursements.filter((r) => r.status === "paid");
    const summary = {
      pendingCount: reimbursements.filter((r) => r.status === "pending").length,
      pendingTotal: sum(reimbursements.filter((r) => r.status === "pending")),
      approvedAwaitingCount: reimbursements.filter((r) => r.status === "approved").length,
      approvedAwaitingTotal: sum(reimbursements.filter((r) => r.status === "approved")),
      paidThisMonthTotal: sum(paidRows.filter((r) => r.paid_at && new Date(r.paid_at) >= monthStart)),
      paidYtdTotal: sum(paidRows.filter((r) => r.paid_at && new Date(r.paid_at) >= yearStart)),
      declinedCount: reimbursements.filter((r) => r.status === "declined").length,
      sessionPaymentsYtdTotal: sum(payments.filter((p) => p.status === "completed" && p.created_at && new Date(p.created_at) >= yearStart)),
    };

    res.json({
      recipientFirstName: access.team.recipient_first_name,
      reimbursements: reimbursements.map((r) => ({ ...r, receipts: byReimb[r.id] || [] })),
      payments,
      summary,
    });
  } catch (err) {
    console.error("Money view error:", err);
    captureException(err, { where: "reimbursements: money view" });
    res.status(500).json({ error: "Failed to load the money view" });
  }
});

module.exports = router;
module.exports.generateRecurringReimbursements = generateRecurringReimbursements;
