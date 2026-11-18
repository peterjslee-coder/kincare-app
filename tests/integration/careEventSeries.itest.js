/**
 * v1.130.2 — repeating events (weekly).
 *
 * Pete, 11/17: "I'd like to be able to make events repeating...like church being every sunday."
 * A series is real rows, one per week, ~12 weeks ahead, sharing series_id.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || "event-series-secret";

const { startHarness, stopHarness } = require("./harness");

jest.setTimeout(180000);

let h, db, family, recipientId, seriesId;
const TZ = "America/New_York";
const etDate = (days) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(Date.now() + days * 86400000));
const rows = () => db.prepare("SELECT id, event_date, event_time, title, location, is_active, repeat_rule FROM care_events WHERE series_id = ? ORDER BY event_date").all(seriesId);

beforeAll(async () => {
  h = await startHarness({ routers: { "/api/care-events": "../../src/routes/careEvents" } });
  db = h.db;
  family = await h.createUser({ roles: ["family"], firstName: "Pete" });
  ({ recipientId } = await h.createCareTeam({ familyUserId: family.user.id }));
});

afterAll(async () => { await stopHarness(h); });

test("Every week makes a series about 12 weeks ahead, same time and place", async () => {
  const start = etDate(3);
  const r = await h.request.post("/api/care-events").set(h.auth(family.token)).send({
    care_recipient_id: recipientId, title: "Church pickup", category: "social",
    event_date: start, event_time: "09:30", location: "First Baptist", repeat: "weekly",
  });
  expect(r.status).toBe(201);
  seriesId = r.body.event.series_id;
  expect(seriesId).toBe(r.body.event.id);
  const all = await rows();
  expect(all.length).toBeGreaterThanOrEqual(12);
  expect(all.length).toBeLessThanOrEqual(14);
  // Every 7 days, same time and place.
  for (let i = 1; i < all.length; i++) {
    const gap = (Date.parse(all[i].event_date) - Date.parse(all[i - 1].event_date)) / 86400000;
    expect(gap).toBe(7);
    expect(all[i]).toMatchObject({ event_time: "09:30", location: "First Baptist", title: "Church pickup", repeat_rule: "weekly" });
  }
});

test("the poller's extender adds nothing twice", async () => {
  const before = (await rows()).length;
  await require("../../src/routes/careEvents")._extendAllSeries(db);
  expect((await rows()).length).toBe(before);
});

test("edit this and later weeks: time and place change from that week on, earlier weeks untouched", async () => {
  const all = await rows();
  const third = all[2];
  const r = await h.request.put(`/api/care-events/${third.id}`).set(h.auth(family.token))
    .send({ event_time: "10:00", location: "Main St Church", scope: "following" });
  expect(r.status).toBe(200);
  const after = await rows();
  expect(after[0]).toMatchObject({ event_time: "09:30", location: "First Baptist" });
  expect(after[1]).toMatchObject({ event_time: "09:30", location: "First Baptist" });
  for (const o of after.slice(2)) expect(o).toMatchObject({ event_time: "10:00", location: "Main St Church" });
});

test("edit just this week leaves the others alone", async () => {
  const all = await rows();
  await h.request.put(`/api/care-events/${all[0].id}`).set(h.auth(family.token)).send({ title: "Church pickup (Easter)" });
  const after = await rows();
  expect(after[0].title).toBe("Church pickup (Easter)");
  expect(after[1].title).toBe("Church pickup");
});

test("remove this and later weeks stops the series for good", async () => {
  const all = await rows();
  const r = await h.request.delete(`/api/care-events/${all[4].id}?scope=following`).set(h.auth(family.token));
  expect(r.status).toBe(200);
  const after = await rows();
  expect(after.filter((o) => Number(o.is_active) === 1).length).toBe(4);
  expect(after.every((o) => o.repeat_rule === null)).toBe(true);
  await require("../../src/routes/careEvents")._extendAllSeries(db);
  expect((await rows()).filter((o) => Number(o.is_active) === 1).length).toBe(4);
});

test("Just once is still just once", async () => {
  const r = await h.request.post("/api/care-events").set(h.auth(family.token)).send({
    care_recipient_id: recipientId, title: "Haircut", category: "other", event_date: etDate(2), event_time: "13:00", location: "Angie's",
  });
  expect(r.status).toBe(201);
  expect(r.body.event.series_id).toBeNull();
});
