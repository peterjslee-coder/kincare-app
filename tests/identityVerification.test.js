// v1.105.64 — three doors to identity verification, one of which counted.
//
// A caregiver could take a selfie and a photo of their driving licence in My Account, watch
// it succeed, see the blue check appear confirming it — and simultaneously read
// "Selfie + ID photo (not submitted)" in the admin panel, with onboarding blocked forever
// and nothing anywhere telling them why. Same person, same photographs, filed under a
// different owner_type.
//
//   wizard      POST /api/caregiver-onboarding/verify-id → owner_type='caregiver', owner_id=profile.id
//   My Account  POST /api/self-onboarding/verify-id      → owner_type='user',      owner_id=user.id
//   Stripe      /api/payments/identity/*                 → caregiver_profiles.identity_verified
//
// The onboarding gate and the admin panel recognised only the first. The blue check is
// decided by a fourth rule (`uploaded_by = you`) that both of the first two satisfy — which
// is exactly how the app came to tell one person two contradictory things.
//
// And the caregiver had no step for any of it: `idVerified` was computed in CaretakerHub
// from the Stripe system — the one nothing gates on — and then never rendered.

const { code } = require("./helpers/source");
const { caregiverIdentityDoc, caregiverIdentityVerified } = require("../src/utils/identity");

const hub = code("public/js/components/CaretakerHub.js");
const caregivers = code("src/routes/caregivers.js");
const userFlags = code("src/routes/admin/userFlags.js");
const cgOnboarding = code("src/routes/caregiveronboarding.js");

/** A db double that records the SQL and params it was handed, and replays fixed rows. */
function fakeDb(rows = []) {
  const seen = [];
  return {
    seen,
    prepare(sql) {
      return { all: async (...params) => { seen.push({ sql, params }); return rows; } };
    },
  };
}

describe("one answer to 'has this caregiver verified their identity'", () => {
  test("it looks for BOTH storage shapes in a single query", async () => {
    const db = fakeDb([]);
    await caregiverIdentityDoc(db, "user-1", "profile-1");
    expect(db.seen).toHaveLength(1);
    const { sql, params } = db.seen[0];
    // The wizard's shape...
    expect(sql).toMatch(/owner_type = 'caregiver' AND owner_id = \?/);
    // ...and My Account's, pinned to the person who uploaded it so one user's document can
    // never satisfy another user's gate.
    expect(sql).toMatch(/owner_type = 'user' AND owner_id = \? AND uploaded_by = \?/);
    expect(params).toEqual(["profile-1", "user-1", "user-1"]);
  });

  test("selfies never count as the identity document", async () => {
    const db = fakeDb([]);
    await caregiverIdentityDoc(db, "user-1", "profile-1");
    expect(db.seen[0].sql).toMatch(/document_type != 'selfie'/);
    expect(db.seen[0].sql).toMatch(/category = 'identity'/);
  });

  test("the newest submission wins, whichever door it came through", async () => {
    // A caregiver rejected in the wizard who re-submits from My Account must be judged on
    // the new document, not the old one.
    const db = fakeDb([]);
    await caregiverIdentityDoc(db, "user-1", "profile-1");
    expect(db.seen[0].sql).toMatch(/ORDER BY created_at DESC/);
    expect(db.seen[0].sql).toMatch(/LIMIT 1/);
  });

  test("nothing submitted is null, not a throw", async () => {
    expect(await caregiverIdentityDoc(fakeDb([]), "user-1", "profile-1")).toBeNull();
    expect(await caregiverIdentityDoc(fakeDb([]), null, null)).toBeNull();
  });

  test("only an APPROVED document counts as verified", async () => {
    // Identity is a human-reviewed gate in this codebase. Submitted is not approved.
    const approved = fakeDb([{ id: "d1", status: "approved", is_verified: 1 }]);
    const pending = fakeDb([{ id: "d1", status: "pending", is_verified: 0 }]);
    const rejected = fakeDb([{ id: "d1", status: "rejected", is_verified: 0 }]);
    expect(await caregiverIdentityVerified(approved, "u", "p")).toBe(true);
    expect(await caregiverIdentityVerified(pending, "u", "p")).toBe(false);
    expect(await caregiverIdentityVerified(rejected, "u", "p")).toBe(false);
    expect(await caregiverIdentityVerified(fakeDb([]), "u", "p")).toBe(false);
  });
});

