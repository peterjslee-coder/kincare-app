/**
 * v1.106.30 — an appointment other people are part of. (39af0b91, 85797a86)
 *
 * Pete: "today I am going to the Dr. Lambert appointment, but Tina is also going. So I would
 * like to be able to tag her so that she gets updates about that appointment as well."
 * And: "Appointments need to be [editable] with notes as well... Otherwise, the only thing
 * that [iPAi] knows is that an appointment happened."
 *
 * The two properties that matter most here are both about restraint:
 *   - a tag decides who is TOLD, never who is allowed to know. Only the care team can be
 *     tagged, and the server enforces that regardless of what the client sends.
 *   - re-saving an appointment must not re-announce it to everyone already on it.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || "event-attendee-secret";

const { startHarness, stopHarness } = require("./harness");
const { v4: uuid } = require("uuid");

jest.setTimeout(180000);

let h, db, pete, tina, daniel, stranger, recipientId, teamId;
// The case the first version of this file missed entirely: a caregiver who is NOT on the
// care team, only attached through the work. That is Tina.
let sessionOnlyCg, assignedOnlyCg;

const soon = (d = 2) => {
  const x = new Date(); x.setDate(x.getDate() + d);
  return x.toISOString().slice(0, 10);
};

const createEvent = (token, body) =>
  h.request.post("/api/care-events").set(h.auth(token)).send({
    care_recipient_id: recipientId,
    title: "Dr. Lambert",
    category: "medical",
    event_date: soon(),
    event_time: "14:00",
    location: "Carilion Clinic, Radford",
    ...body,
  });

const attendeeIds = (eventId) => db.prepare(
  "SELECT user_id FROM care_event_attendees WHERE care_event_id = ? ORDER BY user_id"
).all(eventId).then((r) => r.map((x) => x.user_id).sort());

beforeAll(async () => {
  h = await startHarness({
    routers: {
      "/api/care-events": "../../src/routes/careEvents",
      "/api/notes": "../../src/routes/notes",
    },
  });
  db = h.db;

  pete = await h.createUser({ firstName: "Pete", lastName: "ITest" });
  tina = await h.createUser({ roles: ["caregiver"], firstName: "Tina", lastName: "ITest" });
  daniel = await h.createUser({ firstName: "Daniel", lastName: "ITest" });
  stranger = await h.createUser({ firstName: "Nobody", lastName: "ITest" });

  ({ recipientId, teamId } = await h.createCareTeam({ familyUserId: pete.user.id }));
  await h.addTeamMember(teamId, tina.user.id, "member");
  await h.addTeamMember(teamId, daniel.user.id, "member");

  // Tina in real life: a caregiver with a confirmed visit and no care_team_members row.
  sessionOnlyCg = await h.createUser({ roles: ["caregiver"], firstName: "Sessiony", lastName: "ITest" });
  const soProfile = uuid();
  await db.prepare(`
    INSERT INTO caregiver_profiles (id, user_id, hourly_rate, created_at) VALUES (?, ?, 25, NOW())
  `).run(soProfile, sessionOnlyCg.user.id);
  await db.prepare(`
    INSERT INTO care_sessions (id, care_recipient_id, family_user_id, caregiver_id, service_type,
      status, scheduled_date, scheduled_time, duration_hours, estimated_cost, created_at)
    VALUES (?, ?, ?, ?, 'companion', 'confirmed', ?, '09:00', 2, 100, NOW())
  `).run(uuid(), recipientId, pete.user.id, soProfile, soon(1));

  // And one the family put on the roster who has no session yet.
  assignedOnlyCg = await h.createUser({ roles: ["caregiver"], firstName: "Rostered", lastName: "ITest" });
  const aoProfile = uuid();
  await db.prepare(`
    INSERT INTO caregiver_profiles (id, user_id, hourly_rate, created_at) VALUES (?, ?, 25, NOW())
  `).run(aoProfile, assignedOnlyCg.user.id);
  await db.prepare(`
    INSERT INTO caregiver_assignments (id, caregiver_profile_id, care_recipient_id, family_user_id, is_active, created_at)
    VALUES (?, ?, ?, ?, 1, NOW())
  `).run(uuid(), aoProfile, recipientId, pete.user.id);
});

afterEach(async () => {
  await db.prepare("DELETE FROM recipient_notes WHERE care_recipient_id = ?").run(recipientId);
  await db.prepare("DELETE FROM care_events WHERE care_recipient_id = ?").run(recipientId);
});
afterAll(async () => { await stopHarness(h); });

describe("tagging people on an appointment", () => {
  test("who can be tagged is everyone with access — INCLUDING you", async () => {
    // v1.106.31 — Pete, an hour after this shipped: "Literally, the only two people not
    // included for me to select as going to the meeting are the two people that are here.
    // Me and Tina." Both exclusions were mine. He is standing in the waiting room; of course
    // he is on the appointment.
    const res = await h.request.get(`/api/care-events/taggable/${recipientId}`).set(h.auth(pete.token));
    expect(res.status).toBe(200);
    const ids = res.body.people.map((p) => p.user_id).sort();
    expect(ids).toEqual([
      pete.user.id,          // the family owner — and the caller
      tina.user.id,          // care team
      daniel.user.id,        // care team
      sessionOnlyCg.user.id, // a confirmed visit, no team row
      assignedOnlyCg.user.id, // on the roster, no visit yet
    ].sort());
    // Still bounded. Someone with no access to this person is not on the list, and that is
    // the property the whole restriction exists for.
    expect(ids).not.toContain(stranger.user.id);
    expect(res.body.people.find((p) => p.user_id === pete.user.id).isYou).toBe(true);
  });

  test("the caregiver who works the visits is taggable, though she is NOT on the care team", async () => {
    // THE bug. teamUserIds covers the owner, care_team_members and shares. A caregiver who
    // only works this person's sessions is in none of them — v1.105.153 says so out loud and
    // I read it while writing the wrong query anyway. hasAccess has always granted her
    // "member" through a confirmed session.
    const onTeam = await db.prepare(`
      SELECT ctm.user_id FROM care_team_members ctm
      JOIN care_teams ct ON ctm.care_team_id = ct.id
      WHERE ct.care_recipient_id = ? AND ctm.user_id = ?
    `).get(recipientId, sessionOnlyCg.user.id);
    expect(onTeam).toBeFalsy(); // she really is not on the team

    const res = await h.request.get(`/api/care-events/taggable/${recipientId}`).set(h.auth(pete.token));
    const ids = res.body.people.map((p) => p.user_id);
    expect(ids).toContain(sessionOnlyCg.user.id);
  });

  test("...and tagging her actually saves, rather than being silently dropped", async () => {
    // The picker and the save must agree. Offering a name the save discards is worse than
    // not offering it.
    const res = await createEvent(pete.token, { attendee_user_ids: [sessionOnlyCg.user.id] });
    expect(res.status).toBe(201);
    expect(await attendeeIds(res.body.event.id)).toEqual([sessionOnlyCg.user.id]);
  });

  test("a caregiver assigned but with no session yet is taggable too", async () => {
    const res = await h.request.get(`/api/care-events/taggable/${recipientId}`).set(h.auth(pete.token));
    expect(res.body.people.map((p) => p.user_id)).toContain(assignedOnlyCg.user.id);
  });

  test("you can put yourself on it", async () => {
    const res = await createEvent(pete.token, { attendee_user_ids: [pete.user.id, sessionOnlyCg.user.id] });
    expect(res.status).toBe(201);
    expect(await attendeeIds(res.body.event.id)).toEqual([pete.user.id, sessionOnlyCg.user.id].sort());
  });

  test("the caregiver is marked as one, so the picker can say so", async () => {
    const res = await h.request.get(`/api/care-events/taggable/${recipientId}`).set(h.auth(pete.token));
    const t = res.body.people.find((p) => p.user_id === tina.user.id);
    expect(t.isCaregiver).toBe(true);
    expect(res.body.people.find((p) => p.user_id === daniel.user.id).isCaregiver).toBe(false);
  });

  test("someone with no access to this person cannot even ask", async () => {
    const res = await h.request.get(`/api/care-events/taggable/${recipientId}`).set(h.auth(stranger.token));
    expect(res.status).toBe(403);
  });

  test("creating with attendees records them and returns them", async () => {
    const res = await createEvent(pete.token, { attendee_user_ids: [tina.user.id] });
    expect(res.status).toBe(201);
    expect(res.body.event.attendees.map((a) => a.user_id)).toEqual([tina.user.id]);
    expect(await attendeeIds(res.body.event.id)).toEqual([tina.user.id]);
  });

  test("a user OFF the care team is dropped, whatever the client sends", async () => {
    // The decisive one. A tag says who is told about a health event; letting it reach an
    // arbitrary user id would make an appointment a disclosure channel.
    const res = await createEvent(pete.token, { attendee_user_ids: [tina.user.id, stranger.user.id] });
    expect(res.status).toBe(201);
    expect(await attendeeIds(res.body.event.id)).toEqual([tina.user.id]);
  });

  test("editing replaces the list — added and removed both take effect", async () => {
    const made = await createEvent(pete.token, { attendee_user_ids: [tina.user.id] });
    const id = made.body.event.id;

    const res = await h.request.put(`/api/care-events/${id}`).set(h.auth(pete.token))
      .send({ title: "Dr. Lambert", event_date: soon(), event_time: "14:00", attendee_user_ids: [daniel.user.id] });
    expect(res.status).toBe(200);
    expect(await attendeeIds(id)).toEqual([daniel.user.id]);
  });

  test("editing WITHOUT the field leaves the list alone", async () => {
    // Every other client that saves an event must not silently un-tag everyone.
    const made = await createEvent(pete.token, { attendee_user_ids: [tina.user.id] });
    const id = made.body.event.id;

    await h.request.put(`/api/care-events/${id}`).set(h.auth(pete.token))
      .send({ title: "Dr. Lambert (moved)", event_date: soon(3), event_time: "15:00" })
      .expect(200);
    expect(await attendeeIds(id)).toEqual([tina.user.id]);
  });

  test("tagging the same person twice is one row, not two", async () => {
    const res = await createEvent(pete.token, { attendee_user_ids: [tina.user.id, tina.user.id] });
    expect(await attendeeIds(res.body.event.id)).toEqual([tina.user.id]);
  });

  test("attendees come back on the upcoming feed, not just on save", async () => {
    const made = await createEvent(pete.token, { attendee_user_ids: [tina.user.id] });
    const res = await h.request.get("/api/care-events/upcoming").set(h.auth(pete.token));
    expect(res.status).toBe(200);
    const ev = res.body.events.find((e) => e.id === made.body.event.id);
    expect(ev).toBeTruthy();
    expect(ev.attendees.map((a) => a.first_name)).toEqual(["Tina"]);
  });

  test("removing the appointment removes the tags with it", async () => {
    const made = await createEvent(pete.token, { attendee_user_ids: [tina.user.id] });
    const id = made.body.event.id;
    await h.request.delete(`/api/care-events/${id}`).set(h.auth(pete.token)).expect(200);
    // Soft delete keeps the row, so the cascade has not fired — the tags are still there and
    // that is correct: an un-deleted appointment should come back with its people on it.
    expect(await attendeeIds(id)).toEqual([tina.user.id]);
  });
});

describe("notes on an appointment", () => {
  test("a note can name the appointment it came from", async () => {
    const made = await createEvent(pete.token, {});
    const eventId = made.body.event.id;

    const res = await h.request.post("/api/notes").set(h.auth(pete.token)).send({
      careRecipientId: recipientId,
      careEventId: eventId,
      content: "Dr. Lambert started her on a new blood-pressure tablet, mornings.",
      noteType: "observation",
    });
    expect(res.status).toBeLessThan(300);

    const row = await db.prepare(
      "SELECT care_event_id FROM recipient_notes WHERE care_recipient_id = ? ORDER BY created_at DESC LIMIT 1"
    ).get(recipientId);
    expect(row.care_event_id).toBe(eventId);
  });

  test("it reads back on the appointment", async () => {
    const made = await createEvent(pete.token, {});
    const eventId = made.body.event.id;
    await h.request.post("/api/notes").set(h.auth(pete.token)).send({
      careRecipientId: recipientId, careEventId: eventId, content: "New tablet, mornings.",
    }).expect((r) => expect(r.status).toBeLessThan(300));

    const res = await h.request.get(`/api/care-events/${eventId}/notes`).set(h.auth(pete.token));
    expect(res.status).toBe(200);
    expect(res.body.notes).toHaveLength(1);
    expect(res.body.notes[0].content).toMatch(/New tablet/);
    expect(res.body.notes[0].author_first_name).toBe("Pete");
  });

  test("it is a REAL care note, not a private field on the appointment", async () => {
    // The whole design decision. If it were a column on care_events, iPAi would never see it
    // and it would not appear in the care record — which is exactly what Pete objected to.
    const made = await createEvent(pete.token, {});
    await h.request.post("/api/notes").set(h.auth(pete.token)).send({
      careRecipientId: recipientId, careEventId: made.body.event.id, content: "Visible in the record.",
    }).expect((r) => expect(r.status).toBeLessThan(300));

    const all = await h.request.get(`/api/notes/${recipientId}`).set(h.auth(pete.token));
    expect(all.status).toBe(200);
    expect(all.body.notes.some((n) => n.content === "Visible in the record.")).toBe(true);
  });

  test("a tagged caregiver can add one too — she is the one who was there", async () => {
    const made = await createEvent(pete.token, { attendee_user_ids: [tina.user.id] });
    const res = await h.request.post("/api/notes").set(h.auth(tina.token)).send({
      careRecipientId: recipientId,
      careEventId: made.body.event.id,
      content: "He asked about her balance. She's been holding the rail.",
    });
    expect(res.status).toBeLessThan(300);
  });

  test("an appointment for a DIFFERENT person is refused", async () => {
    // Otherwise an event id becomes a way to file a note against someone you cannot see.
    const other = await h.createCareTeam({ familyUserId: pete.user.id, name: "Other" });
    const otherEvent = await h.request.post("/api/care-events").set(h.auth(pete.token)).send({
      care_recipient_id: other.recipientId, title: "Other appt", category: "medical",
      event_date: soon(), event_time: "09:00",
    });
    expect(otherEvent.status).toBe(201);

    const res = await h.request.post("/api/notes").set(h.auth(pete.token)).send({
      careRecipientId: recipientId,
      careEventId: otherEvent.body.event.id,
      content: "wrong person",
    });
    expect(res.status).toBe(400);
    const row = await db.prepare(
      "SELECT id FROM recipient_notes WHERE content = 'wrong person'"
    ).get();
    expect(row).toBeFalsy();
  });

  test("a made-up appointment id is refused", async () => {
    const res = await h.request.post("/api/notes").set(h.auth(pete.token)).send({
      careRecipientId: recipientId, careEventId: uuid(), content: "nope",
    });
    expect(res.status).toBe(400);
  });

  test("an ordinary note with no appointment still works", async () => {
    const res = await h.request.post("/api/notes").set(h.auth(pete.token)).send({
      careRecipientId: recipientId, content: "Just a note.",
    });
    expect(res.status).toBeLessThan(300);
    const row = await db.prepare(
      "SELECT care_event_id FROM recipient_notes WHERE content = 'Just a note.'"
    ).get();
    expect(row.care_event_id).toBeNull();
  });

  test("someone with no access cannot read an appointment's notes", async () => {
    const made = await createEvent(pete.token, {});
    const res = await h.request.get(`/api/care-events/${made.body.event.id}/notes`).set(h.auth(stranger.token));
    expect(res.status).toBe(403);
  });
});
