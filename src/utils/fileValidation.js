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

  const signatures = MAGIC_BYTES[claimedMime];
  if (!signatures) {
    // No magic bytes defined for this type — skip validation (allow through)
    return { valid: true, detected: null };
  }

  for (const sig of signatures) {
    const match = sig.bytes.every((byte, i) => buffer[sig.offset + i] === byte);
    if (match) {
      return { valid: true, detected: claimedMime };
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
