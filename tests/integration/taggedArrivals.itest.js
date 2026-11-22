/**
 * v1.146.1 — tagged arrivals. The business card's QR code opens yourinplace.com/?utm_source=card,
 * which is a tag, not a /i/ link. Every scan was already recorded; this proves Admin can now see
 * it: phones, scans, time in the app after the scan, screens read, sign-ups — and that demo
 * sessions and other tags stay out, and only admins can read it.
 */
jest.mock("../../src/routes/push", () => ({ notifyAdmins: jest.fn(async () => {}), sendPushToAdmins: jest.fn(async () => {}) }));
const { v4: uuid } = require("uuid");
const { startHarness, stopHarness } = require("./harness");
jest.setTimeout(180000);

let h, admin;
beforeAll(async () => {
  h = await startHarness({ routers: {} });
  const track = require("../../src/routes/track");
  h.app.use("/api/t", track.beaconRouter);
  h.app.use("/api/admin/links", track.adminRouter);
  admin = await h.createUser({ firstName: "Ad", lastName: "Min", isAdmin: true });
  await h.db.prepare("UPDATE users SET is_admin = 1 WHERE id = ?").run(admin.user.id);
});
afterAll(async () => { await stopHarness(h); });

const A = () => h.auth(admin.token);
const beacon = (body, headers = {}) => {
  let r = h.request.post("/api/t").set("Content-Type", "text/plain");
  for (const [k, v] of Object.entries(headers)) r = r.set(k, v);
  return r.send(JSON.stringify(body));
};
const settle = () => new Promise((r) => setTimeout(r, 300));

test("card scans are grouped by tag with phones, scans, time, screens and sign-ups", async () => {
  // Phone 1: scans the card, reads the home page 3 min and sign-up 1 min, scans again later, then signs up.
  const p1 = uuid(), s1 = uuid(), s1b = uuid();
  await beacon({ vid: p1, sid: s1, platform: "web", events: [{ k: "start", p: "splash", utm: { source: "card" } }, { k: "page", p: "splash", ms: 180000 }, { k: "page", p: "register", ms: 60000 }] }).expect(204);
  await settle();
  await beacon({ vid: p1, sid: s1b, events: [{ k: "start", p: "splash", utm: { source: "card" } }, { k: "page", p: "splash", ms: 30000 }] }).expect(204);
  await settle();
  const u = await h.createUser({ firstName: "Scanner", roles: ["family"] });
  await beacon({ vid: p1, sid: s1b, events: [{ k: "identify" }] }, { Authorization: `Bearer ${u.token}` }).expect(204);
  await settle();
  // Phone 2: one scan, 20 seconds, gone.
  const p2 = uuid();
  await beacon({ vid: p2, sid: uuid(), events: [{ k: "start", p: "splash", utm: { source: "Card" } }, { k: "page", p: "splash", ms: 20000 }] }).expect(204);
  // Noise that must not count: another tag, an untagged visit, and a demo session with the card tag.
  await beacon({ vid: uuid(), sid: uuid(), events: [{ k: "start", p: "splash", utm: { source: "flyer" } }, { k: "page", p: "splash", ms: 5000 }] }).expect(204);
  await beacon({ vid: uuid(), sid: uuid(), events: [{ k: "start", p: "splash" }, { k: "page", p: "splash", ms: 99000 }] }).expect(204);
  const demo = await h.createUser({ firstName: "Demo" });
  await h.db.prepare("UPDATE users SET is_demo = 1 WHERE id = ?").run(demo.user.id).catch(() => {});
  await h.db.prepare(`
    INSERT INTO visit_events (visitor_id, session_id, kind, page, utm_source, demo, created_at)
    VALUES (?, ?, 'start', 'splash', 'card', TRUE, NOW())
  `).run(uuid(), uuid()).catch(async () => {
    // visitors FK: create the visitor first
    const v = uuid();
    await h.db.prepare("INSERT INTO visitors (id, first_seen_at, last_seen_at) VALUES (?, NOW(), NOW())").run(v);
    await h.db.prepare("INSERT INTO visit_events (visitor_id, session_id, kind, page, utm_source, demo, created_at) VALUES (?, ?, 'start', 'splash', 'card', TRUE, NOW())").run(v, uuid());
  });
  await settle();

  const r = await h.request.get("/api/admin/links/tags").set(A());
  expect(r.status).toBe(200);
  const card = r.body.tags.find((t) => t.tag === "card");
  expect(card).toMatchObject({ visitors: 2, arrivals: 3, signups: 1 });
  expect(card.ms).toBe(180000 + 60000 + 30000 + 20000); // only sessions the card opened; the untagged 99s is not here
  expect(r.body.tags.find((t) => t.tag === "flyer")).toMatchObject({ visitors: 1, arrivals: 1, signups: 0 });

  const d = await h.request.get("/api/admin/links/tags/card").set(A());
  expect(d.status).toBe(200);
  expect(d.body.visitors).toHaveLength(2);
  const one = d.body.visitors.find((v) => v.signed_up);
  expect(one).toMatchObject({ tag_arrivals: 2, visits: 2, ms: 270000 });
  expect(one.top_pages[0]).toEqual({ page: "splash", ms: 210000 });
  expect(one.top_pages.map((p) => p.page)).toContain("register");
  const two = d.body.visitors.find((v) => !v.signed_up);
  expect(two).toMatchObject({ tag_arrivals: 1, visits: 1, ms: 20000 });
  // No visitor ids or account ids leave the server.
  expect(JSON.stringify(d.body)).not.toContain(p1);
  expect(JSON.stringify(d.body)).not.toContain(u.user.id);
});

test("only admins can read tags, and a junk tag is refused", async () => {
  const stranger = await h.createUser({ firstName: "Not" });
  expect([401, 403]).toContain((await h.request.get("/api/admin/links/tags").set(h.auth(stranger.token))).status);
  expect([401, 403]).toContain((await h.request.get("/api/admin/links/tags/card").set(h.auth(stranger.token))).status);
  expect((await h.request.get("/api/admin/links/tags/%3Cscript%3E").set(A())).status).toBe(400);
});
