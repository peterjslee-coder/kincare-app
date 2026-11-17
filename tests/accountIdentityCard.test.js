/**
 * v1.128.4 — My Account's identity card and Photo ID card.
 *
 * Pete, 11/16, on Ryan's account: "why does ryan's profile still show he hasn't had identity
 * verified? we've had this issue before." / "it doesn't show his photo id either."
 *
 * 1. The status was copied from `user` inside an effect keyed on [activeTab], which runs on mount
 *    before /api/auth/me returns — so it was always 'not_started' until a tab switch.
 * 2. The Photo ID card matched only document_type 'drivers_license'; onboarding files
 *    dl_front/dl_back/id_front/id_back.
 */
const { raw, code } = require("./helpers/source");

const src = code("public/js/components/MyAccount.js");

test("identity status follows the user object, not the active tab", () => {
  expect(src).toMatch(/setFamilyIdentityStatus\(user\.identityStatus \|\| 'not_started'\);\s*\}, \[user, user\?\.identityStatus\]\);/);
  // The old copy inside the tab effect is gone.
  expect(src).not.toMatch(/if \(user\?\.identityStatus\) setFamilyIdentityStatus\(user\.identityStatus\);\s*else setFamilyIdentityStatus\('not_started'\);/);
});

test("unknown renders as checking, never as Not Verified", () => {
  const page = raw("public/js/components/MyAccount.js");
  expect(page).toMatch(/familyIdentityStatus === null\s*\?\s*React\.createElement\('span'[^)]*\)?[^\n]*'Checking…'/);
  expect(page).toMatch(/familyIdentityStatus === null \? \(\s*<p[^>]*>Checking your verification…<\/p>/);
});

test("the Photo ID card matches every ID type onboarding saves", () => {
  expect(src).toMatch(/const ID_TYPES = \['drivers_license', 'dl_front', 'dl_back', 'id_front', 'id_back'\];/);
  expect(src).toMatch(/docType === 'drivers_license' \? ID_TYPES\.includes\(t\) : t === docType/);
});

test("'Lock down your account' is a fact about the account, never this browser's localStorage", () => {
  const hub = code("public/js/components/CaretakerHub.js");
  expect(hub).toMatch(/const securityReviewed = !!profile\.accountSecured;/);
  expect(hub).not.toMatch(/localStorage\.getItem\('inplace_security_reviewed'\)/);
  const dash = code("src/routes/dashboard.js");
  expect(dash).toMatch(/accountSecured: !!\(\(await db\.prepare\("SELECT 1 FROM user_2fa WHERE user_id = \? AND is_enabled = 1"\)/);
  expect(dash).toMatch(/SELECT 1 FROM user_passkeys WHERE user_id = \? LIMIT 1/);
});
