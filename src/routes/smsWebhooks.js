/**
 * Twilio webhooks for caregiver outreach (v1.113.0) — mounted at /api/sms, PUBLIC.
 *
 * No session, no cookie: Twilio is the caller, and the only proof is its X-Twilio-Signature,
 * an HMAC of the URL + params under the account auth token. Every handler checks it first and
 * refuses with 403 otherwise. The admin half lives in routes/outreach.js.
 */
const express = require("express");
const { v4: uuid } = require("uuid");
const { getDb } = require("../models/database");
const { captureException } = require("../utils/sentry");
const O = require("../utils/outreach");
const push = require("./push"); // property access at call time, so tests can stub it
const { inviteContact, sendToContact } = require("./outreach");

const APP_URL = (process.env.APP_URL || "https://yourinplace.com").replace(/\/+$/, "");

const router = express.Router();
router.use(express.urlencoded({ extended: false, limit: "50kb" }));

/** Twilio signs every webhook with the account's auth token. Unsigned or mis-signed = 403. */
function verifyTwilio(req) {
  const token = process.env.TWILIO_AUTH_TOKEN;
  const sig = req.headers["x-twilio-signature"];
  if (!token || !sig) return false;
  let twilio;
  try { twilio = require("twilio"); } catch { return false; }
  // The URL Twilio signed is the one configured on the number. Behind Railway's proxy we can't
  // see it directly, so accept either the canonical APP_URL form or the forwarded host form.
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const candidates = [`${APP_URL}${req.originalUrl}`, `https://${host}${req.originalUrl}`];
  return candidates.some((url) => {
    try { return twilio.validateRequest(token, sig, url, req.body || {}); } catch { return false; }
  });
}

const twiml = (res) => res.type("text/xml").send("<Response></Response>");

