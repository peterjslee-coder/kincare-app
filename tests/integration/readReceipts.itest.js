/**
 * Read receipts on notes and visit reports (v1.148.0).
 *
 * Pete: "I have no way of knowing whether or not my sis and bro are reading anything on app."
 * The things that can go wrong are about real rows: a stranger marking (or seeing who read) a
 * note in someone else's care record, the writer being asked to confirm their own note, the
 * "Not yet" list naming the wrong people, and the notes list losing its receipts.
 */
const { startHarness, stopHarness } = require("./harness");
const { v4: uuid } = require("uuid");

jest.setTimeout(180000);

const ROUTERS = {
  "/api/read-receipts": "../../src/routes/readReceipts",
  "/api/notes": "../../src/routes/notes",
};

let h, owner, sis, bro, stranger, cg, recipientId, teamId, noteId, oldNoteId, sessionId, openSessionId;

beforeAll(async () => {
  h = await startHarness({ routers: ROUTERS });
  owner = await h.createUser({ roles: ["family"], firstName: "Pete" });
  sis = await h.createUser({ roles: ["family"], firstName: "Deborah" });
  bro = await h.createUser({ roles: ["family"], firstName: "Mike" });
  stranger = await h.createUser({ roles: ["family"], firstName: "Nobody" });
  cg = await h.createUser({ roles: ["caregiver"], firstName: "Kay" });
  const t = await h.createCareTeam({ familyUserId: owner.user.id });
  recipientId = t.recipientId;
  teamId = t.teamId;
  await h.addTeamMember(teamId, sis.user.id, "member");
  await h.addTeamMember(teamId, bro.user.id, "member");

  noteId = uuid();
  await h.db.prepare(`
    INSERT INTO recipient_notes (id, care_recipient_id, author_id, content, note_type, created_at)
    VALUES (?, ?, ?, 'She ate a full dinner tonight.', 'general', NOW())
  `).run(noteId, recipientId, owner.user.id);
  oldNoteId = uuid();
  await h.db.prepare(`
    INSERT INTO recipient_notes (id, care_recipient_id, author_id, content, note_type, created_at)
    VALUES (?, ?, ?, 'Old news.', 'general', NOW() - INTERVAL '60 days')
  `).run(oldNoteId, recipientId, owner.user.id);

  const profileId = uuid();
  await h.db.prepare(
    "INSERT INTO caregiver_profiles (id, user_id, hourly_rate, created_at) VALUES (?, ?, 25, NOW())"
  ).run(profileId, cg.user.id);
  sessionId = uuid();
  await h.db.prepare(`
    INSERT INTO care_sessions (id, care_recipient_id, family_user_id, caregiver_id, service_type,
                               status, scheduled_date, scheduled_time, duration_hours, created_at)
    VALUES (?, ?, ?, ?, 'companionship', 'completed', '2026-11-21', '10:00', 2, NOW())
  `).run(sessionId, recipientId, owner.user.id, profileId);
  await h.db.prepare(`
    INSERT INTO visit_logs (id, session_id, caregiver_id, check_in_time, check_out_time, summary)
    VALUES (?, ?, ?, NOW() - INTERVAL '3 hours', NOW() - INTERVAL '1 hour', 'Walked to the mailbox.')
  `).run(uuid(), sessionId, profileId);
  openSessionId = uuid();
  await h.db.prepare(`
    INSERT INTO care_sessions (id, care_recipient_id, family_user_id, caregiver_id, service_type,
                               status, scheduled_date, scheduled_time, duration_hours, created_at)
    VALUES (?, ?, ?, ?, 'companionship', 'confirmed', '2026-12-01', '10:00', 2, NOW())
  `).run(openSessionId, recipientId, owner.user.id, profileId);
});

afterAll(async () => { await stopHarness(h); });

