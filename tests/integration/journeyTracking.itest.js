/**
 * v1.117.0 — journey tracking end to end against a real Postgres: an outreach text carries her
 * own link → she opens it (the app reports ?l=) → screens and time are recorded → she signs up
 * and her anonymous visits become hers → Admin → Outreach shows it. Plus the privacy lines:
 * screen names only, no admin "view as", no cross-site account attach.
 */
process.env.TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || "itest-twilio-token";
const sent = [];
jest.mock("../../src/utils/sms", () => {
  const actual = jest.requireActual("../../src/utils/sms");
  return {
    ...actual,
    outreachNumber: () => "+15405550100",
    sendSms: jest.fn(async (to, body) => { sent.push({ to, body }); return { success: true, sid: `SMj${sent.length}`, status: "queued" }; }),
  };
});
const emails = [];
jest.mock("../../src/utils/email", () => {
  const actual = jest.requireActual("../../src/utils/email");
  return { ...actual, sendEmail: jest.fn(async (m) => { emails.push(m); return { success: true }; }) };
});
jest.mock("../../src/routes/push", () => ({ notifyAdmins: jest.fn(async () => {}), sendPushToAdmins: jest.fn(async () => {}) }));

const jwt = require("jsonwebtoken");
const { v4: uuid } = require("uuid");
const O = require("../../src/utils/outreach");
const { startHarness, stopHarness } = require("./harness");
jest.setTimeout(180000);

let h, db, admin;
beforeAll(async () => {
  h = await startHarness({ routers: { "/api/admin/outreach": "../../src/routes/outreach" } });
  const track = require("../../src/routes/track");
  h.app.use("/api/t", track.beaconRouter);
  h.app.use("/api/admin/links", track.adminRouter);
  h.app.use(track.publicRouter);
  db = h.db;
  admin = await h.createUser({ firstName: "Ad", lastName: "Min", isAdmin: true });
  await db.prepare("UPDATE users SET is_admin = 1 WHERE id = ?").run(admin.user.id);
  jest.spyOn(O, "introWindow").mockReturnValue({ open: true, reason: null });
});
afterAll(async () => { await stopHarness(h); });

const A = () => h.auth(admin.token);
const beacon = (body, headers = {}) => {
  let r = h.request.post("/api/t").set("Content-Type", "text/plain");
  for (const [k, v] of Object.entries(headers)) r = r.set(k, v);
  return r.send(JSON.stringify(body));
};
const settle = () => new Promise((r) => setTimeout(r, 300)); // the beacon answers 204 before it writes

let contactId, code, vid;

