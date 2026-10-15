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
const { outreachNumber } = require("../utils/sms"); // v1.116.0 — the caller id for browser calls

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

// ═══════════════════════════════════════════════════════════
// v1.120.2 — replies to the REMINDER number (540-274-1412; its "A message comes in" webhook).
//
// YES from a care recipient's phone completes their opt-in (utils/smsConsent.js): the family
// leader's box only asks; this phone's own YES is what lets reminders go. STOP from any number
// clears every text consent we hold for it — a recipient's and an account holder's alike — so
// the app's own records agree with the carrier's opt-out instead of relying on it alone.
// ═══════════════════════════════════════════════════════════
const SC = require("../utils/smsConsent");
router.post("/reminders-inbound", async (req, res) => {
  if (!verifyTwilio(req)) return res.status(403).send("Forbidden");
  try {
    const key = O.phoneKey(req.body.From);
    if (!key) return twiml(res);
    const db = await getDb();
    const body = String(req.body.Body || "");
    if (O.classifyInbound(body).kind === "opt_out") {
      await db.prepare(`
        UPDATE care_recipients SET sms_consent_at = NULL, sms_confirmed_at = NULL, sms_confirm_sent_at = NULL
         WHERE ${SC.digits10("sms_phone")} = ? OR ${SC.digits10("sms_consent_phone")} = ?
      `).run(key, key);
      await db.prepare(`
        UPDATE users SET sms_alerts_consent_at = NULL WHERE ${SC.digits10("sms_alerts_phone")} = ?
      `).run(key);
      return twiml(res); // Twilio sends the carrier opt-out confirmation itself
    }
    if (SC.isYes(body)) {
      const rows = await db.prepare(`
        UPDATE care_recipients cr SET sms_confirmed_at = NOW(), sms_confirmed_phone = cr.sms_phone
         WHERE ${SC.requestedSql("cr")} AND NOT ${SC.consentedSql("cr")} AND ${SC.digits10("cr.sms_phone")} = ?
         RETURNING cr.id
      `).all(key);
      if (rows.length) {
        return res.type("text/xml").send(
          `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${SC.RECIPIENT_CONFIRMED_TEXT.replace(/&/g, "&amp;")}</Message></Response>`
        );
      }
    }
  } catch (err) {
    captureException(err, { where: "sms: reminders inbound" });
  }
  twiml(res);
});

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
        body: `${who} asked to hear more. InPlace answered and asked for their email.`,
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


// ═══════════════════════════════════════════════════════════
// Voice (v1.116.0) — voicemail on the outreach number, and calling out from the browser.
//
// Pete, 10/14: callers to 540-835-5987 hear "You've reached InPlace, please leave a message and
// a number and we will get back to you as soon as possible", and he calls back "from that number
// in app ... trying to keep my phone out of it." So: inbound calls go straight to voicemail (the
// recording and Twilio's transcript land in the caller's Outreach thread), and the Call button in
// that thread dials out through the browser (Twilio Voice SDK → TwiML App → /outreach-dial),
// showing the InPlace number. His own number is never involved.
// ═══════════════════════════════════════════════════════════
const VOICEMAIL_GREETING =
  "You've reached InPlace. Please leave a message and a number, and we will get back to you as soon as possible.";

const xmlEscape = (s) => String(s ?? "").replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]));
const sayXml = (text) => `<Say voice="Polly.Joanna">${xmlEscape(text)}</Say>`;
const voiceXml = (res, inner) => res.type("text/xml").send(`<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`);

/** The thread a phone number belongs to — created (source 'inbound') if we've never seen it. */
async function contactForPhone(db, rawPhone) {
  const from = O.toE164(rawPhone);
  if (!from) return null;
  let c = await db.prepare("SELECT * FROM outreach_contacts WHERE RIGHT(phone, 10) = ?").get(O.phoneKey(from));
  if (!c) {
    const id = uuid();
    await db.prepare(`
      INSERT INTO outreach_contacts (id, phone, source, status, created_at, updated_at)
      VALUES (?, ?, 'inbound', 'replied', NOW(), NOW())
      ON CONFLICT (phone) DO NOTHING
    `).run(id, from);
    c = await db.prepare("SELECT * FROM outreach_contacts WHERE RIGHT(phone, 10) = ?").get(O.phoneKey(from));
  }
  return c;
}

