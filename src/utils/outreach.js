/**
 * Caregiver outreach (v1.113.0) — pure helpers for Admin → Outreach and the inbound SMS webhook.
 *
 * Pete, 10/13: "they're all cold calls...and it's going to have to be via text ... I can't handle
 * 70 different text threads...if it comes from me, it has to go back to the app somehow."
 *
 * So: texts go out from a DEDICATED Twilio number (TWILIO_OUTREACH_NUMBER), never the number that
 * carries arrival reminders — cold texts are what gets a number filtered by carriers, silently, and
 * the reminders must not share that fate. Replies come back to POST /api/sms/outreach-inbound and
 * land in the person's thread in admin. Nothing here is ever sent to a care recipient.
 *
 * Everything in this file is pure (no db, no network) so it can be tested directly.
 */

const OUTREACH_STATUSES = [
  "new",          // imported, never texted
  "texted",       // intro sent, no reply yet
  "replied",      // she wrote back, a person needs to read it
  "interested",   // she sent an email address (or Pete marked her)
  "invited",      // signup invite emailed
  "joined",       // has an InPlace account (derived at read time too)
  "declined",     // said no thanks
  "wrong_number",
  "opted_out",    // STOP — never text again. Only she can undo it (START).
];

// Carrier-standard opt-out / opt-in keywords. Twilio blocks further sends itself after STOP on a
// long code; we record it too so the app never even tries, and so admin can see it.
const OPT_OUT_WORDS = ["stop", "stopall", "unsubscribe", "cancel", "end", "quit", "optout", "revoke"];
const OPT_IN_WORDS = ["start", "unstop", "yes start"];
// Keyword opt-in for someone first reached person-to-person (Pete's own phone): "Text JOIN to …".
// Not "info" — Twilio treats INFO as a HELP keyword on a registered messaging service.
const JOIN_WORDS = ["join", "join inplace", "inplace"];

// Must match the opt-in message registered for the outreach A2P campaign (Twilio, 10/14).
// v1.124.3 — the registered opt-in message. Carriers' checklist (Twilio 30909): brand name,
// confirmation of enrollment, message frequency, opt-out instructions. All four, under 320 chars.
// v1.125.3 — Pete's wording (10/28). The last two sentences are the CTIA opt-in confirmation
// lines the verified campaign (CMba88) was filed with; Pete chose to keep them. ≤320 characters.
const JOIN_REPLY =
  "InPlace Care: Thanks for your interest in joining InPlace! You're signed up for texts about " +
  "caregiving work. Reply with your email and we'll get you set up in no time. Questions? Text or " +
  "call and Pete will get back to you soonest. Msg frequency varies. Msg & data rates may apply. " +
  "Reply HELP for help, STOP to opt out.";

// v1.118.0 — {link} is her own yourinplace.com/i/… link (utils/tracking.js), so a tap is credited to
// her. Same domain as the registered sample; the outreach A2P campaign is filed "embedded links: Yes".
// v1.124.2 — the follow-up after someone texts JOIN. Texts go only to people who texted first
// with a recorded OK (routes/outreach.js sendToContact), so this is never a cold first contact.
// v1.125.4 — starting points for the first text after someone OKs texting on a call. Pete, 10/28:
// "if I record an OK to text … I need a few options to choose from/modify on the first text."
// The first one is his wording. {first} is filled in on the screen; {link} becomes their own
// tracked link when the text is sent. Each carries the HELP/STOP lines.
const FIRST_TEXTS = [
  {
    id: "after_call",
    label: "After a call",
    body: "Hi {first}, thanks for your time on the phone earlier and your interest in private care through InPlace! " +
      "Reply with your email address and we'll get you set up in no time! You can call or text Pete anytime at " +
      "this number if you have any questions. Msg frequency varies. Msg & data rates may apply. Reply HELP for help, STOP to opt out.",
  },
  {
    id: "after_call_link",
    label: "After a call + link",
    body: "Hi {first}, it's Pete with InPlace. Thanks for your time on the phone today! Here's more about private care " +
      "work with us: {link} Reply with your email address and we'll get you set up in no time. Call or text this " +
      "number anytime with questions. Reply HELP for help, STOP to opt out.",
  },
  {
    id: "checking_in",
    label: "Checking in",
    body: "Hi {first}, it's Pete with InPlace checking in. Any questions I can answer? Reply with your email address " +
      "and I'll send your signup link, or call this number anytime. Reply STOP to opt out.",
  },
];

