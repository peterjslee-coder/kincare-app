/**
 * Object storage for user-uploaded blobs (tier-2 #2, v1.91.0).
 *
 * Historically every upload (documents, receipts, photos) was stored as a
 * base64 data URI in a Postgres TEXT column. That bloats the database, slows
 * backups, and makes row scans expensive. This module moves NEW uploads to
 * Cloudflare R2 (S3-compatible) while leaving existing rows untouched.
 *
 * ENV-GATED: with no R2 credentials configured, every function is a no-op
 * pass-through and behavior is byte-for-byte identical to before. Set:
 *   R2_ACCOUNT_ID          Cloudflare account id
 *   R2_ACCESS_KEY_ID       R2 API token key (Object Read & Write, uploads bucket)
 *   R2_SECRET_ACCESS_KEY   "
 *   R2_UPLOADS_BUCKET      e.g. "inplace-uploads" (SEPARATE from the backups bucket)
 *
 * How it works:
 *  - storeFileData(prefix, dataUri): uploads the decoded blob to R2 and returns
 *    a marker string "r2:<key>" to store in the existing file_data column.
 *    With storage disabled (or input that isn't a data URI) it returns the
 *    input unchanged — the column keeps holding the base64 data URI.
 *  - resolveFileData(value): the inverse. Plain values pass through; "r2:" markers
 *    are fetched from R2 and rebuilt into a data URI, so every existing read
 *    path (streaming endpoints, AI classification) works on both shapes.
 *  - deleteFileData(value): best-effort object delete when a row is removed.
 *
 * Backfill of pre-existing rows is a separate, later migration (run once creds
 * exist and the flow is proven in prod).
 *
 * NOTE (lawyer agenda 7/31): storage-vendor / BAA question for Cloudflare R2 —
 * uploaded documents can contain health-adjacent information.
 */
const crypto = require("crypto");

let _client = null;

function isEnabled() {
  return !!(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_UPLOADS_BUCKET
  );
}

function getClient() {
  if (!isEnabled()) return null;
  if (!_client) {
    const { S3Client } = require("@aws-sdk/client-s3");
    _client = new S3Client({
      region: "auto",
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    });
  }
  return _client;
}

const MARKER = "r2:";

function isRemote(value) {
  return typeof value === "string" && value.startsWith(MARKER);
}

const DATA_URI_RE = /^data:([^;,]+);base64,(.+)$/s;

/**
 * Store an upload. Returns the value to write into the file_data column:
 * "r2:<key>" when uploaded to R2, or the original value when storage is
 * disabled / the value isn't a base64 data URI.
 */
async function storeFileData(prefix, dataUri) {
  if (!isEnabled() || typeof dataUri !== "string") return dataUri;
  const m = dataUri.match(DATA_URI_RE);
  if (!m) return dataUri; // not a data URI — leave untouched
  const [, mimeType, b64] = m;
  let body;
  try {
    body = Buffer.from(b64, "base64");
  } catch {
    return dataUri;
  }
  const safePrefix = String(prefix || "misc").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40) || "misc";
  const key = `${safePrefix}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}`;
  const { PutObjectCommand } = require("@aws-sdk/client-s3");
  await getClient().send(new PutObjectCommand({
    Bucket: process.env.R2_UPLOADS_BUCKET,
    Key: key,
    Body: body,
    ContentType: mimeType,
  }));
  return MARKER + key;
}

/**
 * Resolve a file_data column value back to a base64 data URI.
 * Pass-through for plain values (legacy base64 rows, or storage disabled).
 * Throws if an "r2:" marker can't be fetched — callers already have
 * try/catch + 500 paths for corrupt data.
 */
async function resolveFileData(value) {
  if (!isRemote(value)) return value;
  const key = value.slice(MARKER.length);
  const { GetObjectCommand } = require("@aws-sdk/client-s3");
  const resp = await getClient().send(new GetObjectCommand({
    Bucket: process.env.R2_UPLOADS_BUCKET,
    Key: key,
  }));
  const chunks = [];
  for await (const chunk of resp.Body) chunks.push(chunk);
  const buf = Buffer.concat(chunks);
  const mime = resp.ContentType || "application/octet-stream";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

/** Best-effort delete of the backing object when a row is removed. Never throws. */
async function deleteFileData(value) {
  if (!isRemote(value) || !isEnabled()) return;
  try {
    const { DeleteObjectCommand } = require("@aws-sdk/client-s3");
    await getClient().send(new DeleteObjectCommand({
      Bucket: process.env.R2_UPLOADS_BUCKET,
      Key: value.slice(MARKER.length),
    }));
  } catch (err) {
    console.warn("[storage] best-effort delete failed:", err.message);
  }
}

module.exports = { isEnabled, isRemote, storeFileData, resolveFileData, deleteFileData };
