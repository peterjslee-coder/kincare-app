/**
 * v1.153.0 — who may ring whom. The care team and the person they care for can call each
 * other without a chat open first; strangers still cannot, and a stale own-account link (not
 * really her) gets nobody's calls.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || "call-policy-secret";

const { startHarness, stopHarness } = require("./harness");
const { v4: uuid } = require("uuid");
const { mayCall } = require("../../src/utils/callPolicy");

jest.setTimeout(180000);

let h, db, leader, sister, stranger, mom, recipientId, teamId;

beforeAll(async () => {
  h = await startHarness({ routers: { "/api/care-recipients": "../../src/routes/careRecipients" } });
  db = h.db;
  leader = await h.createUser({ firstName: "Pete", lastName: "ITest" });
  sister = await h.createUser({ firstName: "Sara", lastName: "ITest" });
  stranger = await h.createUser({ firstName: "Stranger", lastName: "ITest" });
  ({ recipientId, teamId } = await h.createCareTeam({ familyUserId: leader.user.id }));
  await h.addTeamMember(teamId, sister.user.id);
  const r = await h.request.post(`/api/care-recipients/${recipientId}/own-login`).set(h.auth(leader.token))
    .send({ email: "mom-calls@itest.local", password: "Kitchen#2026" });
  expect(r.status).toBe(201);
  mom = { user: { id: r.body.userId } };
});

afterAll(async () => { await stopHarness(h); });

test("the owner and a team member can ring her, and she them", async () => {
  expect(await mayCall(db, leader.user.id, mom.user.id)).toBe(true);
  expect(await mayCall(db, mom.user.id, leader.user.id)).toBe(true);
  expect(await mayCall(db, sister.user.id, mom.user.id)).toBe(true);
  expect(await mayCall(db, mom.user.id, sister.user.id)).toBe(true);
});

test("a stranger cannot, and nobody calls themselves", async () => {
  expect(await mayCall(db, stranger.user.id, mom.user.id)).toBe(false);
  expect(await mayCall(db, mom.user.id, stranger.user.id)).toBe(false);
  expect(await mayCall(db, mom.user.id, mom.user.id)).toBe(false);
});

test("the team relation is only about HER: two family members still need a shared chat", async () => {
  expect(await mayCall(db, leader.user.id, sister.user.id)).toBe(false);
});

test("a stale link (not on the team, not the owner) is not her", async () => {
  const other = await h.createUser({ firstName: "Other", lastName: "ITest" });
  const crId = uuid();
  await db.prepare("INSERT INTO care_recipients (id, family_user_id, first_name, last_name, linked_user_id) VALUES (?, ?, 'Stale', 'Link', ?)")
    .run(crId, stranger.user.id, other.user.id);
  expect(await mayCall(db, stranger.user.id, other.user.id)).toBe(false);
});

test("a shared conversation still allows a call, as before", async () => {
  const conv = uuid();
  await db.prepare("INSERT INTO conversations (id, type, name, created_by) VALUES (?, 'direct', NULL, ?)").run(conv, leader.user.id);
  for (const u of [leader.user.id, sister.user.id]) {
    await db.prepare("INSERT INTO conversation_members (id, conversation_id, user_id) VALUES (?, ?, ?)").run(uuid(), conv, u);
  }
  expect(await mayCall(db, leader.user.id, sister.user.id)).toBe(true);
});
