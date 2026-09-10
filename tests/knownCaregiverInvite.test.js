// v1.105.186 — a family adds a caregiver it already knows.
//
// Pete, Sep 7 2026: "I find someone interested in the wild. I get their name and number and
// email, and the next thing they get is an email to finish setting up their account."
//
// And the posture, Sep 8, which is the thing these tests exist to hold: "no vouch for family.
// inplace doesn't control who gets to work for families in the event they only use us to coord
// their own care." So the family brought the caregiver, InPlace says so in plain words, and the
// word "vouch" never reaches a screen on this path. The mechanism underneath IS the existing
// per-family gate row — that is plumbing, and plumbing is allowed to keep its name.

const fs = require("fs");
const path = require("path");
const { code } = require("./helpers/source");

const routeSrc = fs.readFileSync(path.join(__dirname, "..", "public", "js", "onboardingRoute.js"), "utf8");
const w = {};
new Function("window", routeSrc)(w);
const { resolveRoute, ONBOARDING_ROUTE_LENGTH, SHORT_PATH_ITEMS } = w;

const known = code("src/utils/knownCaregivers.js");
const route = code("src/routes/knownCaregivers.js");
const platform = code("src/routes/platformInvites.js");
const caregiversRoute = code("src/routes/caregivers.js");
const caregiversUi = code("public/js/components/Caregivers.js");
const wizard = code("public/js/components/CaregiverOnboarding.js");
const hub = code("public/js/components/CaretakerHub.js");
const server = code("src/server.js");
const db = code("src/models/database.js");

// The short path, in the wizard, at a given screen.
const shortAt = (step, over = {}) => resolveRoute(Object.assign({
  surface: "wizard", step, familyOnly: true,
  identity: { submitted: false }, stripe: { status: "none" }, backgroundCheck: {},
}, over));

describe("the short path is four things, and four is the number that goes down", () => {
  test("the full route is untouched — still thirteen", () => {
    expect(ONBOARDING_ROUTE_LENGTH).toBe(13);
    expect(resolveRoute({ surface: "wizard", step: 1, identity: {}, stripe: { status: "none" }, backgroundCheck: {} }).items).toHaveLength(13);
  });

  test("on the short path she sees exactly the four, by name", () => {
    const r = shortAt(1);
    expect(r.familyOnly).toBe(true);
    expect(r.items.map((i) => i.id)).toEqual(["account", "paperwork", "identity", "stripe"]);
    expect(r.items.map((i) => i.label)).toEqual([
      "Create your account", "A few quick details", "A photo of your licence", "Where your pay lands",
    ]);
    expect(SHORT_PATH_ITEMS).toEqual(["account", "paperwork", "identity", "stripe"]);
  });

  test("the other nine are optional — present, never counted, never current", () => {
    const r = shortAt(1);
    expect(r.optional).toHaveLength(9);
    expect(r.optional.every((i) => i.optional)).toBe(true);
    expect(r.optional.map((i) => i.id)).toContain("background-check");
    expect(r.remaining).toBe(4);
    expect(r.total).toBe(4);
    expect(r.current.id).toBe("account");
  });

  test("'a few quick details' spans screens 2 and 3 — one job, two screens", () => {
    // Screens are not route items. On the full route 'paperwork' is done after screen 2 and
    // 'about-you' after 3; on the short path they are one job that finishes after 3, and
    // screen 4 (the safety-check details, with an SSN) is never visited.
    const p = (step) => shortAt(step).items.find((i) => i.id === "paperwork").state;
    expect(p(2)).toBe("todo");
    expect(p(3)).toBe("todo");
    expect(p(4)).toBe("done");
    expect(p(8)).toBe("done");
  });

  test("remaining only ever goes down across the screens she actually visits", () => {
    let previous = Infinity;
    for (const step of [1, 2, 3, 8]) {
      const r = shortAt(step);
      expect(r.remaining).toBeLessThanOrEqual(previous);
      previous = r.remaining;
    }
    // On screen 8 with the photo sent: account + details done, identity waiting, Stripe left.
    const r = shortAt(8, { identity: { submitted: true } });
    expect(r.remaining).toBe(1);
    expect(r.waiting).toBe(1);
    expect(r.current.id).toBe("stripe");
  });

  test("on the dashboard the card closes when HER four are done, not the optional nine", () => {
    const r = resolveRoute({
      surface: "hub", familyOnly: true, profileCreated: true,
      identity: { loaded: true, submitted: true, approved: true, status: "approved" },
      stripe: { status: "complete", connected: true },
      backgroundCheck: {},
      hasPreferences: false, hasAvailability: false, hasRates: false, hasPhoto: false, securityReviewed: false,
    });
    expect(r.remaining).toBe(0);
    expect(r.current).toBeNull();
    expect(r.items.every((i) => i.state === "done")).toBe(true);
    // And the hub's own gate follows the route on the short path, not the seven-item First Steps.
    expect(hub).toMatch(/if \(familyOnly && hubRoute\.items\.every\(\(i\) => i\.state === 'done'\)\) firstStepsDone = firstSteps\.length;/);
  });

  test("without the fact, nothing is optional — the short path cannot leak into the long one", () => {
    const r = resolveRoute({ surface: "wizard", step: 1, identity: {}, stripe: { status: "none" }, backgroundCheck: {} });
    expect(r.optional).toEqual([]);
    expect(r.familyOnly).toBe(false);
  });
});

