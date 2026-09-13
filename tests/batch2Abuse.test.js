/**
 * Batch 2 — abuse and denial-of-service (v1.106.5).
 *
 * The controls here all share a shape: they are cheap in the honest case and only bite on
 * traffic no real user produces. Each test below tries to prove the bite, not the shape.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || "batch2-abuse-test-secret";

const path = require("path");
const fs = require("fs");
const { raw, code } = require("./helpers/source");
const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

describe("A1 — a socket cannot be used as an unmetered event firehose", () => {
  // socketEventAllowed is module-private in server.js (requiring server.js starts a listener).
  // Re-evaluate just that function against the real source so the test cannot drift from it.
  function loadThrottle() {
    const src = read("src/server.js");
    const m = src.match(/const MAX_EVENTS_PER_10S = (\d+);/);
    const fn = src.match(/const _socketEvents = new Map\(\);[\s\S]*?\n\}/);
    expect(m).toBeTruthy();
    expect(fn).toBeTruthy();
    const factory = new Function(
      `const MAX_EVENTS_PER_10S = ${m[1]};\n${fn[0]}\nreturn { socketEventAllowed, _socketEvents, MAX_EVENTS_PER_10S };`
    );
    return factory();
  }

  test("the first event on a fresh socket is allowed", () => {
    const { socketEventAllowed } = loadThrottle();
    expect(socketEventAllowed("s1")).toBe(true);
  });

  test("a burst is allowed right up to the cap and refused after it", () => {
    const { socketEventAllowed, MAX_EVENTS_PER_10S } = loadThrottle();
    let allowed = 0;
    for (let i = 0; i < MAX_EVENTS_PER_10S; i++) if (socketEventAllowed("s2")) allowed++;
    expect(allowed).toBe(MAX_EVENTS_PER_10S);
    expect(socketEventAllowed("s2")).toBe(false);
    expect(socketEventAllowed("s2")).toBe(false);
  });

  test("the window rolls — an old burst does not hold the socket down forever", () => {
    const { socketEventAllowed, _socketEvents, MAX_EVENTS_PER_10S } = loadThrottle();
    for (let i = 0; i <= MAX_EVENTS_PER_10S; i++) socketEventAllowed("s3");
    expect(socketEventAllowed("s3")).toBe(false);
    _socketEvents.get("s3").windowStart = Date.now() - 10001;
    expect(socketEventAllowed("s3")).toBe(true);
  });

  test("one noisy socket does not throttle a quiet one", () => {
    const { socketEventAllowed, MAX_EVENTS_PER_10S } = loadThrottle();
    for (let i = 0; i <= MAX_EVENTS_PER_10S; i++) socketEventAllowed("loud");
    expect(socketEventAllowed("loud")).toBe(false);
    expect(socketEventAllowed("quiet")).toBe(true);
  });

  test("the throttle is mounted as socket middleware, not bolted onto one handler", () => {
    const src = code("src/server.js");
    expect(src).toMatch(/socket\.use\(\(packet, next\) => \{[\s\S]*?socketEventAllowed\(socket\.id\)/);
  });

  test("both per-socket maps are cleaned up on disconnect so they cannot grow forever", () => {
    const src = code("src/server.js");
    const dis = src.slice(src.indexOf('socket.on("disconnect"'));
    expect(dis).toMatch(/_socketEvents\.delete\(socket\.id\)/);
    expect(dis).toMatch(/_callRate\.delete\(socket\.id\)/);
  });

  test("one account cannot hold an unbounded number of sockets", () => {
    const src = code("src/server.js");
    expect(src).toMatch(/const MAX_SOCKETS_PER_USER = \d+/);
    expect(src).toMatch(/existing\.size >= MAX_SOCKETS_PER_USER[\s\S]{0,300}socket\.disconnect\(true\)/);
  });

  test("the websocket frame size is bounded", () => {
    const src = code("src/server.js");
    const m = src.match(/maxHttpBufferSize:\s*([^,\n]+)/);
    expect(m).toBeTruthy();
    // eslint-disable-next-line no-new-func
    expect(new Function(`return ${m[1]}`)()).toBeLessThanOrEqual(256 * 1024);
  });
});

describe("A2 — the geocode cache", () => {
  const { geocodeCacheKey } = require("../src/utils/geocode");

  test("addresses that differ only in punctuation, case and spacing share one key", () => {
    const a = geocodeCacheKey("123 Main St., Blacksburg, VA 24060");
    const b = geocodeCacheKey("  123 main st  Blacksburg VA 24060 ");
    expect(a).toBe(b);
  });

  test("genuinely different addresses do not collide", () => {
    expect(geocodeCacheKey("123 Main St, Blacksburg VA"))
      .not.toBe(geocodeCacheKey("125 Main St, Blacksburg VA"));
  });

  test("the key is bounded, so a megabyte of query string cannot become a megabyte row", () => {
    expect(geocodeCacheKey("a".repeat(50000)).length).toBeLessThanOrEqual(300);
  });

  test("outbound calls are spaced and the queue has a ceiling", () => {
    const src = code("src/utils/geocode.js");
    expect(src).toMatch(/NOMINATIM_MIN_INTERVAL_MS = \d+/);
    expect(src).toMatch(/NOMINATIM_MAX_QUEUE = \d+/);
    expect(src).toMatch(/_geoQueueDepth >= NOMINATIM_MAX_QUEUE/);
  });

  test("every geocode call goes through the cache — nothing calls Nominatim directly", () => {
    const src = code("src/utils/geocode.js");
    const hits = src.match(/nominatim\.openstreetmap\.org/g) || [];
    expect(hits.length).toBe(1);
    // and that single call site is inside the uncached helper the queue wraps
    const uncached = src.slice(src.indexOf("async function _geocodeUncached"));
    expect(uncached).toMatch(/nominatim\.openstreetmap\.org/);
  });

  test("the user-facing address search spends a per-account daily budget", () => {
    const src = code("src/routes/caregivers.js");
    expect(src).toMatch(/consumeDaily\(req\.user\.id, "geocode_lookup", \d+\)/);
    expect(src).toMatch(/geoQuota\.allowed[\s\S]{0,200}geocodeAddress\(address\)/);
  });

  test("address autocomplete does too", () => {
    const src = code("src/routes/geocode.js");
    expect(src).toMatch(/consumeDaily\(req\.user\.id, "address_suggest", \d+\)/);
    // and the cache is consulted before the budget, so typing the same thing twice is free
    expect(src.indexOf("cacheGet(key)")).toBeLessThan(src.indexOf("address_suggest"));
  });
});

describe("A3 — outbound email cannot be amplified at a third party", () => {
  const email = require("../src/utils/email");

  beforeEach(() => email._resetEmailThrottle());

  test("the identical message twice inside a minute is sent once", async () => {
    const a = await email.sendEmail({ to: "victim@example.com", subject: "Reset", html: "<p>same</p>" });
    const b = await email.sendEmail({ to: "victim@example.com", subject: "Reset", html: "<p>same</p>" });
    expect(b.suppressed).toBe(true);
    expect(b.error).toBe("duplicate_suppressed");
    // the first one was not suppressed — it failed for the ordinary reason (no API key in test)
    expect(a.suppressed).toBeUndefined();
  });

  test("two DIFFERENT notifications with the same subject both go out", async () => {
    const a = await email.sendEmail({ to: "p@example.com", subject: "New message", html: "<p>one</p>" });
    const b = await email.sendEmail({ to: "p@example.com", subject: "New message", html: "<p>two</p>" });
    expect(a.suppressed).toBeUndefined();
    expect(b.suppressed).toBeUndefined();
  });

  test("the same message to two different people is not a duplicate", async () => {
    const a = await email.sendEmail({ to: "one@example.com", subject: "Invite", html: "<p>x</p>" });
    const b = await email.sendEmail({ to: "two@example.com", subject: "Invite", html: "<p>x</p>" });
    expect(a.suppressed).toBeUndefined();
    expect(b.suppressed).toBeUndefined();
  });

  test("there is a per-address daily ceiling, keyed on the address and not the IP", () => {
    const src = code("src/utils/email.js");
    expect(src).toMatch(/MAX_EMAILS_PER_ADDRESS_PER_DAY = \d+/);
    expect(src).toMatch(/consumeDaily\(_addressKey\(to\), "outbound_email", MAX_EMAILS_PER_ADDRESS_PER_DAY\)/);
  });

  test("a counter failure sends the mail rather than swallowing it", () => {
    const src = code("src/utils/email.js");
    expect(src).toMatch(/consumeDaily[\s\S]{0,400}\} catch \{[^}]*\}/);
  });

  test("every unauthenticated route that emails a stranger is rate limited", () => {
    const src = code("src/server.js");
    for (const p of ["/api/auth/signup-intent", "/api/password-reset", "/api/auth/resend-verification", "/api/consent/respond"]) {
      expect(src).toContain(`app.use("${p}", authLimiter)`);
    }
  });
});

describe("A4 — no statement runs forever", () => {
  const src = code("src/models/database.js");

  test("the pool puts a deadline on every connection", () => {
    expect(src).toMatch(/pool\.on\("connect"[\s\S]{0,300}SET statement_timeout = \d+/);
  });

  test("the deadline is a backstop, not a latency budget — at least 10s", () => {
    const m = src.match(/SET statement_timeout = (\d+)/);
    expect(Number(m[1])).toBeGreaterThanOrEqual(10000);
  });

  test("failing to set it does not take the database down", () => {
    expect(src).toMatch(/SET statement_timeout = \d+"\)\.catch\(/);
  });

  test("migrations lift it, because an index build legitimately exceeds it", () => {
    const runner = src.slice(src.indexOf("for (const m of MIGRATIONS_V2)"));
    expect(runner).toMatch(/SET LOCAL statement_timeout = 0/);
    // SET LOCAL, not SET: the client must go back into the pool with the deadline restored
    expect(runner).not.toMatch(/tx\.exec\("SET statement_timeout/);
  });
});

describe("A5 — daily usage counters", () => {
  const src = code("src/utils/usageLimits.js");

  test("the increment is one atomic statement, so two concurrent requests cannot both pass", () => {
    expect(src).toMatch(/INSERT INTO usage_counters[\s\S]*?ON CONFLICT \(user_id, kind, day\)[\s\S]*?DO UPDATE SET count = usage_counters\.count \+ 1[\s\S]*?RETURNING count/);
  });

  test("a database failure fails open, and is reported", () => {
    expect(src).toMatch(/captureException/);
    expect(src).toMatch(/return \{ allowed: true/);
  });

  test("the upload ceiling is counted in bytes before the body is stored", () => {
    expect(src).toMatch(/content-length/);
    expect(src).toMatch(/consumeDailyAmount\(req\.user\.id, "upload_bytes", bytes, limitBytes\)/);
  });

  test("every route that writes a blob is behind the upload quota", () => {
    for (const f of ["notes", "photos", "familyVisits", "reimbursements", "messages", "caregiveronboarding"]) {
      expect(code(`src/routes/${f}.js`)).toMatch(/router\.use\(authenticate, uploadQuota\(\)\)/);
    }
  });

  test("the iPAi cap is durable, not a Map that a deploy resets", () => {
    const ipai = code("src/utils/ipaiChat.js");
    expect(ipai).toMatch(/consumeDaily\([^)]*"ipai_message"/);
  });

  test("the counters table and its index exist as a migration", () => {
    const db = raw("src/models/database.js");
    expect(db).toMatch(/id: "032_usage_counters"/);
    expect(db).toMatch(/CREATE TABLE IF NOT EXISTS usage_counters/);
    expect(db).toMatch(/id: "033_geocode_cache"/);
  });
});

describe("A6 — a refused socket does not knock forever", () => {
  const src = code("public/js/utils.js");

  test("the client listens for the refusal the server sends", () => {
    expect(src).toMatch(/_socket\.on\('connect_error_reason'/);
    expect(src).toMatch(/too_many_connections/);
  });

  test("it turns socket.io's automatic reconnection off, rather than relying on the user", () => {
    expect(src).toMatch(/_socket\.io\.opts\.reconnection = false/);
  });

  test("the liveness probe does not undo that by reconnecting on the next tab focus", () => {
    const probe = src.slice(src.indexOf("function probeSocket()"), src.indexOf("window.__probeSocket"));
    expect(probe).toMatch(/_refusedForConnectionCap/);
    expect(probe.indexOf("_refusedForConnectionCap")).toBeLessThan(probe.indexOf("sock.connect()"));
  });

  test("a successful connect clears the flag, so closing a tab actually recovers", () => {
    expect(src).toMatch(/_socket\.on\('connect', \(\) => \{ _refusedForConnectionCap = false/);
  });
});
