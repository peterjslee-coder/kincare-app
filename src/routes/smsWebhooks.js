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
  // v1.124.8 — trimmed: a pasted token with a stray space/newline looks identical in Railway's
  // UI and fails every signature (10/22 key rotation).
  const token = (process.env.TWILIO_AUTH_TOKEN || "").trim();
  const sig = req.headers["x-twilio-signature"];
  if (!token || !sig) return false;
  let twilio;
  try { twilio = require("twilio"); } catch { return false; }
  // The URL Twilio signed is the one configured on the number. Behind Railway's proxy we can't
  // see it directly, so accept either the canonical APP_URL form or the forwarded host form.
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const candidates = [`${APP_URL}${req.originalUrl}`, `https://${host}${req.originalUrl}`];
  const ok = candidates.some((url) => {
    try { return twilio.validateRequest(token, sig, url, req.body || {}); } catch { return false; }
  });
  if (!ok) {
    // Never the token itself: its length and an 8-char sha256 prefix, enough to compare against
    // `printf %s "$TOKEN" | shasum -a 256` on a laptop without the secret ever leaving it.
    const fp = require("crypto").createHash("sha256").update(token).digest("hex").slice(0, 8);
    console.warn(`[twilio] signature mismatch on ${req.originalUrl}: token len=${token.length} sha256=${fp} raw-len=${(process.env.TWILIO_AUTH_TOKEN || "").length} urls=${candidates.join(" , ")}`);
  }
  return ok;
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

    // v1.122.0 — a text FROM them (anything but STOP) is their OK to text back. Recorded with
    // their own words as the evidence. It never overwrites an earlier OK.
    if (what.kind !== "opt_out") {
      await db.prepare(`
        UPDATE outreach_contacts SET texts_ok_at = NOW(), texts_ok_source = 'texted_in', texts_ok_evidence = ?
         WHERE id = ? AND texts_ok_at IS NULL
      `).run(`They texted first: “${body.slice(0, 300)}”`, contact.id);
    }

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
          ? `Thanks${first !== "there" ? `, ${first}` : ""}! Looks like you already have an InPlace account with ${what.email} - you can sign in at yourinplace.com. Pete will be in touch. Reply STOP to opt out.`
          : `Thanks${first !== "there" ? `, ${first}` : ""}! We just emailed ${what.email} from InPlace Care with the details and a link to sign up. Pete will be in touch to set up a time to talk. Reply STOP to opt out.`;
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
    // v1.122.0 — recorded (both sides, from answer) for Pete's notes. v1.122.5 — no announcement:
    // Pete, 10/16: "remove any announcement" (Virginia and federal law are one-party consent; he is
    // a party to every call). Lawyer L13 covers callers who turn out to be in all-party states.
    voiceXml(res, `<Dial callerId="${from}" answerOnBridge="true" timeout="30" action="${APP_URL}/api/sms/outreach-dial-done"`
      + ` record="record-from-answer-dual" recordingStatusCallback="${APP_URL}/api/sms/outreach-call-recording" recordingStatusCallbackEvent="completed">`
      + `<Number>${xmlEscape(O.dialableUsNumber(contact.phone))}</Number></Dial>`);
  } catch (err) {
    captureException(err, { where: "outreach: dial" });
    voiceXml(res, sayXml("Sorry, something went wrong.") + "<Hangup/>");
  }
});

// ─── v1.125.5 — call through the admin's own cell (routes/outreach.js /:id/call-via-cell) ───
//
// Leg 1 rang the admin's cell. It answers here. A voicemail box answers calls too, so nothing is
// dialed until a person presses 1 — otherwise an unanswered phone would connect a caregiver to
// Pete's voicemail greeting.
const bridgeCall = (db, messageId) => db.prepare(`
  SELECT m.id, m.status, m.sent_by, c.id AS contact_id, c.phone, c.first_name, c.last_inbound_at
    FROM outreach_messages m JOIN outreach_contacts c ON c.id = m.contact_id
   WHERE m.id = ? AND m.kind = 'call'
`).get(messageId);

