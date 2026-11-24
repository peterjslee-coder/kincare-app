// ─── Address suggestions (v1.75.0) ───
// Proxies autocomplete queries to Photon (photon.komoot.io — OpenStreetMap data,
// built for search-as-you-type; Nominatim's usage policy prohibits autocomplete).
// Proxied server-side so users' IPs and half-typed addresses never go to a third
// party directly, and so we can cache. Failures degrade to an empty list — the
// fields remain hand-editable.
const express = require("express");
const { authenticate } = require("../middleware/auth");
const { captureException } = require("../utils/sentry");
const { consumeDaily } = require("../utils/usageLimits");
const maps = require("../utils/maps"); // v1.126.1
const { recipientAccess } = require("../utils/access");
const { getDb } = require("../models/database");

const router = express.Router();
router.use(authenticate);

const STATE_ABBR = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO",
  montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ",
  "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH",
  oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
  "district of columbia": "DC",
};

// Tiny in-memory cache: autocomplete queries repeat heavily while typing
const cache = new Map();
const CACHE_TTL = 10 * 60 * 1000;
function cacheGet(k) {
  const e = cache.get(k);
  if (e && Date.now() - e.t < CACHE_TTL) return e.v;
  cache.delete(k);
  return null;
}
function cacheSet(k, v) {
  if (cache.size >= 500) cache.delete(cache.keys().next().value);
  cache.set(k, { t: Date.now(), v });
}

// v1.126.1 — Google Places when GOOGLE_MAPS_API_KEY is set (Pete, 10/28: "let's plan on google
// maps"). A Google suggestion carries a placeId and no address parts; the client asks
// /place/:placeId for those when one is picked. Without the key, everything below the Google
// block is exactly what it was. `near=<careRecipientId>` biases results toward that home —
// checked against the caller's access, so it cannot be used to locate a stranger's home.
async function nearPoint(req) {
  const id = String(req.query.near || "").trim();
  if (!id) return null;
  try {
    const db = await getDb();
    if (!(await recipientAccess(db, id, req.user.id))) return null;
    const cr = await db.prepare("SELECT latitude, longitude FROM care_recipients WHERE id = ?").get(id);
    return cr && cr.latitude != null ? { lat: cr.latitude, lng: cr.longitude } : null;
  } catch (e) { return null; }
}

router.get("/suggest", async (req, res) => {
  const q = (req.query.q || "").trim();
  if (maps.provider() === "google" && q.length >= 2) {
    const quota = await consumeDaily(req.user.id, "places_suggest", 400);
    if (quota.allowed) {
      try {
        const near = await nearPoint(req);
        const g = await maps.googleAutocomplete(q, { sessionToken: req.query.session, near });
        if (g) return res.json({ provider: "google", suggestions: g });
      } catch (err) { captureException(err, { where: "geocode: google suggest" }); }
    }
    // Google over quota or down: fall through to Photon below.
  }
  if (q.length < 4) return res.json({ suggestions: [] });
  const key = q.toLowerCase();
  const hit = cacheGet(key);
  if (hit) return res.json({ provider: "osm", suggestions: hit });
  // v1.106.5 — every keystroke past the cache is an outbound call to a free third-party API on
  // our User-Agent. Cached hits above are free; this caps the uncached ones per account per day.
  // Degrades to an empty suggestion list, which the fields already handle — they stay editable.
  const quota = await consumeDaily(req.user.id, "address_suggest", 600);
  if (!quota.allowed) return res.json({ suggestions: [] });
  try {
    const url = `https://photon.komoot.io/api/?${new URLSearchParams({ q, limit: "10", lang: "en" })}`;
    const r = await fetch(url, {
      headers: { "User-Agent": "InPlaceCare/1.0 (+https://yourinplace.com)" },
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) return res.json({ suggestions: [] });
    const data = await r.json();
    const suggestions = (data.features || [])
      .filter((f) => (f.properties?.countrycode || "").toUpperCase() === "US")
      .map((f) => {
        const p = f.properties || {};
        const line1 = [p.housenumber, p.street || (p.type === "house" || p.type === "street" ? p.name : null)]
          .filter(Boolean).join(" ").trim() || (p.name || "");
        const city = p.city || p.town || p.village || p.district || "";
        const state = STATE_ABBR[(p.state || "").toLowerCase()] || p.state || "";
        const zip = p.postcode || "";
        const [lng, lat] = f.geometry?.coordinates || [null, null];
        return {
          label: [line1, city, state, zip].filter(Boolean).join(", "),
          line1, city, state, zip, lat, lng,
        };
      })
      .filter((s) => s.line1 && s.city)
      // de-dupe identical labels
      .filter((s, i, arr) => arr.findIndex((x) => x.label === s.label) === i)
      .slice(0, 6);
    cacheSet(key, suggestions);
    res.json({ provider: "osm", suggestions });
  } catch (err) {
    captureException(err, { where: "geocode: suggest" });
    res.json({ suggestions: [] });
  }
});

// v1.126.1 — the address and point for a Google suggestion the user picked.
router.get("/place/:placeId", async (req, res) => {
  try {
    const quota = await consumeDaily(req.user.id, "places_details", 200);
    if (!quota.allowed) return res.status(429).json({ error: "Too many look-ups today. Type the address instead." });
    const d = await maps.googlePlaceDetails(req.params.placeId, { sessionToken: req.query.session });
    if (!d) return res.status(404).json({ error: "We couldn't look that place up. Try again or type the address." });
    res.json({ place: d });
  } catch (err) {
    captureException(err, { where: "geocode: place details" });
    res.status(500).json({ error: "We couldn't look that place up. Try again or type the address." });
  }
});

module.exports = router;
