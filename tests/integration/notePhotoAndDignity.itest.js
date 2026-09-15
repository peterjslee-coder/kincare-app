/**
 * The picture, and who is allowed to see the words. (v1.106.38)
 *
 * Pete: "Added a picture to a visit note today and it doesn't show up."
 *
 * It had shown up nowhere except the family Care Profile, and chasing that turned up a
 * second thing nobody had reported. Both live in the same place — what a notes query
 * SELECTs and who it SELECTs for — so they are proved together:
 *
 *  1. Every notes feed must tell the client a photo exists. The blob is never in the list
 *     (5MB a row), only the flag; the client fetches /:id/photo per thumbnail. A feed that
 *     omits the flag cannot draw the picture no matter what the screen does, which is why
 *     three of four screens silently dropped it.
 *
 *  2. The care-for dashboard — the linked care recipient's OWN screen — served her every
 *     row with `SELECT rn.*` and no visibility filter, including the observations her
 *     family wrote about her. GET /api/notes/:careRecipientId has refused to show her
 *     those since v1.76.0 ("candor vs. dignity"). Same record, same person, two screens,
 *     two answers — because the rule was written out longhand in one route and simply
 *     absent from the other. It now comes from utils/noteVisibility for both.
 *
 * Integration, not unit: the whole claim is about what a real query returns for a real
 * reader. A mocked db would return whatever the mock was told to.
 */
const { startHarness, stopHarness } = require("./harness");

jest.setTimeout(180000);

const ROUTERS = {
  "/api/notes": "../../src/routes/notes",
  "/api/dashboard": "../../src/routes/dashboard",
};

// A 1x1 JPEG — small, and real enough to clear the magic-byte check in POST /api/notes.
const JPEG_1PX =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsL" +
  "DBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAAB" +
  "AAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

let h, family, betty, recipientId;

beforeAll(async () => {
  h = await startHarness({ routers: ROUTERS });
  family = await h.createUser({ roles: ["family"], firstName: "Pete" });
  // Betty has her own login and is LINKED to the record her son owns. That is the shape the
  // rule is about: the record is about her, but it is not hers to own.
  betty = await h.createUser({ roles: ["care_for"], firstName: "Betty" });
  const t = await h.createCareTeam({ familyUserId: family.user.id });
  recipientId = t.recipientId;
  await h.db.prepare("UPDATE care_recipients SET linked_user_id = ? WHERE id = ?")
    .run(betty.user.id, recipientId);
});

afterAll(async () => { await stopHarness(h); });

const postNote = async (who, body) => {
  const res = await h.request.post("/api/notes").set(h.auth(who.token))
    .send({ careRecipientId: recipientId, ...body });
  return res;
};

const notesFor = async (who) => {
  const res = await h.request.get(`/api/notes/${recipientId}`).set(h.auth(who.token));
  expect(res.status).toBe(200);
  return res.body.notes || [];
};

const dashboardFor = async (who) => {
  const res = await h.request.get("/api/dashboard").set(h.auth(who.token));
  expect(res.status).toBe(200);
  return res.body;
};

