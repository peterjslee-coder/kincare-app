/**
 * Magic byte validation — verify file content matches claimed MIME type.
 * Prevents uploading disguised executables via spoofed Content-Type headers.
 */

const MAGIC_BYTES = {
  // Images
  "image/jpeg": [
    { offset: 0, bytes: [0xFF, 0xD8, 0xFF] },
  ],
  "image/png": [
    { offset: 0, bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] },
  ],
  "image/gif": [
    { offset: 0, bytes: [0x47, 0x49, 0x46, 0x38] }, // GIF8 (covers GIF87a and GIF89a)
  ],
  "image/webp": [
    { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] }, // "WEBP" at offset 8
  ],
  // HEIC / HEIF — what an iPhone camera produces. Added v1.106.3 alongside making unknown
  // types fail CLOSED: without a signature here these would start being rejected, and photos
  // already stored from an iOS upload would stop rendering.
  // Layout is `....ftyp<brand>`, so "ftyp" + the brand is one contiguous run at offset 4.
  "image/heic": [
    { offset: 4, bytes: [0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63] }, // ftypheic
    { offset: 4, bytes: [0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x78] }, // ftypheix
    { offset: 4, bytes: [0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x76, 0x63] }, // ftyphevc
    { offset: 4, bytes: [0x66, 0x74, 0x79, 0x70, 0x6D, 0x69, 0x66, 0x31] }, // ftypmif1
  ],
  "image/heif": [
    { offset: 4, bytes: [0x66, 0x74, 0x79, 0x70, 0x6D, 0x69, 0x66, 0x31] }, // ftypmif1
    { offset: 4, bytes: [0x66, 0x74, 0x79, 0x70, 0x6D, 0x73, 0x66, 0x31] }, // ftypmsf1
    { offset: 4, bytes: [0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63] }, // ftypheic
  ],
  // PDF
  "application/pdf": [
    { offset: 0, bytes: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  ],
};

/**
 * Validate that a file buffer's magic bytes match the claimed MIME type.
 * @param {Buffer} buffer - File content buffer
 * @param {string} claimedMime - MIME type from Content-Type header
 * @returns {{ valid: boolean, detected: string|null }}
 */
function validateMagicBytes(buffer, claimedMime) {
  if (!buffer || buffer.length < 16) {
    return { valid: false, detected: null };
  }
  // "IMAGE/JPEG" and "image/jpeg; charset=binary" are the same type; a lookup miss used to mean
  // "allowed", so casing alone could bypass the check.
  const normalized = String(claimedMime || "").split(";")[0].trim().toLowerCase();

  const signatures = MAGIC_BYTES[normalized];
  if (!signatures) {
    // v1.106.3 — this used to ALLOW anything it had no signature for, which is how
    // `image/svg+xml` got through: photos.js and messages.js accept any `image/*`, SVG has no
    // magic bytes, so the one check standing between an upload and being served back from our
    // own origin waved it past. An SVG is a script container.
    //
    // Unknown now means no. Every mime the upload routes accept has a signature above; if a new
    // format is ever needed, add its bytes here rather than removing this.
    return { valid: false, detected: "unsupported" };
  }

  for (const sig of signatures) {
    const match = sig.bytes.every((byte, i) => buffer[sig.offset + i] === byte);
    if (match) {
      return { valid: true, detected: normalized };
    }
  }

  // Claimed MIME doesn't match — try to detect what it actually is
  for (const [mime, sigs] of Object.entries(MAGIC_BYTES)) {
    for (const sig of sigs) {
      const match = sig.bytes.every((byte, i) => buffer[sig.offset + i] === byte);
      if (match) {
        return { valid: false, detected: mime };
      }
    }
  }

  return { valid: false, detected: "unknown" };
}

module.exports = { validateMagicBytes };
