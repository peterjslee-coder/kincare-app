// v1.105.37 — Pete's rule, stated while answering Apple's age-rating questionnaire:
//
//   "The app must NEVER generate medical or treatment information without the user
//    explicitly acknowledging that this is not medical care, and that it can only reflect
//    information provided to it."
//
// His reason: Claude can hallucinate, and in a product holding a dementia patient's
// medications and adherence history a fabricated line is not cosmetic.
//
// It also underwrites a store answer. The questionnaire was answered *Medical or Treatment
// Information = Infrequent*, on the grounds that InPlace records and displays rather than
// advises. That holds only while this rule does — unacknowledged generated guidance makes
// the honest answer *Frequent*, which pulls in the Regulated Medical Device declaration.
//
// So this is pinned: a surface that generates text and does not carry the acknowledgment is
// a defect, not a copy preference.

const { code, raw } = require("./helpers/source");

const badge = code("public/js/components/IPAiBadge.js");
const insights = code("public/js/components/IPAiInsightsCard.js");
const messages = code("public/js/components/Messages.js");

describe("the acknowledgment exists once, and says both halves", () => {
  test("it is defined in one place", () => {
    // One string, so the surfaces cannot drift apart the way the reimbursement status
    // labels did (three names for one state across three screens).
    expect(badge).toMatch(/const IPAI_NOT_MEDICAL = window\.IPAI_NOT_MEDICAL =/);
    expect(badge).toMatch(/const IPAiDisclaimer = window\.IPAiDisclaimer =/);
  });

  test("it says it is not medical care", () => {
    expect(badge).toMatch(/iPAi does not provide medical care/);
  });

  test("…and that it only reflects what the team recorded", () => {
    // Both halves are the rule. "Not medical care" alone would leave a user assuming the
    // app knows things nobody told it.
    expect(badge).toMatch(/only reflect what your care team has recorded/i);
  });
});

describe("every surface that GENERATES text carries it", () => {
  test("the care-intelligence card", () => {
    expect(insights).toMatch(/<IPAiDisclaimer/);
  });

  test("the iPAi chat thread", () => {
    expect(messages).toMatch(/<IPAiDisclaimer/);
    expect(messages).toMatch(/const isIPAiThread =/);
  });

  test("the chat notice sits with the composer, not only on the empty state", () => {
    // On the empty state it is read once, before anyone has asked anything. The point is
    // for it to be on screen at the moment an answer is being read.
    const composerIdx = messages.indexOf('<div className="msg-input-area">');
    const noticeIdx = messages.indexOf("isIPAiThread && typeof IPAiDisclaimer");
    expect(noticeIdx).toBeGreaterThan(-1);
    expect(noticeIdx).toBeLessThan(composerIdx);
  });

  test("a person-to-person thread does NOT show it", () => {
    // It is scoped to the iPAi thread. Putting a medical disclaimer under a message from
    // someone's brother would be absurd, and would train people to ignore it where it
    // matters.
    expect(messages).toMatch(/isIPAiThread && typeof IPAiDisclaimer !== 'undefined'/);
  });
});

describe("the component load order actually works", () => {
  const build = raw("scripts/build-client.js");

  test("IPAiBadge is bundled before the surfaces that use it", () => {
    const badgeAt = build.indexOf('"js/components/IPAiBadge.js"');
    const insightsAt = build.indexOf('"js/components/IPAiInsightsCard.js"');
    expect(badgeAt).toBeGreaterThan(-1);
    expect(badgeAt).toBeLessThan(insightsAt);
  });
});
