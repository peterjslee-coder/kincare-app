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
// v1.97.0 — how the requester wants to be paid back (the "to" address).
// "ach" = bank transfer the family runs from their own banking app; the app
// stores a LABEL only (bank nickname + last 4), never account/routing numbers.
const PAYOUT_METHODS = ["inplace", "venmo", "zelle", "ach", "check", "cash", "other"];
// v1.98.0 — Stripe's ACH fee (~0.8%, capped $5). Per Pete's call, this rides
// ON TOP of what the payer is charged, so the payee receives the exact amount.
const ACH_FEE_BPS = 8;        // 0.8%
const ACH_FEE_CAP_CENTS = 500; // $5
function achFeeCents(baseCents) {
  return Math.min(ACH_FEE_CAP_CENTS, Math.max(1, Math.ceil(baseCents * ACH_FEE_BPS / 1000)));
}

// Reject anything that looks like a full account/routing number in bank labels.
// (Zelle details legitimately contain 10-digit phone numbers, so this guard
// only applies to bank/ACH labels and funding-account labels.)
function assertLabelOnly(value, what) {
  if (value && /\d{8,}/.test(value.replace(/[\s-]/g, ""))) {
    throw Object.assign(new Error(`${what} looks like a full account number — use a nickname and the last 4 digits only (e.g. "Truist checking ****4321"). InPlace never stores account numbers.`), { status: 400 });
  }
}

// Parse the optional "to" payout fields from a request/edit body.
function parsePayout(body) {
  let payoutMethod = null, payoutDetails = null;
  if (body.payoutMethod && PAYOUT_METHODS.includes(body.payoutMethod)) {
    payoutMethod = body.payoutMethod;
    // "inplace" = the in-app Stripe ACH rail; destination is the payee's linked
    // Connect payout bank, so there's no free-text detail to store.
    if (payoutMethod !== "inplace") {
      payoutDetails = (typeof body.payoutDetails === "string" ? body.payoutDetails.trim() : "").slice(0, 120) || null;
      if (payoutMethod === "ach") assertLabelOnly(payoutDetails, "Bank details");
    }
  }
  return { payoutMethod, payoutDetails };
}

// ── Linked bank accounts (v1.97.1) ──
// Banks the user has ALREADY linked to InPlace (saved ACH payment methods on
// their Stripe customer, and — for caregivers — the payout bank on their
// Stripe Connect account). Returned as display labels only ("Chase ****4321")
// so pickers can offer one-tap selection instead of asking anyone to type.
// Read-only metadata; no money moves through InPlace.
async function getLinkedBanks(db, userId) {
  const labels = [];
  let stripe;
  try { stripe = require("./payments").getStripe(); } catch { return labels; }
  try {
    const u = await db.prepare("SELECT stripe_customer_id FROM users WHERE id = ?").get(userId);
    if (u?.stripe_customer_id) {
      const banks = await stripe.paymentMethods.list({ customer: u.stripe_customer_id, type: "us_bank_account", limit: 10 });
      for (const pm of banks.data) {
        labels.push(`${pm.us_bank_account.bank_name || "Bank account"} ****${pm.us_bank_account.last4}`);
      }
    }
  } catch { /* no customer / API hiccup — picker just falls back to typing */ }
  try {
    const cg = await db.prepare("SELECT stripe_account_id FROM caregiver_profiles WHERE user_id = ?").get(userId);
    if (cg?.stripe_account_id) {
      const ext = await stripe.accounts.listExternalAccounts(cg.stripe_account_id, { object: "bank_account", limit: 10 });
      for (const b of ext.data || []) {
        labels.push(`${b.bank_name || "Bank account"} ****${b.last4}`);
      }
    }
  } catch { /* not a caregiver / no Connect account */ }
  return [...new Set(labels)];
}

