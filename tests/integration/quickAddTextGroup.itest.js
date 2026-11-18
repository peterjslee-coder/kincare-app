/**
 * v1.133.0 — the + menu and messages to her Text group.
 *
 * Pete, 11/18: "Anyone that I've added to the simple screen messaging for betty gets that
 * message. it sits on betty's screen until she acknowledges it. Any reply or alert 'I have
 * pain' etc shows up there... They should get a notification that there's a message to betty
 * (from me, in this example)... I don't want to send mom a message, and immediately see a red
 * dot show up over my messages anchor because i have an unread message in a group chat from
 * myself."
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || "quick-add-secret";

const mockPush = jest.fn(async () => ({ sent: 1 }));
jest.mock("../../src/routes/push", () => {
  const actual = jest.requireActual("../../src/routes/push");
  return { ...actual, sendPushToUser: (...a) => mockPush(...a) };
});

const { startHarness, stopHarness } = require("./harness");
const { v4: uuid } = require("uuid");

jest.setTimeout(180000);

let h, db, leader, sister, viewer, stranger, mom, recipientId, teamId, convId;
const tick = () => new Promise((r) => setTimeout(r, 25));

beforeAll(async () => {
  h = await startHarness({ routers: {
    "/api/care-recipients": "../../src/routes/careRecipients",
    "/api/dashboard": "../../src/routes/dashboard",
    "/api/messages": "../../src/routes/messages",
  } });
  db = h.db;
  leader = await h.createUser({ firstName: "Pete", lastName: "ITest" });
  sister = await h.createUser({ firstName: "Sara", lastName: "ITest" });
  viewer = await h.createUser({ firstName: "Dan", lastName: "ITest" });
  stranger = await h.createUser({ firstName: "Stranger", lastName: "ITest" });
  ({ recipientId, teamId } = await h.createCareTeam({ familyUserId: leader.user.id }));
  await h.addTeamMember(teamId, sister.user.id);
  await h.addTeamMember(teamId, viewer.user.id);
  await db.prepare("INSERT INTO care_recipient_shares (id, care_recipient_id, shared_with_user_id, permission, shared_by_user_id) VALUES (?, ?, ?, 'edit', ?)")
    .run(uuid(), recipientId, sister.user.id, leader.user.id);
  await db.prepare("INSERT INTO care_recipient_shares (id, care_recipient_id, shared_with_user_id, permission, shared_by_user_id) VALUES (?, ?, ?, 'view', ?)")
    .run(uuid(), recipientId, viewer.user.id, leader.user.id);

  const r = await h.request.post(`/api/care-recipients/${recipientId}/own-login`).set(h.auth(leader.token))
    .send({ email: "mom-quickadd@itest.local", password: "Kitchen#2026" });
  expect(r.status).toBe(201);
  const { generateToken } = require("../../src/middleware/auth");
  await h.verifyIdentity(r.body.userId);
  mom = { user: { id: r.body.userId }, token: generateToken({ id: r.body.userId, email: "mom-quickadd@itest.local", roles: ["care_for"], role: "care_for" }) };

  const put = await h.request.put(`/api/care-recipients/${recipientId}/simple-mode`).set(h.auth(leader.token))
    .send({ on: true, callUserIds: [], show: { text: true, tellFamily: true }, textUserIds: [leader.user.id, sister.user.id] });
  expect(put.status).toBe(200);
  convId = put.body.textConversationId;
  expect(convId).toBeTruthy();
});

afterAll(async () => { await stopHarness(h); });

const quickAdd = (who) => h.request.get("/api/care-recipients/quick-add").set(h.auth(who.token));
const dash = () => h.request.get("/api/dashboard").set(h.auth(mom.token));

describe("the + menu asks the server what this person may do", () => {
  test("in the Text group: Message is offered; adding events follows the share", async () => {
    const r = await quickAdd(leader);
    expect(r.status).toBe(200);
    const betty = r.body.recipients.find((x) => x.id === recipientId);
    expect(betty).toMatchObject({ firstName: "Betty", canAddEvent: true, messageConversationId: convId });
    const s = (await quickAdd(sister)).body.recipients.find((x) => x.id === recipientId);
    expect(s.messageConversationId).toBe(convId);
  });

  test("on the team but not in her Text group: no Message choice", async () => {
    const d = (await quickAdd(viewer)).body.recipients.find((x) => x.id === recipientId);
    expect(d).toBeTruthy();
    expect(d.messageConversationId).toBeNull();
  });

  test("a stranger gets nobody", async () => {
    const r = await quickAdd(stranger);
    expect(r.status).toBe(200);
    expect(r.body.recipients.find((x) => x.id === recipientId)).toBeUndefined();
  });

  test("'quick-add' is never read as a recipient id", async () => {
    const r = await quickAdd(leader);
    expect(Array.isArray(r.body.recipients)).toBe(true);
  });
});

describe("a message to Betty", () => {
  let first;

  test("the others are told it's a message TO her; the sender is not pushed and has no unread", async () => {
    mockPush.mockClear();
    const r = await h.request.post(`/api/messages/conversations/${convId}`).set(h.auth(leader.token)).send({ content: "Dentist is Friday at 9, Mom" });
    expect(r.status).toBe(201);
    first = r.body.message.id;
    const to = mockPush.mock.calls.map((c) => c[0]).sort();
    expect(to).toEqual([sister.user.id, mom.user.id].sort());
    for (const c of mockPush.mock.calls) {
      expect(c[1].body).toBe("Pete sent Betty a message");
      expect(JSON.stringify(c[1])).not.toContain("Dentist");
    }
    const list = await h.request.get("/api/messages/conversations").set(h.auth(leader.token));
    const mine = list.body.conversations.find((c) => c.id === convId);
    expect(mine.unreadCount).toBe(0);
  });

  test("it waits on her screen — opening the thread does not clear it", async () => {
    let t = (await dash()).body.simpleScreen.text;
    expect(t.waiting.map((w) => [w.from, w.content, w.isReply])).toEqual([["Pete", "Dentist is Friday at 9, Mom", false]]);
    await h.request.get(`/api/messages/conversations/${convId}`).set(h.auth(mom.token));
    t = (await dash()).body.simpleScreen.text;
    expect(t.waiting).toHaveLength(1);
  });

  test("only she can say Got it", async () => {
    expect((await h.request.post(`/api/care-recipients/${recipientId}/simple-screen/text-ack`).set(h.auth(leader.token))).status).toBe(403);
    expect((await h.request.post(`/api/care-recipients/${recipientId}/simple-screen/text-ack`).set(h.auth(stranger.token))).status).toBe(403);
  });

  test("Got it takes it off her screen and the group sees 'Betty saw it'", async () => {
    mockPush.mockClear();
    const r = await h.request.post(`/api/care-recipients/${recipientId}/simple-screen/text-ack`).set(h.auth(mom.token));
    expect(r.status).toBe(200);
    expect(r.body.acknowledged).toEqual([first]);
    expect(mockPush).not.toHaveBeenCalled(); // no buzz for a "saw it"
    expect((await dash()).body.simpleScreen.text.waiting).toEqual([]);
    const full = await h.request.get(`/api/messages/conversations/${convId}`).set(h.auth(sister.token));
    const m = full.body.messages.find((x) => x.id === first);
    expect(m.seenBy).toBeTruthy();
  });

  test("writing back counts as Got it, and her next waiting card says 'wrote back'", async () => {
    await tick();
    await h.request.post(`/api/messages/conversations/${convId}`).set(h.auth(mom.token)).send({ content: "OK" });
    await tick();
    await h.request.post(`/api/messages/conversations/${convId}`).set(h.auth(sister.token)).send({ content: "I'll drive you" });
    let t = (await dash()).body.simpleScreen.text;
    expect(t.waiting.map((w) => [w.from, w.isReply])).toEqual([["Sara", true]]);
    await tick();
    const reply = await h.request.post(`/api/messages/conversations/${convId}`).set(h.auth(mom.token)).send({ content: "Thank you!" });
    expect(reply.status).toBe(201);
    t = (await dash()).body.simpleScreen.text;
    expect(t.waiting).toEqual([]);
  });

  test("when she writes, the push says so plainly", async () => {
    mockPush.mockClear();
    await tick();
    await h.request.post(`/api/messages/conversations/${convId}`).set(h.auth(mom.token)).send({ content: "Love you" });
    for (const c of mockPush.mock.calls) expect(c[1].body).toBe("Betty sent a message");
  });
});

describe("her Tell-the-family alert lands in the group too", () => {
  test("posted as her message, with ONE notification per person (the alert's)", async () => {
    mockPush.mockClear();
    const r = await h.request.post(`/api/care-recipients/${recipientId}/from-me`).set(h.auth(mom.token))
      .send({ content: "I have pain", needsAttention: true });
    expect(r.status).toBe(201);
    const row = await db.prepare(
      "SELECT sender_id, content FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1"
    ).get(convId);
    expect(row).toEqual({ sender_id: mom.user.id, content: "⚠️ I have pain" });
    const bodies = mockPush.mock.calls.map((c) => c[1].body);
    expect(bodies.some((b) => /sent a message/.test(b))).toBe(false);
    const perUser = {};
    for (const c of mockPush.mock.calls) perUser[c[0]] = (perUser[c[0]] || 0) + 1;
    for (const n of Object.values(perUser)) expect(n).toBe(1);
  });

  test("with the Text button off, the alert stays out of Messages", async () => {
    await h.request.put(`/api/care-recipients/${recipientId}/simple-mode`).set(h.auth(leader.token))
      .send({ on: true, callUserIds: [], show: { text: false, tellFamily: true }, textUserIds: [leader.user.id, sister.user.id] });
    const before = await db.prepare("SELECT COUNT(*)::int AS n FROM messages WHERE conversation_id = ?").get(convId);
    await h.request.post(`/api/care-recipients/${recipientId}/from-me`).set(h.auth(mom.token)).send({ content: "I'm hungry" });
    const after = await db.prepare("SELECT COUNT(*)::int AS n FROM messages WHERE conversation_id = ?").get(convId);
    expect(after.n).toBe(before.n);
    const q = (await quickAdd(leader)).body.recipients.find((x) => x.id === recipientId);
    expect(q.messageConversationId).toBeNull();
  });
});
