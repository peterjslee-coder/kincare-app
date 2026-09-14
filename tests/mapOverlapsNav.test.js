/**
 * v1.106.28 — the map's own controls must not cover the navigation. (6ab844f2)
 *
 * Pete: "The bottom of this page has some sort of add link or something from our map page.
 * It makes the footer navigation buttons unusable because they are behind this link."
 *
 * The "link" is Leaflet's OpenStreetMap attribution. Two facts make it a bug rather than a
 * cosmetic overlap: leaflet.css ships `.leaflet-top, .leaflet-bottom { z-index: 1000 }`
 * against our `.bottom-nav { z-index: 900 }`, and `.leaflet-control` sets
 * `pointer-events: auto` — so it covered the buttons AND ate the taps.
 *
 * Asserted as a RELATIONSHIP, not as two magic numbers. Someone raising the nav to 950 later
 * should not have to remember this file exists.
 */
const fs = require("fs");
const path = require("path");
const { code } = require("./helpers/source");

const CSS = fs.readFileSync(path.join(__dirname, "..", "public/css/styles.css"), "utf8");
const VENDOR = fs.readFileSync(path.join(__dirname, "..", "public/vendor/leaflet.css"), "utf8");

/** z-index declared in the LAST rule whose selector list contains `selector`. */
const zIndexOf = (css, selector) => {
  let found = null;
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css)) !== null) {
    if (!m[1].split(",").some((s) => s.trim().endsWith(selector))) continue;
    const z = m[2].match(/z-index\s*:\s*(-?\d+)/);
    if (z) found = Number(z[1]);
  }
  return found;
};

describe("what Leaflet ships", () => {
  test("its control corners really are above our nav — this is the bug, not a guess", () => {
    expect(zIndexOf(VENDOR, ".leaflet-bottom")).toBe(1000);
    expect(zIndexOf(CSS, ".bottom-nav")).toBe(900);
  });

  test("and they accept taps, so covering the buttons also disables them", () => {
    expect(VENDOR).toMatch(/\.leaflet-control\s*\{[^}]*pointer-events\s*:\s*auto/s);
  });
});

describe("our override", () => {
  test("puts the corners below the nav", () => {
    const corners = zIndexOf(CSS, ".leaflet-bottom");
    const nav = zIndexOf(CSS, ".bottom-nav");
    expect(corners).not.toBeNull();
    expect(corners).toBeLessThan(nav);
  });

  test("covers the top corner too — zoom buttons sit there", () => {
    expect(zIndexOf(CSS, ".leaflet-top")).toBe(zIndexOf(CSS, ".leaflet-bottom"));
  });

  test("still lets the controls sit above the map's own layers", () => {
    // Below the nav is only half of it. Drop them under the popup pane (700) and the zoom
    // buttons disappear behind a marker popup instead.
    const corners = zIndexOf(CSS, ".leaflet-bottom");
    expect(corners).toBeGreaterThan(zIndexOf(VENDOR, ".leaflet-popup-pane"));
    expect(corners).toBeGreaterThan(zIndexOf(VENDOR, ".leaflet-marker-pane"));
  });

  test("is at the top level, not trapped inside a media query", () => {
    // The first draft of this landed inside `@media (max-width: 768px)`, which happens to be
    // where .bottom-nav lives. It would have worked for the reported bug and left the map
    // painting over desktop modals, which are also 1000.
    const i = CSS.indexOf(".leaflet-top,");
    expect(i).toBeGreaterThan(-1);
    const before = CSS.slice(0, i);
    const depth = (before.match(/\{/g) || []).length - (before.match(/\}/g) || []).length;
    expect(depth).toBe(0);
  });

  test("does not edit the vendor file — a Leaflet upgrade would silently undo that", () => {
    expect(VENDOR).not.toMatch(/z-index\s*:\s*800[^;]*;\s*\}[^{]*leaflet-bottom/);
    expect(zIndexOf(VENDOR, ".leaflet-bottom")).toBe(1000);
  });
});

describe("the _leaflet_pos crash on the same page", () => {
  // Two of Pete's reports from /caregivers carry
  //   TypeError: undefined is not an object (evaluating 't._leaflet_pos')
  // markersRef and circleRef outlived the map they belonged to, so after the map was rebuilt
  // renderMarkers() called map.removeLayer() with layers from the destroyed instance.
  const src = code("public/js/components/Caregivers.js");

  test("markers are dropped when the map they belong to is destroyed", () => {
    // Both places the map is torn down: the rebuild at the top of the effect, and the
    // cleanup. Missing either one leaves the stale reference that crashes.
    const teardowns = [...src.matchAll(/leafletMap\.current\.remove\(\);\s*\n\s*leafletMap\.current = null;([\s\S]{0,220})/g)];
    expect(teardowns.length).toBe(2);
    for (const t of teardowns) {
      expect(t[1]).toMatch(/markersRef\.current = \[\]/);
      expect(t[1]).toMatch(/circleRef\.current = null/);
    }
  });

  test("the marker poll can be cancelled", () => {
    // It recursed through setTimeout with nothing holding the handle: on unmount it polled
    // every 50ms for the life of the page.
    expect(src).toMatch(/waitTimer = setTimeout\(waitForMap, 50\)/);
    expect(src).toMatch(/if \(cancelled\) return;/);
    expect(src).toMatch(/clearTimeout\(waitTimer\)/);
  });

  test("the resize timers and the observer are cleaned up", () => {
    expect(src).toMatch(/pending\.current\.push\(setTimeout\(forceResize, ms\)\)/);
    expect(src).toMatch(/for \(const t of pending\.current\) clearTimeout\(t\)/);
    expect(src).toMatch(/observer\.current\.disconnect\(\)/);
  });

  test("nothing schedules a resize it cannot stop", () => {
    // The specific shape that was there: bare setTimeout(forceResize, n).
    expect(src).not.toMatch(/(?<!pending\.current\.push\()setTimeout\(forceResize,\s*\d+\)/);
  });
});
