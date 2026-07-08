// ─── Address suggestions (v1.75.0) ───
// Proxies autocomplete queries to Photon (photon.komoot.io — OpenStreetMap data,
// built for search-as-you-type; Nominatim's usage policy prohibits autocomplete).
// Proxied server-side so users' IPs and half-typed addresses never go to a third
// party directly, and so we can cache. Failures degrade to an empty list — the
// fields remain hand-editable.
const express = require("express");
const { authenticate } = require("../middleware/auth");
const { captureException } = require("../utils/sentry");

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

router.get("/suggest", async (req, res) => {
  const q = (req.query.q || "").trim();
  if (q.length < 4) return res.json({ suggestions: [] });
  const key = q.toLowerCase();
  const hit = cacheGet(key);
  if (hit) return res.json({ suggestions: hit });
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
    res.json({ suggestions });
  } catch (err) {
    captureException(err, { where: "geocode: suggest" });
    res.json({ suggestions: [] });
  }
});

module.exports = router;
