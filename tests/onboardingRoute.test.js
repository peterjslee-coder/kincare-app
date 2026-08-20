// The route is one list, told once. (v1.105.114)
//
// Onboarding has been rebuilt at least twice and the "quest" feeling came back each time,
// because each rebuild fixed the screen in front of it. These tests are aimed at the SHAPE, so
// that the next rebuild inherits the decision instead of the feeling:
//
//   - one item per job, and no job counted twice across the two surfaces
//   - the length is a constant, so nothing can appear after she starts (property 4)
//   - an unknown answer never renders as a negative one (the v1.105.112 rule)
//   - work that is sitting with US is never counted as work left for HER
//
// public/js is a concatenated window-global bundle with no module system, so we run the file
// against a fake `window` rather than requiring it — same trick as calendarHours.test.js.

const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(
  path.join(__dirname, "..", "public", "js", "onboardingRoute.js"), "utf8");
const w = {};
new Function("window", src)(w);
const { ONBOARDING_ROUTE, ONBOARDING_LEGS, ONBOARDING_ROUTE_LENGTH, routeItemState, resolveRoute } = w;

// A caregiver who has just finished the wizard and is standing on her dashboard. Her ID is
// submitted and sitting with us, which since v1.105.112 is what EVERY caregiver's dashboard
// looks like on day one. Most tests vary one fact off this.
const onDashboard = (over = {}) => Object.assign({
  surface: "hub",
  profileCreated: true,
  identity: { loaded: true, submitted: true, approved: false, status: "pending" },
  stripe: { status: "none", connected: false },
  backgroundCheck: {},
}, over);

