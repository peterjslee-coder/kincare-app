/**
 * The rest of the Batch 1 security set (v1.106.4). Behaviour where it can be exercised
 * directly; source assertions only where the property is structural.
 */
// middleware/auth.js refuses to load without a secret — set it before requiring anything.
process.env.JWT_SECRET = process.env.JWT_SECRET || "batch1-hardening-test-secret";

const path = require("path");
const fs = require("fs");
const { code } = require("./helpers/source");
const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

describe("H1 — a free demo token cannot reach expensive or real-people routes", () => {
  const { denyDemo } = require("../src/middleware/auth");
  const run = async (user) => {
    const res = { statusCode: 0, body: null,
      status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    let nexted = false;
    await denyDemo({ user }, res, () => { nexted = true; });
    return { nexted, res };
  };

  test("a demo token is refused", async () => {
    const r = await run({ id: "u1", demo: true });
    expect(r.nexted).toBe(false);
    expect(r.res.statusCode).toBe(403);
    expect(r.res.body.demoBlocked).toBe(true);
  });

  test("a real session passes straight through", async () => {
    expect((await run({ id: "u1", demo: false })).nexted).toBe(true);
  });

  test("the routes that cost money or expose real people are gated", () => {
    // Anthropic is billed per call; connections returns real families' names and emails;
    // reports sends mail from our own address; video mints a paid Twilio grant.
    expect(code("src/routes/ipaiChat.js")).toMatch(/router\.use\(authenticate, denyDemo\)/);
    expect(code("src/routes/connections.js")).toMatch(/router\.use\(authenticate, denyDemo\)/);
    expect(code("src/routes/reports.js")).toMatch(/router\.use\(authenticate, denyDemo\)/);
    expect(code("src/routes/careIntelligence.js")).toMatch(/authenticate, denyDemo,/);
    expect(code("src/routes/videoCall.js")).toMatch(/authenticate, denyDemo,/);
  });

  test("demo-login is rate limited like every other auth route", () => {
    expect(code("src/server.js")).toMatch(/app\.use\("\/api\/auth\/demo-login", authLimiter\)/);
  });

  test("a demo session may still load demo avatars, just not real people's", () => {
    // Blanket-blocking media would break the demo itself; the boundary is the rule.
    const media = code("src/routes/media.js");
    expect(media).toMatch(/demoBoundaryBlocks/);
    expect(media).toMatch(/req\.user\?\.demo !== true/);
  });
});

describe("M1 — the admin IP gate reads the column admin-ness actually lives in", () => {
  test("it checks is_admin, not the role string", () => {
    const src = code("src/utils/trustedIps.js");
    expect(src).toMatch(/SELECT is_admin FROM users WHERE id = \?/);
    expect(src).not.toMatch(/user\.role !== "admin"/);
  });

  test("the client IP is the one Cloudflare set, not the one the client sent", () => {
    const src = code("src/middleware/auditLog.js");
    // The FIRST X-Forwarded-For entry is client-supplied; every proxy appends.
    expect(src).toMatch(/cf-connecting-ip/);
    expect(src).not.toMatch(/x-forwarded-for"\]\?\.split\(","\)\[0\]/);
  });
});

describe("M5 — the Checkr webhook fails closed", () => {
  const src = code("src/routes/checkr.js");
  test("an unset secret refuses the request instead of skipping verification", () => {
    expect(src).toMatch(/if \(!webhookSecret\)[\s\S]{0,200}503/);
  });
  test("the signature compare is constant time", () => {
    expect(src).toMatch(/timingSafeEqual/);
  });
});

describe("M6 — the hours report cannot carry markup or unlimited mail", () => {
  const src = code("src/routes/reports.js");
  test("caregiver-controlled values are escaped into the HTML", () => {
    expect(src).toMatch(/esc\(user\.first_name\)/);
    expect(src).toMatch(/esc\(profile\.academic_program\)/);
  });
  test("the subject strips line breaks rather than HTML-escaping them", () => {
    // Entity-escaping a header would show the reader "&amp;"; a newline injects headers.
    expect(src).toMatch(/escHeader/);
    expect(src).toMatch(/replace\(\/\[\\r\\n\]\+\/g/);
  });
  test("sending is metered per account", () => {
    expect(src).toMatch(/tooManyReportEmails/);
    expect(src).toMatch(/429/);
  });
});

describe("M7 — a trusted device is a secret, not a guess", () => {
  test("the browser no longer computes a fingerprint from public device traits", () => {
    const login = code("public/js/components/LoginPage.js");
    expect(login).not.toMatch(/getDeviceFingerprint/);
    expect(login).not.toMatch(/navigator\.userAgent, screen\.width/);
  });

  test("the server issues 256 bits of randomness and stores only its hash", () => {
    const src = code("src/middleware/auth.js");
    expect(src).toMatch(/randomBytes\(32\)/);
    expect(src).toMatch(/createHash\("sha256"\)/);
    expect(src).toMatch(/httpOnly: true/);
  });

  test("login matches the cookie, not anything in the request body", () => {
    const src = code("src/routes/auth.js");
    expect(src).toMatch(/readTrustedDeviceHash\(req\)/);
    expect(src).not.toMatch(/const \{ email, password, deviceFingerprint/);
  });

  test("the old guessable rows are deleted, in MIGRATIONS_V2 not the frozen array", () => {
    const db = read("src/models/database.js");
    const v2 = db.slice(db.indexOf("const MIGRATIONS_V2 = ["));
    expect(v2).toMatch(/031_drop_guessable_trusted_devices/);
    expect(v2).toMatch(/DELETE FROM trusted_devices WHERE device_fingerprint LIKE/);
  });

  test("hashing is stable and the raw token never equals what is stored", () => {
    const { issueTrustedDeviceToken } = require("../src/middleware/auth");
    const cookies = [];
    const res = { cookie: (n, v, o) => cookies.push({ n, v, o }) };
    const hash = issueTrustedDeviceToken(res);
    expect(cookies).toHaveLength(1);
    expect(cookies[0].o.httpOnly).toBe(true);
    expect(cookies[0].v).toHaveLength(64);      // 32 random bytes, hex
    expect(hash).toHaveLength(64);              // sha256, hex
    expect(hash).not.toBe(cookies[0].v);        // the database never holds the live secret
  });
});

describe("M3 — you can only ring someone you could already message", () => {
  const src = code("src/server.js");
  test("the target is checked before anything rings", () => {
    expect(src).toMatch(/async function mayCall\(/);
    expect(src).toMatch(/allowed = await mayCall\(userId, data\.targetUserId\)/);
  });
  test("the caller's name comes from the database, not the payload", () => {
    expect(src).not.toMatch(/callerName: data\.callerName/);
    expect(src).toMatch(/socket\.user\.displayName/);
  });
  test("invites are throttled per socket", () => {
    expect(src).toMatch(/callInviteThrottled\(socket\.id\)/);
  });
});

describe("the schema-drift endpoint exists, and shares one parser with the linter", () => {
  test("it compares the code's expectations against information_schema", () => {
    const src = code("src/routes/admin/maintenance.js");
    expect(src).toMatch(/schema-drift/);
    expect(src).toMatch(/information_schema\.columns/);
    expect(src).toMatch(/missingColumns/);
  });
  test("both callers use src/utils/expectedSchema.js", () => {
    expect(code("src/routes/admin/maintenance.js")).toMatch(/expectedSchema/);
    expect(read("scripts/lint-sql-columns.js")).toMatch(/expectedSchema/);
  });
});
