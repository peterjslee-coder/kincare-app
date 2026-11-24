// ─── v1.155.1 — shrink an uploaded photo on the server ───
//
// Pete, 11/23: "Getting 'photo too large' when I try to add one from my phone." The client
// downscales before upload (downscaleImageFile), but when the browser cannot decode the picture
// — a 48-megapixel iPhone photo in the app's WebView, a HEIC — it falls back to sending the
// original untouched, and a phone photo is easily 6–15 MB against a 5 MB cap.
//
// So the server accepts up to PHOTO_UPLOAD_MAX and makes the stored copy itself: turned upright
// from EXIF, at most 2000 px on the long side, JPEG. What lands in storage is what the screens
// need (a 300 KB–1 MB JPEG), whatever the phone sent. GIFs keep their animation and pass
// through if they are already small enough. If sharp cannot read it, a file that already fits
// is kept as it came; anything else is refused with words a person can act on.

const PHOTO_UPLOAD_MAX = 25 * 1024 * 1024;  // what multer accepts off the wire
const PHOTO_STORED_MAX = 5 * 1024 * 1024;   // what we will keep if we cannot shrink it
const LONG_SIDE = 2000;

/**
 * @param {Buffer} buffer  the uploaded bytes (magic bytes already checked)
 * @param {string} mime    the claimed type
 * @returns {Promise<{ok: true, buffer: Buffer, mime: string} | {ok: false, error: string}>}
 */
/** A crop as fractions of the upright picture: {x, y, w, h}, each 0..1. Null if unusable. */
function cleanCrop(raw) {
  let c = raw;
  if (typeof c === "string") { try { c = JSON.parse(c); } catch { return null; } }
  if (!c || typeof c !== "object") return null;
  const n = ["x", "y", "w", "h"].map((k) => Number(c[k]));
  if (n.some((v) => !Number.isFinite(v))) return null;
  let [x, y, w, h] = n;
  x = Math.min(Math.max(x, 0), 1); y = Math.min(Math.max(y, 0), 1);
  w = Math.min(w, 1 - x); h = Math.min(h, 1 - y);
  if (w < 0.05 || h < 0.05) return null;
  if (x === 0 && y === 0 && w >= 0.999 && h >= 0.999) return null;
  return { x, y, w, h };
}

async function shrinkPhoto(buffer, mime, crop = null) {
  const type = String(mime || "").toLowerCase();
  if (type === "image/gif") {
    return buffer.length <= PHOTO_STORED_MAX
      ? { ok: true, buffer, mime: type }
      : { ok: false, error: "That GIF is too big. Try a photo instead." };
  }
  try {
    const sharp = require("sharp");
    // Upright first, so a crop chosen on the screen means the same rectangle here.
    let img = sharp(await sharp(buffer, { failOn: "none", limitInputPixels: 200e6 }).rotate().toBuffer());
    const c = cleanCrop(crop);
    if (c) {
      const { width, height } = await img.metadata();
      const left = Math.round(c.x * width), top = Math.round(c.y * height);
      const w = Math.max(1, Math.min(width - left, Math.round(c.w * width)));
      const h = Math.max(1, Math.min(height - top, Math.round(c.h * height)));
      img = img.extract({ left, top, width: w, height: h });
    }
    const out = await img
      .resize({ width: LONG_SIDE, height: LONG_SIDE, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
    return { ok: true, buffer: out, mime: "image/jpeg" };
  } catch {
    if (buffer.length <= PHOTO_STORED_MAX) return { ok: true, buffer, mime: type };
    return { ok: false, error: "That photo couldn't be read. Try taking a screenshot of it and adding that instead." };
  }
}

module.exports = { shrinkPhoto, cleanCrop, PHOTO_UPLOAD_MAX, PHOTO_STORED_MAX };
