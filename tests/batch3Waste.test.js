/**
 * Batch 3a — self-inflicted waste (v1.106.6).
 *
 * Nothing here changes what the app does. Every test asserts that something the app was
 * paying for, and getting nothing back for, has stopped.
 */
const fs = require("fs");
const path = require("path");
const { raw, code } = require("./helpers/source");
const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

describe("W1 — hashed assets are cacheable, the files that point at them are not", () => {
  // Re-evaluate the real middleware against the real source rather than restating it here.
  function loadCacheMiddleware() {
    const src = read("src/server.js");
    const consts = src.match(/const IMMUTABLE_PREFIXES = \[[^\]]*\];\nconst NEVER_CACHE_PATHS = new Set\(\[[^\]]*\]\);/);
    const mw = src.match(/app\.use\(\(req, res, next\) => \{\n  if \(NEVER_CACHE_PATHS[\s\S]*?\n\}\);/);
    expect(consts).toBeTruthy();
    expect(mw).toBeTruthy();
    const body = mw[0].replace(/^app\.use\(/, "const handler = (").replace(/\);$/, ");");
    // eslint-disable-next-line no-new-func
    return new Function(`${consts[0]}\n${body}\nreturn handler;`)();
  }
  const call = (p, query = {}) => {
    const handler = loadCacheMiddleware();
    const headers = {};
    const res = { set: (k, v) => { headers[k] = v; } };
    let nexted = false;
    handler({ path: p, query }, res, () => { nexted = true; });
    return { headers, nexted };
  };

  test("index.html is never cached — a stale one pins users to a build that is gone", () => {
    for (const p of ["/", "/index.html"]) {
      expect(call(p).headers["Cache-Control"]).toMatch(/no-store/);
    }
  });

  test("the service worker and the manifest are never cached either", () => {
    expect(call("/sw.js").headers["Cache-Control"]).toMatch(/no-store/);
    expect(call("/manifest.json").headers["Cache-Control"]).toMatch(/no-store/);
  });

  test("a fingerprinted bundle is cached for a year", () => {
    const h = call("/js-compiled/bundle.js", { v: "build-abc12345" }).headers["Cache-Control"];
    expect(h).toBe("public, max-age=31536000, immutable");
  });

  test("vendor and css get the same treatment when fingerprinted", () => {
    for (const p of ["/vendor/react.production.min.js", "/css/styles.css"]) {
      expect(call(p, { v: "build-abc12345" }).headers["Cache-Control"]).toMatch(/immutable/);
    }
  });

  test("the SAME asset without ?v= is NOT immutable — an unfingerprinted URL must stay recoverable", () => {
    const h = call("/js-compiled/bundle.js").headers["Cache-Control"];
    expect(h).not.toMatch(/immutable/);
    expect(h).toMatch(/max-age=300/);
  });

  test("raw client sources revalidate rather than being cached hard", () => {
    const h = call("/js/app.js").headers["Cache-Control"];
    expect(h).toBe("no-cache, must-revalidate");
    expect(h).not.toMatch(/immutable/);
  });

  test("every path calls next() — the middleware must never terminate a request", () => {
    for (const p of ["/", "/sw.js", "/js-compiled/bundle.js", "/js/app.js", "/api/health"]) {
      expect(call(p, { v: "x" }).nexted).toBe(true);
    }
  });
});

