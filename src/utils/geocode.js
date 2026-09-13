/**
 * Geocoding utility — thin abstraction layer.
 *
 * Currently uses OpenStreetMap Nominatim (free, no API key).
 * To swap to Google Maps later, change only the geocodeAddress() body.
 *
 * Usage:
 *   const { lat, lng } = await geocodeAddress("123 Main St, Blacksburg, VA 24060");
 *   const miles = haversineDistance(lat1, lng1, lat2, lng2);
 */

/**
 * Convert an address string to lat/lng coordinates.
 * Uses Nominatim (OpenStreetMap) — free, 1 req/sec rate limit.
 *
 * To swap to Google Maps Geocoding API later:
 *   Replace the fetch URL with:
 *   `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${API_KEY}`
 *   And parse: result.results[0].geometry.location.{lat, lng}
 *
 * @param {string} address - Full or partial address string
 * @returns {Promise<{lat: number, lng: number, display: string} | null>}
 */
// ─── v1.106.5 — cache, and a queue in front of the free public API ───
//
// Three problems, one fix. (1) The same address was geocoded again on every profile edit —
// addresses do not move. (2) `GET /api/caregivers?address=<anything>` turned one inbound
// request into one outbound request to Nominatim, so a bored attacker could get our
// User-Agent banned and take geocoding down for everyone. (3) Nominatim's usage policy is
// one request per second and we had no idea how many we were making.
//
// The cache is two-layer: an in-process Map (free, per-instance) in front of a `geocode_cache`
// table (survives deploys, shared if we ever run two instances). Misses go through a
// serializing queue that spaces outbound calls and REFUSES rather than piling up when it is
// full — the caller already treats null as "could not geocode" and degrades cleanly, so a
// refusal costs an approximate map pin, not an error page.
const GEO_MEM_MAX = 2000;
const GEO_MEM_TTL_MS = 60 * 60 * 1000;
const _geoMem = new Map();

