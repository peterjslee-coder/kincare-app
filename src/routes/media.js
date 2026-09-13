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
function sendDataUrl(res, dataUrl) {
  return sendStoredFile(res, dataUrl, { allow: IMAGE_MIMES, filename: "photo" });
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
    return sendDataUrl(res, row.profile_photo || row.avatar_url);
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
    return sendDataUrl(res, row.photo);
  } catch (err) { return res.status(500).end(); }
});

// Helper for other routes: the URL to a user's photo, or null if they have none.
function userPhotoUrl(user) {
  const has = user && (user.profile_photo || user.avatar_url);
  return has ? `/api/media/user/${user.id}/photo` : null;
}
function recipientPhotoUrl(recipient) {
  return recipient && recipient.photo ? `/api/media/recipient/${recipient.id}/photo` : null;
}

module.exports = router;
module.exports.userPhotoUrl = userPhotoUrl;
module.exports.recipientPhotoUrl = recipientPhotoUrl;
