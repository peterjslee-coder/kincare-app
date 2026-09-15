/**
 * v1.106.16 — the sessions router's shape, pinned before it is taken apart.
 *
 * sessions.js is 4,056 lines and 33 routes. Splitting it is pure code movement, which is
 * exactly the kind of change that looks safe and is not: Express matches in REGISTRATION
 * ORDER, and this router has patterns that shadow each other.
 *
 *     GET /cost-preview      registered at index 7
 *     GET /tips/caregiver    registered at index 25
 *     GET /:id               registered at index 27
 *
 * `/:id` matches "cost-preview" and "tips" perfectly well. It only works today because it is
 * registered last. Move it up — or split the file into sub-routers mounted in a different
 * order — and two endpoints silently start answering with "session not found" for an id that
 * is really a word. That is the same class as the 426 version gate in v1.106.7, which was
 * registered eighty lines below the routers and therefore never once fired.
 *
 * So: the full ordered list, asserted exactly. A split that preserves behaviour leaves this
 * test untouched; one that does not fails loudly and says where.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || "route-order-secret";

const router = require("../src/routes/sessions");

const actual = (router.stack || [])
  .filter((l) => l.route)
  .map((l) => {
    const methods = Object.keys(l.route.methods)
      .filter((m) => l.route.methods[m])
      .map((m) => m.toUpperCase())
      .sort()
      .join("|");
    return `${methods} ${l.route.path}`;
  });

// Captured from the 4,056-line single file, before any split.
const EXPECTED = [
  "GET /",
  "POST /request",
  "PUT /:id/decline",
  "PUT /:id/claim",
  // v1.106.34 — accept a set of visits by id. Generalises the group route below, which is
  // now a thin resolver over it: a card can be an INFERRED group (offers matching on shape
  // but carrying no recurrence_group_id) and those have no groupId to claim by.
  "PUT /claim-batch",
  // v1.106.24 — accepting a recurring series in one act, with the dates she picks.
  "PUT /recurring/:groupId/claim",
  "POST /",
  "DELETE /recurring/:groupId",
  "POST /:id/match",
  "GET /cost-preview",
  "PUT /:id/status",
  "GET /:id/care-briefing",
  "POST /:id/check-in",
  // v1.106.41 — stepping out mid-visit. Both are strictly more specific than "/:id" and are
  // registered above it, so neither is shadowed and neither shadows anything: "break" is a
  // literal segment, so "/:id/break/start" cannot swallow a real session id.
  // v1.106.47 — release with full pay. Above "/:id" like the rest, and "release" is a literal
  // segment so it cannot swallow a session id.
  "POST /:id/release",
  "POST /:id/break/start",
  "POST /:id/break/end",
  "POST /:id/check-out",
  "POST /:id/pending-tip",
  "POST /:id/propose-time-change",
  "PUT /:id/time-change/:proposalId/respond",
  "GET /:id/time-change",
  "PUT /:id/instructions",
  "PUT /:id/on-my-way",
  "GET /:id/cancel-preview",
  "GET /:id/cancel-fee",
  "POST /:id/cancel-fee/waive",
  "POST /:id/cancel-fee/dispute",
  "PUT /:id/cancel",
  "POST /:id/review",
  "POST /:id/tip",
  "GET /tips/caregiver",
  "GET /:id/tip",
  "GET /:id",
  "GET /:sessionId/first-visit-check",
  "POST /:sessionId/first-visit-confirm",
  "POST /:id/propose-time",
  "PUT /:id/proposals/:proposalId/accept",
  "PUT /:id/proposals/:proposalId/decline",
];

describe("the sessions router", () => {
  test("registers exactly these routes, in exactly this order", () => {
    expect(actual).toEqual(EXPECTED);
  });

  test("the literal paths are registered before the /:id that would swallow them", () => {
    // Stated separately from the list above, because this is the PROPERTY that matters. If
    // someone deliberately updates EXPECTED after a reorder, this still fails.
    const idIndex = actual.indexOf("GET /:id");
    expect(idIndex).toBeGreaterThan(-1);
    for (const literal of ["GET /cost-preview", "GET /tips/caregiver"]) {
      const at = actual.indexOf(literal);
      expect(at).toBeGreaterThan(-1);
      expect(at).toBeLessThan(idIndex);
    }
  });

  test("the recurring-series routes are not shadowed by the /:id patterns", () => {
    // v1.106.24 — "/recurring/:groupId/claim" has three segments so "/:id/claim" (two)
    // cannot match it, but "/:id" is one pattern away from a reorder that would. Both
    // recurring routes are asserted, not just the new one.
    const claimIdx = actual.indexOf("PUT /:id/claim");
    for (const literal of ["PUT /recurring/:groupId/claim", "DELETE /recurring/:groupId", "PUT /claim-batch"]) {
      expect(actual.indexOf(literal)).toBeGreaterThan(-1);
    }
    expect(actual.indexOf("PUT /recurring/:groupId/claim")).toBeGreaterThan(claimIdx);
    expect(actual.indexOf("PUT /recurring/:groupId/claim")).toBeLessThan(actual.indexOf("GET /:id"));
  });

  test("it no longer doubles as a library", () => {
    // v1.106.16 — dashboard.js and server.js used to require expireStaleProposals from this
    // router, so sweeping proposals meant loading 33 routes and everything they pull in. The
    // function moved to utils/proposals and the re-export is deliberately gone: leaving a
    // second address for it is the duplication this batch exists to remove.
    expect(router.expireStaleProposals).toBeUndefined();
    expect(typeof require("../src/utils/proposals").expireStaleProposals).toBe("function");
  });

  test("nothing requires a helper out of the router any more", () => {
    const fs = require("fs");
    const path = require("path");
    const offenders = [];
    (function walk(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { walk(p); continue; }
        if (!e.name.endsWith(".js")) continue;
        const src = fs.readFileSync(p, "utf8");
        // `const { thing } = require(".../routes/sessions")` — destructuring means a library
        // import, not mounting the router.
        if (/const\s*\{[^}]+\}\s*=\s*require\([^)]*routes\/sessions[^)]*\)/.test(src) ||
            /const\s*\{[^}]+\}\s*=\s*require\(["'`]\.\/sessions["'`]\)/.test(src)) {
          offenders.push(path.relative(path.join(__dirname, ".."), p));
        }
      }
    })(path.join(__dirname, "..", "src"));
    expect(offenders).toEqual([]);
  });
});
