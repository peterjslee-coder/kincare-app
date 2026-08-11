// v1.105.60 — five that were broken in production, found by sweeping for the bug family the
// v1.105.4x–5x run kept turning up: features that fail silently and look identical to features
// that are switched off.
//
// Each of these had been shipped and live for a long time. None of them logged anything a user
// or Pete would ever see. What they share is that the failure renders as a normal, reassuring
// state — an empty visit history, a new-user welcome, a cleared badge, a pending request — so
// nobody files a bug, because from the outside nothing looks broken.
//
// A note on how these are written. Several are structural assertions over source text, which is
// only worth anything if the assertion can actually fail. tests/familyVisits.test.js:81 was a
// privacy guard whose slice bounds silently reversed to an empty string when an unrelated
// change moved a marker — it asserted nothing for two versions. So: every slice here is bounds-
// checked with expect() before it is used, and the markers are code, not comments (code() strips
// line-owning comments, so a comment can never serve as a boundary).

const { code } = require("./helpers/source");

const recipients = code("src/routes/careRecipients.js");
const dashboard = code("src/routes/dashboard.js");
const push = code("src/routes/push.js");
const oauth = code("src/routes/oauth.js");
const safety = code("src/routes/safety.js");
const blocks = code("src/utils/blocks.js");

/**
 * A bounds-checked slice. Returns the region between two markers, having first asserted that
 * both exist and are in the right order. This is the guard the reversed-slice bug needed.
 */
function region(src, startMarker, endMarker, label) {
  const start = src.indexOf(startMarker);
  const end = src.indexOf(endMarker, start + 1);
  expect(`${label}: start marker "${startMarker}"`).toBe(start > -1 ? `${label}: start marker "${startMarker}"` : "NOT FOUND");
  expect(`${label}: end marker "${endMarker}"`).toBe(end > start ? `${label}: end marker "${endMarker}"` : "NOT FOUND AFTER START");
  const out = src.slice(start, end);
  expect(out.length).toBeGreaterThan(0);
  return out;
}

