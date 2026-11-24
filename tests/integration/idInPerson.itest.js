/**
 * v1.112.1 — Pete: "yes, add the 'verified in person' switch." An admin who saw the ID face to
 * face opens care access with a note; undo returns the person to the ID rules.
 */
const { startHarness, stopHarness } = require("./harness");
jest.setTimeout(180000);
let h, db, admin, aunt;

beforeAll(async () => {
  h = await startHarness({ routers: {
    "/api/admin": "../../src/routes/admin",
    "/api/care-recipients": "../../src/routes/careRecipients",
  } });
  db = h.db;
  admin = await h.createUser({ firstName: "Ad", lastName: "Min", isAdmin: true });
  await db.prepare("UPDATE users SET is_admin = 1 WHERE id = ?").run(admin.user.id);
  const probe = await h.request.get("/api/admin/overview").set(h.auth(admin.token));
  const ip = (probe.body && probe.body.ip) || "::ffff:127.0.0.1";
  await require("../../src/utils/trustedIps").registerTrustedIp(admin.user.id, ip, { verifiedVia: "itest" });
  aunt = await h.createUser({ firstName: "Aunt", lastName: "Ida", idVerified: false });
});
afterAll(async () => { await stopHarness(h); });

const put = (as, id, body) => h.request.put(`/api/admin/users/${id}/verified-in-person`).set(h.auth(as.token)).send(body);

test("blocked before; a note is required; verified after; twice is 409; undo blocks again", async () => {
  expect((await h.request.get("/api/care-recipients").set(h.auth(aunt.token))).status).toBe(403);
  expect((await put(admin, aunt.user.id, { verified: true })).status).toBe(400);
  const on = await put(admin, aunt.user.id, { verified: true, note: "Saw her license at Thanksgiving" });
  expect(on.status).toBe(200);
  expect(on.body.careAccess.status).toBe("verified");
  expect(on.body.careAccess.inPerson).toBe(true);
  expect((await h.request.get("/api/care-recipients").set(h.auth(aunt.token))).status).toBe(200);
  expect((await put(admin, aunt.user.id, { verified: true, note: "again" })).status).toBe(409);
  const off = await put(admin, aunt.user.id, { verified: false });
  expect(off.status).toBe(200);
  expect((await h.request.get("/api/care-recipients").set(h.auth(aunt.token))).status).toBe(403);
});

test("a non-admin cannot flip it", async () => {
  const r = await put(aunt, aunt.user.id, { verified: true, note: "trust me" });
  expect([401, 403]).toContain(r.status);
});