test("an intro with {link} gives each person her own link, and the same one every time", async () => {
  await h.request.post("/api/admin/outreach/import").set(A()).send({ text: "Doe, Jane .... 540-555-0141", source: "test" });
  const c = (await h.request.get("/api/admin/outreach").set(A())).body.contacts.find((x) => x.phone.endsWith("5550141"));
  contactId = c.id;
  const r = await h.request.post("/api/admin/outreach/send-intro").set(A())
    .send({ ids: [c.id], template: "Hi {first}, see {link} . Reply STOP to opt out." });
  expect(r.status).toBe(200);
  for (let i = 0; i < 40 && !sent.length; i++) await settle();
  const m = sent[0].body.match(/\/i\/([A-Za-z0-9]{6})/);
  expect(m).toBeTruthy();
  expect(sent[0].body).not.toMatch(/https?:\/\//); // bare domain in a text
  code = m[1];
  const row = await db.prepare("SELECT kind, outreach_contact_id FROM track_links WHERE code = ?").get(code);
  expect(row).toEqual({ kind: "outreach", outreach_contact_id: c.id });

  // A follow-up text with {link} reuses it.
  await h.request.post(`/api/admin/outreach/${c.id}/messages`).set(A()).send({ body: "Here it is again: {link}" });
  expect(sent[1].body).toContain(`/i/${code}`);
});

test("/i/:code redirects into the app with the code, and records nothing on its own", async () => {
  const r = await h.request.get(`/i/${code}`);
  expect(r.status).toBe(302);
  expect(r.headers.location).toBe(`/?l=${code}`);
  expect(r.headers["x-robots-tag"]).toMatch(/noindex/);
  const n = await db.prepare("SELECT COUNT(*) AS n FROM visit_events").get();
  expect(Number(n.n)).toBe(0); // a link-preview fetch is not a click
  expect((await h.request.get("/i/nope!!")).headers.location).toBe("/");
  expect((await h.request.get("/i/ZZZZZZ")).headers.location).toBe("/");
});

test("opening the link in the app counts as her visit; screens and time are recorded", async () => {
  vid = uuid();
  const sid = uuid();
  await beacon({ vid, sid, platform: "ios", events: [
    { k: "start", p: "splash", l: code, ref: "https://m.facebook.com/groups/123/posts/456?x=1", utm: { source: "Facebook", campaign: "oct push" }, cid: "fbclid" },
    { k: "page", p: "splash", ms: 240000 },
    { k: "page", p: "register", ms: 90000 },
  ] }).expect(204);
  await settle();
  const v = await db.prepare("SELECT * FROM visitors WHERE id = ?").get(vid);
  expect(v.first_link_code).toBe(code);
  expect(v.first_ref_host).toBe("facebook.com");     // host only, never the post URL
  expect(v.first_utm_source).toBe("facebook");
  expect(v.first_utm_campaign).toBe("oct_push");
  expect(v.first_click_id).toBe("fbclid");           // the type, never the value
  expect(v.platform).toBe("ios");
  expect(v.user_id).toBeNull();
  const list = (await h.request.get("/api/admin/outreach").set(A())).body.contacts.find((x) => x.id === contactId);
  expect(list.link_opened_at).toBeTruthy();
});

test("only screen names are kept — anything that looks like an id or text is dropped", async () => {
  await beacon({ vid, sid: uuid(), events: [
    { k: "page", p: "care-notes/8f3e2c1a-0000-4000-8000-000000000000", ms: 5000 },
    { k: "page", p: "She refused her evening pill", ms: 5000 },
    { k: "page", p: "dashboard", ms: 99 * 3600 * 1000 },
    { k: "start", p: "splash", l: "notarealcode", ref: "not a url" },
  ] }).expect(204);
  await settle();
  const pages = await db.prepare("SELECT page, ms FROM visit_events WHERE visitor_id = ? AND kind = 'page' ORDER BY id").all(vid);
  expect(pages.map((p) => p.page)).toEqual(["splash", "register", "dashboard"]);
  expect(pages[2].ms).toBe(30 * 60 * 1000); // capped
  const lastStart = await db.prepare("SELECT link_code, ref_host FROM visit_events WHERE visitor_id = ? AND kind = 'start' ORDER BY id DESC LIMIT 1").get(vid);
  expect(lastStart).toEqual({ link_code: null, ref_host: null });
});

test("signing in claims the anonymous visits; Admin → Outreach shows the whole story", async () => {
  const jane = await h.createUser({ firstName: "Jane", lastName: "Doe", roles: ["caregiver"] });
  await db.prepare("UPDATE users SET phone = '540-555-0141' WHERE id = ?").run(jane.user.id);
  await beacon({ vid, sid: uuid(), events: [{ k: "identify" }, { k: "page", p: "dashboard", ms: 60000 }] },
    { Authorization: `Bearer ${jane.token}`, "Sec-Fetch-Site": "same-origin" }).expect(204);
  await settle();
  expect((await db.prepare("SELECT user_id FROM visitors WHERE id = ?").get(vid)).user_id).toBe(jane.user.id);
  const anon = await db.prepare("SELECT COUNT(*) AS n FROM visit_events WHERE visitor_id = ? AND user_id IS NULL").get(vid);
  expect(Number(anon.n)).toBe(0);

  const t = (await h.request.get(`/api/admin/outreach/${contactId}/messages`).set(A())).body;
  expect(t.journey.opens).toBe(1);
  expect(t.journey.signedUpAt).toBeTruthy();
  expect(t.journey.siteMs).toBe(240000 + 90000 + 30 * 60 * 1000 + 60000);
  expect(t.journey.pages[0].page).toBe("dashboard");
  expect(t.journey.link).toContain(`/i/${code}`);
});

test("an admin viewing as someone records nothing, and a cross-site request can't attach an account", async () => {
  const other = await h.createUser({ firstName: "Other" });
  const viewAs = jwt.sign({ id: other.user.id, roles: ["family"], role: "family", impersonatedBy: admin.user.id }, process.env.JWT_SECRET, { expiresIn: "1h" });
  const v2 = uuid();
  await beacon({ vid: v2, sid: uuid(), events: [{ k: "page", p: "dashboard", ms: 5000 }] }, { Authorization: `Bearer ${viewAs}` }).expect(204);
  await settle();
  expect(await db.prepare("SELECT id FROM visitors WHERE id = ?").get(v2)).toBeFalsy();

  const v3 = uuid();
  await beacon({ vid: v3, sid: uuid(), events: [{ k: "identify" }] }, { Authorization: `Bearer ${other.token}`, "Sec-Fetch-Site": "cross-site" }).expect(204);
  await settle();
  expect((await db.prepare("SELECT user_id FROM visitors WHERE id = ?").get(v3)).user_id).toBeNull();
});

test("a demo session is counted as demo and never claims a visitor", async () => {
  const demo = await h.createUser({ firstName: "Paul", isDemo: true });
  const demoToken = jwt.sign({ id: demo.user.id, roles: ["family"], role: "family", demo: true }, process.env.JWT_SECRET, { expiresIn: "1h" });
  const v4 = uuid();
  await beacon({ vid: v4, sid: uuid(), events: [{ k: "identify" }, { k: "page", p: "dashboard", ms: 5000 }] }, { Authorization: `Bearer ${demoToken}` }).expect(204);
  await settle();
  expect((await db.prepare("SELECT user_id FROM visitors WHERE id = ?").get(v4)).user_id).toBeNull();
  const e = await db.prepare("SELECT demo, user_id FROM visit_events WHERE visitor_id = ? AND kind = 'page'").get(v4);
  expect(e).toEqual({ demo: true, user_id: null });
});

test("garbage never errors: bad JSON, bad ids, too many events", async () => {
  await h.request.post("/api/t").set("Content-Type", "text/plain").send("{not json").expect(204);
  await beacon({ vid: "not-a-uuid", events: [{ k: "page", p: "x", ms: 1 }] }).expect(204);
  const v5 = uuid();
  await beacon({ vid: v5, sid: uuid(), events: Array.from({ length: 200 }, () => ({ k: "page", p: "dashboard", ms: 1000 })) }).expect(204);
  await settle(); await settle();
  const n = await db.prepare("SELECT COUNT(*) AS n FROM visit_events WHERE visitor_id = ?").get(v5);
  expect(Number(n.n)).toBe(25);
});

test("campaign links: admin makes one, visitors and signups are counted", async () => {
  const made = await h.request.post("/api/admin/links").set(A()).send({ label: "Facebook — NRV caregivers", audience: "caregiver" });
  expect(made.status).toBe(200);
  const c2 = made.body.code;
  const v6 = uuid();
  await beacon({ vid: v6, sid: uuid(), events: [{ k: "start", p: "splash", l: c2 }] }).expect(204);
  await settle();
  const u = await h.createUser({ firstName: "New", roles: ["caregiver"] });
  await beacon({ vid: v6, sid: uuid(), events: [{ k: "identify" }] }, { Authorization: `Bearer ${u.token}` }).expect(204);
  await settle();
  const links = (await h.request.get("/api/admin/links").set(A())).body.links;
  const l = links.find((x) => x.code === c2);
  expect(l).toMatchObject({ label: "Facebook — NRV caregivers", audience: "caregiver", visitors: 1, signups: 1 });
  const stranger = await h.createUser({ firstName: "Not" });
  expect([401, 403]).toContain((await h.request.get("/api/admin/links").set(h.auth(stranger.token))).status);
});

test("the invite email carries her code, so opening it counts as her visit", async () => {
  await h.request.post(`/api/admin/outreach/${contactId}/invite`).set(A()).send({ email: "jane.newaddress@itest.local" });
  // Jane already has an account by phone, so the invite path may short-circuit; use a fresh contact.
  await h.request.post("/api/admin/outreach/import").set(A()).send({ text: "Roe, Mary .... 540-555-0142", source: "test" });
  const c = (await h.request.get("/api/admin/outreach").set(A())).body.contacts.find((x) => x.phone.endsWith("5550142"));
  const r = await h.request.post(`/api/admin/outreach/${c.id}/invite`).set(A()).send({ email: "mary.roe@itest.local" });
  expect(r.status).toBe(200);
  const mail = emails[emails.length - 1];
  const linkRow = await db.prepare("SELECT code FROM track_links WHERE outreach_contact_id = ?").get(c.id);
  expect(mail.html).toContain(`l=${linkRow.code}`);
});