// ───────────────────────────────────────────────────────────────────────────────
describe("the doctor report reads the visits it claims to summarise", () => {
  // visit_logs.caregiver_id references caregiver_profiles(id), NOT users(id). The doctor-report
  // query joined it straight to users as an INNER JOIN, so it matched zero rows on every call.
  // `visitSummaries` was always "", and every doctor report ever generated was written from
  // notes alone — while reading as a report about a recipient who simply hasn't had many visits.
  //
  // This is the iPAi cardinal rule from the other direction: the July post-mortem was about a
  // report asserting more than the record supported. This is a report silently seeing less.

  const q = region(recipients, "FROM visit_logs vl", "ORDER BY vl.check_in_time DESC", "doctor-report visits");

  test("it hops through caregiver_profiles rather than joining users directly", () => {
    expect(q).toMatch(/LEFT JOIN caregiver_profiles cp ON vl\.caregiver_id = cp\.id/);
    expect(q).toMatch(/LEFT JOIN users u ON cp\.user_id = u\.id/);
  });

  test("it never joins visit_logs.caregiver_id to users.id — different ID spaces", () => {
    // The exact shape of the bug. If this line comes back, every doctor report goes blind again.
    expect(q).not.toMatch(/JOIN users\s+u?\s*ON vl\.caregiver_id = u\.id/);
  });

  test("a missing caregiver profile costs the name, not the visit", () => {
    // INNER would drop the whole visit for want of a display name. The visit is the evidence;
    // the name is decoration.
    expect(q).not.toMatch(/\n\s+JOIN caregiver_profiles/);
    expect(q).not.toMatch(/\n\s+JOIN users/);
  });

  test("every other consumer of visit_logs already did it this way", () => {
    // Proof this is the codebase's own convention, not a new idea. (admin/sessionOps.js joins
    // care_sessions.caregiver_id, a different column in the same ID space — not comparable.)
    for (const f of ["src/routes/dashboard.js", "src/routes/photos.js"]) {
      expect(code(f)).toMatch(/caregiver_profiles cp ON vl\.caregiver_id = cp\.id/);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────────
describe("an error is not a shape", () => {
  // The family dashboard answered 200 with `isNewUser: true, careRecipients: []` on any internal
  // error, so the client could keep rendering. What it rendered was the new-user welcome — and
  // Dashboard.js then auto-navigates a user with no recipient into the add-a-loved-one wizard.
  // A family with an active care team was told they had no loved one.

  const handler = region(dashboard, "Family dashboard error:", "async function caregiverDashboard", "family dashboard catch");

  test("the family dashboard catch answers 5xx, not 200", () => {
    expect(handler).toMatch(/res\.status\(500\)/);
  });

  test("it does not manufacture a new-user response out of a failure", () => {
    expect(handler).not.toMatch(/isNewUser:\s*true/);
    expect(handler).not.toMatch(/careRecipients:\s*\[\]/);
    expect(handler).not.toMatch(/role:\s*"family"/);
  });

  test("the client has a real error path for this, and it is reachable", () => {
    // The 200 was defeating handling that already existed: two silent retries, then a visible
    // "Something went wrong" with a Try Again button. res.ok being true skipped all of it.
    const client = code("public/js/components/Dashboard.js");
    expect(client).toMatch(/setError\(true\)/);
    expect(client).toMatch(/retryCount\s*<\s*2/);
  });
});

// ───────────────────────────────────────────────────────────────────────────────
describe("the badge declines to answer rather than asserting zero", () => {
  // /api/push/attention returned 200 {total: 0, ...} on error, reasoning that a badge is a
  // convenience and shouldn't fail the caller. But zero is not "no answer" — it is the answer
  // "nothing needs you". AttentionCard renders that as caught-up, and refreshAppBadge CLEARS
  // the icon: an internal error erased a badge that was flagging an overdue care task.

  const handler = region(push, "Attention count error:", "const { syncBadgeToDevices } = require", "attention catch");

  test("the catch does not report a zeroed count as fact", () => {
    expect(handler).not.toMatch(/total:\s*0/);
    expect(handler).not.toMatch(/careTasks:\s*0/);
  });

  test("it answers 5xx so both callers leave the existing badge alone", () => {
    expect(handler).toMatch(/res\.status\(500\)/);
  });

  test("both clients already handle a non-OK response by changing nothing", () => {
    // This is why 500 is safe here and 200-with-zeros was not.
    expect(code("public/js/utils.js")).toMatch(/if \(!res\?\.ok\) return;/);
    expect(code("public/js/components/AttentionCard.js")).toMatch(/setLoadFailed\(true\); return;/);
  });
});

// ───────────────────────────────────────────────────────────────────────────────
describe("refresh tokens are awaited, and take a user id", () => {
  // The Apple link branch called `generateRefreshToken(user)` — no await, and the whole user
  // object where an id belongs. Un-awaited, res.cookie JSON-encodes the Promise and the browser
  // gets `refresh_token=j:{}`, so the user is silently signed out when the JWT expires. And the
  // object hits a TEXT column with a FK to users(id), so the insert rejects — unhandled, which
  // on Node 18+ terminates the process and takes every in-flight request with it.

  test("the Apple link branch awaits it and passes an id", () => {
    const branch = region(oauth, "oauthCodes.set(authCode", "apple_linked=1", "apple link branch");
    expect(branch).toMatch(/await generateRefreshToken\(user\.id\)/);
    expect(branch).not.toMatch(/generateRefreshToken\(user\)/);
  });

  test("no call site anywhere passes a user object or forgets the await", () => {
    // The general gate — this is what stops the seventh call site from repeating it.
    const files = [
      "src/routes/oauth.js", "src/routes/auth.js", "src/routes/passkeys.js", "src/routes/twoFactor.js",
    ];
    const calls = [];
    for (const f of files) {
      for (const m of code(f).matchAll(/(await\s+)?generateRefreshToken\(([^)]*)\)/g)) {
        if (m[0].startsWith("async function") || m.index === code(f).indexOf("async function generateRefreshToken")) continue;
        calls.push({ file: f, awaited: !!m[1], arg: m[2].trim(), text: m[0] });
      }
    }
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(`${c.file}: ${c.text} awaited=${c.awaited}`).toBe(`${c.file}: ${c.text} awaited=true`);
      // An id, never the object it came from.
      expect(`${c.file}: ${c.arg}`).not.toBe(`${c.file}: user`);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────────
describe("a block request is either visible to a leader or not filed", () => {
  // block_requests.care_team_id was written as `approver?.careTeamId || null`, and the only
  // reader INNER JOINs care_team_members on it. A NULL row is invisible to every leader and
  // every admin, permanently — while the requester was told "We've asked your care team to
  // review this." A care recipient asking to block someone is the last place to say a thing we
  // haven't done.

  test("the POST refuses rather than filing a request nobody can see", () => {
    const handler = region(safety, "canBlockDirectly(db, req.user.id", "INSERT INTO block_requests", "block request POST");
    expect(handler).toMatch(/findApproverForRequester/);
    expect(handler).toMatch(/!approver\?\.careTeamId/);
    expect(handler).toMatch(/res\.status\(503\)/);
  });

  test("it no longer inserts a null care_team_id", () => {
    const insert = region(safety, "INSERT INTO block_requests", "if (approver?.userId)", "block request insert");
    expect(insert).not.toMatch(/careTeamId \|\| null/);
    expect(insert).toMatch(/approver\.careTeamId/);
  });

  test("the refusal does not claim the team was asked, or that the target was told", () => {
    // Pete's copy rule: say plainly what did and did not happen.
    const handler = region(safety, "!approver?.careTeamId", "INSERT INTO block_requests", "block refusal copy");
    expect(handler).toMatch(/nothing has been sent/i);
    expect(handler).not.toMatch(/We've asked your care team/);
  });

  test("the leader's queue still finds rows written before this fix", () => {
    const q = region(safety, "FROM block_requests br", "ORDER BY br.created_at DESC", "block request list");
    expect(q).toMatch(/COALESCE\(br\.care_team_id, ct\.id\)/);
    expect(q).toMatch(/LEFT JOIN care_recipients cr ON cr\.linked_user_id = br\.requester_user_id/);
  });

  test("findApproverForRequester resolves a team when canBlockDirectly could not", async () => {
    // The real behavioural check: the catch path returns { allowed: false, reason: "unknown" }
    // with no recipientId by design, and that is exactly the case that used to file an orphan.
    const { findApproverForRequester } = require("../src/utils/blocks");
    const rows = {
      "SELECT id FROM care_recipients WHERE linked_user_id = ?": { id: "rec-1" },
      "SELECT id, billing_user_id FROM care_teams WHERE care_recipient_id = ?": { id: "team-1", billing_user_id: "billing-1" },
    };
    const db = { prepare: (sql) => ({ get: async () => rows[sql.trim()] ?? undefined }) };

    const viaFallback = await findApproverForRequester(db, "user-1", null);
    expect(viaFallback).toEqual({ careTeamId: "team-1", userId: "billing-1" });

    const viaRecipient = await findApproverForRequester(db, "user-1", "rec-1");
    expect(viaRecipient).toEqual({ careTeamId: "team-1", userId: "billing-1" });
  });

  test("it returns null when there is genuinely no team, so the caller can refuse", async () => {
    const db = { prepare: () => ({ get: async () => undefined }) };
    expect(await findApproverForRequesterFrom(db)).toBeNull();
  });

  test("a thrown lookup returns null rather than a half-answer", async () => {
    const db = { prepare: () => ({ get: async () => { throw new Error("pg down"); } }) };
    expect(await findApproverForRequesterFrom(db)).toBeNull();
  });

  test("the helper is exported", () => {
    expect(blocks).toMatch(/findApproverForRequester,/);
  });
});

async function findApproverForRequesterFrom(db) {
  const { findApproverForRequester } = require("../src/utils/blocks");
  return findApproverForRequester(db, "user-1", null);
}
