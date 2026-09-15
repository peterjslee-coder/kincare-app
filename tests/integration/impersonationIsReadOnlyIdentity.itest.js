/**
 * An impersonation window cannot be turned into a permanent key. (v1.106.40)
 *
 * Pete, looking at Tina's My Account while impersonating her: "Is the ability to link her
 * Google account supposed to be here? Is this because I was impersonating on an iOS device?"
 *
 * The instinct was right and the answer was worse than the question. Impersonation is
 * deliberately expensive — "no impersonation without passkey. period." (v1.106.3) — a
 * passkey challenge, a short-lived token, an audit row on every start. The point of all that
 * is that the window is temporary and attributable.
 *
 * Nothing stopped an admin inside that window from writing to WHO SOMEONE IS. Under an
 * impersonation token `req.user.id` is the impersonated person, so "Link Apple ID" would
 * attach the ADMIN's Apple sign-in to her account forever, a passkey registration would put
 * the admin's biometric on it, 2FA setup would bind the admin's authenticator, and DELETE
 * /api/auth/me would delete her.
 *
 * Every test below runs the same request twice: once as the person herself, where it must
 * still work, and once under an impersonation token, where it must be refused. A guard that
 * only ever refuses is not a guard, it is an outage.
 */
const { startHarness, stopHarness } = require("./harness");
const jwt = require("jsonwebtoken");

jest.setTimeout(180000);

const ROUTERS = {
  "/api/auth": "../../src/routes/auth",
  "/api/passkeys": "../../src/routes/passkeys",
  "/api/2fa": "../../src/routes/twoFactor",
};

let h, tina, admin, impToken;

beforeAll(async () => {
  h = await startHarness({ routers: ROUTERS });
  tina = await h.createUser({ roles: ["caregiver"], firstName: "Tina" });
  admin = await h.createUser({ roles: ["family"], firstName: "Pete" });
  await h.db.prepare("UPDATE users SET is_admin = 1 WHERE id = ?").run(admin.user.id);

  // The exact token POST /api/admin/impersonate/:userId mints: the target's identity, plus
  // impersonatedBy. Built here rather than by calling that route, because that route requires
  // a real passkey assertion — and the thing under test is what the TOKEN permits.
  impToken = jwt.sign(
    { id: tina.user.id, email: tina.user.email, roles: ["caregiver"], role: "caregiver", impersonatedBy: admin.user.id },
    process.env.JWT_SECRET, { expiresIn: "1h" }
  );
});

afterAll(async () => { await stopHarness(h); });

const asTina = () => h.auth(tina.token);
const asImpersonator = () => h.auth(impToken);

// Every guarded route, with a request body good enough to get past validation so that a 403
// can only be the guard — not a 400 arriving first. (That is how a scope test in this repo
// passed vacuously once already: a different gate refused before the one being tested.)
const GUARDED = [
  { what: "register a passkey (options)", method: "post", path: "/api/passkeys/register/options", body: {} },
  { what: "register a passkey (verify)", method: "post", path: "/api/passkeys/register/verify", body: { id: "x", response: {} } },
  { what: "rename a passkey", method: "put", path: "/api/passkeys/some-id", body: { name: "Phone" } },
  { what: "delete a passkey", method: "delete", path: "/api/passkeys/some-id", body: {} },
  { what: "set up 2FA", method: "post", path: "/api/2fa/setup", body: {} },
  { what: "finish 2FA setup", method: "post", path: "/api/2fa/verify-setup", body: { token: "123456" } },
  { what: "disable 2FA", method: "post", path: "/api/2fa/disable", body: { password: "x" } },
  { what: "regenerate backup codes", method: "post", path: "/api/2fa/backup-codes", body: {} },
  { what: "revoke a trusted device", method: "delete", path: "/api/2fa/devices/some-id", body: {} },
  { what: "add a role", method: "post", path: "/api/auth/add-role", body: { role: "family" } },
  { what: "remove a role", method: "post", path: "/api/auth/remove-role", body: { role: "family" } },
  { what: "delete the account", method: "delete", path: "/api/auth/me", body: {} },
];

