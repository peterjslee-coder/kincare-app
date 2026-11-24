/**
 * v1.105.102 — a family member is not the platform.
 *
 * Pete started a message thread with Julia and it showed him to her as "InPlace support"
 * (feedback 7972ed90). Not a label bug: she could not tell whether she was talking to a
 * family member or to InPlace, and safety.js refuses to let anyone block "InPlace Support",
 * so the merged thread was also unblockable.
 *
 * Cause: seven places asked "is there already a direct conversation containing these two
 * users?" against a query that matched ANY direct conversation. Pete is an admin, so an
 * "InPlace Support" thread between him and Julia already existed, and every lookup found it.
 *
 * This runs the real route against the real schema, because the bug is in what a JOIN
 * matches — source-matching the WHERE clause would prove nothing about which row comes back.
 */
const { startHarness, stopHarness } = require("./harness");
const { v4: uuid } = require("uuid");

jest.setTimeout(180000);

let h, db;

beforeAll(async () => {
  h = await startHarness({ routers: { "/api/messages": "../../src/routes/messages" } });
  db = h.db;
});

afterAll(async () => { await stopHarness(h); });

/** The thread admin/safety.js creates when the platform messages a user. */
async function seedSupportThread(adminId, userId) {
  const convId = uuid();
  await db.prepare("INSERT INTO conversations (id, type, name, created_by) VALUES (?, 'direct', 'InPlace Support', ?)")
    .run(convId, adminId);
  for (const uid of [adminId, userId]) {
    await db.prepare("INSERT INTO conversation_members (id, conversation_id, user_id, role) VALUES (?, ?, ?, 'member')")
      .run(uuid(), convId, uid);
  }
  return convId;
}

describe("an admin who is also a person", () => {
  let pete, julia, supportConvId;

  beforeAll(async () => {
    pete = await h.createUser({ firstName: "Pete", lastName: "Lee", isAdmin: true });
    julia = await h.createUser({ firstName: "Julia", lastName: "Huth", roles: ["caregiver"] });
    supportConvId = await seedSupportThread(pete.user.id, julia.user.id);
  });

  test("starting a DM does not land in the support thread", async () => {
    const res = await h.request
      .post("/api/messages/conversations")
      .set(h.auth(pete.token))
      .send({ type: "direct", memberIds: [julia.user.id] });

    expect(res.status).toBe(201);
    expect(res.body.conversationId).toBeTruthy();
    expect(res.body.conversationId).not.toBe(supportConvId);
  });

  test("the new thread is titled by the person, not the platform", async () => {
    const res = await h.request.get("/api/messages/conversations").set(h.auth(julia.token));
    expect(res.status).toBe(200);
    const names = res.body.conversations.map(c => c.name);
    expect(names).toContain("Pete Lee");        // the DM — a person
    expect(names).toContain("InPlace Support"); // still there, still the platform
  });

  test("the two threads stay separate on a second attempt", async () => {
    // Idempotence: asking again reuses the DM, and still never the support thread.
    const first = await h.request.post("/api/messages/conversations")
      .set(h.auth(pete.token)).send({ type: "direct", memberIds: [julia.user.id] });
    const second = await h.request.post("/api/messages/conversations")
      .set(h.auth(pete.token)).send({ type: "direct", memberIds: [julia.user.id] });

    expect(second.body.conversationId).toBe(first.body.conversationId);
    expect(second.body.existing).toBe(true);
    expect(second.body.conversationId).not.toBe(supportConvId);
  });

  test("a DM cannot be named — it cannot impersonate the platform", async () => {
    const impostor = await h.createUser({ firstName: "Mal", lastName: "Ory" });
    await db.prepare("INSERT INTO connections (id, requester_id, recipient_id, status) VALUES (?, ?, ?, 'accepted')")
      .run(uuid(), julia.user.id, impostor.user.id);

    const res = await h.request.post("/api/messages/conversations")
      .set(h.auth(impostor.token))
      .send({ type: "direct", memberIds: [julia.user.id], name: "InPlace Support" });

    expect(res.status).toBe(201);
    const row = await db.prepare("SELECT name FROM conversations WHERE id = ?").get(res.body.conversationId);
    expect(row.name).toBeNull();

    const list = await h.request.get("/api/messages/conversations").set(h.auth(julia.token));
    const named = list.body.conversations.filter(c => c.name === "InPlace Support");
    expect(named).toHaveLength(1);           // only the real one
    expect(named[0].id).toBe(supportConvId);
  });
});
