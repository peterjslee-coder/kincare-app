/**
 * v1.155.0 — photos on the InPlace Hub.
 *
 * Pete, 11/23: "anyone on the care team can add and view, as well as a photo that a caregiver
 * uploads if they choose 'display for <name>'". One flag (`show_on_hub`) on the two tables that
 * already hold photos; utils/hubPhotos.js decides who may set it and who may load the image.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || "hub-photos-secret";

jest.mock("../../src/routes/push", () => {
  const actual = jest.requireActual("../../src/routes/push");
  return { ...actual, sendPushToUser: async () => ({ sent: 0 }) };
});
jest.mock("../../src/utils/push", () => ({ sendPushToUser: async () => ({ sent: 0 }) }));

const { startHarness, stopHarness } = require("./harness");
const { v4: uuid } = require("uuid");

jest.setTimeout(180000);

// A real 1x1 PNG — the routes check magic bytes.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

let h, db, leader, sister, stranger, mom, tina, recipientId, teamId, sessionId, visitLogId;

beforeAll(async () => {
  h = await startHarness({ routers: {
    "/api/care-recipients": "../../src/routes/careRecipients",
    "/api/care-photos": "../../src/routes/carePhotos",
    "/api/photos": "../../src/routes/photos",
    "/api/dashboard": "../../src/routes/dashboard",
  } });
  db = h.db;
  leader = await h.createUser({ firstName: "Pete", lastName: "ITest" });
  sister = await h.createUser({ firstName: "Sara", lastName: "ITest" });
  stranger = await h.createUser({ firstName: "Nobody", lastName: "ITest" });
  ({ recipientId, teamId } = await h.createCareTeam({ familyUserId: leader.user.id }));
  await h.addTeamMember(teamId, sister.user.id);

  const r = await h.request.post(`/api/care-recipients/${recipientId}/own-login`).set(h.auth(leader.token))
    .send({ email: "mom-photos@itest.local", password: "Kitchen#2026" });
  expect(r.status).toBe(201);
  const { generateToken } = require("../../src/middleware/auth");
  await h.verifyIdentity(r.body.userId);
  mom = { user: { id: r.body.userId }, token: generateToken({ id: r.body.userId, email: "mom-photos@itest.local", roles: ["care_for"], role: "care_for" }) };

  tina = await h.createUser({ roles: ["caregiver"], firstName: "Tina", lastName: "ITest" });
  const profileId = uuid();
  await db.prepare("INSERT INTO caregiver_profiles (id, user_id, hourly_rate, created_at) VALUES (?, ?, 25, NOW())").run(profileId, tina.user.id);
  sessionId = uuid();
  const today = require("../../src/utils/timezone").getTodayStringInZone("America/New_York");
  await db.prepare(`INSERT INTO care_sessions (id, care_recipient_id, family_user_id, caregiver_id, scheduled_date, scheduled_time, duration_hours, service_type, status, created_at)
    VALUES (?, ?, ?, ?, ?, '10:00', 2, 'companionship', 'in_progress', NOW())`).run(sessionId, recipientId, leader.user.id, profileId, today);
  visitLogId = uuid();
  await db.prepare("INSERT INTO visit_logs (id, session_id, caregiver_id, check_in_time, created_at) VALUES (?, ?, ?, NOW(), NOW())")
    .run(visitLogId, sessionId, profileId);

  const put = await h.request.put(`/api/care-recipients/${recipientId}/simple-mode`).set(h.auth(leader.token))
    .send({ on: true, callUserIds: [], show: { comingUp: true } });
  expect(put.status).toBe(200);
});

afterAll(async () => { await stopHarness(h); });

const hubOn = (on) => h.request.put(`/api/care-recipients/${recipientId}/simple-mode`).set(h.auth(leader.token))
  .send({ on: true, callUserIds: [], hub: { on } });
const hubScreen = async () => (await h.request.get("/api/dashboard").set(h.auth(mom.token))).body.simpleScreen.hub;
const caregiverUpload = (showOnHub) => {
  let req = h.request.post(`/api/photos/visit/${visitLogId}`).set(h.auth(tina.token))
    .attach("photos", PNG, { filename: "p.png", contentType: "image/png" });
  if (showOnHub !== undefined) req = req.field("showOnHub", showOnHub);
  return req;
};

describe("while the Hub is off", () => {
  test("a caregiver is not offered the choice, and a ticked box is ignored", async () => {
    const opt = await h.request.get(`/api/photos/hub-option/session/${sessionId}`).set(h.auth(tina.token));
    expect(opt.body).toEqual({ available: false });
    const up = await caregiverUpload("1");
    expect(up.status).toBe(201);
    expect(up.body.photos[0].showOnHub).toBe(false);
  });
  test("Home has no Hub to add photos to", async () => {
    const d = await h.request.get("/api/dashboard").set(h.auth(leader.token));
    expect(d.body.hubRecipients).toEqual([]);
  });
});

describe("with the Hub on", () => {
  let careId, visitId;
  beforeAll(async () => { expect((await hubOn(true)).status).toBe(200); });

  test("Home offers it to family on the team", async () => {
    const d = await h.request.get("/api/dashboard").set(h.auth(sister.token));
    expect(d.body.hubRecipients).toEqual([{ id: recipientId, firstName: expect.any(String), photoAspect: null }]);
  });

  test("the caregiver on the visit is offered the choice; it is off unless ticked", async () => {
    const opt = await h.request.get(`/api/photos/hub-option/session/${sessionId}`).set(h.auth(tina.token));
    expect(opt.body.available).toBe(true);
    const plain = await caregiverUpload();
    expect(plain.body.photos[0].showOnHub).toBe(false);
    const ticked = await caregiverUpload("1");
    expect(ticked.body.photos[0].showOnHub).toBe(true);
    visitId = ticked.body.photos[0].id;
  });

  test("another family's member is not offered the caregiver's choice", async () => {
    const opt = await h.request.get(`/api/photos/hub-option/session/${sessionId}`).set(h.auth(stranger.token));
    expect(opt.body).toEqual({ available: false });
  });

  test("a family member adds a photo straight to her screen", async () => {
    const up = await h.request.post("/api/care-photos/upload").set(h.auth(sister.token))
      .field("careRecipientId", recipientId).field("caption", "Sam's first day").field("showOnHub", "1")
      .attach("photo", PNG, { filename: "p.png", contentType: "image/png" });
    expect(up.status).toBe(201);
    expect(up.body.showOnHub).toBe(true);
    careId = up.body.id;
  });

  test("someone not on the team cannot add one", async () => {
    const up = await h.request.post("/api/care-photos/upload").set(h.auth(stranger.token))
      .field("careRecipientId", recipientId).field("showOnHub", "1")
      .attach("photo", PNG, { filename: "p.png", contentType: "image/png" });
    expect(up.status).toBe(403);
  });

  test("a file that is not the picture it claims is refused", async () => {
    const up = await h.request.post("/api/care-photos/upload").set(h.auth(sister.token))
      .field("careRecipientId", recipientId)
      .attach("photo", Buffer.from("not an image at all"), { filename: "p.png", contentType: "image/png" });
    expect(up.status).toBe(400);
  });

  test("her screen shows only the flagged photos, newest first, with who sent them", async () => {
    const hub = await hubScreen();
    expect(hub.photos.map((p) => p.id)).toEqual([careId, visitId]);
    expect(hub.photos[0]).toMatchObject({ kind: "care", from: "Sara", caption: "Sam's first day" });
    expect(hub.photos[1]).toMatchObject({ kind: "visit", from: "Tina" });
    expect(JSON.stringify(hub.photos)).not.toContain("base64");
  });

  test("she can load a flagged photo; a stranger cannot", async () => {
    const hub = await hubScreen();
    for (const p of hub.photos) {
      const ok = await h.request.get(p.url).set(h.auth(mom.token));
      expect(ok.status).toBe(200);
      expect(ok.headers["content-type"]).toContain("image/jpeg");
      expect((await h.request.get(p.url).set(h.auth(stranger.token))).status).toBe(404);
    }
  });

  test("family switches a photo off; it leaves her screen and she can no longer load it", async () => {
    const off = await h.request.patch(`/api/care-photos/hub/visit/${visitId}`).set(h.auth(leader.token)).send({ showOnHub: false });
    expect(off.status).toBe(200);
    const hub = await hubScreen();
    expect(hub.photos.map((p) => p.id)).toEqual([careId]);
    expect((await h.request.get(`/api/care-photos/hub/visit/${visitId}/image`).set(h.auth(mom.token))).status).toBe(404);
    // ...but family still can
    expect((await h.request.get(`/api/care-photos/hub/visit/${visitId}/image`).set(h.auth(leader.token))).status).toBe(200);
  });

  test("the caregiver and a stranger cannot flip the switch", async () => {
    expect((await h.request.patch(`/api/care-photos/hub/visit/${visitId}`).set(h.auth(tina.token)).send({ showOnHub: true })).status).toBe(404);
    expect((await h.request.patch(`/api/care-photos/hub/care/${careId}`).set(h.auth(stranger.token)).send({ showOnHub: false })).status).toBe(404);
  });

  test("Home tells family which photos are on her screen", async () => {
    const d = await h.request.get("/api/dashboard").set(h.auth(leader.token));
    const mine = d.body.recentPhotos.find((p) => p.id === careId);
    expect(mine).toMatchObject({ kind: "care", showOnHub: true, careRecipientId: recipientId });
  });

  test("v1.155.1: a big phone photo is shrunk and cropped on the server", async () => {
    const sharp = require("sharp");
    // 6000x4000 noise JPEG ≈ well over the old 5 MB cap
    const w = 6000, hgt = 4000;
    const rawPx = Buffer.alloc(w * hgt * 3);
    for (let i = 0; i < rawPx.length; i++) rawPx[i] = ((i * 2654435761) >>> 24) & (i % 7 ? 0xff : 0x80);
    const big = await sharp(rawPx, { raw: { width: w, height: hgt, channels: 3 } }).jpeg({ quality: 80 }).toBuffer();
    expect(big.length).toBeGreaterThan(5 * 1024 * 1024);
    expect(big.length).toBeLessThan(25 * 1024 * 1024);
    const up = await h.request.post("/api/care-photos/upload").set(h.auth(sister.token))
      .field("careRecipientId", recipientId).field("showOnHub", "0")
      .field("crop", JSON.stringify({ x: 0.1, y: 0, w: 0.5, h: 0.5625 })) // 3000x2250 → 4:3
      .attach("photo", big, { filename: "big.jpg", contentType: "image/jpeg" });
    expect(up.body.error).toBeUndefined();
    expect(up.status).toBe(201);
    const img = await h.request.get(`/api/care-photos/hub/care/${up.body.id}/image`).set(h.auth(sister.token))
      .buffer(true).parse((res, cb) => { const b = []; res.on("data", (c) => b.push(c)); res.on("end", () => cb(null, Buffer.concat(b))); });
    expect(img.status).toBe(200);
    const meta = await sharp(img.body).metadata();
    expect(meta.format).toBe("jpeg");
    expect(Math.max(meta.width, meta.height)).toBeLessThanOrEqual(2000);
    expect(meta.width / meta.height).toBeCloseTo(4 / 3, 1);
    expect(img.body.length).toBeLessThan(5 * 1024 * 1024);
  });

  test("the Photos setting turns the whole strip off", async () => {
    const put = await h.request.put(`/api/care-recipients/${recipientId}/simple-mode`).set(h.auth(leader.token))
      .send({ on: true, callUserIds: [], hub: { photos: false } });
    expect(put.body.hub.photos).toBe(false);
    const hub = await hubScreen();
    expect(hub.photos).toEqual([]);
    expect(hub.showPhotos).toBe(false);
  });
});
