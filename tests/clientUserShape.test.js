// One mapping from /api/auth/me to the client's user object. (v1.105.76)
//
// There were SEVEN hand-written copies. v1.105.70 added identityVerified/identityStatus to two
// of them and left five, including the path Julia actually takes — finishing caregiver
// onboarding. So she completed onboarding, the app rebuilt her user without the field, and
// MyAccount's card went back to "Not Verified": the same bug, one commit after it was declared
// fixed, on a path nobody had walked.
//
// The lesson is not "remember all seven". It is that a field-by-field copy makes adding a field
// an N-times chore with no signal when you miss one. These tests keep it at one.

const fs = require("fs");
const path = require("path");

const REPO = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(REPO, "public/js/app.js"), "utf8");

// Strip comments so prose about `setCurrentUser({...})` cannot fail or satisfy these checks.
// (Learned the hard way in tests/caretakerHubStatusFetch.test.js, where a comment quoting the
// code under test made an assertion pass against the wrong block.)
const code = app
  .split("\n")
  .filter((l) => !l.trim().startsWith("//"))
  .join("\n");

describe("there is exactly one mapping", () => {
  test("toClientUser exists", () => {
    expect(code).toMatch(/const toClientUser = window\.toClientUser = \(u, overrides = \{\}\) =>/);
  });

  test("no caller builds the user object by hand", () => {
    // The gate. A raw object literal here is how five paths silently diverged.
    const raw = code.match(/setCurrentUser\(\s*\{/g) || [];
    expect(raw).toEqual([]);
  });

  test("every setCurrentUser call is the mapper, a functional update, or a reset", () => {
    const calls = code.match(/setCurrentUser\([^)]*/g) || [];
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      const ok = c.includes("toClientUser") || c.includes("prev") || c.includes("null");
      expect({ call: c.slice(0, 80), ok }).toEqual({ call: c.slice(0, 80), ok: true });
    }
  });
});

describe("the mapping carries what the server computes about identity", () => {
  const mapper = code.slice(code.indexOf("const toClientUser"), code.indexOf("const App = () =>"));

  test.each([
    ["identityVerified"],
    ["identityStatus"],
    ["onboardingComplete"],
    ["selfOnboardingComplete"],
    ["careRecipientId"],
    ["companionAccess"],
  ])("%s survives the mapping", (field) => {
    expect(mapper).toMatch(new RegExp(`${field}:`));
  });

  test("overrides are applied last, so a caller can still force a value", () => {
    expect(mapper).toMatch(/\.\.\.overrides,\s*\n\s*\};/);
  });
});

describe("the per-site differences that justified separate copies still hold", () => {
  test("a demo switch asserts demo values rather than reading them", () => {
    expect(code).toMatch(/toClientUser\(user, \{[\s\S]*?isDemo: true/);
  });

  test("impersonation never inherits admin", () => {
    // v1.105.2: the impersonation token carries the target's id, so req.user IS them —
    // but the client must not paint an admin UI over it.
    expect(code).toMatch(/toClientUser\(meData\.user, \{ roles: userRoles, isAdmin: false \}\)/);
  });
});
