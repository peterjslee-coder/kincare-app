// v1.105.35 — authentication is not authorization.
//
// The Aug 4 audit found six endpoints that were `authenticate`-gated and nothing more.
// Being logged in answered "who are you"; none of them asked "and does this row have
// anything to do with you". The worst was GET /api/sessions/:id, whose response carries the
// recipient's HOME ADDRESS, the caregiver's visit log (arrival mood, condition tags, care
// feedback) and the visit photos — readable by any account holding a session uuid.
//
// Two kinds of test here, deliberately:
//   1. Behavioural, against src/utils/access.js with a stubbed db. This is the logic.
//   2. Structural, asserting each patched handler still calls a gate. Cheap, and it is what
//      fails if someone "simplifies" a check away later.

const path = require("path");
const { code } = require("./helpers/source");
const { recipientAccess, sessionAccess } = require("../src/utils/access");

// A stub shaped like the DatabaseWrapper: db.prepare(sql).get(...args).
// Routes rows by matching the SQL, so the tests read as "what is in the database".
function fakeDb(rows) {
  return {
    prepare(sql) {
      const norm = sql.replace(/\s+/g, " ").trim();
      return {
        async get(...args) {
          for (const [pattern, fn] of rows) {
            if (norm.includes(pattern)) return fn(...args);
          }
          return undefined;
        },
        async all(...args) {
          const r = await this.get(...args);
          return r ? [r] : [];
        },
      };
    },
  };
}

const NOBODY = [["FROM users WHERE id", () => ({ is_admin: 0 })]];

describe("recipientAccess", () => {
  test("a stranger gets nothing", async () => {
    const db = fakeDb(NOBODY);
    expect(await recipientAccess(db, "rec-1", "stranger")).toBe(null);
  });

  test("an admin gets in", async () => {
    const db = fakeDb([["FROM users WHERE id", () => ({ is_admin: 1 })]]);
    expect(await recipientAccess(db, "rec-1", "admin-1")).toBe("admin");
  });

  test("the owning family member gets owner", async () => {
    const db = fakeDb([
      ["FROM users WHERE id", () => ({ is_admin: 0 })],
      ["FROM care_recipients WHERE id = ? AND family_user_id", () => ({ id: "rec-1" })],
    ]);
    expect(await recipientAccess(db, "rec-1", "paul")).toBe("owner");
  });

  test("a care-team leader edits, a member only views", async () => {
    const leader = fakeDb([...NOBODY, ["FROM care_team_members", () => ({ role: "leader" })]]);
    const member = fakeDb([...NOBODY, ["FROM care_team_members", () => ({ role: "member" })]]);
    expect(await recipientAccess(leader, "rec-1", "u")).toBe("edit");
    expect(await recipientAccess(member, "rec-1", "u")).toBe("view");
  });

  test("a caregiver with a live booking can view — that is the job", async () => {
    const db = fakeDb([...NOBODY, ["FROM care_sessions cs JOIN caregiver_profiles", () => ({ id: "s-1" })]]);
    expect(await recipientAccess(db, "rec-1", "maria")).toBe("view");
  });

  test("missing ids are refused, not treated as wildcards", async () => {
    const db = fakeDb(NOBODY);
    expect(await recipientAccess(db, null, "u")).toBe(null);
    expect(await recipientAccess(db, "rec-1", null)).toBe(null);
  });
});

describe("sessionAccess", () => {
  const session = { id: "s-1", family_user_id: "paul", caregiver_id: "cg-profile-1", care_recipient_id: "rec-1" };

  test("a stranger cannot see the session at all", async () => {
    const db = fakeDb([["FROM care_sessions WHERE id", () => session], ...NOBODY]);
    expect(await sessionAccess(db, "s-1", "stranger")).toBe(null);
  });

  test("a missing session is indistinguishable from one you may not see", async () => {
    // Both return null. An attacker probing uuids learns nothing from the difference,
    // because there is no difference — which is why the routes answer 404, not 403.
    const db = fakeDb([["FROM care_sessions WHERE id", () => undefined], ...NOBODY]);
    expect(await sessionAccess(db, "s-nope", "paul")).toBe(null);
  });

  test("the booking family can view and manage", async () => {
    const db = fakeDb([["FROM care_sessions WHERE id", () => session], ...NOBODY]);
    const a = await sessionAccess(db, "s-1", "paul");
    expect(a.canView).toBe(true);
    expect(a.canManage).toBe(true);
    expect(a.isFamily).toBe(true);
  });

  test("the assigned caregiver can manage — they have to start and finish the visit", async () => {
    const db = fakeDb([
      ["FROM care_sessions WHERE id", () => session],
      ["FROM users WHERE id", () => ({ is_admin: 0 })],
      ["FROM caregiver_profiles WHERE id = ? AND user_id", () => ({ id: "cg-profile-1" })],
    ]);
    const a = await sessionAccess(db, "s-1", "maria");
    expect(a.isCaregiver).toBe(true);
    expect(a.canManage).toBe(true);
  });

  test("a view-only care-team member can look but not drive the session", async () => {
    const db = fakeDb([
      ["FROM care_sessions WHERE id", () => session],
      ["FROM users WHERE id", () => ({ is_admin: 0 })],
      ["FROM caregiver_profiles WHERE id = ? AND user_id", () => undefined],
      ["FROM care_team_members", () => ({ role: "member" })],
    ]);
    const a = await sessionAccess(db, "s-1", "sibling");
    expect(a.canView).toBe(true);
    expect(a.canManage).toBe(false);
  });
});

