/**
 * v1.125.2 — feedback d42baa59. Pete: "I cannot tell if this session is canceled on November 3
 * or if she's canceled the entire series. If she only has the option to cancel the series, we
 * need a feature by which she is prompted whether she's canceling a day in the series or the
 * entire series."
 *
 * What must hold:
 *   - the preview tells the cancel screen there IS a choice, with the same count /cancel will use;
 *   - scope defaults to ONE visit (every old client), and says the rest still stand;
 *   - scope "series" cancels this visit and every later one this person could cancel — a
 *     caregiver only their own, never a visit already given to someone else, never an earlier one;
 *   - a family's series cancel also takes the OPEN visits (the old DELETE route skipped them);
 *   - the family dashboard names who dropped an open visit.
 */
const { v4: uuid } = require("uuid");
jest.mock("../../src/routes/push", () => {
  const actual = jest.requireActual("../../src/routes/push");
  return { ...actual, sendPushToUser: jest.fn(async () => {}), notifyAdmins: jest.fn(async () => {}) };
});
const { startHarness, stopHarness } = require("./harness");
jest.setTimeout(180000);

let h, db;
beforeAll(async () => {
  h = await startHarness({ routers: {
    "/api/sessions": "../../src/routes/sessions",
    "/api/dashboard": "../../src/routes/dashboard",
  } });
  db = h.db;
  require("../../src/routes/accountability").voidSessionPayment = async () => ({ success: true });
});
afterAll(async () => { await stopHarness(h); });

const DATES = ["2027-01-04", "2027-01-11", "2027-01-18", "2027-01-25", "2027-02-01"];

async function series() {
  const family = await h.createUser({ firstName: "Pete" });
  const { recipientId } = await h.createCareTeam({ familyUserId: family.user.id });
  const mk = async (name) => {
    const u = await h.createUser({ firstName: name, roles: ["caregiver"] });
    const pid = uuid();
    await db.prepare("INSERT INTO caregiver_profiles (id, user_id, hourly_rate, created_at) VALUES (?, ?, 25, NOW())").run(pid, u.user.id);
    return { ...u, profileId: pid };
  };
  const tina = await mk("Tina");
  const other = await mk("Olga");
  const group = uuid();
  const ids = [];
  for (const d of DATES) {
    const id = uuid();
    ids.push(id);
    await db.prepare(`
      INSERT INTO care_sessions (id, care_recipient_id, family_user_id, caregiver_id, service_type, status,
        scheduled_date, scheduled_time, duration_hours, recurrence_rule, recurrence_group_id, created_at)
      VALUES (?, ?, ?, ?, 'companionship', 'confirmed', ?, '10:00', 2, 'weekly', ?, NOW())
    `).run(id, recipientId, family.user.id, tina.profileId, d, group);
  }
  return { family, tina, other, group, ids, recipientId };
}
const row = (id) => db.prepare("SELECT status, caregiver_id, cancelled_by FROM care_sessions WHERE id = ?").get(id);
const cancel = (t, token, id, body = {}) => h.request.put(`/api/sessions/${id}/cancel`).set(h.auth(token)).send(body);

test("the preview offers the choice, counted the way /cancel will count it", async () => {
  const t = await series();
  const r = await h.request.get(`/api/sessions/${t.ids[1]}/cancel-preview`).set(h.auth(t.tina.token));
  expect(r.status).toBe(200);
  expect(r.body.series).toEqual({ thisDay: "Mon Jan 11", laterCount: 3, lastDay: "Mon Feb 1", rule: "weekly" });
  const last = await h.request.get(`/api/sessions/${t.ids[4]}/cancel-preview`).set(h.auth(t.tina.token));
  expect(last.body.series).toBeNull(); // nothing after it — no choice to make
  // A later visit that has gone to another caregiver is not Tina's to cancel, so it is not
  // counted in Tina's choice — but the family, cancelling for the person, does count it.
  await db.prepare("UPDATE care_sessions SET caregiver_id = ? WHERE id = ?").run(t.other.profileId, t.ids[3]);
  const tinaView = await h.request.get(`/api/sessions/${t.ids[1]}/cancel-preview`).set(h.auth(t.tina.token));
  expect(tinaView.body.series).toMatchObject({ laterCount: 2, lastDay: "Mon Feb 1" });
  const familyView = await h.request.get(`/api/sessions/${t.ids[1]}/cancel-preview`).set(h.auth(t.family.token));
  expect(familyView.body.series).toMatchObject({ laterCount: 3 });
});