const send = (method, path, headers, body) =>
  h.request[method](path).set(headers).send(body);

// DELETE /api/auth/me is destructive on success, so it never runs against Tina. If its guard
// regressed while it sat in the shared list, the impersonator would delete her and every test
// after it would fail for the wrong reason — which is exactly what the first run of this file
// did. One throwaway account per destructive case keeps a regression pointed at itself.
const DESTRUCTIVE = (g) => g.path === "/api/auth/me" && g.method === "delete";

describe("an impersonator cannot write to who someone is", () => {
  test.each(GUARDED.filter((g) => !DESTRUCTIVE(g)))("refuses: $what", async ({ method, path, body }) => {
    const res = await send(method, path, asImpersonator(), body);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("IMPERSONATION_BLOCKED");
  });

  test("refuses: delete the account — and the account is still there afterwards", async () => {
    const victim = await h.createUser({ roles: ["caregiver"], firstName: "Victim" });
    const tok = jwt.sign(
      { id: victim.user.id, email: victim.user.email, roles: ["caregiver"], role: "caregiver", impersonatedBy: admin.user.id },
      process.env.JWT_SECRET, { expiresIn: "1h" }
    );
    const res = await h.request.delete("/api/auth/me").set(h.auth(tok)).send({});
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("IMPERSONATION_BLOCKED");
    const row = await h.db.prepare("SELECT email FROM users WHERE id = ?").get(victim.user.id);
    expect(row).toBeTruthy();
    expect(row.email).toBe(victim.user.email);
  });

  test("the refusal says what to do instead, without jargon", async () => {
    const res = await send("post", "/api/passkeys/register/options", asImpersonator(), {});
    expect(res.body.error).toMatch(/viewing this account as an admin/i);
    expect(res.body.error).toMatch(/admin panel/i);
  });

  test("every refusal is written to the audit log at warning", async () => {
    const before = await h.db.prepare(
      "SELECT COUNT(*)::int AS n FROM audit_log WHERE action = 'impersonation_blocked_write'"
    ).get();
    await send("post", "/api/2fa/setup", asImpersonator(), {});
    // writeAuditLog is deliberately not awaited by the guard — the refusal must not depend
    // on the log — so give the insert a moment.
    await new Promise((r) => setTimeout(r, 250));
    const row = await h.db.prepare(
      `SELECT user_id, severity, details FROM audit_log
        WHERE action = 'impersonation_blocked_write' ORDER BY created_at DESC LIMIT 1`
    ).get();
    const after = await h.db.prepare(
      "SELECT COUNT(*)::int AS n FROM audit_log WHERE action = 'impersonation_blocked_write'"
    ).get();
    expect(after.n).toBeGreaterThan(before.n);
    expect(row.severity).toBe("warning");
    expect(row.user_id).toBe(tina.user.id);
    // The admin's identity is the part that matters: the row must say WHO reached for it.
    const details = typeof row.details === "string" ? JSON.parse(row.details) : row.details;
    expect(details.impersonatedBy).toBe(admin.user.id);
  });
});