describe("the patched handlers still ask", () => {
  const sessions = code("src/routes/sessions.js");
  const interviews = code("src/routes/interviews.js");
  const matching = code("src/routes/matching.js");
  const notes = code("src/routes/notes.js");

  test("GET /api/sessions/:id gates before it reads the address and the visit log", () => {
    expect(sessions).toMatch(/router\.get\("\/:id", async \(req, res\) => \{\s*\n\s*const db = await getDb\(\);\s*\n\s*const access = await sessionAccess\(db, req\.params\.id, req\.user\.id\);\s*\n\s*if \(!access\) return res\.status\(404\)/);
  });

  test("PUT /api/sessions/:id/status requires manage, not merely a login", () => {
    expect(sessions).toMatch(/const access = await sessionAccess\(db, req\.params\.id, req\.user\.id\);[\s\S]{0,200}if \(!access\.canManage\) return res\.status\(403\)/);
  });

  test("both interview endpoints check the recipient", () => {
    expect((interviews.match(/await recipientAccess\(db, recipientId, req\.user\.id\)/g) || [])).toHaveLength(2);
  });

  test("both matching endpoints check the session behind the query-string id", () => {
    expect((matching.match(/await sessionAccess\(db, sessionId, req\.user\.id\)/g) || [])).toHaveLength(2);
  });

  test("note edit and delete are scoped to the recipient, not to holding the family role", () => {
    // The old check was `!(req.user.roles||[]).includes("family")` — i.e. any family user on
    // the platform could edit or delete any note about anyone.
    expect(notes).not.toMatch(/existing\.author_id !== req\.user\.id && !\(req\.user\.roles/);
    expect((notes.match(/await hasAccess\(db, existing\.care_recipient_id, req\.user\.id\)/g) || [])).toHaveLength(2);
  });
});

describe("every base64 endpoint has BOTH halves of the body-limit rule", () => {
  // The rule has now been broken three times — photo notes (silently, for months),
  // feedback screenshots (413 for two weeks), and caregiver ID verification (413 always,
  // on the one step a caregiver cannot skip and a store reviewer walks). Each time only one
  // half was missing. So assert the two lists agree, rather than asserting either exists.
  const server = code("src/server.js");
  const validate = code("src/middleware/validate.js");

  const jsonLimited = new Set(
    [...server.matchAll(/app\.use\("(\/api\/[^"]+)",\s*express\.json\(\{\s*limit:/g)].map((m) => m[1])
  );
  const sizeSkipped = new Set(
    [...validate.matchAll(/req\.originalUrl\?\.startsWith\("(\/api\/[^"]+)"\)/g)].map((m) => m[1])
  );

  test("caregiver ID verification is covered by both", () => {
    expect(jsonLimited.has("/api/caregiver-onboarding")).toBe(true);
    expect(sizeSkipped.has("/api/caregiver-onboarding")).toBe(true);
  });

  test("nothing has a raised JSON limit without a matching limitBodySize skip", () => {
    // A raised express.json limit is a declaration that this route carries big bodies. If
    // limitBodySize does not agree, the 100kb global cap 413s it first and the raised limit
    // is decoration. (Endpoints exempted by a different clause — the /photo and /me/photo
    // path rules — are excluded here; they are covered by their own assertions elsewhere.)
    const byOtherClause = new Set(["/api/auth/me/photo", "/api/care-recipients"]);
    const orphans = [...jsonLimited].filter((p) => !sizeSkipped.has(p) && !byOtherClause.has(p));
    expect(orphans).toEqual([]);
  });
});

describe("the demo reseed cannot be broken by a reimbursement", () => {
  const seed = code("src/seed.js");

  test("reimbursement rows are cleared before their parents are deleted", () => {
    // reimbursements references BOTH care_recipients and care_teams with no ON DELETE, and
    // the whole seed runs in one transaction — so a single demo reimbursement made the
    // parent DELETE raise, rolled the entire reseed back, and returned a silent 500.
    const teamCleanup = seed.indexOf("DELETE FROM reimbursements WHERE care_team_id");
    const teamDelete = seed.indexOf("DELETE FROM care_teams WHERE id IN");
    expect(teamCleanup).toBeGreaterThan(-1);
    expect(teamCleanup).toBeLessThan(teamDelete);

    const recipCleanup = seed.indexOf("DELETE FROM reimbursements WHERE care_recipient_id");
    const recipDelete = seed.indexOf("DELETE FROM care_recipients WHERE family_user_id");
    expect(recipCleanup).toBeGreaterThan(-1);
    expect(recipCleanup).toBeLessThan(recipDelete);
  });

  test("the funding accounts and schedules go too", () => {
    expect(seed).toMatch(/DELETE FROM reimbursement_schedules WHERE care_team_id/);
    expect(seed).toMatch(/DELETE FROM team_funding_accounts WHERE care_team_id/);
  });
});

describe("module-scope storage cannot white-screen the app", () => {
  const utils = code("public/js/utils.js");

  test("the two top-level reads are guarded", () => {
    // utils.js is the 2nd file in the concatenated bundle. A throw here happens before
    // React exists, so ErrorBoundary cannot catch it: the user gets a blank page. Storage
    // throws in Safari private mode and in locked-down webviews.
    expect(utils).toMatch(/let ACTIVE_ROLE = \(\(\) => \{ try \{ return localStorage\.getItem/);
    expect(utils).toMatch(/let IMPERSONATION_TOKEN = \(\(\) => \{ try \{ return sessionStorage\.getItem/);
  });

  test("no bare top-level storage read remains in utils.js", () => {
    const topLevel = utils.split("\n").filter((l) => /^(let|const|var)\s/.test(l));
    const bare = topLevel.filter((l) => /(localStorage|sessionStorage)\./.test(l) && !/try\s*\{/.test(l));
    expect(bare).toEqual([]);
  });
});
