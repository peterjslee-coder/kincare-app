/**
 * v1.129.4 — the team leader sets up the care recipient's own sign-in.
 *
 * Pete, 11/17, with Betty's phone for one night: put InPlace on the phone she uses. The leader
 * picks an email and password; the account is linked to the profile the family built, is a
 * TRUSTED link (on the team), and carries a narrow share — no booking, no managing.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || "own-login-secret";

const { startHarness, stopHarness } = require("./harness");

jest.setTimeout(180000);

let h, db, leader, stranger, recipientId, teamId;
const GOOD_PW = "Kitchen#2026";

beforeAll(async () => {
  h = await startHarness({ routers: { "/api/care-recipients": "../../src/routes/careRecipients" } });
  db = h.db;
  leader = await h.createUser({ firstName: "Pete", lastName: "ITest" });
  stranger = await h.createUser({ firstName: "Stranger", lastName: "ITest" });
  ({ recipientId, teamId } = await h.createCareTeam({ familyUserId: leader.user.id }));
});

afterAll(async () => { await stopHarness(h); });

const post = (who, body) => h.request.post(`/api/care-recipients/${recipientId}/own-login`).set(h.auth(who.token)).send(body);

test("only the leader can set it up", async () => {
  const r = await post(stranger, { email: "mom-phone@itest.local", password: GOOD_PW });
  expect(r.status).toBe(403);
});

test("a weak password or bad email is refused with words", async () => {
  expect((await post(leader, { email: "mom-phone@itest.local", password: "short" })).status).toBe(400);
  expect((await post(leader, { email: "not-an-email", password: GOOD_PW })).status).toBe(400);
});

test("an email that already has an account is refused", async () => {
  const r = await post(leader, { email: stranger.user.email, password: GOOD_PW });
  expect(r.status).toBe(409);
});

test("creates a care_for account linked to her profile, trusted, with a narrow share", async () => {
  const r = await post(leader, { email: "Mom-Phone@itest.local", password: GOOD_PW });
  expect(r.status).toBe(201);
  const uid = r.body.userId;

  const u = await db.prepare("SELECT email, role, roles, first_name FROM users WHERE id = ?").get(uid);
  expect(u.email).toBe("mom-phone@itest.local");
  expect(u.role).toBe("care_for");
  expect(JSON.parse(u.roles)).toEqual(["care_for"]);
  expect(u.first_name).toBe("Betty");

  const cr = await db.prepare("SELECT linked_user_id, self_onboarding_complete FROM care_recipients WHERE id = ?").get(recipientId);
  expect(cr.linked_user_id).toBe(uid);
  expect(Number(cr.self_onboarding_complete)).toBe(1);

  // Trusted: she is on the team, so utils/linkedAccount treats the link as real.
  const { TRUSTED_LINK_SQL } = require("../../src/utils/linkedAccount");
  const trusted = await db.prepare(`SELECT cr.id FROM care_recipients cr WHERE cr.id = ? AND ${TRUSTED_LINK_SQL}`).get(recipientId);
  expect(trusted).toBeTruthy();
  const member = await db.prepare("SELECT role FROM care_team_members WHERE care_team_id = ? AND user_id = ?").get(teamId, uid);
  expect(member.role).toBe("member");

  // Narrow: never book_care or manage.
  const share = await db.prepare("SELECT permission, capabilities FROM care_recipient_shares WHERE care_recipient_id = ? AND shared_with_user_id = ?").get(recipientId, uid);
  expect(share.permission).toBe("view");
  const caps = JSON.parse(share.capabilities);
  expect(caps).not.toContain("book_care");
  expect(caps).not.toContain("manage");

  const audit = await db.prepare("SELECT event_type FROM consent_audit_log WHERE care_recipient_id = ? AND event_type = 'own_login_created'").get(recipientId);
  expect(audit).toBeTruthy();
});

test("a second sign-in for the same person is refused", async () => {
  const r = await post(leader, { email: "another@itest.local", password: GOOD_PW });
  expect(r.status).toBe(409);
  const n = await db.prepare("SELECT COUNT(*)::int AS n FROM users WHERE email = 'another@itest.local'").get();
  expect(n.n).toBe(0);
});
