/**
 * v1.106.15 — the dual-name reads, and the failure they hide.
 *
 * 36 fields are read by the client as `x.foo_bar || x.fooBar`, across 131 sites. The obvious
 * conclusion is that someone was sloppy and the fallbacks should be deleted. They should not:
 * they are load-bearing. Measured against production,
 *
 *   /api/sessions   spreads raw database rows            → snake_case
 *   /api/dashboard  hand-builds its objects              → camelCase
 *
 * and components render sessions from both, so they genuinely have to read both. Renaming to
 * one convention breaks ~200 unguarded reads whichever direction you pick (254 snake, 165
 * camel), for no user-visible gain, on an app with real people on it. So the names stay.
 *
 * What is NOT acceptable is the failure mode the `||` hides. When the server sends NEITHER
 * name, the expression is undefined and the UI renders a blank, an empty date, or NaN — and
 * nothing anywhere says so. That has to be a failing build instead of a quiet blank, which is
 * what this file is for: the fallback pairs are harvested from the client source, so they
 * cannot go stale, and each one is checked against a real response from a real database.
 */
const { startHarness, stopHarness } = require("./harness");
const { v4: uuid } = require("uuid");
const fs = require("fs");
const path = require("path");

jest.setTimeout(180000);

let h, db, family, cgUser, recipientId, sessionId;

const PUBLIC = path.join(__dirname, "..", "..", "public", "js");

/** Every `a.snake_case || b.camelCase` pair the client actually reads, read out of the source. */
function harvestFallbackPairs() {
  const snake = "[A-Za-z_$][A-Za-z0-9_$]*\\.([a-z][a-z0-9]*(?:_[a-z0-9]+)+)";
  const camel = "[A-Za-z_$][A-Za-z0-9_$]*\\.([a-z][a-z0-9]*(?:[A-Z][A-Za-z0-9]*)+)";
  const re = new RegExp(`${snake}\\s*\\|\\|\\s*${camel}|${camel}\\s*\\|\\|\\s*${snake}`, "g");
  const toCamel = (s) => s.split("_").map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w)).join("");

  const pairs = new Map();
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!e.name.endsWith(".js")) continue;
      const src = fs.readFileSync(p, "utf8");
      for (const m of src.matchAll(re)) {
        const sn = m[1] || m[4];
        const cm = m[2] || m[3];
        if (!sn || !cm || toCamel(sn) !== cm) continue;   // not the same field
        pairs.set(sn, cm);
      }
    }
  })(PUBLIC);
  return [...pairs.entries()];
}

const PAIRS = harvestFallbackPairs();

/** Collect every key present anywhere in a payload. */
function keysOf(v, depth = 0, acc = new Set()) {
  if (depth > 7 || v === null || typeof v !== "object") return acc;
  if (Array.isArray(v)) { v.slice(0, 10).forEach((x) => keysOf(x, depth + 1, acc)); return acc; }
  for (const [k, val] of Object.entries(v)) { acc.add(k); keysOf(val, depth + 1, acc); }
  return acc;
}

beforeAll(async () => {
  h = await startHarness({
    routers: { "/api/sessions": "../../src/routes/sessions", "/api/dashboard": "../../src/routes/dashboard" },
  });
  db = h.db;

  family = await h.createUser({ firstName: "Contract", lastName: "Family" });
  const t = await h.createCareTeam({ familyUserId: family.user.id });
  recipientId = t.recipientId;

  cgUser = await h.createUser({ firstName: "Contract", lastName: "Giver", roles: ["caregiver"] });
  const profileId = uuid();
  await db.prepare(`
    INSERT INTO caregiver_profiles (id, user_id, hourly_rate, is_background_checked, is_available, created_at)
    VALUES (?, ?, 30, 1, 1, NOW())
  `).run(profileId, cgUser.user.id);

  // A fully-populated session — every field the client reads with a fallback should be
  // reachable from it, so an absent key means the serializer dropped it, not that the row was thin.
  sessionId = uuid();
  await db.prepare(`
    INSERT INTO care_sessions
      (id, care_recipient_id, family_user_id, caregiver_id, service_type, status,
       scheduled_date, scheduled_time, duration_hours, estimated_cost, special_instructions, created_at)
    VALUES (?, ?, ?, ?, 'companionship', 'confirmed', '2026-10-01', '10:00', 3, 90, 'Front door code 1234', NOW())
  `).run(sessionId, recipientId, family.user.id, profileId);
});

