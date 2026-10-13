/**
 * Caregiver outreach (v1.113.0) — Admin → Outreach + the inbound SMS webhook.
 *
 *   this file          → /api/admin/outreach  (mounted after /api/admin, so its network gate runs first)
 *   smsWebhooks.js     → /api/sms             (public: Twilio posts there; every request is signature-checked)
 *
 * The loop, as Pete asked for it: an intro text goes out from InPlace's outreach number; a reply
 * comes back to the app, not his phone; a reply containing an email address is answered for him —
 * she gets a branded signup invite by email and a text saying so — and only the replies that need
 * a person show up as unread. See src/utils/outreach.js for the why of the dedicated number.
 */
const express = require("express");
const crypto = require("crypto");
const { v4: uuid } = require("uuid");
const { getDb } = require("../models/database");
const { authenticate, requireAdmin } = require("../middleware/auth");
const { checkAdmin } = require("./admin/shared");
const { captureException } = require("../utils/sentry");
const { sendSms, outreachNumber } = require("../utils/sms");
const { sendEmail, brandedHtml } = require("../utils/email");
const O = require("../utils/outreach");

const APP_URL = (process.env.APP_URL || "https://yourinplace.com").replace(/\/+$/, "");
const REPLY_TO = process.env.OUTREACH_REPLY_TO || "peter@yourinplace.com";
const INVITE_DAYS = 30;
const SEND_GAP_MS = 1500;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ─── Shared ───

// The account she already has, if any — by email, or by the last 10 digits of her phone.
const JOINED_SQL = `(
  SELECT u.id FROM users u
   WHERE COALESCE(u.is_demo, 0) = 0
     AND ( (c.email IS NOT NULL AND LOWER(u.email) = LOWER(c.email))
        OR (u.phone IS NOT NULL AND RIGHT(REGEXP_REPLACE(u.phone, '[^0-9]', '', 'g'), 10) = RIGHT(c.phone, 10)) )
   ORDER BY u.created_at ASC LIMIT 1
)`;

async function loadContact(db, id) {
  return db.prepare(`SELECT c.*, ${JOINED_SQL} AS joined_user_id FROM outreach_contacts c WHERE c.id = ?`).get(id);
}

function statusCallbackUrl() {
  return `${APP_URL}/api/sms/outreach-status`;
}

/** Send one text to a contact and record it. Never throws. */
async function sendToContact(db, contact, body, { sentBy = null, automated = false, intro = false } = {}) {
  // STOP is final from our side. Checked here, at the one place a text leaves, so no path —
  // batch, reply, or an automated thank-you — can talk past it.
  const fresh = await db.prepare("SELECT opted_out_at, status FROM outreach_contacts WHERE id = ?").get(contact.id);
  if (!fresh || fresh.opted_out_at || fresh.status === "opted_out") return { ok: false, error: "Opted out" };
  const from = outreachNumber();
  const id = uuid();
  await db.prepare(`
    INSERT INTO outreach_messages (id, contact_id, direction, body, status, automated, sent_by, created_at)
    VALUES (?, ?, 'out', ?, 'sending', ?, ?, NOW())
  `).run(id, contact.id, body, automated ? 1 : 0, sentBy);
  if (!from) {
    await db.prepare("UPDATE outreach_messages SET status = 'failed', error = ? WHERE id = ?")
      .run("Outreach number not configured (TWILIO_OUTREACH_NUMBER)", id);
    return { ok: false, error: "Outreach number not configured" };
  }
  const r = await sendSms(contact.phone, body, { from, statusCallback: statusCallbackUrl() });
  if (r.success) {
    await db.prepare("UPDATE outreach_messages SET status = ?, twilio_sid = ? WHERE id = ?").run(r.status || "queued", r.sid, id);
    await db.prepare(`
      UPDATE outreach_contacts
         SET last_message_at = NOW(), updated_at = NOW(),
             intro_sent_at = CASE WHEN ? = 1 THEN COALESCE(intro_sent_at, NOW()) ELSE intro_sent_at END,
             status = CASE WHEN status = 'new' THEN 'texted' ELSE status END
       WHERE id = ?
    `).run(intro ? 1 : 0, contact.id);
    return { ok: true, id };
  }
  await db.prepare("UPDATE outreach_messages SET status = 'failed', error = ? WHERE id = ?").run(String(r.error || "send failed").slice(0, 500), id);
  return { ok: false, error: r.error };
}

/**
 * Email her a branded caregiver signup invite. Reuses a still-pending invite for the same email
 * (so a second "here's my email" never mints a second link). Returns { ok, status, inviteId }.
 */
