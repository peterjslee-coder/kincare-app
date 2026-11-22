/**
 * v1.146.0 — updates from InPlace to every caregiver (Pete, 11/22). Admin sends; every
 * caregiver (onboarding too) gets a receipt and sees it pinned; Got it unpins; a reply is a
 * private DM to the sender; family and demo accounts get nothing; withdraw hides it.
 */
const { startHarness, stopHarness } = require("./harness");

jest.setTimeout(180000);

let h, pete, kay, newbie, family, demoCg, updateId;

beforeAll(async () => {
  h = await startHarness({ routers: { "/api/caregiver-updates": "../../src/routes/caregiverUpdates" } });
  pete = await h.createUser({ roles: ["family"], firstName: "Pete", isAdmin: true });
  kay = await h.createUser({ roles: ["caregiver"], firstName: "Kay" });
  newbie = await h.createUser({ roles: ["caregiver"], firstName: "Newbie", idVerified: false });
  family = await h.createUser({ roles: ["family"], firstName: "Fam" });
  demoCg = await h.createUser({ roles: ["caregiver"], firstName: "Demo", isDemo: true });
});
afterAll(async () => { await stopHarness(h); });

const as = (who) => ({
  get: (p) => h.request.get(p).set(h.auth(who.token)),
  post: (p, b) => h.request.post(p).set(h.auth(who.token)).send(b || {}),
  patch: (p, b) => h.request.patch(p).set(h.auth(who.token)).send(b || {}),
});

test("only an admin can send", async () => {
  expect((await as(kay).post("/api/caregiver-updates/admin", { title: "x", body: "y" })).status).toBe(403);
  expect((await as(family).get("/api/caregiver-updates/admin")).status).toBe(403);
});

test("a title and a message are required", async () => {
  expect((await as(pete).post("/api/caregiver-updates/admin", { title: "", body: "y" })).status).toBe(400);
  expect((await as(pete).post("/api/caregiver-updates/admin", { title: "x", body: " " })).status).toBe(400);
});

test("the audience is every real caregiver, onboarding included", async () => {
  const r = await as(pete).get("/api/caregiver-updates/admin/audience");
  expect(r.status).toBe(200);
  expect(r.body.count).toBe(2); // Kay + Newbie; not family, not demo, not Pete
});

test("sending gives every caregiver a receipt", async () => {
  const r = await as(pete).post("/api/caregiver-updates/admin", { kind: "tip", title: "Check in at the door", body: "Tap Check in as you arrive." });
  expect(r.status).toBe(201);
  expect(r.body.sentTo).toBe(2);
  updateId = r.body.id;
  const rows = await h.db.prepare("SELECT user_id FROM caregiver_update_receipts WHERE update_id = ?").all(updateId);
  expect(rows.map((x) => x.user_id).sort()).toEqual([kay.user.id, newbie.user.id].sort());
});

test("Kay sees it pinned; family and demo see nothing", async () => {
  const k = await as(kay).get("/api/caregiver-updates/mine");
  expect(k.body.pinned).toMatchObject({ id: updateId, title: "Check in at the door", from: expect.stringContaining("Pete") });
  const f = await as(family).get("/api/caregiver-updates/mine");
  expect(f.body.pinned).toBeNull();
  const d = await as(demoCg).get("/api/caregiver-updates/mine");
  expect(d.body.history).toEqual([]);
});

test("someone else's receipt can't be touched", async () => {
  expect((await as(family).post(`/api/caregiver-updates/${updateId}/got-it`)).status).toBe(404);
});

test("Got it unpins it but keeps it in history", async () => {
  expect((await as(kay).post(`/api/caregiver-updates/${updateId}/seen`)).status).toBe(200);
  expect((await as(kay).post(`/api/caregiver-updates/${updateId}/got-it`)).status).toBe(200);
  const k = await as(kay).get("/api/caregiver-updates/mine");
  expect(k.body.pinned).toBeNull();
  expect(k.body.history.map((u) => u.id)).toContain(updateId);
});

test("a reply is a private message to the sender, quoting the title", async () => {
  const r = await as(newbie).post(`/api/caregiver-updates/${updateId}/reply`, { text: "Will do!" });
  expect(r.status).toBe(201);
  const members = await h.db.prepare("SELECT user_id FROM conversation_members WHERE conversation_id = ?").all(r.body.conversationId);
  expect(members.map((m) => m.user_id).sort()).toEqual([newbie.user.id, pete.user.id].sort());
  const msg = await h.db.prepare("SELECT content, sender_id FROM messages WHERE conversation_id = ?").get(r.body.conversationId);
  expect(msg.sender_id).toBe(newbie.user.id);
  expect(msg.content).toContain("Check in at the door");
  expect(msg.content).toContain("Will do!");
  const n = await as(newbie).get("/api/caregiver-updates/mine");
  expect(n.body.pinned).toBeNull();
});

test("the admin list counts opened / got it / replied", async () => {
  const r = await as(pete).get("/api/caregiver-updates/admin");
  const u = r.body.updates.find((x) => x.id === updateId);
  expect(u.stats).toEqual({ sentTo: 2, seen: 2, gotIt: 1, replied: 1 });
  const rc = await as(pete).get(`/api/caregiver-updates/admin/${updateId}/receipts`);
  const byName = Object.fromEntries(rc.body.receipts.map((x) => [x.name.split(" ")[0], x.state]));
  expect(byName).toEqual({ Kay: "got_it", Newbie: "replied" });
});

test("a caregiver who joins later still sees a recent one", async () => {
  const late = await h.createUser({ roles: ["caregiver"], firstName: "Late" });
  const r = await as(late).get("/api/caregiver-updates/mine");
  expect(r.body.pinned).toMatchObject({ id: updateId });
});

test("edit keeps it; withdraw hides it", async () => {
  expect((await as(pete).patch(`/api/caregiver-updates/admin/${updateId}`, { kind: "tip", title: "Check in at the front door", body: "Tap Check in." })).status).toBe(200);
  let k = await as(kay).get("/api/caregiver-updates/mine");
  expect(k.body.history[0].title).toBe("Check in at the front door");
  expect((await as(pete).post(`/api/caregiver-updates/admin/${updateId}/withdraw`)).status).toBe(200);
  k = await as(kay).get("/api/caregiver-updates/mine");
  expect(k.body.history.map((u) => u.id)).not.toContain(updateId);
});
