// ─── Who decides whether a government ID is genuine (v1.105.112) ───
//
// Pete, Aug 19 2026:
//
//   "I want to review everything an AI clears. Below a confidence of, say, 90%, it doesn't
//    even decide...I do."
//
// Until now both verify-id endpoints wrote `status = needsHumanReview ? 'pending' : 'approved'`.
// When the extracted name matched, the document classified as valid, the DOB matched and the
// faces matched, **the AI approved someone's government ID outright and no person was ever
// asked.** Julia's was approved that way. Review was the exception — what happened when the
// model was unsure — not the rule.
//
// That is now inverted, and the inversion is the whole point:
//
//   • The AI NEVER sets `approved`. Every identity document lands as `pending`.
//     An admin grants or rejects it, and that is the only path to approved.
//   • Above the threshold the AI may RECOMMEND, and its recommendation is stored next to the
//     document so the reviewer starts from something rather than nothing.
//   • Below the threshold it does not offer a verdict at all. A low-confidence guess is worse
//     than silence here: it anchors the reviewer on a number the model itself does not stand
//     behind, and the reviewer is the actual decision-maker.
//
// A recommendation is not a decision. Nothing in the app may gate on `aiRecommendation`;
// `status` is the only thing that means anything, and only a human writes it.
//
// ⚠️ This raises the cost of every signup: no caregiver can finish onboarding until a person
// looks. That is the trade Pete chose deliberately, and it is why the notification path had to
// be fixed in the same change — a queue nobody is told about is not review, it is a delay.

/** Above this, the AI may offer a recommendation. Below it, it says nothing. */
const AI_RECOMMENDS_ABOVE = 0.90;

const VERDICT = {
  APPROVE: "recommend_approve",
  REJECT: "recommend_reject",
  ABSTAIN: "abstain",
};

/**
 * What the AI is allowed to say about an identity document.
 *
 * @param {object} signals
 * @param {boolean} signals.looksRight        every check the model ran agreed
 * @param {number}  signals.docConfidence     0..1 — how sure it is of the document classification
 * @param {number}  [signals.faceConfidence]  0..1 — face-match similarity
 * @param {boolean} [signals.faceSkipped]     no comparison was possible
 * @returns {{status: 'pending', verdict: string, confidence: number, reason: string}}
 */
function identityDecision(signals) {
  const doc = Number(signals && signals.docConfidence);
  const face = Number(signals && signals.faceConfidence);
  const faceSkipped = !!(signals && signals.faceSkipped);

  // The confidence the AI is judged on is the WEAKEST link it actually measured, not the
  // strongest. A 97% document read next to a 40% face match is a 40% answer — v1.105.73 was
  // exactly this pair of numbers sitting side by side and being read as agreement.
  const measured = [Number.isFinite(doc) ? doc : null, faceSkipped || !Number.isFinite(face) ? null : face]
    .filter((n) => n !== null);
  const confidence = measured.length ? Math.min(...measured) : 0;

  // ALWAYS pending. There is no branch that returns anything else, deliberately: an admin
  // action is the only thing in this codebase that may write 'approved'.
  if (confidence < AI_RECOMMENDS_ABOVE) {
    return {
      status: "pending",
      verdict: VERDICT.ABSTAIN,
      confidence,
      reason: `Confidence ${Math.round(confidence * 100)}% is below ${Math.round(AI_RECOMMENDS_ABOVE * 100)}% — no automated opinion offered.`,
    };
  }

  return {
    status: "pending",
    verdict: signals.looksRight ? VERDICT.APPROVE : VERDICT.REJECT,
    confidence,
    reason: signals.looksRight
      ? `Every check agreed at ${Math.round(confidence * 100)}% confidence. Still needs a person.`
      : `Confident (${Math.round(confidence * 100)}%) that something does not match. Still needs a person.`,
  };
}

/** How the recommendation should read to the admin doing the review. */
function verdictLabel(verdict) {
  if (verdict === VERDICT.APPROVE) return "AI suggests approving";
  if (verdict === VERDICT.REJECT) return "AI suggests rejecting";
  return "AI did not decide";
}

module.exports = { identityDecision, verdictLabel, AI_RECOMMENDS_ABOVE, VERDICT };
