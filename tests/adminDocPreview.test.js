// v1.105.71 — the admin could not see the ID he was being asked to approve.
//
// v1.105.68 put a View button on each of a caregiver's documents. It did nothing. The handler
// ran, the fetch succeeded, setDocPreview updated — and the modal that renders docPreview lived
// inside `{activeTab === 'authorizations' && (...)}`. Clicking View from Admin → People set
// state that nothing on that tab was listening for.
//
// Structurally identical to every other bug in this run: a correct value computed and then
// dropped on the way to a screen. The badge, the doctor report, idVerified, identityStatus —
// and now a government ID.
//
// And even where the modal DID render, it showed only the picture. The AI writes classification,
// confidence, validity, extracted fields and its own concerns — the POA review has displayed all
// of that since it shipped — and the preview endpoint returned two of those fields. So an admin
// reviewing an identity document could not see what the model read off it, how sure it was, or
// what it flagged, while that same model had already approved it outright.

const { code } = require("./helpers/source");

const admin = code("public/js/components/AdminPanel.js");
const verification = code("src/routes/admin/verification.js");

describe("a document opens from wherever it is listed", () => {
  test("the preview modal sits at the same level as the other top-level modals", () => {
    // It used to be indented inside `{activeTab === 'authorizations' && (...)}` — four spaces
    // deeper than its siblings — which is precisely why View did nothing from the People tab.
    // Indentation is the honest signal here: a positional comparison inverts depending on where
    // the block was re-inserted, and got this wrong on the first attempt.
    const raw = require("fs").readFileSync(
      require("path").join(__dirname, "..", "public/js/components/AdminPanel.js"), "utf8"
    );
    const indentOf = (needle) => {
      const line = raw.split("\n").find((l) => l.trim().startsWith(needle));
      expect(`found ${needle}`).toBe(line ? `found ${needle}` : `MISSING ${needle}`);
      return line.length - line.trimStart().length;
    };
    const preview = indentOf("{docPreview && (");
    const onboarding = indentOf("{onboardingModal && (");
    const tabGuard = indentOf("{activeTab === 'authorizations' && (");

    // Same depth as a known top-level modal, and not deeper than the tab guard it used to live in.
    expect(preview).toBe(onboarding);
    expect(preview).toBe(tabGuard);
  });

  test("the error modal moved with it", () => {
    expect(admin).toMatch(/\{docPreviewError && !docPreview && \(/);
  });

  test("closing still revokes the object URL", () => {
    expect(admin).toMatch(/const closeDocPreview = \(\)/);
    expect(admin).toMatch(/URL\.revokeObjectURL\(prev\.blobUrl\)/);
  });
});

describe("the AI's analysis is visible, not just the picture", () => {
  test("the endpoint returns every field the AI writes", () => {
    for (const f of ["extracted_data", "ai_confidence", "ai_concerns", "is_verified", "verified_at", "admin_reviewed_by"]) {
      expect(`documents endpoint returns ${f}`).toBe(
        new RegExp(f).test(verification) ? `documents endpoint returns ${f}` : `MISSING ${f}`
      );
    }
  });

  test("they are carried into the preview state rather than dropped", () => {
    for (const k of ["ai:", "extracted:", "aiConfidence:", "aiConcerns:", "reviewedByHuman:"]) {
      expect(admin).toContain(k);
    }
  });

  test("JSON columns are parsed defensively", () => {
    // ai_classification arrives as a JSON string; a bad parse must not blank the whole preview.
    expect(admin).toMatch(/const parseMaybe = \(v\) => \{/);
    expect(admin).toMatch(/try \{ return JSON\.parse\(v\); \} catch \{ return null; \}/);
  });

  test("the panel shows what the POA review shows", () => {
    for (const label of ["AI Analysis", "Classification:", "Confidence:", "Valid document:", "Matches claimed type:"]) {
      expect(admin).toContain(label);
    }
  });

  test("it shows what was read off the document, and what the AI doubted", () => {
    expect(admin).toContain("Read from the document");
    expect(admin).toContain("What the AI was unsure about");
    expect(admin).toMatch(/const aiExtractedRows = \(dp\)/);
    expect(admin).toMatch(/const aiConcernList = \(dp\)/);
  });

  test("an AI-approved document that no person has checked says so, on the document itself", () => {
    // The badge count tells you there are some. This tells you THIS one is unreviewed, at the
    // moment you are looking at it and deciding.
    expect(admin).toMatch(/!docPreview\.reviewedByHuman && docPreview\.status === 'approved'/);
    expect(admin).toContain("approved by AI ");
    expect(admin).toContain("no person has reviewed it");
  });
});
