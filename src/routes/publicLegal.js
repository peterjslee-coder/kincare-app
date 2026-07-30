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

module.exports = router;
module.exports._internals = { renderBody, escapeHtml, SLUGS };
