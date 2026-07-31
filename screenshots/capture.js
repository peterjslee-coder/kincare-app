#!/usr/bin/env node
/**
 * App Store Connect screenshot capture for InPlace.
 *
 * Produces Apple's exact iPhone-only pixel sizes:
 *   6.7" — 1290 x 2796  (430 x 932 CSS @ dsf 3)
 *   6.1" — 1179 x 2556  (393 x 852 CSS @ dsf 3)
 *
 * By default this boots everything it needs (embedded PostgreSQL -> seed ->
 * `node src/server.js`), logs in as a seeded DEMO family account, captures five
 * screens at both sizes, then tears the stack back down.
 *
 * Usage:
 *   node screenshots/capture.js                      # boot everything, capture, tear down
 *   node screenshots/capture.js --base-url http://127.0.0.1:3001
 *                                                    # use an already-running server
 *   node screenshots/capture.js --keep-server        # leave pg + server running afterwards
 *   node screenshots/capture.js --headed             # non-headless (debugging)
 *
 * NOTHING in this script touches Stripe: js.stripe.com / connect-js.stripe.com /
 * checkr.com / plausible.io are aborted at the network layer, and no payment
 * screen is ever visited.
 *
 * See screenshots/README.md for the gotchas.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { execFileSync, spawn } = require("child_process");

const REPO = path.join(__dirname, "..");
const OUT_DIR = path.join(__dirname, "out");
const PW = "/home/claude/.npm-global/lib/node_modules/playwright";

// ─────────────────────────────── config ───────────────────────────────

const DEVICES = [
  { name: "6.7", label: "6_7-1290x2796", css: { width: 430, height: 932 }, dsf: 3, expect: [1290, 2796] },
  { name: "6.1", label: "6_1-1179x2556", css: { width: 393, height: 852 }, dsf: 3, expect: [1179, 2556] },
];

// Seeded demo accounts (src/seed.js). NOTE: the seed no longer creates
// pete@ / betty@ — the family is Paul Lowe caring for Barbara Lowe.
const FAMILY = { email: "paul@inplace.care", password: "inplace123" };

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

const BLOCKED = /(js\.stripe\.com|connect-js\.stripe\.com|stripe\.com|checkr\.com|plausible\.io|google-analytics)/;

const PG_PORT = Number(process.env.SHOTS_PG_PORT || 5599);
const PG_DATA = process.env.SHOTS_PG_DATA || "/tmp/inplace-shots-pg";
const APP_PORT = Number(process.env.SHOTS_APP_PORT || 3011);
const PG_URL = `postgresql://inplace@127.0.0.1:${PG_PORT}/postgres`;

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };

// ─────────────────────────────── helpers ───────────────────────────────

const log = (...a) => console.log("[shots]", ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function chromePath() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  const roots = ["/opt/pw-browsers"];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const dirs = fs.readdirSync(root).filter((d) => d.startsWith("chromium-")).sort().reverse();
    for (const d of dirs) {
      const p = path.join(root, d, "chrome-linux", "chrome");
      if (fs.existsSync(p)) return p;
    }
  }
  return undefined; // let playwright resolve its default
}

/** initdb/postgres refuse to run as root — drop to the `claude` user when needed. */
function pgExec(bin, args) {
  const exe = path.join(REPO, "node_modules/@embedded-postgres/linux-x64/native/bin", bin);
  if (!fs.existsSync(exe)) {
    throw new Error(`embedded postgres binary missing: ${exe} (run npm install)`);
  }
  if (process.getuid && process.getuid() === 0) {
    return execFileSync("runuser", ["-u", "claude", "--", exe, ...args], { stdio: "pipe" });
  }
  return execFileSync(exe, args, { stdio: "pipe" });
}

function httpOk(url) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 2000 }, (res) => { res.resume(); resolve(res.statusCode < 500); });
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
  });
}

async function waitForServer(url, tries = 90) {
  for (let i = 0; i < tries; i++) {
    if (await httpOk(url)) return true;
    await sleep(1000);
  }
  return false;
}

/** Is a URL fetchable from this machine at all? Used to decide about avatars. */
function reachable(url) {
  try {
    execFileSync("curl", ["-sSf", "-m", "6", "-o", "/dev/null", url], { stdio: "pipe" });
    return true;
  } catch { return false; }
}