/** Normalise so "123 Main St., Blacksburg VA" and "123 main st, blacksburg, va" share a row. */
function geocodeCacheKey(address) {
  return String(address)
    .toLowerCase()
    .replace(/[.,#]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

function _memGet(key) {
  const e = _geoMem.get(key);
  if (!e) return undefined;
  if (Date.now() - e.t > GEO_MEM_TTL_MS) { _geoMem.delete(key); return undefined; }
  return e.v;
}

function _memSet(key, v) {
  if (_geoMem.size >= GEO_MEM_MAX) _geoMem.delete(_geoMem.keys().next().value);
  _geoMem.set(key, { t: Date.now(), v });
}

async function _dbGet(key) {
  try {
    const { getDb } = require("../models/database");
    const db = await getDb();
    const row = await db.prepare(
      "SELECT lat, lng, display, found FROM geocode_cache WHERE query_key = ?"
    ).get(key);
    if (!row) return undefined;
    // Touch asynchronously; a stale last_used_at only affects future pruning.
    db.prepare(
      "UPDATE geocode_cache SET hit_count = hit_count + 1, last_used_at = NOW() WHERE query_key = ?"
    ).run(key).catch(() => {});
    if (!row.found) return null;
    return { lat: Number(row.lat), lng: Number(row.lng), display: row.display };
  } catch {
    return undefined; // cache unavailable is not an error — fall through to the network
  }
}

async function _dbSet(key, geo) {
  try {
    const { getDb } = require("../models/database");
    const db = await getDb();
    await db.prepare(`
      INSERT INTO geocode_cache (query_key, lat, lng, display, found)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (query_key) DO UPDATE
        SET lat = EXCLUDED.lat, lng = EXCLUDED.lng, display = EXCLUDED.display,
            found = EXCLUDED.found, last_used_at = NOW()
    `).run(key, geo ? geo.lat : null, geo ? geo.lng : null, geo ? geo.display : null, geo ? 1 : 0);
  } catch { /* best effort */ }
}

// Serialised outbound calls. MIN_INTERVAL_MS honours Nominatim's 1 req/sec policy; MAX_QUEUE
// is the ceiling on how much of an attacker's traffic we are willing to relay before we start
// saying no.
const NOMINATIM_MIN_INTERVAL_MS = 1100;
const NOMINATIM_MAX_QUEUE = 12;
let _geoQueueDepth = 0;
let _geoChain = Promise.resolve();
let _geoLastCall = 0;

function _geoQueue(fn) {
  if (_geoQueueDepth >= NOMINATIM_MAX_QUEUE) return Promise.resolve(null);
  _geoQueueDepth += 1;
  const run = _geoChain.then(async () => {
    const wait = NOMINATIM_MIN_INTERVAL_MS - (Date.now() - _geoLastCall);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    _geoLastCall = Date.now();
    try { return await fn(); } finally { _geoQueueDepth -= 1; }
  });
  // Keep the chain alive even if one call rejects.
  _geoChain = run.then(() => {}, () => {});
  return run;
}

async function _geocodeUncached(address) {
  const url = `https://nominatim.openstreetmap.org/search?${new URLSearchParams({
    q: address,
    format: "json",
    limit: "1",
    countrycodes: "us",
  })}`;

  // v1.105.50 — a deadline. This is awaited INLINE in save handlers (creating or editing
  // a care recipient, a caregiver profile), so an unresponsive free public API meant the
  // request hung with no timeout at all — the server-side twin of the fetch bug that left
  // Pete's phone spinning in Betty's kitchen. routes/geocode.js already got this right;
  // this copy didn't. The catch below returns null, so degrading is free.
  const response = await fetch(url, {
    signal: AbortSignal.timeout(4000),
    headers: {
      "User-Agent": "InPlace-CareApp/1.0 (peterjslee@gmail.com)",
    },
  });

  if (!response.ok) return null;

  const results = await response.json();
  if (!results || results.length === 0) return null;

  return {
    lat: parseFloat(results[0].lat),
    lng: parseFloat(results[0].lon),
    display: results[0].display_name,
  };
}

async function geocodeAddress(address) {
  if (!address || typeof address !== "string") return null;
  const key = geocodeCacheKey(address);
  if (!key) return null;

  const mem = _memGet(key);
  if (mem !== undefined) return mem;

  const cached = await _dbGet(key);
  if (cached !== undefined) { _memSet(key, cached); return cached; }

  try {
    const geo = await _geoQueue(() => _geocodeUncached(address));
    // A queue refusal and a genuine "no such address" both arrive as null. Only the second
    // deserves a negative cache entry, and we cannot tell them apart here — so cache neither
    // in the DB when null, and let the in-memory layer absorb the repeat traffic briefly.
    if (geo) { _memSet(key, geo); _dbSet(key, geo); }
    else _memSet(key, null);
    return geo;
  } catch (err) {
    console.error("Geocode error:", err.message);
    return null;
  }
}

/** Test seam: drop the in-process cache between cases. */
function _resetGeocodeCache() {
  _geoMem.clear();
  _geoLastCall = 0;
}

/**
 * Build a full address string from components.
 * @param {object} parts
 * @returns {string}
 */
function buildAddressString({ address, city, state, zip }) {
  return [address, city, state, zip].filter(Boolean).join(", ");
}

/**
 * Haversine distance between two lat/lng points.
 * @returns {number} Distance in miles
 */
function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 3959; // Earth's radius in miles
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

/**
 * Geofence evidence for a caregiver check-in/out point vs. the care recipient's home.
 * Returns the distance in feet and a flag used as proof-of-presence evidence.
 *   flag: 'ok' (within geofence) | 'far' (outside) | 'no_geo' (caregiver gave no location)
 *         | 'no_home_geo' (recipient address not geocoded)
 * Default geofence is generous (1000 ft) to tolerate GPS jitter + imprecise address geocoding;
 * the recorded distanceFt is the real evidence, the flag is a convenience.
 */
function geofenceEvidence(pointLat, pointLng, homeLat, homeLng, geofenceFt = 1000) {
  if (pointLat == null || pointLng == null) return { distanceFt: null, flag: 'no_geo' };
  if (homeLat == null || homeLng == null) return { distanceFt: null, flag: 'no_home_geo' };
  const miles = haversineDistance(Number(pointLat), Number(pointLng), Number(homeLat), Number(homeLng));
  const distanceFt = Math.round(miles * 5280);
  return { distanceFt, flag: distanceFt <= geofenceFt ? 'ok' : 'far' };
}


// ─── v1.105.23 — store an approximate point, not a precise one ───
//
// Check-in location is the app's proof that a caregiver was at the home. That claim is
// carried by check_in_distance_ft and check_in_geo_flag, which are computed here at FULL
// precision. The raw latitude/longitude were stored alongside them and prove nothing extra:
// distance-to-home is the evidence; the coordinate is just the place a vulnerable person
// lives, recorded on a schedule.
//
// It is also a regulated category. Washington's My Health My Data Act treats precise
// location — defined as identifying a location within 1,750 feet — as consumer health data
// when it indicates receipt of health services, which is exactly what a care visit is. That
// act has a private right of action and no volume threshold. California, Virginia,
// Connecticut, Maryland and Oregon all treat precise geolocation as sensitive on similar
// terms.
//
// Rounding to 2 decimal places puts a point on a grid roughly 1.1 km on a side in latitude
// and, at Virginia's latitude, about 0.9 km in longitude. Both cells are larger than the
// 1,750-foot (533 m) line, so the stored value no longer identifies a location within it.
//
// Deliberately NOT dropped entirely: an approximate point still lets an admin sanity-check
// a disputed visit ("was this even in the right town?") and still lets a real dispute be
// investigated. What it no longer does is record where someone's mother lives to five
// decimal places.
const COARSE_DECIMALS = 2;

function coarsenCoordinate(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 10 ** COARSE_DECIMALS) / 10 ** COARSE_DECIMALS;
}

module.exports = { geocodeAddress, buildAddressString, haversineDistance, geofenceEvidence, coarsenCoordinate, COARSE_DECIMALS, geocodeCacheKey, _resetGeocodeCache, NOMINATIM_MAX_QUEUE, NOMINATIM_MIN_INTERVAL_MS };
