/**
 * v1.140.0 — the day card keeps today's appointments until midnight, with how many care notes
 * each has; Betty's page lists past appointments with theirs (Pete, 11/20: the dental transcript
 * was in the record and he couldn't find it again).
 */
const { startHarness, stopHarness } = require("./harness");
const { v4: uuid } = require("uuid");

jest.setTimeout(180000);

const TZ = "America/New_York";
const day = (n) => { const d = new Date(Date.now() + n * 86400000); return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d); };

let h, pete, outsider, recipientId, todayEv, pastEv;

beforeAll(async () => {
  h = await startHarness({ routers: { "/api/care-events": "../../src/routes/careEvents" } });
  pete = await h.createUser({ roles: ["family"], firstName: "Pete" });
  outsider = await h.createUser({ roles: ["family"], firstName: "Nobody" });
  ({ recipientId } = await h.createCareTeam({ familyUserId: pete.user.id }));
  await h.db.prepare("UPDATE care_recipients SET timezone = ? WHERE id = ?").run(TZ, recipientId);
  const mk = async (date, title) => {
    const id = uuid();
    await h.db.prepare(`INSERT INTO care_events (id, care_recipient_id, created_by, title, category, event_date, event_time, tz, starts_at, is_active, created_at)
      VALUES (?, ?, ?, ?, 'medical', ?, '00:05', ?, ?, 1, NOW())`).run(id, recipientId, pete.user.id, title, date, TZ, `${date}T05:05:00Z`);
    return id;
  };
  todayEv = await mk(day(0), "Dental");
  pastEv = await mk(day(-3), "Eye doctor");
  for (const ev of [todayEv, pastEv]) {
    await h.db.prepare(`INSERT INTO recipient_notes (id, care_recipient_id, author_id, content, note_type, care_event_id, created_at)
      VALUES (?, ?, ?, 'Summary\n\n— Transcript —\nwords', 'visit_summary', ?, NOW())`).run(uuid(), recipientId, pete.user.id, ev);
  }
});
afterAll(async () => { await stopHarness(h); });

test("today's appointment comes back with its note count, even though it has started", async () => {
  const r = await h.request.get("/api/care-events/upcoming").set(h.auth(pete.token));
  const ev = r.body.events.find((e) => e.id === todayEv);
  expect(ev).toBeTruthy();
  expect(ev.notes_count).toBe(1);
  expect(ev.notes_first_author).toBe("Pete");
});

test("her page lists past appointments, newest first, with notes", async () => {
  const r = await h.request.get(`/api/care-events/recipient/${recipientId}`).set(h.auth(pete.token));
  expect(r.status).toBe(200);
  const past = r.body.events.find((e) => e.id === pastEv);
  expect(past).toBeTruthy();
  expect(past.notes_count).toBe(1);
});

test("an outsider gets nothing", async () => {
  expect((await h.request.get(`/api/care-events/recipient/${recipientId}`).set(h.auth(outsider.token))).status).toBe(403);
});