const DEFAULT_INTRO =
  "Hi {first}, it's Pete Lee with InPlace Care. Thanks for texting JOIN! Here's " +
  "the info on caregiving work ({link}). Reply with your email and I'll send your signup link. " +
  "Reply STOP to opt out.";

/** Last 10 digits of a US number, or null. */
function phoneKey(raw) {
  const d = String(raw || "").replace(/\D/g, "");
  if (d.length === 10) return d;
  if (d.length === 11 && d[0] === "1") return d.slice(1);
  return null;
}
function toE164(raw) {
  const k = phoneKey(raw);
  return k ? `+1${k}` : null;
}
function prettyPhone(raw) {
  const k = phoneKey(raw);
  return k ? `${k.slice(0, 3)}-${k.slice(3, 6)}-${k.slice(6)}` : String(raw || "");
}

const PHONE_RE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g;

/**
 * Parse a pasted list, one person per line. Understands the NRVAOA sitter-list shape
 *   "Gambill, Juanita ........ 540-831-9027 (CNA, Christiansburg, Radford, Blacksburg)"
 * and simpler "Juanita Gambill, 540-831-9027, notes" / tab-separated rows.
 * A second number on the line ("540-382-7654 or 540-392-3848") is kept in notes.
 * Two names sharing one number are merged into one contact (one phone = one thread).
 * Returns { contacts: [{first_name,last_name,phone,notes}], skipped: [line] }.
 */
function parseList(text) {
  const byPhone = new Map();
  const skipped = [];
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.replace(/ /g, " ").trim();
    if (!line) continue;
    const phones = line.match(PHONE_RE) || [];
    const firstPhone = phones.map(phoneKey).find(Boolean);
    if (!firstPhone) { skipped.push(line); continue; }
    const idx = line.search(PHONE_RE);
    let namePart = line.slice(0, idx).replace(/[.…_\t]+/g, " ").replace(/[,\s]+$/, "").trim();
    let rest = line.slice(idx).replace(PHONE_RE, (m) => (phoneKey(m) === firstPhone ? "" : m)).trim();
    rest = rest.replace(/^[,;\s-]+/, "").replace(/^\((.*)\)$/, "$1").trim();
    let first = "", last = "";
    if (namePart.includes(",")) {
      const [l, ...f] = namePart.split(",");
      last = l.trim();
      first = f.join(",").trim();
    } else {
      const parts = namePart.split(/\s+/).filter(Boolean);
      first = parts.shift() || "";
      last = parts.join(" ");
    }
    first = first.replace(/[“”"]/g, "\"").trim();
    if (!first && !last) { skipped.push(line); continue; }
    const notes = rest.replace(/\s{2,}/g, " ").trim();
    const existing = byPhone.get(firstPhone);
    if (existing) {
      // Same number, second name: one thread, greet both.
      const theirFirst = first.split(/\s+/)[0];
      if (theirFirst && !existing.first_name.split(" & ").includes(theirFirst)) {
        existing.first_name = `${existing.first_name} & ${theirFirst}`;
      }
      const also = `Also listed at this number: ${[first, last].filter(Boolean).join(" ")}${notes ? ` (${notes})` : ""}`;
      existing.notes = existing.notes ? `${existing.notes} · ${also}` : also;
      continue;
    }
    byPhone.set(firstPhone, { first_name: first, last_name: last, phone: `+1${firstPhone}`, notes: notes || null });
  }
  return { contacts: [...byPhone.values()], skipped };
}

