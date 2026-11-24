/**
 * v1.105.79 — who the invite search will and will not reveal.
 *
 * This search is the doorway to another person's health record. Pete's call was that it may
 * only surface people you already have a relationship with; a global name lookup would let
 * anyone enumerate who has an InPlace account.
 *
 * Exercised against real postgres because the staging check was inconclusive: every demo
 * account is is_demo = 1 and therefore correctly excluded, so an empty result there proved
 * nothing either way.
 */
const { startHarness, stopHarness } = require("./harness");
const { v4: uuid } = require("uuid");

jest.setTimeout(180000);

let h, getDb;

beforeAll(async () => {
  h = await startHarness({ routers: { "/api/care-teams": "../../src/routes/careTeams" } });
  ({ getDb } = require("../../src/models/database"));
});
afterAll(async () => { await stopHarness(h); });

async function mkUser(first, opts = {}) {
  const { user, token } = await h.createUser({ firstName: first, roles: ["family"] });
  if (opts.isDemo) {
    await (await getDb()).prepare("UPDATE users SET is_demo = 1 WHERE id = ?").run(user.id);
  }
  return { id: user.id, email: user.email, token };
}

describe("the invite search only reveals people you already know", () => {
  let db, leader, teammate, connected, stranger, teamId, recipientId;

  beforeAll(async () => {
    db = await getDb();
    leader = await mkUser("Leader");
    teammate = await mkUser("Susan");
    connected = await mkUser("Julia");
    stranger = await mkUser("Stranger");

    recipientId = uuid(); teamId = uuid();
    await db.prepare("INSERT INTO care_recipients (id, family_user_id, first_name, last_name) VALUES (?, ?, 'Betty', 'T')").run(recipientId, leader.id);
    await db.prepare("INSERT INTO care_teams (id, care_recipient_id, name, created_by) VALUES (?, ?, 'Betty', ?)").run(teamId, recipientId, leader.id);
    await db.prepare("INSERT INTO care_team_members (id, care_team_id, user_id, role) VALUES (?, ?, ?, 'leader')").run(uuid(), teamId, leader.id);
    await db.prepare("INSERT INTO care_team_members (id, care_team_id, user_id, role) VALUES (?, ?, ?, 'member')").run(uuid(), teamId, teammate.id);
    // Julia: an accepted connection, but NOT on this team
    await db.prepare("INSERT INTO connections (id, requester_id, recipient_id, status) VALUES (?, ?, ?, 'accepted')").run(uuid(), leader.id, connected.id);
  });

  const search = (who, q) =>
    h.request.get(`/api/care-teams/${teamId}/invite-search?q=${encodeURIComponent(q)}`).set(h.auth(who.token));

  test("a teammate is found, and flagged as already on the team", async () => {
    const res = await search(leader, "Susan");
    expect(res.status).toBe(200);
    const hit = res.body.people.find((p) => p.firstName === "Susan");
    expect(hit).toBeDefined();
    expect(hit.alreadyOnTeam).toBe(true);
  });

  test("an accepted connection is found", async () => {
    const res = await search(leader, "Julia");
    expect(res.body.people.map((p) => p.firstName)).toContain("Julia");
  });

  test("a stranger is NOT found by name", async () => {
    // The whole point: no enumerating who has an account.
    const res = await search(leader, "Stranger");
    expect(res.body.people).toEqual([]);
  });

  test("a stranger IS reachable by their exact email", async () => {
    const row = await db.prepare("SELECT email FROM users WHERE id = ?").get(stranger.id);
    const res = await search(leader, row.email);
    expect(res.body.people.map((p) => p.id)).toContain(stranger.id);
  });

  test("a partial email does not work — it must be exact", async () => {
    const row = await db.prepare("SELECT email FROM users WHERE id = ?").get(stranger.id);
    const res = await search(leader, row.email.slice(0, 8));
    expect(res.body.people.map((p) => p.id)).not.toContain(stranger.id);
  });

  test("a non-leader cannot search at all", async () => {
    const res = await search(teammate, "Julia");
    expect(res.status).toBe(403);
  });

  test("demo accounts are never surfaced", async () => {
    const demo = await mkUser("Demoperson", { isDemo: true });
    await db.prepare("INSERT INTO connections (id, requester_id, recipient_id, status) VALUES (?, ?, ?, 'accepted')").run(uuid(), leader.id, demo.id);
    const res = await search(leader, "Demoperson");
    expect(res.body.people).toEqual([]);
  });

  test("a one-character query returns nothing rather than the whole address book", async () => {
    const res = await search(leader, "S");
    expect(res.body.people).toEqual([]);
  });
});
