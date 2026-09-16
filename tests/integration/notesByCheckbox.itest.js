/**
 * v1.107.2 — the checkboxes are the permission. Everywhere.
 *
 * Pete, Sep 16: Julia "can't leave notes. there's no 'log visit' with her." Her live access
 * on Betty's team is read+write notes and read+log visits, and the server accepted both — but
 * the Care Notes screen was offered only on read_notes, and visit logging did not exist in
 * caregiver mode at all. Meanwhile the READ routes asked only "does any share exist?", so a
 * person granted nothing but read_profile could read every note and every visit.
 *
 * And for Betty: what she may read follows the managed-account settings on her record
 * (permission_tier + visibility_settings), enforced by the server, not only by her screen.
 */
const { startHarness, stopHarness } = require("./harness");
const { v4: uuid } = require("uuid");

jest.setTimeout(180000);

let h, db, leader, recipientId, teamId, betty, eventId;
const people = {};

const share = (userId, caps) => db.prepare(`
  INSERT INTO care_recipient_shares (id, care_recipient_id, shared_with_user_id, permission, capabilities, shared_by_user_id, created_at)
  VALUES (?, ?, ?, 'view', ?, ?, NOW())
`).run(uuid(), recipientId, userId, JSON.stringify(caps), leader.user.id);

beforeAll(async () => {
  h = await startHarness({ routers: {
    "/api/notes": "../../src/routes/notes",
    "/api/family-visits": "../../src/routes/familyVisits",
    "/api/care-events": "../../src/routes/careEvents",
    "/api/dashboard": "../../src/routes/dashboard",
  } });
  db = h.db;
  leader = await h.createUser({ roles: ["family"], firstName: "Pete" });
  ({ recipientId, teamId } = await h.createCareTeam({ familyUserId: leader.user.id }));

  // Julia, exactly as she is on prod: a caregiver, team role "viewer", these six boxes.
  people.julia = await h.createUser({ roles: ["caregiver"], firstName: "Julia" });
  await h.addTeamMember(teamId, people.julia.user.id, "viewer");
  await share(people.julia.user.id, ["write_notes", "read_visits", "write_visits", "check_tasks", "read_tasks", "read_notes"]);

  // Peggy: the helper preset — leave a note, log a visit, read nothing.
  people.peggy = await h.createUser({ roles: ["family"], firstName: "Peggy" });
  await h.addTeamMember(teamId, people.peggy.user.id, "member");
  await share(people.peggy.user.id, ["write_notes", "write_visits"]);

  // Someone granted only the profile.
  people.profileOnly = await h.createUser({ roles: ["family"], firstName: "Cousin" });
  await h.addTeamMember(teamId, people.profileOnly.user.id, "member");
  await share(people.profileOnly.user.id, ["read_profile"]);

  // A sibling who may manage the record.
  people.sibling = await h.createUser({ roles: ["family"], firstName: "Sara" });
  await h.addTeamMember(teamId, people.sibling.user.id, "member");
  await share(people.sibling.user.id, ["read_notes", "write_notes", "manage"]);

  betty = await h.createUser({ roles: ["care_for"], firstName: "Betty" });
  await db.prepare("UPDATE care_recipients SET linked_user_id = ? WHERE id = ?").run(betty.user.id, recipientId);

  eventId = uuid();
  await db.prepare(`
    INSERT INTO care_events (id, care_recipient_id, created_by, title, category, event_date, event_time, tz, starts_at)
    VALUES (?, ?, ?, 'Cardiology', 'medical', '2026-10-01', '10:00', 'America/New_York', NOW() + INTERVAL '10 days')
  `).run(eventId, recipientId, leader.user.id);
});
afterAll(async () => { await stopHarness(h); });

const as = (who) => h.auth(who.token);
const mine = async (who) => (await h.request.get("/api/notes/mine/recipients").set(as(who))).body.recipients || [];
const postNote = (who, body = {}) => h.request.post("/api/notes").set(as(who))
  .send({ careRecipientId: recipientId, content: "She ate well.", ...body });
const readNotes = (who) => h.request.get(`/api/notes/${recipientId}`).set(as(who));
const postVisit = (who) => h.request.post("/api/family-visits").set(as(who))
  .send({ careRecipientId: recipientId, summary: "Stopped by", moodRating: "good", activities: ["company"] });
const readVisits = (who) => h.request.get(`/api/family-visits/${recipientId}`).set(as(who));
const setTier = (tier, vis) => db.prepare("UPDATE care_recipients SET permission_tier = ?, visibility_settings = ? WHERE id = ?")
  .run(tier, vis ? JSON.stringify(vis) : null, recipientId);

describe("Julia — what she has on prod", () => {
  test("Care Notes lists Betty, and says she may read and write both notes and visits", async () => {
    const r = (await mine(people.julia)).find((x) => x.id === recipientId);
    expect(r).toMatchObject({ canReadNotes: true, canWriteNotes: true, canReadVisits: true, canWriteVisits: true });
  });
  test("she can leave a note", async () => { expect((await postNote(people.julia)).status).toBe(201); });
  test("she can log a visit", async () => { expect((await postVisit(people.julia)).status).toBe(201); });
  test("she can read notes and visits", async () => {
    expect((await readNotes(people.julia)).status).toBe(200);
    expect((await readVisits(people.julia)).status).toBe(200);
  });
  test("she cannot edit someone else's note, but can edit her own", async () => {
    const theirs = (await postNote(leader, { content: "Leader note" })).body.note;
    expect((await h.request.put(`/api/notes/${theirs.id}`).set(as(people.julia)).send({ content: "x" })).status).toBe(403);
    const own = (await postNote(people.julia, { content: "Mine" })).body.note;
    expect((await h.request.put(`/api/notes/${own.id}`).set(as(people.julia)).send({ content: "Mine, edited" })).status).toBe(200);
  });
});

