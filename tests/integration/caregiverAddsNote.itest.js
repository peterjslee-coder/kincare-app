/**
 * v1.106.26 — a caregiver on the care team can add to the care record. (40e56489)
 *
 * Julia, Sep 12: "I have the Care Notes tab now! I can't add any notes though."
 *
 * She was right, and the server was innocent the whole time — POST /api/notes gates on
 * hasAccess(), which has covered care-team members since it was written. The screen simply
 * had no composer: v1.105.190 gave her the tab and v1.105.153 had built the page read-only.
 *
 * So the client half is where the fix is, and the reason this file exists anyway is that
 * "the server already allows it" was an assumption nobody had ever executed. It is now the
 * thing being asserted, along with the two limits that must NOT come with it: she may add to
 * the record, she may not rewrite or delete what someone else put in it, and a caregiver who
 * is merely assigned to a session — not on the team — still gets nothing.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || "cg-note-secret";

const { startHarness, stopHarness } = require("./harness");
const { v4: uuid } = require("uuid");

jest.setTimeout(180000);

let h, db, family, julia, stranger, recipientId, teamId;

const JPEG_1PX =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsL" +
  "DBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAAB" +
  "AAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

const post = (token, body) =>
  h.request.post("/api/notes").set(h.auth(token)).send(body);

const listFor = (token) => h.request.get(`/api/notes/${recipientId}`).set(h.auth(token));

beforeAll(async () => {
  h = await startHarness({ routers: { "/api/notes": "../../src/routes/notes" } });
  db = h.db;

  family = await h.createUser({ firstName: "Pete", lastName: "ITest" });
  julia = await h.createUser({ roles: ["caregiver"], firstName: "Julia", lastName: "ITest" });
  stranger = await h.createUser({ roles: ["caregiver"], firstName: "Stranger", lastName: "ITest" });

  ({ recipientId, teamId } = await h.createCareTeam({ familyUserId: family.user.id }));
  // Julia is on Betty's care team. Pete: "Julia IS on Betty's care team AND she's a
  // caregiver... not all caregivers will be on the care team."
  await h.addTeamMember(teamId, julia.user.id, "member");
});

afterAll(async () => { await stopHarness(h); });

describe("a caregiver on the care team", () => {
  test("can add a note", async () => {
    const res = await post(julia.token, {
      careRecipientId: recipientId,
      content: "Ate well, in good spirits. Left foot still swollen.",
      noteType: "observation",
    });
    expect(res.status).toBeLessThan(300);

    const row = await db.prepare(
      "SELECT author_id, content, note_type FROM recipient_notes WHERE care_recipient_id = ? ORDER BY created_at DESC LIMIT 1"
    ).get(recipientId);
    expect(row.author_id).toBe(julia.user.id);
    expect(row.content).toMatch(/Left foot still swollen/);
  });

  test("the family sees it in the same record", async () => {
    const res = await listFor(family.token);
    expect(res.status).toBe(200);
    expect(res.body.notes.some((n) => /Left foot still swollen/.test(n.content))).toBe(true);
  });

  test("and she sees her own note back", async () => {
    const res = await listFor(julia.token);
    expect(res.status).toBe(200);
    expect(res.body.notes.some((n) => /Left foot still swollen/.test(n.content))).toBe(true);
  });

  test("can flag one as needing attention", async () => {
    await post(julia.token, {
      careRecipientId: recipientId,
      content: "She was confused about what day it is, twice.",
      noteType: "observation",
      needsAttention: true,
    }).expect((r) => expect(r.status).toBeLessThan(300));

    const row = await db.prepare(
      "SELECT needs_attention FROM recipient_notes WHERE care_recipient_id = ? AND content LIKE '%confused about what day%'"
    ).get(recipientId);
    expect(Number(row.needs_attention)).toBe(1);
  });

  test("can attach a photo — she is the one at the visit", async () => {
    const res = await post(julia.token, {
      careRecipientId: recipientId,
      content: "The toe I mentioned.",
      noteType: "observation",
      photo: JPEG_1PX,
    });
    expect(res.status).toBeLessThan(300);
    const row = await db.prepare(
      "SELECT photo FROM recipient_notes WHERE care_recipient_id = ? AND content = 'The toe I mentioned.'"
    ).get(recipientId);
    expect(row.photo).toBeTruthy();
  });

  test("a photo that is not really an image is refused", async () => {
    // v1.106.3 — `data:text/html;base64,<script>` was served back as executable HTML from
    // our own origin. The composer is a new door onto that path, so the gate is re-asserted
    // from this caller rather than assumed.
    const res = await post(julia.token, {
      careRecipientId: recipientId,
      content: "nice try",
      photo: "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
    });
    expect(res.status).toBe(400);
  });

  test("an empty note is refused rather than filed as blank", async () => {
    const res = await post(julia.token, { careRecipientId: recipientId, content: "" });
    expect(res.status).toBe(400);
  });
});

describe("what adding does NOT come with", () => {
  let noteId;

  beforeAll(async () => {
    noteId = uuid();
    await db.prepare(`
      INSERT INTO recipient_notes (id, care_recipient_id, author_id, content, note_type, created_at)
      VALUES (?, ?, ?, 'The family wrote this one.', 'general', NOW())
    `).run(noteId, recipientId, family.user.id);
  });

  test("she cannot edit a note the family wrote", async () => {
    const res = await h.request.put(`/api/notes/${noteId}`)
      .set(h.auth(julia.token)).send({ content: "Actually it says this now." });
    expect(res.status).toBeGreaterThanOrEqual(400);

    const row = await db.prepare("SELECT content FROM recipient_notes WHERE id = ?").get(noteId);
    expect(row.content).toBe("The family wrote this one.");
  });

  test("she cannot delete one either — a record you can quietly edit is not a record", async () => {
    const res = await h.request.delete(`/api/notes/${noteId}`).set(h.auth(julia.token));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await db.prepare("SELECT id FROM recipient_notes WHERE id = ?").get(noteId)).toBeTruthy();
  });

  test("a caregiver who is NOT on the team cannot add anything", async () => {
    // Role has nothing to do with it (v1.105.153). Membership does.
    const res = await post(stranger.token, {
      careRecipientId: recipientId,
      content: "I should not be able to write this.",
    });
    expect(res.status).toBe(403);
    const row = await db.prepare(
      "SELECT id FROM recipient_notes WHERE content = 'I should not be able to write this.'"
    ).get();
    expect(row).toBeFalsy();
  });

  test("...and cannot read the record either", async () => {
    const res = await listFor(stranger.token);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
