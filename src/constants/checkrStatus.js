/**
 * The background-check status vocabulary — one owner. (v1.106.13)
 *
 * Fifteen values are written to caregiver_profiles.checkr_status across checkr.js. Two
 * caregiver-facing screens rendered them, and each enumerated a different subset:
 *
 *   CaretakerHub  handled pending, rejected, consider, processing, disputed → else render nothing.
 *   MyAccount     handled complete, in_progress/processing/invitation_created → else fall through
 *                 to "✓ Payment received" and a fresh Checkr submission form.
 *
 * So a caregiver whose check came back `did_not_pass`, `suspended` or `adverse_action` — having
 * paid — was shown a green tick and an empty form to submit another one. Nothing anywhere told
 * them the outcome. Neither screen was wrong on the states it knew about; both silently funnelled
 * everything else into a default that meant something entirely different.
 *
 * A raw status is a Checkr implementation detail. What a screen actually needs to know is which
 * of a handful of SITUATIONS the caregiver is in, so the server derives that here and the client
 * branches on it. Adding a Checkr status is then one edit in one file, and an unmapped one is
 * loud (see phaseFor) rather than silently rendered as "start a new check".
 */

// Cleared to work.
const CLEARED = ["clear", "consider_approved"];

// Running. Nothing for the caregiver to do but wait.
const IN_PROGRESS = ["initiated", "pending", "processing"];

// Running, but stalled on the caregiver — the invitation is out and unanswered.
const AWAITING_CAREGIVER = ["invitation_sent"];

// A human has to decide. Not a failure, and must never be shown as one.
const UNDER_REVIEW = ["consider", "disputed"];

// An adverse outcome. Work stops and it goes to an admin — Pete, 13 Sep: "if someone fails a
// background check, they don't get jobs, they don't get an invitation to do anything until I am
// in the loop and have reviewed their check."
//
// Named for what it IS rather than what it looks like. These are not a decision the platform has
// made and must never be reported to the caregiver as one: pre_adverse_action in particular is
// the START of a notice period, not the end of it. The phase means "stopped, pending a human",
// and the copy on both screens says exactly that and nothing more.
const BLOCKED_PENDING_REVIEW = ["did_not_pass", "rejected", "adverse_action", "suspended"];

// Ended without a result — nothing was decided, so starting again is just finishing what was
// begun. This list is ALSO the allow-list POST /api/checkr/initiate uses to decide whether a
// caregiver may re-run their own check, which is why 'rejected' and 'did_not_pass' are not in
// it: an adverse outcome waits for an admin.
const RESTARTABLE = ["canceled", "invitation_canceled", "invitation_expired"];

const PHASE = {
  CLEARED: "cleared",
  IN_PROGRESS: "in_progress",
  AWAITING_CAREGIVER: "awaiting_caregiver",
  UNDER_REVIEW: "under_review",
  BLOCKED_PENDING_REVIEW: "blocked_pending_review",
  RESTARTABLE: "restartable",
  NOT_STARTED: "not_started",
  // A status this file has not been taught. Deliberately NOT folded into not_started: the
  // whole bug was an unknown value inheriting the "start a check" branch. Unknown means
  // "we do not know, so say nothing about the outcome and point at a human".
  UNKNOWN: "unknown",
};

const ALL_STATUSES = [
  ...CLEARED, ...IN_PROGRESS, ...AWAITING_CAREGIVER,
  ...UNDER_REVIEW, ...BLOCKED_PENDING_REVIEW, ...RESTARTABLE,
];

const _byStatus = new Map();
for (const s of CLEARED) _byStatus.set(s, PHASE.CLEARED);
for (const s of IN_PROGRESS) _byStatus.set(s, PHASE.IN_PROGRESS);
for (const s of AWAITING_CAREGIVER) _byStatus.set(s, PHASE.AWAITING_CAREGIVER);
for (const s of UNDER_REVIEW) _byStatus.set(s, PHASE.UNDER_REVIEW);
for (const s of BLOCKED_PENDING_REVIEW) _byStatus.set(s, PHASE.BLOCKED_PENDING_REVIEW);
for (const s of RESTARTABLE) _byStatus.set(s, PHASE.RESTARTABLE);

/**
 * @param {string|null} status  the stored checkr_status
 * @param {boolean} isCleared   caregiver_profiles.is_background_checked
 */
function phaseFor(status, isCleared) {
  // The cleared flag is the one the rest of the platform gates work on, so it wins outright.
  if (isCleared) return PHASE.CLEARED;
  if (!status) return PHASE.NOT_STARTED;
  return _byStatus.get(status) || PHASE.UNKNOWN;
}

/** Is this a phase where offering "start a background check" is the correct action? */
function mayStart(phase) {
  return phase === PHASE.NOT_STARTED || phase === PHASE.RESTARTABLE;
}

module.exports = {
  PHASE, ALL_STATUSES, phaseFor, mayStart,
  CLEARED, IN_PROGRESS, AWAITING_CAREGIVER, UNDER_REVIEW, BLOCKED_PENDING_REVIEW, RESTARTABLE,
};
