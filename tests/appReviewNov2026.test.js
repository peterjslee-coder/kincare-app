// App Review rejection of iOS 1.1 (9), Nov 14 2026 — the client half, held from source.
// The server half (no password, name fallback) runs for real in
// tests/integration/appleSignupNoReask.itest.js.

const { code } = require("./helpers/source");

const register = code("public/js/components/RegisterPage.js");
const account = code("public/js/components/MyAccount.js");
const app = code("public/js/app.js");

describe("Guideline 4 — Sign in with Apple does not re-ask", () => {
  test("an OAuth sign-up validates only date of birth and phone", () => {
    expect(register).toMatch(/if \(isOAuthSignup\) return !!\(formData\.dateOfBirth && formData\.phone\.trim\(\)\);/);
  });

  test("the email and password fields are not rendered on an OAuth sign-up", () => {
    expect(register).toMatch(/\{!isOAuthSignup && \(\s*<div className="form-group">\s*<label>Email/);
    expect(register).toMatch(/\{!isOAuthSignup && \(<>\s*<div className="form-group">\s*<label>Password/);
  });

  test("name fields appear only when the provider sent no name, and then optional", () => {
    expect(register).toMatch(/\{isOAuthSignup && !providerGaveName && \(/);
    expect(register).toMatch(/First Name <span[^>]*>\(optional\)<\/span>/);
  });

  test("the OAuth payload carries no password", () => {
    const payload = register.slice(register.indexOf("? { code: oauthSignupCode"), register.indexOf(": { email: formData.email"));
    expect(payload).toMatch(/dateOfBirth: formData\.dateOfBirth/);
    expect(payload).not.toMatch(/password/);
  });

  test("the provider name reaches the form", () => {
    expect(app).toMatch(/oauthProvider: data\.provider/);
    expect(app).toMatch(/oauthProvider=\{signupPrefill\?\.oauthProvider\}/);
  });
});

describe("Guideline 5.1.1(v) — deletion is visible on every account, demo included", () => {
  test("Delete My Account is no longer hidden behind !isDemo", () => {
    expect(account).toMatch(/<DeleteAccountSection onDeleted=\{handleLogoutFromAccount\} isDemo=\{!!isDemo\} \/>/);
    expect(account).not.toMatch(/\{!isDemo && \(\s*<DeleteAccountSection/);
  });

  test("a demo account walks the flow but never calls the delete API", () => {
    const handler = account.slice(account.indexOf("const handleDelete = async"), account.indexOf("const reset ="));
    const demoAt = handler.indexOf("if (isDemo) { setStep('demo_done'); return; }");
    const apiAt = handler.indexOf("apiFetch('/api/auth/me'");
    expect(demoAt).toBeGreaterThan(-1);
    expect(apiAt).toBeGreaterThan(demoAt);
  });
});

// v1.127.3 — two bugs Pete hit while recording the deletion video for App Review.
describe("waiting for approval is not a dead end", () => {
  const appRaw = require("./helpers/source").code("public/js/app.js");

  test("Account and Help open for real while pending (Delete My Account lives in Account)", () => {
    expect(appRaw).toMatch(/!currentUser\.account_approved && !currentUser\.isDemo && !currentUser\.is_admin && !\['account', 'help'\]\.includes\(currentPage\) \? \(/);
  });

  test("approval is noticed without the socket: polled while pending, and on return to the app", () => {
    const block = appRaw.slice(appRaw.indexOf("const pendingApproval ="), appRaw.indexOf("// ─── Account approved — refresh user data"));
    expect(block).toMatch(/setInterval\(check, 20000\)/);
    expect(block).toMatch(/addEventListener\('visibilitychange', onVisible\)/);
    expect(block).toMatch(/fetchMe\(\{ force: true \}\)/);
    expect(block).toMatch(/data\?\.user\?\.account_approved/);
  });
});

describe("date of birth is three dropdowns, not the native date picker", () => {
  const { code: c } = require("./helpers/source");
  test("signup and caregiver onboarding use DateOfBirthInput", () => {
    expect(c("public/js/components/RegisterPage.js")).toMatch(/<DateOfBirthInput value=\{formData\.dateOfBirth\}/);
    const onboarding = c("public/js/components/CaregiverOnboarding.js");
    expect((onboarding.match(/<DateOfBirthInput value=\{form\.dateOfBirth\}/g) || []).length).toBe(2);
    expect(onboarding).not.toMatch(/<input type="date"[^>]*\n?[^>]*dateOfBirth/);
  });

  test("it emits the same YYYY-MM-DD string, and nothing until all three are chosen", () => {
    const dob = c("public/js/components/DateOfBirthInput.js");
    expect(dob).toMatch(/next\.y && next\.m && next\.d\s*\?\s*`\$\{next\.y\}-\$\{String\(next\.m\)\.padStart\(2, '0'\)\}-\$\{String\(next\.d\)\.padStart\(2, '0'\)\}`\s*:\s*''/);
  });

  test("it is in the bundle, before its first user", () => {
    const build = require("./helpers/source").raw("scripts/build-client.js");
    expect(build.indexOf('"js/components/DateOfBirthInput.js"')).toBeGreaterThan(-1);
    expect(build.indexOf('"js/components/DateOfBirthInput.js"')).toBeLessThan(build.indexOf('"js/components/RegisterPage.js"'));
  });
});
