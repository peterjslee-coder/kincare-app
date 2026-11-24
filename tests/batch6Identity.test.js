/**
 * Batch 6 — one identity read, however many components ask (v1.106.13).
 *
 * Sixteen call sites each fetched GET /api/auth/me independently. Measured on production, a
 * logged-in boot produced bursts of up to four in a single second as Dashboard, Messages, the
 * verification banner and MyAccount mounted and each asked who the user is. (Not nine, as the
 * batch plan claimed — worth writing down, because the fix is sized to the real number.)
 *
 * The interesting part is not the cache, it is the KEY. Identity is keyed on the effective
 * token, so impersonation cannot be served a stale answer by construction — there is no
 * invalidation to remember, and therefore none to forget.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || "batch6-identity-secret";

const { raw, code } = require("./helpers/source");

const utils = code("public/js/utils.js");
const app = code("public/js/app.js");

describe("E1 — the cache cannot outlive an identity change", () => {
  // Source-matching this one is not good enough. The first version of this test asserted the
  // key function merely MENTIONS IMPERSONATION_TOKEN, and a revert that broke the branch while
  // leaving the mention passed it. Impersonation safety is the whole reason the cache is keyed
  // rather than timed, so the test runs the real function instead of reading it.
  const keyFn = (impersonation, auth, role) => {
    const i = utils.indexOf("const _meCacheKey");
    expect(i).toBeGreaterThan(-1);
    const src = utils.slice(i, utils.indexOf(";", utils.indexOf("`", i + 60)) + 1);
    // eslint-disable-next-line no-new-func
    return new Function(
      "IMPERSONATION_TOKEN", "AUTH_TOKEN", "ACTIVE_ROLE",
      `${src} return _meCacheKey();`
    )(impersonation, auth, role);
  };

  test("an impersonating admin gets a different key from their own identity", () => {
    const own = keyFn(null, "admin-token", null);
    const imp = keyFn("impersonation-token", "admin-token", null);
    expect(imp).not.toBe(own);
    // …and the admin's own token must not leak into the impersonated key, or ending
    // impersonation would land back on the same key and serve the impersonated answer.
    expect(imp).not.toContain("admin-token");
  });

  test("two different impersonation targets are two different keys", () => {
    expect(keyFn("tok-a", "admin-token", null)).not.toBe(keyFn("tok-b", "admin-token", null));
  });

  test("switching active role is a different key — the server answers differently", () => {
    expect(keyFn(null, "t", "caregiver")).not.toBe(keyFn(null, "t", "family"));
  });

  test("but active role does NOT split the key while impersonating", () => {
    // apiFetch does not send X-Active-Role during impersonation, so the answer is the same.
    expect(keyFn("imp", "t", "caregiver")).toBe(keyFn("imp", "t", "family"));
  });

  test("logging out is a different key from being logged in", () => {
    expect(keyFn(null, null, null)).not.toBe(keyFn(null, "t", null));
  });

  test("an answer is never cached under a key that changed while it was in flight", () => {
    const i = utils.indexOf("const fetchMe");
    const fn = utils.slice(i, i + 1600);
    expect(fn).toMatch(/if \(_meCacheKey\(\) === key\) _meCache = \{/);
  });

  test("concurrent callers join one request instead of each making their own", () => {
    const fn = utils.slice(utils.indexOf("const fetchMe"), utils.indexOf("const fetchMe") + 1600);
    expect(fn).toMatch(/if \(_mePromise\) return _mePromise;/);
  });

  test("the TTL is short — this collapses a burst, it does not hold identity", () => {
    const m = utils.match(/const ME_TTL_MS = (\d+);/);
    expect(m).toBeTruthy();
    expect(Number(m[1])).toBeGreaterThan(0);
    expect(Number(m[1])).toBeLessThanOrEqual(15000);
  });

  test("any write to the user's own record drops it, from inside apiFetch", () => {
    // At the call sites this would be eight things to remember. Here it is one.
    expect(utils).toMatch(
      /options\.method !== 'GET' && url\.startsWith\('\/api\/auth\/me'\)\) invalidateMe\(\)/
    );
    const i = utils.indexOf("const apiFetch = window.apiFetch");
    const j = utils.indexOf("options.method !== 'GET' && url.startsWith('/api/auth/me')");
    expect(j).toBeGreaterThan(i);   // inside apiFetch, not beside it
  });

  test("fetchMe is defined after apiFetch, which it calls", () => {
    // Also keeps it out of the reportClientError..apiFetch window that apiTimeout.test.js
    // asserts is free of apiFetch calls.
    expect(utils.indexOf("const fetchMe")).toBeGreaterThan(utils.indexOf("const apiFetch = window.apiFetch"));
  });
});

describe("E2 — the reads that must stay fresh, did", () => {
  test("a re-read whose whole purpose is to observe a server-side change forces", () => {
    // account_approved arriving over the socket, and email verification. Serving either from
    // a cache means the UI never updates — the exact opposite of what the call is for.
    for (const marker of [
      "account_approved: true",
      "emailVerified: !!meData.user.email_verified",
    ]) {
      const at = app.indexOf(marker);
      expect(at).toBeGreaterThan(-1);
      const before = app.lastIndexOf("fetchMe(", at);
      expect(before).toBeGreaterThan(-1);
      expect(app.slice(before, before + 30)).toMatch(/fetchMe\(\{ force: true \}\)/);
    }
  });

  test("the post-login read does NOT force — it is the one the mounting screens share", () => {
    // Anchor on CODE: helpers/source.code() strips line-owning comments, so a comment anchor
    // matches nothing and the test passes vacuously.
    const at = app.indexOf("setActiveRoleState(null);");
    expect(at).toBeGreaterThan(-1);
    expect(app.slice(at, at + 160)).toMatch(/fetchMe\(\)\.then/);
    expect(app.slice(at, at + 160)).not.toMatch(/force: true/);
  });

  test("bootstrap and impersonation were left alone", () => {
    // Two direct reads remain on purpose: the boot restore reads a token out of the response
    // to seed AUTH_TOKEN, and the impersonation path is security-sensitive. Neither should be
    // routed through a cache to save one request.
    const direct = (app.match(/apiFetch\('\/api\/auth\/me'\)/g) || []).length;
    expect(direct).toBe(2);
  });
});

describe("E3 — the components no longer each fetch their own", () => {
  test.each([
    ["Dashboard.js", "_dashCache.user = d.user"],
    ["Messages.js", "setCurrentUser(d.user)"],
    ["AdminPanel.js", "fetchMe().then"],
    ["EmailVerificationBanner.js", "fetchMe().then"],
    ["MyAccount.js", "const data = await fetchMe()"],
  ])("%s uses the shared read", (file, marker) => {
    const src = code(`public/js/components/${file}`);
    expect(src).toContain(marker);
    expect(src).not.toMatch(/apiFetch\('\/api\/auth\/me'\)/);
  });
});

describe("E4 — one post-onboarding restore, not two", () => {
  test("the 29-line duplicate is gone and both callers share the helper", () => {
    // \b matters: without it `const restoreAfterOnboardingX` counts as a match and a rename
    // sails straight through this assertion.
    expect((app.match(/\brestoreAfterOnboarding\(token\)/g) || []).length).toBe(2);
    expect((app.match(/const restoreAfterOnboarding\b/g) || []).length).toBe(1);
  });

  test("it is declared BEFORE both callers — `const` is not hoisted", () => {
    // Put it after them and the render returns first, so onComplete throws "Cannot access
    // 'restoreAfterOnboarding' before initialization" the moment a caregiver finishes
    // onboarding. lint:client now fails the build on this shape; this pins the ordering too.
    const decl = app.indexOf("const restoreAfterOnboarding");
    const uses = [...app.matchAll(/restoreAfterOnboarding\(token\)/g)].map((m) => m.index);
    expect(uses).toHaveLength(2);
    for (const u of uses) expect(u).toBeGreaterThan(decl);
  });

  test("it forces a fresh read — the token just changed to a different person", () => {
    const i = app.indexOf("const restoreAfterOnboarding");
    expect(app.slice(i, i + 1200)).toMatch(/fetchMe\(\{ force: true \}\)/);
  });
});

describe("E5 — lint:client fails the TDZ shape", () => {
  const lint = raw("scripts/lint-client.js");

  test("the rule exists and is wired into the pass/fail decision", () => {
    expect(lint).toMatch(/function findConstUsedBeforeDeclaration/);
    expect(lint).toMatch(/earlyConsts\.length === 0/);
    expect(lint).toMatch(/const earlyConsts = findConstUsedBeforeDeclaration/);
  });

  test("it only fires when an early return can actually strand the declaration", () => {
    // Without this narrowing it reported 19 harmless useEffect callbacks in AdminPanel alone
    // and would have blocked every build.
    const i = lint.indexOf("function findConstUsedBeforeDeclaration");
    const fn = lint.slice(i, i + 4200);
    expect(fn).toMatch(/const canReturn = \(node\) => \{/);
    expect(fn).toMatch(/b\.range\[0\] >= stmt\.range\[0\] && b\.range\[1\] <= d\.start && canReturn\(b\)/);
  });

  test("it names the return that strands the declaration, not just the identifier", () => {
    expect(lint).toMatch(/can skip that declaration/);
  });
});
