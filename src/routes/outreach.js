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
const { sendSms, outreachNumber, getTwilio } = require("../utils/sms");
const { sendEmail, brandedHtml } = require("../utils/email");
const O = require("../utils/outreach");
const CN = require("../utils/outreachCallNotes"); // v1.122.0
const T = require("../utils/tracking");
const P = require("../utils/outreachProgress"); // v1.125.0

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
  const fresh = await db.prepare("SELECT opted_out_at, status, texts_ok_at FROM outreach_contacts WHERE id = ?").get(contact.id);
  if (!fresh || fresh.opted_out_at || fresh.status === "opted_out") return { ok: false, error: "Opted out" };
  // v1.122.0 — and nobody is texted without a recorded OK: a yes on a recorded call, or a text
  // from them first. A public listing of people seeking work is not consent (carriers, 10/15).
  if (!fresh.texts_ok_at) return { ok: false, error: "No OK to text yet — call first, or wait for them to text in." };
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
  // v1.117.0 — her personal code rides along, so opening the email counts as her visit.
  let code = null;
  try { code = await T.linkForContact(db, contact, { createdBy: invitedBy || contact.created_by || null }); } catch { /* the invite still goes */ }
  const inviteUrl = `${APP_URL}?platformInvite=${invite.token}${code ? `&l=${code}` : ""}`;
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
             (SELECT COUNT(*) FROM outreach_messages m WHERE m.contact_id = c.id AND m.direction = 'out' AND m.status IN ('failed','undelivered')) AS failed_count,
             (SELECT MIN(e.created_at) FROM visit_events e JOIN track_links l ON l.code = e.link_code
               WHERE l.outreach_contact_id = c.id AND e.kind = 'start') AS link_opened_at
        FROM outreach_contacts c
       ORDER BY c.unread DESC, c.last_inbound_at DESC NULLS LAST, c.last_name ASC NULLS LAST, c.first_name ASC
    `).all();
    // "joined" is a fact about the users table, so it wins over whatever status was stored.
    const contacts = rows.map((r) => ({ ...r, status: r.joined_user_id && r.status !== "opted_out" ? "joined" : r.status }));
    // v1.125.0 — how far each person got, and the funnel across everyone. A failure here must
    // not take the inbox down with it: the list still loads, just without the ladder.
    let funnel = null;
    try {
      const prog = await P.progressFor(db, contacts);
      for (const c of contacts) c.progress = prog.get(c.id) || null;
      funnel = P.funnel(prog);
    } catch (e) { captureException(e, { where: "outreach: progress (list)" }); }
    const win = O.introWindow();
    res.json({
      contacts,
      funnel,
      statuses: O.OUTREACH_STATUSES,
      defaultIntro: O.DEFAULT_INTRO,
      callScript: CN.CALL_SCRIPT, // v1.122.0
      firstTexts: O.FIRST_TEXTS, // v1.125.4
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

// v1.125.1 — one person by hand. Pete, 10/28: "There needs to be a way that I can enter a phone
// number in or pick from Contacts as well. You can't just be a pre-populated list based on an
// import." Same row as an import makes, so the consent rules are unchanged: a new contact has no
// OK to text until she texts in (JOIN) — adding her here only lets him call her.
// A number that is already on the list is not an error — the client opens that thread instead.
adminRouter.post("/contacts", async (req, res) => {
  try {
    const first = String(req.body?.firstName || "").trim().slice(0, 80);
    const last = String(req.body?.lastName || "").trim().slice(0, 80);
    const notes = String(req.body?.notes || "").trim().slice(0, 1000) || null;
    const key = O.phoneKey(req.body?.phone);
    if (!first && !last) return res.status(400).json({ error: "Add a name, so you know who this is." });
    if (!key) return res.status(400).json({ error: "That isn't a 10-digit US number. The outreach line only reaches US numbers." });
    const phone = `+1${key}`;
    const db = await getDb();
    const existing = await db.prepare("SELECT id FROM outreach_contacts WHERE phone = ?").get(phone);
    if (existing) return res.json({ id: existing.id, existing: true });
    const id = uuid();
    const r = await db.prepare(`
      INSERT INTO outreach_contacts (id, first_name, last_name, phone, notes, source, status, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'Added by hand', 'new', ?, NOW(), NOW())
      ON CONFLICT (phone) DO NOTHING
    `).run(id, first || null, last || null, phone, notes, req.user.id);
    if (r && r.changes === 0) {
      // Lost a race with an inbound text from the same number — use the row that won.
      const won = await db.prepare("SELECT id FROM outreach_contacts WHERE phone = ?").get(phone);
      return res.json({ id: won.id, existing: true });
    }
    res.json({ id, existing: false });
  } catch (err) {
    captureException(err, { where: "outreach: add contact" });
    res.status(500).json({ error: "Couldn't add them" });
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
      // Only people with an OK to text, never sent this follow-up, never opted out, not already on InPlace.
      if (c && c.texts_ok_at && !c.opted_out_at && c.status !== "opted_out" && !c.intro_sent_at && !c.joined_user_id) targets.push(c);
    }
    if (!targets.length) return res.status(400).json({ error: "None of those people can get it — texts need an OK first (a yes on a recorded call, or they texted you). Already-sent, opted-out and already-joined people are skipped too." });

    introRun = { total: targets.length, sent: 0, failed: 0, startedAt: new Date().toISOString() };
    res.json({ queued: targets.length, skipped: ids.length - targets.length });

    const by = req.user.id;
    (async () => {
      try {
        for (const c of targets) {
          const link = O.hasLinkToken(template) ? T.smsLink(await T.linkForContact(db, c, { createdBy: by })) : null;
          const r = await sendToContact(db, c, O.renderTemplate(template, c, link), { sentBy: by, intro: true });
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
    let journey = null;
    try { journey = await T.journeyForContact(db, contact.id, contact.joined_user_id || null); }
    catch (e) { captureException(e, { where: "outreach: journey" }); }
    let progress = null;
    try { progress = (await P.progressFor(db, [contact])).get(contact.id) || null; }
    catch (e) { captureException(e, { where: "outreach: progress (thread)" }); }
    res.json({ contact: { ...contact, unread: 0 }, messages, journey, progress });
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
    if (contact.opted_out_at || contact.status === "opted_out") return res.status(400).json({ error: "This person replied STOP. InPlace can't text them again unless they text START." });
    // v1.122.0 — no OK, no text. Said here plainly rather than as a failed send.
    if (!contact.texts_ok_at) return res.status(400).json({ error: "No OK to text yet. Either they text the outreach number (JOIN), or you record their yes from the call: Details → Record OK from the call." });
    // A first text to someone who has never written back is a cold text: same hours as the intro.
    if (!contact.last_inbound_at) {
      const win = O.introWindow();
      if (!win.open) return res.status(400).json({ error: win.reason });
    }
    const link = O.hasLinkToken(body) ? T.smsLink(await T.linkForContact(db, contact, { createdBy: req.user.id })) : null;
    const r = await sendToContact(db, contact, (link ? body.replace(/\{link\}/gi, link) : body), { sentBy: req.user.id, intro: !contact.intro_sent_at });
    if (!r.ok) return res.status(502).json({ error: `Text didn't send: ${r.error}` });
    res.json({ ok: true });
  } catch (err) {
    captureException(err, { where: "outreach: send one" });
    res.status(500).json({ error: "Failed to send" });
  }
});

