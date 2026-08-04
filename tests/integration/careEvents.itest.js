/**
 * Care Events integration tests (v1.100.0) — the awareness loop against the
 * REAL schema: owner adds an appointment → team sees it in /upcoming → the
 * signed .ics link works with no session → editing the date re-arms
 * reminders → poller sends the same-day nudge to FAMILY ONLY → soft delete.
 */
const { startHarness, stopHarness } = require("./harness");

jest.setTimeout(180000);

const ROUTERS = {
  "/api/care-events": "../../src/routes/careEvents",
};

let h;
let family, teamMember, caregiver, outsider;
let recipientId, teamId;

const TZ = "America/New_York";
const etDateTime = (msFromNow) => {
  const d = new Date(Date.now() + msFromNow);
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(d).replace(/^24:/, "00:");
  return { date, time };
};

beforeAll(async () => {
  delete process.env.ANTHROPIC_API_KEY; // parse endpoint must degrade gracefully
  h = await startHarness({ routers: ROUTERS });
  family = await h.createUser({ roles: ["family"], firstName: "Pete" });
  teamMember = await h.createUser({ roles: ["family"], firstName: "Sara" });
  caregiver = await h.createUser({ roles: ["caregiver"], firstName: "Edwina" });
  outsider = await h.createUser({ roles: ["family"] });
  const t = await h.createCareTeam({ familyUserId: family.user.id });
  recipientId = t.recipientId;
  teamId = t.teamId;
  await h.addTeamMember(teamId, teamMember.user.id, "member");
  await h.addTeamMember(teamId, caregiver.user.id, "member");
});

afterAll(async () => { await stopHarness(h); });

let eventId, icsUrl;

