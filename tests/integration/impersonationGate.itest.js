/**
 * v1.106.20 — "no impersonation without passkey. period." (Pete, this session)
 *
 * Impersonation mints a two-hour token for another person's account: every note, every photo,
 * messaging as them. Until v1.106.3 the challenge endpoint handed back `bypass: true` when the
 * admin had no passkey on file, and the verify step then skipped WebAuthn entirely — so two
 * POSTs behind an admin session was the whole platform.
 *
 * That bypass is gone, and this is the coverage it never had. Only the WebAuthn crypto is
 * mocked — that is the library's job to get right. Every gate in OUR code runs for real:
 * who may ask, who may be impersonated, whether the challenge is bound to its target, whether
 * the credential belongs to the admin presenting it, and what the resulting token carries.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || "impersonation-gate-secret";

let mockVerified = true;
let mockNewCounter = 1;
jest.mock("@simplewebauthn/server", () => ({
  generateAuthenticationOptions: jest.fn(async (opts) => ({
    challenge: "test-challenge-value",
    allowCredentials: opts.allowCredentials || [],
    rpId: opts.rpID,
  })),
  verifyAuthenticationResponse: jest.fn(async () => ({
    verified: mockVerified,
    authenticationInfo: { newCounter: mockNewCounter },
  })),
  generateRegistrationOptions: jest.fn(),
  verifyRegistrationResponse: jest.fn(),
}));

const { startHarness, stopHarness } = require("./harness");
const { v4: uuid } = require("uuid");
const jwt = require("jsonwebtoken");

jest.setTimeout(180000);

let h, db, admin, victim;

/**
 * The admin router has a SECOND gate in front of everything: an IP-trust check that refuses
 * unrecognised networks with IP_VERIFICATION_REQUIRED. It bootstraps — the very first admin
 * request auto-trusts, when trusted_admin_ips is empty — and after that every other admin has
 * to be registered. Test admins therefore need trusting explicitly, or every assertion below
 * would be measuring the IP gate rather than the passkey gate.
 */
async function trustThisNetwork(as) {
  const probe = await h.request.get("/api/admin/overview").set(h.auth(as.token));
  const ip = (probe.body && probe.body.ip) || "::ffff:127.0.0.1";
  const { registerTrustedIp } = require("../../src/utils/trustedIps");
  await registerTrustedIp(as.user.id, ip, { verifiedVia: "itest" });
}

/** Give a user a passkey row so the challenge endpoint has something to offer. */
async function givePasskey(userId, credentialId) {
  await db.prepare(`
    INSERT INTO user_passkeys (id, user_id, credential_id, public_key, counter, created_at)
    VALUES (?, ?, ?, ?, 0, NOW())
  `).run(uuid(), userId, credentialId, Buffer.from("fake-public-key").toString("base64url"));
}

const challengeFor = (as, targetId) =>
  h.request.post(`/api/admin/impersonate/${targetId}/challenge`).set(h.auth(as.token)).send({});

const impersonate = (as, targetId, body) =>
  h.request.post(`/api/admin/impersonate/${targetId}`).set(h.auth(as.token)).send(body);

beforeAll(async () => {
  h = await startHarness({ routers: { "/api/admin": "../../src/routes/admin" } });
  db = h.db;
  admin = await h.createUser({ firstName: "Ad", lastName: "Min", isAdmin: true });
  await db.prepare("UPDATE users SET is_admin = 1 WHERE id = ?").run(admin.user.id);
  victim = await h.createUser({ firstName: "Reg", lastName: "Ular" });
  await trustThisNetwork(admin);
});
afterAll(async () => { await stopHarness(h); });

beforeEach(() => { mockVerified = true; mockNewCounter = 1; });

