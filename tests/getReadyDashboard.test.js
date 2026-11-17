/**
 * v1.129.0 — the caregiver "Get ready" dashboard (mockup claude.ai/artifact/9Y5vtgqQFuSAGUTdMXjgo3).
 *
 * Pete, 11/16, on Ryan's dashboard: "this landing page is a mess. I'm not even sure where he's
 * supposed to go other than go to stripe… the availability says 'complete step 2'… like, where's
 * step 2?"
 */
const { code, raw } = require("./helpers/source");
const hub = code("public/js/components/CaretakerHub.js");
const page = raw("public/js/components/CaretakerHub.js");

test("no 'step 2' and no 'home hub' banner", () => {
  // code() strips comments — the comment recording the old wording is allowed to quote it.
  expect(hub).not.toMatch(/Complete step 2/);
  expect(hub).not.toMatch(/This is your home hub/);
});

test("the headline says what the steps unlock", () => {
  expect(hub).toMatch(/' until ' \+ \(workFor \? 'you can work for ' \+ workFor : 'families can book you'\)/);
  // A vouched caregiver's next steps are ID, preferences and Stripe — not the background check.
  expect(hub).toMatch(/vouchedOnly \? \['identity', 'preferences', 'stripe'\] : \['identity', 'preferences', 'stripe', 'background-check'\]/);
});

test("every remaining step has its own button", () => {
  expect(hub).toMatch(/onClick=\{\(\) => openFirstStep\(id\)\} style=\{rowBtn\(isFirst\)\}/);
  expect(hub).toMatch(/listedIds\.map\(\(id\) => smallRow\(/);
});

test("account safety offers a passkey and 2FA, and is ticked from the account", () => {
  expect(page).toMatch(/Sign in with Face ID or your fingerprint/);
  expect(page).toMatch(/Or a code from an authenticator app/);
  expect(hub).toMatch(/const securityReviewed = !!profile\.accountSecured;/);
});

test("finished steps are ticks, not strikethrough, on the dashboard", () => {
  const start = hub.indexOf("const open = hubRoute.current;");
  expect(start).toBeGreaterThan(0);
  const card = hub.slice(start, hub.indexOf("CaregiverTourCard", start));
  expect(card.length).toBeGreaterThan(1000);
  expect(card).not.toMatch(/line-through/);
  expect(card).toMatch(/hubRoute\.items\.filter\(\(i\) => i\.state === 'done'\)/);
});

test("the calendar placeholder links to availability", () => {
  expect(hub).toMatch(/onClick=\{\(\) => openFirstStep\('avail-rates'\)\}/);
});
