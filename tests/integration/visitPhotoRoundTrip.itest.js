/**
 * A photo uploaded to a visit has to come back out. (v1.106.43)
 *
 * Pete, the morning after v1.106.38 shipped the missing renders: "Pictures uploaded to visits
 * are displaying. Shows an upload but just black box with an x."
 *
 * Every test in this repo about visit photos so far has asserted about the FLAG — that the
 * list says a photo exists, that a screen draws a thumbnail for it. Not one has fetched the
 * bytes back through the real route and checked they are an image. That gap is exactly the
 * shape of "it shows an upload and then nothing loads": the flag is right and the read is
 * broken, and no test can tell.
 *
 * So this file is the round trip, end to end, for both photo paths a family uses: a visit
 * logged with pictures, and a care note with one.
 */
const { startHarness, stopHarness } = require("./harness");
const { v4: uuid } = require("uuid");

jest.setTimeout(180000);

const ROUTERS = {
  "/api/family-visits": "../../src/routes/familyVisits",
  "/api/notes": "../../src/routes/notes",
};

// Real bytes, not a placeholder: sendStoredFile checks magic bytes against the claimed mime
// and answers 404 when they disagree, so a fake payload would fail for the wrong reason.
const JPEG_1PX =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsL" +
  "DBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAAB" +
  "AAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";
const PNG_1PX =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

let h, family, recipientId;

beforeAll(async () => {
  h = await startHarness({ routers: ROUTERS });
  family = await h.createUser({ roles: ["family"], firstName: "Pete" });
  ({ recipientId } = await h.createCareTeam({ familyUserId: family.user.id }));
});

afterAll(async () => { await stopHarness(h); });

const logVisit = (body) =>
  h.request.post("/api/family-visits").set(h.auth(family.token))
    .send({ careRecipientId: recipientId, summary: "Dropped in.", ...body });

const getPhoto = (path) => h.request.get(path).set(h.auth(family.token));

describe("a visit logged with one picture", () => {
  let visitId;

  beforeAll(async () => {
    const res = await logVisit({ photo: JPEG_1PX });
    expect(res.status).toBe(201);
    visitId = res.body.visit ? res.body.visit.id : res.body.id;
    expect(visitId).toBeTruthy();
  });

  test("the feed says it has a photo", async () => {
    const res = await h.request.get(`/api/family-visits/${recipientId}`).set(h.auth(family.token));
    expect(res.status).toBe(200);
    const v = res.body.visits.find((x) => x.id === visitId);
    expect(v.hasPhoto).toBe(true);
    expect(v.photoCount).toBe(1);
  });

  test("...and the bytes actually come back", async () => {
    const res = await getPhoto(`/api/family-visits/${visitId}/photo`);
    expect(res.status).toBe(200);
    expect(String(res.headers["content-type"])).toContain("image/jpeg");
    expect(res.body.length).toBeGreaterThan(50);
  });

  test("they are a real JPEG, not an error page with a 200 on it", async () => {
    const res = await getPhoto(`/api/family-visits/${visitId}/photo`);
    // SOI marker. A JSON error body or an HTML page would sail past a status check.
    expect(res.body[0]).toBe(0xff);
    expect(res.body[1]).toBe(0xd8);
  });

  test("index 1 of a one-photo visit is 404, not a broken image", async () => {
    expect((await getPhoto(`/api/family-visits/${visitId}/photo/1`)).status).toBe(404);
  });
});

