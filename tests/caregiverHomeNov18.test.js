// Caregiver home after Kay's and Tina's day (v1.134.0).
//
// Pete, 11/18:
//   "I just helped [Kay] add a bank account and the landing screen says the pay has to land
//    somewhere. It doesn't register that it's already been done."
//   "Tina's homepage has on-boarding stuff like get listed for other families for background
//    check, which she's currently waived for and keeping your account safe. Those should not
//    stay there. You should be able to cancel them as well as get rid of the done steps..."

const fs = require("fs");
const path = require("path");

const routeSrc = fs.readFileSync(path.join(__dirname, "..", "public", "js", "onboardingRoute.js"), "utf8");
const w = {};
new Function("window", routeSrc)(w);
const { resolveRoute } = w;
const hub = fs.readFileSync(path.join(__dirname, "..", "public", "js", "components", "CaretakerHub.js"), "utf8");

const onDashboard = (stripe) => ({
  surface: "hub", profileCreated: true,
  identity: { loaded: true, submitted: true, approved: true, status: "approved" },
  stripe, backgroundCheck: {},
});
const stripeState = (r) => r.items.find((i) => i.id === "stripe").state;

describe("where your pay lands", () => {
  test("not started is hers to do", () => {
    expect(stripeState(resolveRoute(onDashboard({ status: "not_started", connected: false })))).toBe("todo");
  });
  test("details handed to Stripe, payouts not on yet: Stripe's wait, not hers", () => {
    expect(stripeState(resolveRoute(onDashboard({ status: "pending", connected: false, detailsSubmitted: true })))).toBe("waiting");
  });
  test("connected is done", () => {
    expect(stripeState(resolveRoute(onDashboard({ status: "active", connected: true })))).toBe("done");
  });
  test("the hub passes Stripe's detailsSubmitted through and says so", () => {
    expect(hub).toMatch(/stripeChecking = !stripeConnected && !!\(stripeStatus && stripeStatus\.detailsSubmitted\)/);
    expect(hub).toContain("detailsSubmitted: stripeChecking");
  });
});

describe("the Get Ready card", () => {
  test("optional sections can be closed, and stay closed on the account", () => {
    expect(hub).toContain("useStickySection('caregiverHome.getListed', true)");
    expect(hub).toContain("useStickySection('caregiverHome.keepSafe', true)");
    expect(hub).toContain("setListedShown(false)");
    expect(hub).toContain("setSecurityShown(false)");
  });
  test("the done ticks only show while something is still Up next", () => {
    expect(hub).toContain("{mustDo && doneItems.length > 0 && (");
  });
  test("nothing left to show draws nothing", () => {
    expect(hub).toContain("if (!mustDo && !showListed && !showSecurity) return null;");
  });
  test("Find Work locks on what she must do, never on a photo, availability or account security", () => {
    expect(hub).toMatch(/window\.__caregiverFirstStepsRemain = showFirstSteps && requiredTodo\.length > 0/);
    const req = hub.match(/const REQUIRED_IDS = [^\n]+/)[0];
    expect(req).not.toMatch(/security|photo|avail-rates/);
    expect(req).toContain("'preferences'");
  });
  test("the sticky-section hooks run before the hub's early returns", () => {
    const hookAt = hub.indexOf("useStickySection('caregiverHome.getListed'");
    const firstReturn = hub.indexOf("if (loading) return <LoadingSpinner");
    expect(hookAt).toBeGreaterThan(0);
    expect(hookAt).toBeLessThan(firstReturn);
  });
});
