/**
 * Batch 3b — payload weight and the states that looked like failures (v1.106.7).
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || "batch3b-test-secret";

const fs = require("fs");
const path = require("path");
const { raw, code } = require("./helpers/source");

describe("P1 — images travel as URLs, not as JSON", () => {
  const { storedImageUrl } = require("../src/utils/serveMedia");

  test("a base64 data URL becomes this row's own endpoint", () => {
    expect(storedImageUrl("/api/photos", { id: "abc", photo_url: "data:image/jpeg;base64,AAAA" }))
      .toBe("/api/photos/abc/image");
  });

  test("an r2: marker does too — the endpoint resolves it", () => {
    expect(storedImageUrl("/api/photos", { id: "abc", photo_url: "r2:visit/xyz" }))
      .toBe("/api/photos/abc/image");
  });

  test("a real remote URL passes straight through", () => {
    expect(storedImageUrl("/api/photos", { id: "abc", photo_url: "https://cdn.example/a.jpg" }))
      .toBe("https://cdn.example/a.jpg");
  });

  test("no image is null, not a URL to nothing", () => {
    expect(storedImageUrl("/api/photos", { id: "abc" })).toBeNull();
    expect(storedImageUrl("/api/photos", { id: "abc", photo_url: "" })).toBeNull();
  });

  test("the dashboard no longer spreads visit-photo bytes into its response", () => {
    const d = code("src/routes/dashboard.js");
    expect(d).toMatch(/photoUrl: storedImageUrl\("\/api\/photos", p\)/);
    expect(d).not.toMatch(/photoUrl: p\.photo_url/);
  });

  test("nor recipient photo bytes — and it uses the one helper, not a fourth hand-built URL", () => {
    const d = code("src/routes/dashboard.js");
    expect(d).toMatch(/photo: recipientPhotoUrl\(r\)/);
    expect(d).not.toMatch(/`\/api\/media\/recipient\/\$\{[a-z]+\.id\}\/photo`/);
  });

  test("every care-recipient list does the same", () => {
    const c = code("src/routes/careRecipients.js");
    expect((c.match(/photo: recipientPhotoUrl\(/g) || []).length).toBe(3); // self, list, single
  });

  test("and there is still exactly ONE route that serves a care recipient's own photo", () => {
    // The regression this guards is the one I nearly shipped: adding a second
    // GET /:id/photo to careRecipients.js when media.js has had one since v1.66.0 —
    // with the demo-boundary rule attached to it. Other routers stream their OWN media
    // (visit photos, note photos) and join care_recipients for access checks; that is fine.
    const routes = fs.readdirSync(path.join(__dirname, "..", "src", "routes"))
      .filter((f) => f.endsWith(".js"));
    const servers = routes.filter((f) => /router\.get\("\/recipient\/:id\/photo"|SELECT cr\.photo/.test(code(`src/routes/${f}`)));
    expect(servers).toEqual(["media.js"]);
    expect(code("src/routes/careRecipients.js")).not.toMatch(/router\.get\("\/:id\/photo"/);
  });

  test("and exactly one place builds the URL for it", () => {
    const routes = fs.readdirSync(path.join(__dirname, "..", "src", "routes"))
      .filter((f) => f.endsWith(".js"));
    const builders = routes.filter((f) => /`\/api\/media\/recipient\/\$\{/.test(code(`src/routes/${f}`)));
    expect(builders.sort()).toEqual(["careRecipients.js", "media.js"]); // media builds it; careRecipients echoes it after an upload
  });

  test("visit photos stream from photos.js, where their authorization lives", () => {
    const p = code("src/routes/photos.js");
    expect(p).toMatch(/router\.get\("\/:photoId\/image"/);
    expect(p).toMatch(/mayViewPhoto\(db, req\.params\.photoId, req\.user\)/);
    expect(p).toMatch(/sendStoredFile\(res, fileData, \{ allow: IMAGE_MIMES/);
  });

  test("the streamer answers 404, never 403 — probing ids must tell you nothing", () => {
    const p = code("src/routes/photos.js");
    const route = p.slice(p.indexOf('router.get("/:photoId/image"'));
    const handler = route.slice(0, route.indexOf("});"));
    expect(handler).toMatch(/status\(404\)/);
    expect(handler).not.toMatch(/status\(403\)/);
  });

  test("and it refuses to fetch a remote URL on the caller's behalf", () => {
    const p = code("src/routes/photos.js");
    const route = p.slice(p.indexOf('router.get("/:photoId/image"'));
    expect(route.slice(0, 900)).toMatch(/https\?:\\\/\\\/[\s\S]{0,120}status\(404\)/);
    expect(route.slice(0, 900)).not.toMatch(/res\.redirect/);
  });

  test("the photo list endpoints return URLs in the same field the client already reads", () => {
    const p = code("src/routes/photos.js");
    expect((p.match(/photo_url: photoUrlFor\(p\)/g) || []).length).toBe(2);
  });

  test("photoUrlFor is declared before its first use — a const arrow does not hoist", () => {
    const p = raw("src/routes/photos.js");
    const declaredAt = p.indexOf("const photoUrlFor =");
    const usedAt = p.indexOf("photoUrlFor(p)");
    // Both must EXIST. Without this, deleting the declaration makes indexOf return -1, which
    // is less than everything, and the assertion passes having verified nothing.
    expect(declaredAt).toBeGreaterThan(-1);
    expect(usedAt).toBeGreaterThan(-1);
    expect(declaredAt).toBeLessThan(usedAt);
  });
});

describe("P2 — a returning user is not shown the marketing page", () => {
  const a = code("public/js/app.js");

  test("an active session enters 'restoring' before /me is even asked", () => {
    expect(a).toMatch(/if \(hasActiveSession\) setAppState\(\(prev\) => \(prev === 'splash' \? 'restoring' : prev\)\)/);
  });

  test("there is a screen for it that says what is happening", () => {
    expect(a).toMatch(/appState === 'restoring'/);
    expect(a).toMatch(/Reconnecting…/);
  });

  test("a transient failure retries with backoff rather than being swallowed", () => {
    // TWO call sites use this expression — the top-level kick-off and the one inside
    // retryRestore's setTimeout. Assert both, or breaking the kick-off passes on the other.
    expect((a.match(/attemptRestore\(\)\.catch\(retryRestore\)/g) || []).length).toBe(2);
    expect(a).toMatch(/Math\.min\(1000 \* Math\.pow\(2, restoreAttempt - 1\), 8000\)/);
    expect(a).not.toMatch(/attemptRestore\(\)\.catch\(\(\) => \{\}\)/);
  });

  test("it gives up after a bounded time instead of spinning forever", () => {
    expect(a).toMatch(/RESTORE_DEADLINE_MS = 60000/);
    expect(a).toMatch(/Date\.now\(\) - restoreStartedAt > RESTORE_DEADLINE_MS/);
  });

  test("a 401 is treated as final, and clears the session flag", () => {
    expect(a).toMatch(/r\.status === 401\) return restoreFailed\(true\)/);
    expect(a).toMatch(/if \(permanent\) \{ try \{ window\.__setSessionActive\(false\); \} catch \{\} \}/);
  });

  test("every terminal branch leaves 'restoring' — a demo session and a userless 200 included", () => {
    // The demo branch and the userless-200 branch both end in restoreFailed(true); assert the
    // CODE, not the comments beside it — code() strips line-owning comments by design.
    expect((a.match(/return restoreFailed\(true\)/g) || []).length).toBe(3); // demo, no-user, 401
    const restore = a.slice(a.indexOf("const attemptRestore"), a.indexOf("const retryRestore"));
    expect(restore).toMatch(/is_demo\)[\s\S]{0,220}return restoreFailed\(true\)/);
    expect(restore).toMatch(/\} else \{\s*return restoreFailed\(true\);\s*\}/);
  });
});

describe("P3 — the server tells an incompatible client, instead of failing oddly", () => {
  const s = code("src/server.js");

  // Run the real middleware rather than reading it. A source assertion here passes happily
  // against `return next(); return res.status(426)...` — it verifies the text, not the gate.
  function loadVersionGate() {
    const src = raw("src/server.js");
    const consts = src.match(/const MIN_APP_VERSION = "[\d.]+";[\s\S]*?const VERSION_GATE_EXEMPT = \[[^\]]*\];/);
    const mw = src.match(/app\.use\("\/api\/", \(req, res, next\) => \{\n  const full[\s\S]*?\n\}\);/);
    expect(consts).toBeTruthy();
    expect(mw).toBeTruthy();
    const body = mw[0].replace(/^app\.use\("\/api\/", /, "const handler = (").replace(/\);$/, ");");
    // eslint-disable-next-line no-new-func
    return new Function(`${consts[0]}\n${body}\nreturn handler;`)();
  }
  const callGate = (url, version) => {
    const handler = loadVersionGate();
    const out = { headers: {}, status: 0, body: null, nexted: false };
    const res = {
      set: (k, v) => { out.headers[k] = v; },
      status(c) { out.status = c; return this; },
      json(b) { out.body = b; return this; },
    };
    handler({ originalUrl: url, path: url, headers: version ? { "x-app-version": version } : {} },
            res, () => { out.nexted = true; });
    return out;
  };

  // Staging caught what the handler tests could not: the gate was REGISTERED after every
  // router, so Express handed /api/dashboard to the dashboard router and the gate never ran.
  // A correct middleware mounted in the wrong place is an unmounted middleware.
  test("the gate is registered BEFORE the routers it is supposed to guard", () => {
    const src = raw("src/server.js");
    const gateAt = src.indexOf('app.use("/api/", (req, res, next) => {\n  const full');
    const firstRouter = src.indexOf('app.use("/api/auth", require("./routes/auth"));');
    expect(gateAt).toBeGreaterThan(-1);
    expect(firstRouter).toBeGreaterThan(-1);
    expect(gateAt).toBeLessThan(firstRouter);
  });

  test("and after the rate limiters, so a flood is refused before it is version-checked", () => {
    const src = raw("src/server.js");
    expect(src.indexOf('app.use("/api/", apiLimiter);'))
      .toBeLessThan(src.indexOf('app.use("/api/", (req, res, next) => {\n  const full'));
  });

  test("an out-of-date client is actually turned away, with the minimum it needs", () => {
    const r = callGate("/api/dashboard", "1.105.113");
    expect(r.nexted).toBe(false);
    expect(r.status).toBe(426);
    expect(r.headers["X-Min-App-Version"]).toBe("1.106.0");
    expect(r.body.upgradeRequired).toBe(true);
  });

  test("a current client passes", () => {
    expect(callGate("/api/dashboard", "1.106.7").nexted).toBe(true);
    expect(callGate("/api/dashboard", "1.106.0").nexted).toBe(true);
  });

  test("no header, or a nonsense one, passes — webhooks and native shells send none", () => {
    expect(callGate("/api/dashboard", null).nexted).toBe(true);
    expect(callGate("/api/dashboard", "banana").nexted).toBe(true);
  });

  test("the recovery paths pass even for an ancient client", () => {
    for (const p of ["/api/version", "/api/health", "/api/auth/me", "/api/payments/webhook", "/api/checkr/webhook"]) {
      expect(callGate(p, "1.0.0").nexted).toBe(true);
    }
  });

  test("MIN_APP_VERSION is NOT the current version — bumping it every deploy would reload everyone", () => {
    const min = s.match(/const MIN_APP_VERSION = "([\d.]+)"/)[1];
    const app = s.match(/const APP_VERSION = "([\d.]+)"/)[1];
    expect(min).not.toBe(app);
    const [a1, a2, a3] = app.split(".").map(Number);
    const [m1, m2, m3] = min.split(".").map(Number);
    expect(m1 < a1 || (m1 === a1 && (m2 < a2 || (m2 === a2 && m3 <= a3)))).toBe(true);
  });

  test("a missing or unparseable header passes — webhooks and native shells do not send one", () => {
    expect(s).toMatch(/if \(!client\) return next\(\);/);
    expect(s).toMatch(/if \(!min \|\| !isOlder\(client, min\)\) return next\(\);/);
  });

  test("the recovery paths are exempt, or a stuck client could never get unstuck", () => {
    const list = s.match(/const VERSION_GATE_EXEMPT = \[([^\]]*)\]/)[1];
    for (const p of ["/api/version", "/api/health", "/api/auth/", "/api/payments/webhook", "/api/checkr/webhook"]) {
      expect(list).toContain(p);
    }
  });

  test("version comparison is numeric, not lexical — 1.106.7 is newer than 1.99.0", () => {
    const fn = s.match(/function parseVersion[\s\S]*?\n\}\n\nfunction isOlder[\s\S]*?\n\}/)[0];
    // eslint-disable-next-line no-new-func
    const { parseVersion, isOlder } = new Function(`${fn}\nreturn { parseVersion, isOlder };`)();
    expect(isOlder(parseVersion("1.99.0"), parseVersion("1.106.7"))).toBe(true);
    expect(isOlder(parseVersion("1.106.7"), parseVersion("1.99.0"))).toBe(false);
    expect(isOlder(parseVersion("1.106.7"), parseVersion("1.106.7"))).toBe(false);
    expect(parseVersion("not-a-version")).toBeNull();
  });

  test("the client reloads on 426, but a bounded number of times", () => {
    const u = code("public/js/utils.js");
    expect(u).toMatch(/response\.status === 426/);
    expect(u).toMatch(/prior\.length < 3/);
    expect(u).toMatch(/now - prior\[prior\.length - 1\] > 60000/);
    expect(u).toMatch(/window\.location\.reload\(\)/);
  });
});

describe("P4 — the caregiver hub stops waiting on itself", () => {
  const h = code("public/js/components/CaretakerHub.js");

  test("the independent calls no longer sit inside `if (res?.ok)` after the await", () => {
    const fetchData = h.slice(h.indexOf("const fetchData = async () => {"), h.indexOf("setLoading(false);"));
    const awaitAt = fetchData.indexOf("await apiFetch('/api/dashboard')");
    expect(awaitAt).toBeGreaterThan(-1);
    for (const call of ["fetchAvailability()", "/api/caregivers/platform-config", "/api/referrals/my-code",
                        "/api/referrals/list", "/api/referrals/milestones", "/api/push/notifications"]) {
      expect(fetchData.indexOf(call)).toBeGreaterThan(-1);
      expect(fetchData.indexOf(call)).toBeLessThan(awaitAt);
    }
  });

  test("Stripe status is asked for once per mount, not twice", () => {
    const fetchData = h.slice(h.indexOf("const fetchData = async () => {"), h.indexOf("setLoading(false);"));
    expect(fetchData).not.toMatch(/connect\/status/);
    // The mount effect asks once; the ONLY other call is the deliberate refresh after coming
    // back from Stripe onboarding, and that one bypasses the cache on purpose.
    expect((h.match(/apiFetch\('\/api\/payments\/connect\/status'\)/g) || []).length).toBe(1);
    expect((h.match(/apiFetch\('\/api\/payments\/connect\/status\?fresh=1'\)/g) || []).length).toBe(1);
  });

  test("a caregiver returning from Stripe is never shown a cached answer", () => {
    const p = code("src/routes/payments.js");
    expect(p).toMatch(/retrieveConnectAccount\(stripe, profile\.stripe_account_id, req\.query\.fresh === "1"\)/);
    expect(p).toMatch(/const hit = fresh \? null : _connectAccountCache\.get\(accountId\)/);
  });

  test("and the server caches the live Stripe lookup behind it", () => {
    const p = code("src/routes/payments.js");
    expect(p).toMatch(/const CONNECT_CACHE_MS = 60 \* 1000/);
    expect(p).toMatch(/await retrieveConnectAccount\(stripe, profile\.stripe_account_id, /);
    expect(p).not.toMatch(/await stripe\.accounts\.retrieve\(profile\.stripe_account_id\)/);
  });

  test("an error is never cached — only a successful retrieve is remembered", () => {
    const p = code("src/routes/payments.js");
    const start = p.indexOf("async function retrieveConnectAccount");
    const fn = p.slice(start, p.indexOf("\n}", start) + 2);
    expect(fn.indexOf("const account = await stripe.accounts.retrieve"))
      .toBeLessThan(fn.indexOf("_connectAccountCache.set"));
    expect(fn).not.toMatch(/catch/);
  });

  test("the account.updated webhook drops the cache, so onboarding shows up at once", () => {
    const p = code("src/routes/payments.js");
    const hook = p.slice(p.indexOf('case "account.updated"'), p.indexOf('case "account.updated"') + 700);
    expect(hook).toMatch(/invalidateConnectAccount\(account\.id\)/);
  });
});
