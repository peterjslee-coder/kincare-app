/**
 * v1.107.8 — a caregiver is told when a visit of hers is reviewed.
 * Pete: "'your session with Betty has been reviewed by Peter' is enough. They click on it, it
 * takes them to their page where they can investigate the review if they want."
 */
const { v4: uuid } = require("uuid");

const mockPush = jest.fn(() => Promise.resolve({ sent: 1 }));
jest.mock("../../src/routes/push", () => {
  const actual = jest.requireActual("../../src/routes/push");
  return { ...actual, sendPushToUser: (...a) => mockPush(...a) };
});

const { startHarness, stopHarness } = require("./harness");
jest.setTimeout(180000);

let h, db;
beforeAll(async () => {
  h = await startHarness({ routers: { "/api/sessions": "../../src/routes/sessions" } });
  db = h.db;
});
afterAll(async () => { await stopHarness(h); });

test("the caregiver gets one push naming the person and the reviewer — no stars, no words", async () => {
  const family = await h.createUser({ firstName: "Peter", roles: ["family"] });
  const { recipientId } = await h.createCareTeam({ familyUserId: family.user.id });
  await db.prepare("UPDATE care_recipients SET first_name = 'Betty' WHERE id = ?").run(recipientId);
  const cg = await h.createUser({ firstName: "Tina", roles: ["caregiver"] });
  const pid = uuid();
  await db.prepare("INSERT INTO caregiver_profiles (id, user_id, hourly_rate, created_at) VALUES (?, ?, 22, NOW())").run(pid, cg.user.id);
  const sid = uuid();
  await db.prepare(`
    INSERT INTO care_sessions (id, care_recipient_id, family_user_id, caregiver_id, service_type, status,
      scheduled_date, scheduled_time, duration_hours, estimated_cost, created_at)
    VALUES (?, ?, ?, ?, 'companion', 'completed', '2026-09-15', '09:00', 8, 176, NOW())
  `).run(sid, recipientId, family.user.id, pid);

  mockPush.mockClear();
  const res = await h.request.post(`/api/sessions/${sid}/review`).set(h.auth(family.token))
    .send({ rating: 5, comment: "Betty adored her" });
  expect(res.status).toBe(200);

  const toTina = mockPush.mock.calls.filter((c) => c[0] === cg.user.id);
  expect(toTina).toHaveLength(1);
  const [, payload] = toTina[0];
  expect(payload.body).toBe("Your session with Betty was reviewed by Peter.");
  expect(payload.body).not.toMatch(/5|star|adored/i);
  expect(payload.title).not.toMatch(/5|star/i);
  expect(payload.data).toEqual(expect.objectContaining({
    type: "review_received", page: "caregiver-profile", caregiverId: pid, sessionId: sid,
  }));
});
