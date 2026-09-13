// ─── Media endpoints (v1.66.0, C2 fix) ───
// Serve profile / recipient photos from a dedicated, cacheable endpoint so that
// list and aggregate JSON responses no longer embed multi-megabyte base64 blobs.
// Photos are stored as base64 data URLs in TEXT columns; here we decode and
// stream them as real images with cache headers. Requires authentication
// (photos are semi-public within the app but never to anonymous callers).
const express = require("express");
const { getDb } = require("../models/database");
const { authenticate } = require("../middleware/auth");
const { sendStoredFile, IMAGE_MIMES, DOCUMENT_MIMES } = require("../utils/serveMedia");

const router = express.Router();
router.use(authenticate);

// v1.106.3 — this echoed the STORED mime straight back as the Content-Type, and the three
// write paths stored any string a caller sent. `data:text/html;base64,<script>` therefore came
// back as executable HTML from our own origin. It also 302'd to any `https://` string it found,
// which is an authenticated open redirect; nothing writes remote URLs any more (seed.js has
// stored real bytes since v1.105.95), so that branch is gone rather than patched.
async function sendDataUrl(res, dataUrl) {
  return await sendStoredFile(res, dataUrl, { allow: IMAGE_MIMES, filename: "photo" });
}

// v1.106.4 — a demo token is free and passwordless, so it must not reach a real person's face.
// Blanket-blocking demo here would break the demo itself (it needs its own avatars), so the
// rule is the boundary rather than the role: a demo session may only load demo people.
async function demoBoundaryBlocks(req, db, targetIsDemo) {
  if (req.user?.demo !== true) return false;   // real session: unaffected
  return !targetIsDemo;
}

// GET /api/media/user/:id/photo
router.get("/user/:id/photo", async (req, res) => {
  try {
    const db = await getDb();
    const row = await db.prepare(
      "SELECT profile_photo, avatar_url, is_demo FROM users WHERE id = ?"
    ).get(req.params.id);
    if (!row) return res.status(404).end();
    if (await demoBoundaryBlocks(req, db, !!row.is_demo)) return res.status(404).end();
    return await sendDataUrl(res, row.profile_photo || row.avatar_url);
  } catch (err) { return res.status(500).end(); }
});

// GET /api/media/recipient/:id/photo
router.get("/recipient/:id/photo", async (req, res) => {
  try {
    const db = await getDb();
    const row = await db.prepare(
      "SELECT cr.photo, u.is_demo FROM care_recipients cr LEFT JOIN users u ON cr.family_user_id = u.id WHERE cr.id = ?"
    ).get(req.params.id);
    if (!row) return res.status(404).end();
    if (await demoBoundaryBlocks(req, db, !!row.is_demo)) return res.status(404).end();
    return await sendDataUrl(res, row.photo);
  } catch (err) { return res.status(500).end(); }
});

// ─── v1.106.8 — one column of record, one way to ask "do they have a photo" ───
//
// `users.avatar_url` and `users.profile_photo` held IDENTICAL bytes, written together at five
// call sites, and both were returned by /api/auth/me — which the app calls nine times on boot.
// So every avatar was stored twice and sent twice, nine times over, per session.
//
// `profile_photo` is now the column of record and the only one written. `avatar_url` is read
// as a fallback and nothing more, because rows predating this release still have it, and
// migration 034 only clears the ones it can prove are duplicates.
//
// HAS_PHOTO_SQL is how a query asks the question without pulling the answer: selecting the
// column to test it for truthiness is exactly the waste this is removing.
//
// "Has a photo" means one we can SERVE. `avatar_url` also holds remote https URLs — Google's
// avatar at OAuth signup, i.pravatar for demo accounts — and /api/media/user/:id/photo cannot
// serve those: v1.106.3 removed the 302 branch on purpose, because following a stored URL is
// an authenticated open redirect. Counting them as photos produces a broken <img>, so don't.
function hasPhotoSql(alias = "u") {
  const a = /^\w{0,10}$/.test(alias) ? alias : "u";
  const p = a ? `${a}.` : "";
  return `(${p}profile_photo IS NOT NULL OR ${p}avatar_url LIKE 'data:%' OR ${p}avatar_url LIKE 'r2:%') AS has_photo`;
}
const HAS_PHOTO_SQL = hasPhotoSql("u");

function isServablePhoto(v) {
  return typeof v === "string" && (v.startsWith("data:") || v.startsWith("r2:"));
}

/** True when this user has a photo, whichever shape the row is in. */
function userHasPhoto(user) {
  if (!user) return false;
  if (user.has_photo) return true;
  return isServablePhoto(user.profile_photo) || isServablePhoto(user.avatar_url);
}

/** The URL to a user's photo, or null if they have none. */
function userPhotoUrl(user) {
  return userHasPhoto(user) ? `/api/media/user/${user.id}/photo` : null;
}
function recipientPhotoUrl(recipient) {
  return recipient && recipient.photo ? `/api/media/recipient/${recipient.id}/photo` : null;
}

module.exports = router;
module.exports.userPhotoUrl = userPhotoUrl;
module.exports.recipientPhotoUrl = recipientPhotoUrl;
module.exports.userHasPhoto = userHasPhoto;
module.exports.HAS_PHOTO_SQL = HAS_PHOTO_SQL;
module.exports.isServablePhoto = isServablePhoto;
module.exports.hasPhotoSql = hasPhotoSql;