describe("care event lifecycle", () => {
  test("owner adds a timed appointment; it appears in /upcoming with export link", async () => {
    const { date } = etDateTime(2 * 24 * 3600000); // day after tomorrow
    const res = await h.request.post("/api/care-events").set(h.auth(family.token)).send({
      care_recipient_id: recipientId,
      title: "Cardiology — Dr. Patel",
      category: "medical",
      event_date: date,
      event_time: "14:00",
      end_time: "15:00",
      location: "Carilion Clinic, Radford",
      details: "Bring the medication list.",
    });
    expect(res.status).toBe(201);
    expect(res.body.event.all_day).toBe(false);
    expect(res.body.event.ics_url).toMatch(/\/api\/care-events\/.+\/ics\?t=/);
    eventId = res.body.event.id;
    icsUrl = res.body.event.ics_url;

    const up = await h.request.get("/api/care-events/upcoming").set(h.auth(teamMember.token));
    expect(up.status).toBe(200);
    const ev = up.body.events.find((e) => e.id === eventId);
    expect(ev).toBeTruthy();
    expect(ev.recipientFirstName).toBeTruthy();
    expect(ev.canManage).toBe(false); // plain member: sees, doesn't manage
  });

  test("plain team member cannot create or edit; outsider sees nothing", async () => {
    const { date } = etDateTime(24 * 3600000);
    const create = await h.request.post("/api/care-events").set(h.auth(teamMember.token)).send({
      care_recipient_id: recipientId, title: "x", event_date: date,
    });
    expect(create.status).toBe(403);
    const edit = await h.request.put(`/api/care-events/${eventId}`)
      .set(h.auth(teamMember.token)).send({ title: "hijacked" });
    expect(edit.status).toBe(403);

    const up = await h.request.get("/api/care-events/upcoming").set(h.auth(outsider.token));
    expect(up.body.events).toHaveLength(0);
    const list = await h.request.get(`/api/care-events/recipient/${recipientId}`).set(h.auth(outsider.token));
    expect(list.status).toBe(403);
  });

  test("signed .ics link works with NO auth; a bad signature does not", async () => {
    const ics = await h.request.get(icsUrl); // no auth header on purpose
    expect(ics.status).toBe(200);
    expect(ics.headers["content-type"]).toContain("text/calendar");
    expect(ics.text).toContain("SUMMARY:Cardiology — Dr. Patel");
    expect(ics.text).toContain("BEGIN:VEVENT");

    const forged = await h.request.get(`/api/care-events/${eventId}/ics?t=deadbeefdeadbeefdeadbeefdeadbeef`);
    expect(forged.status).toBe(403);
  });

  test("parse endpoint degrades gracefully with no AI key (client falls back to the form)", async () => {
    const res = await h.request.post("/api/care-events/parse")
      .set(h.auth(family.token)).send({ text: "Dr. Patel Tuesday 2pm", tz: TZ });
    expect(res.status).toBe(503);
    expect(res.body.parsed).toBe(null);
  });

  test("rescheduling re-arms reminders; same-date edits don't", async () => {
    await h.db.prepare("UPDATE care_events SET reminders_sent = 'day_before' WHERE id = ?").run(eventId);

    const sameDate = await h.request.put(`/api/care-events/${eventId}`)
      .set(h.auth(family.token)).send({ location: "Different wing" });
    expect(sameDate.status).toBe(200);
    let row = await h.db.prepare("SELECT reminders_sent FROM care_events WHERE id = ?").get(eventId);
    expect(row.reminders_sent).toBe("day_before");

    const { date } = etDateTime(4 * 24 * 3600000);
    const moved = await h.request.put(`/api/care-events/${eventId}`)
      .set(h.auth(family.token)).send({ event_date: date });
    expect(moved.status).toBe(200);
    row = await h.db.prepare("SELECT reminders_sent FROM care_events WHERE id = ?").get(eventId);
    expect(row.reminders_sent).toBe("");
  });

  test("poller sends the same-day nudge to FAMILY ONLY (caregiver gets nothing)", async () => {
    const { pollCareEvents } = require("../../src/routes/careEvents");
    // Event starting in 1h → inside the 2h same-day window right now.
    const { date, time } = etDateTime(60 * 60000);
    const create = await h.request.post("/api/care-events").set(h.auth(family.token)).send({
      care_recipient_id: recipientId, title: "Eye exam", category: "medical",
      event_date: date, event_time: time,
    });
    expect(create.status).toBe(201);
    const evId = create.body.event.id;

    const pushes = [];
    await pollCareEvents(async (uid, payload) => { pushes.push({ uid, payload }); });

    const mine = pushes.filter((p) => p.payload.data.eventId === evId);
    const ids = mine.map((p) => p.uid);
    expect(ids).toEqual(expect.arrayContaining([family.user.id, teamMember.user.id]));
    expect(ids).not.toContain(caregiver.user.id);
    expect(mine[0].payload.data.type).toBe("care_event");
    // v1.105.39 — the title used to be `Today: ${ev.title}`, which put "Eye exam" on every
    // family member's LOCK SCREEN. Pete: "no phi on lock screens." The notice now says
    // when and for whom; what it is for is one tap away inside the app.
    expect(mine[0].payload.title).toBe("Appointment today");
    expect(mine[0].payload.title).not.toContain("Eye exam");
    expect(mine[0].payload.body).not.toContain("Eye exam");
    expect(mine[0].payload.body).toContain("Tap for details");
    // …and the event id still travels in `data`, so the tap lands in the right place.
    expect(mine[0].payload.data.eventId).toBe(evId);

    const row = await h.db.prepare("SELECT reminders_sent FROM care_events WHERE id = ?").get(evId);
    expect(row.reminders_sent).toContain("same_day");

    // Second tick: nothing new — notices fire once.
    const again = [];
    await pollCareEvents(async (uid, payload) => { again.push({ uid, payload }); });
    expect(again.filter((p) => p.payload.data.eventId === evId)).toHaveLength(0);
  });

  test("all-day events round-trip (event_time null)", async () => {
    const { date } = etDateTime(3 * 24 * 3600000);
    const res = await h.request.post("/api/care-events").set(h.auth(family.token)).send({
      care_recipient_id: recipientId, title: "Peggy's birthday dinner", category: "social",
      event_date: date, event_time: null,
    });
    expect(res.status).toBe(201);
    expect(res.body.event.all_day).toBe(true);
    const ics = await h.request.get(res.body.event.ics_url);
    expect(ics.text).toContain("DTSTART;VALUE=DATE:");
  });

  test("soft delete removes it from feeds, keeps the row", async () => {
    const del = await h.request.delete(`/api/care-events/${eventId}`).set(h.auth(family.token));
    expect(del.status).toBe(200);
    const up = await h.request.get("/api/care-events/upcoming").set(h.auth(family.token));
    expect(up.body.events.find((e) => e.id === eventId)).toBeFalsy();
    const row = await h.db.prepare("SELECT is_active FROM care_events WHERE id = ?").get(eventId);
    expect(row.is_active).toBe(0);
  });
});