router.post("/outreach-bridge/:messageId", async (req, res) => {
  if (!verifyTwilio(req)) return res.status(403).send("Forbidden");
  try {
    const db = await getDb();
    const m = await bridgeCall(db, req.params.messageId);
    if (!m || m.status !== "calling_you") return voiceXml(res, sayXml("This call has already ended.") + "<Hangup/>");
    const who = String(m.first_name || "").split(/\s+/)[0] || O.prettyPhone(m.phone);
    voiceXml(res, `<Gather numDigits="1" timeout="10" action="${APP_URL}/api/sms/outreach-bridge/${m.id}/go">`
      + sayXml(`In Place call to ${who}. Press 1 to connect.`) + `</Gather>`
      + sayXml("Not connecting. Goodbye.") + "<Hangup/>");
  } catch (err) {
    captureException(err, { where: "outreach: bridge answer" });
    voiceXml(res, sayXml("Sorry, something went wrong.") + "<Hangup/>");
  }
});

router.post("/outreach-bridge/:messageId/go", async (req, res) => {
  if (!verifyTwilio(req)) return res.status(403).send("Forbidden");
  try {
    if (String(req.body.Digits || "") !== "1") return voiceXml(res, sayXml("Not connecting. Goodbye.") + "<Hangup/>");
    const db = await getDb();
    const m = await bridgeCall(db, req.params.messageId);
    if (!m || m.status !== "calling_you") return voiceXml(res, sayXml("This call has already ended.") + "<Hangup/>");
    // Same guards as the browser call: a full US number from our own table, never a short code.
    const to = O.dialableUsNumber(m.phone);
    if (!to) return voiceXml(res, sayXml("Sorry, that number can't be called from here.") + "<Hangup/>");
    const from = outreachNumber();
    if (!from) return voiceXml(res, sayXml("The outreach number isn't set up.") + "<Hangup/>");
    await db.prepare("UPDATE outreach_messages SET status = 'calling', body = 'Call', twilio_sid = COALESCE(twilio_sid, ?) WHERE id = ?")
      .run(req.body.CallSid || null, m.id);
    // The same <Dial> as /outreach-dial: recorded from answer, and dial-done / call-recording
    // find the row by the parent CallSid — the leg that rang the admin.
    voiceXml(res, sayXml("Connecting.")
      + `<Dial callerId="${from}" answerOnBridge="true" timeout="30" action="${APP_URL}/api/sms/outreach-dial-done"`
      + ` record="record-from-answer-dual" recordingStatusCallback="${APP_URL}/api/sms/outreach-call-recording" recordingStatusCallbackEvent="completed">`
      + `<Number>${xmlEscape(to)}</Number></Dial>`);
  } catch (err) {
    captureException(err, { where: "outreach: bridge go" });
    voiceXml(res, sayXml("Sorry, something went wrong.") + "<Hangup/>");
  }
});

