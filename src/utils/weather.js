// ─── v1.155.5 — weather for the InPlace Hub ───
//
// Pete, 11/23: "instead of evening...a moon and temperature? 'Weather' button she could push for
// a 10-sec weather forecast for the day?" and "make sure the weather is pulled from wherever the
// care location is."
//
// So it is the care recipient's own coordinates (care_recipients.latitude/longitude, set when
// her address was geocoded), in her care-location time zone — never the viewer's or the
// server's. Open-Meteo: free, no key, no account. Fahrenheit, because the care is in Virginia;
// a later non-US family would want a setting.
//
// Never on the request's critical path: the Hub asks every minute, and this answers from a
// 20-minute cache at once. When the cached copy is old (or missing) a refresh starts in the
// background and the NEXT poll gets it. A failed fetch keeps serving the last good copy for up
// to three hours, then nothing — the Hub simply shows no weather rather than a stale one.

const TTL_MS = 20 * 60 * 1000;
const STALE_MAX_MS = 3 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 4000;
const cache = new Map(); // key → { at, data, fetching }

// WMO weather codes → a word she knows and an icon family the client draws.
function describe(code) {
  const c = Number(code);
  if (c === 0) return { label: "Clear", icon: "clear" };
  if (c === 1 || c === 2) return { label: "Partly cloudy", icon: "partly" };
  if (c === 3) return { label: "Cloudy", icon: "cloud" };
  if (c === 45 || c === 48) return { label: "Foggy", icon: "fog" };
  if (c >= 51 && c <= 57) return { label: "Drizzle", icon: "rain" };
  if ((c >= 61 && c <= 67) || (c >= 80 && c <= 82)) return { label: "Rain", icon: "rain" };
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return { label: "Snow", icon: "snow" };
  if (c >= 95) return { label: "Thunderstorms", icon: "storm" };
  return { label: "", icon: "cloud" };
}

function keyFor(lat, lng) { return `${Number(lat).toFixed(2)},${Number(lng).toFixed(2)}`; }

/** Shape Open-Meteo's answer into what the Hub draws. Exported for the tests. */
function summarize(raw) {
  if (!raw || !raw.current || !raw.daily) return null;
  const cur = describe(raw.current.weather_code);
  const day = describe(raw.daily.weather_code && raw.daily.weather_code[0]);
  const hourly = raw.hourly || {};
  const times = hourly.time || [];
  const at = (hh) => {
    const i = times.findIndex((t) => String(t).slice(11, 13) === hh);
    if (i < 0) return null;
    const d = describe(hourly.weather_code && hourly.weather_code[i]);
    return { temp: Math.round(hourly.temperature_2m[i]), label: d.label, icon: d.icon };
  };
  const rain = raw.daily.precipitation_probability_max ? raw.daily.precipitation_probability_max[0] : null;
  return {
    now: { temp: Math.round(raw.current.temperature_2m), label: cur.label, icon: cur.icon, isDay: raw.current.is_day === 1 },
    today: {
      hi: Math.round(raw.daily.temperature_2m_max[0]),
      lo: Math.round(raw.daily.temperature_2m_min[0]),
      label: day.label, icon: day.icon,
      rainChance: Number.isFinite(rain) ? rain : null,
    },
    parts: [["Morning", "09"], ["Afternoon", "15"], ["Evening", "19"]]
      .map(([name, hh]) => { const p = at(hh); return p ? { name, ...p } : null; })
      .filter(Boolean),
  };
}

async function fetchWeather(lat, lng, tz) {
  const u = new URL("https://api.open-meteo.com/v1/forecast");
  u.searchParams.set("latitude", String(lat));
  u.searchParams.set("longitude", String(lng));
  u.searchParams.set("current", "temperature_2m,weather_code,is_day");
  u.searchParams.set("hourly", "temperature_2m,weather_code");
  u.searchParams.set("daily", "temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max");
  u.searchParams.set("temperature_unit", "fahrenheit");
  u.searchParams.set("timezone", tz || "America/New_York");
  u.searchParams.set("forecast_days", "1");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(u, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`open-meteo ${r.status}`);
    return summarize(await r.json());
  } finally { clearTimeout(t); }
}

/**
 * The weather at a care location, or null. Answers at once from the cache; refreshes behind.
 * @param {{latitude, longitude, timezone}} recipient  a care_recipients row
 */
function weatherFor(recipient) {
  const lat = Number(recipient && recipient.latitude), lng = Number(recipient && recipient.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return null;
  const key = keyFor(lat, lng);
  const hit = cache.get(key) || { at: 0, data: null, fetching: false };
  const age = Date.now() - hit.at;
  if (age > TTL_MS && !hit.fetching) {
    hit.fetching = true;
    cache.set(key, hit);
    fetchWeather(lat, lng, recipient.timezone)
      .then((data) => { if (data) cache.set(key, { at: Date.now(), data, fetching: false }); else hit.fetching = false; })
      .catch((err) => {
        hit.fetching = false;
        try { require("./sentry").captureException(err, { where: "weather: open-meteo" }); } catch { /* best effort */ }
      });
  }
  return hit.data && age <= STALE_MAX_MS ? hit.data : null;
}

module.exports = { weatherFor, summarize, describe, _cache: cache };
