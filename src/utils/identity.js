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
 * v1.106.39 — this used to be the THIRD of four answers, and routes/auth.js was the fourth.
 * Pete, about Tina: "Tina is verified. Her id is in, a person reviewed it, and it's in her
 * documents. This shouldn't be asking her again. We went through this with Julia earlier."
 *
 * He is right that we went through it with Julia. v1.105.80 found three faults in the
 * /api/auth/me copy of this lookup and fixed them THERE, in a query written out longhand,
 * and left this resolver — the one every other surface reads — with fault #1 intact:
 *
 *   ORDER BY created_at DESC LIMIT 1, so the NEWEST submission won.
 *
 * Which produces exactly what Tina is seeing. The app tells her to verify her identity; she
 * does it again; the new document sits at 'pending' on top of her APPROVED one; and from
 * then on /api/auth/me says verified (it prefers the approval) while this resolver says
 * pending. Her blue check is on, and her First Steps checklist still asks. An approval is
 * not undone by a later resubmission — only by a rejection.
 *
 * So the order is now approved-first, as auth.js has had since v1.105.80. Revocation still
 * works: the admin toggle rejects the document this resolver returns, and once that row is
 * no longer approved there is nothing for approved-first to prefer.
 *
 * ── Two shapes, and one that was quietly dropped ──
 *
 * The `owner_type='user'` branch used to carry `AND uploaded_by = <the caregiver>`, which
 * the `owner_type='caregiver'` branch never did. So the same government ID counted or did
 * not depending on which door it came through AND who operated the upload — an admin
 * filing a caregiver's ID for her under the user shape produced a real, human-approved
 * document that nothing could see. The OWNER is the subject of the document; who held the
 * phone is not. Dropped.
 *
 * Going the other way, auth.js matched a bare `uploaded_by = <you>` with no owner_type at
 * all, which is a hole, not a feature: a caregiver who uploads a CARE RECIPIENT's ID —
 * something documents.js lets her do — was reading as identity-verified herself. That shape
 * is gone. Net: stricter where it was dangerous, looser only where the subject is right.
 *
 * @param {string[]} extraOwnerIds  additional owner_ids that are also THIS person's own
 *        identity — /api/auth/me passes the care_recipient id of a linked self-onboarding
 *        user, whose ID document is filed against the recipient record.
 * @returns {Promise<{id, status, is_verified, owner_type, created_at} | null>}
 */
async function caregiverIdentityDoc(db, userId, profileId, extraOwnerIds = []) {
  const owners = [
    ...(profileId ? [["caregiver", profileId]] : []),
    ...(userId ? [["user", userId]] : []),
    ...extraOwnerIds.filter(Boolean).map((id) => ["care_recipient", id]),
  ];
  if (owners.length === 0) return null;

  const clause = owners.map(() => "(owner_type = ? AND owner_id = ?)").join(" OR ");
  const params = owners.flat();

  const rows = await db.prepare(
    `SELECT id, status, is_verified, owner_type, created_at
       FROM verified_documents
      WHERE category = 'identity'
        AND document_type != 'selfie'
        AND (${clause})
      ORDER BY (status = 'approved' OR is_verified = 1) DESC, created_at DESC
      LIMIT 1`
  ).all(...params);
  return rows && rows.length > 0 ? rows[0] : null;
}

/** Convenience: has an APPROVED identity document, under any of this person's own shapes. */
async function caregiverIdentityVerified(db, userId, profileId, extraOwnerIds = []) {
  const doc = await caregiverIdentityDoc(db, userId, profileId, extraOwnerIds);
  return !!doc && (doc.status === "approved" || !!doc.is_verified);
}

/**
 * The shape /api/auth/me reports: 'not_started' | 'pending' | 'verified' | 'rejected'.
 * Here rather than in the route, so the blue check and the onboarding checklist cannot
 * describe the same document differently — which is the whole reason this file exists.
 */
async function identityStatusFor(db, userId, profileId, extraOwnerIds = []) {
  const doc = await caregiverIdentityDoc(db, userId, profileId, extraOwnerIds);
  if (!doc) return { identityVerified: false, identityStatus: "not_started" };
  if (doc.status === "approved" || doc.is_verified) {
    return { identityVerified: true, identityStatus: "verified" };
  }
  if (doc.status === "rejected") return { identityVerified: false, identityStatus: "rejected" };
  return { identityVerified: false, identityStatus: "pending" };
}

module.exports = { caregiverIdentityDoc, caregiverIdentityVerified, identityStatusFor };
