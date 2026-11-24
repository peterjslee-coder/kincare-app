// v1.155.5 — weather on the InPlace Hub. Pete: "make sure the weather is pulled from wherever
// the care location is." These pin: it asks for the care recipient's own coordinates and time
// zone, it never makes the Hub wait, and the client shows it as a button under the clock.
const { weatherFor, summarize, describe, _cache } = require("../src/utils/weather");
const { code } = require("./helpers/source");

const RAW = {
  current: { temperature_2m: 41.4, weather_code: 0, is_day: 0 },
  hourly: {
    time: ["2026-11-24T09:00", "2026-11-24T15:00", "2026-11-24T19:00"],
    temperature_2m: [38.2, 47.6, 40.1],
    weather_code: [0, 61, 3],
  },
  daily: { temperature_2m_max: [48.4], temperature_2m_min: [30.6], weather_code: [61], precipitation_probability_max: [70] },
};

test("summarize turns Open-Meteo into what the Hub draws", () => {
  const w = summarize(RAW);
  expect(w.now).toEqual({ temp: 41, label: "Clear", icon: "clear", isDay: false });
  expect(w.today).toEqual({ hi: 48, lo: 31, label: "Rain", icon: "rain", rainChance: 70 });
  expect(w.parts.map((p) => [p.name, p.temp, p.icon])).toEqual([["Morning", 38, "clear"], ["Afternoon", 48, "rain"], ["Evening", 40, "cloud"]]);
  expect(describe(95).label).toBe("Thunderstorms");
});

test("it uses the care recipient's coordinates and time zone, answers at once, and fills on the next ask", async () => {
  _cache.clear();
  const seen = [];
  const real = global.fetch;
  global.fetch = async (u) => { seen.push(String(u)); return { ok: true, json: async () => RAW }; };
  try {
    const r = { latitude: 37.2296, longitude: -80.4139, timezone: "America/New_York" };
    expect(weatherFor(r)).toBeNull(); // nothing cached yet: no waiting on the network
    await new Promise((res) => setTimeout(res, 10));
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain("latitude=37.2296");
    expect(seen[0]).toContain("longitude=-80.4139");
    expect(seen[0]).toContain("timezone=America%2FNew_York");
    expect(weatherFor(r).now.temp).toBe(41);
    expect(seen).toHaveLength(1); // cached: no second fetch
    expect(weatherFor({ latitude: null, longitude: null })).toBeNull();
  } finally { global.fetch = real; }
});

test("the Hub shows the weather as a button under the clock that opens a 10-second forecast", () => {
  const hub = code("public/js/components/RecipientPhone.js");
  expect(hub).toContain('data-testid="hub-weather-button" onClick={() => setShowWx(true)}');
  expect(hub).toContain("const WEATHER_SHOW_MS = 10000;");
  expect(hub).toMatch(/\{showWx && wx && <HubWeather wx=\{wx\}/);
  expect(code("src/utils/simpleMode.js")).toContain('out.weather = require("./weather").weatherFor(recipient);');
});

test("the board's background follows the day and tapping a photo moves on", () => {
  const hub = code("public/js/components/RecipientPhone.js");
  expect(hub).toMatch(/background: hubSky\(now\)/);
  expect(hub).toMatch(/data-testid="hub-photo" onClick=\{\(\) => setI\(\(n\) => n \+ 1\)\}/);
});
