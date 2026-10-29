// ─── Maps: place search, place details and driving distance (v1.126.0) ───
//
// Pete (10/28): "not super happy with our ability to look up places. would love to have some
// sort of google or apple maps tie in" — and then "let's plan on google maps."
//
// Google when GOOGLE_MAPS_API_KEY is set; otherwise exactly what we had (Photon/OSM search) plus
// a straight-line distance estimate, labeled as an estimate wherever it is shown. Nothing here
// throws: every function answers null (or an empty list) when the provider is down, so a
// caller can always fall back.
//
// Google's terms that shape this file (Places API (New) / Routes API):
//   · suggestion lists carry "Powered by Google" (the client draws it when provider = google);
//   · Google place results are never drawn on a non-Google map (we only list them);
//   · only place IDs may be kept indefinitely — coordinates we store are the user's own trip
//     record, rounded, and re-derived from the place ID whenever a route is computed.
//   · autocomplete + details are billed per session when a sessionToken ties them together.
//
// Free monthly caps (Google, 2026): 10k autocomplete, 10k place details (Essentials), 10k
// compute-routes (Essentials). Per-account daily caps below keep a stuck client from eating them.

const { haversineDistance } = require("./geocode");

const GOOGLE_TIMEOUT_MS = 5000;
const ROAD_FACTOR = 1.3; // straight line → typical driving distance, for the estimate only
const METERS_PER_MILE = 1609.344;

function googleKey() {
  const k = process.env.GOOGLE_MAPS_API_KEY;
  return k && k.trim() ? k.trim() : null;
}
function provider() { return googleKey() ? "google" : "osm"; }

function validLatLng(lat, lng) {
  const a = Number(lat), b = Number(lng);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  if (Math.abs(a) > 90 || Math.abs(b) > 180) return false;
  // Null Island — the commonest broken-geolocation value, and it looks like a real answer.
  if (Math.abs(a) < 0.0001 && Math.abs(b) < 0.0001) return false;
  return true;
}

async function googleFetch(url, { method = "GET", body, fieldMask } = {}) {
  const key = googleKey();
  if (!key) return null;
  try {
    const r = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        ...(fieldMask ? { "X-Goog-FieldMask": fieldMask } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
    });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      console.warn(`[maps] Google ${r.status} on ${url.split("?")[0]}: ${text.slice(0, 200)}`);
      return null;
    }
    return await r.json();
  } catch (e) {
    console.warn(`[maps] Google request failed: ${e.message}`);
    return null;
  }
}

/**
 * Search-as-you-type. Returns [{ placeId, main, secondary, label, distanceMiles? }] from
 * Google, or null when Google is not configured / failed (caller falls back to Photon).
 */
async function googleAutocomplete(input, { sessionToken, near } = {}) {
  if (!googleKey()) return null;
  const q = String(input || "").trim().slice(0, 200);
  if (q.length < 2) return [];
  const body = { input: q, includedRegionCodes: ["us"] };
  if (sessionToken) body.sessionToken = String(sessionToken).slice(0, 64);
  if (near && validLatLng(near.lat, near.lng)) {
    const center = { latitude: Number(near.lat), longitude: Number(near.lng) };
    body.locationBias = { circle: { center, radius: 50000 } };
    body.origin = center;
  }
  const d = await googleFetch("https://places.googleapis.com/v1/places:autocomplete", { method: "POST", body });
  if (!d) return null;
  return (d.suggestions || [])
    .map((s) => s.placePrediction)
    .filter(Boolean)
    .map((p) => {
      const main = p.structuredFormat?.mainText?.text || p.text?.text || "";
      const secondary = p.structuredFormat?.secondaryText?.text || "";
      return {
        placeId: p.placeId,
        main, secondary,
        label: p.text?.text || [main, secondary].filter(Boolean).join(", "),
        distanceMiles: Number.isFinite(p.distanceMeters) ? Math.round((p.distanceMeters / METERS_PER_MILE) * 10) / 10 : null,
      };
    })
    .filter((s) => s.placeId && s.main)
    .slice(0, 6);
}

function component(components, type, which = "shortText") {
  const c = (components || []).find((x) => (x.types || []).includes(type));
  return c ? (c[which] || c.longText || c.shortText || "") : "";
}

/**
 * One place's address and point. Returns { placeId, name, label, line1, city, state, zip,
 * lat, lng } or null.
 */
async function googlePlaceDetails(placeId, { sessionToken } = {}) {
  if (!googleKey()) return null;
  const id = String(placeId || "").trim();
  if (!/^[A-Za-z0-9_-]{8,300}$/.test(id)) return null;
  const qs = sessionToken ? `?sessionToken=${encodeURIComponent(String(sessionToken).slice(0, 64))}` : "";
  const d = await googleFetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(id)}${qs}`, {
    fieldMask: "id,displayName,formattedAddress,location,addressComponents",
  });
  if (!d || !d.location) return null;
  const ac = d.addressComponents || [];
  const line1 = [component(ac, "street_number"), component(ac, "route", "longText")].filter(Boolean).join(" ").trim();
  const city = component(ac, "locality", "longText") || component(ac, "sublocality", "longText") || component(ac, "postal_town", "longText");
  const state = component(ac, "administrative_area_level_1");
  const zip = component(ac, "postal_code");
  const name = d.displayName?.text || "";
  return {
    placeId: d.id || id,
    name,
    label: d.formattedAddress || name,
    line1: line1 || name,
    city, state, zip,
    lat: d.location.latitude,
    lng: d.location.longitude,
  };
}

/** Straight-line miles through the points, times a road factor. Always answers. */
function estimateMiles(points) {
  let straight = 0; // haversineDistance answers in miles
  for (let i = 1; i < points.length; i++) {
    straight += haversineDistance(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
  }
  const miles = straight * ROAD_FACTOR;
  return Math.round(miles * 10) / 10;
}

function waypoint(p) {
  if (p.placeId) return { placeId: p.placeId };
  return { location: { latLng: { latitude: Number(p.lat), longitude: Number(p.lng) } } };
}

/**
 * Driving miles along the points in order (2–7 points). Each point is { lat, lng } and/or
 * { placeId }. Returns { miles, source: "google" | "estimate", minutes? } or null when no
 * distance can be had at all (an estimate needs coordinates on every point).
 */
async function drivingMiles(points) {
  if (!Array.isArray(points) || points.length < 2 || points.length > 7) return null;
  if (googleKey()) {
    const body = {
      origin: waypoint(points[0]),
      destination: waypoint(points[points.length - 1]),
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_UNAWARE",
      units: "IMPERIAL",
    };
    if (points.length > 2) body.intermediates = points.slice(1, -1).map(waypoint);
    const d = await googleFetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST", body, fieldMask: "routes.distanceMeters,routes.duration",
    });
    const route = d && Array.isArray(d.routes) ? d.routes[0] : null;
    if (route && Number.isFinite(route.distanceMeters)) {
      const secs = parseInt(String(route.duration || "0").replace("s", ""), 10) || 0;
      return {
        miles: Math.round((route.distanceMeters / METERS_PER_MILE) * 10) / 10,
        minutes: secs ? Math.round(secs / 60) : null,
        source: "google",
      };
    }
  }
  if (points.every((p) => validLatLng(p.lat, p.lng))) {
    return { miles: estimateMiles(points), source: "estimate" };
  }
  return null;
}

module.exports = {
  provider, googleKey, validLatLng,
  googleAutocomplete, googlePlaceDetails, drivingMiles, estimateMiles,
  ROAD_FACTOR,
};
