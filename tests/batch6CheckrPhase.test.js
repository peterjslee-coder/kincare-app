/**
 * Batch 6 — the background-check status vocabulary (v1.106.13).
 *
 * Fifteen values get written to caregiver_profiles.checkr_status. Two caregiver-facing screens
 * rendered them and each enumerated a different subset:
 *
 *   CaretakerHub  pending / rejected / consider / processing / disputed  → else render nothing.
 *   MyAccount     complete / in_progress / invitation_created            → else "✓ Payment
 *                 received" and a blank Checkr submission form.
 *
 * So a caregiver whose check came back did_not_pass, suspended or adverse_action, having paid,
 * got a green tick and an invitation to run another one — on the screen that decides whether
 * they may work with vulnerable adults. Neither screen was wrong about the states it knew;
 * both silently funnelled the unknown ones into a default that meant something else.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || "batch6-checkr-secret";

const { code, raw } = require("./helpers/source");
const C = require("../src/constants/checkrStatus");

// Every literal ever written to checkr_status, read out of the source rather than restated
// here — a new one added to checkr.js has to be classified, or these tests fail.
const written = [
  ...new Set(
    [...raw("src/routes/checkr.js").matchAll(/checkr_status\s*=\s*'([a-z_]+)'/g)].map((m) => m[1])
  ),
];

describe("F1 — every status the server can store is classified", () => {
  test("checkr.js writes a set of literal statuses, and this test sees them", () => {
    // Guards the harvest itself: if the regex stops matching, every test below goes vacuous.
    expect(written.length).toBeGreaterThanOrEqual(11);
    expect(written).toEqual(expect.arrayContaining(["did_not_pass", "adverse_action", "suspended"]));
  });

  test("checkr_status is ALSO written from bound parameters — the column is not a closed set", () => {
    // Five writes bind a value rather than a literal, and one of them is Checkr's own
    // `report.result` passed straight through:
    //   const checkrStatus = cleared ? "clear" : (actualResult === "consider" ? "consider" : actualResult)
    // So Checkr can introduce a value nobody here has ever seen and it lands in the column.
    // That is not a bug to fix — it is the reason the unknown phase has to be safe, and why
    // the old "anything I don't recognise means start a new check" default was dangerous.
    const bound = [...raw("src/routes/checkr.js").matchAll(/checkr_status\s*=\s*\?/g)].length;
    expect(bound).toBeGreaterThan(0);
    expect(raw("src/routes/checkr.js")).toMatch(/const checkrStatus = cleared \? "clear"/);
  });

  test("the four the constants file adds beyond the literals are classified too", () => {
    // consider / consider_approved / pending / rejected reach the column by other routes.
    for (const s of ["consider", "consider_approved", "pending", "rejected"]) {
      expect(C.ALL_STATUSES).toContain(s);
      expect(C.phaseFor(s, false)).not.toBe(C.PHASE.UNKNOWN);
    }
  });

  test.each(written)("'%s' maps to a real phase, never 'unknown'", (status) => {
    const phase = C.phaseFor(status, false);
    expect(Object.values(C.PHASE)).toContain(phase);
    // This is the assertion that bites when someone adds a status and forgets this file.
    expect(phase).not.toBe(C.PHASE.UNKNOWN);
  });

  test("a status nobody taught it resolves to unknown, not to something plausible", () => {
    expect(C.phaseFor("some_new_checkr_state", false)).toBe(C.PHASE.UNKNOWN);
  });

  test("and 'unknown' never offers to start a check — that was the bug", () => {
    expect(C.mayStart(C.PHASE.UNKNOWN)).toBe(false);
    expect(C.mayStart(C.PHASE.BLOCKED_PENDING_REVIEW)).toBe(false);
    expect(C.mayStart(C.PHASE.UNDER_REVIEW)).toBe(false);
    // Only these two mean "no check is running and starting one is correct".
    expect(C.mayStart(C.PHASE.NOT_STARTED)).toBe(true);
    expect(C.mayStart(C.PHASE.RESTARTABLE)).toBe(true);
  });

  test("the four that were showing a submission form are all blocked_pending_review", () => {
    for (const s of ["did_not_pass", "rejected", "adverse_action", "suspended"]) {
      expect(C.phaseFor(s, false)).toBe(C.PHASE.BLOCKED_PENDING_REVIEW);
    }
  });

  test("a review pending a human is never reported as a failure", () => {
    for (const s of ["consider", "disputed"]) {
      expect(C.phaseFor(s, false)).toBe(C.PHASE.UNDER_REVIEW);
    }
  });

  test("the cleared flag wins over any stored status", () => {
    // is_background_checked is what the rest of the platform gates work on.
    expect(C.phaseFor("did_not_pass", true)).toBe(C.PHASE.CLEARED);
    expect(C.phaseFor(null, true)).toBe(C.PHASE.CLEARED);
  });

  test("no status is classified into two groups", () => {
    const all = [...C.CLEARED, ...C.IN_PROGRESS, ...C.AWAITING_CAREGIVER,
                 ...C.UNDER_REVIEW, ...C.BLOCKED_PENDING_REVIEW, ...C.RESTARTABLE];
    expect(all.length).toBe(new Set(all).size);
  });
});

describe("F2 — both screens are served the phase by the server", () => {
  test("/api/checkr/status returns it", () => {
    const src = code("src/routes/checkr.js");
    expect(src).toMatch(/phase: phaseFor\(profile\.checkr_status, profile\.is_background_checked\)/);
  });

  test("the caregiver dashboard profile returns it", () => {
    const src = code("src/routes/dashboard.js");
    expect(src).toMatch(/checkrPhase: checkrPhaseFor\(profile\.checkr_status, profile\.is_background_checked\)/);
  });

  test("neither derives it client-side — one mapping, not three", () => {
    for (const f of ["public/js/components/MyAccount.js", "public/js/components/CaretakerHub.js"]) {
      const src = code(f);
      expect(src).not.toMatch(/did_not_pass|adverse_action/);
    }
  });
});

describe("F3 — the states that rendered wrongly now render", () => {
  const myAccount = code("public/js/components/MyAccount.js");
  const hub = code("public/js/components/CaretakerHub.js");

  test("MyAccount handles the blocked phase BEFORE it can reach the submission form", () => {
    const branch = myAccount.indexOf("checkrPhase === 'blocked_pending_review'");
    const embed = myAccount.indexOf("CheckrEmbed");
    expect(branch).toBeGreaterThan(-1);
    expect(embed).toBeGreaterThan(-1);
    // Order is the whole fix: the chain is a ternary cascade, so a branch after the form
    // is a branch that never runs for these caregivers.
    expect(branch).toBeLessThan(embed);
  });

  test("…and it neither offers a retry nor announces a verdict", () => {
    const i = myAccount.indexOf("checkrPhase === 'blocked_pending_review'");
    const block = myAccount.slice(i, i + 1600);
    expect(block).not.toMatch(/CheckrEmbed|Start Background Check|Try Again/);
    // Pete reviews first — the platform must not announce an outcome before he has.
    // pre_adverse_action is the START of a notice period, so "not approved" would be wrong
    // as well as his call to make rather than ours.
    expect(block).not.toMatch(/can't approve|cannot approve|not approved|did not pass|failed/i);
    expect(block).toMatch(/under review/i);
    expect(block).toMatch(/Nothing is decided/);
    expect(block).toMatch(/support@yourinplace\.com/);
  });

  test.each([
    ["under_review", myAccount],
    ["awaiting_caregiver", myAccount],
    ["unknown", myAccount],
    ["blocked_pending_review", hub],
    ["awaiting_caregiver", hub],
    ["restartable", hub],
  ])("phase '%s' has a branch", (phase, src) => {
    expect(src).toMatch(new RegExp(`checkrPhase === '${phase}'`));
  });

  test("CaretakerHub's banner no longer renders nothing for a failed check", () => {
    // Its chain used to end at `disputed` and fall to `return null`.
    const decl = hub.indexOf("const checkrPhase = profile.checkrPhase;");
    expect(decl).toBeGreaterThan(-1);
    const chain = hub.slice(decl, hub.indexOf("return null;", decl));
    expect(chain).toMatch(/checkrPhase === 'blocked_pending_review'/);
  });

  test("the unknown branch says nothing about the outcome", () => {
    const i = myAccount.indexOf("checkrPhase === 'unknown'");
    const block = myAccount.slice(i, i + 1200);
    expect(block).not.toMatch(/complete|approved|passed|failed/i);
    expect(block).toMatch(/support@yourinplace\.com/);
  });
});

describe("F4 — an adverse result stops work and waits for an admin", () => {
  const checkr = code("src/routes/checkr.js");
  const verif = code("src/routes/admin/verification.js");
  const block = code("src/utils/caregiverBlock.js");

  test("all three adverse webhooks call the block", () => {
    for (const source of ["suspended", "pre_adverse_action", "post_adverse_action"]) {
      expect(checkr).toMatch(new RegExp(`blockOnAdverse\\(db, candidate_id, "${source}"`));
    }
  });

  test("each one's block sits right after the status write, not somewhere hopeful", () => {
    // The bug was a status string and nothing else. Pin them adjacent so a later edit cannot
    // reintroduce a branch that sets the status and walks away.
    for (const [status, source] of [
      ["'suspended'", "suspended"],
      ["'adverse_action'", "pre_adverse_action"],
      ["'did_not_pass'", "post_adverse_action"],
    ]) {
      const at = checkr.indexOf(`checkr_status = ${status}`);
      expect(at).toBeGreaterThan(-1);
      const after = checkr.slice(at, at + 700);
      expect(after).toMatch(new RegExp(`blockOnAdverse\\(db, candidate_id, "${source}"`));
    }
  });

  test("the block clears the column the work gates actually read", () => {
    // Setting checkr_status was never enough: every gate reads is_background_checked.
    expect(block).toMatch(/is_background_checked = 0/);
    expect(block).toMatch(/account_paused = 1/);
    expect(block).toMatch(/is_available = 0/);
  });

  test("…and revokes vouches, the other way through the gate", () => {
    expect(block).toMatch(/UPDATE bg_admin_vouches SET revoked_at = NOW\(\), revoked_by = \?/);
    expect(block).toMatch(/revoked_at IS NULL/);
  });

  test("both halves are one transaction", () => {
    const i = block.indexOf("await db.transaction");
    expect(i).toBeGreaterThan(-1);
    const tx = block.slice(i, i + 1400);
    expect(tx).toMatch(/is_background_checked = 0/);
    expect(tx).toMatch(/UPDATE bg_admin_vouches/);
  });

  test("an admin is pushed, not just given a feed row", () => {
    // post_adverse_action wrote activity_feed and sent no push, so "in the loop" depended on
    // someone scrolling.
    const i = checkr.indexOf("async function blockOnAdverse");
    const fn = checkr.slice(i, i + 3000);
    expect(fn).toMatch(/sendPushToUser/);
    expect(fn).toMatch(/is_admin = 1/);
  });

  test("…and the push names nobody — a lock screen is not the place for this", () => {
    // The first version put the caregiver's name in the title and the reason in the body.
    // tests/pushPhi.test.js caught it; this pins the shape so it cannot come back.
    const i = checkr.indexOf("async function blockOnAdverse");
    const fn = checkr.slice(i, i + 3000);
    const pushCall = fn.slice(fn.indexOf("await sendPushToUser"), fn.indexOf(").catch(() => {});"));
    expect(pushCall).not.toMatch(/first_name|last_name|\$\{name\}|email/);
    expect(pushCall).toMatch(/"Background check needs review"/);
    // the specifics live in the data payload, behind the unlock
    expect(fn).toMatch(/wasCleared: result\.wasCleared/);
    expect(fn).toMatch(/vouchesRevoked: result\.vouchesRevoked/);
  });

  test("the urgency survives without the identity", () => {
    // An admin still learns the one thing that changes how fast they act.
    const i = checkr.indexOf("const body = result.wasCleared");
    expect(i).toBeGreaterThan(-1);
    expect(checkr.slice(i, i + 260)).toMatch(/cleared to work has been blocked/);
  });

  test("the admin reject path uses the same block", () => {
    expect(verif).toMatch(/blockPendingAdminReview\(db, \{/);
    // and no longer un-pauses on the way through
    const i = verif.indexOf("checkr_status = 'rejected'");
    expect(verif.slice(i, i + 200)).not.toMatch(/account_paused = 0/);
  });

  test("the caregiver is not invited to restart, and /initiate checks the pause first", () => {
    const i = checkr.indexOf('router.post("/initiate"');
    const head = checkr.slice(i, i + 1400);
    expect(head).toMatch(/PENDING_ADMIN_REVIEW/);
    // Before the kill switch and the configured-check, both of which answer 503 and would
    // tell a blocked caregiver the service is broken instead of the truth.
    expect(head.indexOf("PENDING_ADMIN_REVIEW")).toBeLessThan(head.indexOf("bgChecksEnabled"));
  });

  test("the re-initiate allow-list IS the restartable set — one definition", () => {
    expect(checkr).toMatch(/const reInitiatableStatuses = RESTARTABLE;/);
    const C2 = require("../src/constants/checkrStatus");
    expect(C2.RESTARTABLE).not.toContain("did_not_pass");
    expect(C2.RESTARTABLE).not.toContain("rejected");
  });
});
