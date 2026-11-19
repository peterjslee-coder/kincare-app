// A caregiver whose street the free geocoder cannot find still gets a point from her town or
// ZIP (v1.134.0). Her point is coarsened to ~1 mile anyway; "unknown" cost a caregiver her
// first job offer on 11/18.

jest.mock("../src/models/database", () => ({ getDb: async () => { throw new Error("no db in this test"); } }));

const { geocodeCaregiverArea, _resetGeocodeCache } = require("../src/utils/geocode");

const asked = [];
const answer = (found) => ({ ok: true, json: async () => (found ? [{ lat: "37.1", lon: "-80.6", display_name: "x" }] : []) });

beforeEach(() => {
  _resetGeocodeCache();
  asked.length = 0;
});

test("street found: the street", async () => {
  global.fetch = jest.fn(async (url) => { asked.push(new URL(url).searchParams.get("q")); return answer(true); });
  const g = await geocodeCaregiverArea({ address: "1 Hill Rd", city: "Smalltown", state: "VA", zip: "24000" });
  expect(g.precision).toBe("address");
  expect(asked).toHaveLength(1);
});

test("street not found: her town", async () => {
  global.fetch = jest.fn(async (url) => {
    const q = new URL(url).searchParams.get("q");
    asked.push(q);
    return answer(!q.includes("Hill Rd"));
  });
  const g = await geocodeCaregiverArea({ address: "1 Hill Rd", city: "Smalltown", state: "VA", zip: "24000" });
  expect(g).toMatchObject({ precision: "city", lat: 37.1, lng: -80.6 });
}, 10000);

test("neither street nor town: her ZIP", async () => {
  global.fetch = jest.fn(async (url) => {
    const q = new URL(url).searchParams.get("q");
    asked.push(q);
    return answer(q.startsWith("24000"));
  });
  const g = await geocodeCaregiverArea({ address: "1 Hill Rd", city: "Smalltown", state: "VA", zip: "24000" });
  expect(g.precision).toBe("zip");
}, 10000);

test("nothing found: null, never a made-up point", async () => {
  global.fetch = jest.fn(async () => answer(false));
  expect(await geocodeCaregiverArea({ address: "1 Hill Rd", city: "Smalltown", state: "VA", zip: "24000" })).toBeNull();
}, 10000);

test("only caregivers use it — a care recipient's point anchors the check-in geofence", () => {
  const fs = require("fs");
  const path = require("path");
  for (const f of ["src/routes/careRecipients.js", "src/routes/selfOnboarding.js"]) {
    expect(fs.readFileSync(path.join(__dirname, "..", f), "utf8")).not.toContain("geocodeCaregiverArea");
  }
});