async function inviteContact(db, contact, invitedBy) {
  const email = String(contact.email || "").trim().toLowerCase();
  if (!email) return { ok: false, error: "No email address on file" };

  const existingUser = await db.prepare("SELECT id FROM users WHERE LOWER(email) = ?").get(email);
  if (existingUser) {
    await db.prepare("UPDATE outreach_contacts SET status = 'joined', updated_at = NOW() WHERE id = ?").run(contact.id);
    return { ok: true, status: "joined" };
  }

  let invite = await db.prepare(
    "SELECT id, token FROM platform_invites WHERE LOWER(invited_email) = ? AND status = 'pending' AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1"
  ).get(email);
  if (!invite) {
    // invited_by is NOT NULL REFERENCES users — on the webhook path there is no signed-in admin,
    // so the invite is from the admin who imported her (or, failing that, any admin).
    let by = invitedBy || contact.created_by;
    if (!by) by = (await db.prepare("SELECT id FROM users WHERE is_admin = 1 ORDER BY created_at ASC LIMIT 1").get())?.id;
    if (!by) return { ok: false, error: "No admin to send the invite from" };
    invite = { id: uuid(), token: crypto.randomBytes(32).toString("hex") };
    const expiresAt = new Date(Date.now() + INVITE_DAYS * 86400000).toISOString();
    const name = [contact.first_name, contact.last_name].filter(Boolean).join(" ") || null;
    await db.prepare(`
      INSERT INTO platform_invites (id, invited_email, invited_by, role, token, status, expires_at, kind, invited_name, phone)
      VALUES (?, ?, ?, 'caregiver', ?, 'pending', ?, 'outreach', ?, ?)
    `).run(invite.id, email, by, invite.token, expiresAt, name, contact.phone);
  }

  const first = O.greetingName(contact);
  const inviteUrl = `${APP_URL}?platformInvite=${invite.token}`;
  const sent = await sendEmail({
    to: email,
    replyTo: REPLY_TO,
    subject: "Caregiving work with local families — InPlace",
    html: brandedHtml({
      title: "Welcome to InPlace",
      greeting: `Hi ${esc(first === "there" ? "" : first) || "there"}, thanks for writing back.`,
      body: [
        "InPlace is a local app, built here in the New River Valley, that connects families with caregivers for companionship, help around the house, errands and rides.",
        "<br><br><b>How it works for you:</b><br>",
        "&bull; You set your own rate, and you keep all of it. The family pays InPlace's fee on top.<br>",
        "&bull; Families find you, send you offers, and you choose which visits to take.<br>",
        "&bull; You're paid through the app after each visit &mdash; no chasing checks.<br>",
        "&bull; We ask for a photo ID and run a background check. That's what lets families trust you.",
        "<br><br>Signing up takes a few minutes. Or just reply to this email with a good time to talk, and Pete Lee will call you.",
      ].join(""),
      ctaUrl: inviteUrl,
      ctaText: "Sign up as a caregiver",
      footnote: `This link is just for you and works for ${INVITE_DAYS} days. Questions? Reply to this email.`,
    }),
  });
  if (!sent.success && !sent.suppressed) return { ok: false, error: sent.error || "Email failed" };
  await db.prepare("UPDATE outreach_contacts SET status = 'invited', invite_id = ?, updated_at = NOW() WHERE id = ?").run(invite.id, contact.id);
  return { ok: true, status: "invited", inviteId: invite.id };
}

// ═══════════════════════════════════════════════════════════
// Admin — /api/admin/outreach
// ═══════════════════════════════════════════════════════════
const adminRouter = express.Router();
adminRouter.use(authenticate, checkAdmin, requireAdmin);

let introRun = null; // { total, sent, failed, startedAt } while a batch is going out

adminRouter.get("/", async (req, res) => {
  try {
    const db = await getDb();
    const rows = await db.prepare(`
      SELECT c.*, ${JOINED_SQL} AS joined_user_id,
             (SELECT m.body FROM outreach_messages m WHERE m.contact_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_body,
             (SELECT m.direction FROM outreach_messages m WHERE m.contact_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_direction,
             (SELECT COUNT(*) FROM outreach_messages m WHERE m.contact_id = c.id AND m.direction = 'out' AND m.status IN ('failed','undelivered')) AS failed_count
        FROM outreach_contacts c
       ORDER BY c.unread DESC, c.last_inbound_at DESC NULLS LAST, c.last_name ASC NULLS LAST, c.first_name ASC
    `).all();
    // "joined" is a fact about the users table, so it wins over whatever status was stored.
    const contacts = rows.map((r) => ({ ...r, status: r.joined_user_id && r.status !== "opted_out" ? "joined" : r.status }));
    const win = O.introWindow();
    res.json({
      contacts,
      statuses: O.OUTREACH_STATUSES,
      defaultIntro: O.DEFAULT_INTRO,
      number: outreachNumber(),
      introWindow: win,
      sending: introRun,
    });
  } catch (err) {
    captureException(err, { where: "outreach: list" });
    res.status(500).json({ error: "Failed to load outreach" });
  }
});

