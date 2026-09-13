/**
 * Serving stored files safely (v1.106.3).
 *
 * Five routes had grown the same seven lines: match a stored `data:<mime>;base64,...` string,
 * echo the mime straight back as the Content-Type, and send the bytes. Everything in that
 * sentence is attacker-controlled, because the mime is whatever was in the string when it was
 * written — and three write paths (PUT /api/auth/me/photo, the care-recipient photo, and the
 * admin photo setter) stored ANY string a caller sent, with no check at all.
 *
 * So `photo: "data:text/html;base64,<script>..."` came back as text/html from our own origin,
 * where the CSP allows inline script. Same-origin script can read the CSRF cookie and act as
 * whoever opened the link — including an admin, whose impersonation token lives in
 * sessionStorage. The SVG route to the same place was open too: photos.js and messages.js
 * accepted any `image/*`, and `image/svg+xml` has no magic-byte signature, so the validator
 * waved it through.
 *
 * The read side is the backstop that has to hold even when the write side has already failed,
 * because it protects the rows written before today. So this helper never trusts the stored
 * mime: it serves only from an allowlist, re-checks the actual bytes, and sends the file
 * inert (nosniff + a sandbox CSP) so a mislabelled thing cannot execute even if it gets out.
 */
const { validateMagicBytes } = require("./fileValidation");

// Everything here has a magic-byte signature in fileValidation.js, so "allowed" and
// "verifiable" are the same list. Deliberately no SVG: it is a script container.
const IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"];
const DOCUMENT_MIMES = [...IMAGE_MIMES, "application/pdf"];

/** `data:image/png;base64,AAA` → { mime, buffer }, or null if it isn't a data URI. */
function parseDataUrl(dataUrl) {
  if (typeof dataUrl !== "string") return null;
  const m = dataUrl.match(/^data:([^;,]+)(;[^,]*)?,(.*)$/s);
  if (!m) return null;
  const mime = m[1].trim().toLowerCase();
  const isBase64 = (m[2] || "").includes("base64");
  if (!isBase64) return null; // we only ever store base64; anything else is not ours
  let buffer;
  try { buffer = Buffer.from(m[3], "base64"); } catch { return null; }
  if (!buffer.length) return null;
  return { mime, buffer };
}

/**
 * Send a stored data-URI as a file, or 404.
 *
 * 404 rather than 400 on a bad mime deliberately: the caller has already established that the
 * requester may see this row, so the only way to get here with a rejected type is stored data
 * that should never have been accepted. Saying "unsupported type" would confirm the row exists
 * and describe its contents.
 *
 * @returns the express response, so callers can `return sendStoredFile(...)`
 */
function sendStoredFile(res, dataUrl, { allow = IMAGE_MIMES, filename = null, maxAge = 86400 } = {}) {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return res.status(404).end();
  if (!allow.includes(parsed.mime)) return res.status(404).end();

  // The bytes must actually be what the label says. This is what stops a renamed HTML or SVG
  // payload riding in under an allowed mime.
  const check = validateMagicBytes(parsed.buffer, parsed.mime);
  if (!check.valid) return res.status(404).end();

  res.set("Content-Type", parsed.mime);              // from the allowlist, never echoed raw
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Content-Security-Policy", "default-src 'none'; sandbox");
  res.set("Content-Disposition",
    `inline; filename="${String(filename || "file").replace(/[^\w.\- ]/g, "_").slice(0, 100)}"`);
  res.set("Cache-Control", `private, max-age=${maxAge}`);
  return res.send(parsed.buffer);
}

/**
 * Validate a base64 data URI BEFORE storing it.
 *
 * The read side (sendStoredFile) is the backstop that protects rows written before today; this
 * is the front door. PUT /api/auth/me/photo, the care-recipient photo and the admin photo setter
 * all took `req.body.photo` and wrote it to the database with no check beyond a length cap.
 *
 * @returns {{ok: true, mime: string, bytes: number} | {ok: false, error: string}}
 */
function validateImageDataUrl(dataUrl, { allow = IMAGE_MIMES, maxBytes = 2 * 1024 * 1024 } = {}) {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return { ok: false, error: "Photo must be a base64 image data URL" };
  if (!allow.includes(parsed.mime)) {
    return { ok: false, error: "Photos must be JPEG, PNG, WebP, GIF or HEIC" };
  }
  if (parsed.buffer.length > maxBytes) {
    return { ok: false, error: `Photo too large (max ${Math.round(maxBytes / 1024 / 1024)}MB)` };
  }
  if (!validateMagicBytes(parsed.buffer, parsed.mime).valid) {
    return { ok: false, error: "Photo content does not match its type" };
  }
  return { ok: true, mime: parsed.mime, bytes: parsed.buffer.length };
}

/**
 * Turn a stored image value into something safe to put in JSON (v1.106.7).
 *
 * A data URL or an `r2:` marker becomes a URL pointing at the endpoint that streams it; an
 * ordinary http(s) URL — older rows, and anything a future writer stores by reference —
 * passes straight through. Lives here rather than in a router because dashboard.js and
 * photos.js must agree on the answer, and a router is not a library.
 *
 * @param {string} basePath e.g. "/api/photos"
 * @param {{id: string, photo_url?: string}} row
 */
function storedImageUrl(basePath, row, field = "photo_url") {
  const v = row && row[field];
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  return `${basePath}/${row.id}/image`;
}

module.exports = { sendStoredFile, parseDataUrl, validateImageDataUrl, storedImageUrl, IMAGE_MIMES, DOCUMENT_MIMES };
