/**
 * storage.js (v1.91.0) — env-gated R2 offload for upload blobs.
 * These tests pin the DISABLED-mode contract: with no R2 env vars set,
 * every function is a byte-for-byte pass-through, so behavior with existing
 * base64 rows (and on deployments without creds) cannot change.
 */
const storage = require("../src/utils/storage");

const DATA_URI = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";

describe("storage (R2 offload, disabled mode)", () => {
  const saved = {};
  const VARS = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_UPLOADS_BUCKET"];

  beforeAll(() => {
    for (const v of VARS) { saved[v] = process.env[v]; delete process.env[v]; }
  });
  afterAll(() => {
    for (const v of VARS) { if (saved[v] !== undefined) process.env[v] = saved[v]; }
  });

  test("isEnabled is false without R2 env vars", () => {
    expect(storage.isEnabled()).toBe(false);
  });

  test("isEnabled requires ALL four vars", () => {
    process.env.R2_ACCOUNT_ID = "acct";
    process.env.R2_ACCESS_KEY_ID = "key";
    process.env.R2_SECRET_ACCESS_KEY = "secret";
    expect(storage.isEnabled()).toBe(false); // bucket missing
    for (const v of VARS) delete process.env[v];
  });

  test("storeFileData passes data URIs through unchanged when disabled", async () => {
    await expect(storage.storeFileData("receipts", DATA_URI)).resolves.toBe(DATA_URI);
  });

  test("storeFileData passes non-data-URI values through unchanged", async () => {
    await expect(storage.storeFileData("receipts", "")).resolves.toBe("");
    await expect(storage.storeFileData("receipts", null)).resolves.toBe(null);
    await expect(storage.storeFileData("receipts", "plain text")).resolves.toBe("plain text");
  });

  test("resolveFileData passes plain values through unchanged", async () => {
    await expect(storage.resolveFileData(DATA_URI)).resolves.toBe(DATA_URI);
    await expect(storage.resolveFileData("")).resolves.toBe("");
    await expect(storage.resolveFileData(null)).resolves.toBe(null);
  });

  test("isRemote only matches r2: markers", () => {
    expect(storage.isRemote("r2:receipts/2026-07-11/abc")).toBe(true);
    expect(storage.isRemote(DATA_URI)).toBe(false);
    expect(storage.isRemote(null)).toBe(false);
    expect(storage.isRemote("")).toBe(false);
  });

  test("deleteFileData never throws when disabled", async () => {
    await expect(storage.deleteFileData("r2:receipts/x")).resolves.toBeUndefined();
    await expect(storage.deleteFileData(DATA_URI)).resolves.toBeUndefined();
  });
});
