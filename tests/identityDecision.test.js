// A person decides. The AI recommends, or says nothing. (v1.105.112)
//
// Pete, Aug 19 2026:
//   "I want to review everything an AI clears. Below a confidence of, say, 90%, it doesn't
//    even decide...I do. But I haven't gotten a doc review notice on anything yet."
//
// Until now both verify-id endpoints wrote `status = needsHumanReview ? 'pending' : 'approved'`.
// When the name matched, the document classified as valid, the DOB matched and the faces
// matched, the AI approved someone's GOVERNMENT ID outright and no person was ever asked.
// Julia's was approved that way. Review was the exception, not the rule.

const { identityDecision, verdictLabel, AI_RECOMMENDS_ABOVE, VERDICT } = require("../src/utils/identityDecision");
const fs = require("fs");
const path = require("path");
const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

describe("nothing the AI can say results in an approval", () => {
  const cases = [
    ["everything agrees, high confidence", { looksRight: true, docConfidence: 0.99, faceConfidence: 0.99 }],
    ["everything agrees, low confidence", { looksRight: true, docConfidence: 0.5, faceConfidence: 0.5 }],
    ["nothing agrees", { looksRight: false, docConfidence: 0.99, faceConfidence: 0.99 }],
    ["no face comparison possible", { looksRight: true, docConfidence: 1, faceSkipped: true }],
    ["garbage in", {}],
  ];

  test.each(cases)("%s → pending", (_name, signals) => {
    expect(identityDecision(signals).status).toBe("pending");
  });

  test("there is no code path that returns anything else", () => {
    const src = read("src/utils/identityDecision.js");
    const statuses = src.match(/status: "[a-z]+"/g) || [];
    expect(new Set(statuses)).toEqual(new Set(['status: "pending"']));
  });
});

describe("below 90% it does not even offer an opinion", () => {
  test("the threshold is 90%", () => {
    expect(AI_RECOMMENDS_ABOVE).toBe(0.9);
  });

  test("89% abstains, 90% recommends", () => {
    expect(identityDecision({ looksRight: true, docConfidence: 0.89, faceSkipped: true }).verdict).toBe(VERDICT.ABSTAIN);
    expect(identityDecision({ looksRight: true, docConfidence: 0.90, faceSkipped: true }).verdict).toBe(VERDICT.APPROVE);
  });

  test("a low-confidence NEGATIVE is also withheld", () => {
    // A guess is a guess in both directions. Anchoring the reviewer on "probably fake, 60%"
    // is as bad as anchoring them on "probably fine, 60%".
    expect(identityDecision({ looksRight: false, docConfidence: 0.6, faceSkipped: true }).verdict).toBe(VERDICT.ABSTAIN);
  });

  test("abstaining says why, in a number a person can argue with", () => {
    const d = identityDecision({ looksRight: true, docConfidence: 0.72, faceSkipped: true });
    expect(d.reason).toMatch(/72% is below 90%/);
  });
});

describe("confidence is the weakest link, not the strongest", () => {
  test("a 97% document with a 40% face match is a 40% answer", () => {
    // v1.105.73 was exactly this pair of numbers sitting side by side in the admin panel.
    // Taking the document's number alone would auto-recommend a face that did not match.
    const d = identityDecision({ looksRight: true, docConfidence: 0.97, faceConfidence: 0.4 });
    expect(Math.round(d.confidence * 100)).toBe(40);
    expect(d.verdict).toBe(VERDICT.ABSTAIN);
  });

  test("a skipped face comparison is not counted as a zero", () => {
    // Skipped means "could not measure", not "measured badly" — the third state again.
    const d = identityDecision({ looksRight: true, docConfidence: 0.95, faceSkipped: true });
    expect(Math.round(d.confidence * 100)).toBe(95);
    expect(d.verdict).toBe(VERDICT.APPROVE);
  });

  test("no measurements at all is zero, not one", () => {
    expect(identityDecision({ looksRight: true }).confidence).toBe(0);
    expect(identityDecision({ looksRight: true }).verdict).toBe(VERDICT.ABSTAIN);
  });
});

