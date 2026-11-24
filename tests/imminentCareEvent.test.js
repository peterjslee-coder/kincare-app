/**
 * v1.106.17 — an appointment inside 24 hours gets the same promotion a session does.
 *
 * Pete, 13 Sep: "the appointment with Dr. Lambert that's inside of 24 hours should also be
 * above [the recipient] card like the appointment with Tina is... it needs the orange shimmer
 * effect above her name so that it stands out that it's tomorrow, not just an upcoming task."
 *
 * A session inside 24h has been promoted out of Next Up into a hero card since the hero
 * existed: bigger, bordered, counted down, `next-up-hero-shimmer`. A care event never was. It
 * rendered as a dashed-outline row in the chronological list whatever its time, so a doctor's
 * appointment tomorrow looked identical to one a fortnight out.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || "imminent-event-secret";

const { code, raw } = require("./helpers/source");

const dash = code("public/js/components/Dashboard.js");
const events = code("public/js/components/CareEvents.js");
const css = raw("public/css/styles.css");
const spine = code("public/js/components/ComingUpSpine.js");

describe("I1 — the event hero exists and wears the same shimmer", () => {
  test("CareEventHeroRow is defined and exported to the bundle", () => {
    expect(events).toMatch(/const CareEventHeroRow = window\.CareEventHeroRow =/);
  });

  test("it uses the SAME class as the session hero, not a new one", () => {
    // One meaning per shimmer on this screen: "inside a day". A second class would let the
    // two drift apart visually and stop reading as the same signal.
    const i = events.indexOf("const CareEventHeroRow");
    const fn = events.slice(i, i + 3000);
    expect(fn).toMatch(/className="next-up-hero-shimmer"/);
    // v1.126.0 — the session hero and the event heroes are now one card, the Coming Up spine,
    // and it wears the same class.
    expect(spine).toMatch(/className="next-up-hero-shimmer"/);
  });

  test("and that class is the orange one", () => {
    const i = css.indexOf(".next-up-hero-shimmer::after");
    expect(i).toBeGreaterThan(-1);
    expect(css.slice(i, i + 600)).toMatch(/rgba\(232, 114, 74/);
  });

  test("the title wraps instead of truncating — the hero exists to be readable at a glance", () => {
    // On a 375px phone the list row's single-line ellipsis renders "Appointment with Dr.
    // Lambert" as "Appointment with Dr. Lamb…", losing the word that says whose it is.
    const fn = events.slice(events.indexOf("const CareEventHeroRow"), events.indexOf("const CareEventHeroRow") + 3800);
    const title = fn.slice(fn.indexOf("{ev.title}") - 400, fn.indexOf("{ev.title}"));
    expect(title).toMatch(/WebkitLineClamp: 2/);
    expect(title).not.toMatch(/whiteSpace: 'nowrap'/);
  });

  test("it carries the hero's visual weight, not a list row's", () => {
    const fn = events.slice(events.indexOf("const CareEventHeroRow"), events.indexOf("const CareEventHeroRow") + 3000);
    expect(fn).toMatch(/border: `3px solid/);        // list rows are 2px, and dashed
    expect(fn).not.toMatch(/dashed/);
    expect(fn).toMatch(/position: 'relative', overflow: 'hidden'/);   // the shimmer needs both
  });
});

describe("I2 — what counts as imminent", () => {
  const memo = dash.slice(dash.indexOf("const imminentEventIds = useMemo"), dash.indexOf("const imminentEventIds = useMemo") + 1800);

  test("the same 24h window the session hero uses", () => {
    expect(memo).toMatch(/msUntil <= 24 \* 3600000/);
    expect(dash).toMatch(/if \(!isActive && msUntil > 24 \* 3600000\)/);   // the session hero's
  });

  test("something that started an hour ago is still on screen; older is not", () => {
    expect(memo).toMatch(/msUntil > -60 \* 60000/);
  });

  test("an all-day event is anchored at the start of its day", () => {
    // Otherwise it has no time to compare and would either never qualify or always would.
    expect(memo).toMatch(/ev\.event_time \|\| '00:00'/);
  });

  test("it is computed once and shared, so the hero and the list cannot disagree", () => {
    // The bug this prevents is the appointment appearing twice.
    expect((dash.match(/const imminentEventIds = useMemo/g) || []).length).toBe(1);
    expect(dash).toMatch(/imminentEventIds\.has\(ev\.id\)/);
  });
});

describe("I2b — the label says the thing Pete asked it to say", () => {
  const fn = events.slice(events.indexOf("const CareEventHeroRow"), events.indexOf("const CareEventHeroRow") + 3500);

  test("tomorrow reads 'Tomorrow', not an hour count", () => {
    // "In 20h 0m" is the same fact and lands as noise — you have to do arithmetic to learn the
    // one thing you wanted. Pete: "so that it stands out that it's tomorrow".
    expect(fn).toMatch(/days === 1\) lead = 'Tomorrow'/);
    expect(fn).not.toMatch(/lead = `In \$\{hrs\}h \$\{mins\}m`/);
  });

  test("the hour only matters once it's today, and the minute inside the hour", () => {
    expect(fn).toMatch(/days <= 0/);
    expect(fn).toMatch(/Today · in \$\{hrs\}h/);
    expect(fn).toMatch(/withinAnHour\) lead = `In \$\{Math\.max\(1,/);
  });

  test("the day comes from the same helper the line beneath it uses", () => {
    // Otherwise the badge could say Tomorrow while the detail line says a date, or vice versa.
    expect(fn).toMatch(/TimezoneHelper\.getDaysUntil\(ev\.event_date, tz\)/);
    expect(events).toMatch(/const careEventWhen = \(ev, tz\) => \{[\s\S]{0,200}getDateLabel/);
  });

  test("getDaysUntil is really exported — a typo here would silently kill the label", () => {
    const tzsrc = code("public/js/components/TimezoneHelper.js");
    expect(tzsrc).toMatch(/function getDaysUntil\(dateStr, tz\)/);
    expect(tzsrc).toMatch(/^\s*getDaysUntil,$/m);
  });
});

describe("I3 — promoted means moved, not copied", () => {
  test("an imminent event is filtered OUT of the Next Up list", () => {
    const i = dash.indexOf("const careEventItems = (careEventsUpcoming?.events || [])");
    expect(i).toBeGreaterThan(-1);
    expect(dash.slice(i, i + 500)).toMatch(/\.filter\(ev => !imminentEventIds\.has\(ev\.id\)\)/);
  });

  test("…matching how the hero session is already de-duplicated", () => {
    expect(dash).toMatch(/s\.id !== imminentId/);
  });

  test("the spine renders every imminent event, uncapped", () => {
    // Pete's case has BOTH a session and appointments inside 24h, so this cannot be a single
    // soonest-thing slot. And no cap: Next Up drops every imminent event, so anything sliced
    // off here would vanish from Home (the old three-hero slice did exactly that).
    const i = dash.indexOf(".filter(ev => imminentEventIds.has(ev.id))");
    expect(i).toBeGreaterThan(-1);
    const block = dash.slice(i, i + 1200);
    expect(block).toMatch(/\.sort\(\(a, b\) => a\.startMs - b\.startMs\)/);
    expect(block).not.toMatch(/\.slice\(0,/);
    expect(block).toMatch(/<ComingUpSpine hero=\{heroInfo\} events=\{eventRows\}/);
  });

  test("it sits above Next Up, one card for the visit and the appointments", () => {
    const spineAt = dash.indexOf("<ComingUpSpine");
    const nextUp = dash.indexOf("const careEventItems = (careEventsUpcoming?.events || [])");
    for (const at of [spineAt, nextUp]) expect(at).toBeGreaterThan(-1);
    expect(nextUp).toBeGreaterThan(spineAt);
    // The old separate heroes are gone — two cards for one day is what Pete asked to end.
    expect(dash).not.toMatch(/<CareEventHeroRow/);
    expect(dash.match(/<ComingUpSpine/g)).toHaveLength(1);
  });

  test("tapping a row opens the event or the visit, each its own", () => {
    const at = dash.indexOf("<ComingUpSpine");
    const block = dash.slice(at, at + 400);
    expect(block).toMatch(/onOpenEvent=\{\(ev\) => setEventSheet\(ev\)\}/);
    expect(block).toMatch(/onOpenVisit=\{\(id\) => id && setVisitDetailSessionId\(id\)\}/);
    expect(spine).toMatch(/onClick=\{\(\) => onOpenEvent && onOpenEvent\(ev\)\}/);
    expect(spine).toMatch(/onClick=\{\(\) => onOpenVisit && onOpenVisit\(hero\.id\)\}/);
  });

  test("the line is solid only inside the visit window", () => {
    // The whole point of the design: solid = while the caregiver is there, dashed = not.
    expect(spine).toMatch(/const segIn = \(a, b\) => !!hero && a\.ms >= hero\.startMs && b\.ms <= hero\.endMs;/);
    expect(spine).toMatch(/2px dashed var\(--border-color\)/);
  });

  test("the spine is in the bundle, after CareEvents (it uses careEventIcon)", () => {
    const build = raw("scripts/build-client.js");
    const ce = build.indexOf('"js/components/CareEvents.js"');
    const sp = build.indexOf('"js/components/ComingUpSpine.js"');
    const db = build.indexOf('"js/components/Dashboard.js"');
    expect(ce).toBeGreaterThan(-1);
    expect(sp).toBeGreaterThan(ce);
    expect(db).toBeGreaterThan(sp);
  });
});
