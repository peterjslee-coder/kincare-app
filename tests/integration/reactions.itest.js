/**
 * Reactions — the behaviour, pinned before it moves. (v1.105.159)
 *
 * Pete wants reactions on care notes and visits too: "socialize anywhere that we're leaving
 * feedback", and "app only" — in-app, never a push.
 *
 * message_reactions is message-shaped: a foreign key to messages and UNIQUE(message_id,
 * user_id). Notes and visits need a store that is not. One store for one feature is the right
 * end state, but message reactions are a working feature with NO test, so this file
 * characterises what they do FIRST — add, swap, toggle off, and who is allowed — and then the
 * migration has something to be judged against. Writing the test after the change would only
 * prove the change agrees with itself.
 */
const { startHarness, stopHarness } = require("./harness");

jest.setTimeout(180000);

const ROUTERS = { "/api/messages": "../../src/routes/messages" };

let h, alice, bob, outsider, convId, msgId;

beforeAll(async () => {
  h = await startHarness({ routers: ROUTERS });
  alice = await h.createUser({ roles: ["family"], firstName: "Alice" });
  bob = await h.createUser({ roles: ["family"], firstName: "Bob" });
  outsider = await h.createUser({ roles: ["family"], firstName: "Nosy" });

  // Messaging requires a connection ("You can only message people you're connected with"),
  // so put Alice and Bob on one care team. The outsider stays off it deliberately — that is
  // what the permission test below is checking.
  const team = await h.createCareTeam({ familyUserId: alice.user.id });
  await h.addTeamMember(team.teamId, bob.user.id, "member");

  const conv = await h.request.post("/api/messages/conversations").set(h.auth(alice.token))
    .send({ type: "direct", memberIds: [bob.user.id] });
  expect(conv.status).toBe(201);
  convId = conv.body.conversationId;

  const sent = await h.request.post(`/api/messages/conversations/${convId}`)
    .set(h.auth(alice.token)).send({ content: "She had a good night." });
  expect(sent.status).toBe(201);
  msgId = sent.body.message.id;
});

afterAll(async () => { await stopHarness(h); });

const react = (who, emoji) =>
  h.request.post(`/api/messages/${msgId}/reactions`).set(h.auth(who.token)).send({ emoji });

describe("reacting to a message", () => {
  test("a member can add one", async () => {
    const res = await react(bob, "👍");
    expect(res.status).toBe(200);
    expect(res.body.reactions).toHaveLength(1);
    expect(res.body.reactions[0]).toMatchObject({ emoji: "👍", userId: bob.user.id });
    expect(res.body.reactions[0].userName).toContain("Bob");
  });

  test("a second emoji from the same person REPLACES — one reaction each", async () => {
    const res = await react(bob, "❤️");
    expect(res.status).toBe(200);
    expect(res.body.reactions).toHaveLength(1);
    expect(res.body.reactions[0].emoji).toBe("❤️");
  });

  test("the same emoji again removes it", async () => {
    const res = await react(bob, "❤️");
    expect(res.status).toBe(200);
    expect(res.body.reactions).toHaveLength(0);
  });

  test("two people can react to one message", async () => {
    await react(bob, "👍");
    const res = await react(alice, "😂");
    expect(res.status).toBe(200);
    expect(res.body.reactions.map((r) => r.emoji).sort()).toEqual(["823".slice(0, 0) + "👍", "😂"].sort());
    expect(res.body.reactions).toHaveLength(2);
  });

  test("someone outside the conversation cannot", async () => {
    const res = await react(outsider, "👍");
    expect(res.status).toBe(403);
  });

  test("and the reaction reads back on the message", async () => {
    const res = await h.request.get(`/api/messages/conversations/${convId}`).set(h.auth(alice.token));
    expect(res.status).toBe(200);
    const m = res.body.messages.find((x) => x.id === msgId);
    expect((m.reactions || []).length).toBe(2);
  });
});
