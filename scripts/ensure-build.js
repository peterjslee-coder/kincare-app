#!/usr/bin/env node
/**
 * A safety net, not a build step (v1.106.6).
 *
 * `npm start` used to be `npm run build && node src/server.js`, so every boot — including
 * every crash-loop restart — spent 29 seconds running Babel and terser before the process
 * would answer a single request. That is the whole per-deploy 502 window, and it was pure
 * duplication: Nixpacks already runs `npm run build` in the BUILD phase because package.json
 * has a `build` script, and the built bundle is committed besides.
 *
 * So start is now `node scripts/ensure-build.js && node src/server.js`, and this file exists
 * only to answer one question: is there a bundle to serve? Almost always yes, and we cost the
 * boot a stat() call. If the answer is ever no — a build phase that silently didn't run, an
 * image built from a tree without the artifact — we build it here rather than serving a white
 * screen, because a slow boot beats a broken one.
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const BUNDLES = [
  path.join(__dirname, "..", "public", "js-compiled", "bundle.js"),
  path.join(__dirname, "..", "public", "js-compiled", "bundle-admin.js"),
];

const missing = BUNDLES.filter((p) => {
  try { return fs.statSync(p).size < 1024; } catch { return true; }
});

if (missing.length === 0) {
  console.log("  [ensure-build] client bundles present — skipping build (built at image build time)");
  process.exit(0);
}

console.warn(`  [ensure-build] MISSING: ${missing.map((p) => path.basename(p)).join(", ")}`);
console.warn("  [ensure-build] the build phase did not produce a bundle. Building now — this adds ~30s to boot.");
try {
  execFileSync(process.execPath, [path.join(__dirname, "build-client.js")], { stdio: "inherit" });
} catch (err) {
  console.error("  [ensure-build] build FAILED. Starting anyway so /api/health can answer and", err.message);
  console.error("  [ensure-build] the API keeps serving the native apps, but the web client will not load.");
}
