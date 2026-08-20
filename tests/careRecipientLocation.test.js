// The other side of the marketplace. (v1.105.122)
//
// v1.105.121 closed the caregiver cold start: no coordinates, no bookings, and now no job list
// either. This is the same hole from the family's side, and it was wider — a care recipient with
// NULL latitude/longitude is missing from /caregivers/nearby, centres no browse map, and gives
// every caregiver a blank distance on every job for them.
//
// Two independent ways in:
//   1. the family wizard never required an address at all, client or server
//   2. the care-recipient self-onboarding endpoint never geocoded, so EVERY self-signup had
//      NULL coordinates — not sometimes, always

const fs = require("fs");
const path = require("path");
const read = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");

const selfOnboarding = read("src", "routes", "selfOnboarding.js");
const recipientsRoute = read("src", "routes", "careRecipients.js");
const recipientsUi = read("public", "js", "components", "CareRecipients.js");
const server = read("src", "server.js");

describe("a care recipient who signed themselves up gets a point", () => {
  test("the endpoint geocodes the address it has been storing as four strings", () => {
    expect(selfOnboarding).toMatch(/require\("\.\.\/utils\/geocode"\)/);
    expect(selfOnboarding).toMatch(/const geo = await geocodeAddress\(addrStr\)/);
    expect(selfOnboarding).toMatch(/latitude = COALESCE\(\?, latitude\)/);
    expect(selfOnboarding).toMatch(/longitude = COALESCE\(\?, longitude\)/);
  });

  test("but a geocoder outage never blocks her finishing", () => {
    // Nominatim is free and best-effort. Failing to place her on a map is not a reason to
    // refuse the terms she just agreed to; the startup backfill retries.
    const block = selfOnboarding.slice(selfOnboarding.indexOf("let lat = null;"));
    expect(block.slice(0, 900)).toMatch(/try \{/);
    expect(block.slice(0, 900)).toMatch(/catch \(e\)/);
  });
});

describe("the family wizard asks for the address", () => {
  test("it is required, client-side, with the reason attached", () => {
    expect(recipientsUi).toMatch(/!formData\.address\.trim\(\) \|\| !formData\.city\.trim\(\)/);
    expect(recipientsUi).toMatch(/how we find caregivers nearby/);
  });

  test("the coordinates the picker resolved are no longer thrown away", () => {
    expect(recipientsUi).toMatch(/latitude: s\.lat != null \? s\.lat : null/);
    expect(recipientsUi).toMatch(/latitude: formData\.latitude != null/);
  });

  test("editing the address by hand clears them again", () => {
    // Picking "12 Oak Lane" and then hand-editing to "14" would otherwise keep number 12's
    // point — and a WRONG point is indistinguishable from a right one everywhere downstream,
    // which makes it worse than none.
    expect(recipientsUi).toMatch(/ADDRESS_FIELDS = \['address', 'city', 'state', 'zip'\]/);
    expect(recipientsUi).toMatch(/ADDRESS_FIELDS\.includes\(field\) \? \{ latitude: null, longitude: null \}/);
  });
});

describe("the server prefers its own answer, and takes the client's rather than none", () => {
  test("geocoding runs first", () => {
    const post = recipientsRoute.slice(recipientsRoute.indexOf("// Auto-geocode address"));
    const geoAt = post.indexOf("await geocodeAddress");
    const fallbackAt = post.indexOf("usableClientPoint(req.body.latitude");
    expect(geoAt).toBeGreaterThan(-1);
    expect(fallbackAt).toBeGreaterThan(geoAt);
  });

  test("the fallback is validated, and Null Island is not a location", () => {
    expect(recipientsRoute).toMatch(/function usableClientPoint\(latitude, longitude\)/);
    expect(recipientsRoute).toMatch(/if \(lat === 0 && lng === 0\) return null;/);
    expect(recipientsRoute).toMatch(/Math\.abs\(lat\) > 90 \|\| Math\.abs\(lng\) > 180/);
  });

  test("both the create and the update path use it", () => {
    expect((recipientsRoute.match(/usableClientPoint\(req\.body\.latitude/g) || [])).toHaveLength(2);
  });
});

describe("everyone already broken gets repaired on boot", () => {
  test("the backfill covers care recipients, not just caregivers", () => {
    expect(server).toMatch(/FROM care_recipients\s+WHERE latitude IS NULL AND longitude IS NULL/);
    expect(server).toMatch(/UPDATE care_recipients SET latitude = \?, longitude = \? WHERE id = \?/);
  });

  test("and it still respects the rate limit it is borrowing", () => {
    // Nominatim is 1 req/sec, and this is a free service being used politely.
    const half = server.slice(server.indexOf("care recipient(s) missing coordinates"));
    expect(half.slice(0, 1200)).toMatch(/setTimeout\(r, 1100\)/);
  });
});