describe("Peggy — write-only helper", () => {
  test("Care Notes still lists Betty for her, flagged write-only", async () => {
    const r = (await mine(people.peggy)).find((x) => x.id === recipientId);
    expect(r).toMatchObject({ canReadNotes: false, canWriteNotes: true, canReadVisits: false, canWriteVisits: true });
  });
  test("she can leave a note and log a visit", async () => {
    expect((await postNote(people.peggy)).status).toBe(201);
    expect((await postVisit(people.peggy)).status).toBe(201);
  });
  test("she cannot read the notes or the visit history", async () => {
    expect((await readNotes(people.peggy)).status).toBe(403);
    expect((await readVisits(people.peggy)).status).toBe(404);
  });
  test("she cannot read appointment notes either", async () => {
    expect((await h.request.get(`/api/care-events/${eventId}/notes`).set(as(people.peggy))).status).toBe(403);
  });
});

describe("a share with nothing about notes or visits", () => {
  test("no Care Notes screen, and every note/visit route refuses", async () => {
    expect((await mine(people.profileOnly)).find((x) => x.id === recipientId)).toBeUndefined();
    expect((await postNote(people.profileOnly)).status).toBe(403);
    expect((await readNotes(people.profileOnly)).status).toBe(403);
    expect((await postVisit(people.profileOnly)).status).toBe(404);
    expect((await readVisits(people.profileOnly)).status).toBe(404);
    expect((await h.request.get(`/api/care-events/${eventId}/notes`).set(as(people.profileOnly))).status).toBe(403);
  });
  test("recording an appointment is refused before any audio is read", async () => {
    const res = await h.request.post(`/api/care-events/${eventId}/transcribe`).set(as(people.profileOnly))
      .field("consent_confirmed", "true").attach("audio", Buffer.alloc(1024), "a.m4a");
    expect(res.status).toBe(403);
  });
});

describe("manage", () => {
  test("a sibling with manage can edit anyone's note", async () => {
    const theirs = (await postNote(people.julia, { content: "Julia note" })).body.note;
    expect((await h.request.put(`/api/notes/${theirs.id}`).set(as(people.sibling)).send({ content: "fixed" })).status).toBe(200);
  });
});

describe("responses never carry the stored photo", () => {
  test("POST and PUT return has_photo, not photo", async () => {
    const res = await postNote(people.julia);
    expect(res.body.note).toBeTruthy();
    expect(res.body.note).not.toHaveProperty("photo");
    expect(res.body.note).toHaveProperty("has_photo");
    const put = await h.request.put(`/api/notes/${res.body.note.id}`).set(as(people.julia)).send({ content: "y" });
    expect(put.body.note).not.toHaveProperty("photo");
  });
});

describe("Betty follows her managed-account settings", () => {
  beforeAll(async () => {
    await postNote(leader, { content: "PRIVATE: doctor thinks it is getting worse", noteType: "observation", careEventId: eventId });
    await postNote(leader, { content: "Appointment went fine", noteType: "general", careEventId: eventId });
  });
  afterAll(async () => { await setTier("full", null); });

  test("full account: she reads notes, never the family's observations — appointment notes included", async () => {
    await setTier("full", null);
    const list = (await readNotes(betty)).body.notes;
    expect(list.some((n) => /PRIVATE/.test(n.content))).toBe(false);
    const ev = await h.request.get(`/api/care-events/${eventId}/notes`).set(as(betty));
    expect(ev.status).toBe(200);
    expect(ev.body.notes.some((n) => /PRIVATE/.test(n.content))).toBe(false);
    expect(ev.body.notes.some((n) => /went fine/.test(n.content))).toBe(true);
  });

  test("managed with notes hidden: every notes route refuses her, and her dashboard shows none", async () => {
    await setTier("managed", { notes: false, medications: true });
    expect((await readNotes(betty)).status).toBe(403);
    expect((await h.request.get(`/api/care-events/${eventId}/notes`).set(as(betty))).status).toBe(403);
    const dash = await h.request.get("/api/dashboard").set(as(betty));
    expect(dash.status).toBe(200);
    expect(dash.body.role).toBe("care_for");
    expect(dash.body.notes).toHaveLength(0);
  });

  test("managed with notes shown: she reads them (still no observations)", async () => {
    await setTier("managed", { notes: true });
    const res = await readNotes(betty);
    expect(res.status).toBe(200);
    expect(res.body.notes.some((n) => /PRIVATE/.test(n.content))).toBe(false);
    const dash = await h.request.get("/api/dashboard").set(as(betty));
    expect(dash.body.notes.length).toBeGreaterThan(0);
  });

  test("managed: she cannot write; collaborative: she can", async () => {
    await setTier("managed", { notes: true });
    expect((await postNote(betty)).status).toBe(403);
    await setTier("collaborative", { notes: true });
    expect((await postNote(betty)).status).toBe(201);
  });
});