describe("W2 — the source is no longer served", () => {
  test("the build writes maps outside public/", () => {
    const b = code("scripts/build-client.js");
    expect(b).toMatch(/const MAP_DIR = path\.join\(__dirname, "\.\.", "build", "maps"\)/);
    expect(b).toMatch(/writeFileSync\(path\.join\(MAP_DIR, "bundle\.js\.map"\)/);
    expect(b).not.toMatch(/writeFileSync\(path\.join\(OUT_DIR, "bundle\.js\.map"\)/);
  });

  test("the shipped bundle does not advertise where its map is", () => {
    const b = code("scripts/build-client.js");
    const sm = b.slice(b.indexOf("sourceMap: {"), b.indexOf("sourceMap: {") + 200);
    expect(sm).not.toMatch(/url:/);
  });

  test("and the server 404s any .map that turns up in public/ anyway", () => {
    const src = code("src/server.js");
    expect(src).toMatch(/req\.path\.endsWith\("\.map"\)\) return res\.status\(404\)/);
  });

  test("maps are gitignored so they cannot be committed back in", () => {
    const gi = raw(".gitignore");
    expect(gi).toMatch(/public\/js-compiled\/\*\.map/);
    expect(gi).toMatch(/build\/maps\//);
  });

  test("no map file is tracked or present in the static root", () => {
    const dir = path.join(__dirname, "..", "public", "js-compiled");
    expect(fs.readdirSync(dir).filter((f) => f.endsWith(".map"))).toEqual([]);
  });
});

describe("W3 — the cache stamp is content, not clock", () => {
  const b = code("scripts/build-client.js");

  test("the build version is the bundle hash alone", () => {
    expect(b).toMatch(/const buildVersion = `build-\$\{bundleHash\}`;/);
  });

  test("no timestamp goes into it — a restart of unchanged code must not bust every cache", () => {
    expect(b).not.toMatch(/const buildTs\s*=/);
    expect(b).not.toMatch(/buildVersion = `build-\$\{bundleHash\}-/);
  });

  test("the hash still covers both bundles, so an admin-only change is not missed", () => {
    expect(b).toMatch(/update\(coreCode\)\.update\(adminCode\)/);
  });

  test("the committed index.html and sw.js carry the same stamp as each other", () => {
    const idx = raw("public/index.html");
    const sw = raw("public/sw.js");
    const stamps = [...idx.matchAll(/\?v=(build-[a-z0-9]+)/g)].map((m) => m[1]);
    expect(stamps.length).toBeGreaterThan(0);
    expect(new Set(stamps).size).toBe(1);
    expect(sw).toContain(`const SW_VERSION = '${stamps[0]}';`);
  });
});

describe("W4 — boot does not rebuild the client", () => {
  test("npm start no longer runs the 29-second build", () => {
    const pkg = JSON.parse(raw("package.json"));
    expect(pkg.scripts.start).toBe("node scripts/ensure-build.js && node src/server.js");
    expect(pkg.scripts.start).not.toMatch(/npm run build/);
  });

  test("but a missing bundle still gets built rather than white-screening", () => {
    const e = code("scripts/ensure-build.js");
    expect(e).toMatch(/execFileSync/);
    expect(e).toMatch(/build-client\.js/);
  });

  test("and a failed rescue build does not stop the server from booting", () => {
    const e = code("scripts/ensure-build.js");
    const catchBlock = e.slice(e.indexOf("} catch"));
    expect(catchBlock).not.toMatch(/process\.exit\([1-9]/);
  });

  test("terser is a real dependency, since the build now runs where dev deps may be pruned", () => {
    const pkg = JSON.parse(raw("package.json"));
    expect(pkg.dependencies.terser).toBeTruthy();
    expect(pkg.devDependencies.terser).toBeUndefined();
  });

  test("Railway waits for the health check instead of guessing when we are up", () => {
    const rj = JSON.parse(raw("railway.json"));
    expect(rj.deploy.healthcheckPath).toBe("/api/health");
  });
});

describe("W5 — nothing blocks first paint for a feature you are not using", () => {
  const idx = raw("public/index.html");

  test("Stripe.js is not a synchronous script tag any more", () => {
    expect(idx).not.toMatch(/<script src="https:\/\/js\.stripe\.com\/v3\/"><\/script>/);
  });

  test("it loads on demand instead, and the payment form waits for it", () => {
    expect(idx).toMatch(/window\.__loadStripeJs/);
    const f = code("public/js/components/StripePaymentForm.js");
    expect(f).toMatch(/await window\.__loadStripeJs\(\)/);
    expect(f).not.toMatch(/=\s*Stripe\(config\.publishableKey\)/);
  });

  test("the dead Stripe Connect.js tag is gone — nothing has called it since the redirect flow", () => {
    // Assert on TAGS, not on the file: the comment that explains the removal names the host,
    // and `code()` strips JS comments, not HTML ones.
    const tags = idx.match(/<script\b[^>]*>/g) || [];
    expect(tags.filter((t) => /connect-js\.stripe\.com/.test(t))).toEqual([]);
    expect(tags.filter((t) => /js\.stripe\.com/.test(t))).toEqual([]);
    expect(tags.filter((t) => /twilio-video/.test(t))).toEqual([]);
    const clientSrc = fs.readdirSync(path.join(__dirname, "..", "public", "js", "components"))
      .map((f) => read(`public/js/components/${f}`)).join("\n");
    expect(clientSrc).not.toMatch(/loadConnectAndInitialize/);
  });

  test("624 KB of Twilio no longer ships to people who never place a call", () => {
    expect(idx).not.toMatch(/<script src="\/vendor\/twilio-video\.min\.js"><\/script>/);
  });

  test("but the SDK is warmed the moment a call rings, so answering is no slower", () => {
    expect(code("public/js/utils.js")).toMatch(/warmVideoSdk/);
    expect(code("public/js/app.js")).toMatch(/warmVideoSdk\(\)/);
    const m = code("public/js/components/Messages.js");
    expect((m.match(/warmVideoSdk\(\)/g) || []).length).toBeGreaterThanOrEqual(2); // outgoing + incoming
  });

  test("and VideoCallOverlay's own loader is still the thing that guarantees it", () => {
    const v = code("public/js/components/VideoCallOverlay.js");
    expect(v).toMatch(/\/vendor\/twilio-video\.min\.js/);
    expect(v).toMatch(/Video SDK could not be loaded/);
  });
});

describe("W6 — background polls stop when nobody is looking", () => {
  const u = code("public/js/utils.js");
  const a = code("public/js/app.js");

  test("the poll helper skips the tick while the page is hidden", () => {
    expect(u).toMatch(/const run = \(\) => \{ if \(!stopped && document\.visibilityState === 'visible'\) fn\(\); \};/);
  });

  test("and fetches immediately on becoming visible, so the badge is right when seen", () => {
    expect(u).toMatch(/addEventListener\('visibilitychange', onVisible\)/);
    expect(u).toMatch(/removeEventListener\('visibilitychange', onVisible\)/);
  });

  test("all three app.js polls go through it — none is left ticking in a pocket", () => {
    expect((a.match(/startVisiblePoll\(/g) || []).length).toBe(3);
    const polls = a.slice(a.indexOf("Unread message count polling"), a.indexOf("Version heartbeat"));
    expect(polls).not.toMatch(/setInterval\(/);
  });

  test("the Dashboard visibilitychange listener is removed on unmount", () => {
    const d = code("public/js/components/Dashboard.js");
    expect(d).toMatch(/document\.addEventListener\('visibilitychange', onVisible\)/);
    expect(d).toMatch(/document\.removeEventListener\('visibilitychange', onVisible\)/);
    expect(d).not.toMatch(/addEventListener\('visibilitychange', \(\) =>/);
  });
});
