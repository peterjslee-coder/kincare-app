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

    const response = await fetch(url, {
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

module.exports = { geocodeAddress, buildAddressString, haversineDistance };
