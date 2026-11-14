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
