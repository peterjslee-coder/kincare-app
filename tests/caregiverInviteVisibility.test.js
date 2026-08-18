// A caregiver could not see a care-team invite at all. (v1.105.82)
//
// Julia clicked her invite email, the app opened, and there was nothing there. Pete: "it's
// gone. can't find it."
//
// The pending-invite banner has existed since care teams shipped — in Dashboard.js, which is
// the FAMILY home screen. app.js sends role === 'caregiver' to CaretakerHub, so she never saw
// the component the feature lives in. Same family as the Care Tasks tab-guard in v1.105.75:
// working code on a screen the person never reaches.

const fs = require("fs");
const path = require("path");
const REPO = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8");
const readCode = (p) =>
  read(p).split("\n").filter((l) => {
    const t = l.trim();
    return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
  }).join("\n");

const hub = read("public/js/components/CaretakerHub.js");
const hubCode = readCode("public/js/components/CaretakerHub.js");
const app = readCode("public/js/app.js");
const route = read("src/routes/careTeams.js");

describe("the caregiver home screen knows about invites", () => {
  test("app.js still routes a caregiver to CaretakerHub, not Dashboard", () => {
    // If this ever changes, the duplication below can go.
    expect(app).toMatch(/role === 'caregiver'\) return <CaretakerHub/);
  });

  test("CaretakerHub fetches the caregiver's pending invites", () => {
    expect(hubCode).toMatch(/api\/care-teams\/my-pending-invites/);
  });

  test("it fetches them on mount, not behind a tab guard", () => {
    // v1.105.75's lesson: checkIdentity sat behind `if (activeTab !== 'earnings') return;`
    // and therefore never ran on the screen people land on.
    // The comment naming that effect is stripped from hubCode, so anchor on code: the mount
    // effect is the one that ends `}, []);` before the earnings-gated effect begins.
    const earnings = hubCode.indexOf("if (activeTab !== 'earnings') return;");
    const mount = hubCode.slice(0, earnings);
    expect(mount).toMatch(/checkInvites\(\);/);
    expect(mount).toMatch(/\}, \[\]\);/);
  });

  test("the banner uses the fields the endpoint actually returns", () => {
    const fn = route.slice(route.indexOf('router.get("/my-pending-invites"'), route.indexOf('router.get("/", requireRole'));
    for (const field of ["token", "recipient_first_name", "inviter_first_name"]) {
      expect(fn).toMatch(new RegExp(field));
      expect(hub).toMatch(new RegExp(field.replace(/_/g, "_")));
    }
  });

  test("it lingers — nothing dismisses it except acting on it", () => {
    // Pete: "needs to be a lingering TOP OF THE FEED NEEDS YOUR ATTENTION step".
    expect(hub).toMatch(/NEEDS YOUR ATTENTION/);
    expect(hubCode).not.toMatch(/setPendingInvites\(\[\]\)/);       // no blanket clear
    expect(hubCode).toMatch(/prev\.filter\(\(i\) => i\.id !== invite\.id\)/); // only the accepted one
  });

  test("it sits above First Steps", () => {
    expect(hub.indexOf("NEEDS YOUR ATTENTION")).toBeLessThan(hub.indexOf("{showFirstSteps && ("));
  });

  test("the privacy-statement gate is reported specifically, not as a generic failure", () => {
    // v1.105.78 answers 409 with needsLegalAcceptance.
    expect(hubCode).toMatch(/res\?\.status === 409 && d\?\.needsLegalAcceptance/);
  });
});

describe("the checklist no longer flashes on every page change", () => {
  test("First Steps waits for the fetches its steps depend on", () => {
    // Pete: "as she goes from page to page it's flashing up the onboarding checklist for a
    // second...like it's trying to load it and then corrects itself." Two of the seven steps
    // are decided by fetches that land after the first paint.
    expect(hubCode).toMatch(/const firstStepsResolved = idVerification\.loaded && stripeStatus !== null;/);
    expect(hubCode).toMatch(/const showFirstSteps = firstStepsResolved && firstStepsDone < firstSteps\.length;/);
  });
});