/** The greeting name: the first word of first_name, quotes/nicknames stripped; "there" if none. */
function greetingName(contact) {
  const f = String(contact?.first_name || "").trim();
  if (!f) return "there";
  if (f.includes(" & ")) return f;
  const nick = f.match(/["“]([^"”]+)["”]/);
  if (nick) return nick[1];
  return f.split(/\s+/)[0];
}

/**
 * {first} {last} and, since v1.117.0, {link} — her own short link (yourinplace.com/i/xxxxxx), so a
 * tap is credited to her (utils/tracking.js). With no link to give, {link} falls back to the bare
 * site rather than leaving a hole in the sentence.
 */
function renderTemplate(tpl, contact, link = null) {
  return String(tpl || "")
    .replace(/\{first\}/gi, greetingName(contact))
    .replace(/\{last\}/gi, String(contact?.last_name || "").trim())
    .replace(/\{link\}/gi, link || "yourinplace.com")
    .trim();
}

const hasLinkToken = (s) => /\{link\}/i.test(String(s || ""));

const EMAIL_RE = /[A-Z0-9._%+'-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

/**
 * What an inbound text means. Opt-out wins over everything: "STOP" must never be read as
 * anything else. An email anywhere in the message counts as "interested".
 */
function classifyInbound(body) {
  const text = String(body || "").trim();
  const norm = text.toLowerCase().replace(/[^a-z ]/g, "").trim();
  if (OPT_OUT_WORDS.includes(norm)) return { kind: "opt_out" };
  if (OPT_IN_WORDS.includes(norm)) return { kind: "opt_in" };
  if (JOIN_WORDS.includes(norm)) return { kind: "join" };
  const m = text.match(EMAIL_RE);
  if (m) return { kind: "email", email: m[0].replace(/[.,;:]+$/, "").toLowerCase() };
  return { kind: "message" };
}

/**
 * Cold intro texts go out only between 9am and 8pm Eastern, Mon–Sat. Federal TCPA allows 8–9;
 * this is a deliberately narrower window. Individual replies to someone who wrote first are not
 * held to it.
 */
function introWindow(now = new Date(), tz = "America/New_York") {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23", weekday: "short" })
    .formatToParts(now).reduce((a, p) => ((a[p.type] = p.value), a), {});
  const hour = Number(parts.hour);
  const sunday = parts.weekday === "Sun";
  const open = !sunday && hour >= 9 && hour < 20;
  return { open, reason: open ? null : (sunday ? "Intro texts don't go out on Sundays." : "Intro texts go out between 9am and 8pm Eastern.") };
}

/**
 * The only numbers the browser Call button may dial: a full ten-digit US number, area code and
 * exchange not starting with 0/1 (NANP), returned as +1XXXXXXXXXX. Emergency and short codes
 * (911, 933, 112, 988, N11) can never pass. Returns null otherwise.
 */
function dialableUsNumber(raw) {
  const k = phoneKey(raw);
  if (!k || !/^[2-9]\d{2}[2-9]\d{6}$/.test(k)) return null;
  if (/^[2-9]11/.test(k) || /^[2-9]11/.test(k.slice(3))) return null; // no N11 area code or exchange (911, 411, 988-adjacent service codes)
  return `+1${k}`;
}

/** SMS segments: GSM-7 = 160 (153 per part), anything else = 70 (67 per part). */
function segmentCount(text) {
  const s = String(text || "");
  const gsm = /^[A-Za-z0-9 \r\n@£$¥èéùìòÇØøÅå_ÆæßÉ!"#%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà^{}\\[~\]|€]*$/.test(s);
  const single = gsm ? 160 : 70, multi = gsm ? 153 : 67;
  return s.length <= single ? 1 : Math.ceil(s.length / multi);
}

module.exports = {
  OUTREACH_STATUSES, OPT_OUT_WORDS, OPT_IN_WORDS, JOIN_WORDS, JOIN_REPLY, DEFAULT_INTRO, FIRST_TEXTS,
  phoneKey, toE164, prettyPhone, parseList, greetingName, renderTemplate, hasLinkToken,
  classifyInbound, introWindow, segmentCount, dialableUsNumber,
};
