// ─── Media endpoints (v1.66.0, C2 fix) ───
// Serve profile / recipient photos from a dedicated, cacheable endpoint so that
// list and aggregate JSON responses no longer embed multi-megabyte base64 blobs.
// Photos are stored as base64 data URLs in TEXT columns; here we decode and
// stream them as real images with cache headers. Requires authentication
// (photos are semi-public within the app but never to anonymous callers).
const express = require("express");
const { getDb } = require("../models/database");
const { authenticate } = require("../middleware/auth");

const router = express.Router();
router.use(authenticate);

function sendDataUrl(res, dataUrl) {
  if (!dataUrl || typeof dataUrl !== "string") return res.status(404).end();
  // Remote URL (e.g. demo pravatar) — redirect instead of proxying.
  if (/^https?:\/\//i.test(dataUrl)) return res.redirect(302, dataUrl);
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/s);
  if (!m) return res.status(404).end();
  const buf = Buffer.from(m[2], "base64");
  res.set("Content-Type", m[1]);
  res.set("Cache-Control", "private, max-age=86400"); // 1 day; photos change rarely
  return res.send(buf);
}

// GET /api/media/user/:id/photo
router.get("/user/:id/photo", async (req, res) => {
  try {
    const db = await getDb();
    const row = await db.prepare("SELECT profile_photo, avatar_url FROM users WHERE id = ?").get(req.params.id);
    if (!row) return res.status(404).end();
    return sendDataUrl(res, row.profile_photo || row.avatar_url);
  } catch (err) { return res.status(500).end(); }
});

// GET /api/media/recipient/:id/photo
router.get("/recipient/:id/photo", async (req, res) => {
  try {
    const db = await getDb();
    const row = await db.prepare("SELECT photo FROM care_recipients WHERE id = ?").get(req.params.id);
    if (!row) return res.status(404).end();
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