adminRouter.post("/import", async (req, res) => {
  try {
    const text = String(req.body?.text || "");
    if (!text.trim()) return res.status(400).json({ error: "Paste at least one line with a name and phone number." });
    if (text.length > 60000) return res.status(400).json({ error: "That's too long — import in smaller batches." });
    const source = String(req.body?.source || "").trim().slice(0, 120) || null;
    const { contacts, skipped } = O.parseList(text);
    const db = await getDb();
    let added = 0, duplicates = 0;
    for (const c of contacts) {
      const r = await db.prepare(`
        INSERT INTO outreach_contacts (id, first_name, last_name, phone, notes, source, status, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'new', ?, NOW(), NOW())
        ON CONFLICT (phone) DO NOTHING
      `).run(uuid(), c.first_name || null, c.last_name || null, c.phone, c.notes, source, req.user.id);
      if (r && r.changes === 0) duplicates++; else added++;
    }
    res.json({ added, duplicates, skipped });
  } catch (err) {
    captureException(err, { where: "outreach: import" });
    res.status(500).json({ error: "Import failed" });
  }
});

adminRouter.post("/send-intro", async (req, res) => {
  try {
    if (!outreachNumber()) return res.status(400).json({ error: "The outreach number isn't set up yet (TWILIO_OUTREACH_NUMBER)." });
    const win = O.introWindow();
    if (!win.open) return res.status(400).json({ error: win.reason });
    if (introRun) return res.status(409).json({ error: "A batch is already going out." });
    const template = String(req.body?.template || "").trim();
    if (!template) return res.status(400).json({ error: "Write the message first." });
    if (template.length > 640) return res.status(400).json({ error: "Keep the intro under 640 characters." });
    if (!/stop/i.test(template)) return res.status(400).json({ error: "The intro must tell people how to opt out (e.g. \"Reply STOP to opt out\")." });
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.slice(0, 200) : [];
    if (!ids.length) return res.status(400).json({ error: "Pick at least one person." });

    const db = await getDb();
    const targets = [];
    for (const id of ids) {
      const c = await loadContact(db, id);
      // Only people never texted, never opted out, not already on InPlace.
      if (c && c.status === "new" && !c.opted_out_at && !c.intro_sent_at && !c.joined_user_id) targets.push(c);
    }
    if (!targets.length) return res.status(400).json({ error: "None of those people can get an intro (already texted, opted out, or already on InPlace)." });

    introRun = { total: targets.length, sent: 0, failed: 0, startedAt: new Date().toISOString() };
    res.json({ queued: targets.length, skipped: ids.length - targets.length });

    const by = req.user.id;
    (async () => {
      try {
        for (const c of targets) {
          const r = await sendToContact(db, c, O.renderTemplate(template, c), { sentBy: by, intro: true });
          if (r.ok) introRun.sent++; else introRun.failed++;
          await new Promise((ok) => setTimeout(ok, SEND_GAP_MS));
        }
      } catch (err) {
        captureException(err, { where: "outreach: intro batch" });
      } finally {
        introRun = null;
      }
    })();
  } catch (err) {
    introRun = null;
    captureException(err, { where: "outreach: send intro" });
    if (!res.headersSent) res.status(500).json({ error: "Failed to start sending" });
  }
});

adminRouter.get("/:id/messages", async (req, res) => {
  try {
    const db = await getDb();
    const contact = await loadContact(db, req.params.id);
    if (!contact) return res.status(404).json({ error: "Not found" });
    const messages = await db.prepare(`
      SELECT m.*, u.first_name AS sender_first_name
        FROM outreach_messages m LEFT JOIN users u ON u.id = m.sent_by
       WHERE m.contact_id = ? ORDER BY m.created_at ASC
    `).all(contact.id);
    if (contact.unread) await db.prepare("UPDATE outreach_contacts SET unread = 0 WHERE id = ?").run(contact.id);
    res.json({ contact: { ...contact, unread: 0 }, messages });
  } catch (err) {
    captureException(err, { where: "outreach: thread" });
    res.status(500).json({ error: "Failed to load the conversation" });
  }
});