describe("the bypass is gone", () => {
  test("an admin with NO passkey cannot even get a challenge", async () => {
    const naked = await h.createUser({ firstName: "No", lastName: "Key", isAdmin: true });
    await db.prepare("UPDATE users SET is_admin = 1 WHERE id = ?").run(naked.user.id);
    await trustThisNetwork(naked);

    const res = await challengeFor(naked, victim.user.id);
    expect(res.status).toBe(403);
    expect(res.body.needsPasskey).toBe(true);
    // …and it says how to fix it rather than just refusing.
    expect(res.body.error).toMatch(/Account → Security/);
  });

  test("…and cannot reach a token by skipping straight to the verify step", async () => {
    const naked = await h.createUser({ firstName: "No", lastName: "Key2", isAdmin: true });
    await db.prepare("UPDATE users SET is_admin = 1 WHERE id = ?").run(naked.user.id);
    await trustThisNetwork(naked);

    const res = await impersonate(naked, victim.user.id, { id: "anything" });
    expect(res.status).toBe(400);
    expect(res.body.token).toBeUndefined();
  });

  test("no challenge key at all is refused", async () => {
    const res = await impersonate(admin, victim.user.id, {});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Passkey verification required/);
  });

  test("an unknown or expired challenge key is refused", async () => {
    const res = await impersonate(admin, victim.user.id, { _challengeKey: "never-minted" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/expired/i);
  });
});

describe("the challenge is bound to its target", () => {
  test("a challenge minted for one person cannot be spent on another", async () => {
    // Otherwise an admin passkeys once against a harmless account and reuses it on anyone.
    await givePasskey(admin.user.id, "cred-bind");
    const other = await h.createUser({ firstName: "Some", lastName: "Oneelse" });

    const ch = await challengeFor(admin, victim.user.id);
    expect(ch.status).toBe(200);
    expect(ch.body._challengeKey).toBeTruthy();

    const res = await impersonate(other ? admin : admin, other.user.id, {
      _challengeKey: ch.body._challengeKey, id: "cred-bind",
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/mismatch/i);
    expect(res.body.token).toBeUndefined();
  });
});

describe("the credential must be the caller's own", () => {
  test("presenting another admin's credential is refused", async () => {
    const other = await h.createUser({ firstName: "Other", lastName: "Admin", isAdmin: true });
    await db.prepare("UPDATE users SET is_admin = 1 WHERE id = ?").run(other.user.id);
    await givePasskey(other.user.id, "cred-belongs-to-other");
    await givePasskey(admin.user.id, "cred-mine");

    const ch = await challengeFor(admin, victim.user.id);
    const res = await impersonate(admin, victim.user.id, {
      _challengeKey: ch.body._challengeKey, id: "cred-belongs-to-other",
    });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/not recognized/i);
  });

  test("a failed WebAuthn verification is refused", async () => {
    await givePasskey(admin.user.id, "cred-verify-fail");
    const ch = await challengeFor(admin, victim.user.id);
    mockVerified = false;
    const res = await impersonate(admin, victim.user.id, {
      _challengeKey: ch.body._challengeKey, id: "cred-verify-fail",
    });
    expect(res.status).toBe(401);
    expect(res.body.token).toBeUndefined();
  });
});

describe("who may be impersonated", () => {
  test("never another admin — at the challenge step", async () => {
    const other = await h.createUser({ firstName: "Second", lastName: "Admin", isAdmin: true });
    await db.prepare("UPDATE users SET is_admin = 1 WHERE id = ?").run(other.user.id);
    const res = await challengeFor(admin, other.user.id);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/another admin/i);
  });

  test("nor at the verify step, even with a valid challenge in hand", async () => {
    // The two checks are independent on purpose: a user promoted to admin between the two
    // POSTs must not slip through on a challenge minted while they were not one.
    await givePasskey(admin.user.id, "cred-promote");
    const target = await h.createUser({ firstName: "Soon", lastName: "Admin" });
    const ch = await challengeFor(admin, target.user.id);
    expect(ch.status).toBe(200);

    await db.prepare("UPDATE users SET is_admin = 1 WHERE id = ?").run(target.user.id);

    const res = await impersonate(admin, target.user.id, {
      _challengeKey: ch.body._challengeKey, id: "cred-promote",
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/another admin/i);
    expect(res.body.token).toBeUndefined();
  });

  test("nor a deactivated account", async () => {
    const gone = await h.createUser({ firstName: "De", lastName: "Activated" });
    await db.prepare("UPDATE users SET is_active = 0 WHERE id = ?").run(gone.user.id);
    const res = await challengeFor(admin, gone.user.id);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/deactivated/i);
  });
});