// The admin's leg ended. If it never got to the caregiver, say why in the thread.
router.post("/outreach-bridge-status/:messageId", async (req, res) => {
  if (!verifyTwilio(req)) return res.status(403).send("Forbidden");
  try {
    const db = await getDb();
    const st = String(req.body.CallStatus || "");
    const body = st === "no-answer" || st === "busy" ? "Call · you didn't pick up"
      : st === "failed" || st === "canceled" ? "Call · couldn't ring your phone"
      : "Call · not connected";
    await db.prepare("UPDATE outreach_messages SET body = ?, status = ? WHERE id = ? AND kind = 'call' AND status = 'calling_you'")
      .run(body, st.slice(0, 30) || "ended", req.params.messageId);
  } catch (err) {
    captureException(err, { where: "outreach: bridge status" });
  }
  res.status(204).end();
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

// ═══════════════════════════════════════════════════════════
// v1.122.0 — recorded outreach calls (utils/outreachCallNotes.js for the why).
// ═══════════════════════════════════════════════════════════
const CN = require("../utils/outreachCallNotes");

router.post("/outreach-call-recording", async (req, res) => {
  if (!verifyTwilio(req)) return res.status(403).send("Forbidden");
  res.status(204).end();
  try {
    const { CallSid, RecordingUrl, RecordingDuration, RecordingStatus } = req.body;
    if (!CallSid || !RecordingUrl || RecordingStatus === "failed") return;
    const db = await getDb();
    const m = await db.prepare("SELECT id FROM outreach_messages WHERE twilio_sid = ? AND kind = 'call'").get(CallSid);
    if (!m) return;
    await db.prepare("UPDATE outreach_messages SET media_url = ?, duration = GREATEST(COALESCE(duration, 0), ?) WHERE id = ?")
      .run(String(RecordingUrl).slice(0, 500), Math.max(0, parseInt(RecordingDuration, 10) || 0), m.id);
    await processCallRecording(db, m.id);
  } catch (err) {
    captureException(err, { where: "outreach: call recording" });
  }
});

/** Recording → transcript → iPAi notes → contact notes, status and (only with a quoted yes) texts OK. */
async function processCallRecording(db, messageId) {
  const m = await db.prepare(`
    SELECT m.*, c.first_name, c.last_name, c.phone, c.status AS contact_status, c.notes AS contact_notes,
           c.email AS contact_email, c.texts_ok_at
      FROM outreach_messages m JOIN outreach_contacts c ON c.id = m.contact_id WHERE m.id = ?
  `).get(messageId);
  if (!m || !m.media_url || !/^https:\/\/api\.twilio\.com\//.test(m.media_url)) return null;
  const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");
  const r = await fetch(`${m.media_url}.mp3`, { headers: { Authorization: `Basic ${auth}` }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`recording fetch ${r.status}`);
  const { transcribeAudio } = require("../utils/transcription");
  let transcript;
  try {
    transcript = (await transcribeAudio(Buffer.from(await r.arrayBuffer()), "audio/mpeg", "call.mp3")).text;
  } catch (e) {
    await db.prepare("UPDATE outreach_messages SET ai_notes = ? WHERE id = ?").run(JSON.stringify({ error: `Couldn't transcribe: ${e.message}` }), messageId);
    return null;
  }
  await db.prepare("UPDATE outreach_messages SET transcript = ? WHERE id = ?").run(transcript.slice(0, 60000), messageId);
  const notes = await CN.analyzeCall(transcript, { first: m.first_name || "the caregiver" });
  if (!notes) return { transcript };
  await db.prepare("UPDATE outreach_messages SET ai_notes = ? WHERE id = ?").run(JSON.stringify(notes), messageId);

  const when = new Date().toLocaleDateString("en-US", { month: "numeric", day: "numeric", timeZone: "America/New_York" });
  const bits = [notes.summary, notes.availability && `Availability: ${notes.availability}`, notes.area && `Area: ${notes.area}`,
    notes.experience && `Experience: ${notes.experience}`, notes.nextStep && `Next: ${notes.nextStep}`].filter(Boolean);
  const line = `📞 ${when} (iPAi): ${bits.join(" · ")}`;
  const newNotes = [m.contact_notes, line].filter(Boolean).join("\n").slice(-2000);
  await db.prepare(`
    UPDATE outreach_contacts SET notes = ?, status = ?, email = COALESCE(email, ?), unread = unread + 1, updated_at = NOW() WHERE id = ?
  `).run(newNotes, CN.statusFor(notes.outcome, m.contact_status), notes.email, m.contact_id);
  // v1.124.1 — a call never opens texting. Only their own text to the number does (JOIN or anything
  // else, outreach-inbound): the one opt-in a carrier reviewer can verify.
  const who = [m.first_name, m.last_name].filter(Boolean).join(" ") || O.prettyPhone(m.phone);
  push.sendPushToAdmins("outreach_reply", {
    title: "Call notes ready",
    body: `${who}: ${notes.outcome.replace(/_/g, " ")}.`,
    data: { type: "outreach_reply", url: "/?adminTab=outreach" },
  });
  return { transcript, notes };
}

module.exports = router;
module.exports.processCallRecording = processCallRecording;
module.exports.verifyTwilio = verifyTwilio;
module.exports.VOICEMAIL_GREETING = VOICEMAIL_GREETING;
