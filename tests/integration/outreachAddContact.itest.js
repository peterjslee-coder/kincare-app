/**
 * v1.125.1 — Admin → Outreach → "+ Add person". Pete, 10/28: "There needs to be a way that I can
 * enter a phone number in or pick from Contacts as well. You can't just be a pre-populated list
 * based on an import."
 *
 * What must hold: a hand-added person is the same row an import makes (status new, NO OK to
 * text — adding a number is not consent), a number already on the list opens that person instead
 * of erroring or duplicating, a +1 / punctuation in the number is normalised, and only US
 * ten-digit numbers get in.
 */
process.env.TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || "itest-twilio-token";
const sent = [];
jest.mock("../../src/utils/sms", () => {
  const actual = jest.requireActual("../../src/utils/sms");
  return {
    ...actual,
    outreachNumber: () => "+15405550100",
    sendSms: jest.fn(async (to, body) => { sent.push({ to, body }); return { success: true, sid: `SM${sent.length}`, status: "queued" }; }),
  };
});
jest.mock("../../src/routes/push", () => ({ notifyAdmins: jest.fn(async () => {}), sendPushToAdmins: jest.fn(async () => {}) }));

const { startHarness, stopHarness } = require("./harness");
jest.setTimeout(180000);

let h, db, admin, stranger;
beforeAll(async () => {
  h = await startHarness({ routers: { "/api/admin/outreach": "../../src/routes/outreach" } });
  db = h.db;
  admin = await h.createUser({ firstName: "Ad", lastName: "Min", isAdmin: true });
  await db.prepare("UPDATE users SET is_admin = 1 WHERE id = ?").run(admin.user.id);
  stranger = await h.createUser({ firstName: "Not", lastName: "Admin" });
});
afterAll(async () => { await stopHarness(h); });

const A = () => h.auth(admin.token);
const addPerson = (body, who = A()) => h.request.post("/api/admin/outreach/contacts").set(who).send(body);

test("only admins can add", async () => {
  const r = await addPerson({ firstName: "Jane", phone: "540-555-0199" }, h.auth(stranger.token));
  expect([401, 403]).toContain(r.status);
  expect(await db.prepare("SELECT COUNT(*)::int AS n FROM outreach_contacts").get()).toEqual({ n: 0 });
});

test("adds one person, normalised, with no OK to text", async () => {
  const r = await addPerson({ firstName: " Jane ", lastName: "Doe", phone: "+1 (540) 555-0111", notes: "met at church" });
  expect(r.status).toBe(200);
  expect(r.body.existing).toBe(false);
  const row = await db.prepare("SELECT * FROM outreach_contacts WHERE id = ?").get(r.body.id);
  expect(row).toMatchObject({ first_name: "Jane", last_name: "Doe", phone: "+15405550111", status: "new", notes: "met at church", source: "Added by hand", created_by: admin.user.id });
  expect(row.texts_ok_at).toBeNull();
  // and therefore cannot be texted yet
  const t = await h.request.post(`/api/admin/outreach/${r.body.id}/messages`).set(A()).send({ body: "hi" });
  expect(t.status).toBe(400);
  expect(sent).toHaveLength(0);
});

test("a number already on the list opens that person — no duplicate, no error", async () => {
  const first = await db.prepare("SELECT id FROM outreach_contacts WHERE phone = '+15405550111'").get();
  const r = await addPerson({ firstName: "Someone", lastName: "Else", phone: "5405550111" });
  expect(r.status).toBe(200);
  expect(r.body).toEqual({ id: first.id, existing: true });
  const n = await db.prepare("SELECT COUNT(*)::int AS n FROM outreach_contacts WHERE phone = '+15405550111'").get();
  expect(n.n).toBe(1);
  // the existing record is not overwritten by the second name
  expect((await db.prepare("SELECT first_name FROM outreach_contacts WHERE id = ?").get(first.id)).first_name).toBe("Jane");
});

test.each([
  ["no name", { phone: "540-555-0122" }],
  ["short number", { firstName: "Al", phone: "555-0122" }],
  ["international", { firstName: "Al", phone: "+44 20 7946 0958" }],
])("refuses %s with a reason", async (_label, body) => {
  const r = await addPerson(body);
  expect(r.status).toBe(400);
  expect(typeof r.body.error).toBe("string");
});

test("shows up in the list like an imported person", async () => {
  const d = (await h.request.get("/api/admin/outreach").set(A())).body;
  const jane = d.contacts.find((c) => c.phone === "+15405550111");
  expect(jane).toBeTruthy();
  expect(jane.status).toBe("new");
});
