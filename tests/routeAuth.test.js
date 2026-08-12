// v1.105.61 — every route that reads req.user must actually authenticate.
//
// GET /api/push/attention was added in v1.105.40 without `authenticate`. push.js authenticates
// per route rather than with a blanket `router.use`, so nothing caught it. `req.user` was
// undefined on every call, `req.user.id` threw, and the catch answered 200 {total: 0} — so the
// badge has never worked for anyone since the day it shipped, and it looked precisely like
// "nothing needs your attention". Six versions of badge work went past it.
//
// Two lessons, both already written down in this repo and both re-learned here:
//   - Fix the pattern, not the instance (feedback_thorough_sweep). Hence this gate rather than
//     one line in push.js.
//   - A file that authenticates per route has no floor. One forgotten middleware argument is a
//     silently unauthenticated endpoint, and if the handler happens not to touch req.user it is
//     a silently PUBLIC one. This test is that floor.

const fs = require("fs");
const path = require("path");
const { code, REPO } = require("./helpers/source");

const ROUTES_DIR = path.join(__dirname, "..", "src", "routes");

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (fs.statSync(p).isDirectory()) walk(p, acc);
    else if (entry.endsWith(".js")) acc.push(p);
  }
  return acc;
}

/** Route files whose parent router already applies authentication to everything it mounts. */
const AUTHENTICATED_PARENTS = [
  // src/routes/admin/index.js: `router.use(authenticate, checkAdmin, requireAdmin)` before it
  // registers any module, so every admin/* sub-router inherits all three.
  path.join(ROUTES_DIR, "admin"),
];

/**
 * Routes that are deliberately public. Each needs a reason, and none may read req.user —
 * that combination is what makes an entry here safe rather than a second /attention.
 */
const INTENTIONALLY_PUBLIC = {
  "push.js GET /vapid-key": "the public VAPID key is public by definition",
};

const AUTH_MIDDLEWARE = /\b(authenticate|requireRole|requireAdmin|checkAdmin|optionalAuth)\b/;

const rel = (abs) => path.relative(REPO, abs);

function routesIn(file) {
  const src = code(rel(file));
  const found = [];
  const re = /router\.(get|post|put|patch|delete)\(\s*(["'])([^"']*)\2\s*,?([^{]*)/g;
  let m;
  while ((m = re.exec(src))) {
    const start = m.index;
    const rest = src.slice(start + 8);
    const nextRoute = rest.search(/\nrouter\.(get|post|put|patch|delete)\(/);
    const body = rest.slice(0, nextRoute > -1 ? nextRoute : undefined);
    found.push({
      verb: m[1].toUpperCase(),
      routePath: m[3],
      middleware: m[4] || "",
      usesUser: /\breq\.user\b/.test(body),
      line: src.slice(0, start).split("\n").length,
    });
  }
  return found;
}

describe("no route reads req.user without authenticating", () => {
  const files = walk(ROUTES_DIR).filter(
    (f) => !AUTHENTICATED_PARENTS.some((p) => f.startsWith(p + path.sep))
  );

  test("the sweep actually looked at the route files", () => {
    // Guards against the whole suite silently passing because a path changed.
    expect(files.length).toBeGreaterThan(20);
    expect(files.some((f) => f.endsWith("push.js"))).toBe(true);
  });

  test("every req.user route in a per-route-auth file carries auth middleware", () => {
    const offenders = [];
    for (const file of files) {
      const src = code(rel(file));
      if (/router\.use\(\s*authenticate/.test(src)) continue; // blanket auth — covered
      for (const r of routesIn(file)) {
        if (!r.usesUser) continue;
        if (AUTH_MIDDLEWARE.test(r.middleware)) continue;
        offenders.push(`${path.relative(ROUTES_DIR, file)}:${r.line} ${r.verb} ${r.routePath}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("push.js in particular — the file this was found in", () => {
    // push.js is the one router that authenticates per route AND is heavily added to, which is
    // exactly the combination that produced the bug. Pin it explicitly as well as generically.
    const src = code(rel(path.join(ROUTES_DIR, "push.js")));
    expect(/router\.use\(\s*authenticate/.test(src)).toBe(false); // if this changes, simplify below
    for (const r of routesIn(path.join(ROUTES_DIR, "push.js"))) {
      const key = `push.js ${r.verb} ${r.routePath}`;
      if (INTENTIONALLY_PUBLIC[key]) {
        // A deliberately public route must not read req.user — otherwise it is /attention again.
        expect(`${key} usesUser=${r.usesUser}`).toBe(`${key} usesUser=false`);
        continue;
      }
      expect(`${key} authenticated=${AUTH_MIDDLEWARE.test(r.middleware)}`).toBe(`${key} authenticated=true`);
    }
  });

  test("/api/push/attention specifically — the badge depends on it", () => {
    const src = code(rel(path.join(ROUTES_DIR, "push.js")));
    expect(src).toMatch(/router\.get\("\/attention",\s*authenticate,/);
  });
});