describe("a visit logged with several", () => {
  let visitId;

  beforeAll(async () => {
    const res = await logVisit({ photos: [JPEG_1PX, PNG_1PX, JPEG_1PX] });
    expect(res.status).toBe(201);
    visitId = res.body.visit ? res.body.visit.id : res.body.id;
  });

  test("the count is what the feed promises the client it can fetch", async () => {
    const res = await h.request.get(`/api/family-visits/${recipientId}`).set(h.auth(family.token));
    const v = res.body.visits.find((x) => x.id === visitId);
    expect(v.photoCount).toBe(3);
  });

  test("every index the count promises returns an image", async () => {
    // The thumbnails are built from photoCount, so an index that 404s is a broken tile on
    // the family's screen — which is exactly what a "black box" is.
    for (let i = 0; i < 3; i++) {
      const path = i === 0
        ? `/api/family-visits/${visitId}/photo`
        : `/api/family-visits/${visitId}/photo/${i}`;
      const res = await getPhoto(path);
      expect([path, res.status]).toEqual([path, 200]);
      expect([path, String(res.headers["content-type"]).slice(0, 5)]).toEqual([path, "image"]);
    }
  });

  test("the second one kept its own type — a PNG is not served as a JPEG", async () => {
    const res = await getPhoto(`/api/family-visits/${visitId}/photo/1`);
    expect(String(res.headers["content-type"])).toContain("image/png");
    expect(res.body.slice(1, 4).toString()).toBe("PNG");
  });

  test("one past the end is 404", async () => {
    expect((await getPhoto(`/api/family-visits/${visitId}/photo/3`)).status).toBe(404);
  });
});

describe("a care note with a picture", () => {
  let noteId;

  beforeAll(async () => {
    const res = await h.request.post("/api/notes").set(h.auth(family.token)).send({
      careRecipientId: recipientId, content: "Her foot looks worse.", noteType: "general", photo: JPEG_1PX,
    });
    expect(res.status).toBe(201);
    noteId = res.body.note ? res.body.note.id : res.body.id;
  });

  test("the bytes come back as an image", async () => {
    const res = await getPhoto(`/api/notes/${noteId}/photo`);
    expect(res.status).toBe(200);
    expect(String(res.headers["content-type"])).toContain("image/jpeg");
    expect(res.body[0]).toBe(0xff);
  });
});

describe("what happens when the blob cannot be fetched", () => {
  // The production difference this file cannot otherwise reach: since v1.106.8 a photo may be
  // stored in R2 and the column holds an `r2:<key>` marker instead of the bytes. If that read
  // fails — credentials rotated, bucket renamed, the object never written — resolveFileData
  // throws, and the route turns it into a 500. The client shows a black viewer and an error.
  //
  // A 500 is the wrong answer AND the wrong story: it reads as "the server is broken" when
  // the truth is "this one picture is not where the database says it is". Simulated by
  // pointing a row at a marker whose object cannot exist.
  let visitId;

  beforeAll(async () => {
    const res = await logVisit({ photo: JPEG_1PX });
    visitId = res.body.visit ? res.body.visit.id : res.body.id;
    await h.db.prepare("UPDATE family_visits SET photo = 'r2:uploads/family-visit/does-not-exist.jpg', photos = NULL WHERE id = ?")
      .run(visitId);
  });

  test("the feed still says there is a photo — the row is intact", async () => {
    const res = await h.request.get(`/api/family-visits/${recipientId}`).set(h.auth(family.token));
    expect(res.body.visits.find((x) => x.id === visitId).hasPhoto).toBe(true);
  });

  test("the read answers 404, not 500 — a missing object is missing, not an outage", async () => {
    const res = await getPhoto(`/api/family-visits/${visitId}/photo`);
    expect(res.status).toBe(404);
  });

  test("the same for a note photo", async () => {
    const r = await h.request.post("/api/notes").set(h.auth(family.token)).send({
      careRecipientId: recipientId, content: "x", noteType: "general", photo: JPEG_1PX,
    });
    const id = r.body.note ? r.body.note.id : r.body.id;
    await h.db.prepare("UPDATE recipient_notes SET photo = 'r2:uploads/note-photo/gone.jpg' WHERE id = ?").run(id);
    expect((await getPhoto(`/api/notes/${id}/photo`)).status).toBe(404);
  });
});