const mark = (who, type, id) => h.request.post(`/api/read-receipts/${type}/${id}`).set(h.auth(who.token));
const unmark = (who, type, id) => h.request.delete(`/api/read-receipts/${type}/${id}`).set(h.auth(who.token));
const notesFor = (who) => h.request.get(`/api/notes/${recipientId}`).set(h.auth(who.token));
const names = (list) => list.map((r) => r.name.split(" ")[0]).sort();

describe("care notes", () => {
  test("before anyone reads it, nobody is listed — and nobody is ever listed as NOT having read it", async () => {
    const res = await notesFor(owner);
    expect(res.status).toBe(200);
    const n = res.body.notes.find((x) => x.id === noteId);
    expect(n.readReceipts.readBy).toEqual([]);
    // Pete, 11/22: "I don't care who hasn't seen it." The block carries no such list at all.
    expect(Object.keys(n.readReceipts).sort()).toEqual(["canMark", "myReadAt", "readBy", "readByMe"]);
    // Pete wrote it; he is never asked to confirm it.
    expect(n.readReceipts.canMark).toBe(false);
  });

  test("a sibling gets the button, taps it, and shows up as Seen by", async () => {
    const before = (await notesFor(sis)).body.notes.find((x) => x.id === noteId);
    expect(before.readReceipts.canMark).toBe(true);
    expect(before.readReceipts.readByMe).toBe(false);

    const res = await mark(sis, "note", noteId);
    expect(res.status).toBe(200);
    expect(res.body.readReceipts.readByMe).toBe(true);
    expect(names(res.body.readReceipts.readBy)).toEqual(["Deborah"]);

    const seenByPete = (await notesFor(owner)).body.notes.find((x) => x.id === noteId);
    expect(names(seenByPete.readReceipts.readBy)).toEqual(["Deborah"]);
  });

  test("tapping twice leaves one receipt; Undo takes it away", async () => {
    await Promise.all([mark(bro, "note", noteId), mark(bro, "note", noteId)]);
    const rows = await h.db.prepare(
      "SELECT COUNT(*)::int AS n FROM read_receipts WHERE target_id = ? AND user_id = ?"
    ).get(noteId, bro.user.id);
    expect(rows.n).toBe(1);
    const res = await unmark(bro, "note", noteId);
    expect(res.status).toBe(200);
    expect(res.body.readReceipts.readByMe).toBe(false);
    expect(names(res.body.readReceipts.readBy)).toEqual(["Deborah"]);
  });

  test("the writer cannot mark their own note", async () => {
    const res = await mark(owner, "note", noteId);
    expect(res.status).toBe(400);
  });

  test("a stranger can neither mark it nor see who read it", async () => {
    expect((await mark(stranger, "note", noteId)).status).toBe(404);
    expect((await h.request.get(`/api/read-receipts/note/${noteId}`).set(h.auth(stranger.token))).status).toBe(404);
  });

  test("an old note gets no button", async () => {
    const n = (await notesFor(sis)).body.notes.find((x) => x.id === oldNoteId);
    expect(n.readReceipts.canMark).toBe(false);
  });

  test("an unknown target type is refused", async () => {
    expect((await mark(sis, "message", noteId)).status).toBe(400);
  });
});

describe("visit reports", () => {
  test("a sibling can mark a finished visit read; the caregiver cannot mark her own", async () => {
    const res = await mark(bro, "session", sessionId);
    expect(res.status).toBe(200);
    expect(names(res.body.readReceipts.readBy)).toEqual(["Mike"]);
    expect(res.body.readReceipts.notYet).toBeUndefined();
    expect((await mark(cg, "session", sessionId)).status).not.toBe(200);
  });

  test("a visit that has not happened has nothing to mark", async () => {
    expect((await mark(bro, "session", openSessionId)).status).toBe(409);
  });

  test("a stranger cannot mark a visit", async () => {
    expect((await mark(stranger, "session", sessionId)).status).toBe(404);
  });
});
