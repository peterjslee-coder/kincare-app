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
const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

describe("the promise is on the page", () => {
  const splash = read("public/js/components/SplashPage.js");
  // Negative assertions MUST run against stripped source. The block's own comment explains
  // why it does not claim "no surcharges" — and that explanation contains the phrase. This
  // has now bitten three times in this codebase (Android background location, the
  // cancellation capture, here), so: raw for "is it on the page", stripped for "is it NOT".
  const splashCode = strip(splash);

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
  test("the platform fee is a constant, identical for everyone", () => {
    // "a flat 20% for everyone" — if this ever becomes a lookup, per-user or per-tier, the
    // word "flat" stops being true.
    expect(strip(read("src/routes/payments.js"))).toMatch(/const PLATFORM_FEE_PERCENT = 20;/);
    expect(strip(read("src/routes/accountability.js"))).toMatch(/const PLATFORM_FEE_PERCENT = 20;/);
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
    expect(strip(read("src/routes/caregivers.js"))).toMatch(/updates\.push\("hourly_rate = \?"\)/);
  });

  test("the AI modules contain no pricing logic at all", () => {
    // The strongest form of the claim: not "the AI is instructed not to", but "the AI code
    // has no access to price fields". The only 'rate' in ipaiChat is API rate-limiting, so
    // match on the field names rather than the word.
    for (const f of ["src/utils/careIntelligence.js", "src/utils/kindredBrain.js", "src/routes/ipaiChat.js"]) {
      const src = strip(read(f));
      expect(src).not.toMatch(/hourly_rate|agreed_rate|PLATFORM_FEE|surchargePercent|calculateSessionCost/);
    }
  });

  test("session cost is arithmetic on declared inputs, with no per-user signal", () => {
    // No demand, no history, no willingness-to-pay. Just their rates, the clock, and a
    // constant. Asserting the SIGNATURE is what stops a 'userId' quietly appearing.
    const rc = strip(read("src/utils/rateCalculator.js"));
    expect(rc).toMatch(/function calculateSessionCost\(startTime, endTime, rates, options = \{\}\)/);
    expect(rc).not.toMatch(/userId|customerId|demand|willingness|priceElasticity/i);
  });
});