adminRouter.post("/:id/messages", async (req, res) => {
  try {
    const body = String(req.body?.body || "").trim();
    if (!body) return res.status(400).json({ error: "Write a message first." });
    if (body.length > 1000) return res.status(400).json({ error: "That message is too long." });
    if (!outreachNumber()) return res.status(400).json({ error: "The outreach number isn't set up yet (TWILIO_OUTREACH_NUMBER)." });
    const db = await getDb();
    const contact = await loadContact(db, req.params.id);
    if (!contact) return res.status(404).json({ error: "Not found" });
    if (contact.opted_out_at || contact.status === "opted_out") return res.status(400).json({ error: "She replied STOP. InPlace can't text her again unless she texts START." });
    // A first text to someone who has never written back is a cold text: same hours as the intro.
    if (!contact.last_inbound_at) {
      const win = O.introWindow();
      if (!win.open) return res.status(400).json({ error: win.reason });
    }
    const r = await sendToContact(db, contact, body, { sentBy: req.user.id, intro: !contact.intro_sent_at });
    if (!r.ok) return res.status(502).json({ error: `Text didn't send: ${r.error}` });
    res.json({ ok: true });
  } catch (err) {
    captureException(err, { where: "outreach: send one" });
    res.status(500).json({ error: "Failed to send" });
  }
});

adminRouter.post("/:id/invite", async (req, res) => {
  try {
    const db = await getDb();
    const contact = await loadContact(db, req.params.id);
    if (!contact) return res.status(404).json({ error: "Not found" });
    const email = req.body?.email ? String(req.body.email).trim().toLowerCase() : null;
    if (email) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "That email doesn't look right." });
      await db.prepare("UPDATE outreach_contacts SET email = ?, updated_at = NOW() WHERE id = ?").run(email, contact.id);
      contact.email = email;
    }
    const r = await inviteContact(db, contact, req.user.id);
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, status: r.status });
  } catch (err) {
    captureException(err, { where: "outreach: invite" });
    res.status(500).json({ error: "Failed to send the invite" });
  }
});

adminRouter.patch("/:id", async (req, res) => {
  try {
    const db = await getDb();
    const contact = await loadContact(db, req.params.id);
    if (!contact) return res.status(404).json({ error: "Not found" });
    const b = req.body || {};
    const next = {
      first_name: b.first_name !== undefined ? String(b.first_name).trim().slice(0, 80) || null : contact.first_name,
      last_name: b.last_name !== undefined ? String(b.last_name).trim().slice(0, 80) || null : contact.last_name,
      notes: b.notes !== undefined ? String(b.notes).trim().slice(0, 2000) || null : contact.notes,
      email: b.email !== undefined ? String(b.email).trim().toLowerCase().slice(0, 200) || null : contact.email,
      status: contact.status,
    };
    if (b.status !== undefined) {
      if (!O.OUTREACH_STATUSES.includes(b.status)) return res.status(400).json({ error: "Unknown status" });
      // Opt-out belongs to her. Admin can record one (she said "don't text me" on a call), but
      // can never clear one — only her START does that.
      if (contact.status === "opted_out" && b.status !== "opted_out") return res.status(400).json({ error: "She opted out. Only she can opt back in, by texting START." });
      next.status = b.status;
    }
    await db.prepare(`
      UPDATE outreach_contacts SET first_name = ?, last_name = ?, notes = ?, email = ?, status = ?,
             opted_out_at = CASE WHEN ? = 'opted_out' THEN COALESCE(opted_out_at, NOW()) ELSE opted_out_at END,
             updated_at = NOW()
       WHERE id = ?
    `).run(next.first_name, next.last_name, next.notes, next.email, next.status, next.status, contact.id);
    res.json({ contact: await loadContact(db, contact.id) });
  } catch (err) {
    captureException(err, { where: "outreach: update" });
    res.status(500).json({ error: "Failed to save" });
  }
});

adminRouter.delete("/:id", async (req, res) => {
  try {
    const db = await getDb();
    const contact = await db.prepare("SELECT id, intro_sent_at FROM outreach_contacts WHERE id = ?").get(req.params.id);
    if (!contact) return res.status(404).json({ error: "Not found" });
    // Once she's been texted the thread is a record (including any STOP); keep it.
    if (contact.intro_sent_at) return res.status(400).json({ error: "She's already been texted — mark her Declined or Wrong number instead, so the record stays." });
    await db.prepare("DELETE FROM outreach_contacts WHERE id = ?").run(contact.id);
    res.json({ ok: true });
  } catch (err) {
    captureException(err, { where: "outreach: delete" });
    res.status(500).json({ error: "Failed to remove" });
  }
});

module.exports = adminRouter;
module.exports.adminRouter = adminRouter;
module.exports.inviteContact = inviteContact;
module.exports.sendToContact = sendToContact;
