/**
 * v1.106.22 — uploading a photo has to satisfy the step that asks for a photo.
 *
 * Tina uploaded hers, saved, and the First Steps item stayed unticked. She reported it as
 * "distracting"; it was worse than that. Since v1.106.8 the upload writes `profile_photo` and
 * sets `avatar_url = NULL`, and three separate readers were still asking `avatar_url`:
 *
 *   - the First Steps checkbox                       (CaretakerHub.js)
 *   - the counter that auto-completes onboarding     (CaretakerHub.js — the real damage:
 *                                                     it can never reach 6, so onboarding
 *                                                     is never marked complete, ever)
 *   - the care-team thumbnails the family sees       (CareTeamManage.js)
 *
 * So the upload did not merely fail to help — it actively made the field the checkbox reads
 * emptier than before. Nobody who uploads a photo can finish onboarding.
 *
 * This test drives the two REAL endpoints in the order a caregiver hits them: upload, then
 * load the dashboard. It asserts the payload the client actually decides on, not the column.
 * Asserting the column would have passed all along — that is precisely the bug.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || "photo-step-secret";

const { startHarness, stopHarness } = require("./harness");

jest.setTimeout(180000);

let h, db, caregiver, family, teamId, caregiverProfileId;

// A real 1x1 JPEG. validateImageDataUrl checks magic bytes, so a fake string is rejected.
const JPEG_1PX =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsL" +
  "DBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAAB" +
  "AAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

const dashboard = () => h.request.get("/api/dashboard").set(h.auth(caregiver.token));

beforeAll(async () => {
  h = await startHarness({
    routers: {
      "/api/auth": "../../src/routes/auth",
      "/api/dashboard": "../../src/routes/dashboard",
      "/api/care-teams": "../../src/routes/careTeams",
    },
  });
  db = h.db;
  caregiver = await h.createUser({ roles: ["caregiver"], firstName: "Tina", lastName: "ITest" });
  caregiverProfileId = require("uuid").v4();
  await db.prepare(
    "INSERT INTO caregiver_profiles (id, user_id, hourly_rate, created_at) VALUES (?, ?, 25, NOW())"
  ).run(caregiverProfileId, caregiver.user.id);

  // The family's view of the same photo — a second reader of the same column.
  family = await h.createUser({ firstName: "Pete", lastName: "ITest" });
  const team = await h.createCareTeam({ familyUserId: family.user.id });
  teamId = team.teamId;
  await db.prepare(`
    INSERT INTO caregiver_assignments (id, caregiver_profile_id, care_recipient_id, family_user_id, is_active, created_at)
    VALUES (?, ?, ?, ?, 1, NOW())
  `).run(require("uuid").v4(), caregiverProfileId, team.recipientId, family.user.id);
});

afterAll(async () => { await stopHarness(h); });

describe("the photo step", () => {
  test("starts unsatisfied", async () => {
    const res = await dashboard();
    expect(res.status).toBe(200);
    expect(res.body.profile.hasPhoto).toBe(false);
    expect(res.body.profile.photoUrl).toBeNull();
  });

  test("uploading a photo satisfies it", async () => {
    const up = await h.request.put("/api/auth/me/photo")
      .set(h.auth(caregiver.token)).send({ photo: JPEG_1PX });
    expect(up.status).toBe(200);

    const res = await dashboard();
    expect(res.status).toBe(200);
    expect(res.body.profile.hasPhoto).toBe(true);
    expect(res.body.profile.photoUrl).toBe(`/api/media/user/${caregiver.user.id}/photo`);
  });

  test("the upload really did NULL avatar_url — the reason the old read could not work", async () => {
    // Pinning the trap rather than the fix. If a later change starts dual-writing avatar_url
    // again, this fails and someone re-reads the v1.106.8 note before undoing it.
    const row = await db.prepare(
      "SELECT avatar_url, profile_photo FROM users WHERE id = ?"
    ).get(caregiver.user.id);
    expect(row.avatar_url).toBeNull();
    expect(row.profile_photo).toBeTruthy();
  });

  test("removing the photo unsatisfies it again", async () => {
    const del = await h.request.delete("/api/auth/me/photo").set(h.auth(caregiver.token));
    expect(del.status).toBe(200);

    const res = await dashboard();
    expect(res.body.profile.hasPhoto).toBe(false);
    expect(res.body.profile.photoUrl).toBeNull();
  });

  test("an OAuth avatar (avatar_url holding a real data URL) still counts", async () => {
    // The one legitimate way avatar_url is populated: OAuth signup. media.js handles both
    // shapes; this proves the fix did not simply swap one single-column read for another.
    await db.prepare("UPDATE users SET avatar_url = ?, profile_photo = NULL WHERE id = ?")
      .run(JPEG_1PX, caregiver.user.id);
    const res = await dashboard();
    expect(res.body.profile.hasPhoto).toBe(true);
    expect(res.body.profile.photoUrl).toBe(`/api/media/user/${caregiver.user.id}/photo`);
  });

  test("a non-servable avatar_url (a bare http URL we never fetched) does not count", async () => {
    // userHasPhoto only trusts data:/r2:. A remote URL is not something /api/media can serve,
    // so claiming hasPhoto would tick the box and then render a broken image.
    await db.prepare("UPDATE users SET avatar_url = ?, profile_photo = NULL WHERE id = ?")
      .run("https://lh3.googleusercontent.com/a/x", caregiver.user.id);
    const res = await dashboard();
    expect(res.body.profile.hasPhoto).toBe(false);
  });
});

describe("the family's care-team thumbnails", () => {
  test("show the photo the caregiver uploaded", async () => {
    // CareTeamManage put this value straight into an <img src>. It was the raw column, so
    // every caregiver who uploaded a photo rendered as grey initials to the family.
    await h.request.put("/api/auth/me/photo")
      .set(h.auth(caregiver.token)).send({ photo: JPEG_1PX }).expect(200);

    const res = await h.request.get(`/api/care-teams/${teamId}/caregivers`).set(h.auth(family.token));
    expect(res.status).toBe(200);
    const tina = res.body.caregivers.find((c) => c.user_id === caregiver.user.id);
    expect(tina).toBeTruthy();
    expect(tina.avatarUrl).toBe(`/api/media/user/${caregiver.user.id}/photo`);
    // And the raw columns do not travel to the client at all — an <img src> can't be
    // pointed at something that isn't there.
    expect(tina.avatar_url).toBeUndefined();
    expect(tina.profile_photo).toBeUndefined();
  });

  test("fall back to null — not a broken src — when there is no photo", async () => {
    await h.request.delete("/api/auth/me/photo").set(h.auth(caregiver.token)).expect(200);
    const res = await h.request.get(`/api/care-teams/${teamId}/caregivers`).set(h.auth(family.token));
    const tina = res.body.caregivers.find((c) => c.user_id === caregiver.user.id);
    expect(tina.avatarUrl).toBeNull();
  });
});