describe("a photo on a note is announced to every feed", () => {
  let withPhoto, withoutPhoto;

  beforeAll(async () => {
    const a = await postNote(family, { content: "Her left foot is swollen again.", noteType: "general", photo: JPEG_1PX });
    expect(a.status).toBe(201);
    withPhoto = a.body.note ? a.body.note.id : a.body.id;
    const b = await postNote(family, { content: "Ate a full lunch.", noteType: "general" });
    expect(b.status).toBe(201);
    withoutPhoto = b.body.note ? b.body.note.id : b.body.id;
    expect(withPhoto).toBeTruthy();
    expect(withoutPhoto).toBeTruthy();
  });

  test("the photo was actually stored — the flag is not measuring an empty column", async () => {
    const row = await h.db.prepare("SELECT photo FROM recipient_notes WHERE id = ?").get(withPhoto);
    expect(row.photo).toBeTruthy();
    expect(String(row.photo).length).toBeGreaterThan(20);
  });

  test("GET /api/notes/:careRecipientId flags the one with a photo, and only that one", async () => {
    const list = await notesFor(family);
    const a = list.find((n) => n.id === withPhoto);
    const b = list.find((n) => n.id === withoutPhoto);
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a.has_photo === true || a.has_photo === 1).toBe(true);
    expect(b.has_photo === true || b.has_photo === 1).toBe(false);
  });

  test("the list carries the flag and NEVER the blob — a 50-note feed is not 250MB", async () => {
    const list = await notesFor(family);
    const a = list.find((n) => n.id === withPhoto);
    expect(a.photo).toBeUndefined();
    expect(JSON.stringify(a)).not.toContain("base64");
  });

  test("the care-for dashboard flags it too — it is her own record", async () => {
    const d = await dashboardFor(betty);
    const a = (d.notes || []).find((n) => n.id === withPhoto);
    const b = (d.notes || []).find((n) => n.id === withoutPhoto);
    expect(a).toBeTruthy();
    expect(a.hasPhoto).toBe(true);
    expect(b.hasPhoto).toBe(false);
  });

  test("the care-for dashboard does not ship the blob either", async () => {
    const d = await dashboardFor(betty);
    const a = (d.notes || []).find((n) => n.id === withPhoto);
    expect(a.photo).toBeUndefined();
    expect(JSON.stringify(d.notes)).not.toContain("base64");
  });

  // The test above is about the RESPONSE, and it passes either way — the shaper names its
  // fields, so `SELECT rn.*` never reached the client even before this change. The waste was
  // upstream of it: Postgres read every `photo` column and shipped it to Node, once per note,
  // on every load of this dashboard, for a value that was then dropped. Nothing about the
  // response can see that, so this one reads the query.
  test("...and never asks Postgres for the column in the first place", () => {
    const src = require("../helpers/source").code("src/routes/dashboard.js");
    const m = src.match(/SELECT[^;]*?FROM\s+recipient_notes\s+rn/i);
    expect(m).toBeTruthy();                       // the query is still there to check
    expect(m[0]).not.toMatch(/\brn\.\*/);          // …and does not drag the blob along
    expect(m[0]).toMatch(/rn\.photo IS NOT NULL/);  // just the flag
  });

  test("the photo itself is served, to someone allowed to see the note", async () => {
    const res = await h.request.get(`/api/notes/${withPhoto}/photo`).set(h.auth(family.token));
    expect(res.status).toBe(200);
    expect(String(res.headers["content-type"])).toContain("image/jpeg");
  });
});

describe("what Betty is shown about herself", () => {
  let observation, general, hers;

  beforeAll(async () => {
    const a = await postNote(family, {
      content: "She repeated the same story four times tonight and did not notice.",
      noteType: "observation",
    });
    expect(a.status).toBe(201);
    observation = a.body.note ? a.body.note.id : a.body.id;

    const b = await postNote(family, { content: "Pharmacy refill picked up.", noteType: "general" });
    expect(b.status).toBe(201);
    general = b.body.note ? b.body.note.id : b.body.id;

    const c = await postNote(betty, { content: "I slept badly.", noteType: "observation" });
    expect(c.status).toBe(201);
    hers = c.body.note ? c.body.note.id : c.body.id;
  });

  test("the notes endpoint hides her family's observation from her — the rule as it stood", async () => {
    const ids = (await notesFor(betty)).map((n) => n.id);
    expect(ids).not.toContain(observation);
  });

  test("the care-for DASHBOARD hides it too — this is the copy that did not", async () => {
    const d = await dashboardFor(betty);
    const ids = (d.notes || []).map((n) => n.id);
    expect(ids).not.toContain(observation);
  });

  test("she still sees general notes on her own dashboard", async () => {
    const d = await dashboardFor(betty);
    expect((d.notes || []).map((n) => n.id)).toContain(general);
  });

  test("she still sees the observations she wrote herself", async () => {
    const d = await dashboardFor(betty);
    expect((d.notes || []).map((n) => n.id)).toContain(hers);
  });

  test("the two screens agree — every id on her dashboard is one the notes endpoint gives her", async () => {
    const d = await dashboardFor(betty);
    const viaEndpoint = new Set((await notesFor(betty)).map((n) => n.id));
    const viaDashboard = (d.notes || []).map((n) => n.id);
    expect(viaDashboard.length).toBeGreaterThan(0);
    for (const id of viaDashboard) expect(viaEndpoint.has(id)).toBe(true);
  });

  test("her family still sees the observation — the filter is about her, not about the note", async () => {
    expect((await notesFor(family)).map((n) => n.id)).toContain(observation);
  });
});