// ─── Voice (v1.116.0) ───

// A short-lived token for the browser's Call button (Twilio Voice SDK). Outgoing only; the
// TwiML App it names (/api/sms/outreach-dial) dials the contact's number from our table.
// ─── v1.125.5 — call through Pete's own cell ───
//
// Pete, 10/28: "The calls have to be able to continue while the phone screen is locked. … If I'm
// on a call with somebody and the screen locks, it cuts the audio." A call placed from the web view
// dies with the screen. Rather than native calling (Swift, CallKit, a new build, App Review), Twilio
// rings the admin's own cell from the outreach number; he answers and presses 1, and Twilio dials
// the caregiver from the outreach number and bridges them. It is an ordinary phone call on his
// phone, so the screen can lock. Recording, transcript and iPAi notes are the same pipeline as the
// browser call (smsWebhooks.js /outreach-bridge → the same <Dial> as /outreach-dial). The
// caregiver only ever sees the outreach number; the admin's cell is never sent to them.
adminRouter.post("/:id/call-via-cell", async (req, res) => {
  try {
    const from = outreachNumber();
    if (!from) return res.status(400).json({ error: "The outreach number isn't set up yet (TWILIO_OUTREACH_NUMBER)." });
    const client = getTwilio();
    if (!client) return res.status(400).json({ error: "Twilio isn't configured." });
    const db = await getDb();
    const contact = await loadContact(db, req.params.id);
    if (!contact) return res.status(404).json({ error: "Not found" });
    if (!O.dialableUsNumber(contact.phone)) return res.status(400).json({ error: "That number can't be called from here." });
    if (!contact.last_inbound_at && !O.introWindow().open) {
      return res.status(400).json({ error: "First calls to someone new go out between 9am and 8pm Eastern, Monday through Saturday." });
    }
    const me = await db.prepare("SELECT phone FROM users WHERE id = ?").get(req.user.id);
    const myCell = O.dialableUsNumber(me && me.phone);
    if (!myCell) return res.status(400).json({ error: "Add your cell number to your account (Account → Phone) so the call can ring you." });
    if (myCell === O.dialableUsNumber(contact.phone)) return res.status(400).json({ error: "That's your own number." });

    const messageId = uuid();
    await db.prepare(`
      INSERT INTO outreach_messages (id, contact_id, direction, body, status, kind, sent_by, created_at)
      VALUES (?, ?, 'out', 'Call · ringing your phone', 'calling_you', 'call', ?, NOW())
    `).run(messageId, contact.id, req.user.id);
    let call;
    try {
      call = await client.calls.create({
        to: myCell,
        from,
        url: `${APP_URL}/api/sms/outreach-bridge/${messageId}`,
        method: "POST",
        timeout: 25,
        statusCallback: `${APP_URL}/api/sms/outreach-bridge-status/${messageId}`,
        statusCallbackMethod: "POST",
        statusCallbackEvent: ["completed"],
      });
    } catch (e) {
      await db.prepare("UPDATE outreach_messages SET body = 'Call · could not ring your phone', status = 'failed', error = ? WHERE id = ?")
        .run(String(e.message || e).slice(0, 300), messageId);
      return res.status(502).json({ error: "Couldn't ring your phone. Try again, or use the browser call." });
    }
    await db.prepare("UPDATE outreach_messages SET twilio_sid = ? WHERE id = ?").run(call.sid, messageId);
    await db.prepare("UPDATE outreach_contacts SET last_message_at = NOW(), updated_at = NOW() WHERE id = ?").run(contact.id);
    res.json({ ok: true, messageId, ringing: `…${myCell.slice(-4)}` });
  } catch (err) {
    captureException(err, { where: "outreach: call via cell" });
    res.status(500).json({ error: "Couldn't start the call" });
  }
});

