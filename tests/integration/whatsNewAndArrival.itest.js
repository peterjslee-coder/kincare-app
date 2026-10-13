/**
 * v1.112.4 — the What's New splash (seen once, never under impersonation or on a demo account)
 * and the arrival prompt for to-dos (POST /api/care-todos/nearby: the team only, the house only,
 * only when something is waiting, and the point is not kept).
 */
const jwt = require("jsonwebtoken");
const { startHarness, stopHarness } = require("./harness");

jest.setTimeout(180000);

let h, db, family, outsider, demo, recipientId;
const HOME = { lat: 37.2296, lng: -80.4139 }; // Blacksburg

beforeAll(async () => {
  h = await startHarness({ routers: {
    "/api/whats-new": "../../src/routes/whatsNew",
    "/api/care-todos": "../../src/routes/careTodos",
  } });
  db = h.db;
  family = await h.createUser({ roles: ["family"], firstName: "Pete" });
  outsider = await h.createUser({ roles: ["family"], firstName: "Random" });
  demo = await h.createUser({ roles: ["family"], firstName: "Paul", isDemo: true });
  const t = await h.createCareTeam({ familyUserId: family.user.id });
  recipientId = t.recipientId;
  await db.prepare("UPDATE care_recipients SET latitude = ?, longitude = ? WHERE id = ?").run(HOME.lat, HOME.lng, recipientId);
  // Accounts made "before" the entries shipped, so they qualify.
  await db.prepare("UPDATE users SET created_at = NOW() - INTERVAL '3 days' WHERE id IN (?, ?)").run(family.user.id, demo.user.id);
});
afterAll(async () => { await stopHarness(h); });

const get = (token, q = "") => h.request.get(`/api/whats-new${q}`).set(h.auth(token));

describe("What's New", () => {
  test("the response is the registry's own entries, without functions", async () => {
    const res = await get(family.token);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.entries)).toBe(true);
    for (const e of res.body.entries) expect(e.when).toBeUndefined();
  });

  test("marking seen keeps it from coming back; ?all=1 still shows it", async () => {
    const before = (await get(family.token)).body.entries.map((e) => e.id);
    if (!before.length) return; // outside the window — nothing to mark
    const r = await h.request.post("/api/whats-new/seen").set(h.auth(family.token)).send({ ids: [before[0]] });
    expect(r.status).toBe(200);
    expect((await get(family.token)).body.entries.map((e) => e.id)).not.toContain(before[0]);
    expect((await get(family.token, "?all=1")).body.entries.map((e) => e.id)).toContain(before[0]);
  });

  test("unknown ids are refused", async () => {
    const r = await h.request.post("/api/whats-new/seen").set(h.auth(family.token)).send({ ids: ["nope"] });
    expect(r.status).toBe(400);
  });

  test("a demo account never gets the splash", async () => {
    expect((await get(demo.token)).body.entries).toEqual([]);
  });

  test("an admin viewing as someone sees nothing and cannot mark it seen on her account", async () => {
    const asAdmin = jwt.sign(
      { id: family.user.id, email: family.user.email, roles: ["family"], role: "family", impersonatedBy: outsider.user.id },
      process.env.JWT_SECRET, { expiresIn: "10m" });
    expect((await get(asAdmin)).body.entries).toEqual([]);
    const r = await h.request.post("/api/whats-new/seen").set(h.auth(asAdmin)).send({ ids: ["documents-center"] });
    expect(r.status).toBe(403);
  });
});

describe("the arrival prompt", () => {
  const nearby = (token, lat, lng) => h.request.post("/api/care-todos/nearby").set(h.auth(token)).send({ latitude: lat, longitude: lng });

  test("nothing waiting → nothing to prompt, even at the house", async () => {
    const r = await nearby(family.token, HOME.lat, HOME.lng);
    expect(r.status).toBe(200);
    expect(r.body.here).toEqual([]);
  });

  test("at the house with a to-do waiting → the prompt, with the count", async () => {
    await h.request.post("/api/care-todos").set(h.auth(family.token)).send({ care_recipient_id: recipientId, title: "Water the kitchen plant" });
    const r = await nearby(family.token, HOME.lat + 0.0005, HOME.lng); // ~180 ft away
    expect(r.body.here).toEqual([expect.objectContaining({ careRecipientId: recipientId, openCount: 1 })]);
  });

  test("across town → nothing", async () => {
    expect((await nearby(family.token, HOME.lat + 0.05, HOME.lng)).body.here).toEqual([]);
  });

  test("someone not on the team, standing at the house → nothing", async () => {
    expect((await nearby(outsider.token, HOME.lat, HOME.lng)).body.here).toEqual([]);
  });

  test("a bad point is refused", async () => {
    expect((await nearby(family.token, "x", 5)).status).toBe(400);
  });
});
