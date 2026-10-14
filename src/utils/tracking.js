/**
 * Journey tracking (v1.117.0) — how people find InPlace and what they do once they're here.
 *
 * Pete, 10/14: "I did an outreach text. That text was delivered. That person never responded,
 * clicked the link, spent four minutes on the splash page, signed up but stopped when they got
 * to background check ... sent a link to someone else." Delivery, replies and calls were
 * already recorded (outreach_messages). What was missing was the click, the time on each
 * screen, and the thread that ties an anonymous phone to the account it later becomes.
 *
 * Three tables (migration 066_journey_tracking):
 *   track_links   one short code per person or per campaign. yourinplace.com/i/<code>
 *   visitors      one row per browser/phone. An anonymous id the app keeps in localStorage,
 *                 linked to the account (user_id) once that person signs up or signs in.
 *   visit_events  start (where this visit came from) · page (a screen and how long) ·
 *                 identify (the visitor became / is this account)
 *
 * WHAT IS NEVER RECORDED (the privacy line — Pete: "it can't drastically alter the legal
 * framework or privacy policy"): screen NAMES only, from the app's own router — never an id,
 * never anything a person typed, never a care note, never a URL path with a token in it. The
 * referrer is kept as a bare host ("facebook.com"), never the full URL. Ad click ids are kept
 * as the TYPE ("fbclid") never the value — the value is only useful for sending conversions
 * back to the ad network, which we deliberately do not do. No third party receives any of it.
 * tests/journeyTracking.test.js holds these lines.
 */
const crypto = require("crypto");

const CODE_ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/l/I
const CODE_LEN = 6;
const CODE_RE = /^[A-Za-z0-9]{4,12}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// A screen name from the app's router (currentPage / appState): lowercase words joined by - or _.
const PAGE_RE = /^[a-z][a-z0-9_-]{0,39}$/;

const LINK_KINDS = ["outreach", "campaign", "share", "invite"];
const AUDIENCES = ["caregiver", "family", "care_for"];
// The click ids ad networks append. Only the NAME is ever stored.
const CLICK_ID_PARAMS = ["fbclid", "gclid", "gbraid", "wbraid", "msclkid", "ttclid", "li_fat_id", "twclid", "dclid"];
const OWN_HOSTS = ["yourinplace.com", "www.yourinplace.com", "localhost"];

// A visit's screen time is capped: a phone left open on a screen overnight is not eight hours
// of reading.
const MAX_PAGE_MS = 30 * 60 * 1000;
const MAX_EVENTS_PER_POST = 25;

function makeCode(len = CODE_LEN) {
  const bytes = crypto.randomBytes(len);
  let s = "";
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return s;
}

const isCode = (c) => typeof c === "string" && CODE_RE.test(c);
const isUuid = (v) => typeof v === "string" && UUID_RE.test(v);
const cleanPage = (p) => (typeof p === "string" && PAGE_RE.test(p) ? p : null);

/** "https://m.facebook.com/some/post?x=1" → "facebook.com". Own host and garbage → null. */
function refHost(ref) {
  if (!ref || typeof ref !== "string") return null;
  let h;
  try {
    const u = new URL(ref);
    // android-app://com.google.android.gm is Android saying "from the Gmail app" — worth keeping.
    if (!["http:", "https:", "android-app:"].includes(u.protocol)) return null;
    h = u.hostname.toLowerCase();
  } catch { return null; }
  if (!h || OWN_HOSTS.includes(h) || h.endsWith(".up.railway.app")) return null;
  h = h.replace(/^(www|m|l|lm|mobile|out)\./, "");
  return h.slice(0, 100);
}

/** utm_* values: short, plain tokens. Anything else is dropped rather than stored. */
function cleanTag(v) {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase().replace(/\s+/g, "_").slice(0, 60);
  return /^[a-z0-9._+-]+$/.test(s) ? s : null;
}

function cleanUtm(u) {
  const o = u && typeof u === "object" ? u : {};
  return {
    source: cleanTag(o.source), medium: cleanTag(o.medium), campaign: cleanTag(o.campaign),
    content: cleanTag(o.content), term: cleanTag(o.term),
  };
}

const cleanClickId = (c) => (CLICK_ID_PARAMS.includes(c) ? c : null);
const cleanPlatform = (p) => (["web", "ios", "android", "pwa"].includes(p) ? p : null);

/** The short link for a code. */
function linkUrl(code, appUrl = process.env.APP_URL || "https://yourinplace.com") {
  return `${String(appUrl).replace(/\/+$/, "")}/i/${code}`;
}