describe("a recommendation reads as a recommendation", () => {
  test("the labels never claim a decision", () => {
    expect(verdictLabel(VERDICT.APPROVE)).toBe("AI suggests approving");
    expect(verdictLabel(VERDICT.REJECT)).toBe("AI suggests rejecting");
    expect(verdictLabel(VERDICT.ABSTAIN)).toBe("AI did not decide");
  });

  test("even a confident recommendation says a person is still needed", () => {
    expect(identityDecision({ looksRight: true, docConfidence: 0.99, faceConfidence: 0.99 }).reason)
      .toMatch(/Still needs a person/);
  });
});

describe("both doors into identity verification", () => {
  const wizard = read("src/routes/caregiveronboarding.js");
  const account = read("src/routes/selfOnboarding.js");

  test.each([["the signup wizard", wizard], ["My Account", account]])(
    "%s writes the decision's status, never a literal 'approved'",
    (_name, src) => {
      expect(src).toMatch(/decision\.status,/);
      expect(src).not.toMatch(/needsHumanReview \? 'pending' : 'approved'/);
    }
  );

  test.each([["the signup wizard", wizard], ["My Account", account]])(
    "%s stores the recommendation beside the document, not in status",
    (_name, src) => {
      expect(src).toMatch(/ai_recommendation, ai_recommendation_reason/);
      expect(src).toMatch(/decision\.verdict,/);
      expect(src).toMatch(/decision\.reason,/);
    }
  );

  test.each([["the signup wizard", wizard], ["My Account", account]])(
    "%s no longer lets the model set is_verified",
    (_name, src) => {
      expect(src).not.toMatch(/isVerified \? 1 : 0/);
    }
  );

  test("the selfie is filed as pending too", () => {
    // It used to be written 'approved' on its own — a second automated verdict nobody asked for.
    expect(wizard).toMatch(/'pending', JSON\.stringify\(\{ linkedIdDocId: docId, faceComparison \}\)/);
  });

  test("nothing in the app gates on the recommendation", () => {
    // A recommendation is not a decision. `status` is the only thing that means anything.
    for (const [, src] of [["w", wizard], ["a", account]]) {
      expect(src).not.toMatch(/ai_recommendation\s*=\s*'recommend_approve'\s*(AND|OR|\))/);
    }
    const identity = read("src/utils/identity.js");
    expect(identity).not.toMatch(/ai_recommendation/);
    expect(identity).toMatch(/doc\.status === "approved"/);
  });
});

describe("the backfill", () => {
  const db = read("src/models/database.js");

  test("IDs the AI approved before today go back in the queue", () => {
    expect(db).toMatch(/id: "024_identity_ai_recommendation"/);
    const m = db.slice(db.indexOf('id: "024_identity_ai_recommendation"'), db.indexOf('id: "024_identity_ai_recommendation"') + 1600);
    expect(m).toMatch(/SET ai_recommendation = 'recommend_approve'/);
    expect(m).toMatch(/status = 'pending'/);
    expect(m).toMatch(/is_verified = 0/);
  });

  test("it does not touch anything a person already decided", () => {
    const m = db.slice(db.indexOf('id: "024_identity_ai_recommendation"'), db.indexOf('id: "024_identity_ai_recommendation"') + 1600);
    expect(m).toMatch(/AND admin_reviewed_by IS NULL/);
  });
});

describe("the notification actually reaches him", () => {
  const push = read("src/routes/push.js");

  test("identity email is opt-OUT, not opt-in", () => {
    // This is the whole answer to "I haven't gotten a doc review notice on anything yet":
    // admin email defaulted to OFF, so unless he had visited a prefs screen he had no reason
    // to visit, the only signal was a push — fire-and-forget, gone the moment it is missed.
    expect(push).toMatch(/const EMAIL_ON_BY_DEFAULT = new Set\(\["identity_submitted"\]\)/);
    expect(push).toMatch(/EMAIL_ON_BY_DEFAULT\.has\(eventType\) \? pref !== false : pref === true/);
  });

  test("he can still turn it off — it is a default, not a rule", () => {
    expect(push).toMatch(/pref !== false/);
  });

  test("everything else keeps the old opt-in default", () => {
    expect(push).toMatch(/: pref === true/);
  });
});
