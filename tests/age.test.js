// v1.105.8 — the signup age gate. Worth real tests: it's a legal boundary, it runs on every
// new account, and the failure mode (silently letting a 12-year-old in) is invisible.

const { ageInYears, checkSignupAge, MIN_SIGNUP_AGE } = require("../src/utils/age");

const on = (s) => new Date(`${s}T12:00:00`); // local noon — no DST/midnight edge

describe("ageInYears", () => {
  test("counts whole years", () => {
    expect(ageInYears("2000-01-01", on("2026-07-30"))).toBe(26);
  });

  test("the day BEFORE a birthday is still the younger age", () => {
    expect(ageInYears("2013-07-31", on("2026-07-30"))).toBe(12);
  });

  test("on the birthday itself you are the older age", () => {
    expect(ageInYears("2013-07-30", on("2026-07-30"))).toBe(13);
  });

  test("a Feb 29 birthday turns 13 on Mar 1 in a non-leap year", () => {
    expect(ageInYears("2012-02-29", on("2025-02-28"))).toBe(12);
    expect(ageInYears("2012-02-29", on("2025-03-01"))).toBe(13);
  });

  test("dates that do not exist are rejected, not coerced", () => {
    // new Date("2025-02-30") silently rolls forward to Mar 2 — that must not become an age.
    expect(ageInYears("2025-02-30", on("2026-07-30"))).toBeNull();
    expect(ageInYears("2025-04-31", on("2026-07-30"))).toBeNull();
    expect(ageInYears("2025-13-01", on("2026-07-30"))).toBeNull();
  });

  test("junk input is rejected", () => {
    for (const bad of ["", "yesterday", "01/02/2003", "2003-1-2", null, undefined, 20030102, {}]) {
      expect(ageInYears(bad, on("2026-07-30"))).toBeNull();
    }
  });

  test("a bare YYYY-MM-DD is not shifted a day by timezone", () => {
    // `new Date("2013-07-30")` is UTC midnight, which is Jul 29 in US timezones — the exact
    // class of bug that has bitten this codebase before. Calendar arithmetic avoids it.
    expect(ageInYears("2013-07-30", on("2026-07-30"))).toBe(13);
  });
});

describe("checkSignupAge", () => {
  test("13 exactly is allowed — the floor is inclusive", () => {
    const r = checkSignupAge("2013-07-30", on("2026-07-30"));
    expect(r.ok).toBe(true);
    expect(r.age).toBe(MIN_SIGNUP_AGE);
  });

  test("one day short of 13 is refused", () => {
    const r = checkSignupAge("2013-07-31", on("2026-07-30"));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("under_age");
  });

  test("the under-age message points at the no-account route instead of just refusing", () => {
    const r = checkSignupAge("2020-01-01", on("2026-07-30"));
    expect(r.message).toMatch(/parent or guardian/i);
    expect(r.message).toMatch(/without an account/i);
  });

  test("a future date reads as a correctable typo, not a rejection", () => {
    const r = checkSignupAge("2030-01-01", on("2026-07-30"));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("future");
    expect(r.message).not.toMatch(/too young/i);
  });

  test("implausibly old is caught (mistyped year)", () => {
    expect(checkSignupAge("1850-01-01", on("2026-07-30")).reason).toBe("implausible");
  });

  test("missing or malformed dates are refused, never defaulted to allowed", () => {
    for (const bad of [undefined, null, "", "not-a-date"]) {
      expect(checkSignupAge(bad, on("2026-07-30")).ok).toBe(false);
    }
  });

  test("an adult passes", () => {
    expect(checkSignupAge("1975-03-14", on("2026-07-30")).ok).toBe(true);
  });
});

// ─── every signup door is gated ───
// The gate is only as good as its narrowest coverage. Three code paths create a real
// human account, and one of them (CaregiverOnboarding) very nearly shipped broken:
// it collects a date of birth only at the Checkr step, which runs AFTER the account is
// created, so gating /api/auth/register without touching it would have blocked caregiver
// signup outright — the same barrier-to-entry class as the v1.105.0 onboarding bug.
const fs = require("fs");
const path = require("path");
const rd = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

describe("signup age gate covers every door", () => {
  test("server: /api/auth/register enforces it", () => {
    expect(rd("src/middleware/validate.js")).toMatch(/checkSignupAge\(\s*dateOfBirth\s*\)/);
  });

  test("server: OAuth complete-signup enforces it too", () => {
    expect(rd("src/routes/oauth.js")).toMatch(/checkSignupAge\(\s*req\.body\.dateOfBirth\s*\)/);
  });

  test("server: both paths persist the date of birth", () => {
    expect(rd("src/routes/auth.js")).toMatch(/date_of_birth/);
    expect(rd("src/routes/oauth.js")).toMatch(/date_of_birth/);
  });

  test("client: the main signup form sends it", () => {
    expect(rd("public/js/components/RegisterPage.js")).toMatch(/dateOfBirth: formData\.dateOfBirth/);
  });

  test("client: caregiver onboarding sends it AT ACCOUNT CREATION, not just at the Checkr step", () => {
    const src = rd("public/js/components/CaregiverOnboarding.js");
    const regBody = src.slice(src.indexOf("const regBody = {"), src.indexOf("const regBody = {") + 400);
    expect(regBody).toMatch(/dateOfBirth: form\.dateOfBirth/);
  });

  test("there is a migration adding the column", () => {
    expect(rd("src/models/database.js")).toMatch(/013_users_date_of_birth/);
    expect(rd("src/models/database.js")).toMatch(/ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_birth DATE/);
  });
});
