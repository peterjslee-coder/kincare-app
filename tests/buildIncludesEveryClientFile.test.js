// v1.166.2 — public/js/hubPersonCheck.js shipped in v1.160.0 but was never added to the build's
// file list, so window.HubPersonCheck never existed on a real Hub. The headless test loaded the
// file directly and passed. Every client file must be in the build, or deliberately excluded.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const EXCLUDED = new Set([]); // add a path here, with a reason, to leave a file out on purpose

test("every file in public/js and public/js/components is in scripts/build-client.js", () => {
  const src = fs.readFileSync(path.join(ROOT, "scripts/build-client.js"), "utf8");
  const listed = new Set([...src.matchAll(/"(js\/[^"]+\.js)"/g)].map((m) => m[1]));
  const all = [
    ...fs.readdirSync(path.join(ROOT, "public/js")).filter((f) => f.endsWith(".js")).map((f) => "js/" + f),
    ...fs.readdirSync(path.join(ROOT, "public/js/components")).filter((f) => f.endsWith(".js")).map((f) => "js/components/" + f),
  ];
  const missing = all.filter((f) => !listed.has(f) && !EXCLUDED.has(f));
  expect(missing).toEqual([]);
});

test("the built bundle carries the Hub's person check", () => {
  const bundle = fs.readFileSync(path.join(ROOT, "public/js-compiled/bundle.js"), "utf8");
  expect(bundle).toMatch(/HubPersonCheck\s*=\s*\{/);
  expect(bundle).toMatch(/vision_bundle\.mjs/);
});
