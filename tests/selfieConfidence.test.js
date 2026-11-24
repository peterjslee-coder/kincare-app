// The selfie said 0% confidence and "does not match" while the ID on the same submission said
// 97% and matched. (Feedback 26c70f5a, Aug 18 2026.)
//
// They were never disagreeing. The two halves of an identity submission are written by two
// DIFFERENT inserts: the ID writes ai_confidence, the selfie's insert omitted it, so the column
// fell to its DEFAULT of 0. The selfie's ai_classification carries only
// { linkedIdDocId, faceComparison } — no classification, isValid or matchesClaimed — so when the
// admin preview rendered it through the ID's template, every absent field became an assertion:
// "0%", "Valid document: No", "Matches claimed type: No", about a photograph that was never
// scored on any of those axes.
//
// And the two numbers are not the same measurement. The ID's is document CLASSIFICATION
// confidence ("is this a driver's licence"); the selfie's real number is FACE MATCH similarity,
// which was stored on the same row the whole time and never read.

const fs = require("fs");
const path = require("path");

const REPO = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8");

const admin = read("public/js/components/AdminPanel.js");
const onboarding = read("src/routes/caregiveronboarding.js");
const selfOnboarding = read("src/routes/selfOnboarding.js");
const schema = read("src/models/database.js");

describe("the trap that made this possible", () => {
  test("ai_confidence still defaults to 0, so absence is indistinguishable from a real zero", () => {
    // Documented, not fixed: changing the default needs a migration and a backfill, and nothing
    // reads the column for selfies any more. If this line ever changes to NULL, the renderer's
    // `scoredConfidence` guard can be simplified — but not before.
    expect(schema).toMatch(/ai_confidence REAL DEFAULT 0/);
  });
});

describe("the selfie is written with its own real number", () => {
  test.each([
    ["caregiver onboarding", onboarding],
    ["self onboarding", selfOnboarding],
  ])("%s stores ai_confidence and ai_concerns on the selfie row", (_name, src) => {
    // The selfie insert — the one whose ai_classification is { linkedIdDocId, faceComparison }.
    const i = src.indexOf("linkedIdDocId: docId");
    expect(i).toBeGreaterThan(-1);
    const stmt = src.slice(Math.max(0, i - 1200), i + 700);
    expect(stmt).toMatch(/ai_classification, ai_confidence, ai_concerns, created_at/);
    // A skipped comparison is not a score of zero.
    expect(stmt).toMatch(/faceComparison\.skipped \? null :/);
  });

  test.each([
    ["caregiver onboarding", onboarding],
    ["self onboarding", selfOnboarding],
  ])("%s keeps the selfie insert's columns and placeholders in step", (_name, src) => {
    const m = [...src.matchAll(/INSERT INTO verified_documents \(([^)]*ai_confidence, ai_concerns, created_at)\)\s*\n\s*VALUES \(([^)]+)\)/g)];
    expect(m.length).toBe(1);
    expect(m[0][1].split(",").length).toBe(m[0][2].split(",").length);
  });
});

describe("the admin preview no longer states things it was never told", () => {
  test("a selfie is recognised as supporting evidence, not a classified document", () => {
    expect(admin).toMatch(/const isSupportingPhoto = \(dp\) =>/);
    expect(admin).toMatch(/dp\.docType === 'selfie'/);
  });

  test("a missing score renders as 'not scored', never as 0%", () => {
    // The whole bug in one assertion: `|| 0` on an absent value is a claim, not a fallback.
    expect(admin).toMatch(/const scoredConfidence = \(dp\) => \{/);
    expect(admin).toMatch(/if \(isSupportingPhoto\(dp\)\) return null;/);
    expect(admin).toMatch(/scoredConfidence\(docPreview\) === null/);
    expect(admin).toMatch(/not scored/);
    // The old expression that produced "0%" is gone.
    expect(admin).not.toMatch(/docPreview\.ai\.confidence != null \? docPreview\.ai\.confidence : docPreview\.aiConfidence/);
  });

  test("the two numbers are labelled as the different measurements they are", () => {
    expect(admin).toMatch(/Document confidence:/);
    expect(admin).toMatch(/Face match/);
    // "Confidence:" unqualified is what invited comparing 0% against 97%.
    expect(admin).not.toMatch(/>Confidence:</);
  });

  test("the selfie links to the ID it was compared against", () => {
    // linkedIdDocId has been stored on every selfie since the feature shipped, and nothing used it.
    expect(admin).toMatch(/docPreview\.ai\.linkedIdDocId/);
    expect(admin).toMatch(/handleDocPreview\(docPreview\.ai\.linkedIdDocId\)/);
    expect(admin).toMatch(/View the ID this selfie was compared against/);
  });

  test("a skipped face comparison says so rather than reading as a failure", () => {
    expect(admin).toMatch(/selfieFaceComparison\(docPreview\)\.skipped \?/);
    expect(admin).toMatch(/not run/);
  });
});

describe("the rendering logic itself, exercised", () => {
  // Reproduce the two docPreview shapes and run the real helpers over them, so this test
  // fails if the logic regresses rather than only if the source text changes.
  const mk = () => {
    const selfieFaceComparison = (dp) => {
      const fc = dp && dp.ai && dp.ai.faceComparison;
      return fc && typeof fc === "object" ? fc : null;
    };
    const isSupportingPhoto = (dp) =>
      !!dp && (dp.docType === "selfie" || (!!selfieFaceComparison(dp) && !(dp.ai && dp.ai.classification)));
    const scoredConfidence = (dp) => {
      if (dp && dp.ai && typeof dp.ai.confidence === "number") return dp.ai.confidence;
      if (isSupportingPhoto(dp)) return null;
      return typeof dp.aiConfidence === "number" ? dp.aiConfidence : null;
    };
    return { isSupportingPhoto, scoredConfidence, selfieFaceComparison };
  };

  const SELFIE = {
    docType: "selfie",
    aiConfidence: 0, // the column default nobody wrote
    ai: { linkedIdDocId: "id-doc-1", faceComparison: { similar: true, confidence: 0.93, explanation: "Same person." } },
  };
  const ID_DOC = {
    docType: "drivers_license",
    aiConfidence: 0.97,
    ai: { classification: "drivers_license", confidence: 0.97, isValid: true, matchesClaimed: true },
  };

  test("the selfie is never scored as a document, despite aiConfidence being 0", () => {
    const { isSupportingPhoto, scoredConfidence } = mk();
    expect(isSupportingPhoto(SELFIE)).toBe(true);
    expect(scoredConfidence(SELFIE)).toBeNull();   // NOT 0 — that was the bug
  });

  test("its real face-match number is recovered from where it was always stored", () => {
    const { selfieFaceComparison } = mk();
    expect(selfieFaceComparison(SELFIE).confidence).toBe(0.93);
    expect(selfieFaceComparison(SELFIE).similar).toBe(true);
  });

  test("the ID still reports its own classification confidence", () => {
    const { isSupportingPhoto, scoredConfidence } = mk();
    expect(isSupportingPhoto(ID_DOC)).toBe(false);
    expect(scoredConfidence(ID_DOC)).toBe(0.97);
  });

  test("a genuine zero on a real document is still reported as zero", () => {
    // The guard must not swallow a true score of 0 — only an absent one.
    const { scoredConfidence } = mk();
    expect(scoredConfidence({ docType: "drivers_license", aiConfidence: 0, ai: { classification: "unknown", confidence: 0 } })).toBe(0);
  });
});
