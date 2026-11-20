/**
 * v1.137.0 — a photo sent in Messages can be saved to the loved one's Care photos (Pete, 11/20;
 * feedback 2012ed0b / 03cc8526). Family only; a caregiver sees one only on her own visit.
 */
const { startHarness, stopHarness } = require("./harness");
const { v4: uuid } = require("uuid");

jest.setTimeout(180000);

const PNG_1PX =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

let h, family, sibling, outsider, cg, otherCg, recipientId, teamId, sessionId, otherSessionId, messageId;

const today = () => new Date().toISOString().slice(0, 10);

beforeAll(async () => {
  h = await startHarness({ routers: { "/api/care-photos": "../../src/routes/carePhotos" } });
  const db = h.db;
  family = await h.createUser({ roles: ["family"], firstName: "Pete" });
  sibling = await h.createUser({ roles: ["family"], firstName: "Sam" });
  outsider = await h.createUser({ roles: ["family"], firstName: "Nobody" });
  cg = await h.createUser({ roles: ["caregiver"], firstName: "Tina" });
  otherCg = await h.createUser({ roles: ["caregiver"], firstName: "Other" });
  ({ recipientId, teamId } = await h.createCareTeam({ familyUserId: family.user.id }));
  await h.addTeamMember(teamId, sibling.user.id, "member");

  const pid = uuid(), opid = uuid();
  await db.prepare("INSERT INTO caregiver_profiles (id, user_id, hourly_rate, created_at) VALUES (?, ?, 25, NOW())").run(pid, cg.user.id);
  await db.prepare("INSERT INTO caregiver_profiles (id, user_id, hourly_rate, created_at) VALUES (?, ?, 25, NOW())").run(opid, otherCg.user.id);
  sessionId = uuid(); otherSessionId = uuid();
  const ins = `INSERT INTO care_sessions (id, care_recipient_id, family_user_id, caregiver_id, service_type, status,
                 scheduled_date, scheduled_time, duration_hours, created_at)
               VALUES (?, ?, ?, ?, 'companionship', 'confirmed', ?, '09:00', 8, NOW())`;
  await db.prepare(ins).run(sessionId, recipientId, family.user.id, pid, today());
  await db.prepare(ins).run(otherSessionId, recipientId, family.user.id, opid, today());

  const convId = uuid();
  await db.prepare("INSERT INTO conversations (id, type, created_by, created_at) VALUES (?, 'direct', ?, NOW())").run(convId, cg.user.id);
  for (const u of [family.user.id, cg.user.id]) {
    await db.prepare("INSERT INTO conversation_members (id, conversation_id, user_id) VALUES (?, ?, ?)").run(uuid(), convId, u);
  }
  messageId = uuid();
  await db.prepare(`INSERT INTO messages (id, sender_id, recipient_id, content, conversation_id, message_type, metadata, created_at)
                    VALUES (?, ?, ?, '', ?, 'photo', ?, NOW())`)
    .run(messageId, cg.user.id, family.user.id, convId, JSON.stringify({ photoUrl: PNG_1PX, caption: "Scratched lip" }));
});

afterAll(async () => { await stopHarness(h); });

const as = (who) => ({
  get: (p) => h.request.get(p).set(h.auth(who.token)),
  post: (p, b) => h.request.post(p).set(h.auth(who.token)).send(b),
  patch: (p, b) => h.request.patch(p).set(h.auth(who.token)).send(b),
  del: (p) => h.request.delete(p).set(h.auth(who.token)),
});

let photoId;

test("the save sheet suggests the sender's visit and carries the caption", async () => {
  const res = await as(family).get(`/api/care-photos/options?messageId=${messageId}`);
  expect(res.status).toBe(200);
  expect(res.body.suggestedSessionId).toBe(sessionId);
  expect(res.body.caption).toBe("Scratched lip");
  expect(res.body.recipients.map((r) => r.id)).toEqual([recipientId]);
});

test("someone not in the conversation can't even see the options", async () => {
  expect((await as(sibling).get(`/api/care-photos/options?messageId=${messageId}`)).status).toBe(404);
});

test("a caregiver in the conversation can't save it — family only", async () => {
  const res = await as(cg).post("/api/care-photos", { messageId, careRecipientId: recipientId });
  expect(res.status).toBe(403);
});

test("family saves it with the visit, and saving twice doesn't duplicate", async () => {
  const res = await as(family).post("/api/care-photos", { messageId, careRecipientId: recipientId, sessionId, caption: "Lip" });
  expect(res.status).toBe(200);
  photoId = res.body.id;
  const again = await as(family).post("/api/care-photos", { messageId, careRecipientId: recipientId, sessionId });
  expect(again.body).toEqual({ id: photoId, already: true });
});

test("the bytes come back for family on the team, and for the caregiver on that visit", async () => {
  for (const who of [family, sibling, cg]) {
    const r = await as(who).get(`/api/care-photos/${photoId}/image`);
    expect(r.status).toBe(200);
    expect(String(r.headers["content-type"])).toContain("image/png");
  }
});

test("not for a caregiver on a different visit, nor an outsider", async () => {
  expect((await as(otherCg).get(`/api/care-photos/${photoId}/image`)).status).toBe(404);
  expect((await as(outsider).get(`/api/care-photos/${photoId}/image`)).status).toBe(404);
});

test("moving it to the other visit changes which caregiver can see it", async () => {
  expect((await as(sibling).patch(`/api/care-photos/${photoId}`, { sessionId: otherSessionId })).status).toBe(200);
  expect((await as(cg).get(`/api/care-photos/${photoId}/image`)).status).toBe(404);
  expect((await as(otherCg).get(`/api/care-photos/${photoId}/image`)).status).toBe(200);
});

test("a caregiver can't move or delete it", async () => {
  expect((await as(otherCg).patch(`/api/care-photos/${photoId}`, { sessionId: null })).status).toBe(404);
  expect((await as(otherCg).del(`/api/care-photos/${photoId}`)).status).toBe(404);
});

test("family deletes it; it's gone, and the message photo is untouched", async () => {
  expect((await as(family).del(`/api/care-photos/${photoId}`)).status).toBe(200);
  expect((await as(family).get(`/api/care-photos/${photoId}/image`)).status).toBe(404);
  const m = await h.db.prepare("SELECT metadata FROM messages WHERE id = ?").get(messageId);
  expect(JSON.parse(m.metadata).photoUrl).toBe(PNG_1PX);
});
