/**
 * v1.130.0 — the care recipient's simple phone screen.
 *
 * Pete, 11/17: "call peter", appointments coming up, and "notes from me on app like 'I will be
 * there at 10. Stay in the house'" — on his mother's phone, under the roles he set as leader.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || "simple-mode-secret";

const mockPush = jest.fn(async () => ({ sent: 1 }));
jest.mock("../../src/routes/push", () => {
  const actual = jest.requireActual("../../src/routes/push");
  return { ...actual, sendPushToUser: (...a) => mockPush(...a) };
});

const { startHarness, stopHarness } = require("./harness");
const { v4: uuid } = require("uuid");

jest.setTimeout(180000);

let h, db, leader, sister, stranger, mom, recipientId, teamId;

const soon = (d) => { const x = new Date(); x.setDate(x.getDate() + d); return x.toISOString().slice(0, 10); };

beforeAll(async () => {
  h = await startHarness({ routers: {
    "/api/care-recipients": "../../src/routes/careRecipients",
    "/api/notes": "../../src/routes/notes",
    "/api/dashboard": "../../src/routes/dashboard",
  } });
  db = h.db;
  leader = await h.createUser({ firstName: "Pete", lastName: "ITest" });
  await db.prepare("UPDATE users SET phone = '(540) 555-1234' WHERE id = ?").run(leader.user.id);
  sister = await h.createUser({ firstName: "Sara", lastName: "ITest" });
  stranger = await h.createUser({ firstName: "Stranger", lastName: "ITest" });
  await db.prepare("UPDATE users SET phone = '5405550000' WHERE id = ?").run(stranger.user.id);
  ({ recipientId, teamId } = await h.createCareTeam({ familyUserId: leader.user.id }));
  await h.addTeamMember(teamId, sister.user.id);
  await db.prepare("INSERT INTO care_recipient_shares (id, care_recipient_id, shared_with_user_id, permission, shared_by_user_id) VALUES (?, ?, ?, 'edit', ?)")
    .run(uuid(), recipientId, sister.user.id, leader.user.id);

  // Her own sign-in, the v1.129.4 way.
  const r = await h.request.post(`/api/care-recipients/${recipientId}/own-login`).set(h.auth(leader.token))
    .send({ email: "mom-simple@itest.local", password: "Kitchen#2026" });
  expect(r.status).toBe(201);
  // The account already exists; clear the ID gate and mint a token for it directly.
  const { generateToken } = require("../../src/middleware/auth");
  await h.verifyIdentity(r.body.userId);
  mom = { user: { id: r.body.userId }, token: generateToken({ id: r.body.userId, email: "mom-simple@itest.local", roles: ["care_for"], role: "care_for" }) };
});

afterAll(async () => { await stopHarness(h); });

test("only the leader reads or changes the phone settings", async () => {
  expect((await h.request.get(`/api/care-recipients/${recipientId}/simple-mode`).set(h.auth(sister.token))).status).toBe(403);
  expect((await h.request.put(`/api/care-recipients/${recipientId}/simple-mode`).set(h.auth(sister.token)).send({ on: true })).status).toBe(403);
  const g = await h.request.get(`/api/care-recipients/${recipientId}/simple-mode`).set(h.auth(leader.token));
  expect(g.status).toBe(200);
  expect(g.body).toMatchObject({ hasOwnLogin: true, on: false });
  const ids = g.body.candidates.map((c) => c.userId);
  expect(ids).toEqual(expect.arrayContaining([leader.user.id, sister.user.id]));
  expect(ids).not.toContain(mom.user.id);
});

test("call buttons ring only team members with a phone number", async () => {
  const put = (body) => h.request.put(`/api/care-recipients/${recipientId}/simple-mode`).set(h.auth(leader.token)).send(body);
  expect((await put({ on: true, callUserIds: [stranger.user.id] })).status).toBe(400);
  expect((await put({ on: true, callUserIds: [sister.user.id] })).status).toBe(400); // no phone
  const ok = await put({ on: true, callUserIds: [leader.user.id] });
  expect(ok.status).toBe(200);
  expect(ok.body).toMatchObject({ on: true, callUserIds: [leader.user.id] });
});

test("a note FOR her goes only to her phone, says who and never what", async () => {
  mockPush.mockClear();
  const r = await h.request.post("/api/notes").set(h.auth(leader.token))
    .send({ careRecipientId: recipientId, content: "I'll be there at 10. Stay in the house.", noteType: "for_recipient" });
  expect(r.status).toBe(201);
  expect(mockPush).toHaveBeenCalledTimes(1);
  const [to, payload] = mockPush.mock.calls[0];
  expect(to).toBe(mom.user.id);
  expect(payload.title).toBe("Pete left you a note");
  expect(JSON.stringify(payload)).not.toContain("Stay in the house");

  // She can't write one to herself.
  const self = await h.request.post("/api/notes").set(h.auth(mom.token))
    .send({ careRecipientId: recipientId, content: "hi", noteType: "for_recipient" });
  expect([400, 403]).toContain(self.status);
});

test("an ordinary team note no longer pushes her phone", async () => {
  mockPush.mockClear();
  const r = await h.request.post("/api/notes").set(h.auth(leader.token))
    .send({ careRecipientId: recipientId, content: "Seemed tired today", noteType: "observation" });
  expect(r.status).toBe(201);
  const recipients = mockPush.mock.calls.map((c) => c[0]);
  expect(recipients).not.toContain(mom.user.id);
  expect(recipients).toContain(sister.user.id);
});

test("her dashboard carries the simple screen: call Pete, coming up, the note", async () => {
  // A confirmed visit and an appointment, both soon.
  const cgUser = await h.createUser({ roles: ["caregiver"], firstName: "Tina", lastName: "ITest" });
  const cgProfile = uuid();
  await db.prepare("INSERT INTO caregiver_profiles (id, user_id, hourly_rate, created_at) VALUES (?, ?, 25, NOW())").run(cgProfile, cgUser.user.id);
  // Faces: Tina has a profile photo, Pete has none (initial instead).
  await db.prepare("UPDATE users SET profile_photo = 'data:image/png;base64,iVBORw0KGgo=' WHERE id = ?").run(cgUser.user.id);
  await db.prepare(`INSERT INTO care_sessions (id, care_recipient_id, family_user_id, caregiver_id, scheduled_date, scheduled_time, duration_hours, service_type, status, created_at)
    VALUES (?, ?, ?, ?, ?, '10:00', 2, 'companionship', 'confirmed', NOW())`).run(uuid(), recipientId, leader.user.id, cgProfile, soon(2));
  await db.prepare(`INSERT INTO care_events (id, care_recipient_id, created_by, title, event_date, event_time, starts_at)
    VALUES (?, ?, ?, 'Eye doctor', ?, '14:00', NOW() + INTERVAL '1 day')`).run(uuid(), recipientId, leader.user.id, soon(1));

  const d = await h.request.get("/api/dashboard").set(h.auth(mom.token));
  expect(d.status).toBe(200);
  const s = d.body.simpleScreen;
  expect(s.on).toBe(true);
  expect(s.callContacts).toEqual([{ userId: leader.user.id, firstName: "Pete", phone: "5405551234", photo: null }]);
  expect(s.noteForYou).toMatchObject({ content: "I'll be there at 10. Stay in the house.", from: "Pete" });
  expect(s.comingUp.map((c) => c.kind)).toEqual(["appointment", "visit"]);
  expect(s.comingUp[1]).toMatchObject({ who: "Tina", time: "10:00", whoPhoto: `/api/media/user/${cgUser.user.id}/photo` });
  // Her own notes view still hides the observation written about her.
  expect(JSON.stringify(d.body.notes || [])).not.toContain("Seemed tired");
});

test("turning it off is reflected on her dashboard", async () => {
  await h.request.put(`/api/care-recipients/${recipientId}/simple-mode`).set(h.auth(leader.token)).send({ on: false, callUserIds: [] });
  const d = await h.request.get("/api/dashboard").set(h.auth(mom.token));
  expect(d.body.simpleScreen).toEqual({ on: false });
});

// ─── v1.130.1 — the leader ticks what is on the screen; clear; I read it; tell the family ───

describe("v1.130.1", () => {
  const put = (body) => h.request.put(`/api/care-recipients/${recipientId}/simple-mode`).set(h.auth(leader.token)).send(body);
  const dash = () => h.request.get("/api/dashboard").set(h.auth(mom.token));

  test("on the simple screen the dashboard sends only the screen — no rates, no spend", async () => {
    await put({ on: true, callUserIds: [leader.user.id] });
    const d = await dash();
    expect(Object.keys(d.body).sort()).toEqual(["careRecipientId", "role", "simpleScreen", "userName"]);
    expect(d.body.simpleScreen.show).toEqual({ calls: true, comingUp: true, notesFromFamily: true, messages: false, tellFamily: false });
  });

  test("a ticked-off section's data never leaves the server", async () => {
    const r = await put({ on: true, callUserIds: [leader.user.id], show: { calls: false, comingUp: false } });
    expect(r.body.show).toMatchObject({ calls: false, comingUp: false, notesFromFamily: true });
    const s = (await dash()).body.simpleScreen;
    expect(s.callContacts).toEqual([]);
    expect(s.comingUp).toEqual([]);
    expect(s.noteForYou).toBeTruthy();
    // A partial show keeps the rest.
    const r2 = await put({ on: true, callUserIds: [leader.user.id], show: { calls: true } });
    expect(r2.body.show).toMatchObject({ calls: true, comingUp: false });
  });

  test("opening the screen marks the note seen; I read it records the time and tells the author", async () => {
    const before = (await dash()).body.simpleScreen.noteForYou;
    expect(before).toBeTruthy();
    const o = await h.request.post(`/api/care-recipients/${recipientId}/simple-screen/opened`).set(h.auth(mom.token)).send({ noteId: before.id });
    expect(o.body.recorded).toBe(true);
    // Someone else can't record a look for her.
    expect((await h.request.post(`/api/care-recipients/${recipientId}/simple-screen/opened`).set(h.auth(leader.token)).send({})).status).toBe(403);

    mockPush.mockClear();
    const rd = await h.request.post(`/api/care-recipients/${recipientId}/notes-for-me/${before.id}/read`).set(h.auth(mom.token));
    expect(rd.status).toBe(200);
    expect(rd.body.readAt).toBeTruthy();
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush.mock.calls[0][0]).toBe(leader.user.id);
    expect(mockPush.mock.calls[0][1].title).toBe("Betty read your note");

    const g = await h.request.get(`/api/care-recipients/${recipientId}/simple-mode`).set(h.auth(leader.token));
    expect(g.body.lastNote.seenAt).toBeTruthy();
    expect(g.body.lastNote.readAt).toBeTruthy();
    expect(g.body.lastOpenedAt).toBeTruthy();
    expect(g.body.opens7d).toBe(1);
    // "just have her click on the message to clear it" — reading it takes it off her screen.
    expect((await dash()).body.simpleScreen.noteForYou).toBeNull();
  });

  test("clearing takes the note off her screen; a newer note shows again (and replaces an unread one)", async () => {
    await h.request.post("/api/notes").set(h.auth(leader.token))
      .send({ careRecipientId: recipientId, content: "Old unread", noteType: "for_recipient" });
    await h.request.post("/api/notes").set(h.auth(leader.token))
      .send({ careRecipientId: recipientId, content: "Newer one", noteType: "for_recipient" });
    expect((await dash()).body.simpleScreen.noteForYou.content).toBe("Newer one");
    await put({ on: true, callUserIds: [leader.user.id], clearNote: true });
    expect((await dash()).body.simpleScreen.noteForYou).toBeNull();
    const g = await h.request.get(`/api/care-recipients/${recipientId}/simple-mode`).set(h.auth(leader.token));
    expect(g.body.lastNote).toBeNull();
    await h.request.post("/api/notes").set(h.auth(leader.token))
      .send({ careRecipientId: recipientId, content: "Lunch at noon", noteType: "for_recipient" });
    expect((await dash()).body.simpleScreen.noteForYou.content).toBe("Lunch at noon");
  });

  test("Tell the family: refused until ticked, then lands as hers and pushes who, never what", async () => {
    const send = (body) => h.request.post(`/api/care-recipients/${recipientId}/from-me`).set(h.auth(mom.token)).send(body);
    expect((await send({ content: "I'm hungry" })).status).toBe(403);
    await put({ on: true, callUserIds: [leader.user.id], show: { tellFamily: true } });

    mockPush.mockClear();
    const r = await send({ content: "My shoulder hurts", needsAttention: true });
    expect(r.status).toBe(201);
    const row = await db.prepare("SELECT author_id, note_type, needs_attention FROM recipient_notes WHERE id = ?").get(r.body.id);
    expect(row).toMatchObject({ author_id: mom.user.id, note_type: "from_recipient" });
    expect(Number(row.needs_attention)).toBe(1);
    const to = mockPush.mock.calls.map((c) => c[0]);
    expect(to).toEqual(expect.arrayContaining([leader.user.id, sister.user.id]));
    expect(to).not.toContain(mom.user.id);
    for (const c of mockPush.mock.calls) expect(JSON.stringify(c[1])).not.toContain("shoulder");
    expect(mockPush.mock.calls[0][1].title).toBe("⚠️ Betty needs attention");

    // A double tap doesn't send twice.
    const again = await send({ content: "My shoulder hurts", needsAttention: true });
    expect(again.body.duplicate).toBe(true);
    // Only she can send as her.
    expect((await h.request.post(`/api/care-recipients/${recipientId}/from-me`).set(h.auth(leader.token)).send({ content: "x" })).status).toBe(403);
    // The team reads it in Care Notes.
    const notes = await h.request.get(`/api/notes/${recipientId}`).set(h.auth(leader.token));
    expect(notes.body.notes.some((n) => n.content === "My shoulder hurts")).toBe(true);
    expect((await dash()).body.simpleScreen.lastSent.content).toBe("My shoulder hurts");
  });

  test("ticking Messages connects her to the care team", async () => {
    await put({ on: true, callUserIds: [leader.user.id], show: { messages: true } });
    const c = await db.prepare(
      "SELECT COUNT(*)::int AS n FROM connections WHERE (requester_id = ? OR recipient_id = ?) AND status = 'accepted'"
    ).get(mom.user.id, mom.user.id);
    expect(c.n).toBeGreaterThanOrEqual(2);
  });
});
