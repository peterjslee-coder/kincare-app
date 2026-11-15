// ─── When a visit's check-in is "late", and when it needs the family (v1.128.0) ───
//
// Pete, Nov 15 2026, after Tina's Saturday visit with Betty was cancelled at 8:30 while she was
// on her way for 9:00: "I offered her a flexible appointment, which means it was plus or minus
// 30 minutes… it shouldn't have even asked me if I wanted to extend or cancel/etc until 30
// minutes after the appointment start."
//
// Before this, `flex_timing` only capped OVERTIME at check-out. Arrival ignored it: every visit
// was "late" at +10, the family was told at +5, and the no-show poller CANCELLED the visit at
// +30 with nobody asked. Now:
//
//   • the arrival window comes from the visit's own terms — strict 10 min, flexible/open 30;
//   • inside it nobody is alerted and a check-in is not late;
//   • when it runs out the family is ASKED (give her more time / message her / cancel);
//   • a family's "give her more time" moves the deadline (checkin_window_minutes);
//   • nothing is cancelled for a missed check-in until the visit's scheduled END has passed
//     (Pete: "Keep waiting, cancel at end").
//
// All offsets are minutes past the scheduled start, in the care location's wall clock.

const ARRIVAL_WINDOW = { strict: 10, flexible: 30, open: 30 };

/** Minutes after the scheduled start before a check-in counts as late. */
function arrivalWindowMinutes(flexTiming) {
  return ARRIVAL_WINDOW[flexTiming] ?? ARRIVAL_WINDOW.strict;
}

/** The scheduled length of the visit, in minutes. */
function scheduledMinutes(session) {
  const h = parseFloat(session && session.duration_hours);
  return Number.isFinite(h) && h > 0 ? Math.round(h * 60) : 0;
}

/**
 * Minutes past the scheduled start at which the family is asked what to do: the arrival
 * window, or later if the family already gave more time. Never past the scheduled end.
 */
function checkInDeadlineMinutes(session) {
  const base = arrivalWindowMinutes(session && session.flex_timing);
  const ext = parseInt(session && session.checkin_window_minutes, 10);
  const deadline = Number.isFinite(ext) && ext > base ? ext : base;
  const end = scheduledMinutes(session);
  return end > 0 ? Math.min(deadline, end) : deadline;
}

/** Minutes past start at which a never-checked-in visit is finally cancelled as a no-show. */
function noShowCancelMinutes(session) {
  // A visit with no length on record still gets an end: the old fixed 30 minutes.
  return scheduledMinutes(session) || 30;
}

// The choices "give her more time" offers. Kept here so the server can refuse anything else.
const EXTEND_CHOICES = [15, 30, 60];

module.exports = {
  ARRIVAL_WINDOW, EXTEND_CHOICES,
  arrivalWindowMinutes, scheduledMinutes, checkInDeadlineMinutes, noShowCancelMinutes,
};
