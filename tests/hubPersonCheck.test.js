// v1.160.0 — the on-tablet person check's rules (public/js/hubPersonCheck.js), without a browser.
// The browser half — MediaPipe loads and the model runs on real photos — is tests/e2e/hubPersonCheck.e2e.js.
global.window = global.window || {};
require("../public/js/hubPersonCheck.js");
const H = global.window.HubPersonCheck;
const det = (label, score, x, y, w, h) => ({ categories: [{ categoryName: label, score }], boundingBox: { originX: x, originY: y, width: w, height: h } });

test("a person in the room counts", () => {
  expect(H.judge([det("person", 0.8, 100, 100, 200, 400)], 640, 480).person).toBe(true);
});

test("a person on the TV doesn't", () => {
  const r = H.judge([det("tv", 0.6, 300, 50, 300, 200), det("person", 0.9, 350, 80, 100, 150)], 640, 480);
  expect(r).toMatchObject({ person: false, onScreen: 1 });
  expect(r.screens).toHaveLength(1);
});

test("…even in a frame where the TV itself wasn't recognized, once its place is remembered", () => {
  const known = H.rememberScreens([], [{ x: 0.47, y: 0.1, w: 0.47, h: 0.42 }], 1000);
  expect(H.judge([det("person", 0.9, 350, 80, 100, 150)], 640, 480, known).person).toBe(false);
  expect(H.judge([det("person", 0.9, 350, 80, 100, 150)], 640, 480, []).person).toBe(true);
});

test("someone standing in front of the TV still counts", () => {
  // Most of her box is outside the TV's box.
  const r = H.judge([det("tv", 0.6, 300, 50, 300, 200), det("person", 0.9, 250, 100, 150, 370)], 640, 480);
  expect(r.person).toBe(true);
});

test("weak guesses don't count", () => {
  expect(H.judge([det("person", 0.3, 100, 100, 200, 400)], 640, 480).person).toBe(false);
});

test("remembered screens: refreshed when seen again, forgotten after a week, at most six", () => {
  let k = H.rememberScreens([], [{ x: 0.5, y: 0.1, w: 0.4, h: 0.4 }], 0);
  k = H.rememberScreens(k, [{ x: 0.51, y: 0.11, w: 0.4, h: 0.4 }], 1000);
  expect(k).toHaveLength(1);
  expect(k[0].n).toBe(2);
  expect(H.rememberScreens(k, [], 8 * 24 * 3600 * 1000)).toHaveLength(0);
  const many = Array.from({ length: 9 }, (_, i) => ({ x: i * 0.11, y: 0, w: 0.1, h: 0.1 }));
  expect(H.rememberScreens([], many, 5)).toHaveLength(6);
});

test("the Hub only counts a minute on a person or a touch when the check is running", () => {
  const { code } = require("./helpers/source");
  const phone = code("public/js/components/RecipientPhone.js");
  expect(phone).toMatch(/person: checking \? personSeen : null/);
  expect(phone).toMatch(/if \(known\.length && inKnownScreen\(\(j % 64\) \/ 64, Math\.floor\(j \/ 64\) \/ 48\)\) continue;/);
  const route = code("src/routes/dropIn.js");
  expect(route).toMatch(/: \(person \|\| touches > 0 \|\| \(\(motion \|\| talking\) && personRecently\)\);/);
});

test("nothing from the camera leaves the tablet but yes/no and counts", () => {
  const { code } = require("./helpers/source");
  const phone = code("public/js/components/RecipientPhone.js");
  const body = phone.match(/const body = \{ motion, voiceSeconds: Math\.round\(voiceSec\), touches, person: [^}]*\};/);
  expect(body).not.toBeNull();
  expect(body[0]).not.toMatch(/seen|boxes|image|frame|toDataURL/);
});
