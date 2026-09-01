/**
 * Reactions on notes and visits. (v1.105.170)
 *
 * Pete: "I'd like the option to carry this same thing over to people reacting to visits and
 * care notes as well...socialize anywhere that we're leaving feedback." Then: "add the
 * reactions into the notes section."
 *
 * Integration, not unit, because the two things that can actually go wrong here are both
 * about real rows: whether a stranger can react to (or read reactions on) a note in someone
 * else's care record, and whether "one reaction per person" survives two taps arriving at
 * once. Neither is visible in a mocked test.
 */
const { startHarness, stopHarness } = require("./harness");
const { v4: uuid } = require("uuid");

jest.setTimeout(180000);

const ROUTERS = {
  "/api/reactions": "../../src/routes/reactions",
  "/api/notes": "../../src/routes/notes",
  "/api/family-visits": "../../src/routes/familyVisits",
};

let h, owner, member, stranger, recipientId, teamId, noteId, visitId;

beforeAll(async () => {
  h = await startHarness({ routers: ROUTERS });
  owner = await h.createUser({ roles: ["family"], firstName: "Pete" });
  member = await h.createUser({ roles: ["family"], firstName: "Deborah" });
  stranger = await h.createUser({ roles: ["family"], firstName: "Nobody" });
  const t = await h.createCareTeam({ familyUserId: owner.user.id });
  recipientId = t.recipientId;
  teamId = t.teamId;
  await h.addTeamMember(teamId, member.user.id, "member");

  noteId = uuid();
  await h.db.prepare(`
    INSERT INTO recipient_notes (id, care_recipient_id, author_id, content, note_type, created_at)
    VALUES (?, ?, ?, 'She ate a full dinner tonight.', 'observation', NOW())
  `).run(noteId, recipientId, owner.user.id);

  visitId = uuid();
  await h.db.prepare(`
    INSERT INTO family_visits (id, care_recipient_id, user_id, visited_at, summary, created_at)
    VALUES (?, ?, ?, NOW(), 'Sat with her a while.', NOW())
  `).run(visitId, recipientId, owner.user.id);
});

afterAll(async () => { await stopHarness(h); });

const react = (who, type, id, emoji) =>
  h.request.post(`/api/reactions/${type}/${id}`).set(h.auth(who.token)).send({ emoji });

describe("a reaction is only ever as visible as the thing it is on", () => {
  test("someone on the care team can react to a note", async () => {
    const res = await react(member, "note", noteId, "❤️");
    expect(res.status).toBe(200);
    expect(res.body.action).toBe("added");
    expect(res.body.reactions).toHaveLength(1);
    expect(res.body.reactions[0]).toMatchObject({ emoji: "❤️", userId: member.user.id });
    // The name comes with it — "❤️ from Deborah" is the whole point of a reaction on a care
    // record, as against an anonymous counter.
    expect(res.body.reactions[0].userName).toMatch(/Deborah/);
  });

  test("a stranger cannot react to a note in someone else's care record", async () => {
    const res = await react(stranger, "note", noteId, "👍");
    // 404 rather than 403, per utils/access.js: "you may not see this" and "this does not
    // exist" must be indistinguishable to someone probing ids.
    expect(res.status).toBe(404);
  });

  test("a stranger cannot READ the reactions either", async () => {
    const res = await h.request.get(`/api/reactions/note/${noteId}`).set(h.auth(stranger.token));
    expect(res.status).toBe(404);
  });

  test("and the same holds for a visit", async () => {
    expect((await react(member, "family_visit", visitId, "🙏")).status).toBe(200);
    expect((await react(stranger, "family_visit", visitId, "🙏")).status).toBe(404);
  });
});

describe("one reaction per person per thing — enforced by the database", () => {
  test("the same emoji again removes it", async () => {
    await react(owner, "note", noteId, "👍");
    const res = await react(owner, "note", noteId, "👍");
    expect(res.body.action).toBe("removed");
    expect(res.body.reactions.some((r) => r.userId === owner.user.id)).toBe(false);
  });

  test("a different emoji replaces it rather than adding a second", async () => {
    await react(owner, "note", noteId, "👍");
    const res = await react(owner, "note", noteId, "😮");
    expect(res.body.action).toBe("replaced");
    const mine = res.body.reactions.filter((r) => r.userId === owner.user.id);
    expect(mine).toHaveLength(1);
    expect(mine[0].emoji).toBe("😮");
  });

  test("two taps arriving together cannot leave two rows", async () => {
    // The UNIQUE index is what makes this true, not the read-then-write in toggleReaction.
    const fresh = uuid();
    await h.db.prepare(`
      INSERT INTO recipient_notes (id, care_recipient_id, author_id, content, note_type, created_at)
      VALUES (?, ?, ?, 'race', 'observation', NOW())
    `).run(fresh, recipientId, owner.user.id);
    await Promise.all([
      react(member, "note", fresh, "❤️"),
      react(member, "note", fresh, "❤️"),
    ]);
    const rows = await h.db.prepare(
      "SELECT COUNT(*) AS n FROM reactions WHERE target_type = 'note' AND target_id = ? AND user_id = ?"
    ).get(fresh, member.user.id);
    expect(Number(rows.n)).toBeLessThanOrEqual(1);
  });
});

describe("the target type is a whitelist, not a free string", () => {
  test("an unknown type is refused before anything is looked up", async () => {
    const res = await react(member, "users", owner.user.id, "👍");
    expect(res.status).toBe(400);
  });

  test("an emoji the client invented is refused", async () => {
    const res = await react(member, "note", noteId, "🍕");
    expect(res.status).toBe(400);
  });

  test("a target id that does not exist is a 404, not a 500", async () => {
    expect((await react(member, "note", uuid(), "👍")).status).toBe(404);
  });
});

describe("they ride along with the lists, not one request per row", () => {
  test("GET /api/notes carries reactions on every note", async () => {
    const res = await h.request.get(`/api/notes/${recipientId}`).set(h.auth(member.token));
    expect(res.status).toBe(200);
    const note = res.body.notes.find((n) => n.id === noteId);
    expect(Array.isArray(note.reactions)).toBe(true);
    expect(note.reactions.some((r) => r.emoji === "❤️")).toBe(true);
    // A note nobody has reacted to gets [], never undefined — a client that has to test for
    // both writes the bug twice.
    const untouched = res.body.notes.find((n) => n.content === "race");
    expect(untouched.reactions).toEqual([]);
  });

  test("GET /api/family-visits carries them too", async () => {
    const res = await h.request.get(`/api/family-visits/${recipientId}`).set(h.auth(member.token));
    expect(res.status).toBe(200);
    const visit = res.body.visits.find((v) => v.id === visitId);
    expect(visit.reactions.some((r) => r.emoji === "🙏")).toBe(true);
  });
});
