// ─── One answer to "has this caregiver verified their identity?" (v1.105.64) ───
//
// There were three ways to submit a selfie + ID, and they filed the result in three
// different places. Nothing reconciled them, so the app could tell one person two
// contradictory things about the same photographs:
//
//   1. The onboarding wizard  → POST /api/caregiver-onboarding/verify-id
//      writes verified_documents with owner_type='caregiver', owner_id=caregiver_profiles.id
//
//   2. My Account             → POST /api/self-onboarding/verify-id
//      writes verified_documents with owner_type='user', owner_id=users.id
//      This is the door most people find. It is labelled "Verify your identity with a
//      selfie and photo ID to earn a blue check", it works, and it stores real documents.
//
//   3. Stripe Identity        → /api/payments/identity/*
//      writes caregiver_profiles.identity_verified.
//
//      ⚠️ v1.105.124 — this used to say "Nothing gates on it." That was FALSE, and the
//      sentence is what hid the bug. `authorizeSessionPayment` gated the money on that
//      exact column, so a caregiver who verified through doors 1 or 2 — the doors people
//      actually use — could never have a payment authorized. Julia hit it on the first
//      real paid visit in the product's life: no PaymentIntent was created, and at
//      check-out there was nothing to capture. That gate now calls the resolver below.
//      If you add a reader of `identity_verified`, it belongs here instead.
//
// The onboarding gate and the admin panel only ever recognised shape 1. The blue check in
// My Account is decided by a fourth rule entirely (`uploaded_by = <you>`, auth.js), which
// BOTH 1 and 2 satisfy. So a caregiver could verify from My Account, be shown a blue check
// confirming it, and simultaneously read "Selfie + ID photo (not submitted)" in the admin
// panel while onboarding stayed blocked forever. Same person, same photos, different
// owner_type.
//
// This resolver is the single answer. It accepts either shape, because both are the person
// genuinely submitting their own government ID, and which endpoint the UI happened to call
// is an implementation detail the caregiver never chose.
//
// It does NOT accept shape 3: no document exists in that flow, so there is nothing for anyone
// to review or keep.
//
// v1.105.70 — an earlier version of this comment claimed identity is "a human-reviewed gate" in
// this codebase. That is not true, and it matters. Both verify-id endpoints write
// `status = needsHumanReview ? 'pending' : 'approved'`: when the extracted name matches, the
// document classifies as valid, the DOB matches and the faces match, the AI approves someone's
// government ID outright and no person is ever asked. Review is the EXCEPTION — what happens
// when the AI is unsure — not the rule. Anything reasoning about this gate should know that.

/**
 * The most recent non-selfie identity document belonging to this caregiver, under either
 * storage shape. Returns null when nothing has been submitted.
 *
 * @returns {Promise<{id: string, status: string, is_verified: number, owner_type: string} | null>}
 */
async function caregiverIdentityDoc(db, userId, profileId) {
  if (!userId && !profileId) return null;
  // Ordered by created_at so the newest submission wins regardless of which door it came
  // through — a caregiver who was rejected in the wizard and re-submitted from My Account
  // must not be judged on the older document.
  const rows = await db.prepare(
    `SELECT id, status, is_verified, owner_type, created_at
       FROM verified_documents
      WHERE category = 'identity'
        AND document_type != 'selfie'
        AND (
          (owner_type = 'caregiver' AND owner_id = ?)
          OR (owner_type = 'user' AND owner_id = ? AND uploaded_by = ?)
        )
      ORDER BY created_at DESC
      LIMIT 1`
  ).all(profileId || null, userId || null, userId || null);
  return rows && rows.length > 0 ? rows[0] : null;
}

/** Convenience: has an ADMIN-APPROVED identity document, under either shape. */
async function caregiverIdentityVerified(db, userId, profileId) {
  const doc = await caregiverIdentityDoc(db, userId, profileId);
  return !!doc && doc.status === "approved";
}

module.exports = { caregiverIdentityDoc, caregiverIdentityVerified };