/** The same link as it goes in a text: no "https://" (phones link a bare domain; it saves 8 characters). */
const smsLink = (code, appUrl) => linkUrl(code, appUrl).replace(/^https?:\/\//, "");

/** Insert a link with a fresh code, retrying on the (rare) collision. Returns the code. */
async function createLink(db, { kind, audience = null, outreachContactId = null, ownerUserId = null, label = null, createdBy = null }) {
  if (!LINK_KINDS.includes(kind)) throw new Error(`bad link kind ${kind}`);
  const aud = AUDIENCES.includes(audience) ? audience : null;
  for (let i = 0; i < 5; i++) {
    const code = makeCode();
    const r = await db.prepare(`
      INSERT INTO track_links (code, kind, audience, outreach_contact_id, owner_user_id, label, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, NOW()) ON CONFLICT (code) DO NOTHING
    `).run(code, kind, aud, outreachContactId, ownerUserId, label ? String(label).slice(0, 80) : null, createdBy);
    if (r && (r.changes === 1 || r.rowCount === 1)) return code;
  }
  throw new Error("could not mint a link code");
}

/** The one personal link for an outreach contact — minted on first use, then reused forever. */
async function linkForContact(db, contact, { audience = "caregiver", createdBy = null } = {}) {
  const have = await db.prepare(
    "SELECT code FROM track_links WHERE outreach_contact_id = ? AND kind = 'outreach' ORDER BY created_at ASC LIMIT 1"
  ).get(contact.id);
  if (have) return have.code;
  return createLink(db, { kind: "outreach", audience, outreachContactId: contact.id, createdBy });
}

/**
 * Where a code sends someone. Today every audience lands on the home page; the audience
 * landing pages (Pete, 10/14 — "not up front for the main page ... hidden") are added here when
 * they exist. The code always rides along as ?l= so the app can count the visit.
 */
function destinationFor(link) {
  return `/?l=${encodeURIComponent(link.code)}`;
}

module.exports = {
  CODE_RE, PAGE_RE, LINK_KINDS, AUDIENCES, CLICK_ID_PARAMS, MAX_PAGE_MS, MAX_EVENTS_PER_POST,
  makeCode, isCode, isUuid, cleanPage, refHost, cleanTag, cleanUtm, cleanClickId, cleanPlatform,
  linkUrl, smsLink, createLink, linkForContact, destinationFor,
};

/**
 * What one outreach contact did with her link — the summary Admin → Outreach shows above the
 * thread. Visitors are hers if they arrived on her link, or if they belong to the account she
 * later made (a second phone, or a visit after she signed up on a laptop).
 */
async function journeyForContact(db, contactId, userId = null) {
  const codes = (await db.prepare(
    "SELECT code FROM track_links WHERE outreach_contact_id = ?"
  ).all(contactId)).map((r) => r.code);
  if (!codes.length && !userId) return null;
  const ph = (arr) => arr.map(() => "?").join(",") || "NULL";
  const visitors = (await db.prepare(`
    SELECT DISTINCT visitor_id AS id FROM visit_events WHERE link_code IN (${ph(codes)})
    UNION SELECT id FROM visitors WHERE first_link_code IN (${ph(codes)})
    UNION SELECT id FROM visitors WHERE user_id = ?
  `).all(...codes, ...codes, userId)).map((r) => r.id);
  const vph = ph(visitors);
  const whoSql = userId ? `(visitor_id IN (${vph}) OR user_id = ?)` : `visitor_id IN (${vph})`;
  const whoArgs = userId ? [...visitors, userId] : visitors;
  const opens = await db.prepare(`
    SELECT COUNT(*) AS n, MIN(created_at) AS first_at, MAX(created_at) AS last_at
      FROM visit_events WHERE kind = 'start' AND link_code IN (${ph(codes)})
  `).get(...codes);
  const time = await db.prepare(`
    SELECT COALESCE(SUM(ms), 0) AS ms, MAX(created_at) AS last_seen_at, COUNT(DISTINCT session_id) AS sessions,
           COUNT(DISTINCT (created_at AT TIME ZONE 'America/New_York')::date) AS days
      FROM visit_events
     WHERE kind = 'page' AND demo = FALSE AND ${whoSql}
  `).get(...whoArgs);
  const pages = await db.prepare(`
    SELECT page, SUM(ms) AS ms, COUNT(*) AS views
      FROM visit_events
     WHERE kind = 'page' AND demo = FALSE AND ${whoSql}
     GROUP BY page ORDER BY SUM(ms) DESC LIMIT 6
  `).all(...whoArgs);
  const signedUp = userId ? await db.prepare("SELECT created_at FROM users WHERE id = ?").get(userId) : null;
  return {
    link: codes[0] ? linkUrl(codes[0]) : null,
    opens: Number(opens?.n) || 0,
    firstOpenedAt: opens?.first_at || null,
    lastOpenedAt: opens?.last_at || null,
    siteMs: Number(time?.ms) || 0,
    sessions: Number(time?.sessions) || 0,
    daysActive: Number(time?.days) || 0,
    lastSeenAt: time?.last_seen_at || null,
    signedUpAt: signedUp?.created_at || null,
    pages: pages.map((p) => ({ page: p.page, ms: Number(p.ms) || 0, views: Number(p.views) || 0 })),
  };
}

module.exports.journeyForContact = journeyForContact;
