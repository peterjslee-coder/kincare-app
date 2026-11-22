// ─── "I accepted this by mistake" (v1.147.0) ───
//
// Pete, 11/22: "we need a way for caregivers who have accepted a job to cancel the job …
// somebody accidentally accepted the job that they can't do." Cancelling always worked (the
// visit goes back to open). What was wrong is that a mis-tap on a visit inside 24 hours counted
// as a LATE cancellation and opened a review of her. Now, for MISTAKE_WINDOW_MINUTES after she
// accepted, her cancel is an undo: no late mark, no review, and the family is told plainly that
// she undid an accidental accept and the visit is open again.
//
// Only HER cancel, only on a visit she accepted herself (caregiver_accepted_at is set by the
// claim paths, never by a family booking her), and never once the visit has started.

const MISTAKE_WINDOW_MINUTES = 30;

// session: a care_sessions row (caregiver_id, caregiver_accepted_at, status)
// cancelledBy: "caregiver" | "family"
// Returns { open, minutesLeft }.
function mistakeWindow(session, cancelledBy, nowMs = Date.now()) {
  const closed = { open: false, minutesLeft: 0 };
  if (!session || cancelledBy !== "caregiver" || !session.caregiver_id) return closed;
  if (session.status === "in_progress" || session.status === "completed") return closed;
  if (!session.caregiver_accepted_at) return closed;
  const acceptedMs = new Date(session.caregiver_accepted_at).getTime();
  if (!Number.isFinite(acceptedMs)) return closed;
  const leftMs = acceptedMs + MISTAKE_WINDOW_MINUTES * 60000 - nowMs;
  if (leftMs <= 0) return closed;
  return { open: true, minutesLeft: Math.max(1, Math.ceil(leftMs / 60000)) };
}

module.exports = { MISTAKE_WINDOW_MINUTES, mistakeWindow };