// ─────────────────────────── stack boot / teardown ───────────────────────────

const cleanups = [];

async function bootStack() {
  // 1. embedded postgres
  log("starting embedded postgres on", PG_PORT);
  fs.rmSync(PG_DATA, { recursive: true, force: true });
  fs.mkdirSync(PG_DATA, { recursive: true });
  fs.chmodSync(PG_DATA, 0o777);
  if (process.getuid && process.getuid() === 0) {
    try { execFileSync("chown", ["-R", "claude:claude", PG_DATA]); } catch {}
  }
  pgExec("initdb", ["-D", PG_DATA, "-U", "inplace", "--auth=trust", "--no-sync", "-E", "UTF8"]);
  pgExec("pg_ctl", [
    "-D", PG_DATA, "-w", "-t", "60",
    "-o", `-p ${PG_PORT} -c listen_addresses=127.0.0.1 -c fsync=off -c unix_socket_directories='${PG_DATA}'`,
    "-l", path.join(PG_DATA, "pg.log"), "start",
  ]);
  if (!flag("--keep-server")) {
    cleanups.push(() => { try { pgExec("pg_ctl", ["-D", PG_DATA, "-w", "-m", "immediate", "stop"]); } catch {} });
  }

  const env = {
    ...process.env,
    DATABASE_URL: PG_URL,
    JWT_SECRET: process.env.JWT_SECRET || "screenshots-local-only-secret",
    NODE_ENV: "development",
    PORT: String(APP_PORT),
    // belt & braces: no Stripe/Twilio/Resend credentials in this process
    STRIPE_SECRET_KEY: "", STRIPE_PUBLISHABLE_KEY: "", STRIPE_WEBHOOK_SECRET: "",
    RESEND_API_KEY: "", TWILIO_ACCOUNT_SID: "", TWILIO_AUTH_TOKEN: "", SENTRY_DSN: "",
  };

  // 2. seed
  log("seeding demo data");
  execFileSync(process.execPath, [path.join(REPO, "src/seed.js")], { cwd: REPO, env, stdio: "pipe" });

  // 3. screenshot-mode data tweaks (see README)
  await prepDemoData(env);

  // 4. app server
  log("starting app server on", APP_PORT);
  const logFd = fs.openSync("/tmp/inplace-shots-server.log", "a");
  const server = spawn(process.execPath, [path.join(REPO, "src/server.js")], {
    cwd: REPO, env, stdio: ["ignore", logFd, logFd], detached: true,
  });
  server.unref(); // otherwise --keep-server means this process never exits
  if (!flag("--keep-server")) {
    cleanups.push(() => { try { process.kill(-server.pid, "SIGKILL"); } catch { try { server.kill("SIGKILL"); } catch {} } });
  }

  const base = `http://127.0.0.1:${APP_PORT}`;
  if (!(await waitForServer(base + "/"))) {
    throw new Error("app server never became healthy — see /tmp/inplace-shots-server.log");
  }
  return base;
}

/**
 * Two adjustments to the throwaway screenshot database. Neither invents data;
 * both remove things that only exist because this is a local demo box.
 *
 *  a) is_demo=0 / email_verified=1 — otherwise every screen is wrapped in the
 *     purple "DEMO … Exit Demo" persona bar and an "unverified email" banner,
 *     which no real App Store user would ever see.
 *  b) avatar_url/profile_photo point at i.pravatar.cc. If that host is not
 *     reachable the components render a broken <img> (alt text + torn-page
 *     icon). Clearing them makes the app fall back to its own initials avatars.
 *     Skipped when pravatar IS reachable, so a networked machine keeps photos.
 */
async function prepDemoData(env) {
  const { Pool } = require(path.join(REPO, "node_modules/pg"));
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  try {
    // account_approved is normally flipped on by a per-boot statement in
    // src/models/database.js that keys off is_demo=1 — since we clear is_demo
    // BEFORE the server boots, we have to set it here or every page renders
    // the "Account Pending Approval" gate.
    const r = await pool.query(
      "UPDATE users SET is_demo = 0, email_verified = 1, account_approved = 1 " +
      "WHERE email LIKE '%@inplace.care'"
    );
    log(`demo-mode chrome disabled for ${r.rowCount} seeded accounts`);

    const probe = "https://i.pravatar.cc/150?u=maria@inplace.care";
    if (reachable(probe)) {
      log("i.pravatar.cc reachable — keeping seeded avatar photos");
    } else {
      const a = await pool.query(
        "UPDATE users SET avatar_url = NULL, profile_photo = NULL " +
        "WHERE avatar_url LIKE '%pravatar%' OR profile_photo LIKE '%pravatar%'"
      );
      log(`i.pravatar.cc unreachable — cleared ${a.rowCount} avatar URLs (initials fallback)`);
    }
  } finally {
    await pool.end();
  }
}

