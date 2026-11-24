/**
 * v1.112.0 — the identity gate. Pete, 10/12: "We should absolutely require someone to verify
 * their ID before they are able to sign up for care."
 *
 * The worry it answers, in his words: "bleedover where some random dude signs up and ends up
 * seeing my mom's profile or getting notifications." So every test here is a stranger-shaped
 * account trying to reach a care record, and the one door that lets them (a human approving
 * their ID) actually opening.
 */
const { startHarness, stopHarness } = require("./harness");
const { v4: uuid } = require("uuid");

jest.setTimeout(180000);
let h, db;

beforeAll(async () => {
  h = await startHarness({ routers: {
    "/api/auth": "../../src/routes/auth",
    "/api/care-recipients": "../../src/routes/careRecipients",
    "/api/care-teams": "../../src/routes/careTeams",
    "/api/messages": "../../src/routes/messages",
    "/api/documents": "../../src/routes/documents",
    "/api/medical-records": "../../src/routes/medicalRecords",
    "/api/self-onboarding": "../../src/routes/selfOnboarding",
    "/api/push": "../../src/routes/push",
    "/api/sessions": ["../../src/routes/offers", "../../src/routes/sessions"],
  } });
  db = h.db;
});
afterAll(async () => { await stopHarness(h); });

const PAST = () => new Date(Date.now() - 86400000).toISOString();
const FUTURE = () => new Date(Date.now() + 7 * 86400000).toISOString();

/** A team owned by a verified leader, with `member` added to it. */
async function teamWith(member) {
  const { user: leader } = await h.createUser({ firstName: "Pete" });
  const { recipientId, teamId } = await h.createCareTeam({ familyUserId: leader.id });
  await h.addTeamMember(teamId, member.id, "member");
  return { leader, recipientId, teamId };
}

function careRoutes(recipientId, teamId) {
  return [
    ["get", `/api/care-recipients/${recipientId}`],
    ["get", "/api/care-recipients"],
    ["get", `/api/care-teams/${teamId}`],
    ["get", "/api/care-teams"],
    ["get", "/api/messages/conversations"],
    ["get", `/api/documents/owner/care_recipient/${recipientId}`],
    ["get", `/api/medical-records/${recipientId}`],
    ["post", "/api/sessions"],
  ];
}

async function addIdDoc(userId, status, extracted) {
  const id = uuid();
  await db.prepare(`
    INSERT INTO verified_documents (id, owner_id, owner_type, uploaded_by, category, document_type,
                                    file_data, status, is_verified, extracted_data, created_at)
    VALUES (?, ?, 'user', ?, 'identity', 'ID_Front', '', ?, ?, ?, NOW())
  `).run(id, userId, userId, status, status === "approved" ? 1 : 0, extracted ? JSON.stringify(extracted) : null);
  return id;
}

describe("a new account without an approved ID sees no care", () => {
  test("every care route answers 403 ID_REQUIRED — recipient, team, messages, documents, medical, booking", async () => {
    const { user, token } = await h.createUser({ idVerified: false, firstName: "Kit" });
    const { recipientId, teamId } = await teamWith(user);
    for (const [method, path] of careRoutes(recipientId, teamId)) {
      const res = await h.request[method](path).set(h.auth(token)).send(method === "post" ? {} : undefined);
      expect([path, res.status]).toEqual([path, 403]);
      expect(res.body.code).toBe("ID_REQUIRED");
      expect(res.body.status).toBe("needs_id");
      expect(typeof res.body.message).toBe("string");
    }
  });

  test("account pages still work: /me reports the gate state", async () => {
    const { token } = await h.createUser({ idVerified: false });
    const me = await h.request.get("/api/auth/me").set(h.auth(token));
    expect(me.status).toBe(200);
    expect(me.body.user.careAccess).toMatchObject({ status: "needs_id", allowed: false });
  });

  test("a submitted, not-yet-reviewed ID is pending_review — still blocked", async () => {
    const { user, token } = await h.createUser({ idVerified: false });
    const { recipientId } = await teamWith(user);
    await addIdDoc(user.id, "pending");
    const res = await h.request.get(`/api/care-recipients/${recipientId}`).set(h.auth(token));
    expect(res.status).toBe(403);
    expect(res.body.status).toBe("pending_review");
  });

  test("Needs-you carries only the identity item for a blocked person", async () => {
    const { token } = await h.createUser({ idVerified: false });
    const res = await h.request.get("/api/push/attention/items").set(h.auth(token));
    expect(res.status).toBe(200);
    expect(res.body.items.map((i) => i.kind)).toEqual(["identity"]);
  });
});