describe("the token it finally mints", () => {
  let token;

  beforeAll(async () => {
    await givePasskey(admin.user.id, "cred-happy");
    const ch = await challengeFor(admin, victim.user.id);
    const res = await impersonate(admin, victim.user.id, {
      _challengeKey: ch.body._challengeKey, id: "cred-happy",
    });
    expect(res.status).toBe(200);
    token = res.body.token;
  });

  test("is issued, and is for the target", () => {
    expect(token).toBeTruthy();
    const claims = jwt.verify(token, process.env.JWT_SECRET);
    expect(claims.id).toBe(victim.user.id);
    expect(claims.email).toBe(victim.user.email);
  });

  test("records WHO is wearing it — an impersonated action is not anonymous", () => {
    const claims = jwt.verify(token, process.env.JWT_SECRET);
    expect(claims.impersonatedBy).toBe(admin.user.id);
  });

  test("carries no admin rights — impersonation is a demotion, never a promotion", () => {
    const claims = jwt.verify(token, process.env.JWT_SECRET);
    expect(claims.is_admin).toBeUndefined();
    expect(claims.isAdmin).toBeUndefined();
    expect(claims.roles).not.toContain("admin");
  });

  test("expires in hours, not indefinitely", () => {
    const claims = jwt.verify(token, process.env.JWT_SECRET);
    const hours = (claims.exp - claims.iat) / 3600;
    expect(hours).toBeGreaterThan(0);
    expect(hours).toBeLessThanOrEqual(4);
  });

  test("a challenge is single-use — the same key cannot mint a second token", async () => {
    const ch = await challengeFor(admin, victim.user.id);
    const first = await impersonate(admin, victim.user.id, {
      _challengeKey: ch.body._challengeKey, id: "cred-happy",
    });
    expect(first.status).toBe(200);
    const second = await impersonate(admin, victim.user.id, {
      _challengeKey: ch.body._challengeKey, id: "cred-happy",
    });
    expect(second.status).toBe(400);
    expect(second.body.token).toBeUndefined();
  });
});

describe("a non-admin cannot get near any of it", () => {
  // The first version of these two asserted only `[401,403].toContain(status)`, and passed
  // whether or not requireAdmin was mounted — because the IP-trust gate refuses an untrusted
  // caller with 403 first. Removing requireAdmin entirely did not fail them. So: trust the
  // network for this user, which removes the IP gate as an explanation, and assert the refusal
  // is NOT the IP one.
  beforeAll(async () => { await trustThisNetwork(victim); });

  test("the challenge endpoint refuses them, as a non-admin and not as a stranger", async () => {
    const res = await challengeFor(victim, admin.user.id);
    expect([401, 403]).toContain(res.status);
    expect(res.body.code).not.toBe("IP_VERIFICATION_REQUIRED");
    expect(res.body._challengeKey).toBeUndefined();
  });

  test("so does the verify endpoint", async () => {
    const res = await impersonate(victim, admin.user.id, { _challengeKey: "x", id: "y" });
    expect([401, 403]).toContain(res.status);
    expect(res.body.code).not.toBe("IP_VERIFICATION_REQUIRED");
    expect(res.body.token).toBeUndefined();
  });

  test("and the admin router really is what stops them", async () => {
    // Pins the middleware itself: authenticate + checkAdmin + requireAdmin, in that order.
    const { code } = require("../helpers/source");
    expect(code("src/routes/admin/index.js")).toMatch(
      /router\.use\(authenticate, checkAdmin, requireAdmin\);/
    );
  });
});
