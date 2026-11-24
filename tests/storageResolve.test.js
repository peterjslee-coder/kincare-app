// ─── A blob that cannot be read says WHY. (v1.106.43) ───
//
// Pete: "Pictures uploaded to visits are displaying. Shows an upload but just black box with
// an x." The family-facing half of that is a 404 instead of a 500 — covered end to end in
// tests/integration/visitPhotoRoundTrip.itest.js.
//
// This file is the operator-facing half, and it exists because the two failures look
// identical from outside and need completely different fixes:
//
//   not_configured  the row says R2 and this deployment has no R2 credentials. EVERY blob
//                   written while it was on is unreadable. Fix the environment.
//   missing_object  R2 is working and this one object is not in the bucket. Fix that row, or
//                   accept that the picture is gone.
//   read_failed     R2 is configured and the read broke — wrong bucket, a token without read
//                   permission, a network fault. Fix the credentials.
//
// Both return null and both end as a 404, so nothing downstream can tell them apart. The
// reason code is the only thing that can, which makes it the thing worth asserting.

const mockCaptured = [];
jest.mock("../src/utils/sentry", () => ({
  captureException: (err, ctx) => { mockCaptured.push({ message: err && err.message, ctx }); },
}));

const mockSends = [];
let mockBehaviour = null;
jest.mock("@aws-sdk/client-s3", () => ({
  S3Client: class { async send(cmd) { mockSends.push(cmd); return mockBehaviour(); } },
  GetObjectCommand: class { constructor(args) { Object.assign(this, args); } },
  PutObjectCommand: class { constructor(args) { Object.assign(this, args); } },
  DeleteObjectCommand: class { constructor(args) { Object.assign(this, args); } },
}));

const R2_VARS = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_UPLOADS_BUCKET"];

const withR2 = (on) => {
  for (const v of R2_VARS) {
    if (on) process.env[v] = "test-value";
    else delete process.env[v];
  }
};

let storage;
beforeEach(() => {
  mockCaptured.length = 0;
  mockSends.length = 0;
  mockBehaviour = null;
  jest.resetModules();
  // Re-required each time: the S3 client is memoised inside the module, and a cached one
  // built under different env vars is exactly the kind of state that makes a test lie.
  storage = require("../src/utils/storage");
});
afterEach(() => withR2(false));

describe("a plain value is not touched", () => {
  test("a base64 data URI comes straight back", async () => {
    const uri = "data:image/png;base64,AAAA";
    expect(await storage.resolveFileData(uri)).toBe(uri);
    expect(mockSends).toHaveLength(0);
  });

  test("null and undefined pass through without reporting anything", async () => {
    expect(await storage.resolveFileData(null)).toBeNull();
    expect(await storage.resolveFileData(undefined)).toBeUndefined();
    expect(mockCaptured).toHaveLength(0);
  });
});

describe("the row says R2 and this deployment has none", () => {
  beforeEach(() => withR2(false));

  test("it returns null instead of crashing on a null client", async () => {
    // The original shape: getClient() returns null when R2 is unconfigured, so this line was
    // `null.send(...)` — a TypeError from a line that reads like a network call, surfacing as
    // a 500 and a black box on the family's phone.
    await expect(storage.resolveFileData("r2:note-photo/2026-09-15/abc")).resolves.toBeNull();
  });

  test("and it says WHY — this one is a configuration fault, not a lost picture", async () => {
    await storage.resolveFileData("r2:note-photo/2026-09-15/abc");
    expect(mockCaptured).toHaveLength(1);
    expect(mockCaptured[0].ctx.reason).toBe("not_configured");
    expect(mockCaptured[0].ctx.key).toBe("note-photo/2026-09-15/abc");
  });

  test("it never reaches the network to find that out", async () => {
    await storage.resolveFileData("r2:x/y");
    expect(mockSends).toHaveLength(0);
  });
});

describe("R2 is configured and the read fails", () => {
  beforeEach(() => withR2(true));

  test("a missing object is reported as missing_object", async () => {
    const err = new Error("The specified key does not exist.");
    err.name = "NoSuchKey";
    mockBehaviour = () => { throw err; };
    expect(await storage.resolveFileData("r2:family-visit/2026-09-15/gone")).toBeNull();
    expect(mockCaptured[0].ctx.reason).toBe("missing_object");
  });

  test("a NoSuchKey reported via .Code is recognised too", async () => {
    // The SDK reports this both ways depending on version and error shape; keying on only
    // one of them would file a genuine missing object as a credentials problem.
    const err = new Error("nope");
    err.Code = "NoSuchKey";
    mockBehaviour = () => { throw err; };
    await storage.resolveFileData("r2:family-visit/2026-09-15/gone");
    expect(mockCaptured[0].ctx.reason).toBe("missing_object");
  });

  test("anything else is read_failed — the credentials or the bucket", async () => {
    mockBehaviour = () => { throw new Error("Access Denied"); };
    expect(await storage.resolveFileData("r2:family-visit/2026-09-15/x")).toBeNull();
    expect(mockCaptured[0].ctx.reason).toBe("read_failed");
    expect(mockCaptured[0].message).toBe("Access Denied");
  });

  test("a successful read returns a data URI with the stored type", async () => {
    mockBehaviour = () => ({
      ContentType: "image/jpeg",
      Body: (async function* () { yield Buffer.from([0xff, 0xd8, 0xff]); })(),
    });
    const out = await storage.resolveFileData("r2:family-visit/2026-09-15/ok");
    expect(out).toBe(`data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff]).toString("base64")}`);
    expect(mockCaptured).toHaveLength(0);
  });

  test("it asks for the key the marker names, in the configured bucket", async () => {
    mockBehaviour = () => ({ ContentType: "image/png", Body: (async function* () { yield Buffer.from([1]); })() });
    await storage.resolveFileData("r2:note-photo/2026-09-15/abc");
    expect(mockSends).toHaveLength(1);
    expect(mockSends[0].Key).toBe("note-photo/2026-09-15/abc");
    expect(mockSends[0].Bucket).toBe("test-value");
  });
});

describe("storageMode, which is what /api/health reports", () => {
  test("'database' with no R2 configured", () => {
    withR2(false);
    jest.resetModules();
    expect(require("../src/utils/storage").storageMode()).toBe("database");
  });

  test("'r2' once it is", () => {
    withR2(true);
    jest.resetModules();
    expect(require("../src/utils/storage").storageMode()).toBe("r2");
  });

  test("a partial configuration is 'database', not a half-on state", () => {
    // Three of four set is not R2 — and it is the shape a half-finished Railway edit leaves
    // behind, so it must not read as configured.
    withR2(true);
    delete process.env.R2_SECRET_ACCESS_KEY;
    jest.resetModules();
    expect(require("../src/utils/storage").storageMode()).toBe("database");
  });

  test("it reports a label and never a value", () => {
    withR2(true);
    jest.resetModules();
    const mode = require("../src/utils/storage").storageMode();
    expect(["r2", "database"]).toContain(mode);
    expect(mode).not.toContain("test-value");
  });
});
