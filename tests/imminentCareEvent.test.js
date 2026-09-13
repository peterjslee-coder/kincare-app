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
    expect(dash).toMatch(/className=\{shouldShimmer \? 'next-up-hero-shimmer' : ''\}/);
  });

  test("and that class is the orange one", () => {
    const i = css.indexOf(".next-up-hero-shimmer::after");
    expect(i).toBeGreaterThan(-1);
    expect(css.slice(i, i + 600)).toMatch(/rgba\(232, 114, 74/);
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

describe("I3 — promoted means moved, not copied", () => {
  test("an imminent event is filtered OUT of the Next Up list", () => {
    const i = dash.indexOf("const careEventItems = (careEventsUpcoming?.events || [])");
    expect(i).toBeGreaterThan(-1);
    expect(dash.slice(i, i + 500)).toMatch(/\.filter\(ev => !imminentEventIds\.has\(ev\.id\)\)/);
  });

  test("…matching how the hero session is already de-duplicated", () => {
    expect(dash).toMatch(/s\.id !== imminentId/);
  });

  test("the hero renders every imminent event, capped", () => {
    // Pete's case has BOTH a session and an appointment inside 24h, so this cannot be a
    // single soonest-thing slot.
    // Anchor on CODE: helpers/source.code() strips line-owning comments, so a JSX-comment
    // anchor like "Imminent Care Event Hero" matches nothing and the test passes vacuously.
    const i = dash.indexOf("if (!imminentEventIds.size) return null;");
    expect(i).toBeGreaterThan(-1);
    const block = dash.slice(i, i + 1600);
    expect(block).toMatch(/\.sort\(\(a, b\) => a\.msUntil - b\.msUntil\)/);
    expect(block).toMatch(/\.slice\(0, 3\)/);
    expect(block).toMatch(/CareEventHeroRow/);
  });

  test("it sits above Next Up and below the session hero", () => {
    const sessionHero = dash.indexOf("const shouldShimmer = !isActive && msUntil <= 24 * 3600000;");
    const eventHero = dash.indexOf("if (!imminentEventIds.size) return null;");
    const nextUp = dash.indexOf("const careEventItems = (careEventsUpcoming?.events || [])");
    for (const at of [sessionHero, eventHero, nextUp]) expect(at).toBeGreaterThan(-1);
    expect(eventHero).toBeGreaterThan(sessionHero);
    expect(nextUp).toBeGreaterThan(eventHero);
  });

  test("tapping it opens the event, not a session", () => {
    const at = dash.indexOf("if (!imminentEventIds.size) return null;");
    expect(at).toBeGreaterThan(-1);
    const block = dash.slice(at, at + 1600);
    expect(block).toMatch(/onOpenSheet=\{\(\) => setEventSheet\(ev\)\}/);
  });
});
