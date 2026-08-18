// v1.105.68 — a caregiver sent in her government ID, was told it worked, and nobody was told.
//
// Julia submitted a selfie and photo ID from My Account. It succeeded. And then:
//
//   - no push, no email, no activity-feed entry, nothing in the admin alert counts. NEITHER
//     verify-id endpoint notified anyone at all.
//   - no screen anywhere lists identity documents awaiting review. The only way to find one is
//     to already know whose record to open.
//   - and the record itself could not show it. The onboarding modal's document query read
//     caregiver_documents, which is not where a selfie + ID is stored, and then rendered
//     `d.doc_type` — a field the query never selected. So the list was empty, and would have
//     been blank even if it had been reading the right table.
//
// Three independent silences stacked on the one gate that blocks a caregiver from working. An
// admin's only available action was to press Grant without ever seeing what they approved.

const { code } = require("./helpers/source");

const cgOnboarding = code("src/routes/caregiveronboarding.js");
const selfOnboarding = code("src/routes/selfOnboarding.js");
const overview = code("src/routes/admin/overview.js");
const userFlags = code("src/routes/admin/userFlags.js");
const adminPanel = code("public/js/components/AdminPanel.js");
const app = code("public/js/app.js");

describe("submitting an ID tells someone", () => {
  test("both submission paths notify admins", () => {
    // BOTH, because which endpoint fires depends only on which screen the person happened to
    // find — the wizard or My Account. That is not a distinction they made.
    for (const [label, src] of [["wizard", cgOnboarding], ["My Account", selfOnboarding]]) {
      expect(`${label}: notifies`).toBe(
        /notifyAdmins\("identity_submitted"/.test(src) ? `${label}: notifies` : `${label}: SILENT`
      );
    }
  });

  test("the notice carries what an admin needs to act on it", () => {
    for (const src of [cgOnboarding, selfOnboarding]) {
      expect(src).toMatch(/userId: req\.user\.id, documentId: docId/);
    }
  });

  test("it never blocks or fails the submitter's own result", () => {
    // The person's verification result must not depend on a push succeeding.
    for (const src of [cgOnboarding, selfOnboarding]) {
      expect(src).toMatch(/catch \(e\) \{ console\.error\("\[identity\] admin notify failed:", e\.message\); \}/);
    }
  });

  test("no PHI or document content rides along in the push body", () => {
    // Pete's standing rule: push bodies say what needs attention, never what is in it.
    for (const src of [cgOnboarding, selfOnboarding]) {
      // Scope to the notifyAdmins call itself. A fixed-width window overran into the res.json
      // below it, which legitimately contains extractedName — the test was wrong, not the code.
      const start = src.indexOf('notifyAdmins("identity_submitted"');
      const end = src.indexOf('} catch (e)', start);
      expect(start).toBeGreaterThan(-1);
      expect(end).toBeGreaterThan(start);
      const block = src.slice(start, end);
      expect(block).not.toMatch(/extractedName|extractedDOB|dl_number|ssn/i);
      expect(block).toMatch(/submitted a selfie and photo ID/);
    }
  });
});

describe("there is a count of what is waiting", () => {
  test("pending identity documents are counted in the admin alerts", () => {
    expect(overview).toMatch(/category = 'identity' AND document_type != 'selfie' AND status = 'pending'/);
    expect(overview).toMatch(/pendingIdentity: parseInt\(pendingIdentity\.count\) \|\| 0/);
  });

  test("it is part of the badge total, not just the payload", () => {
    // A count nobody adds up is a count nobody sees.
    expect(overview).toMatch(/pendingIdentity: Math\.max\(0, counts\.pendingIdentity - \(seen\.pendingIdentity \|\| 0\)\)/);
    expect(overview).toMatch(/delta\.newFeedback \+ delta\.safetyFlags \+ delta\.pendingIdentity \+ delta\.checkrAlerts/);
  });

  test("and the badge tooltip names it", () => {
    expect(app).toMatch(/ID verification\$\{adminAlertDetails\.pendingIdentity === 1 \? '' : 's'\} to review/);
  });

  test("selfies are excluded from the count", () => {
    // A selfie is supporting evidence, auto-approved. Counting it would double every review.
    expect(overview).toMatch(/document_type != 'selfie'/);
  });
});

describe("the admin can actually see the document they are approving", () => {
  test("the modal reads the table identity documents live in", () => {
    expect(userFlags).toMatch(/FROM verified_documents/);
    expect(userFlags).toMatch(/owner_type = 'caregiver' AND owner_id = \?/);
    expect(userFlags).toMatch(/owner_type = 'user' AND owner_id = \? AND uploaded_by = \?/);
  });

  test("it still includes the legacy table rather than replacing it", () => {
    expect(userFlags).toMatch(/FROM caregiver_documents WHERE user_id = \?/);
    expect(userFlags).toMatch(/const docs = \[\.\.\.verifiedDocs, \.\.\.legacyDocs\]/);
  });

  test("the id is carried, so a row can be previewed at all", () => {
    // Without the id there is nothing to pass to the preview endpoint.
    expect(userFlags).toMatch(/SELECT id, document_type, category, status, created_at/);
  });

  test("the list no longer reads a field that was never selected", () => {
    // `d.doc_type` rendered blank for every row — the query selects document_type.
    expect(adminPanel).not.toMatch(/documents\.map\(d => d\.doc_type\)/);
    expect(adminPanel).toMatch(/humanizeDocLabel\(d\.document_type\)/);
  });

  test("each document has a View button wired to the preview", () => {
    expect(adminPanel).toMatch(/onClick=\{\(\) => handleDocPreview\(d\.id\)\}/);
  });

  test("an admin-override placeholder is labelled honestly", () => {
    // Granting identity with nothing on file writes a document_type of 'admin_override'. It
    // must not read like a submitted ID.
    expect(adminPanel).toMatch(/admin_override: 'Approved by admin \(no document submitted\)'/);
  });
});

describe("a vouched caregiver can finish onboarding", () => {
  const hub = code("public/js/components/CaretakerHub.js");
  const caregivers = code("src/routes/caregivers.js");

  test("the server accepts a vouch in place of a background check", () => {
    // v1.64.0's rule, and the baseline the client has to match.
    expect(caregivers).toMatch(/cgVouches\.length === 0/);
  });

  test("and so does the client's auto-complete counter", () => {
    // It didn't. So a vouched caregiver could satisfy everything, never reach 6 here, and
    // mark-onboarding-complete was never called — onboarding false forever, unexplained.
    const block = hub.slice(hub.indexOf("const _autoStepCount"), hub.indexOf("].filter(Boolean).length"));
    expect(block).toMatch(/_autoP\.adminVouches \|\| \[\]\)\.length > 0/);
  });

  test("the two agree on what satisfies the background-check step", () => {
    const block = hub.slice(hub.indexOf("const _autoStepCount"), hub.indexOf("].filter(Boolean).length"));
    for (const cond of [/background_check_paid/, /isBackgroundChecked/, /adminVouches/]) {
      expect(block).toMatch(cond);
    }
  });
});
