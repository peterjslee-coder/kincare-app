// v1.105.3 — regression tests for the deployment-shape derivation.
//
// The bug these exist to prevent: NODE_ENV is not set on Railway, so
// `process.env.NODE_ENV === "production"` was false IN PRODUCTION. Session
// cookies shipped without Secure and the CORS allowlist was the localhost one,
// for months, with nothing failing. The whole point of utils/env.js is that the
// production shape is derived from a variable that IS set (APP_URL), so these
// tests pin the behaviour that matters rather than the mechanism.

const { computeEnv } = require("../src/utils/env");

describe("computeEnv — cookie Secure flag", () => {
  test("production APP_URL over https ⇒ cookies Secure, even with NODE_ENV unset", () => {
    const e = computeEnv({ APP_URL: "https://yourinplace.com" });
    expect(e.cookiesSecure).toBe(true);
  });

  test("staging over https ⇒ cookies Secure too", () => {
    const e = computeEnv({ APP_URL: "https://inplace-staging-production.up.railway.app" });
    expect(e.cookiesSecure).toBe(true);
  });

  test("local http dev ⇒ cookies NOT Secure (or the browser would drop them)", () => {
    const e = computeEnv({ APP_URL: "http://localhost:3001" });
    expect(e.cookiesSecure).toBe(false);
  });

  test("APP_URL missing entirely ⇒ still Secure (fails safe, does not downgrade)", () => {
    expect(computeEnv({}).cookiesSecure).toBe(true);
  });

  test("malformed APP_URL ⇒ still Secure (fails safe)", () => {
    expect(computeEnv({ APP_URL: "not a url" }).cookiesSecure).toBe(true);
  });

  test("COOKIE_SECURE override wins in both directions", () => {
    expect(computeEnv({ APP_URL: "http://localhost:3001", COOKIE_SECURE: "1" }).cookiesSecure).toBe(true);
    expect(computeEnv({ APP_URL: "https://yourinplace.com", COOKIE_SECURE: "false" }).cookiesSecure).toBe(false);
  });

  test("legacy NODE_ENV=production is still honoured", () => {
    expect(computeEnv({ NODE_ENV: "production" }).cookiesSecure).toBe(true);
  });
});

describe("computeEnv — CORS allowlist", () => {
  test("prod allows the apex and www, and NOT localhost", () => {
    const { allowedOrigins } = computeEnv({ APP_URL: "https://yourinplace.com" });
    expect(allowedOrigins).toContain("https://yourinplace.com");
    expect(allowedOrigins).toContain("https://www.yourinplace.com");
    expect(allowedOrigins.some((o) => o.includes("localhost"))).toBe(false);
    expect(allowedOrigins.some((o) => o.includes("127.0.0.1"))).toBe(false);
  });

  test("staging allows its own origin and does not invent a www.* for a railway subdomain", () => {
    const { allowedOrigins } = computeEnv({ APP_URL: "https://inplace-staging-production.up.railway.app" });
    expect(allowedOrigins).toContain("https://inplace-staging-production.up.railway.app");
    expect(allowedOrigins.some((o) => o.startsWith("https://www."))).toBe(false);
  });

  test("http dev adds the localhost origins", () => {
    const { allowedOrigins } = computeEnv({ APP_URL: "http://localhost:3001" });
    expect(allowedOrigins).toContain("http://localhost:3001");
    expect(allowedOrigins).toContain("http://127.0.0.1:3001");
  });

  test("a bare http://localhost is never allowed on an https deployment", () => {
    // Anything in this list can send the user's cookies cross-origin. A plain
    // localhost entry on prod would let anything running on a user's machine make
    // authenticated requests. The Capacitor bundled-asset migration must add
    // capacitor://localhost specifically, not this.
    const { allowedOrigins } = computeEnv({ APP_URL: "https://yourinplace.com" });
    expect(allowedOrigins).not.toContain("http://localhost");
  });

  test("trailing slash on APP_URL does not produce a mismatched origin", () => {
    const { allowedOrigins } = computeEnv({ APP_URL: "https://yourinplace.com/" });
    expect(allowedOrigins).toContain("https://yourinplace.com");
    expect(allowedOrigins.some((o) => o.endsWith("/"))).toBe(false);
  });
});

describe("computeEnv — Sentry environment", () => {
  test("prod reports production, not development", () => {
    expect(computeEnv({ APP_URL: "https://yourinplace.com" }).environment).toBe("production");
  });

  test("staging is distinguished from production", () => {
    expect(
      computeEnv({ APP_URL: "https://inplace-staging-production.up.railway.app" }).environment
    ).toBe("staging");
  });

  test("local is development", () => {
    expect(computeEnv({ APP_URL: "http://localhost:3001" }).environment).toBe("development");
  });

  test("SENTRY_ENVIRONMENT overrides", () => {
    expect(
      computeEnv({ APP_URL: "https://yourinplace.com", SENTRY_ENVIRONMENT: "canary" }).environment
    ).toBe("canary");
  });
});