describe("grace", () => {
  test("an existing account inside its grace period keeps care, and is asked to verify by the date", async () => {
    const graceUntil = FUTURE();
    const { user, token } = await h.createUser({ idVerified: false, graceUntil });
    const { recipientId } = await teamWith(user);
    const res = await h.request.get(`/api/care-recipients/${recipientId}`).set(h.auth(token));
    expect(res.status).toBe(200);

    const items = await h.request.get("/api/push/attention/items").set(h.auth(token));
    const idItem = items.body.items.find((i) => i.kind === "identity");
    expect(idItem).toBeTruthy();
    expect(idItem.title).toBe("Verify your ID");
    expect(new Date(idItem.deadline).getTime()).toBe(new Date(graceUntil).getTime());
    expect(idItem.page).toBe("account");
  });

  test("an expired grace period is blocked", async () => {
    const { user, token } = await h.createUser({ idVerified: false, graceUntil: PAST() });
    const { recipientId } = await teamWith(user);
    const res = await h.request.get(`/api/care-recipients/${recipientId}`).set(h.auth(token));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("ID_REQUIRED");
  });
});

describe("an admin approving the ID is the only step", () => {
  test("approve → allowed, with nothing else to do", async () => {
    const { user, token } = await h.createUser({ idVerified: false });
    const { recipientId } = await teamWith(user);
    const docId = await addIdDoc(user.id, "pending");
    expect((await h.request.get(`/api/care-recipients/${recipientId}`).set(h.auth(token))).status).toBe(403);

    const { token: adminToken } = await h.createUser({ isAdmin: true, idVerified: false });
    const review = await h.request.post(`/api/documents/admin/${docId}/review`)
      .set(h.auth(adminToken)).send({ action: "approve" });
    expect(review.status).toBe(200);

    expect((await h.request.get(`/api/care-recipients/${recipientId}`).set(h.auth(token))).status).toBe(200);
    const me = await h.request.get("/api/auth/me").set(h.auth(token));
    expect(me.body.user.careAccess.status).toBe("verified");
    expect(me.body.user.identityStatus).toBe("verified");
  });
});

describe("accept-invite", () => {
  test("refused without consuming the invite, and works after approval", async () => {
    const { user: leader } = await h.createUser();
    const { teamId } = await h.createCareTeam({ familyUserId: leader.id });
    const { user, token } = await h.createUser({ idVerified: false });
    const inviteToken = `tok-${uuid()}`;
    await db.prepare(
      "INSERT INTO care_team_invites (id, care_team_id, invited_email, invited_by, role, token, status, expires_at) VALUES (?, ?, ?, ?, 'member', ?, 'pending', NOW() + INTERVAL '7 days')"
    ).run(uuid(), teamId, user.email, leader.id, inviteToken);

    const blocked = await h.request.post("/api/care-teams/accept-invite").set(h.auth(token)).send({ token: inviteToken });
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe("ID_REQUIRED");
    const still = await db.prepare("SELECT status FROM care_team_invites WHERE token = ?").get(inviteToken);
    expect(still.status).toBe("pending");
    const member = await db.prepare("SELECT 1 FROM care_team_members WHERE care_team_id = ? AND user_id = ?").get(teamId, user.id);
    expect(member).toBeFalsy();

    await h.verifyIdentity(user.id);
    const ok = await h.request.post("/api/care-teams/accept-invite").set(h.auth(token)).send({ token: inviteToken });
    expect(ok.status).toBe(200);
    const joined = await db.prepare("SELECT 1 FROM care_team_members WHERE care_team_id = ? AND user_id = ?").get(teamId, user.id);
    expect(joined).toBeTruthy();
  });
});

