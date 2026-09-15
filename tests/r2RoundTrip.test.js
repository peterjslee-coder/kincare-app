/**
 * The R2 round trip, with a fake bucket. (v1.106.8)
 *
 * Staging has no R2 credentials, so the marker path cannot be exercised there — and the
 * failure mode if it is wrong is the worst kind: images 404 one at a time, silently, only for
 * uploads made after the deploy. This proves OUR half of it (store -> marker -> resolve ->
 * serve) against an in-memory bucket. Cloudflare's half is not ours to test.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || "r2-roundtrip-test-secret";

const REAL_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

// An in-memory stand-in for R2, wired in the same shape @aws-sdk/client-s3 is used.
const mockBucket = new Map();
jest.mock("@aws-sdk/client-s3", () => ({
  S3Client: class { async send(cmd) { return cmd.__run(); } },
  PutObjectCommand: class {
    constructor(i) { this.i = i; }
    __run() { mockBucket.set(this.i.Key, { body: this.i.Body, type: this.i.ContentType }); return {}; }
  },
  GetObjectCommand: class {
    constructor(i) { this.i = i; }
    __run() {
      const o = mockBucket.get(this.i.Key);
      if (!o) { const e = new Error("NoSuchKey"); e.name = "NoSuchKey"; throw e; }
      return { ContentType: o.type, Body: (async function* () { yield o.body; })() };
    }
  },
  DeleteObjectCommand: class {
    constructor(i) { this.i = i; }
    __run() { mockBucket.delete(this.i.Key); return {}; }
  },
}));

describe("storing by reference and reading it back", () => {
  let storage;
  beforeAll(() => {
    process.env.R2_ACCOUNT_ID = "acct";
    process.env.R2_ACCESS_KEY_ID = "key";
    process.env.R2_SECRET_ACCESS_KEY = "secret";
    process.env.R2_UPLOADS_BUCKET = "inplace-uploads-test";
    jest.resetModules();
    storage = require("../src/utils/storage");
  });
  afterAll(() => {
    for (const k of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_UPLOADS_BUCKET"]) delete process.env[k];
  });

  test("a data URI becomes a marker, not the bytes", async () => {
    const stored = await storage.storeFileData("visit-photo", REAL_PNG);
    expect(stored.startsWith("r2:")).toBe(true);
    expect(stored.length).toBeLessThan(120);
    expect(stored).toMatch(/^r2:visit-photo\/\d{4}-\d{2}-\d{2}\//);
  });

  test("resolving the marker gives back a byte-identical data URI", async () => {
    const stored = await storage.storeFileData("note-photo", REAL_PNG);
    expect(await storage.resolveFileData(stored)).toBe(REAL_PNG);
  });

  test("a legacy base64 row passes straight through, unchanged", async () => {
    expect(await storage.resolveFileData(REAL_PNG)).toBe(REAL_PNG);
    expect(await storage.resolveFileData(null)).toBeNull();
  });

  test("sendStoredFile serves a MARKER as a real image — the whole point", async () => {
    jest.resetModules();
    const { sendStoredFile } = require("../src/utils/serveMedia");
    const marker = await storage.storeFileData("profile-photo", REAL_PNG);
    const headers = {};
    let sent = null, status = 200;
    const res = {
      set: (k, v) => { headers[k] = v; },
      status(c) { status = c; return this; },
      end() { sent = null; return this; },
      send(b) { sent = b; return this; },
    };
    await sendStoredFile(res, marker);
    expect(status).toBe(200);
    expect(headers["Content-Type"]).toBe("image/png");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(Buffer.isBuffer(sent)).toBe(true);
    expect(sent.toString("base64")).toBe(REAL_PNG.split(",")[1]);
  });

  test("and still serves a legacy base64 row, so a half-migrated table is fine", async () => {
    jest.resetModules();
    const { sendStoredFile } = require("../src/utils/serveMedia");
    let sent = null, status = 200;
    const res = { set: () => {}, status(c) { status = c; return this; }, end() { return this; }, send(b) { sent = b; return this; } };
    await sendStoredFile(res, REAL_PNG);
    expect(status).toBe(200);
    expect(Buffer.isBuffer(sent)).toBe(true);
  });

  test("a marker whose object is gone is a 404, not a crash", async () => {
    // v1.106.43 — this test asserted a THROW while its own name said 404, and the comment
    // under it argued the throw was right: "every caller wraps this in try/catch with a 500,
    // which is the honest answer... Silently 404ing would make a storage outage look like a
    // deleted photo."
    //
    // The concern is real and the conclusion was wrong, and Pete found out how: "Pictures
    // uploaded to visits are displaying. Shows an upload but just black box with an x." The
    // 500 reached a family looking at their mother's care record as a black screen with a
    // close button. It did not tell them anything true, and it did not tell anyone who could
    // fix it anything either — a 500 from a photo route is noise.
    //
    // The word the old comment needed was SILENTLY. A 404 with nothing behind it would
    // indeed hide an outage. A 404 with a reasoned Sentry event behind it — not_configured,
    // missing_object or read_failed, see tests/storageResolve.test.js — tells the family the
    // truth about their picture and the operator the truth about the bucket, which is a
    // better answer to the old comment's worry than the 500 was.
    jest.resetModules();
    const { sendStoredFile } = require("../src/utils/serveMedia");
    let status = 200;
    const res = { set: () => {}, status(c) { status = c; return this; }, end() { return this; }, send() { return this; } };
    await expect(sendStoredFile(res, "r2:visit-photo/2026-01-01/missing")).resolves.toBeDefined();
    expect(status).toBe(404);
  });

  test("deleting a row's object is best-effort and never throws", async () => {
    const marker = await storage.storeFileData("receipt", REAL_PNG);
    await expect(storage.deleteFileData(marker)).resolves.toBeUndefined();
    await expect(storage.deleteFileData("r2:nope/nothing")).resolves.toBeUndefined();
    await expect(storage.deleteFileData(REAL_PNG)).resolves.toBeUndefined();
  });

  test("with R2 switched off, everything is a pass-through — byte-for-byte as before", async () => {
    jest.resetModules();
    const saved = process.env.R2_UPLOADS_BUCKET;
    delete process.env.R2_UPLOADS_BUCKET;
    const off = require("../src/utils/storage");
    expect(off.isEnabled()).toBe(false);
    expect(await off.storeFileData("visit-photo", REAL_PNG)).toBe(REAL_PNG);
    expect(await off.resolveFileData(REAL_PNG)).toBe(REAL_PNG);
    process.env.R2_UPLOADS_BUCKET = saved;
  });
});
