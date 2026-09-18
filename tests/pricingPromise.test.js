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

  // v1.106.19 — Pete: "if I change that later, I don't want a bunch of old hard-coded 20s to
  // wreak havoc." So the copy reads the fee instead of restating it, and this is the gate.
  test("the public copy renders the fee rather than restating it", () => {
    const splash = readStripped("public/js/components/SplashPage.js");
    expect(splash).toMatch(/a flat \{feePercent\}% for everyone/);
    // v1.107.x — Pete's fee rule: the caregiver keeps her full rate and the fee goes ON TOP.
    // "Caregivers keep 80%" was never true under that rule (she gets 100/120 of what is paid),
    // so the copy now says what actually happens, still reading the fee.
    expect(splash).toMatch(/inPlace adds \{feePercent\}% on top/);
    expect(splash).toMatch(/Caregivers Keep Their Full Rate/);
    expect(splash).not.toMatch(/caregiverSharePercent/);
    expect(splash).toMatch(/usePlatformFee\(\)/);
  });

  test("nor does any copy hardcode the caregiver's SHARE", () => {
    // The first pass at this only looked for "N% platform fee" / "N% commission" / "a flat N%",
    // and missed six places saying "caregivers keep 80%" — the same number, said the other way.
    // Rendering the actual page is what found them, not the grep. So the grep is wider now.
    const offenders = [];
    for (const f of [
      "public/js/components/SplashPage.js", "public/js/components/DemoOrientation.js",
      "src/routes/referrals.js",
    ]) {
      for (const line of readStripped(f).split("\n")) {
        // "take up to 40%" is a claim about OTHER agencies and is not ours to derive.
        if (/(keep|Keep)\s+\d+%\s+(of|and|,|\.)|[Kk]eep[s]? \d+%\b|'\d+%', label: 'You keep'/.test(line)
            && !/up to 40%/.test(line)
            // "100% of your rate" is the caregiver-facing statement of the fee-on-top rule, not a
            // restated fee — it does not change when the fee does.
            && !/[Kk]eep 100% of (your|the) rate/.test(line)) {
          offenders.push(`${f}: ${line.trim().slice(0, 100)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test("no user-facing platform-fee copy hardcodes the number any more", () => {
    // Scoped to PLATFORM FEE wording on purpose. Three unrelated 20s live nearby and must
    // survive untouched: the short-notice surcharge, the 20% tip preset, and aiMatching's
    // scoring weights. Same digits, different facts.
    const offenders = [];
    for (const f of [
      "public/js/components/SplashPage.js", "public/js/components/MyAccount.js",
      "src/routes/payments.js", "src/routes/financials.js",
    ]) {
      for (const line of readStripped(f).split("\n")) {
        if (/\b\d+% (platform fee|commission)|platform fee rate is[^`]*\b\d+%|a flat \d+%/.test(line)) {
          offenders.push(`${f}: ${line.trim().slice(0, 90)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test("the surcharge and tip copy are NOT swept up — they are different numbers", () => {
    // A blanket find-and-replace on "20%" would have rewritten these into the platform fee.
    expect(read("public/js/components/RequestCareModal.js")).toMatch(/20% rush surcharge/i);
    expect(read("public/js/components/MyAccount.js")).toMatch(/Rush Surcharge/);
    expect(read("public/js/components/Dashboard.js")).toMatch(/label: '20%'/);
  });

  test("the client's fallback and the server's default are the same number", () => {
    // The client needs SOME number before the fetch lands — a marketing page must never paint
    // "a flat undefined%". This keeps that one number honest.
    const { DEFAULT_PLATFORM_FEE_PERCENT } = require("../src/utils/platformFee");
    expect(DEFAULT_PLATFORM_FEE_PERCENT).toBe(20);
    const m = readStripped("public/js/utils.js").match(/PRICING_FALLBACK_FEE_PERCENT = window\.PRICING_FALLBACK_FEE_PERCENT = (\d+)/);
    expect(m).toBeTruthy();
    expect(Number(m[1])).toBe(DEFAULT_PLATFORM_FEE_PERCENT);
  });

  test("the fee is published on a public endpoint, because the splash is logged-out", () => {
    const server = readStripped("src/server.js");
    expect(server).toMatch(/app\.use\("\/api\/pricing", require\("\.\/routes\/pricing"\)\)/);
    // A router, not an inline app.get — anything defined directly on `app` in server.js cannot
    // be mounted by the integration harness, and therefore cannot be integration-tested.
    expect(readStripped("src/routes/pricing.js")).toMatch(/caregiverSharePercent: 100 - platformFeePercent/);
    // and it must not be version-gated, or an old client renders no number at all
    expect(server).toMatch(/VERSION_GATE_EXEMPT = \["\/api\/version", "\/api\/pricing"/);
  });

  test("four-fifths of the surcharge really is the caregiver's", () => {
    const { SURCHARGE_PLATFORM_SHARE } = (() => {
      const src = read("src/utils/rateCalculator.js");
      const m = src.match(/SURCHARGE_PLATFORM_SHARE\s*=\s*([\d.]+)/);
      return { SURCHARGE_PLATFORM_SHARE: Number(m[1]) };
    })();
    // v1.109.0 — Pete, 9/18: "of that extra 20%, the caregiver gets 80, IP gets 20."
    expect(1 - SURCHARGE_PLATFORM_SHARE).toBeCloseTo(0.8, 5);
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
