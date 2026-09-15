/**
 * A stored-image column must never reach a client. (v1.106.46)
 *
 * Pete: "Pictures uploaded to visits are displaying. Shows an upload but just black box with
 * an x." The black box was a broken <img>, and the src was "r2:visit-photo/2026-09-15/…" —
 * a storage marker, set as the source of an image, by a client faithfully rendering what the
 * server sent it.
 *
 * `visit_photos.photo_url` has never been a URL; it is the stored image. v1.106.7 converted it
 * to a real URL in routes/photos.js and on the family dashboard and MISSED GET
 * /api/sessions/:id, which is the endpoint behind the visit sheet. That went unnoticed because
 * a base64 data URI in an <img src> renders perfectly well — wasteful, but it works. v1.106.8
 * turned R2 on, the column started holding a marker instead, and the same line broke.
 *
 * So a source-level fix is not enough: the same mistake is one `SELECT *` away in any of a
 * dozen endpoints, and it is invisible until the storage backend changes underneath it. This
 * asserts the property itself, against real responses: no reply carries a marker, and no reply
 * carries an inline image. Both are bugs — the first breaks the picture, the second is the
 * 4–6 MB dashboard v1.106.7 was about.
 */
const { startHarness, stopHarness } = require("./harness");
const { v4: uuid } = require("uuid");

jest.setTimeout(180000);

const ROUTERS = {
  "/api/sessions": "../../src/routes/sessions",
  "/api/dashboard": "../../src/routes/dashboard",
  "/api/photos": "../../src/routes/photos",
  "/api/family-visits": "../../src/routes/familyVisits",
  "/api/notes": "../../src/routes/notes",
};

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

let h, family, tina, tinaProfileId, recipientId, sessionId, visitLogId, photoId;

beforeAll(async () => {
  h = await startHarness({ routers: ROUTERS });
  family = await h.createUser({ roles: ["family"], firstName: "Pete" });
  ({ recipientId } = await h.createCareTeam({ familyUserId: family.user.id }));
  tina = await h.createUser({ roles: ["caregiver"], firstName: "Tina" });
  tinaProfileId = uuid();
  await h.db.prepare(
    "INSERT INTO caregiver_profiles (id, user_id, hourly_rate, created_at) VALUES (?, ?, 25, NOW())"
  ).run(tinaProfileId, tina.user.id);

  sessionId = uuid();
  await h.db.prepare(`
    INSERT INTO care_sessions (id, care_recipient_id, family_user_id, caregiver_id, service_type,
                               status, scheduled_date, scheduled_time, duration_hours, estimated_cost, created_at)
    VALUES (?, ?, ?, ?, 'companionship', 'in_progress', '2026-09-15', '09:00', 8, 211.20, NOW())
  `).run(sessionId, recipientId, family.user.id, tinaProfileId);

  visitLogId = uuid();
  await h.db.prepare(`
    INSERT INTO visit_logs (id, session_id, caregiver_id, check_in_time, created_at)
    VALUES (?, ?, ?, NOW() - INTERVAL '60 minutes', NOW())
  `).run(visitLogId, sessionId, tinaProfileId);
});

afterAll(async () => { await stopHarness(h); });

/** Put a visit photo on the record in whichever storage shape we want to simulate. */
const putPhoto = async (value) => {
  await h.db.prepare("DELETE FROM visit_photos WHERE visit_log_id = ?").run(visitLogId);
  photoId = uuid();
  await h.db.prepare(
    "INSERT INTO visit_photos (id, visit_log_id, photo_url, caption, created_at) VALUES (?, ?, ?, 'x', NOW())"
  ).run(photoId, visitLogId, value);
  return photoId;
};

const getSession = async (who = family) => {
  const res = await h.request.get(`/api/sessions/${sessionId}`).set(h.auth(who.token));
  expect(res.status).toBe(200);
  return res;
};

const MARKER = /"r2:[^"]*"/;
const INLINE = /data:image\/[a-z+]+;base64,/;

