// v1.105.33 — "Session countdown shows wrong time remaining. Shows '1 hour plus remaining'
// but appointment ends at noon Eastern." (Pete, Mar 28)
//
// The ticket blamed timezone — the backend fix had just shipped in v1.50.21 and the frontend
// was the obvious suspect. It was not the cause. TimezoneHelper.buildDateTime returns a true
// UTC epoch (it subtracts the zone offset) and realNowMs() is Date.now(), so every comparison
// in these components was already frame-correct.
//
// The cause was the ANCHOR. "Remaining" counted from actual check-in plus the booked hours,
// so arriving late moved the finish line: check in 45 minutes late on a 10–12 visit and at
// 11:45 it reads "1h 15m remaining" — past the noon the family was promised. Pete's call:
// count down to the scheduled end.
//
// Pay is untouched by this. It is computed server-side from real check-in to real check-out
// in 15-minute blocks; this number is a label, not an input to anyone's money.

const { code } = require("./helpers/source");

const dashboard = code("public/js/components/Dashboard.js");
const hub = code("public/js/components/CaretakerHub.js");

describe("the countdown counts down to the scheduled end", () => {
  test("the Dashboard hero card anchors on the scheduled start", () => {
    expect(dashboard).toMatch(/const endMs = sessionDT\.getTime\(\) \+ \(\(hero\.durationHours \|\| 2\) \* 3600000\)/);
  });

  test("the Dashboard session rows anchor on the scheduled start", () => {
    expect(dashboard).toMatch(/const startMs = TimezoneHelper\.buildDateTime\(sDate, s\.time \|\| '00:00', tz\)\.getTime\(\);\s*\n\s*const endMs = startMs \+ \(s\.durationHours \* 3600000\)/);
  });

  test("the caregiver's own in-progress card anchors on the scheduled start", () => {
    expect(hub).toMatch(/const endMs = sessionStartET\.getTime\(\) \+ \(\(duration \|\| 2\) \* 3600000\)/);
  });

  test("no countdown label is computed from checkInTime any more", () => {
    // The regression to catch: someone reinstating `checkInTime ? … : scheduledStart` in a
    // countdown because it reads like the more accurate thing to do. It is not — it is the
    // thing that produced the bug.
    //
    // Counted, not merely absent. Dashboard.js had THREE check-in anchors and keeps exactly
    // one on purpose (the overdue alarm, below), so "does it appear at all" cannot express
    // the property — and a bare .not.toMatch here passed vacuously on the pre-fix source
    // when it was first written, which is precisely the failure this repo keeps relearning.
    const checkInAnchor = /startMs = new Date\((?:s|hero)\.checkInTime\)\.getTime\(\)/g;
    expect((dashboard.match(checkInAnchor) || []).length).toBe(1); // was 3
    expect(hub).not.toMatch(/checkInTime[\s\S]{0,80}const endMs/); // was 1, now 0
  });
});

describe("the overdue alarm is deliberately NOT the same clock", () => {
  test("it still anchors on check-in", () => {
    // A caregiver who arrived late and is working their booked hours is not overdue.
    // Telling a family otherwise is a false alarm about someone's parent — keep this anchor
    // unless Pete says otherwise. The comment above it in Dashboard.js says the same.
    const block = dashboard.slice(
      dashboard.indexOf("let overdueSession = null"),
      dashboard.indexOf("overdueMinutes")
    );
    expect(block).toMatch(/startMs = new Date\(s\.checkInTime\)\.getTime\(\)/);
    expect(block).toMatch(/overdueMs >= 15 \* 60000/);
  });
});

describe("the timezone frame was never the problem — keep it that way", () => {
  test("comparisons use real epochs, not the display-only shifted frame", () => {
    // getNow(tz) re-parses a formatted string in the BROWSER's zone, so its .getTime() is
    // wrong by the viewer's offset. It is safe for getHours()/getMinutes() and nothing else.
    expect(dashboard).not.toMatch(/getNow\([^)]*\)\.getTime\(\)/);
    expect(hub).not.toMatch(/getNow\([^)]*\)\.getTime\(\)/);
  });
});