// True when the chosen ACH destination exactly matches a bank the requester
// has linked to InPlace — the approver sees a "verified" badge instead of
// having to trust a typed description.
async function isVerifiedPayout(db, userId, payout) {
  if (payout.payoutMethod !== "ach" || !payout.payoutDetails) return 0;
  try {
    const banks = await getLinkedBanks(db, userId);
    return banks.includes(payout.payoutDetails) ? 1 : 0;
  } catch { return 0; }
}

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
       paid_at, paid_method, paid_reference, paid_by, payout_method, payout_details, payout_verified)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, fields.careTeamId, fields.careRecipientId, fields.requestedBy, fields.payeeUserId,
    fields.amount, fields.description, fields.category, fields.expenseDate,
    fields.status, fields.selfRecorded ? 1 : 0, fields.approvedBy || null, fields.approvedAt || null,
    fields.paidAt || null, fields.paidMethod || null, fields.paidReference || null, fields.paidBy || null,
    fields.payoutMethod || null, fields.payoutDetails || null, fields.payoutVerified ? 1 : 0
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
    const payout = parsePayout(req.body);
    payout.payoutVerified = await isVerifiedPayout(db, req.user.id, payout);

    // Optional: save the requester's payout details for the settlement step
    if (typeof req.body.venmoHandle === "string" && req.body.venmoHandle.trim()) {
      const handle = req.body.venmoHandle.trim().replace(/^@/, "").slice(0, 60);
      await db.prepare("UPDATE users SET venmo_handle = ? WHERE id = ?").run(handle, req.user.id);
    }
    if (typeof req.body.zelleContact === "string" && req.body.zelleContact.trim()) {
      const zelle = req.body.zelleContact.trim().slice(0, 100);
      await db.prepare("UPDATE users SET zelle_contact = ? WHERE id = ?").run(zelle, req.user.id);
    }
    // v1.97.0 — remember the bank LABEL for next time (never account numbers)
    if (payout.payoutMethod === "ach" && payout.payoutDetails) {
      await db.prepare("UPDATE users SET bank_contact = ? WHERE id = ?").run(payout.payoutDetails, req.user.id);
    }

    const id = await insertReimbursement(db, {
      careTeamId: access.team.id, careRecipientId: access.team.care_recipient_id,
      requestedBy: req.user.id, payeeUserId: req.user.id,
      ...core, ...payout, status: "pending", selfRecorded: false,
    }, receipts);

    audit(req, "reimbursement_requested", { id, amount: core.amount, receipts: receipts.length });
    const requester = await db.prepare("SELECT first_name, last_name FROM users WHERE id = ?").get(req.user.id);
    const rName = requester ? `${requester.first_name} ${requester.last_name}` : "A team member";
    await feedEntry(db, access.team, "Reimbursement requested",
      `${rName} requested $${core.amount.toFixed(2)} — ${core.description}`);

    // Notify the approver — deep-links straight to the approval (v1.97.0)
    const approverId = access.team.billing_user_id
      || (await db.prepare("SELECT user_id FROM care_team_members WHERE care_team_id = ? AND role = 'leader' LIMIT 1").get(access.team.id))?.user_id;
    if (approverId && approverId !== req.user.id) {
      notify(req, approverId, "Reimbursement request — tap to review",
        `${rName} requested $${core.amount.toFixed(2)} — ${core.description}. Tap to approve or decline.`,
        { type: "reimbursement_request", reimbursementId: id, careTeamId: access.team.id, page: "care-team", focus: `reimbursement:${id}` });
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
    const u = await db.prepare("SELECT venmo_handle, zelle_contact, bank_contact FROM users WHERE id = ?").get(req.user.id);
    const linkedBanks = await getLinkedBanks(db, req.user.id);
    res.json({ venmoHandle: u?.venmo_handle || "", zelleContact: u?.zelle_contact || "", bankContact: u?.bank_contact || "", linkedBanks });
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
             r.payout_method, r.payout_details, r.paid_from_label, r.payout_verified, r.payout_status,
             r.requested_by, ru.first_name AS requester_first_name, ru.last_name AS requester_last_name,
             r.payee_user_id, pu.first_name AS payee_first_name, pu.last_name AS payee_last_name,
             pu.venmo_handle AS payee_venmo_handle, pu.zelle_contact AS payee_zelle_contact,
             pu.bank_contact AS payee_bank_contact, pu.stripe_onboard_complete AS payee_payout_ready,
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

// Human label for the requester's chosen "to" address.
function payoutLabel(row) {
  const d = row.payout_details;
  switch (row.payout_method) {
    case "inplace": return "Direct deposit through InPlace (ACH)";
    case "venmo": return d ? `Venmo @${d.replace(/^@/, "")}` : "Venmo";
    case "zelle": return d ? `Zelle ${d}` : "Zelle";
    case "ach": return d ? `bank transfer (ACH) — ${d}` : "bank transfer (ACH)";
    case "check": return "check";
    case "cash": return "cash";
    default: return row.payout_method || null;
  }
}

// v1.97.0 — "we all get notified": payee + team leader + billing contact,
// minus whoever performed the action. Every notification deep-links to the item.
async function notifyParties(db, req, ctx, title, body, type) {
  const targets = new Set([ctx.row.payee_user_id]);
  try {
    const leader = await db.prepare(
      "SELECT user_id FROM care_team_members WHERE care_team_id = ? AND role = 'leader' LIMIT 1"
    ).get(ctx.row.care_team_id);
    if (leader?.user_id) targets.add(leader.user_id);
  } catch {}
  if (ctx.access.team.billing_user_id) targets.add(ctx.access.team.billing_user_id);
  targets.delete(req.user.id);
  for (const uid of targets) {
    notify(req, uid, title, body,
      { type, reimbursementId: ctx.row.id, careTeamId: ctx.row.care_team_id, page: "care-team", focus: `reimbursement:${ctx.row.id}` });
  }
}

router.post("/:id/approve", async (req, res) => {
  try {
    const db = await getDb();
    const ctx = await loadForApprover(db, req, res);
    if (!ctx) return;
    if (ctx.row.status !== "pending") return res.status(400).json({ error: `Cannot approve a ${ctx.row.status} request` });

    // v1.97.0 — the approver confirms the "from" account (e.g. "Mom's checking")
    let fromAccountId = null, fromLabel = null;
    if (req.body.fromAccountId) {
      const acct = await db.prepare(
        "SELECT id, label FROM team_funding_accounts WHERE id = ? AND care_team_id = ?"
      ).get(req.body.fromAccountId, ctx.row.care_team_id);
      if (!acct) return res.status(400).json({ error: "Funding account not found for this team" });
      fromAccountId = acct.id; fromLabel = acct.label;
    } else if (typeof req.body.fromLabel === "string" && req.body.fromLabel.trim()) {
      fromLabel = req.body.fromLabel.trim().slice(0, 80);
      assertLabelOnly(fromLabel, "The from-account label");
    }

    await db.prepare(`
      UPDATE reimbursements SET status = 'approved', approved_by = ?, approved_at = NOW(),
        paid_from_account_id = ?, paid_from_label = ?, updated_at = NOW()
      WHERE id = ? AND status = 'pending'
    `).run(req.user.id, fromAccountId, fromLabel, req.params.id);

    audit(req, "reimbursement_approved", { id: req.params.id, amount: ctx.row.amount, fromLabel });
    await feedEntry(db, ctx.access.team, "Reimbursement approved",
      `$${Number(ctx.row.amount).toFixed(2)} — ${ctx.row.description}${fromLabel ? ` (from ${fromLabel})` : ""}`);
    const toLabel = payoutLabel(ctx.row);
    await notifyParties(db, req, ctx, "Reimbursement approved",
      `$${Number(ctx.row.amount).toFixed(2)} approved${toLabel ? ` — paying via ${toLabel}` : ""}${fromLabel ? ` from ${fromLabel}` : ""}`,
      "reimbursement_approved");
    res.json({ message: "Approved", fromLabel });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
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
    await notifyParties(db, req, ctx, "Reimbursement declined",
      reason ? `Declined: ${reason}` : "The reimbursement request was declined",
      "reimbursement_declined");
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

    // Optional "from" account at payment time (kept if already set at approval)
    let fromAccountId = null, fromLabel = null;
    if (req.body.fromAccountId) {
      const acct = await db.prepare(
        "SELECT id, label FROM team_funding_accounts WHERE id = ? AND care_team_id = ?"
      ).get(req.body.fromAccountId, ctx.row.care_team_id);
      if (acct) { fromAccountId = acct.id; fromLabel = acct.label; }
    }

    await db.prepare(`
      UPDATE reimbursements SET status = 'paid', paid_at = NOW(), paid_method = ?, paid_reference = ?, paid_by = ?,
        approved_by = COALESCE(approved_by, ?), approved_at = COALESCE(approved_at, NOW()),
        paid_from_account_id = COALESCE(?, paid_from_account_id),
        paid_from_label = COALESCE(?, paid_from_label), updated_at = NOW()
      WHERE id = ? AND status IN ('approved', 'pending')
    `).run(method, reference, req.user.id, req.user.id, fromAccountId, fromLabel, req.params.id);

    const finalFrom = fromLabel || ctx.row.paid_from_label;
    const methodLabel = method === "bank" ? "bank transfer (ACH)" : method;
    audit(req, "reimbursement_paid", { id: req.params.id, amount: ctx.row.amount, method, reference, fromLabel: finalFrom });
    await feedEntry(db, ctx.access.team, "Reimbursement paid",
      `$${Number(ctx.row.amount).toFixed(2)} — ${ctx.row.description} (via ${methodLabel}${finalFrom ? ` from ${finalFrom}` : ""})`);
    await notifyParties(db, req, ctx, "Reimbursement paid",
      `$${Number(ctx.row.amount).toFixed(2)} sent via ${methodLabel}${finalFrom ? ` from ${finalFrom}` : ""}`,
      "reimbursement_paid");
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

// ── PUT /:id — requester edits a still-pending request (v1.97.0) ──
// Amount, description, category, expense date, and the "to" payout choice can
// change until the approver acts — no more withdraw-and-resubmit. Receipts are
// unchanged by edits (withdraw and resubmit if the receipt itself is wrong).
router.put("/:id", async (req, res) => {
  try {
    const db = await getDb();
    const row = await db.prepare("SELECT * FROM reimbursements WHERE id = ?").get(req.params.id);
    if (!row) return res.status(404).json({ error: "Reimbursement not found" });
    if (row.requested_by !== req.user.id) return res.status(403).json({ error: "Only the requester can edit" });
    if (row.status !== "pending") return res.status(400).json({ error: `Cannot edit a ${row.status} request — only pending ones` });

    const core = validateCore(req.body);
    const payout = parsePayout(req.body);
    const payoutVerified = await isVerifiedPayout(db, req.user.id, payout);
    await db.prepare(`
      UPDATE reimbursements SET amount = ?, description = ?, category = ?, expense_date = ?,
        payout_method = ?, payout_details = ?, payout_verified = ?, updated_at = NOW()
      WHERE id = ? AND status = 'pending'
    `).run(core.amount, core.description, core.category, core.expenseDate,
      payout.payoutMethod, payout.payoutDetails, payoutVerified, req.params.id);

    // Remember payout details for next time (labels only, never account numbers)
    if (payout.payoutMethod === "venmo" && payout.payoutDetails) {
      await db.prepare("UPDATE users SET venmo_handle = ? WHERE id = ?").run(payout.payoutDetails.replace(/^@/, ""), req.user.id);
    } else if (payout.payoutMethod === "zelle" && payout.payoutDetails) {
      await db.prepare("UPDATE users SET zelle_contact = ? WHERE id = ?").run(payout.payoutDetails, req.user.id);
    } else if (payout.payoutMethod === "ach" && payout.payoutDetails) {
      await db.prepare("UPDATE users SET bank_contact = ? WHERE id = ?").run(payout.payoutDetails, req.user.id);
    }

    audit(req, "reimbursement_updated", { id: req.params.id, amount: core.amount, payoutMethod: payout.payoutMethod });
    // Tell the approver the pending request changed (deep-linked)
    const access = await teamAccess(db, row.care_team_id, req.user.id);
    const approverId = access?.team?.billing_user_id
      || (await db.prepare("SELECT user_id FROM care_team_members WHERE care_team_id = ? AND role = 'leader' LIMIT 1").get(row.care_team_id))?.user_id;
    if (approverId && approverId !== req.user.id) {
      const requester = await db.prepare("SELECT first_name, last_name FROM users WHERE id = ?").get(req.user.id);
      const rName = requester ? `${requester.first_name} ${requester.last_name}` : "A team member";
      notify(req, approverId, "Reimbursement request updated — tap to review",
        `${rName} updated their request: $${core.amount.toFixed(2)} — ${core.description}`,
        { type: "reimbursement_request", reimbursementId: req.params.id, careTeamId: row.care_team_id, page: "care-team", focus: `reimbursement:${req.params.id}` });
    }
    res.json({ message: "Request updated" });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error("Edit reimbursement error:", err);
    captureException(err, { where: "reimbursements: edit" });
    res.status(500).json({ error: "Failed to update request" });
  }
});

// ═══ Team funding accounts (v1.97.0) ═══
// The approver's named "from" addresses ("Mom's checking ****1234").
// Labels only — InPlace never stores account or routing numbers; the actual
// transfer happens in the family's own banking app.
const FUNDING_TYPES = ["bank", "venmo", "zelle", "card", "other"];

router.get("/accounts/:teamId", async (req, res) => {
  try {
    const db = await getDb();
    const access = await teamAccess(db, req.params.teamId, req.user.id);
    if (!access || !access.canView) return res.status(404).json({ error: "Care team not found" });
    if (!access.isApprover && access.role !== "leader") return res.status(403).json({ error: "Only the billing contact or team leader can view funding accounts" });
    const accounts = await db.prepare(
      "SELECT id, label, type, is_default, created_at FROM team_funding_accounts WHERE care_team_id = ? ORDER BY is_default DESC, created_at ASC"
    ).all(req.params.teamId);
    // v1.97.1 — banks the viewer already linked to InPlace, offered as one-tap adds
    const linkedBanks = await getLinkedBanks(db, req.user.id);
    res.json({ accounts, linkedBanks });
  } catch (err) {
    captureException(err, { where: "reimbursements: accounts list" });
    res.status(500).json({ error: "Failed to load funding accounts" });
  }
});

router.post("/accounts/:teamId", async (req, res) => {
  try {
    const db = await getDb();
    const access = await teamAccess(db, req.params.teamId, req.user.id);
    if (!access || !access.canView) return res.status(404).json({ error: "Care team not found" });
    if (!access.isApprover) return res.status(403).json({ error: "Only the billing contact (or team leader) can add funding accounts" });
    const label = (req.body.label || "").trim().slice(0, 80);
    if (!label) return res.status(400).json({ error: "A label is required (e.g. \"Mom's checking ****1234\")" });
    assertLabelOnly(label, "The account label");
    const type = FUNDING_TYPES.includes(req.body.type) ? req.body.type : "bank";
    const id = uuid();
    if (req.body.isDefault) {
      await db.prepare("UPDATE team_funding_accounts SET is_default = 0 WHERE care_team_id = ?").run(req.params.teamId);
    }
    await db.prepare(
      "INSERT INTO team_funding_accounts (id, care_team_id, label, type, is_default, created_by) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(id, req.params.teamId, label, type, req.body.isDefault ? 1 : 0, req.user.id);
    audit(req, "funding_account_added", { id, teamId: req.params.teamId, label, type });
    res.status(201).json({ id, label, type });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    captureException(err, { where: "reimbursements: accounts add" });
    res.status(500).json({ error: "Failed to add funding account" });
  }
});

router.delete("/accounts/:accountId", async (req, res) => {
  try {
    const db = await getDb();
    const acct = await db.prepare("SELECT * FROM team_funding_accounts WHERE id = ?").get(req.params.accountId);
    if (!acct) return res.status(404).json({ error: "Funding account not found" });
    const access = await teamAccess(db, acct.care_team_id, req.user.id);
    if (!access || !access.isApprover) return res.status(403).json({ error: "Only the billing contact (or team leader) can remove funding accounts" });
    // Past reimbursements keep their paid_from_label snapshot
    await db.prepare("DELETE FROM team_funding_accounts WHERE id = ?").run(req.params.accountId);
    audit(req, "funding_account_removed", { id: req.params.accountId, label: acct.label });
    res.json({ message: "Removed" });
  } catch (err) {
    captureException(err, { where: "reimbursements: accounts delete" });
    res.status(500).json({ error: "Failed to remove funding account" });
  }
});


// ═══ In-app ACH payouts (v1.98.0) ═══
// Just-in-time "get paid back through InPlace" onboarding + the actual money
// movement. Paying and receiving are SEPARATE Stripe objects:
//   • pay-IN  = a Stripe Customer + saved payment method (handled by
//               /api/payments/family/setup — that's the "how you pay" link)
//   • pay-OUT = a Stripe Connect account + payout bank (this section)
// A user must complete payout onboarding once before anyone can send them an
// in-app ACH reimbursement. Reuses the exact Connect pattern from caregivers.

// GET /api/reimbursements/payout/status — is the CURRENT user set up to receive?
router.get("/payout/status", async (req, res) => {
  try {
    const db = await getDb();
    let stripe;
    try { stripe = require("./payments").getStripe(); }
    catch { return res.json({ onboarded: false, available: false, reason: "not_configured" }); }

    const u = await db.prepare("SELECT stripe_account_id, stripe_onboard_complete FROM users WHERE id = ?").get(req.user.id);
    if (!u?.stripe_account_id) return res.json({ onboarded: false, available: true, started: false });

    // Trust the cached flag but refresh from Stripe so a just-finished
    // onboarding reflects immediately (webhook may lag a few seconds).
    let chargesEnabled = false, payoutsEnabled = false, bankLabel = null;
    try {
      const acct = await stripe.accounts.retrieve(u.stripe_account_id);
      chargesEnabled = !!acct.charges_enabled;
      payoutsEnabled = !!acct.payouts_enabled;
      const ext = (acct.external_accounts?.data || []).find((e) => e.object === "bank_account");
      if (ext) bankLabel = `${ext.bank_name || "Bank account"} ****${ext.last4}`;
      const complete = chargesEnabled && payoutsEnabled;
      if (complete && !u.stripe_onboard_complete) {
        await db.prepare("UPDATE users SET stripe_onboard_complete = 1, updated_at = NOW() WHERE id = ?").run(req.user.id);
      }
    } catch { /* fall back to cached flag */ chargesEnabled = payoutsEnabled = !!u.stripe_onboard_complete; }

    res.json({
      onboarded: chargesEnabled && payoutsEnabled,
      available: true, started: true,
      chargesEnabled, payoutsEnabled, bankLabel,
    });
  } catch (err) {
    captureException(err, { where: "reimbursements: payout status" });
    res.status(500).json({ error: "Failed to load payout status" });
  }
});

// POST /api/reimbursements/payout/onboard-link — create/continue Connect onboarding
// Returns a Stripe-hosted onboarding URL (identity + payout bank + ToS).
router.post("/payout/onboard-link", async (req, res) => {
  try {
    const db = await getDb();
    let stripe;
    try { stripe = require("./payments").getStripe(); }
    catch { return res.status(503).json({ error: "Payments aren't set up on this environment yet.", notConfigured: true }); }

    const user = await db.prepare("SELECT id, email, first_name, last_name, stripe_account_id FROM users WHERE id = ?").get(req.user.id);
    let accountId = user.stripe_account_id;
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: "express",
        country: "US",
        email: user.email,
        // Stripe requires card_payments alongside transfers unless the platform
        // has special approval — request both (matches caregiver onboarding).
        capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
        business_type: "individual",
        individual: { first_name: user.first_name, last_name: user.last_name, email: user.email },
        business_profile: { mcc: "8099", url: "https://inplace.care", product_description: "Family care-expense reimbursements" },
        metadata: { inplace_user_id: req.user.id, inplace_purpose: "reimbursement_payout" },
      });
      accountId = account.id;
      await db.prepare("UPDATE users SET stripe_account_id = ?, stripe_onboard_complete = 0, updated_at = NOW() WHERE id = ?").run(accountId, req.user.id);
      audit(req, "payout_account_created", { accountId });
    }

    const origin = `${req.protocol}://${req.get("host")}`;
    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${origin}/?page=account&payoutRefresh=1`,
      return_url: `${origin}/?page=account&payoutComplete=1`,
      type: "account_onboarding",
    });
    res.json({ url: link.url });
  } catch (err) {
    console.error("Payout onboard-link error:", err.message);
    captureException(err, { where: "reimbursements: payout onboard" });
    res.status(500).json({ error: "Couldn't start direct-deposit setup. Please try again." });
  }
});

// POST /api/reimbursements/:id/pay-ach — approver sends the money in-app
// Charges the approver's saved bank (ACH debit) → destination charge to the
// payee's Connect account → Stripe pays out to the payee's bank. Fee-on-top:
// the payer is charged amount + Stripe's ACH fee; the payee receives the exact
// requested amount. ACH settles asynchronously (webhook flips to paid/failed).
router.post("/:id/pay-ach", async (req, res) => {
  try {
    const db = await getDb();
    let stripe;
    try { stripe = require("./payments").getStripe(); }
    catch { return res.status(503).json({ error: "Payments aren't configured.", notConfigured: true }); }

    const ctx = await loadForApprover(db, req, res);
    if (!ctx) return;
    if (!["pending", "approved"].includes(ctx.row.status)) {
      return res.status(400).json({ error: `Can't pay a ${ctx.row.status} request` });
    }
    if (ctx.row.payout_status === "processing" || ctx.row.payout_status === "succeeded") {
      return res.status(400).json({ error: "This reimbursement is already being paid through InPlace." });
    }

    // Payee must be set up to RECEIVE
    const payee = await db.prepare("SELECT id, first_name, stripe_account_id, stripe_onboard_complete FROM users WHERE id = ?").get(ctx.row.payee_user_id);
    if (!payee?.stripe_account_id || !payee.stripe_onboard_complete) {
      return res.status(400).json({ error: `${payee?.first_name || "The payee"} hasn't set up direct deposit yet — they'll get a nudge to finish it.`, code: "payee_not_ready" });
    }

    // Payer (the approver) pays from a saved method. Prefer a bank (cheap ACH,
    // 0.8% capped $5); fall back to their saved card (2.9% + 30¢) — the billing
    // contact often has a card on file rather than a bank. Fee rides on top
    // either way, so the payee always nets the exact requested amount.
    const payer = await db.prepare("SELECT stripe_customer_id FROM users WHERE id = ?").get(req.user.id);
    if (!payer?.stripe_customer_id) {
      return res.status(400).json({ error: "Add a payment method to pay from first.", code: "needs_payer_method" });
    }
    let pm = null, method = null;
    const banks = await stripe.paymentMethods.list({ customer: payer.stripe_customer_id, type: "us_bank_account", limit: 1 });
    if (banks.data.length) { pm = banks.data[0]; method = "us_bank_account"; }
    else {
      const cards = await stripe.paymentMethods.list({ customer: payer.stripe_customer_id, type: "card", limit: 1 });
      if (cards.data.length) { pm = cards.data[0]; method = "card"; }
    }
    if (!pm) {
      return res.status(400).json({ error: "Add a payment method to pay from first.", code: "needs_payer_method" });
    }

    const baseCents = Math.round(Number(ctx.row.amount) * 100);
    // Fee on top: bank = 0.8% capped $5; card = 2.9% + 30¢ (Stripe's card cost)
    const feeCents = method === "card" ? (Math.round(baseCents * 0.029) + 30) : achFeeCents(baseCents);
    const totalCents = baseCents + feeCents;
    if (totalCents < 50) return res.status(400).json({ error: "Amount too small to send (Stripe minimum is $0.50)." });

    let intent;
    try {
      intent = await stripe.paymentIntents.create({
        amount: totalCents,
        currency: "usd",
        customer: payer.stripe_customer_id,
        payment_method: pm.id,
        payment_method_types: [method],
        confirm: true,
        off_session: true, // approver already authorized by tapping Pay; mirrors auto-pay's proven saved-method charge
        application_fee_amount: feeCents, // platform keeps the fee portion; Stripe's cut comes out of it → payee nets exactly baseCents
        transfer_data: { destination: payee.stripe_account_id },
        metadata: {
          inplace_reimbursement_id: ctx.row.id,
          inplace_team_id: ctx.row.care_team_id,
          inplace_payer_user_id: req.user.id,
          inplace_payee_user_id: payee.id,
        },
        description: `InPlace reimbursement: $${(baseCents / 100).toFixed(2)} — ${ctx.row.description}`.slice(0, 200),
      });
    } catch (stripeErr) {
      console.error("pay-ach PaymentIntent error:", stripeErr.message, stripeErr.code);
      // Off-session cards can require authentication — tell the payer plainly
      if (stripeErr.code === "authentication_required") {
        return res.status(400).json({ error: "Your card needs verification for this charge. Try a bank account, or use the card in the Payments tab first." });
      }
      return res.status(400).json({ error: stripeErr.message || "The charge was declined. Please try another payment method." });
    }

    // Card charges settle instantly ('succeeded'); ACH goes 'processing' for ~1-4 biz days
    if (["processing", "succeeded", "requires_capture"].includes(intent.status)) {
      const fromLabel = method === "card"
        ? `${(pm.card.brand || "Card").charAt(0).toUpperCase() + (pm.card.brand || "card").slice(1)} ****${pm.card.last4}`
        : `${pm.us_bank_account.bank_name || "Bank"} ****${pm.us_bank_account.last4}`;
      const isInstant = intent.status === "succeeded";
      await db.prepare(`
        UPDATE reimbursements SET status = 'paid', paid_method = 'ach_inplace', paid_reference = ?,
          stripe_payment_intent = ?, payout_status = ?, paid_by = ?, paid_at = NOW(),
          paid_from_label = COALESCE(paid_from_label, ?),
          approved_by = COALESCE(approved_by, ?), approved_at = COALESCE(approved_at, NOW()), updated_at = NOW()
        WHERE id = ? AND status IN ('pending', 'approved')
      `).run(intent.id, intent.id, isInstant ? "succeeded" : "processing", req.user.id, fromLabel, req.user.id, ctx.row.id);

      audit(req, "reimbursement_paid_ach", { id: ctx.row.id, amount: ctx.row.amount, method, feeCents, paymentIntent: intent.id });
      await feedEntry(db, ctx.access.team, "Reimbursement paid",
        `$${(baseCents / 100).toFixed(2)} — ${ctx.row.description} (paid via InPlace from ${fromLabel})`);
      const arrival = isInstant ? "and should land shortly" : "— arrives in ~1–3 business days";
      await notifyParties(db, req, ctx, "Reimbursement sent",
        `$${(baseCents / 100).toFixed(2)} is on its way to ${payee.first_name} through InPlace ${arrival}.`,
        "reimbursement_paid");
      return res.json({ ok: true, status: intent.status, method, feeCents, totalCents });
    }

    if (intent.status === "requires_action") {
      // Rare for ACH; hand back to the client to complete
      return res.json({ requiresAction: true, clientSecret: intent.client_secret });
    }
    return res.status(400).json({ error: `Payment is in an unexpected state (${intent.status}). Nothing was charged twice — please check the Payments tab.` });
  } catch (err) {
    console.error("pay-ach error:", err);
    captureException(err, { where: "reimbursements: pay-ach" });
    res.status(500).json({ error: "Failed to send payment" });
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
            data: { type: "reimbursement_recurring", reimbursementId: occurrenceId, careTeamId: sch.care_team_id, page: "care-team", focus: `reimbursement:${occurrenceId}` },
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
        { type: "reimbursement_schedule_request", scheduleId: id, careTeamId: access.team.id, page: "care-team", focus: `schedule:${id}` });
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
      { type: "reimbursement_schedule_approved", scheduleId: req.params.id, careTeamId: ctx.sch.care_team_id, page: "care-team", focus: `schedule:${req.params.id}` });
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
      { type: "reimbursement_schedule_declined", scheduleId: req.params.id, careTeamId: ctx.sch.care_team_id, page: "care-team", focus: `schedule:${req.params.id}` });
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
             r.payout_method, r.payout_details, r.paid_from_label,
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
// v1.97.0 — exported for unit tests only
module.exports._test = { parsePayout, assertLabelOnly, payoutLabel, achFeeCents };
