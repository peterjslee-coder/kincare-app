/**
 * v1.105.92 — you see a conversation from the day you joined it.
 *
 * Pete: "i only want new members of the care team to get messages whilst they are part of the
 * team...not all messages in the history."
 *
 * Adding someone to a care team put them in its conversation and handed them everything ever
 * said in it. For Betty's team that is months of family discussion about her health, visible in
 * full to a neighbour who joined to help with dinner.
 *
 * Three surfaces leak the same content, so all three are tested: the thread, the last-message
 * preview on the conversation list, and the unread count.
 */
const { startHarness, stopHarness } = require("./harness");
const { v4: uuid } = require("uuid");

jest.setTimeout(180000);
let h, getDb;

beforeAll(async () => {
  h = await startHarness({ routers: { "/api/messages": "../../src/routes/messages" } });
  ({ getDb } = require("../../src/models/database"));
});
afterAll(async () => { await stopHarness(h); });

async function scenario() {
  const db = await getDb();
  const founder = await h.createUser({ firstName: "Pete", roles: ["family"] });
  const latecomer = await h.createUser({ firstName: "Peggy", roles: ["family"] });

  const convId = uuid();
  await db.prepare(
    "INSERT INTO conversations (id, type, name, created_by, created_at) VALUES (?, 'group', 'Betty''s team', ?, '2026-06-01T09:00:00Z')"
  ).run(convId, founder.user.id);
  await db.prepare(
    "INSERT INTO conversation_members (id, conversation_id, user_id, role, joined_at) VALUES (?, ?, ?, 'member', '2026-06-01T09:00:00Z')"
  ).run(uuid(), convId, founder.user.id);

  // Months of history before Peggy exists on the team.
  const before = ["Betty's INR came back high", "Doctor changed her warfarin dose"];
  for (let i = 0; i < before.length; i++) {
    await db.prepare(
      "INSERT INTO messages (id, sender_id, recipient_id, conversation_id, content, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(uuid(), founder.user.id, founder.user.id, convId, before[i], `2026-06-0${i + 2}T10:00:00Z`);
  }

  // Peggy joins in August.
  await db.prepare(
    "INSERT INTO conversation_members (id, conversation_id, user_id, role, joined_at) VALUES (?, ?, ?, 'member', '2026-08-01T09:00:00Z')"
  ).run(uuid(), convId, latecomer.user.id);

  await db.prepare(
    "INSERT INTO messages (id, sender_id, recipient_id, conversation_id, content, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(uuid(), founder.user.id, founder.user.id, convId, "Peggy is bringing dinner Thursday", "2026-08-02T10:00:00Z");

  return { db, founder, latecomer, convId };
}

describe("the thread", () => {
  test("a latecomer sees only what was said after she joined", async () => {
    const { latecomer, convId } = await scenario();
    const res = await h.request.get(`/api/messages/conversations/${convId}`).set(h.auth(latecomer.token));
    expect(res.status).toBe(200);
    const bodies = res.body.messages.map((m) => m.content);
    expect(bodies).toEqual(["Peggy is bringing dinner Thursday"]);
    expect(bodies.join(" ")).not.toMatch(/warfarin|INR/);
  });

  test("someone who was there from the start still sees everything", async () => {
    // The cut must not quietly delete history from the people whose history it is.
    const { founder, convId } = await scenario();
    const res = await h.request.get(`/api/messages/conversations/${convId}`).set(h.auth(founder.token));
    expect(res.body.messages).toHaveLength(3);
  });

  test("the boundary is reported, so the thread does not just start mid-conversation", async () => {
    const { latecomer, convId } = await scenario();
    const res = await h.request.get(`/api/messages/conversations/${convId}`).set(h.auth(latecomer.token));
    expect(res.body.hiddenBefore).toBe(2);
    expect(res.body.historyFrom).toBeTruthy();
  });

  test("no content from before the join crosses the wire at all", async () => {
    // hiddenBefore is a count of existence, never a peek.
    const { latecomer, convId } = await scenario();
    const res = await h.request.get(`/api/messages/conversations/${convId}`).set(h.auth(latecomer.token));
    expect(JSON.stringify(res.body)).not.toMatch(/warfarin|INR/);
  });
});

describe("the conversation list", () => {
  test("the preview does not leak a pre-join message", async () => {
    // Cutting the thread but leaving the preview would leak the hidden content one line at a
    // time, on the list screen, which is the first thing anyone sees.
    const { db, latecomer, convId } = await scenario();
    // Make the most recent message a pre-join one by removing the post-join message.
    await db.prepare("DELETE FROM messages WHERE conversation_id = ? AND created_at >= '2026-08-01'").run(convId);

    const res = await h.request.get("/api/messages/conversations").set(h.auth(latecomer.token));
    const conv = (res.body.conversations || []).find((c) => c.id === convId);
    expect(JSON.stringify(conv || {})).not.toMatch(/warfarin|INR/);
  });

  test("unread counts exclude messages she cannot open", async () => {
    // An unread badge that opening the thread cannot clear is its own small bug.
    const { db, latecomer, convId } = await scenario();
    await db.prepare("DELETE FROM messages WHERE conversation_id = ? AND created_at >= '2026-08-01'").run(convId);
    const res = await h.request.get("/api/messages/conversations").set(h.auth(latecomer.token));
    const conv = (res.body.conversations || []).find((c) => c.id === convId);
    expect(conv?.unreadCount || 0).toBe(0);
  });
});