router.post("/outreach-inbound", async (req, res) => {
  if (!verifyTwilio(req)) return res.status(403).send("Forbidden");
  try {
    const db = await getDb();
    const from = O.toE164(req.body.From);
    const body = String(req.body.Body || "").slice(0, 2000);
    if (!from) return twiml(res);

    let contact = await db.prepare("SELECT * FROM outreach_contacts WHERE RIGHT(phone, 10) = ?").get(O.phoneKey(from));
    if (!contact) {
      // Someone we never imported (a forwarded number, a friend of a sitter). Keep the thread.
      const id = uuid();
      await db.prepare(`
        INSERT INTO outreach_contacts (id, phone, source, status, created_at, updated_at)
        VALUES (?, ?, 'inbound', 'replied', NOW(), NOW())
      `).run(id, from);
      contact = await db.prepare("SELECT * FROM outreach_contacts WHERE id = ?").get(id);
    }

    await db.prepare(`
      INSERT INTO outreach_messages (id, contact_id, direction, body, twilio_sid, status, created_at)
      VALUES (?, ?, 'in', ?, ?, 'received', NOW())
    `).run(uuid(), contact.id, body, req.body.MessageSid || null);

    const what = O.classifyInbound(body);
    const who = [contact.first_name, contact.last_name].filter(Boolean).join(" ") || O.prettyPhone(contact.phone);

    if (what.kind === "opt_out") {
      // Twilio sends the carrier-standard confirmation itself. We never text her again.
      await db.prepare(`
        UPDATE outreach_contacts SET status = 'opted_out', opted_out_at = NOW(), last_inbound_at = NOW(),
               last_message_at = NOW(), updated_at = NOW() WHERE id = ?
      `).run(contact.id);
      return twiml(res);
    }
    if (what.kind === "opt_in") {
      await db.prepare(`
        UPDATE outreach_contacts SET status = 'replied', opted_out_at = NULL, unread = unread + 1,
               last_inbound_at = NOW(), last_message_at = NOW(), updated_at = NOW() WHERE id = ?
      `).run(contact.id);
      return twiml(res);
    }

    if (what.kind === "join") {
      // She texted the keyword — that text IS her opt-in. Answer with what InPlace is and ask
      // for the email. Not unread: the next thing that needs a person is her reply.
      await db.prepare(`
        UPDATE outreach_contacts SET status = CASE WHEN status IN ('new','texted') THEN 'replied' ELSE status END,
               opted_out_at = NULL, last_inbound_at = NOW(), last_message_at = NOW(), updated_at = NOW()
         WHERE id = ? AND status != 'opted_out'
      `).run(contact.id);
      twiml(res);
      await sendToContact(db, contact, O.JOIN_REPLY, { automated: true });
      push.sendPushToAdmins("outreach_reply", {
        title: "Outreach: someone texted JOIN",
        body: `${who} asked to hear more. InPlace answered and asked for her email.`,
        data: { type: "outreach_reply", url: "/?adminTab=outreach" },
      });
      return;
    }

    if (what.kind === "email") {
      await db.prepare(`
        UPDATE outreach_contacts SET email = ?, status = CASE WHEN status IN ('joined','invited') THEN status ELSE 'interested' END,
               last_inbound_at = NOW(), last_message_at = NOW(), updated_at = NOW() WHERE id = ?
      `).run(what.email, contact.id);
      contact = await db.prepare("SELECT * FROM outreach_contacts WHERE id = ?").get(contact.id);
      // Answer first, then work: Twilio retries a webhook that takes too long.
      twiml(res);
      const inv = await inviteContact(db, contact, null);
      if (inv.ok) {
        const first = O.greetingName(contact);
        const reply = inv.status === "joined"
          ? `Thanks${first !== "there" ? `, ${first}` : ""}! Looks like you already have an InPlace account with ${what.email} - you can sign in at yourinplace.com. Pete will be in touch.`
          : `Thanks${first !== "there" ? `, ${first}` : ""}! We just emailed ${what.email} from InPlace with the details and a link to sign up. Pete will be in touch to set up a time to talk.`;
        await sendToContact(db, contact, reply, { automated: true });
      } else {
        await db.prepare("UPDATE outreach_contacts SET unread = unread + 1 WHERE id = ?").run(contact.id);
      }
      push.notifyAdmins("outreach_reply", {
        title: "Outreach: new caregiver lead",
        body: inv.ok ? `${who} sent an email address — invite sent.` : `${who} sent an email address, but the invite didn't go out. Open Outreach.`,
        data: { type: "outreach_reply", url: "/?adminTab=outreach" },
      });
      return;
    }

    // An ordinary reply — a person needs to read it.
    await db.prepare(`
      UPDATE outreach_contacts SET unread = unread + 1, last_inbound_at = NOW(), last_message_at = NOW(), updated_at = NOW(),
             status = CASE WHEN status IN ('new','texted') THEN 'replied' ELSE status END
       WHERE id = ?
    `).run(contact.id);
    push.sendPushToAdmins("outreach_reply", {
      title: "Outreach reply",
      body: `${who}: ${body.slice(0, 120)}`,
      data: { type: "outreach_reply", url: "/?adminTab=outreach" },
    });
    return twiml(res);
  } catch (err) {
    captureException(err, { where: "outreach: inbound sms" });
    if (!res.headersSent) twiml(res); // never make Twilio retry into the same error
  }
});

// Delivery receipts. Carriers drop filtered traffic quietly; this is how we find out.
router.post("/outreach-status", async (req, res) => {
  if (!verifyTwilio(req)) return res.status(403).send("Forbidden");
  try {
    const sid = req.body.MessageSid;
    const status = String(req.body.MessageStatus || "").slice(0, 30);
    if (sid && status) {
      const db = await getDb();
      const err = req.body.ErrorCode ? `Twilio error ${req.body.ErrorCode}` : null;
      await db.prepare("UPDATE outreach_messages SET status = ?, error = COALESCE(?, error) WHERE twilio_sid = ?").run(status, err, sid);
    }
  } catch (err) {
    captureException(err, { where: "outreach: status callback" });
  }
  res.status(204).end();
});

module.exports = router;
module.exports.verifyTwilio = verifyTwilio;
