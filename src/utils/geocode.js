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
async function geocodeAddress(address) {
  if (!address || typeof address !== "string") return null;

  try {
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
  } catch (err) {
    console.error("Geocode error:", err.message);
    return null;
  }
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

module.exports = { geocodeAddress, buildAddressString, haversineDistance, geofenceEvidence, coarsenCoordinate, COARSE_DECIMALS };