// ─────────────────────────────── capture ───────────────────────────────

async function dismissDisclaimers(page) {
  for (let i = 0; i < 8; i++) {
    const btn = page.locator("button:visible")
      .filter({ hasText: /^(I Agree|Agree & Continue to Next)$/ }).first();
    if (!(await btn.count())) break;
    // the accept button unlocks only after the doc is scrolled to the bottom
    await page.evaluate(() => {
      document.querySelectorAll("div").forEach((d) => {
        if (d.scrollHeight > d.clientHeight + 20) d.scrollTop = d.scrollHeight;
      });
    });
    await page.waitForTimeout(500);
    const cb = page.locator('input[type="checkbox"]:visible').first();
    if (await cb.count()) await cb.check({ force: true });
    await page.waitForTimeout(200);
    await btn.click();
    await page.waitForTimeout(1800);
  }
}

async function login(page, base, acct) {
  await page.goto(base + "/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1800);
  await page.locator("a:visible, button:visible")
    .filter({ hasText: /^Sign in( here)?$/i }).first().click();
  await page.waitForTimeout(900);
  await page.fill('input[type="email"]', acct.email);
  await page.fill('input[type="password"]', acct.password);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(4500);
  await dismissDisclaimers(page);
  // Accepting the legal docs leaves a "Welcome to InPlace!" success toast at the
  // top of every page — a reload clears it and the disclaimer stays accepted.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4500);
}

const goto = async (page, key, wait = 3200) => {
  await page.evaluate((k) => window.__navigateTo && window.__navigateTo(k), key);
  await page.waitForTimeout(wait);
};

/** Every screen: [filename slug, async (page) => void]. */
const SCREENS = [
  ["01-dashboard", async (page) => {
    await goto(page, "dashboard");
    // First-run nags cover the real content; a real returning user has cleared them.
    const dismissAll = page.locator("text=Dismiss all").first();
    if (await dismissAll.count()) { await dismissAll.click(); await page.waitForTimeout(1200); }
    const nagX = page.locator("button:visible", { hasText: /^✕$/ }).first();
    if (await nagX.count()) { await nagX.click(); await page.waitForTimeout(1200); }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(600);
  }],

  ["02-schedule", async (page) => {
    await goto(page, "schedule");
    // The current month is mostly *past* sessions, which the calendar greys out.
    // Next month is where the seeded upcoming care lives — teal "confirmed" and
    // orange "awaiting caregiver" dots, plus the month summary strip.
    const next = page.locator("button:visible").filter({ hasText: /Next/ }).first();
    if (await next.count()) { await next.click(); await page.waitForTimeout(2500); }
    // Open the first day that has a confirmed session so the day-detail card
    // below the grid is populated instead of showing dead space.
    const picked = await page.evaluate(() => {
      const cells = [...document.querySelectorAll("div")].filter(
        (d) => d.style && d.style.minHeight === "64px" && d.style.cursor === "pointer"
      );
      const withDots = cells.filter((c) => c.children[1] && c.children[1].children.length);
      const filled = withDots.find((c) => {
        const bg = getComputedStyle(c.children[1].children[0]).backgroundColor;
        return bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent";
      });
      const target = filled || withDots[0];
      if (!target) return null;
      target.click();
      return target.children[0].textContent.trim();
    });
    if (picked) log(`    schedule: opened day ${picked}`);
    await page.waitForTimeout(2500);
  }],

  ["03-caregivers", async (page) => {
    await goto(page, "caregivers");
    // "Find Nearby" is the default tab and renders a Leaflet map; OSM tiles are a
    // third-party fetch, so browse the caregiver cards instead — always populated.
    const browse = page.locator("text=Browse All").first();
    if (await browse.count()) { await browse.click(); await page.waitForTimeout(2500); }
  }],

  ["04-messages", async (page) => {
    await goto(page, "messages");
    // The care-team group thread (Paul + siblings + caregiver) tells the
    // coordination story better than a 1:1 chat, and it's the busiest thread.
    const conv = page.locator("text=Barbara Lowe's Care Team").first();
    if (await conv.count()) { await conv.click(); await page.waitForTimeout(3500); }
    // Playwright parks the synthetic cursor wherever it last clicked, which
    // leaves the desktop-only `.msg-hover-actions` tray floating over a bubble.
    // A real iPhone has no hover — park the cursor in dead space.
    await page.mouse.move(4, 4);
    await page.waitForTimeout(1200);
  }],

  ["05-care-profile", async (page) => {
    await goto(page, "care-profile", 4000);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(600);
  }],
];

async function captureDevice(browser, base, device) {
  const ctx = await browser.newContext({
    viewport: { ...device.css },
    deviceScaleFactor: device.dsf,
    isMobile: true,
    hasTouch: true,
    userAgent: IPHONE_UA,
    locale: "en-US",
    timezoneId: "America/New_York",
    colorScheme: "light",
  });
  await ctx.route(BLOCKED, (r) => r.abort());
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("pwa_dismissed", "1");             // "Add to Home Screen" banner
      localStorage.setItem("push_prompt_dismissed", String(Date.now()));
      localStorage.setItem("inplace-theme", "light");
    } catch (e) {}
  });

  const page = await ctx.newPage();
  await login(page, base, FAMILY);

  const written = [];
  for (const [slug, prepare] of SCREENS) {
    await prepare(page);
    await page.mouse.move(4, 4); // no hover states — iPhones don't have a cursor
    await page.waitForTimeout(400);
    const file = path.join(OUT_DIR, `${device.label}_${slug}.png`);
    await page.screenshot({ path: file }); // viewport-sized => exact device pixels
    written.push(file);
    log(`  captured ${path.basename(file)}`);
  }
  await ctx.close();
  return written;
}

