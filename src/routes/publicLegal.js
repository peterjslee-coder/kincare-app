// ─── src/routes/publicLegal.js — public, no-auth pages for the legal documents ───
//
// WHY THIS EXISTS (v1.105.4)
// -------------------------
// The lawyer-reviewed documents (Terms of Use, Privacy Policy, Caregiver
// Agreement, Client Services Agreement — all version 2026-07-07) live in the
// `legal_documents` table and were only reachable through the in-app acceptance
// flow, which requires a login.
//
// Meanwhile `/privacy` served a hand-written static page last updated **April 2,
// 2026** that described the **Kindred voice companion** — a feature killed in the
// July 7 review — named ElevenLabs and Google Speech Recognition, and omitted
// almost every processor the platform actually uses. That stale page was the one
// registered with Google Play.
//
// Both app stores require a PUBLICLY ACCESSIBLE policy URL (a reviewer pastes it
// into a browser with no session). So the fix is not to write new policy prose —
// it's to publish the documents the lawyer already approved and users already
// accept, from the same single source of truth.
//
// Deliberately NOT doing here: editing any legal text. The one substantive gap is
// that the 2026-07-07 Privacy Policy predates Cloudflare R2 going live on 7/11 and
// so doesn't name it as a storage processor — that belongs to the lawyer, and it's
// on the 7/31 agenda.

const express = require("express");
const { getDb } = require("../models/database");
const { captureException } = require("../utils/sentry");

const router = express.Router();

// URL slug → doc_type. Only these six types are valid per routes/legal.js.
const SLUGS = {
  "terms": "terms",
  "privacy": "privacy",
  "liability": "liability",
  "disclaimer": "disclaimer",
  "caregiver-agreement": "caregiver_agreement",
  "client-services": "client_services",
};

const LABELS = {
  terms: "Terms of Use",
  privacy: "Privacy Policy",
  liability: "Liability Waiver",
  disclaimer: "Disclaimer",
  caregiver_agreement: "Caregiver Agreement",
  client_services: "Client Services Agreement",
};

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// The stored documents are PLAIN TEXT with blank-line-separated paragraphs (not
// markdown, not HTML). Escape first, then structure: a short ALL-CAPS line is a
// heading, everything else is a paragraph with single newlines preserved.
function renderBody(content) {
  return String(content)
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const safe = escapeHtml(block);
      // Headings in these documents look like "PRIVACY POLICY" / "INFORMATION WE
      // COLLECT": one short line, no lowercase, no sentence-final punctuation.
      // The last two conditions matter — "no lowercase" alone promotes a short
      // sentence like "A." to a heading, and legalese disclaimers are written in
      // full-caps sentences that must stay paragraphs.
      const isHeading =
        block.length <= 90 &&
        !block.includes("\n") &&
        !/[a-z]/.test(block) &&
        (block.match(/[A-Z]/g) || []).length >= 3 &&
        !/[.!?]$/.test(block);
      if (isHeading) return `<h2>${safe}</h2>`;
      return `<p>${safe.replace(/\n/g, "<br>")}</p>`;
    })
    .join("\n");
}

const STYLE = `
  :root { color-scheme: light; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
         max-width: 760px; margin: 0 auto; padding: 32px 20px 72px; color: #24242c; line-height: 1.7; }
  h1 { color: #1b6b5a; font-size: 26px; margin-bottom: 4px; }
  h2 { color: #1b6b5a; font-size: 16px; margin-top: 30px; text-transform: none; }
  .meta { color: #6b6b7b; font-size: 13px; margin: 0 0 28px; }
  p { margin: 12px 0; }
  nav { margin: 0 0 28px; padding-bottom: 18px; border-bottom: 1px solid #e3e3ea; font-size: 14px; }
  nav a { color: #1b6b5a; margin-right: 14px; text-decoration: none; }
  nav a:hover { text-decoration: underline; }
  footer { margin-top: 48px; padding-top: 18px; border-top: 1px solid #e3e3ea; color: #6b6b7b; font-size: 13px; }
`;