describe("every reader agrees, so the app cannot contradict itself", () => {
  const readers = [
    ["the onboarding gate", caregivers],
    ["the admin panel", userFlags],
    ["the caregiver's own status endpoint", cgOnboarding],
  ];

  test("all three resolve through the shared helper", () => {
    for (const [label, src] of readers) {
      expect(`${label}: uses caregiverIdentityDoc`).toBe(
        /caregiverIdentityDoc\(db,/.test(src) ? `${label}: uses caregiverIdentityDoc` : `${label}: DOES NOT`
      );
    }
  });

  test("none of them still hardcodes the caregiver-only lookup", () => {
    // The exact query that made a My Account submission invisible.
    for (const [label, src] of readers) {
      const hardcoded = /owner_type = 'caregiver' AND category = 'identity'/.test(src);
      expect(`${label}: hardcoded caregiver-only query present = ${hardcoded}`).toBe(
        `${label}: hardcoded caregiver-only query present = false`
      );
    }
  });

  test("the admin's Grant approves the document they really submitted", () => {
    // This used to miss a My Account submission and quietly write an admin_override
    // placeholder beside it, leaving a real unreviewed ID sitting in the table.
    const start = userFlags.indexOf("if (identityVerified !== undefined)");
    const end = userFlags.indexOf("if (backgroundCheckCleared !== undefined)", start + 1);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(userFlags.slice(start, end)).toMatch(/caregiverIdentityDoc\(db, req\.params\.id, profile\.id\)/);
  });
});

describe("the caregiver can finally see the gate they are stuck behind", () => {
  test("identity is a First Step", () => {
    // v1.105.112 — the label softened from "Verify your identity" to "A photo of your
    // licence". Pete: "way better than 'VERIFY YOUR IDENTITY!'". The id is the invariant;
    // the wording is meant to keep improving.
    expect(hub).toMatch(/id: 'identity',/);
    expect(hub).toMatch(/label: 'A photo of your licence'/);
  });

  test("the step is driven by the system that actually gates", () => {
    // Not /api/payments/identity/status — that is Stripe Identity, which nothing gates on.
    expect(hub).toMatch(/apiFetch\('\/api\/caregiver-onboarding\/identity-status'\)/);
    expect(hub).not.toMatch(/apiFetch\('\/api\/payments\/identity\/status'\)[\s\S]{0,200}setIdVerification\(d\)/);
  });

  test("the computed value is no longer thrown away", () => {
    // `idVerified` was assigned and referenced nowhere — the discarded-result pattern, on the
    // single hardest gate in caregiver onboarding.
    expect(hub).toMatch(/const idApproved = !!idVerification\.verified/);
    const uses = (hub.match(/\bidApproved\b/g) || []).length;
    expect(uses).toBeGreaterThan(1);
    const submittedUses = (hub.match(/\bidSubmitted\b/g) || []).length;
    expect(submittedUses).toBeGreaterThan(1);
  });

  test("tapping it goes somewhere a caregiver can actually submit from", () => {
    // The wizard is behind them; My Account's profile tab is the one reachable capture UI.
    const nav = hub.slice(hub.indexOf("if (s.id === 'identity')"));
    expect(nav.slice(0, 200)).toMatch(/__accountTab = 'profile'/);
    expect(nav.slice(0, 200)).toMatch(/__navigateTo\('account'\)/);
  });

  test("a failed status check says so instead of reading as 'not submitted'", () => {
    // Otherwise this step becomes the very thing this whole sweep is about: a load failure
    // that renders as a task the user hasn't done.
    expect(hub).toMatch(/loadFailed: true/);
    expect(hub).toMatch(/Couldn’t check your verification status/);
  });

  test("waiting on review does not read as an unfinished chore", () => {
    // v1.105.112 — same property, softer words, and now actually VISIBLE. The message was
    // rendered under `s.done && s.warning`, but this warning is only ever set when the
    // document is submitted and NOT approved — i.e. when done is false. So it had never once
    // appeared on anyone's screen. See tests/threeStateChecklist.test.js.
    expect(hub).toMatch(/review it and reach out if we have any questions/);
    expect(hub).toMatch(/Nothing else for you to do/);
  });

  test("and it is not gated behind the step being done", () => {
    expect(hub).toMatch(/\{!s\.unknown && s\.warning && \(/);
  });
});