describe("...and the person herself is not locked out of her own account", () => {
  // The other half. Each of these must get past the guard — anything but 403
  // IMPERSONATION_BLOCKED. A 400 or a 404 from the handler is fine and expected here; the
  // assertion is about the guard, which runs first.
  // DELETE /api/auth/me is genuinely destructive, so it runs against its own throwaway
  // account. Leaving it in the shared list deleted Tina midway and every test after it
  // failed for the wrong reason.
  const NON_DESTRUCTIVE = GUARDED.filter((g) => g.path !== "/api/auth/me");

  test.each(NON_DESTRUCTIVE)("still reaches the handler for her: $what", async ({ method, path, body }) => {
    const res = await send(method, path, asTina(), body);
    expect(res.body.code).not.toBe("IMPERSONATION_BLOCKED");
    if (res.status === 403) expect(res.body.error).not.toMatch(/viewing this account as an admin/i);
  });

  test("a person really can still delete their own account", async () => {
    const doomed = await h.createUser({ roles: ["caregiver"], firstName: "Doomed" });
    const res = await h.request.delete("/api/auth/me").set(h.auth(doomed.token)).send({});
    expect(res.body.code).not.toBe("IMPERSONATION_BLOCKED");
    expect(res.status).toBe(200);
    const row = await h.db.prepare("SELECT email FROM users WHERE id = ?").get(doomed.user.id);
    // Anonymised in place rather than row-deleted — see DELETE /api/auth/me.
    expect(row === undefined || /@deleted\.inplace$/.test(row.email)).toBe(true);
  });

  test("she really can start a passkey registration — not merely 'not 403'", async () => {
    const res = await send("post", "/api/passkeys/register/options", asTina(), {});
    expect(res.status).toBe(200);
    expect(res.body.challenge || res.body.options?.challenge).toBeTruthy();
  });

  test("she really can start 2FA setup", async () => {
    const res = await send("post", "/api/2fa/setup", asTina(), {});
    expect(res.status).toBe(200);
    expect(res.body.secret || res.body.qrCode || res.body.otpauth_url).toBeTruthy();
  });
});

describe("reading is untouched — the whole point of impersonating", () => {
  test("the impersonator still sees her account as she sees it", async () => {
    const res = await h.request.get("/api/auth/me").set(asImpersonator());
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(tina.user.id);
  });

  test("and can still list her passkeys, which is diagnosis, not a write", async () => {
    const res = await h.request.get("/api/passkeys").set(asImpersonator());
    expect(res.status).toBe(200);
  });
});

describe("the Apple link flow, which was the worst of them", () => {
  // Not reachable end-to-end without a real Apple callback, so the DECISION was lifted out
  // of the route into linkTargetFromToken and is tested directly. The route calls it and
  // does nothing else with the token — see src/routes/oauth.js.
  const { linkTargetFromToken } = require("../../src/middleware/noImpersonation");
  const verify = (t) => jwt.verify(t, process.env.JWT_SECRET);

  test("her own token links to her", () => {
    expect(linkTargetFromToken(tina.token, verify)).toEqual({ ok: true, userId: tina.user.id });
  });

  test("an impersonation token links to NOBODY, and says who reached for it", () => {
    const r = linkTargetFromToken(impToken, verify);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("impersonation");
    expect(r.impersonatedBy).toBe(admin.user.id);
    // The id is carried for the audit row, and must never be treated as a link target.
    expect(r.userId).toBe(tina.user.id);
  });

  test("a garbage or expired token is 'invalid', not a link to undefined", () => {
    expect(linkTargetFromToken("not-a-jwt", verify)).toEqual({ ok: false, reason: "invalid" });
    const noId = jwt.sign({ email: "x@y.z" }, process.env.JWT_SECRET);
    expect(linkTargetFromToken(noId, verify)).toEqual({ ok: false, reason: "invalid" });
  });

  test("the route asks this helper and does not re-read the token itself", () => {
    const src = require("../helpers/source").code("src/routes/oauth.js");
    const branch = src.slice(src.indexOf("savedState.includes('|link|')"), src.indexOf("if (!id_token)"));
    expect(branch).toMatch(/linkTargetFromToken\(linkToken,/);
    // The old shape: decoding the link token inline and trusting decoded.id.
    expect(branch).not.toMatch(/linkUserId\s*=\s*decoded\.id/);
  });

  test("the client explains the refusal instead of saying 'Sign-in failed'", () => {
    const login = require("../helpers/source").code("public/js/components/LoginPage.js");
    expect(login).toMatch(/link_impersonation/);
    expect(login).toMatch(/Sign in as yourself to link an Apple ID/);
  });
});
