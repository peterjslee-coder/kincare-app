/**
 * v1.139.0 — change a whole series, pay included (Pete, feedback 316aeee2). Open visits change
 * now; a caregiver who accepted is asked once for hers; if she says no they stay as they were.
 */
const { startHarness, stopHarness } = require("./harness");
const { v4: uuid } = require("uuid");
const { attentionItemsFor } = require("../../src/utils/attention");

jest.setTimeout(180000);

let h, pete, tina, other, recipientId, group, tinaIds = [], openIds = [], pid;

const plus = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

beforeAll(async () => {
  h = await startHarness({ routers: { "/api/series-changes": "../../src/routes/seriesChanges" } });
  pete = await h.createUser({ roles: ["family"], firstName: "Pete" });
  tina = await h.createUser({ roles: ["caregiver"], firstName: "Tina" });
  other = await h.createUser({ roles: ["caregiver"], firstName: "Other" });
  ({ recipientId } = await h.createCareTeam({ familyUserId: pete.user.id }));
  pid = uuid();
  await h.db.prepare("INSERT INTO caregiver_profiles (id, user_id, hourly_rate, created_at) VALUES (?, ?, 25, NOW())").run(pid, tina.user.id);
  group = uuid();
  const ins = `INSERT INTO care_sessions (id, care_recipient_id, family_user_id, caregiver_id, service_type, status,
      scheduled_date, scheduled_time, duration_hours, agreed_rate, proposed_rate, estimated_cost, special_instructions, recurrence_group_id, created_at)
    VALUES (?, ?, ?, ?, 'companionship', ?, ?, '09:00', 8, ?, ?, ?, 'Lunch at noon', ?, NOW())`;
  for (let i = 0; i < 3; i += 1) {
    const id = uuid(); tinaIds.push(id);
    await h.db.prepare(ins).run(id, recipientId, pete.user.id, pid, "confirmed", plus(7 + i * 7), 25, 25, 200, group);
  }
  for (let i = 3; i < 5; i += 1) {
    const id = uuid(); openIds.push(id);
    await h.db.prepare(ins).run(id, recipientId, pete.user.id, null, "open", plus(7 + i * 7), null, 25, 200, group);
  }
});
afterAll(async () => { await stopHarness(h); });

const as = (who) => ({
  get: (p) => h.request.get(p).set(h.auth(who.token)),
  post: (p, b) => h.request.post(p).set(h.auth(who.token)).send(b),
  put: (p, b) => h.request.put(p).set(h.auth(who.token)).send(b),
});
const row = (id) => h.db.prepare("SELECT * FROM care_sessions WHERE id = ?").get(id);

let reqId;

test("the preview counts Tina's and the open ones", async () => {
  const r = await as(pete).get(`/api/series-changes/preview/${tinaIds[0]}`);
  expect(r.status).toBe(200);
  expect(r.body.open).toBe(2);
  expect(r.body.caregivers).toEqual([expect.objectContaining({ first: "Tina", count: 3 })]);
  expect(r.body.current).toMatchObject({ time: "09:00", durationHours: 8, rate: 25 });
});

test("a caregiver can't change the series", async () => {
  expect((await as(tina).post("/api/series-changes", { sessionId: tinaIds[0], rate: 30 })).status).toBe(404);
});

test("open visits change now; Tina's wait for her", async () => {
  const r = await as(pete).post("/api/series-changes", { sessionId: tinaIds[0], rate: 28, time: "10:00" });
  expect(r.status).toBe(200);
  expect(r.body.changedNow).toBe(2);
  expect(r.body.asked).toEqual([expect.objectContaining({ caregiver: "Tina", count: 3 })]);
  reqId = r.body.asked[0].id;
  const o = await row(openIds[0]);
  expect(o).toMatchObject({ scheduled_time: "10:00" });
  expect(Number(o.proposed_rate)).toBe(28);
  expect(Number(o.estimated_cost)).toBe(224);
  const t = await row(tinaIds[0]);
  expect(t.scheduled_time).toBe("09:00");
  expect(Number(t.agreed_rate)).toBe(25);
});

test("Tina sees it in Needs you, with Keep as is", async () => {
  const items = (await attentionItemsFor(h.db, tina.user.id)).items.filter((i) => i.kind === "seriesChange");
  expect(items).toHaveLength(1);
  expect(items[0].title).toBe("Pete would like to change 3 visits");
  expect(items[0].detail).toContain("$28/hr instead of $25/hr");
  expect(items[0].dismiss.label).toBe("Keep as is");
});

test("someone else can't answer for her", async () => {
  expect((await as(other).put(`/api/series-changes/${reqId}/respond`, { accept: true })).status).toBe(404);
});

test("she declines: every one of hers stays as it was, same pay", async () => {
  const r = await as(tina).put(`/api/series-changes/${reqId}/respond`, { accept: false });
  expect(r.body.status).toBe("declined");
  for (const id of tinaIds) {
    const t = await row(id);
    expect(t.scheduled_time).toBe("09:00");
    expect(Number(t.agreed_rate)).toBe(25);
    expect(Number(t.estimated_cost)).toBe(200);
  }
  expect((await as(tina).put(`/api/series-changes/${reqId}/respond`, { accept: true })).status).toBe(409);
});

test("asked again, she accepts: all hers change, the price with them", async () => {
  const r = await as(pete).post("/api/series-changes", { sessionId: tinaIds[0], rate: 28, durationHours: 6 });
  const id = r.body.asked[0].id;
  const a = await as(tina).put(`/api/series-changes/${id}/respond`, { accept: true });
  expect(a.body).toEqual({ status: "accepted", changed: 3 });
  for (const sid of tinaIds) {
    const t = await row(sid);
    expect(Number(t.agreed_rate)).toBe(28);
    expect(Number(t.duration_hours)).toBe(6);
    expect(Number(t.estimated_cost)).toBe(168);
  }
});
