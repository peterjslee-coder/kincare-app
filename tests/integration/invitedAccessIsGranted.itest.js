/**
 * v1.105.86 — the access you ticked is the access they end up with.
 *
 * Pete: "if I go to the trouble to check off what i want her to be able to do and send the
 * invitation, I don't want it to grant her full member privileges until I can go change her
 * back to limited. It should establish her with the access i grant."
 *
 * Both previous failure modes erred toward MORE access than was granted, which is the only
 * direction that actually matters for a permission grant.
 */
const { startHarness, stopHarness } = require("./harness");
const { v4: uuid } = require("uuid");
const { CAP, PRESETS, can } = require("../../src/utils/capabilities");

jest.setTimeout(180000);
let h, getDb, recipientCapabilities;

beforeAll(async () => {
  h = await startHarness({ routers: { "/api/care-teams": "../../src/routes/careTeams" } });
  ({ getDb } = require("../../src/models/database"));
  ({ recipientCapabilities } = require("../../src/utils/access"));
});
afterAll(async () => { await stopHarness(h); });

async function inviteAndAccept({ capabilities, role = "viewer", preExistingShare = null }) {
  const db = await getDb();
  const owner = await h.createUser({ firstName: "Pete", roles: ["family"] });
  const invitee = await h.createUser({ firstName: "Julia", roles: ["caregiver"] });

  const recipientId = uuid(), teamId = uuid();
  await db.prepare("INSERT INTO care_recipients (id, family_user_id, first_name, last_name) VALUES (?, ?, 'Betty', 'T')").run(recipientId, owner.user.id);
  await db.prepare("INSERT INTO care_teams (id, care_recipient_id, name, created_by) VALUES (?, ?, 'Betty', ?)").run(teamId, recipientId, owner.user.id);
  await db.prepare("INSERT INTO care_team_members (id, care_team_id, user_id, role) VALUES (?, ?, ?, 'leader')").run(uuid(), teamId, owner.user.id);

  if (preExistingShare) {
    await db.prepare(
      "INSERT INTO care_recipient_shares (id, care_recipient_id, shared_with_user_id, permission, capabilities, shared_by_user_id) VALUES (?, ?, ?, 'edit', ?, ?)"
    ).run(uuid(), recipientId, invitee.user.id, JSON.stringify(preExistingShare), owner.user.id);
  }

  const token = uuid();
  await db.prepare(`
    INSERT INTO care_team_invites (id, care_team_id, invited_email, invited_by, role, token, status, expires_at, capabilities)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', NOW() + INTERVAL '7 days', ?)
  `).run(uuid(), teamId, invitee.user.email, owner.user.id, role, token, capabilities ? JSON.stringify(capabilities) : null);

  const res = await h.request.post("/api/care-teams/accept-invite").set(h.auth(invitee.token)).send({ token });
  return { db, owner, invitee, recipientId, res };
}

describe("a ticked capability set survives the join", () => {
  test("Viewer stays Viewer — not full access", async () => {
    const { db, invitee, recipientId, res } = await inviteAndAccept({ capabilities: PRESETS.viewer });
    expect(res.status).toBe(200);

    const caps = await recipientCapabilities(db, recipientId, invitee.user.id);
    expect(can(caps, CAP.READ_NOTES)).toBe(true);
    expect(can(caps, CAP.WRITE_VISITS)).toBe(true);
    // The point of Pete's message:
    expect(can(caps, CAP.MANAGE)).toBe(false);
    expect(can(caps, CAP.CHECK_TASKS)).toBe(false);
  });

  test("Helper gets exactly Helper — no sight of the health record", async () => {
    const { db, invitee, recipientId } = await inviteAndAccept({ capabilities: PRESETS.helper });
    const caps = await recipientCapabilities(db, recipientId, invitee.user.id);
    expect(can(caps, CAP.WRITE_NOTES)).toBe(true);
    expect(can(caps, CAP.READ_PROFILE)).toBe(false);
    expect(can(caps, CAP.READ_NOTES)).toBe(false);
  });

  test("a custom set is honoured exactly", async () => {
    const custom = [CAP.WRITE_NOTES, CAP.WRITE_VISITS, CAP.READ_TASKS, CAP.CHECK_TASKS]; // Peggy + medication
    const { db, invitee, recipientId } = await inviteAndAccept({ capabilities: custom });
    const caps = await recipientCapabilities(db, recipientId, invitee.user.id);
    expect([...caps].sort()).toEqual([...custom].sort());
  });
});

describe("the two ways it used to over-grant", () => {
  test("an EXISTING share is overwritten by the invite, not skipped", async () => {
    // Previously the whole block sat behind `if (!shareExists)`, so anyone with a prior share
    // kept their old access and the new invite's capabilities were never applied.
    const { db, invitee, recipientId } = await inviteAndAccept({
      capabilities: PRESETS.helper,
      preExistingShare: PRESETS.member,   // full access, from before
    });
    const caps = await recipientCapabilities(db, recipientId, invitee.user.id);
    expect(can(caps, CAP.MANAGE)).toBe(false);      // downgraded, as instructed
    expect(can(caps, CAP.READ_PROFILE)).toBe(false);
    expect(can(caps, CAP.WRITE_NOTES)).toBe(true);
  });

  test("only ONE share row exists afterwards", async () => {
    const { db, invitee, recipientId } = await inviteAndAccept({
      capabilities: PRESETS.viewer, preExistingShare: PRESETS.member,
    });
    const row = await db.prepare(
      "SELECT COUNT(*) AS c FROM care_recipient_shares WHERE care_recipient_id = ? AND shared_with_user_id = ?"
    ).get(recipientId, invitee.user.id);
    expect(parseInt(row.c, 10)).toBe(1);
  });
});

describe("an invite with no capability set still behaves as before", () => {
  test("a plain 'member' invite is full access, as it always was", async () => {
    // Julia's own invite predates the picker. This is why her badge read Full access.
    const { db, invitee, recipientId } = await inviteAndAccept({ capabilities: null, role: "member" });
    const caps = await recipientCapabilities(db, recipientId, invitee.user.id);
    expect(can(caps, CAP.MANAGE)).toBe(true);
  });

  test("a plain 'viewer' invite is the legacy view set", async () => {
    const { db, invitee, recipientId } = await inviteAndAccept({ capabilities: null, role: "viewer" });
    const caps = await recipientCapabilities(db, recipientId, invitee.user.id);
    expect(can(caps, CAP.MANAGE)).toBe(false);
    expect(can(caps, CAP.READ_NOTES)).toBe(true);
  });
});
