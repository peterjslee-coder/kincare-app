/**
 * The checks that stand between a caregiver and a job. (v1.106.24)
 *
 * Lifted out of PUT /sessions/:id/claim so the recurring-series claim can enforce exactly the
 * same ones. Two copies of a gate is two places to forget a gate, and these are the gates that
 * decide whether an unvetted person gets into somebody's mother's house.
 *
 * Split in two on purpose, because they answer different questions at different times:
 *
 *   caregiverGate   — about the PERSON. Roles, not your own request, a profile, not paused,
 *                     care preferences set. Runs once, whether she is claiming one visit or
 *                     twelve. The own-request check sits in the middle of it rather than in
 *                     sessionGate because its position relative to the profile checks decides
 *                     which reason she is told, and the original code says so out loud.
 *   sessionGate     — about THIS JOB. Claimable status; background-checked, OR vouched by an
 *                     admin FOR THIS FAMILY. The vouch is family-scoped (v1.64.0), so it has
 *                     to be asked per session, not once.
 *
 * Each returns null when it passes, or { status, error } to be handed straight to res.
 */
const { hasActiveVouch } = require("./vouches");
const { parseTimeToMinutes, formatTimeForDisplay } = require("./timezone");

const CLAIMABLE = ["requested", "open", "pending"];

async function caregiverGate(db, req, session) {
  const roles = req.user.roles || [req.user.role];
  if (!roles.includes("caregiver")) {
    return { status: 403, error: "Only caregivers can claim care requests" };
  }

  // ─── v1.105.90: you cannot accept a request you posted yourself ───
  //
  // Narrower than v1.105.89, which blocked any job for a recipient you are the family for.
  // Pete: "if sara posts a job and i have to take it, I'll take the pay for it. do not
  // prohibit members of the team from also doing things for money if they can't hire
  // someone." What remains is only the incoherent case: paying yourself.
  //
  // It lives here rather than in the dashboard query because hiding the job made the endpoint
  // unreachable through the UI while leaving it open to anything that knew a session id.
  //
  // v1.106.24 — the ORDER is load-bearing and the original code says so: this runs before the
  // profile checks "so the reason given is the real one, not 'set your care preferences'".
  // Extracting the gates moved it below them for one commit; a test pins it now.
  if (session && session.family_user_id === req.user.id) {
    return { status: 403, error: "You can't accept a request you posted yourself." };
  }

  const profile = await db.prepare(`
    SELECT id, background_check_paid, is_background_checked, bg_check_admin_approved,
           stripe_onboard_complete, is_available, care_stoplight, care_preferences, account_paused
    FROM caregiver_profiles WHERE user_id = ?
  `).get(req.user.id);
  if (!profile) return { status: 404, error: "Caregiver profile not found" };

  if (profile.account_paused) {
    return { status: 403, error: "Your account is paused. Contact support for assistance." };
  }

  // v1.64.0 — the Stripe gate is deliberately not enforced here; see the note in sessions.js.
  if (!profile.care_stoplight && !profile.care_preferences) {
    return { status: 403, error: "Please set your care preferences before accepting jobs. Go to Account → Care Preferences." };
  }

  return { profile };
}

async function sessionGate(db, req, session, profile) {
  if (!CLAIMABLE.includes(session.status)) {
    return { status: 400, error: "This session is not available for claiming (status: " + session.status + ")" };
  }

  // Honest background-check gate (v1.64.0):
  //  - a real Checkr result clears the caregiver for any job;
  //  - an admin vouch clears them ONLY for the vouched family's jobs.
  if (!profile.is_background_checked) {
    const vouched = await hasActiveVouch(db, req.user.id, session.family_user_id);
    if (!vouched) {
      return { status: 403, error: "You must complete your background check before accepting care requests. If you have an existing relationship with this family, ask the platform admin to approve you for them." };
    }
  }

  return null;
}

// ─── v1.114.3: one caregiver, one place at a time ───
//
// Pete sent Tina two requests for the same morning and she accepted both — nothing anywhere
// asked whether she was already booked. The family's Request Care form has an overlap
// warning, but it was reading an oldest-first list capped at 100 visits, so for an account
// with history it could not see November at all. A warning on one side is not a rule; this
// is the rule, and it sits in the gate so the single claim, the batch claim and the series
// claim all enforce the same one.
//
// Strict overlap, no travel buffer: back-to-back visits (9–11 then 11–1) are legitimate and
// common for the same recipient. Visits are placed on an absolute minute line so an
// overnight visit that runs past midnight still collides with the next morning.
const BUSY_STATUSES = ["confirmed", "in_progress"];

function dayNumber(dateStr) {
  const [y, m, d] = String(dateStr || "").slice(0, 10).split("-").map(Number);
  return Math.round(Date.UTC(y, (m || 1) - 1, d || 1) / 86400000);
}

function dayString(n) {
  return new Date(n * 86400000).toISOString().slice(0, 10);
}

function visitSpan(s) {
  const start = dayNumber(s.scheduled_date) * 1440 + parseTimeToMinutes(s.scheduled_time);
  const hours = parseFloat(s.duration_hours);
  return [start, start + (Number.isFinite(hours) && hours > 0 ? hours : 2) * 60];
}

function visitsOverlap(a, b) {
  const [as, ae] = visitSpan(a);
  const [bs, be] = visitSpan(b);
  return as < be && bs < ae;
}

function describeVisit(s) {
  const [y, m, d] = String(s.scheduled_date).slice(0, 10).split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", timeZone: "UTC",
  });
  const who = s.recipient_first ? ` with ${s.recipient_first}` : "";
  return `a visit${who} on ${day} at ${formatTimeForDisplay(s.scheduled_time)}`;
}

/**
 * Refuses a claim that would put the caregiver in two visits at once — against what she has
 * already accepted, and against `alsoAccepting` (earlier picks in the same batch).
 */
async function scheduleConflictGate(db, session, profile, alsoAccepting = []) {
  if (!session || !session.scheduled_date || !session.scheduled_time) return null;
  const day = dayNumber(session.scheduled_date);
  const booked = await db.prepare(`
    SELECT cs.id, cs.scheduled_date, cs.scheduled_time, cs.duration_hours,
           cr.first_name AS recipient_first
    FROM care_sessions cs
    LEFT JOIN care_recipients cr ON cr.id = cs.care_recipient_id
    WHERE cs.caregiver_id = ?
      AND cs.status IN (${BUSY_STATUSES.map(() => "?").join(",")})
      AND cs.id <> ?
      AND cs.scheduled_date >= ? AND cs.scheduled_date <= ?
  `).all(profile.id, ...BUSY_STATUSES, session.id, dayString(day - 1), dayString(day + 1));

  const clash = [...booked, ...alsoAccepting.filter((x) => x && x.id !== session.id)]
    .find((other) => visitsOverlap(session, other));
  if (!clash) return null;
  return {
    status: 409,
    error: `You already have ${describeVisit(clash)} that overlaps this one. Ask the family to move one of them before you accept.`,
  };
}

module.exports = { caregiverGate, sessionGate, scheduleConflictGate, visitsOverlap, CLAIMABLE };