describe("one route, told once", () => {
  test("13 items — the 16 on screen were never 16 jobs", () => {
    expect(ONBOARDING_ROUTE).toHaveLength(13);
    expect(ONBOARDING_ROUTE_LENGTH).toBe(13);
  });

  test("nothing appears after she starts: the length does not depend on the facts", () => {
    // Property 4. Whatever we know or do not know about her, the route is the same length —
    // items change STATE, they never arrive.
    const shapes = [
      {}, onDashboard(), { surface: "wizard", step: 1 }, { surface: "wizard", step: 9 },
      onDashboard({ backgroundCheck: { override: true } }),
      onDashboard({ identity: { loaded: false } }),
    ].map((f) => resolveRoute(f).items.length);
    expect(new Set(shapes)).toEqual(new Set([13]));
  });

  test("no job is listed twice", () => {
    const ids = ONBOARDING_ROUTE.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("every item is owned by exactly one leg, and every leg exists", () => {
    const legIds = new Set(ONBOARDING_LEGS.map((l) => l.id));
    for (const item of ONBOARDING_ROUTE) expect(legIds.has(item.leg)).toBe(true);
    for (const leg of ONBOARDING_LEGS) {
      expect(ONBOARDING_ROUTE.some((i) => i.leg === leg.id)).toBe(true);
    }
  });

  test("identity and the safety check appear once each, not once per surface", () => {
    // This is the duplication that made her count sixteen things for thirteen jobs.
    expect(ONBOARDING_ROUTE.filter((i) => i.id === "identity")).toHaveLength(1);
    expect(ONBOARDING_ROUTE.filter((i) => i.id === "background-check")).toHaveLength(1);
  });

  test("the review screen is not a job", () => {
    expect(ONBOARDING_ROUTE.some((i) => i.wizardStep === 9)).toBe(false);
  });

  test("a wizard screen maps to at most one item", () => {
    const steps = ONBOARDING_ROUTE.map((i) => i.wizardStep).filter((s) => s !== null);
    expect(new Set(steps).size).toBe(steps.length);
  });
});

describe("an unknown answer is not a negative one", () => {
  test("Stripe: status null means we have not asked, not 'not connected'", () => {
    // v1.105.75 — this exact confusion told caregivers who were already being paid to go and
    // connect a bank account.
    expect(routeItemState("stripe", onDashboard({ stripe: { status: null } }))).toBe("unknown");
    expect(routeItemState("stripe", onDashboard({ stripe: {} }))).toBe("unknown");
    expect(routeItemState("stripe", onDashboard({ stripe: { status: "none" } }))).toBe("todo");
  });

  test("identity: not loaded is unknown, even though `approved` is false", () => {
    // The bug Pete quoted. `approved` is false during the fetch; asking about it first is what
    // made a finished step draw as an unfinished one.
    expect(routeItemState("identity", onDashboard({
      identity: { loaded: false, submitted: true, approved: false },
    }))).toBe("unknown");
  });

  test("a failed lookup is also unknown — a broken fetch is not a missing document", () => {
    expect(routeItemState("identity", onDashboard({
      identity: { loaded: true, loadFailed: true, approved: false },
    }))).toBe("unknown");
  });

  test("the route says so: unresolved until every row has an answer", () => {
    expect(resolveRoute(onDashboard({ identity: { loaded: false } })).resolved).toBe(false);
    expect(resolveRoute(onDashboard()).resolved).toBe(true);
  });

  test("an unknown row is never the open step", () => {
    // Property 3 plus the v1.105.112 rule: we do not open a step we cannot describe.
    const r = resolveRoute(onDashboard({ stripe: { status: null } }));
    expect(r.current && r.current.id).not.toBe("stripe");
  });
});

describe("waiting on us is not work left for her", () => {
  test("a submitted ID is waiting, not to-do", () => {
    // Since v1.105.112 this is the NORMAL case: nobody finishes until a human looks.
    expect(routeItemState("identity", onDashboard({
      identity: { loaded: true, submitted: true, approved: false, status: "pending" },
    }))).toBe("waiting");
  });

  test("an approved ID is done, and a rejected one is hers again", () => {
    expect(routeItemState("identity", onDashboard({
      identity: { loaded: true, submitted: true, approved: true },
    }))).toBe("done");
    expect(routeItemState("identity", onDashboard({
      identity: { loaded: true, submitted: true, approved: false, status: "rejected" },
    }))).toBe("todo");
  });

  test("a processing background check is waiting; one that needs her is not", () => {
    const bg = (o) => routeItemState("background-check", onDashboard({ backgroundCheck: o }));
    expect(bg({ submitted: true, checkrStatus: "processing" })).toBe("waiting");
    expect(bg({ submitted: true, checkrStatus: "consider" })).toBe("todo");
    expect(bg({ submitted: true, checkrStatus: "disputed" })).toBe("todo");
    expect(bg({ passed: true })).toBe("done");
  });

  test("`remaining` excludes anything sitting with us", () => {
    // "How much is left?" has to mean "left for you", or the answer is a lie in the direction
    // that makes it feel endless.
    const r = resolveRoute(onDashboard({
      identity: { loaded: true, submitted: true, approved: false },
      backgroundCheck: { submitted: true, checkrStatus: "processing" },
    }));
    expect(r.waiting).toBe(2);
    expect(r.items.filter((i) => i.state === "todo").map((i) => i.id)).not.toContain("identity");
    expect(r.remaining).toBe(r.items.filter((i) => i.state === "todo").length);
  });

  test("an admin vouch satisfies the safety check, and it stays on the route", () => {
    // Julia. A pre-satisfied item renders ticked; it never disappears, because a route that
    // silently drops an item is a route that changed after she started.
    const r = resolveRoute(onDashboard({ backgroundCheck: { override: true } }));
    expect(r.items.find((i) => i.id === "background-check").state).toBe("done");
    expect(r.items).toHaveLength(13);
  });
});

describe("the path has an order", () => {
  test("the safety check is blocked until pay is set up, not merely undone", () => {
    // Today this surfaces as "Complete Stripe setup first" printed on an item she is being
    // told to do. On a path it is just the next bend, not a contradiction.
    const r = resolveRoute(onDashboard());
    const bg = r.items.find((i) => i.id === "background-check");
    expect(bg.blocked).toBe(true);
    expect(bg.blockedBy).toEqual(["stripe"]);
    expect(r.current.id).toBe("stripe");
  });

  test("connecting Stripe unblocks it and moves the open step along", () => {
    const r = resolveRoute(onDashboard({ stripe: { status: "active", connected: true } }));
    expect(r.items.find((i) => i.id === "background-check").blocked).toBe(false);
    expect(r.current.id).toBe("background-check");
  });

  test("exactly one step is open", () => {
    const r = resolveRoute(onDashboard());
    expect(r.current).not.toBeNull();
    expect(ONBOARDING_ROUTE.filter((i) => i.id === r.current.id)).toHaveLength(1);
  });
});

describe("the count only ever goes down", () => {
  test("walking the wizard never increases what is left", () => {
    // Property 1, stated as arithmetic. This is the sentence a caregiver actually feels.
    let previous = Infinity;
    for (let step = 1; step <= 9; step++) {
      const r = resolveRoute({
        surface: "wizard", step,
        identity: { loaded: true, submitted: step > 8 },
        stripe: { status: "none" }, backgroundCheck: {},
      });
      expect(r.remaining).toBeLessThanOrEqual(previous);
      previous = r.remaining;
    }
  });

  test("finished wizard legs stay on the route once she is on the dashboard", () => {
    // Property 2: finished steps shrink, they do not vanish. This is what stops "I have to
    // remember what I already did."
    const r = resolveRoute(onDashboard());
    const wizardLegs = r.legs.filter((l) => l.surface === "wizard");
    expect(wizardLegs).toHaveLength(2);
    for (const leg of wizardLegs) expect(leg.items.length).toBeGreaterThan(0);
    expect(r.done).toBeGreaterThan(0);
  });

  test("she can see the end from the beginning", () => {
    const atTheStart = resolveRoute({ surface: "wizard", step: 1, stripe: {}, backgroundCheck: {} });
    expect(atTheStart.items).toHaveLength(13);
    expect(atTheStart.legs).toHaveLength(3);
  });
});

describe("copy", () => {
  test("no shouting on the route", () => {
    for (const item of ONBOARDING_ROUTE) {
      expect(item.label).not.toMatch(/!/);
      expect(item.label).not.toMatch(/\b[A-Z]{4,}\b/);
    }
  });

  test("it says what she does, not what we record", () => {
    const labels = ONBOARDING_ROUTE.map((i) => i.label).join(" | ");
    expect(labels).toMatch(/A photo of your licence/);
    expect(labels).not.toMatch(/[Vv]erify your identity/);
    expect(labels).not.toMatch(/Stripe/);
  });
});
