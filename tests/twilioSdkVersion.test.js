// v1.154.1 — one Twilio Video SDK, under a versioned name, referenced the same way everywhere,
// and a signalling failure is retried before a call is given up on.
// Pete, 11/23: calls from his iPhone app never connected; Twilio's room log showed the iPhone
// dropping within seconds (iOS 26 WebSocket regression). 2.28.1 dated from October 2023.
const fs = require("fs");
const path = require("path");
const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

const FILE = "twilio-video-2.36.1.min.js";

test("the self-hosted SDK file is the version its name says", () => {
  const head = read(`public/vendor/${FILE}`).slice(0, 80);
  expect(head).toMatch(/twilio-video\.js 2\.36\.1/);
  expect(fs.existsSync(path.join(__dirname, "../public/vendor/twilio-video.min.js"))).toBe(false);
});

test("utils, the call overlay and the service worker all load that same file", () => {
  for (const f of ["public/js/utils.js", "public/js/components/VideoCallOverlay.js", "public/sw.js"]) {
    const src = read(f);
    expect(src).toContain(`/vendor/${FILE}`);
    expect(src).not.toMatch(/\/vendor\/twilio-video\.min\.js/);
  }
  // the CDN fallbacks match the self-hosted version
  expect(read("public/js/components/VideoCallOverlay.js")).not.toMatch(/2\.28\.1\/|@2\.28\.1/);
});

test("a signalling failure or stall is retried, and a drop with an error is reported", () => {
  const src = read("public/js/components/VideoCallOverlay.js");
  expect(src).toMatch(/SIGNALING_CODES = new Set\(\[53000, 53001, 53002\]\)/);
  expect(src).toMatch(/for \(let attempt = 1; attempt <= 3/);
  expect(src).toMatch(/callStage: 'connect-retry'/);
  expect(src).toMatch(/callStage: 'disconnected'/);
});