adminRouter.get("/voice-token", async (req, res) => {
  try {
    const sid = process.env.TWILIO_ACCOUNT_SID, keySid = process.env.TWILIO_API_KEY_SID,
      keySecret = process.env.TWILIO_API_KEY_SECRET, appSid = process.env.TWILIO_TWIML_APP_SID;
    if (!sid || !keySid || !keySecret || !appSid) {
      return res.status(400).json({ error: "Calling isn't set up yet (TWILIO_TWIML_APP_SID)." });
    }
    const twilio = require("twilio");
    const AccessToken = twilio.jwt.AccessToken;
    const token = new AccessToken(sid, keySid, keySecret, { identity: `admin-${req.user.id}`, ttl: 3600 });
    token.addGrant(new AccessToken.VoiceGrant({ outgoingApplicationSid: appSid, incomingAllow: false }));
    res.json({ token: token.toJwt() });
  } catch (err) {
    captureException(err, { where: "outreach: voice token" });
    res.status(500).json({ error: "Couldn't start calling" });
  }
});

// Voicemail audio, fetched from Twilio with the account credentials and passed through — the
// recording URL itself needs Twilio auth, so the browser can never fetch it directly.
adminRouter.get("/recording/:messageId", async (req, res) => {
  try {
    const db = await getDb();
    const m = await db.prepare("SELECT media_url FROM outreach_messages WHERE id = ? AND kind IN ('voicemail', 'call')").get(req.params.messageId);
    if (!m || !m.media_url || !/^https:\/\/api\.twilio\.com\//.test(m.media_url)) return res.status(404).json({ error: "No recording" });
    const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const r = await fetch(`${m.media_url}.mp3`, { headers: { Authorization: `Basic ${auth}` }, signal: ctrl.signal });
    clearTimeout(timer);
    if (!r.ok) return res.status(502).json({ error: "Couldn't fetch the recording" });
    const buf = Buffer.from(await r.arrayBuffer());
    res.set("Content-Type", "audio/mpeg").set("Cache-Control", "private, max-age=3600").send(buf);
  } catch (err) {
    captureException(err, { where: "outreach: recording" });
    if (!res.headersSent) res.status(500).json({ error: "Couldn't play the recording" });
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
    // v1.122.0 — Pete can record an OK himself, but only after a real call in the last 7 days
    // (the recording is the evidence); and he can withdraw one any time.
    if (b.textsOk === false) {
      await db.prepare("UPDATE outreach_contacts SET texts_ok_at = NULL, texts_ok_source = NULL, texts_ok_by = NULL, texts_ok_evidence = NULL, texts_ok_message_id = NULL WHERE id = ?").run(contact.id);
    } else if (b.textsOk === true && !contact.texts_ok_at) {
      // v1.125.3 — Pete's override (10/28): "I have a transcript and a recorded call saying 'yes, I
      // would like more information' and that's good enough to defend … log it as an override. …
      // I'm not going to text anyone who doesn't say, like Doris, 'yeah, I would like more info' to
      // the question 'is it OK if I text you some more info?'"
      //
      // v1.124.1 had made texting-in (JOIN) the ONLY way to open texting, because the A2P campaign
      // filing describes that flow. This reopens the other way, as a recorded admin decision: what
      // they said, which recorded call it was on, and who recorded it. Without words, no OK.
      const evidence = String(b.evidence || "").trim().slice(0, 500);
      if (evidence.length < 3) return res.status(400).json({ error: "Write what they said when you asked if you could text them." });
      if (contact.opted_out_at || contact.status === "opted_out") return res.status(400).json({ error: "This person opted out. Only they can opt back in, by texting START." });
      let callId = null;
      if (b.callMessageId) {
        const call = await db.prepare(
          "SELECT id FROM outreach_messages WHERE id = ? AND contact_id = ? AND kind = 'call'"
        ).get(String(b.callMessageId), contact.id);
        if (!call) return res.status(400).json({ error: "That call isn't in this conversation." });
        callId = call.id;
      }
      await db.prepare(`
        UPDATE outreach_contacts
           SET texts_ok_at = NOW(), texts_ok_source = ?, texts_ok_by = ?, texts_ok_evidence = ?, texts_ok_message_id = ?
         WHERE id = ? AND texts_ok_at IS NULL
      `).run(callId ? "recorded_call" : "admin_override", req.user.id,
        `${callId ? "Said on the recorded call" : "Recorded by admin"}: “${evidence.replace(/^["“”]+|["“”]+$/g, "")}”`,
        callId, contact.id);
    }
    if (b.status !== undefined) {
      if (!O.OUTREACH_STATUSES.includes(b.status)) return res.status(400).json({ error: "Unknown status" });
      // Opt-out belongs to her. Admin can record one (she said "don't text me" on a call), but
      // can never clear one — only her START does that.
      if (contact.status === "opted_out" && b.status !== "opted_out") return res.status(400).json({ error: "This person opted out. Only they can opt back in, by texting START." });
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
    if (contact.intro_sent_at) return res.status(400).json({ error: "They've already been texted — mark them Declined or Wrong number instead, so the record stays." });
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