describe('"self" is write-your-own, not edit-the-record', () => {
  let familyNote, bettyNote;

  beforeAll(async () => {
    const a = await postNote(family, { content: "Called the pharmacy about the refill.", noteType: "general" });
    familyNote = a.body.note ? a.body.note.id : a.body.id;
    const b = await postNote(betty, { content: "I walked to the mailbox.", noteType: "general" });
    bettyNote = b.body.note ? b.body.note.id : b.body.id;
  });

  test("she can write a note about herself at all — the button on her screen posted into a 403", async () => {
    expect(bettyNote).toBeTruthy();
    const row = await h.db.prepare("SELECT author_id FROM recipient_notes WHERE id = ?").get(bettyNote);
    expect(row.author_id).toBe(betty.user.id);
  });

  test("she can edit her own note", async () => {
    const res = await h.request.put(`/api/notes/${bettyNote}`).set(h.auth(betty.token))
      .send({ content: "I walked to the mailbox and back." });
    expect(res.status).toBe(200);
  });

  test("she cannot edit her family's note", async () => {
    const res = await h.request.put(`/api/notes/${familyNote}`).set(h.auth(betty.token))
      .send({ content: "no" });
    expect(res.status).toBe(403);
    const row = await h.db.prepare("SELECT content FROM recipient_notes WHERE id = ?").get(familyNote);
    expect(row.content).toBe("Called the pharmacy about the refill.");
  });

  test("she cannot delete her family's note", async () => {
    const res = await h.request.delete(`/api/notes/${familyNote}`).set(h.auth(betty.token));
    expect(res.status).toBe(403);
    const row = await h.db.prepare("SELECT id FROM recipient_notes WHERE id = ?").get(familyNote);
    expect(row).toBeTruthy();
  });

  test("she can delete her own", async () => {
    const res = await h.request.delete(`/api/notes/${bettyNote}`).set(h.auth(betty.token));
    expect(res.status).toBe(200);
  });
});

describe("the photo obeys the same rule as the words", () => {
  // The bug this covers: /:id/photo carried its own copy of the visibility rule, and that
  // copy only knew about the linked recipient. A view-only caregiver who was correctly
  // refused an observation in the LIST could still fetch the photo hanging off it, by id.
  let caregiver, observationPhoto, generalPhoto;

  beforeAll(async () => {
    caregiver = await h.createUser({ roles: ["caregiver"], firstName: "Maria" });
    // View-only access: a confirmed session, no team seat, no share. That is the branch of
    // hasAccess that returns "view" and the one noteVisibility calls `caregiverOnly`.
    const cpId = require("uuid").v4();
    await h.db.prepare(`
      INSERT INTO caregiver_profiles (id, user_id, hourly_rate, created_at) VALUES (?, ?, 25, NOW())
    `).run(cpId, caregiver.user.id);
    await h.db.prepare(`
      INSERT INTO care_sessions (id, care_recipient_id, caregiver_id, family_user_id, scheduled_date,
                                 scheduled_time, duration_hours, service_type, status, created_at)
      VALUES (?, ?, ?, ?, '2026-09-20', '09:00', 2, 'companion', 'confirmed', NOW())
    `).run(require("uuid").v4(), recipientId, cpId, family.user.id);

    const a = await postNote(family, {
      content: "She did not recognise me for the first few minutes.",
      noteType: "observation", photo: JPEG_1PX,
    });
    expect(a.status).toBe(201);
    observationPhoto = a.body.note ? a.body.note.id : a.body.id;

    const b = await postNote(family, { content: "New walker delivered.", noteType: "general", photo: JPEG_1PX });
    expect(b.status).toBe(201);
    generalPhoto = b.body.note ? b.body.note.id : b.body.id;
  });

  test("the caregiver really does have view access — she is not being refused at the door", async () => {
    const res = await h.request.get(`/api/notes/${recipientId}`).set(h.auth(caregiver.token));
    expect(res.status).toBe(200);
  });

  test("the list refuses her the observation", async () => {
    const res = await h.request.get(`/api/notes/${recipientId}`).set(h.auth(caregiver.token));
    expect(res.body.notes.map((n) => n.id)).not.toContain(observationPhoto);
  });

  test("and now so does the photo on it", async () => {
    const res = await h.request.get(`/api/notes/${observationPhoto}/photo`).set(h.auth(caregiver.token));
    expect(res.status).toBe(404);
  });

  test("she still gets the photo on a note she IS shown — this is not a blanket refusal", async () => {
    const list = await h.request.get(`/api/notes/${recipientId}`).set(h.auth(caregiver.token));
    expect(list.body.notes.map((n) => n.id)).toContain(generalPhoto);
    const res = await h.request.get(`/api/notes/${generalPhoto}/photo`).set(h.auth(caregiver.token));
    expect(res.status).toBe(200);
  });

  test("Betty is refused the photo on her family's observation", async () => {
    const res = await h.request.get(`/api/notes/${observationPhoto}/photo`).set(h.auth(betty.token));
    expect(res.status).toBe(404);
  });

  test("the family owner gets both", async () => {
    for (const id of [observationPhoto, generalPhoto]) {
      const res = await h.request.get(`/api/notes/${id}/photo`).set(h.auth(family.token));
      expect(res.status).toBe(200);
    }
  });
});