// A call comes in → greeting, then record. Logged right away as a missed call, so a caller who
// hangs up before the beep still shows up in the thread.
router.post("/outreach-voice", async (req, res) => {
  if (!verifyTwilio(req)) return res.status(403).send("Forbidden");
  try {
    const db = await getDb();
    const contact = await contactForPhone(db, req.body.From);
    if (contact && req.body.CallSid) {
      await db.prepare(`
        INSERT INTO outreach_messages (id, contact_id, direction, body, twilio_sid, status, kind, created_at)
        VALUES (?, ?, 'in', 'Missed call (no message)', ?, 'call', 'voicemail', NOW())
      `).run(uuid(), contact.id, req.body.CallSid);
      await db.prepare(`
        UPDATE outreach_contacts SET unread = unread + 1, last_inbound_at = NOW(), last_message_at = NOW(), updated_at = NOW(),
               status = CASE WHEN status IN ('new','texted') THEN 'replied' ELSE status END
         WHERE id = ?
      `).run(contact.id);
    }
  } catch (err) {
    captureException(err, { where: "outreach: inbound call" });
  }
  // Answer the caller no matter what happened above.
  voiceXml(res, sayXml(VOICEMAIL_GREETING)
    + `<Record maxLength="180" timeout="5" playBeep="true" trim="trim-silence"`
    + ` action="${APP_URL}/api/sms/outreach-voice-done"`
    + ` recordingStatusCallback="${APP_URL}/api/sms/outreach-recording" recordingStatusCallbackMethod="POST"`
    + ` transcribe="true" transcribeCallback="${APP_URL}/api/sms/outreach-transcription"/>`
    + sayXml("We didn't get a message. Goodbye."));
});

router.post("/outreach-voice-done", (req, res) => {
  if (!verifyTwilio(req)) return res.status(403).send("Forbidden");
  voiceXml(res, sayXml("Thank you. Goodbye.") + "<Hangup/>");
});

// The recording is ready (Twilio stores it; admin plays it through /api/admin/outreach/recording).
router.post("/outreach-recording", async (req, res) => {
  if (!verifyTwilio(req)) return res.status(403).send("Forbidden");
  try {
    const { CallSid, RecordingUrl, RecordingDuration, RecordingStatus } = req.body;
    if (CallSid && RecordingUrl && RecordingStatus !== "failed") {
      const db = await getDb();
      const secs = Math.max(0, parseInt(RecordingDuration, 10) || 0);
      await db.prepare(`
        UPDATE outreach_messages SET media_url = ?, duration = ?, status = 'received',
               body = CASE WHEN body = 'Missed call (no message)' THEN 'Voicemail (transcribing…)' ELSE body END
         WHERE twilio_sid = ? AND kind = 'voicemail'
      `).run(String(RecordingUrl).slice(0, 500), secs, CallSid);
      const row = await db.prepare(`
        SELECT c.first_name, c.last_name, c.phone FROM outreach_messages m JOIN outreach_contacts c ON c.id = m.contact_id
         WHERE m.twilio_sid = ? AND m.kind = 'voicemail'
      `).get(CallSid);
      if (row) {
        const who = [row.first_name, row.last_name].filter(Boolean).join(" ") || O.prettyPhone(row.phone);
        push.sendPushToAdmins("outreach_reply", {
          title: "Outreach voicemail",
          body: `${who} left a voicemail.`,
          data: { type: "outreach_reply", url: "/?adminTab=outreach" },
        });
      }
    }
  } catch (err) {
    captureException(err, { where: "outreach: recording callback" });
  }
  res.status(204).end();
});

router.post("/outreach-transcription", async (req, res) => {
  if (!verifyTwilio(req)) return res.status(403).send("Forbidden");
  try {
    const { CallSid, TranscriptionText, TranscriptionStatus } = req.body;
    if (CallSid) {
      const db = await getDb();
      const text = TranscriptionStatus === "completed" && TranscriptionText
        ? `Voicemail: “${String(TranscriptionText).trim().slice(0, 1500)}”`
        : "Voicemail (couldn't transcribe — tap play)";
      await db.prepare("UPDATE outreach_messages SET body = ? WHERE twilio_sid = ? AND kind = 'voicemail'").run(text, CallSid);
    }
  } catch (err) {
    captureException(err, { where: "outreach: transcription callback" });
  }
  res.status(204).end();
});

