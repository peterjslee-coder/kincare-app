/**
 * v1.105.111 — more than one photo per visit. (Pete, 40ad8896)
 *
 * A visit is often several things worth recording — the fridge, the pill organiser, her in
 * the garden — and one slot forced a choice between them.
 *
 * Run against a real database because the whole risk here is compatibility: `photos` is a new
 * column alongside `photo`, and every row written before today, plus every client that has
 * not reloaded, must keep working exactly as it did. That is not something source-matching
 * can show.
 */
const { startHarness, stopHarness } = require("./harness");
const { v4: uuid } = require("uuid");

jest.setTimeout(180000);

let h, db, user, recipientId;

// A real 1x1 PNG — the route checks magic bytes, so a fake string will not do.
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

beforeAll(async () => {
  h = await startHarness({ routers: { "/api/family-visits": "../../src/routes/familyVisits" } });
  db = h.db;
  user = await h.createUser({ firstName: "Pete", lastName: "Lee" });
  const team = await h.createCareTeam({ familyUserId: user.user.id });
  recipientId = team.recipientId;
});
afterAll(async () => { await stopHarness(h); });

const post = (body) =>
  h.request.post("/api/family-visits").set(h.auth(user.token))
    .send({ careRecipientId: recipientId, ...body });

describe("several photos on one visit", () => {
  let id;

  test("three are accepted", async () => {
    const res = await post({ summary: "Garden day", photos: [PNG, PNG, PNG] });
    expect(res.status).toBe(201);
    id = res.body.visit.id;
  });

  test("the feed reports how many, and never the blobs", async () => {
    const res = await h.request.get(`/api/family-visits/${recipientId}`).set(h.auth(user.token));
    const v = res.body.visits.find((x) => x.id === id);
    expect(v.photoCount).toBe(3);
    expect(v.hasPhoto).toBe(true);
    expect(JSON.stringify(v)).not.toContain("base64");
  });

  test("each one is reachable", async () => {
    for (const path of [`/api/family-visits/${id}/photo`, `/api/family-visits/${id}/photo/1`, `/api/family-visits/${id}/photo/2`]) {
      const r = await h.request.get(path).set(h.auth(user.token));
      expect(r.status).toBe(200);
      expect(r.headers["content-type"]).toContain("image/png");
    }
  });

  test("and one past the end is a 404, not a crash", async () => {
    expect((await h.request.get(`/api/family-visits/${id}/photo/3`).set(h.auth(user.token))).status).toBe(404);
    expect((await h.request.get(`/api/family-visits/${id}/photo/99`).set(h.auth(user.token))).status).toBe(404);
    expect((await h.request.get(`/api/family-visits/${id}/photo/abc`).set(h.auth(user.token))).status).toBe(404);
    expect((await h.request.get(`/api/family-visits/${id}/photo/-1`).set(h.auth(user.token))).status).toBe(404);
  });
});

describe("nothing written before today breaks", () => {
  let legacyId;

  beforeAll(async () => {
    // Exactly the shape v1.105.74 wrote: `photo` set, `photos` NULL.
    legacyId = uuid();
    await db.prepare(`
      INSERT INTO family_visits (id, care_recipient_id, user_id, visited_at, summary, activities, logged_via, photo, created_at, updated_at)
      VALUES (?, ?, ?, NOW(), 'Old visit', '[]', 'manual', ?, NOW(), NOW())
    `).run(legacyId, recipientId, user.user.id, PNG);
  });

  test("a one-photo row reads as one photo, not as broken", async () => {
    const res = await h.request.get(`/api/family-visits/${recipientId}`).set(h.auth(user.token));
    const v = res.body.visits.find((x) => x.id === legacyId);
    expect(v.hasPhoto).toBe(true);
    expect(v.photoCount).toBe(1);
  });

  test("and /photo still answers for it", async () => {
    const r = await h.request.get(`/api/family-visits/${legacyId}/photo`).set(h.auth(user.token));
    expect(r.status).toBe(200);
  });

  test("a client still sending a single `photo` is still accepted", async () => {
    // An old bundle in someone's PWA does not know about `photos`.
    const res = await post({ summary: "From an old client", photo: PNG });
    expect(res.status).toBe(201);
    const r = await h.request.get(`/api/family-visits/${res.body.visit.id}/photo`).set(h.auth(user.token));
    expect(r.status).toBe(200);
  });
});

describe("the caps hold", () => {
  test("more than four is refused, and says so", async () => {
    const res = await post({ summary: "Too many", photos: [PNG, PNG, PNG, PNG, PNG] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Up to 4 photos/);
  });

  test("a bad image in the set fails the whole set rather than being silently dropped", async () => {
    const res = await post({ summary: "One bad apple", photos: [PNG, "data:image/png;base64,bm90YW5pbWFnZQ=="] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/does not match its type|could not/i);
  });

  test("a non-list is refused", async () => {
    expect((await post({ summary: "Nope", photos: "not-a-list" })).status).toBe(400);
  });

  test("a photo alone is still a whole record", async () => {
    // v1.105.74's rule: the picture may be the entire point and typing is the friction.
    const res = await post({ photos: [PNG] });
    expect(res.status).toBe(201);
  });

  test("but nothing at all is still nothing", async () => {
    const res = await post({ photos: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/nothing to record/);
  });
});
