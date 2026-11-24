// Unit tests for the direct-APNs helper (src/utils/apns.js).
// No network calls — verifies config gating and provider-token (JWT) correctness.
const crypto = require("crypto");

describe("apns utility", () => {
  const ORIGINAL_ENV = { ...process.env };
  let apns;

  const freshRequire = () => {
    jest.resetModules();
    apns = require("../src/utils/apns");
    apns._resetTokenCache();
  };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  test("isConfigured is false when APNS env vars are missing", () => {
    delete process.env.APNS_KEY;
    delete process.env.APNS_KEY_ID;
    delete process.env.APNS_TEAM_ID;
    freshRequire();
    expect(apns.isConfigured()).toBe(false);
  });

  test("provider token is a valid ES256 JWT signed by the key", () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
    process.env.APNS_KEY = privateKey.export({ type: "pkcs8", format: "pem" });
    process.env.APNS_KEY_ID = "TESTKEY123";
    process.env.APNS_TEAM_ID = "TESTTEAM12";
    freshRequire();

    expect(apns.isConfigured()).toBe(true);
    const jwt = apns._providerToken();
    const [h, p, s] = jwt.split(".");
    expect(s).toBeTruthy();

    const header = JSON.parse(Buffer.from(h, "base64url").toString());
    const payload = JSON.parse(Buffer.from(p, "base64url").toString());
    expect(header).toEqual({ alg: "ES256", kid: "TESTKEY123" });
    expect(payload.iss).toBe("TESTTEAM12");
    expect(typeof payload.iat).toBe("number");

    const valid = crypto.verify(
      "sha256",
      Buffer.from(`${h}.${p}`),
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      Buffer.from(s, "base64url")
    );
    expect(valid).toBe(true);
  });

  test("handles Railway-style single-line key with literal \\n sequences", () => {
    const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" });
    process.env.APNS_KEY = pem.replace(/\n/g, "\\n"); // as pasted into a single-line env field
    process.env.APNS_KEY_ID = "TESTKEY123";
    process.env.APNS_TEAM_ID = "TESTTEAM12";
    freshRequire();

    expect(() => apns._providerToken()).not.toThrow();
    expect(apns._providerToken().split(".")).toHaveLength(3);
  });

  test("provider token is cached between calls", () => {
    const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
    process.env.APNS_KEY = privateKey.export({ type: "pkcs8", format: "pem" });
    process.env.APNS_KEY_ID = "TESTKEY123";
    process.env.APNS_TEAM_ID = "TESTTEAM12";
    freshRequire();

    expect(apns._providerToken()).toBe(apns._providerToken());
  });
});
