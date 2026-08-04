// v1.105.23 — check-in coordinates are stored approximate, not precise.
//
// The safety claim ("the caregiver was at the home") is carried by check_in_distance_ft and
// check_in_geo_flag, computed at FULL precision before anything is rounded. The raw
// latitude/longitude proved nothing extra — they were the address of an elderly person's
// home, recorded on a schedule.
//
// They are also a regulated category. Washington's My Health My Data Act defines precise
// location as identifying a location within 1,750 feet and treats it as consumer health data
// when it indicates receipt of health services, which is what a care visit is. That act has
// a private right of action and no volume threshold.

const { coarsenCoordinate, COARSE_DECIMALS, geofenceEvidence } = require("../src/utils/geocode");

const FT_PER_DEGREE_LAT = 364000;      // ~69 miles
const MHMD_PRECISE_FT = 1750;          // the line the statute draws

describe("coarsenCoordinate", () => {
  test("rounds to a cell coarser than the 1,750-foot line", () => {
    // Worst-case error is half a cell. Latitude is the tighter of the two axes, so if it
    // clears the threshold, longitude does too at any US latitude.
    const cellFt = (10 ** -COARSE_DECIMALS) * FT_PER_DEGREE_LAT;
    expect(cellFt).toBeGreaterThan(MHMD_PRECISE_FT);
  });

  test("actually reduces precision", () => {
    expect(coarsenCoordinate(37.229572)).toBe(37.23);
    expect(coarsenCoordinate(-80.413939)).toBe(-80.41);
  });

  test("two homes on the same street collapse to the same point", () => {
    // The property that matters: the stored value must stop distinguishing individual
    // addresses. ~300 ft apart in Blacksburg.
    expect(coarsenCoordinate(37.2295)).toBe(coarsenCoordinate(37.2299));
  });

  test("null, empty and junk stay null rather than becoming 0", () => {
    // Number("") is 0, and 0,0 is a real place in the Atlantic. A missing reading must not
    // silently become a location.
    for (const bad of [null, undefined, "", "abc", NaN, {}]) {
      expect(coarsenCoordinate(bad)).toBeNull();
    }
  });

  test("a genuine zero is preserved", () => {
    expect(coarsenCoordinate(0)).toBe(0);
  });

  test("negatives round correctly, not toward zero", () => {
    // Math.round(-80.416 * 100) / 100 must not drift the wrong way — western longitudes are
    // every US coordinate.
    expect(coarsenCoordinate(-80.4149)).toBe(-80.41);
    expect(coarsenCoordinate(-80.4151)).toBe(-80.42);
  });
});

describe("the evidence is unaffected", () => {
  test("distance is computed from the FULL-precision reading", () => {
    // Rounding first would introduce up to ~1,800 ft of error into the number that decides
    // whether a caregiver was at the house — turning a privacy fix into a false 'far' flag.
    const home = [37.229572, -80.413939];
    const atDoor = geofenceEvidence(37.229580, -80.413950, ...home);
    expect(atDoor.flag).toBe("ok");
    expect(atDoor.distanceFt).toBeLessThan(50);

    const coarse = geofenceEvidence(
      coarsenCoordinate(37.229580), coarsenCoordinate(-80.413950), ...home
    );
    // Demonstrates WHY order matters: same visit, wrong answer, if you round first.
    expect(coarse.distanceFt).toBeGreaterThan(atDoor.distanceFt);
  });
});

// ─── the call sites, and the rows already written ───
const fs = require("fs");
const path = require("path");
// v1.105.36 — reads source through tests/helpers/source.js. The hand-rolled strip this
// replaces used a GLOBAL /* … */ regex, which reads the `/*` inside a string literal as a
// comment opener: on src/server.js the `https://*.tile.openstreetmap.org` entry in the CSP
// swallowed 1,184 characters of real config, and on src/models/database.js it lost 770.
// A positive assertion fails loudly when that happens; a NEGATIVE one passes silently,
// having verified nothing.
const { raw: read, code: readStripped } = require("./helpers/source");

describe("both write paths coarsen", () => {
  const sessions = readStripped("src/routes/sessions.js");

  test("check-in stores a coarsened point", () => {
    const insert = sessions.slice(sessions.indexOf("INSERT INTO visit_logs"));
    expect(insert.slice(0, 1200)).toMatch(/coarsenCoordinate\(checkInLatitude\)/);
    expect(insert.slice(0, 1200)).toMatch(/coarsenCoordinate\(checkInLongitude\)/);
  });

  test("check-out stores a coarsened point", () => {
    expect(sessions).toMatch(/coarsenCoordinate\(checkOutLatitude\)/);
    expect(sessions).toMatch(/coarsenCoordinate\(checkOutLongitude\)/);
  });

  test("no full-precision coordinate leaves the handler at all", () => {
    // Not just the INSERT — the response echo too. Returning five decimals for a row that
    // holds two would show the client a precision the record does not have.
    expect(sessions).not.toMatch(/checkInLatitude \|\| null/);
    expect(sessions).not.toMatch(/checkInLongitude \|\| null/);
    expect(sessions).not.toMatch(/checkOutLatitude \|\| null/);
  });
});

describe("existing rows are backfilled", () => {
  const schema = readStripped("src/models/database.js");

  test("migration 016 exists and rounds both pairs", () => {
    // A forward-only fix leaves the real exposure in place: every visit already recorded.
    expect(schema).toMatch(/id: "016_coarsen_visit_coordinates"/);
    expect(schema).toMatch(/ROUND\(check_in_latitude::numeric, 2\)/);
    expect(schema).toMatch(/ROUND\(check_out_lat::numeric, 2\)/);
  });

  test("the backfill leaves the distance evidence alone", () => {
    const m = schema.slice(schema.indexOf('id: "016_coarsen_visit_coordinates"'));
    const body = m.slice(0, m.indexOf("},"));
    expect(body).not.toMatch(/distance_ft/);
    expect(body).not.toMatch(/geo_flag/);
  });
});
