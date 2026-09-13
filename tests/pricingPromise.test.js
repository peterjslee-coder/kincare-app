// v1.105.25 — the public promise that AI does not set prices or wages.
//
// This is marketing copy that makes a factual claim about the code. That is the exact shape
// of thing that rotted in the cancellation policy — eleven places saying different things,
// including a Dashboard warning that told families they would be charged when nothing ever
// charged them. So the claim gets a test, and the test reads the code, not the copy.
//
// If any of these stop being true, this file fails and someone has to either fix the code or
// delete the promise. Both are fine. Quietly keeping a claim that is no longer true is not.

const fs = require("fs");
const path = require("path");
// v1.105.36 — reads source through tests/helpers/source.js. The hand-rolled strip this
// replaces used a GLOBAL /* … */ regex, which reads the `/*` inside a string literal as a
// comment opener: on src/server.js the `https://*.tile.openstreetmap.org` entry in the CSP
// swallowed 1,184 characters of real config, and on src/models/database.js it lost 770.
// A positive assertion fails loudly when that happens; a NEGATIVE one passes silently,
// having verified nothing.
const { raw: read, code: readStripped } = require("./helpers/source");

describe("the promise is on the page", () => {
  const splash = read("public/js/components/SplashPage.js");
  // Negative assertions MUST run against stripped source. The block's own comment explains
  // why it does not claim "no surcharges" — and that explanation contains the phrase. This
  // has now bitten three times in this codebase (Android background location, the
  // cancellation capture, here), so: raw for "is it on the page", stripped for "is it NOT".
  const splashCode = readStripped("public/js/components/SplashPage.js");

  test("it states that AI sets neither prices nor wages", () => {
    expect(splash).toMatch(/does not do: set prices, or set wages/i);
  });

  test("it names the short-notice surcharge rather than glossing over it", () => {
    // "No surcharges" would be false. A promise with a quiet exception is worse than no
    // promise, because the exception is what someone finds later and feels lied to about.
    expect(splash).toMatch(/short-notice\s+surcharge/i);
    expect(splash).toMatch(/three-quarters of it goes to the caregiver/i);
  });

  test("it does not overclaim by denying the surcharge exists", () => {
    expect(splashCode).not.toMatch(/no surcharges/i);
    expect(splashCode).not.toMatch(/never any extra/i);
  });
});

describe("...and the code still backs it", () => {
  // v1.106.18 — this used to assert `const PLATFORM_FEE_PERCENT = 20` in payments.js and
  // accountability.js. That was the wrong shape of check, and it was protecting the wrong half.
  //
  // Those two constants WERE the bug: the quote side (sessions.js, dashboard.js) read
  // platform_settings.platform_fee_percent, the charge side used the hardcoded 20, and
  // PUT /api/admin/financials/platform-fee writes that setting and accepts 0 to 50. Move the
  // dial and the family is quoted one fee and charged another. This test would have passed
  // throughout, because it was checking the literal rather than the promise.
  //
  // The promise on the splash page is "a flat 20% for everyone". Two things have to hold for
  // that sentence to be true, and they are different things:
  test("the fee is FLAT — one number for everyone, not a per-user or per-tier lookup", () => {
    // The word "flat" is about who, not about where the number is stored. getPlatformFeePercent
    // takes only a db handle: there is no user, no tier, nothing to vary it by.
    const feeSrc = readStripped("src/utils/platformFee.js");
    expect(feeSrc).toMatch(/async function getPlatformFeePercent\(db\)/);
    expect(feeSrc).not.toMatch(/userId|user_id|tier|caregiverId/);
  });

  test("...and it is ONE number — no module keeps its own copy any more", () => {
    for (const f of ["src/routes/payments.js", "src/routes/accountability.js",
                     "src/routes/sessions.js", "src/routes/dashboard.js"]) {
      expect(readStripped(f)).not.toMatch(/const PLATFORM_FEE_PERCENT\s*=\s*\d+/);
    }
  });

  test("the number the page promises is the number the code defaults to", () => {
    // If someone changes the default, this fails and the copy has to change with it.
    const { DEFAULT_PLATFORM_FEE_PERCENT } = require("../src/utils/platformFee");
    expect(DEFAULT_PLATFORM_FEE_PERCENT).toBe(20);
    expect(read("public/js/components/SplashPage.js")).toMatch(
      new RegExp(`a flat ${DEFAULT_PLATFORM_FEE_PERCENT}% for everyone`)
    );
  });

  test("three-quarters of the surcharge really is the caregiver's", () => {
    const { SURCHARGE_PLATFORM_SHARE } = (() => {
      const src = read("src/utils/rateCalculator.js");
      const m = src.match(/SURCHARGE_PLATFORM_SHARE\s*=\s*([\d.]+)/);
      return { SURCHARGE_PLATFORM_SHARE: Number(m[1]) };
    })();
    expect(1 - SURCHARGE_PLATFORM_SHARE).toBeCloseTo(0.75, 5);
  });

  test("caregivers set their own rate — nothing else writes it", () => {
    // The rate the caregiver types is the rate that is stored. If some other system starts
    // writing hourly_rate, "caregivers name their own rate" needs re-examining.
    expect(readStripped("src/routes/caregivers.js")).toMatch(/updates\.push\("hourly_rate = \?"\)/);
  });

  test("the AI modules contain no pricing logic at all", () => {
    // The strongest form of the claim: not "the AI is instructed not to", but "the AI code
    // has no access to price fields". The only 'rate' in ipaiChat is API rate-limiting, so
    // match on the field names rather than the word.
    for (const f of ["src/utils/careIntelligence.js", "src/utils/kindredBrain.js", "src/routes/ipaiChat.js"]) {
      const src = readStripped(f);
      expect(src).not.toMatch(/hourly_rate|agreed_rate|PLATFORM_FEE|surchargePercent|calculateSessionCost/);
    }
  });

  test("session cost is arithmetic on declared inputs, with no per-user signal", () => {
    // No demand, no history, no willingness-to-pay. Just their rates, the clock, and a
    // constant. Asserting the SIGNATURE is what stops a 'userId' quietly appearing.
    const rc = readStripped("src/utils/rateCalculator.js");
    expect(rc).toMatch(/function calculateSessionCost\(startTime, endTime, rates, options = \{\}\)/);
    expect(rc).not.toMatch(/userId|customerId|demand|willingness|priceElasticity/i);
  });
});