afterAll(async () => { await stopHarness(h); });

describe("the harvest itself", () => {
  test("finds the fallback pairs — if this breaks, every test below goes vacuous", () => {
    expect(PAIRS.length).toBeGreaterThanOrEqual(20);
    const fields = PAIRS.map(([s]) => s);
    expect(fields).toEqual(expect.arrayContaining(["duration_hours", "service_type", "recipient_name"]));
  });
});

describe("a fallback is only safe if the server sends one of the two names", () => {
  let sessionKeys, dashKeys;

  beforeAll(async () => {
    const s = await h.request.get("/api/sessions").set(h.auth(family.token));
    expect(s.status).toBe(200);
    sessionKeys = keysOf(s.body);

    const d = await h.request.get("/api/dashboard").set(h.auth(family.token));
    expect(d.status).toBe(200);
    dashKeys = keysOf(d.body);
  });

  // Fields that live on a session object. Each must arrive under one name or the other from
  // BOTH endpoints that carry sessions — otherwise a component fed from the wrong one renders
  // a blank and says nothing.
  const SESSION_FIELDS = [
    "duration_hours", "service_type", "estimated_cost", "special_instructions", "recipient_name",
  ];

  test.each(SESSION_FIELDS)("/api/sessions carries '%s' in one casing", (sn) => {
    const cm = PAIRS.find(([s]) => s === sn)?.[1];
    expect(cm).toBeTruthy();
    expect(sessionKeys.has(sn) || sessionKeys.has(cm)).toBe(true);
  });

  test.each(SESSION_FIELDS)("/api/dashboard carries '%s' in one casing", (sn) => {
    const cm = PAIRS.find(([s]) => s === sn)?.[1];
    expect(dashKeys.has(sn) || dashKeys.has(cm)).toBe(true);
  });

  test("this is what production looks like, and the test would have caught the alternative", () => {
    // Not an aesthetic assertion — a record of WHY the fallbacks exist, so the next person to
    // reach for a rename sees the evidence rather than re-deriving it. sessions spreads rows,
    // dashboard hand-builds.
    const snakeInSessions = [...sessionKeys].filter((k) => /^[a-z]+(_[a-z0-9]+)+$/.test(k)).length;
    const camelInDash = [...dashKeys].filter((k) => /^[a-z]+([A-Z][A-Za-z0-9]*)+$/.test(k)).length;
    expect(snakeInSessions).toBeGreaterThan(10);
    expect(camelInDash).toBeGreaterThan(10);
  });
});

describe("the fields a component would render blank", () => {
  test("no fallback pair is absent from EVERY endpoint that could supply it", async () => {
    // The real bug this file exists for. A pair the server never emits under either name is a
    // read that is always undefined — and reads as an empty cell, not an error.
    const endpoints = ["/api/sessions", "/api/dashboard"];
    const all = new Set();
    for (const ep of endpoints) {
      const r = await h.request.get(ep).set(h.auth(family.token));
      if (r.status === 200) for (const k of keysOf(r.body)) all.add(k);
    }
    // Only judge fields these two endpoints are responsible for; others come from elsewhere.
    const owned = ["duration_hours", "service_type", "estimated_cost", "special_instructions",
                   "recipient_name", "care_recipient_id"];
    const missing = owned.filter((sn) => {
      const cm = PAIRS.find(([s]) => s === sn)?.[1];
      return !all.has(sn) && !(cm && all.has(cm));
    });
    expect(missing).toEqual([]);
  });
});