describe("care_for self-signup", () => {
  test("creates no care recipient until a person approves the ID, then names it from the ID", async () => {
    const email = `self-${uuid().slice(0, 8)}@itest.local`;
    const reg = await h.request.post("/api/auth/register").send({
      email, password: "SecurePass1!", firstName: "Betty", lastName: "Lee",
      dateOfBirth: "1944-02-01", role: "care_for",
    });
    expect(reg.status).toBe(201);
    const userId = reg.body.user.id;
    const token = reg.body.token;

    const none = await db.prepare("SELECT id FROM care_recipients WHERE linked_user_id = ? OR family_user_id = ?").all(userId, userId);
    expect(none).toHaveLength(0);
    const teams = await db.prepare("SELECT id FROM care_teams WHERE created_by = ?").all(userId);
    expect(teams).toHaveLength(0);

    // The wizard's answers wait on the intent.
    const done = await h.request.post("/api/self-onboarding/complete").set(h.auth(token)).send({
      termsAccepted: true, nonMedicalAcknowledged: true,
      careAddress: { line1: "1 Main St", city: "Blacksburg", state: "VA", zip: "24060" },
      emergencyContact: { name: "Sara", phone: "5405550100", relationship: "daughter" },
      preferredName: "Kitty",
    });
    expect(done.status).toBe(200);
    expect(done.body.pendingApproval).toBe(true);
    expect(await db.prepare("SELECT id FROM care_recipients WHERE linked_user_id = ?").get(userId)).toBeFalsy();
    const me1 = await h.request.get("/api/auth/me").set(h.auth(token));
    expect(me1.body.user.selfOnboardingComplete).toBe(true);
    expect(me1.body.user.careAccess.allowed).toBe(false);

    // A human approves her ID; the printed name differs from what was typed at signup.
    const docId = await addIdDoc(userId, "pending", { extractedName: "KATHERINE A CONN" });
    const { token: adminToken } = await h.createUser({ isAdmin: true });
    const review = await h.request.post(`/api/documents/admin/${docId}/review`).set(h.auth(adminToken)).send({ action: "approve" });
    expect(review.status).toBe(200);

    const cr = await db.prepare("SELECT id, first_name, last_name, family_user_id, preferred_name, self_onboarding_complete FROM care_recipients WHERE linked_user_id = ?").get(userId);
    expect(cr).toBeTruthy();
    expect([cr.first_name, cr.last_name]).toEqual(["Katherine", "Conn"]);
    expect(cr.family_user_id).toBe(userId);
    expect(cr.preferred_name).toBe("Kitty");
    expect(Number(cr.self_onboarding_complete)).toBe(1);
    const team = await db.prepare("SELECT ct.id FROM care_teams ct JOIN care_team_members m ON m.care_team_id = ct.id WHERE ct.care_recipient_id = ? AND m.user_id = ? AND m.role = 'leader'").get(cr.id, userId);
    expect(team).toBeTruthy();

    // Idempotent: /me after approval does not make a second one.
    await h.request.get("/api/auth/me").set(h.auth(token));
    const all = await db.prepare("SELECT id FROM care_recipients WHERE linked_user_id = ?").all(userId);
    expect(all).toHaveLength(1);
  });
});

describe("notifications", () => {
  test("push fan-out skips a blocked team member, and capability fan-outs drop them", async () => {
    const { user: blocked } = await h.createUser({ idVerified: false });
    const { user: verified } = await h.createUser();
    const { recipientId, teamId, leader } = await teamWith(blocked);
    await h.addTeamMember(teamId, verified.id, "member");

    const { usersWithCapability } = require("../../src/utils/access");
    const { CAP } = require("../../src/utils/capabilities");
    const told = await usersWithCapability(db, recipientId, CAP.READ_NOTES);
    expect(told).toEqual(expect.arrayContaining([leader.id, verified.id]));
    expect(told).not.toContain(blocked.id);

    const { sendPushToUser } = require("../../src/routes/push");
    const r = await sendPushToUser(blocked.id, { title: "New note", body: "x", data: { type: "team_note", careRecipientId: recipientId } }, "team_note");
    expect(r.reason).toBe("id_required");
    const r2 = await sendPushToUser(blocked.id, { title: "Message", body: "x", data: { type: "message" } }, "message");
    expect(r2.reason).toBe("id_required");
    const rows = await db.prepare("SELECT 1 FROM notifications WHERE user_id = ?").all(blocked.id);
    expect(rows).toHaveLength(0);

    // ...but they are still told about their own account.
    const r3 = await sendPushToUser(blocked.id, { title: "Your ID is approved", body: "x", data: { type: "identity_approved" } }, "identity_approved");
    expect(r3.reason).not.toBe("id_required");
  });
});