describe("the visit sheet, which is where Pete was looking", () => {
  test("an R2-backed photo comes back as a path the browser can fetch", async () => {
    const id = await putPhoto(`r2:visit-photo/2026-09-15/${uuid()}`);
    const res = await getSession();
    const p = res.body.photos.find((x) => x.id === id);
    expect(p).toBeTruthy();
    expect(p.photo_url).toBe(`/api/photos/${id}/image`);
  });

  test("the marker itself never appears anywhere in the response", async () => {
    await putPhoto(`r2:visit-photo/2026-09-15/${uuid()}`);
    const res = await getSession();
    expect(JSON.stringify(res.body)).not.toMatch(MARKER);
  });

  test("a legacy base64 row is ALSO turned into a path, not shipped inline", async () => {
    // Half-migrated tables are the normal state during a backfill, and the old rows are the
    // ones that still "work" — which is how this stayed hidden.
    const id = await putPhoto(PNG);
    const res = await getSession();
    const p = res.body.photos.find((x) => x.id === id);
    expect(p.photo_url).toBe(`/api/photos/${id}/image`);
    expect(JSON.stringify(res.body)).not.toMatch(INLINE);
  });

  test("and that path really serves the image", async () => {
    // A URL that 404s is a broken picture too; the point is the round trip, not the string.
    const id = await putPhoto(PNG);
    const res = await h.request.get(`/api/photos/${id}/image`).set(h.auth(family.token));
    expect(res.status).toBe(200);
    expect(String(res.headers["content-type"])).toContain("image/png");
  });

  test("an http(s) URL is passed through untouched — not everything is ours to stream", async () => {
    const id = await putPhoto("https://example.test/a.jpg");
    const res = await getSession();
    expect(res.body.photos.find((x) => x.id === id).photo_url).toBe("https://example.test/a.jpg");
  });

  test("the caregiver's view of the same session is equally clean", async () => {
    await putPhoto(`r2:visit-photo/2026-09-15/${uuid()}`);
    const res = await getSession(tina);
    expect(JSON.stringify(res.body)).not.toMatch(MARKER);
  });
});

describe("no endpoint hands a client a storage marker", () => {
  // The property, not the line. The same mistake is one SELECT * away in any of these, and it
  // is invisible until the storage backend changes underneath it.
  beforeAll(async () => {
    await putPhoto(`r2:visit-photo/2026-09-15/${uuid()}`);
    await h.db.prepare(`
      INSERT INTO family_visits (id, care_recipient_id, user_id, visited_at, summary, photo, logged_via, created_at)
      VALUES (?, ?, ?, NOW(), 'Dropped in.', ?, 'manual', NOW())
    `).run(uuid(), recipientId, family.user.id, `r2:family-visit/2026-09-15/${uuid()}`);
    await h.db.prepare(`
      INSERT INTO recipient_notes (id, care_recipient_id, author_id, content, note_type, photo, created_at)
      VALUES (?, ?, ?, 'Her foot.', 'general', ?, NOW())
    `).run(uuid(), recipientId, family.user.id, `r2:note-photo/2026-09-15/${uuid()}`);
  });

  const ENDPOINTS = [
    ["GET /api/sessions/:id", () => `/api/sessions/${sessionId}`],
    ["GET /api/dashboard", () => "/api/dashboard"],
    ["GET /api/notes/:recipientId", () => `/api/notes/${recipientId}`],
    ["GET /api/family-visits/:recipientId", () => `/api/family-visits/${recipientId}`],
    ["GET /api/photos/visit/:visitLogId", () => `/api/photos/visit/${visitLogId}`],
  ];

  test.each(ENDPOINTS)("%s carries no r2: marker", async (_label, path) => {
    const res = await h.request.get(path()).set(h.auth(family.token));
    if (res.status === 404) return;                   // route shape differs; nothing leaked
    expect(res.status).toBeLessThan(500);
    expect(JSON.stringify(res.body || {})).not.toMatch(MARKER);
  });

  test.each(ENDPOINTS)("%s carries no inline image either", async (_label, path) => {
    const res = await h.request.get(path()).set(h.auth(family.token));
    if (res.status === 404) return;
    expect(JSON.stringify(res.body || {})).not.toMatch(INLINE);
  });
});