test("no scope = ONE visit, and the family is told the rest still stand", async () => {
  const t = await series();
  const r = await cancel(t, t.tina.token, t.ids[1], { reason: "sick" });
  expect(r.status).toBe(200);
  expect(r.body).toMatchObject({ cancelledCount: 1, seriesCancelled: 0, seriesRemaining: 3 });
  expect(await row(t.ids[1])).toMatchObject({ status: "open", caregiver_id: null, cancelled_by: "caregiver" });
  for (const id of [t.ids[0], t.ids[2], t.ids[3], t.ids[4]]) expect((await row(id)).status).toBe("confirmed");
  const feed = await db.prepare("SELECT message FROM activity_feed WHERE family_user_id = ? ORDER BY created_at DESC LIMIT 1").get(t.family.user.id);
  expect(feed.message).toMatch(/Mon Jan 11/);
  expect(feed.message).toMatch(/Only this visit — the other 3 in the series are still with Tina/);
});

test("the family dashboard names who dropped the open visit — and only that one", async () => {
  const t = await series();
  // The dashboard shows the next 30 days, so move this series to start in 3 days.
  const day = (n) => new Date(Date.now() + n * 86400000).toISOString().split("T")[0];
  for (let i = 0; i < t.ids.length; i++) {
    await db.prepare("UPDATE care_sessions SET scheduled_date = ? WHERE id = ?").run(day(3 + i * 7), t.ids[i]);
  }
  expect((await cancel(t, t.tina.token, t.ids[0])).status).toBe(200);
  const d = await h.request.get("/api/dashboard").set(h.auth(t.family.token));
  expect(d.status).toBe(200);
  const open = d.body.upcomingSessions.find((s) => s.id === t.ids[0]);
  const kept = d.body.upcomingSessions.find((s) => s.id === t.ids[1]);
  expect(open).toMatchObject({ status: "open", droppedByName: "Tina", recurrenceGroupId: t.group });
  expect(kept).toMatchObject({ status: "confirmed", droppedByName: null, caregiverName: expect.stringMatching(/^Tina/) });
});

test("caregiver, scope series: this and every LATER visit that is still theirs — nothing else", async () => {
  const t = await series();
  // the 4th visit has already gone to someone else; the 1st is before the one being cancelled
  await db.prepare("UPDATE care_sessions SET caregiver_id = ? WHERE id = ?").run(t.other.profileId, t.ids[3]);
  const r = await cancel(t, t.tina.token, t.ids[1], { scope: "series" });
  expect(r.status).toBe(200);
  expect(r.body).toMatchObject({ cancelledCount: 3, seriesCancelled: 2 });
  expect((await row(t.ids[0])).status).toBe("confirmed");             // earlier — untouched
  expect(await row(t.ids[1])).toMatchObject({ status: "open", caregiver_id: null });
  expect(await row(t.ids[2])).toMatchObject({ status: "open", caregiver_id: null });
  expect(await row(t.ids[3])).toMatchObject({ status: "confirmed", caregiver_id: t.other.profileId }); // not hers
  expect(await row(t.ids[4])).toMatchObject({ status: "open", caregiver_id: null });
  const feed = await db.prepare("SELECT title, message FROM activity_feed WHERE family_user_id = ? ORDER BY created_at DESC LIMIT 1").get(t.family.user.id);
  expect(feed.title).toMatch(/Series Cancelled/);
  expect(feed.message).toMatch(/the Mon Jan 11 visit and the 2 after it, through Mon Feb 1/);
});

test("family, scope series: takes confirmed AND open later visits; earlier ones stay", async () => {
  const t = await series();
  await cancel(t, t.tina.token, t.ids[2]); // one dropped → open
  const r = await cancel(t, t.family.token, t.ids[1], { scope: "series" });
  expect(r.status).toBe(200);
  expect(r.body.cancelledCount).toBe(4);
  expect((await row(t.ids[0])).status).toBe("confirmed");
  for (const id of t.ids.slice(1)) expect((await row(id)).status).toBe("cancelled");
});

test("a stranger cannot reach the series by asking for scope", async () => {
  const t = await series();
  const stranger = await h.createUser({ firstName: "Mal", roles: ["caregiver"] });
  const r = await cancel(t, stranger.token, t.ids[1], { scope: "series" });
  expect(r.status).toBe(404);
  for (const id of t.ids) expect((await row(id)).status).toBe("confirmed");
});

test("an unknown scope is treated as one visit", async () => {
  const t = await series();
  const r = await cancel(t, t.family.token, t.ids[0], { scope: "everything" });
  expect(r.body.cancelledCount).toBe(1);
  expect((await row(t.ids[1])).status).toBe("confirmed");
});
