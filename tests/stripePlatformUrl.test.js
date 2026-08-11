// v1.105.56 — the URL we hand Stripe has to be one that answers.
//
// Pete, hitting caregiver signup: Stripe's onboarding showed a PAST DUE task, "Provide
// information about your business website", and under the field
// "This URL couldn't be reached."
//
// It was ours. `business_profile.url` was hardcoded to https://inplace.care at both places
// a connected account is created. That domain returns a Cloudflare 525 — an SSL handshake
// failure with the origin — and has never served anything; the live product is at
// yourinplace.com. Stripe fetches the URL during verification, can't reach it, and hands
// the CAREGIVER a blocking task about a domain that isn't theirs and that they have no
// possible way to fix.
//
// Two things make this worth pinning hard rather than just editing a string:
//
//   1. It blocks payouts. A caregiver who can't clear that task can't get paid, and the
//      screen they're staring at looks like their own problem, not ours.
//   2. It was a literal in two places. The app already derives its own address from
//      APP_URL for WebAuthn and CORS; anything that must agree with "where the app lives"
//      belongs there too, or it drifts the next time a domain moves.

const { code } = require("./helpers/source");

const payments = code("src/routes/payments.js");

describe("what we tell Stripe about ourselves", () => {
  test("the platform URL is derived from APP_URL, not hardcoded", () => {
    expect(payments).toMatch(/const \{ appUrl \} = require\("\.\.\/utils\/env"\);/);
    expect(payments).toMatch(/const PLATFORM_URL = `\$\{appUrl\}\/business`;/);
  });

  test("it points at the server-rendered page, not the app shell", () => {
    // index.html is `<div id="root"></div>` and everything else is drawn by JavaScript.
    // Stripe's verification reads HTML: the app root looks exactly like the "placeholder or
    // under-construction site" its own task text says it won't accept. Sending it there
    // would very likely have failed review a second time.
    const server = code("src/server.js");
    expect(server).toMatch(/app\.get\("\/business", \(req, res\) => \{/);
    expect(server).toMatch(/business\.html/);
    // ...and it must be mounted BEFORE the SPA catch-all, or it never runs.
    expect(server.indexOf('app.get("/business"')).toBeLessThan(server.indexOf('app.get("*"'));
  });

  test("the page says what the business sells, charges and pays", () => {
    // Stripe's requirement is "detailed information about your business and the products
    // you sell" — a landing page with a tagline does not clear that bar.
    const page = require("fs").readFileSync(
      require("path").join(__dirname, "..", "public", "business.html"), "utf8"
    );
    for (const needed of [
      "Companionship", "Respite care", "Transportation",
      "20% commission", "keep 80%", "$45 to $85",
      "support@yourinplace.com", "New River Valley",
    ]) {
      expect([needed, page.includes(needed)]).toEqual([needed, true]);
    }
    // No JavaScript required to read it — that is the entire point.
    expect(page).not.toMatch(/<script/i);
    expect(page).not.toMatch(/id="root"/);
  });

  test("no connected account is created with a dead domain", () => {
    // Both creation sites — /connect/onboard and the lazy create in the payout path.
    expect(payments).not.toMatch(/url: "https:\/\/inplace\.care"/);
    expect((payments.match(/url: PLATFORM_URL,/g) || []).length).toBe(2);
  });

  test("every account creation still sends a business_profile", () => {
    // Dropping it entirely would be the other way to make the error go away, and it would
    // cost us the MCC — which is what tells Stripe this is medical/care services.
    expect((payments.match(/mcc: "8099"/g) || []).length).toBe(2);
  });
});

describe("accounts that already carry the dead URL", () => {
  test("onboarding repairs them on the way through", () => {
    // Fixing the create call only helps accounts made from now on. Everyone who already
    // reached onboarding has the bad URL stored at Stripe and a Past Due task they cannot
    // clear — including the account in Pete's screenshot.
    const at = payments.indexOf("const acct = await stripe.accounts.retrieve");
    const block = payments.slice(at, payments.indexOf("stripe.accountLinks.create", at));
    expect(block).toMatch(/acct\.business_profile\.url !== PLATFORM_URL/);
    expect(block).toMatch(/acct\?\.business_profile\?\.url &&/); // and only when one is set
    expect(block).toMatch(/stripe\.accounts\.update\(stripeAccountId, \{/);
    expect(block).toMatch(/business_profile: \{ url: PLATFORM_URL \}/);
  });

  test("a failed repair never blocks the onboarding link", () => {
    // The link is what lets them continue. A best-effort mend must not become the reason
    // they can't get to it.
    const at = payments.indexOf("const acct = await stripe.accounts.retrieve");
    const block = payments.slice(at, payments.indexOf("stripe.accountLinks.create", at));
    expect(block).toMatch(/captureException\(err, \{ where: "payments: repair business_profile\.url"/);
    expect(block).toMatch(/\} catch \(err\) \{/);
  });

  test("the repair runs before the link, not after", () => {
    expect(payments.indexOf("stripe.accounts.update(stripeAccountId")).toBeLessThan(
      payments.indexOf("stripe.accountLinks.create")
    );
  });
});