// ───────────────────────── PNG header verification ─────────────────────────

function pngSize(file) {
  const fd = fs.openSync(file, "r");
  const buf = Buffer.alloc(24);
  fs.readSync(fd, buf, 0, 24, 0);
  fs.closeSync(fd);
  if (buf.toString("hex", 0, 8) !== "89504e470d0a1a0a") throw new Error(`${file} is not a PNG`);
  if (buf.toString("ascii", 12, 16) !== "IHDR") throw new Error(`${file} has no IHDR`);
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

// ─────────────────────────────── main ───────────────────────────────

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  let base = opt("--base-url", null);
  if (!base) {
    const existing = `http://127.0.0.1:${APP_PORT}`;
    base = (await httpOk(existing + "/")) ? existing : await bootStack();
  }
  log("using app at", base);

  const { chromium } = require(PW);
  const browser = await chromium.launch({
    executablePath: chromePath(),
    headless: !flag("--headed"),
    args: ["--force-device-scale-factor=1", "--hide-scrollbars"],
  });

  const files = [];
  try {
    for (const device of DEVICES) {
      log(`=== ${device.name}" (${device.expect.join(" x ")}) ===`);
      files.push(...(await captureDevice(browser, base, device)));
    }
  } finally {
    await browser.close();
  }

  log("verifying PNG headers");
  let bad = 0;
  for (const f of files) {
    const [w, h] = pngSize(f);
    const dev = DEVICES.find((d) => path.basename(f).startsWith(d.label));
    const ok = w === dev.expect[0] && h === dev.expect[1];
    if (!ok) bad++;
    console.log(`  ${ok ? "OK  " : "BAD "} ${w}x${h}  ${path.basename(f)}`);
  }

  for (const c of cleanups.reverse()) c();
  if (bad) { console.error(`\n${bad} file(s) have the wrong dimensions`); process.exit(1); }
  log(`done — ${files.length} screenshots in ${OUT_DIR}`);
  if (flag("--keep-server")) log(`app left running at ${base} (pg on ${PG_PORT}, data in ${PG_DATA})`);
  process.exit(0);
})().catch((err) => {
  console.error("[shots] FAILED:", err && err.stack || err);
  for (const c of cleanups.reverse()) c();
  process.exit(1);
});
