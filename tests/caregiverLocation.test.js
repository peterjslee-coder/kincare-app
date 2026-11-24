// No location, no jobs — as a policy and as a reality. (v1.105.121)
//
// Pete: "if they don't provide an address, they have to provide their location to search around
// somehow... otherwise no jobs as a policy (and a reality). If they get to know where jobs are,
// we get to know where they are."
//
// The asymmetry this closes: assignments.js only offers a family caregivers with coordinates
// inside 25 miles, so a caregiver with NULL lat/lng cannot receive a first booking from anyone.
// Meanwhile the caregiver job list had no location predicate at all — she saw every job on the
// platform while being invisible to all of them, and nothing anywhere said so.

const fs = require("fs");
const path = require("path");
const read = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");

const caregivers = read("src", "routes", "caregivers.js");
const dashboard = read("src", "routes", "dashboard.js");
const assignments = read("src", "routes", "assignments.js");
const findWork = read("public", "js", "components", "FindWork.js");
const schema = read("src", "models", "database.js");
const { coarsenCoordinate, COARSE_DECIMALS } = require("../src/utils/geocode");

describe("her phone can answer what her address didn't", () => {
  test("there is an endpoint for it, and only she can call it", () => {
    expect(caregivers).toMatch(/router\.post\("\/me\/location", requireRole\("caregiver"\)/);
  });

  test("what it stores is coarsened", () => {
    // Precise enough for a 25-mile match, deliberately not precise enough to be a home address.
    expect(caregivers).toMatch(/const coarseLat = coarsenCoordinate\(lat\);/);
    expect(caregivers).toMatch(/const coarseLng = coarsenCoordinate\(lng\);/);
    expect(caregivers).toMatch(/SET latitude = \?, longitude = \?, location_source = 'device'/);
  });

  test("Null Island is rejected", () => {
    // 0,0 is the Atlantic off Ghana and the most common value a broken geolocation call
    // produces. Accepting it would put her 4,000 miles from every job and look like an answer.
    expect(caregivers).toMatch(/\(lat === 0 && lng === 0\)/);
    expect(caregivers).toMatch(/Math\.abs\(lat\) > 90 \|\| Math\.abs\(lng\) > 180/);
  });

  test("how we know is recorded, so it can be re-asked later", () => {
    expect(schema).toMatch(/ADD COLUMN IF NOT EXISTS location_source TEXT/);
  });
});

describe("no location, no jobs", () => {
  test("the job list is empty rather than nagged over", () => {
    const openJobs = dashboard.slice(dashboard.indexOf("openJobs: await (async () =>"));
    expect(openJobs.slice(0, 900)).toMatch(/if \(!profile \|\| !profile\.latitude \|\| !profile\.longitude\) return \[\];/);
  });

  test("and the caregiver is told which state she is in", () => {
    expect(dashboard).toMatch(/locationKnown: !!\(profile && profile\.latitude && profile\.longitude\)/);
  });

  test("the gate defaults to open, so it cannot flash before the answer arrives", () => {
    // v1.105.112's rule, again: an unknown answer must never render as a negative one — and
    // this particular negative tells her she is invisible to every family on the platform.
    expect(findWork).toMatch(/const \[locationKnown, setLocationKnown\] = useState\(true\)/);
    expect(findWork).toMatch(/setLocationKnown\(d\.locationKnown !== false\)/);
  });

  test("the jobs tab really is replaced, not decorated", () => {
    expect(findWork).toMatch(/\{subTab === 'jobs' && !locationKnown && \(/);
    expect(findWork).toMatch(/\{subTab === 'jobs' && locationKnown && <>/);
  });

  test("it says the deal in both directions", () => {
    expect(findWork).toMatch(/no family\s*\n?\s*can find you/);
    expect(findWork).toMatch(/we need to know roughly where you are/);
  });

  test("a refusal and a timeout get different sentences", () => {
    // They need different things from her: one is a Settings trip, the other is "try again".
    expect(findWork).toMatch(/result\.reason === 'denied'/);
    expect(findWork).toMatch(/set to refuse location/);
    expect(findWork).toMatch(/didn\\u2019t answer/);
  });

  test("there is always a way through that is not the phone", () => {
    expect(findWork).toMatch(/Add my address instead/);
    expect(findWork).toMatch(/canAskLocation\(\)/);
  });
});

describe("a caregiver's exact point never leaves the building", () => {
  // Her precise coordinates ARE her home address. Every family browsing the platform was being
  // handed it to about 11 metres, while the only thing any of them needs is the distance.
  test("the browse list coarsens", () => {
    expect(caregivers).toMatch(/latitude: coarsenCoordinate\(c\.latitude\)/);
    expect(caregivers).toMatch(/longitude: coarsenCoordinate\(c\.longitude\)/);
  });

  test("the booking picker coarsens", () => {
    expect(assignments).toMatch(/latitude: coarsenCoordinate\(c\.latitude\)/);
    expect(assignments).toMatch(/require\("\.\.\/utils\/geocode"\)/);
  });

  test("but distance is still measured from the exact point", () => {
    // Coarsening before the haversine would make every distance wrong by up to a mile.
    const i = assignments.indexOf("const dist = haversine(");
    const j = assignments.indexOf("latitude: coarsenCoordinate(c.latitude)");
    expect(i).toBeGreaterThan(-1);
    expect(j).toBeGreaterThan(i);
  });

  test("~1 mile, and the helper agrees", () => {
    expect(COARSE_DECIMALS).toBe(2);
    expect(coarsenCoordinate(37.229612345)).toBe(37.23);
    expect(coarsenCoordinate(-80.413900001)).toBe(-80.41);
    expect(coarsenCoordinate(null)).toBeNull();
  });
});