describe("exempt", () => {
  test("an admin without an ID is never gated", async () => {
    const { user: admin, token } = await h.createUser({ isAdmin: true, idVerified: false });
    const { user: other } = await h.createUser();
    const { recipientId } = await h.createCareTeam({ familyUserId: other.id });
    const res = await h.request.get(`/api/care-recipients/${recipientId}`).set(h.auth(token));
    expect(res.status).not.toBe(403);
    const me = await h.request.get("/api/auth/me").set(h.auth(token));
    expect(me.body.user.careAccess.status).toBe("exempt");
    expect(admin.id).toBeTruthy();
  });

  test("a demo account without an ID is never gated", async () => {
    const { user, token } = await h.createUser({ isDemo: true, idVerified: false });
    const { recipientId } = await h.createCareTeam({ familyUserId: user.id });
    const res = await h.request.get(`/api/care-recipients/${recipientId}`).set(h.auth(token));
    expect(res.status).toBe(200);
  });
});

describe("migration 056 against realistic rows", () => {
  // The backfill only ever meets real rows on prod (staging is seeded fresh), so run the exact
  // statement from database.js against a population shaped like prod's.
  function backfillSql() {
    const src = require("fs").readFileSync(require("path").join(__dirname, "../../src/models/database.js"), "utf8");
    const at = src.indexOf('id: "056_identity_gate"');
    const start = src.indexOf("`UPDATE users u SET id_gate_grace_until", at);
    const end = src.indexOf("`", start + 1);
    return src.slice(start + 1, end);
  }

  test("graces every real unverified account; not admins, demos, the verified, or an existing deadline", async () => {
    const plain = (await h.createUser({ idVerified: false })).user;
    const caregiver = (await h.createUser({ idVerified: false, roles: ["caregiver"] })).user;
    const verified = (await h.createUser()).user;
    const admin = (await h.createUser({ isAdmin: true, idVerified: false })).user;
    const demo = (await h.createUser({ isDemo: true, idVerified: false })).user;
    const pendingOnly = (await h.createUser({ idVerified: false })).user;
    await addIdDoc(pendingOnly.id, "pending");
    const keep = "2030-01-01T00:00:00.000Z";
    const already = (await h.createUser({ idVerified: false, graceUntil: keep })).user;
    // A stranger linked to someone else's profile, where the PROFILE has an approved ID that
    // someone else uploaded — must still get a deadline (the Kit Conn shape).
    const stranger = (await h.createUser({ idVerified: false })).user;
    const { user: fam } = await h.createUser();
    const { recipientId } = await h.createCareTeam({ familyUserId: fam.id });
    await db.prepare("UPDATE care_recipients SET linked_user_id = ? WHERE id = ?").run(stranger.id, recipientId);
    await db.prepare(`INSERT INTO verified_documents (id, owner_id, owner_type, uploaded_by, category, document_type, file_data, status, is_verified, created_at)
      VALUES (?, ?, 'care_recipient', ?, 'identity', 'ID_Front', '', 'approved', 1, NOW())`).run(uuid(), recipientId, fam.id);

    await db.exec(backfillSql());

    const grace = async (id) => (await db.prepare("SELECT id_gate_grace_until AS g FROM users WHERE id = ?").get(id)).g;
    for (const u of [plain, caregiver, pendingOnly, stranger]) {
      const g = new Date(await grace(u.id)).getTime();
      expect(g).toBeGreaterThan(Date.now() + 13 * 86400000);
      expect(g).toBeLessThan(Date.now() + 15 * 86400000);
    }
    for (const u of [verified, admin, demo]) expect(await grace(u.id)).toBeNull();
    expect(new Date(await grace(already.id)).toISOString()).toBe(keep);

    // And the resolver agrees about the stranger: not verified by someone else's upload.
    const { careAccessFor } = require("../../src/utils/careAccess");
    expect((await careAccessFor(db, stranger.id)).status).toBe("grace");
  });
});