function page({ title, meta, body, nav }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — InPlace Care</title>
<style>${STYLE}</style>
</head>
<body>
<nav>${nav}</nav>
<h1>${escapeHtml(title)}</h1>
${meta ? `<p class="meta">${escapeHtml(meta)}</p>` : ""}
${body}
<footer>Cedar Rock Holdings, LLC, doing business as InPlace Care · <a href="mailto:support@yourinplace.com">support@yourinplace.com</a></footer>
</body>
</html>`;
}

async function activeDocs(db) {
  return db
    .prepare(
      `SELECT doc_type, version, title, content, published_at
       FROM legal_documents WHERE is_active = 1 ORDER BY doc_type`
    )
    .all();
}

function navFor(docs) {
  const bySlug = Object.entries(SLUGS);
  const present = new Set(docs.map((d) => d.doc_type));
  const links = bySlug
    .filter(([, type]) => present.has(type))
    .map(([slug, type]) => `<a href="/${slug}">${escapeHtml(LABELS[type] || type)}</a>`);
  return `<a href="/">← InPlace</a>${links.join("")}`;
}

// ─── /legal — index of everything published ───
router.get("/legal", async (req, res, next) => {
  try {
    const db = await getDb();
    const docs = await activeDocs(db);
    if (!docs.length) return next();
    const items = docs
      .map((d) => {
        const slug = Object.keys(SLUGS).find((s) => SLUGS[s] === d.doc_type) || d.doc_type;
        return `<p><a href="/${slug}">${escapeHtml(d.title || LABELS[d.doc_type] || d.doc_type)}</a> — version ${escapeHtml(d.version)}</p>`;
      })
      .join("\n");
    res.set("Cache-Control", "public, max-age=300");
    res.send(page({ title: "Legal", meta: "Current published agreements and policies.", body: items, nav: navFor(docs) }));
  } catch (err) {
    captureException(err);
    next(err);
  }
});

// ─── /terms, /privacy, /caregiver-agreement, … ───
// Registered individually rather than as /:slug so we never shadow SPA routes.
for (const slug of Object.keys(SLUGS)) {
  router.get(`/${slug}`, async (req, res, next) => {
    try {
      const db = await getDb();
      const docs = await activeDocs(db);
      const doc = docs.find((d) => d.doc_type === SLUGS[slug]);
      // No active document of this type ⇒ fall through to the SPA catch-all rather
      // than showing an empty legal page.
      if (!doc) return next();
      const when = doc.published_at ? new Date(doc.published_at).toISOString().slice(0, 10) : null;
      res.set("Cache-Control", "public, max-age=300");
      res.send(
        page({
          title: doc.title || LABELS[doc.doc_type] || slug,
          meta: `Version ${doc.version}${when ? ` · published ${when}` : ""}`,
          body: renderBody(doc.content),
          nav: navFor(docs),
        })
      );
    } catch (err) {
      captureException(err);
      next(err);
    }
  });
}

// ─── /sms — the text-messaging terms (v1.114.4) ───
//
// Carrier registration (A2P 10DLC, via Twilio) requires a public page that names the program,
// says how people opt in, how often we text, "Msg & data rates may apply", STOP/HELP, and that
// mobile opt-in data is never shared. The lawyer-reviewed Privacy Policy names Twilio as a
// processor but has none of the carrier-mandated SMS language, and rejections for exactly that
// gap are the most common reason campaigns are refused. Rather than re-issue a reviewed legal
// document (which re-prompts every user to accept it), this standalone page carries the
// carrier language and points at the Privacy Policy. v1.114.6 folded the same language into
// Privacy Policy 7B (2026-10-14); this page stays as the program terms carriers link to.
const SMS_TERMS = `
<h2>Who is texting you</h2>
<p>InPlace Care is operated by Cedar Rock Holdings, LLC, doing business as InPlace Care, in Fairlawn, Virginia. We send two kinds of text messages, from two numbers.</p>
<h2>1. Care notifications — from (540) 274-1412</h2>
<p>Visit reminders, a caregiver's arrival and departure, schedule changes, and one-time verification codes.</p>
<p><strong>How you opt in:</strong> texts are off unless you turn them on. Caregivers and family members turn on text alerts in Account &rarr; Notifications. For the person receiving care, a member of their care team enters that person's mobile number on the Care Team &rarr; Notifications screen and checks the box agreeing to text reminders; InPlace then sends one text to that number asking the person to reply <strong>YES</strong>, and no reminders are sent unless they do. You can turn texts off in the app at any time; app notifications carry the same alerts. <a href="/sms/opt-in">See the opt-in screens.</a></p>
<p><strong>How often:</strong> varies with the visits on your schedule — typically one to four messages per visit.</p>
<h2>2. Caregiver opportunities — from (540) 835-5987</h2>
<p>One-to-one conversations with independent caregivers about paid caregiving work through InPlace.</p>
<p><strong>How you opt in:</strong> you text <strong>JOIN</strong> (or anything else) to (540) 835-5987. We don't text anyone who hasn't texted us first. If we call you about caregiving work &mdash; a live call from InPlace's founder, one person at a time, never a robocall or prerecorded message &mdash; we invite you to text JOIN; nothing is texted unless you do. <a href="/sms/opt-in">See how.</a></p>
<p><strong>How often:</strong> a few messages per conversation. If you don't reply, we don't keep texting.</p>
<h2>For both</h2>
<p>Message and data rates may apply.</p>
<p>Reply <strong>STOP</strong> at any time to stop receiving messages from that number. You'll get one message confirming you've opted out, and nothing after that. Reply <strong>START</strong> to opt back in.</p>
<p>Reply <strong>HELP</strong> for help, or email <a href="mailto:peter@yourinplace.com">peter@yourinplace.com</a>.</p>
<p>Carriers are not liable for delayed or undelivered messages.</p>
<h2>Privacy</h2>
<p>No mobile information will be shared with third parties or affiliates for marketing or promotional purposes. Text messaging originator opt-in data and consent will not be shared with any third parties. Information is used only to provide the messages described above. See our <a href="/privacy">Privacy Policy</a> for everything else.</p>
<p>See also our <a href="/terms">Terms of Use</a>.</p>
`;

// ─── v1.120.2 — /sms/opt-in: public proof of the in-app (behind-login) opt-ins ───
//
// Carriers rejected both A2P campaigns on 10/15 (error 30909): "There is no proof provided for
// behind the login opt in." Reviewers can't sign in, so this page shows the screens themselves —
// real screenshots from production (sample name and number) — with the exact consent wording,
// which is what utils/smsConsent.js sends and stores. Change one, change the other.
const SC = require("../utils/smsConsent");
const CN = require("../utils/outreachCallNotes"); // v1.122.0 — the call script is published from the code
const SMS_OPTIN = `
<p>InPlace Care sends text messages only to people who opt in. Two of the ways to opt in are inside the InPlace app, behind a sign-in, so this page shows those screens. Texts are always off by default. Full terms: <a href="/sms">yourinplace.com/sms</a>.</p>

<h2>1. Account holders: Account &rarr; Notifications &rarr; Text Message Alerts</h2>
<p>A signed-in caregiver or family member turns on text alerts for their own mobile number. The switch is off until they turn it on, and the consent wording sits right next to it:</p>
<figure><img src="/img/sms-optin/account-text-alerts.png" alt="Text Message Alerts switch, off, with the consent wording beside it" style="width:100%;border:1px solid #ddd;border-radius:8px"><figcaption>Text Message Alerts in Account &rarr; Notifications (shown off, the default).</figcaption></figure>
<p>Exact wording: <em>&ldquo;${escapeHtml(SC.ACCOUNT_CONSENT_TEXT)}&rdquo;</em></p>
<p>Turning it on records the time and the number it applies to. If the number on the account changes, texts stop until they turn it on again.</p>

<h2>2. The person receiving care: Care Team &rarr; Notifications, then a YES by text</h2>
<p>A family member who leads the care team chooses &ldquo;Text only&rdquo; or &ldquo;App + Text&rdquo;, enters the mobile number of the person receiving care, and checks the consent box. The screen won't save text reminders without the box checked:</p>
<figure><img src="/img/sms-optin/care-team-reminders-v2.png" alt="Care Team Notifications screen with reminder method, phone number, reminder times and an unchecked consent box" style="width:100%;border:1px solid #ddd;border-radius:8px"><figcaption>Care Team &rarr; Notifications (sample name and number).</figcaption></figure>
<p>Checking the box only <strong>requests</strong> texts. InPlace then sends one message to that number, and sends nothing else unless the person replies YES:</p>
<blockquote>${escapeHtml(SC.RECIPIENT_CONFIRM_TEXT("Jane", "Sam"))}</blockquote>
<p>When they reply YES:</p>
<blockquote>${escapeHtml(SC.RECIPIENT_CONFIRMED_TEXT)}</blockquote>
<p>If the number changes, both steps start again. STOP from that number turns reminders off in the app as well as with the carrier.</p>

<h2>3. Caregivers looking for work: text JOIN to (540) 835-5987</h2>
<p>Caregivers start the conversation by texting <strong>JOIN</strong> to (540) 835-5987. Nobody is texted from this number until they text it first. The app enforces this: texting a person is blocked until a text from them is on record.</p>
<p>The keyword and number are published on the InPlace home page (<a href="/">yourinplace.com</a>) and at <a href="/work">yourinplace.com/work</a>, with the disclosure &ldquo;By texting JOIN you agree to receive texts from InPlace Care about caregiving work. Msg &amp; data rates may apply. Msg frequency varies. Reply STOP to opt out, HELP for help.&rdquo;</p>
<p>InPlace's founder also calls caregivers who have publicly listed themselves as seeking private-pay work, one person at a time, dialed individually &mdash; live conversations, never robocalls or prerecorded messages. On those calls, and in any voicemail, he invites them to text JOIN; the call itself never opens texting. The call script:</p>
<ol>${CN.CALL_SCRIPT.map((l) => `<li>${l.consent ? "<strong>" : ""}${escapeHtml(String(l.say || l.note).replace(/\{first\}/g, "[name]"))}${l.consent ? "</strong>" : ""}</li>`).join("")}</ol>
<p>When someone texts JOIN, InPlace replies:</p>
<blockquote>${escapeHtml(require("../utils/outreach").JOIN_REPLY)}</blockquote>

<h2>Every program</h2>
<p>Reply STOP to opt out and HELP for help. Msg &amp; data rates may apply. No mobile information is shared with third parties or affiliates for marketing or promotional purposes.</p>
`;

router.get("/sms/opt-in", (req, res) => {
  res.set("Cache-Control", "public, max-age=300");
  res.send(
    page({
      title: "How people opt in to InPlace texts",
      meta: "Updated October 15, 2026",
      body: SMS_OPTIN,
      nav: '<a href="/">← InPlace</a><a href="/sms">Text Messaging Terms</a><a href="/privacy">Privacy Policy</a>',
    })
  );
});

router.get("/sms", (req, res) => {
  res.set("Cache-Control", "public, max-age=300");
  res.send(
    page({
      title: "Text Messaging Terms",
      meta: "Effective October 14, 2026",
      body: SMS_TERMS,
      nav: '<a href="/">← InPlace</a><a href="/terms">Terms of Use</a><a href="/privacy">Privacy Policy</a>',
    })
  );
});

module.exports = router;
module.exports._internals = { renderBody, escapeHtml, SLUGS, SMS_TERMS, SMS_OPTIN };
