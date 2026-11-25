// v1.160.0 — end-to-end check of the Hub's on-tablet person check in a real (headless) Chrome:
// the self-hosted MediaPipe runtime loads, the model runs, and judge() keeps a person ON a
// screen from counting. Not part of `npm test` (needs Chrome and puppeteer-core):
//
//   node tests/e2e/hubPersonCheck.e2e.js <dir-of-photos> [chrome-path]
//
// Prints each photo's verdict and every raw detection, so a person can eyeball it.
const http = require("http");
const fs = require("fs");
const path = require("path");
const puppeteer = require(process.env.PUPPETEER || "puppeteer-core");

const PUBLIC = path.join(__dirname, "../../public");
const photos = process.argv[2];
const chrome = process.argv[3] || "/usr/bin/google-chrome";
const TYPES = { ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".jpg": "image/jpeg", ".png": "image/png", ".html": "text/html" };

const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split("?")[0]);
  const file = u.startsWith("/photos/") ? path.join(photos, u.slice(8)) : path.join(PUBLIC, u);
  if (u === "/") {
    res.writeHead(200, { "Content-Type": "text/html" });
    return res.end('<!doctype html><script src="/js/hubPersonCheck.js"></script>');
  }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
    res.end(buf);
  });
});

(async () => {
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  page.on("console", (m) => console.log("  [page]", m.text()));
  await page.goto(`http://127.0.0.1:${port}/`);
  const files = fs.readdirSync(photos).filter((f) => /\.(jpe?g|png)$/i.test(f));
  const out = await page.evaluate(async (files) => {
    const results = [];
    const t0 = performance.now();
    await window.HubPersonCheck.load();
    results.push({ load_ms: Math.round(performance.now() - t0) });
    for (const f of files) {
      const img = new Image();
      img.src = "/photos/" + f;
      await img.decode();
      const t = performance.now();
      const verdict = await window.HubPersonCheck.check(img);
      const ms = Math.round(performance.now() - t);
      results.push({ f, ms, verdict });
    }
    return results;
  }, files);
  console.log(JSON.stringify(out, null, 1));
  await browser.close();
  server.close();
})().catch((e) => { console.error(e); process.exit(1); });
