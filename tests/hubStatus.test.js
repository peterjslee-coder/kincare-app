// v1.158.0 — the Hub's live status (utils/hubStatus.js): only known fields, clamped, and
// "online" only while reports keep coming.
const hs = require("../src/utils/hubStatus");

beforeEach(() => hs._reset());

test("keeps only what the status line shows, in range", () => {
  expect(hs.clean({ version: "1.158.0", kiosk: { deviceOwner: true, locked: "yes" }, battery: { level: 140, charging: 1 }, extra: 1 }))
    .toEqual({ version: "1.158.0", kiosk: { deviceOwner: true, locked: false }, battery: { level: 100, charging: false } });
  expect(hs.clean({ version: "<b>1</b>" }).version).toBeNull();
  expect(hs.clean(null)).toEqual({ version: null, kiosk: null, battery: null });
});

test("online while reports arrive; offline after two missed ones", () => {
  hs.record("cr1", { version: "1.158.0" }, 1000);
  expect(hs.get("cr1", 1000 + 60 * 1000).online).toBe(true);
  expect(hs.get("cr1", 1000 + hs.ONLINE_MS + 1).online).toBe(false);
  expect(hs.get("nobody")).toBeNull();
});

test("the Hub reloads itself only at a quiet moment, once per version", () => {
  const { code } = require("./helpers/source");
  const phone = code("public/js/components/RecipientPhone.js");
  expect(phone).toMatch(/const quiet = \(\) => !busyRef\.current && Date\.now\(\) - lastTouch\.current > HUB_QUIET_MS;/);
  expect(phone).toMatch(/if \(tried === d\.version\) return;/);
  expect(phone).toMatch(/if \(wantReload\.current && quiet\(\)\)/);
  // A family refresh never interrupts a call.
  expect(phone).toMatch(/onSocketEvent\('hub_refresh', \(\) => \{\s*if \(!busyRef\.current\) hubReload\(\); else wantReload\.current = true;/);
});
