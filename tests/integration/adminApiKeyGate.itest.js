/**
 * v1.106.37 — a provisioned machine credential is not a hijacked session.
 *
 * The admin IP gate exists so a STOLEN SESSION COOKIE cannot be replayed from an unfamiliar
 * network. An admin API key is the opposite: a secret deliberately issued to a machine, held
 * in an env var, never in a browser. verifyCsrf already draws that distinction and exempts
 * key callers ("server-to-server, no cookie"); CSRF is the same class of control.
 *
 * Until now the gate did not know keys existed. scripts/collect-feedback.js sends one on
 * every call and could never get past it — the designed path for machine access was dead on
 * arrival, and Pete spent a day being told to verify addresses in a browser that could not
 * reach them.
 *
 * The scope is the whole point, so most of this file is about what the key still CANNOT do.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || "apikey-gate-secret";
process.env.ADMIN_API_KEY = "test-admin-key-do-not-use";

const { startHarness, stopHarness } = require("./harness");

jest.setTimeout(180000);

let h, db, admin;

const KEY = { "X-Admin-API-Key": process.env.ADMIN_API_KEY };

beforeAll(async () => {
  h = await startHarness({ routers: { "/api/admin": "../../src/routes/admin" } });
  db = h.db;
  admin = await h.createUser({ isAdmin: true, firstName: "Pete", lastName: "ITest" });
  // A trusted row for SOMEONE, so the bootstrap branch ("table is empty, trust everyone")
  // cannot be what makes these pass. Without this the whole file is vacuous.
  await db.prepare(`
    INSERT INTO trusted_admin_ips (user_id, ip_address, trust_key, verified_via, last_seen_at, expires_at)
    VALUES (?, '203.0.113.99', '203.0.113.99', 'test-seed', NOW(), NOW() + INTERVAL '90 days')
  `).run(admin.user.id);
});

afterAll(async () => { await stopHarness(h); });

describe("the seed that stops this file being vacuous", () => {
  test("the trusted table is NOT empty, so the bootstrap branch is out of play", async () => {
    const n = await db.prepare("SELECT COUNT(*)::int AS c FROM trusted_admin_ips").get();
    expect(n.c).toBeGreaterThan(0);
  });

  test("a cookie-authenticated admin from an unknown network is still refused", async () => {
    // The control. If this ever passes, the gate is off and every assertion below means
    // nothing.
    const res = await h.request.get("/api/admin/feedback/triage").set(h.auth(admin.token));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("IP_VERIFICATION_REQUIRED");
  });
});

describe("what the key may now do", () => {
  test("pull feedback triage from an unverified network", async () => {
    const res = await h.request.get("/api/admin/feedback/triage").set(KEY);
    expect(res.status).not.toBe(403);
    expect(res.body?.code).not.toBe("IP_VERIFICATION_REQUIRED");
  });

  test("and it is the KEY doing it, not the network", async () => {
    // Same request, same unverified network, no key → refused. That difference is the fix.
    const withKey = await h.request.get("/api/admin/feedback/triage").set(KEY);
    const without = await h.request.get("/api/admin/feedback/triage").set(h.auth(admin.token));
    expect(without.status).toBe(403);
    expect(withKey.status).not.toBe(403);
  });
});

describe("what the key still cannot do", () => {
  test("a wrong key is not a key", async () => {
    const res = await h.request.get("/api/admin/feedback/triage")
      .set({ "X-Admin-API-Key": "not-the-key" });
    expect(res.status).toBeGreaterThanOrEqual(401);
  });

  test("a sensitive admin path demands TOTP before anything else", async () => {
    const res = await h.request.get("/api/admin/overview").set(KEY);
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/TOTP/i);
  });

  test("...and even WITH a valid TOTP code, the network check still applies", async () => {
    // THE scope assertion, and the first version of it was vacuous: without a TOTP code,
    // authenticate refuses a non-safe path at 401 before the IP gate ever runs, so widening
    // the exemption to every admin path broke nothing and the test still passed. It was
    // measuring TOTP, not the scoping.
    //
    // With a valid code the request gets past authenticate, reaches the gate on an
    // unverified network, and must STILL be refused — because /api/admin/overview is not on
    // the safe list. That is the boundary this exemption is scoped by.
    const otplib = require("otplib");
    const secret = otplib.generateSecret();
    await db.prepare(
      "INSERT INTO user_2fa (id, user_id, totp_secret, is_enabled) VALUES (?, ?, ?, 1)"
    ).run(require("uuid").v4(), admin.user.id, secret);

    const res = await h.request.get("/api/admin/overview")
      .set({ ...KEY, "X-Admin-TOTP": otplib.generateSync({ secret }) });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("IP_VERIFICATION_REQUIRED");

    await db.prepare("DELETE FROM user_2fa WHERE user_id = ?").run(admin.user.id);
  });

  test("the exemption does not leak to cookie sessions", async () => {
    // A browser session on an unverified network must stay refused on the very same path
    // the key is allowed through. Otherwise this widened the gate for everyone.
    const res = await h.request.get("/api/admin/feedback/triage").set(h.auth(admin.token));
    expect(res.status).toBe(403);
  });

  test("no key and no session is still nothing", async () => {
    const res = await h.request.get("/api/admin/feedback/triage");
    expect(res.status).toBeGreaterThanOrEqual(401);
  });
});

describe("one list, not two", () => {
  test("the gate and the TOTP check read the SAME exported paths", () => {
    // Two copies of a security boundary is two places for it to drift, and the drift would
    // be silent: a path added to one and not the other authenticates, then is refused for
    // the wrong reason.
    const { API_KEY_SAFE_PATHS } = require("../../src/middleware/auth");
    expect(Array.isArray(API_KEY_SAFE_PATHS)).toBe(true);
    expect(API_KEY_SAFE_PATHS).toContain("/api/admin/feedback/triage");

    const fs = require("fs");
    const path = require("path");
    const gate = fs.readFileSync(path.join(__dirname, "../../src/routes/admin/index.js"), "utf8");
    expect(gate).toContain("API_KEY_SAFE_PATHS.some");
    // and does not hand-roll its own copy
    expect(gate).not.toMatch(/"\/api\/admin\/feedback\/triage"/);
  });
});