// The TwiML App's Voice URL — the browser's Call button lands here. The browser sends only a
// contact id; the number dialed always comes from our own table, and only an admin's browser
// identity ("admin-<user id>", minted by /api/admin/outreach/voice-token) may place a call.
router.post("/outreach-dial", async (req, res) => {
  if (!verifyTwilio(req)) return res.status(403).send("Forbidden");
  try {
    const db = await getDb();
    const m = String(req.body.From || req.body.Caller || "").match(/^client:admin-([0-9a-f-]{36})$/i);
    const admin = m ? await db.prepare("SELECT id FROM users WHERE id = ? AND is_admin = 1").get(m[1]) : null;
    if (!admin) return voiceXml(res, sayXml("Sorry, this call isn't allowed.") + "<Hangup/>");
    const contact = await db.prepare("SELECT * FROM outreach_contacts WHERE id = ?").get(String(req.body.contactId || ""));
    if (!contact) return voiceXml(res, sayXml("Sorry, I couldn't find that number.") + "<Hangup/>");
    // Pete, 10/14: "it has to be impossible for me to call 911 from it." The number dialed only
    // ever comes from this table, and only a full ten-digit US number is dialed — never 911,
    // 933, 112 or any other short code, whatever ends up in a row.
    if (!O.dialableUsNumber(contact.phone)) return voiceXml(res, sayXml("Sorry, that number can't be called from here.") + "<Hangup/>");
    if (!contact.last_inbound_at && !O.introWindow().open) {
      return voiceXml(res, sayXml("First calls to someone new go out between 9 A M and 8 P M Eastern, Monday through Saturday.") + "<Hangup/>");
    }
    const from = outreachNumber();
    if (!from) return voiceXml(res, sayXml("The outreach number isn't set up.") + "<Hangup/>");
    await db.prepare(`
      INSERT INTO outreach_messages (id, contact_id, direction, body, twilio_sid, status, kind, sent_by, created_at)
      VALUES (?, ?, 'out', 'Call', ?, 'calling', 'call', ?, NOW())
    `).run(uuid(), contact.id, req.body.CallSid || null, admin.id);
    await db.prepare("UPDATE outreach_contacts SET last_message_at = NOW(), updated_at = NOW() WHERE id = ?").run(contact.id);
    voiceXml(res, `<Dial callerId="${from}" answerOnBridge="true" timeout="30" action="${APP_URL}/api/sms/outreach-dial-done"><Number>${xmlEscape(O.dialableUsNumber(contact.phone))}</Number></Dial>`);
  } catch (err) {
    captureException(err, { where: "outreach: dial" });
    voiceXml(res, sayXml("Sorry, something went wrong.") + "<Hangup/>");
  }
});

router.post("/outreach-dial-done", async (req, res) => {
  if (!verifyTwilio(req)) return res.status(403).send("Forbidden");
  try {
    const { CallSid, DialCallStatus, DialCallDuration } = req.body;
    if (CallSid) {
      const db = await getDb();
      const secs = Math.max(0, parseInt(DialCallDuration, 10) || 0);
      const body = DialCallStatus === "completed"
        ? `Call · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`
        : DialCallStatus === "busy" ? "Call · busy" : DialCallStatus === "no-answer" ? "Call · no answer" : `Call · ${DialCallStatus || "ended"}`;
      await db.prepare("UPDATE outreach_messages SET body = ?, duration = ?, status = ? WHERE twilio_sid = ? AND kind = 'call'")
        .run(body, secs, String(DialCallStatus || "").slice(0, 30), CallSid);
    }
  } catch (err) {
    captureException(err, { where: "outreach: dial done" });
  }
  voiceXml(res, "<Hangup/>");
});


module.exports = router;
module.exports.verifyTwilio = verifyTwilio;
module.exports.VOICEMAIL_GREETING = VOICEMAIL_GREETING;