describe("the word 'vouch' never reaches a screen on this path", () => {
  // Every user-visible string on the new surfaces. The mechanism (bg_admin_vouches) may keep
  // its name in SQL; the copy may not.
  const visibleStrings = (src) => {
    const out = [];
    for (const m of src.matchAll(/(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)) out.push(m[2]);
    for (const m of src.matchAll(/>([^<>{}]+)</g)) out.push(m[1]);
    return out;
  };
  const sqlish = (s) => /bg_admin_vouches|vouched_by|revoked_at|SELECT|INSERT|UPDATE|FROM /.test(s);

  test("the invite route and email", () => {
    const bad = visibleStrings(route).filter((s) => /vouch/i.test(s) && !sqlish(s));
    expect(bad).toEqual([]);
  });

  test("the family's Caregivers screen — new door, form, invited list, badge", () => {
    // The admin-vouch badge from v1.64.0 is still there for admin vouches; the family-brought
    // badge must come FIRST so a family that added someone never reads "Admin-approved".
    const fb = caregiversUi.indexOf("cg.familyBrought ?");
    const av = caregiversUi.indexOf("cg.vouchedForYou ?");
    expect(fb).toBeGreaterThan(-1);
    expect(av).toBeGreaterThan(fb);
    expect(caregiversUi).toContain("Your caregiver · no background check");
    expect(caregiversUi).toContain("InPlace hasn{'\\u2019'}t checked their background");
    const door = caregiversUi.slice(caregiversUi.indexOf("v1.105.186 — the second door"), caregiversUi.indexOf("{/* Tabs */}"));
    expect(door).not.toMatch(/vouch/i);
  });

  test("the caregiver's wizard and dashboard", () => {
    const hero = wizard.slice(wizard.indexOf("familyOnly ? ("), wizard.indexOf("Join InPlace</h1>"));
    expect(hero).toContain("added you as");
    expect(hero).not.toMatch(/vouch/i);
    expect(hub).toContain("added you themselves");
    // The old admin-vouch sentence is still there for admin vouches, behind the branch.
    expect(hub).toContain("You\\'re approved to work with");
  });

  test("and 'approved' is not used for something nobody checked", () => {
    expect(caregiversUi).not.toMatch(/Your caregiver[^\n]*approved/i);
    // The posture is written down where the next person will read it (comments are stripped
    // by the helper, so read the raw file for this one).
    const raw = fs.readFileSync(path.join(__dirname, "..", "src", "utils", "knownCaregivers.js"), "utf8");
    expect(raw).toContain("this is NOT a vouch");
  });
});

describe("mechanism: the gate row is keyed on the OWNER, and the assignment waits for a profile", () => {
  test("family_user_id is the recipient's owner, not the inviter", () => {
    // sessions.js checks hasActiveVouch(caregiver, session.family_user_id) — the owner. A
    // non-owner leader's invite that wrote the inviter's id would open nothing.
    expect(known).toMatch(/INSERT INTO bg_admin_vouches[\s\S]*?\.run\(uuid\(\), caregiverUserId, recipient\.family_user_id, invite\.invited_by/);
    expect(known).toContain('FAMILY_BROUGHT_NOTE = "family-brought"');
  });

  test("accept-invite fulfils it; profile creation finishes the assignment", () => {
    expect(platform).toContain("KNOWN.fulfillKnownCaregiverInvite(db, invite, req.user.id)");
    expect(caregiversRoute).toContain("fulfillPendingForUser(db, req.user.id)");
    // Idempotent on both sides.
    expect(known).toMatch(/SELECT id FROM bg_admin_vouches WHERE caregiver_user_id = \? AND family_user_id = \? AND revoked_at IS NULL LIMIT 1/);
    expect(known).toMatch(/SELECT id FROM caregiver_assignments[\s\S]*?is_active = 1/);
  });

  test("the leader is told, not the admins", () => {
    const start = platform.indexOf("if (invite.kind === KNOWN.KIND) {");
    const block = platform.slice(start, platform.indexOf("notifyAdmins(", start));
    expect(block).toContain("sendPushToUser(invite.invited_by");
    expect(block).toContain("return res.json({ message: \"Invite accepted\", kind: invite.kind });");
    expect(start).toBeGreaterThan(-1);
    // Push data uses `page`, the generic branch __handlePushNavigate actually reads.
    expect(block).toContain('page: "caregivers"');
  });

  test("the leader is told twice, at the two moments that matter: setting up, and ready to book", () => {
    // The accept push says "is setting up". The one the family actually waits for is "ready to
    // book", fired from whichever of Stripe or the licence photo lands last, and only once.
    const payments = code("src/routes/payments.js");
    const onboarding = code("src/routes/caregiveronboarding.js");
    expect((payments.match(/notifyIfReadyToBook\(db, /g) || []).length).toBe(2);
    expect(onboarding).toContain("notifyIfReadyToBook(db, req.user.id)");
    expect(known).toContain("UPDATE platform_invites SET status = 'ready' WHERE id = ? AND status = 'accepted'");
    expect(known).toContain('page: "caregivers"');
  });

  test("phone is stored, never texted", () => {
    expect(platform).toContain("UPDATE users SET phone = COALESCE(NULLIF(phone, ''), ?)");
    expect(route).not.toMatch(/twilio|sendSms|sendArrivalSms/i);
    expect(caregiversUi).toContain("we won{'\\u2019'}t text them");
  });

  test("leader-only, capped, one open door per email, 14 days", () => {
    expect(route).toContain('requireRole("family")');
    expect(route).toContain("recipientIfLeader(db, careRecipientId, req.user.id)");
    expect(known).toContain("OPEN_CAP_PER_LEADER = 5");
    expect(known).toContain("INVITE_DAYS = 14");
    expect(route).toMatch(/status\(429\)/);
    expect(route).toMatch(/already have an open invite/);
  });

  test("mounted, migrated, and the short path is decided by `kind`", () => {
    expect(server).toContain('app.use("/api/known-caregivers", require("./routes/knownCaregivers"))');
    expect(db).toContain('id: "028_known_caregiver_invites"');
    expect(db).toContain("ALTER TABLE platform_invites ADD COLUMN IF NOT EXISTS kind TEXT");
    expect(wizard).toContain("inviteInfo.kind === 'known-caregiver'");
    expect(wizard).toContain("setStep(familyOnly ? 8 : 4)");
    expect(wizard).toContain("backBtn(familyOnly ? 3 : 7)");
  });

  test("an existing account is sent to sign in, and the token survives the trip", () => {
    expect(platform).toContain("out.existingAccount = !!existing");
    expect(wizard).toContain("localStorage.setItem('pendingPlatformInvite', inviteToken)");
    const app = code("public/js/app.js");
    expect(app).toContain("const acceptPendingPlatformInvite = ()");
    expect((app.match(/acceptPendingPlatformInvite\(\);/g) || []).length).toBe(2);
  });
});
