/**
 * v1.113.0 — caregiver outreach, end to end against a real Postgres: import → intro text →
 * a reply comes back through the Twilio webhook → an email reply mints a signup invite →
 * STOP is final. Twilio and email are stubbed; the SQL and the routes are real.
 */
process.env.TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || "itest-twilio-token";

const sent = [];
jest.mock("../../src/utils/sms", () => {
  const actual = jest.requireActual("../../src/utils/sms");
  return {
    ...actual,
    outreachNumber: () => "+15405550100",
    sendSms: jest.fn(async (to, body, opts) => {
      sent.push({ to, body, opts });
      return { success: true, sid: `SMitest${sent.length}`, status: "queued" };
    }),
  };
});
const emails = [];
jest.mock("../../src/utils/email", () => {
  const actual = jest.requireActual("../../src/utils/email");
  return { ...actual, sendEmail: jest.fn(async (m) => { emails.push(m); return { success: true }; }) };
});
jest.mock("../../src/routes/push", () => ({
  notifyAdmins: jest.fn(async () => {}),
  sendPushToAdmins: jest.fn(async () => {}),
}));

const twilio = require("twilio");
const O = require("../../src/utils/outreach");
const { startHarness, stopHarness } = require("./harness");
jest.setTimeout(180000);

let h, db, admin, stranger;
const APP_URL = (process.env.APP_URL || "https://yourinplace.com").replace(/\/+$/, "");

beforeAll(async () => {
  h = await startHarness({ routers: {
    "/api/admin/outreach": "../../src/routes/outreach",
    "/api/sms": "../../src/routes/smsWebhooks",
  } });
  db = h.db;
  admin = await h.createUser({ firstName: "Ad", lastName: "Min", isAdmin: true });
  await db.prepare("UPDATE users SET is_admin = 1 WHERE id = ?").run(admin.user.id);
  stranger = await h.createUser({ firstName: "Not", lastName: "Admin" });
  jest.spyOn(O, "introWindow").mockReturnValue({ open: true, reason: null });
});
afterAll(async () => { await stopHarness(h); });

const A = () => h.auth(admin.token);
const inbound = (from, body, sid) => {
  const params = { From: from, To: "+15405550100", Body: body, MessageSid: sid || `SMin${Math.random()}` };
  const url = `${APP_URL}/api/sms/outreach-inbound`;
  const sig = twilio.getExpectedTwilioSignature(process.env.TWILIO_AUTH_TOKEN, url, params);
  return h.request.post("/api/sms/outreach-inbound").set("X-Twilio-Signature", sig).type("form").send(params);
};
const list = async () => (await h.request.get("/api/admin/outreach").set(A())).body;
const byPhone = async (p) => (await list()).contacts.find((c) => c.phone === p);
const waitForBatch = async () => {
  for (let i = 0; i < 40; i++) {
    if (!(await list()).sending) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("batch never finished");
};

test("only admins can see or use it", async () => {
  expect([401, 403]).toContain((await h.request.get("/api/admin/outreach").set(h.auth(stranger.token))).status);
});

test("import parses the list, merges a shared number, and skips repeats", async () => {
  const text = [
    "Doe, Jane……………………..540-555-0101 (CNA)",
    "Roe, Mary ............ 540-555-0102",
    "Sample, Emmett………………..540-555-0103 (CNA)",
    "Sample, Rocky……………………540-555-0103 (PCA)",
    "PRIVATE PAY AGENCIES",
  ].join("\n");
  const r = await h.request.post("/api/admin/outreach/import").set(A()).send({ text, source: "itest" });
  expect(r.status).toBe(200);
  expect(r.body).toMatchObject({ added: 3, duplicates: 0 });
  expect(r.body.skipped).toEqual(["PRIVATE PAY AGENCIES"]);
  const again = await h.request.post("/api/admin/outreach/import").set(A()).send({ text });
  expect(again.body).toMatchObject({ added: 0, duplicates: 3 });
  const d = await list();
  expect(d.number).toBe("+15405550100");
  expect(d.contacts.map((c) => c.status)).toEqual(["new", "new", "new"]);
});

test("an intro without an opt-out line is refused", async () => {
  const c = await byPhone("+15405550101");
  const r = await h.request.post("/api/admin/outreach/send-intro").set(A()).send({ ids: [c.id], template: "Hi {first}" });
  expect(r.status).toBe(400);
  expect(sent).toHaveLength(0);
});

test("the intro goes out from the outreach number, personalised, once", async () => {
  const ids = (await list()).contacts.map((c) => c.id);
  const r = await h.request.post("/api/admin/outreach/send-intro").set(A()).send({ ids, template: O.DEFAULT_INTRO });
  expect(r.status).toBe(200);
  expect(r.body.queued).toBe(3);
  await waitForBatch();
  expect(sent).toHaveLength(3);
  expect(sent.every((s) => s.opts.from === "+15405550100")).toBe(true);
  expect(sent.find((s) => s.to === "+15405550101").body).toMatch(/^Hi Jane, /);
  expect(sent.find((s) => s.to === "+15405550103").body).toMatch(/^Hi Emmett & Rocky, /);
  expect((await list()).contacts.every((c) => c.status === "texted")).toBe(true);
  // A second batch to the same people sends nothing.
  const again = await h.request.post("/api/admin/outreach/send-intro").set(A()).send({ ids, template: O.DEFAULT_INTRO });
  expect(again.status).toBe(400);
  expect(sent).toHaveLength(3);
});

test("an unsigned webhook is refused", async () => {
  const r = await h.request.post("/api/sms/outreach-inbound").type("form").send({ From: "+15405550101", Body: "hi" });
  expect(r.status).toBe(403);
});

test("a plain reply lands in her thread as unread", async () => {
  const r = await inbound("+15405550102", "Who is this?");
  expect(r.status).toBe(200);
  expect(r.text).toBe("<Response></Response>");
  const c = await byPhone("+15405550102");
  expect(c.status).toBe("replied");
  expect(c.unread).toBe(1);
  const t = await h.request.get(`/api/admin/outreach/${c.id}/messages`).set(A());
  expect(t.body.messages.map((m) => [m.direction, m.body])).toEqual([["out", expect.stringMatching(/^Hi Mary/)], ["in", "Who is this?"]]);
  expect((await byPhone("+15405550102")).unread).toBe(0); // opening it marks it read
});

test("an email reply mints a caregiver invite, emails it, and texts a thank-you", async () => {
  const before = sent.length;
  await inbound("+15405550101", "Sure, it's Jane.Doe@Example.com");
  // The invite work happens after the 200 goes back to Twilio.
  for (let i = 0; i < 40 && sent.length === before; i++) await new Promise((r) => setTimeout(r, 100));
  const c = await byPhone("+15405550101");
  expect(c.email).toBe("jane.doe@example.com");
  expect(c.status).toBe("invited");
  const inv = await db.prepare("SELECT * FROM platform_invites WHERE id = ?").get(c.invite_id);
  expect(inv).toMatchObject({ invited_email: "jane.doe@example.com", role: "caregiver", kind: "outreach", status: "pending", phone: "+15405550101" });
  expect(emails.at(-1).to).toBe("jane.doe@example.com");
  expect(emails.at(-1).html).toContain(`platformInvite=${inv.token}`);
  expect(sent.at(-1)).toMatchObject({ to: "+15405550101" });
  expect(sent.at(-1).body).toMatch(/Thanks, Jane! We just emailed jane\.doe@example\.com/);
  // Sending the same email again reuses the same link.
  await inbound("+15405550101", "jane.doe@example.com");
  await new Promise((r) => setTimeout(r, 300));
  const n = await db.prepare("SELECT COUNT(*)::int AS n FROM platform_invites WHERE LOWER(invited_email) = 'jane.doe@example.com'").get();
  expect(n.n).toBe(1);
});

test("STOP is final: nothing can text her, and admin can't clear it", async () => {
  await inbound("+15405550103", "STOP");
  const c = await byPhone("+15405550103");
  expect(c.status).toBe("opted_out");
  const before = sent.length;
  const r = await h.request.post(`/api/admin/outreach/${c.id}/messages`).set(A()).send({ body: "Just checking" });
  expect(r.status).toBe(400);
  const p = await h.request.patch(`/api/admin/outreach/${c.id}`).set(A()).send({ status: "texted" });
  expect(p.status).toBe(400);
  // Even the automated thank-you is refused at the one place texts leave.
  await inbound("+15405550103", "actually it's sam@example.com");
  await new Promise((r) => setTimeout(r, 300));
  expect(sent.length).toBe(before);
  // START is hers to send.
  await inbound("+15405550103", "START");
  expect((await byPhone("+15405550103")).status).toBe("replied");
});

test("JOIN from a number we never texted is an opt-in: InPlace answers and asks for an email", async () => {
  const before = sent.length;
  await inbound("+15405550177", "Join");
  for (let i = 0; i < 40 && sent.length === before; i++) await new Promise((r) => setTimeout(r, 100));
  const c = await byPhone("+15405550177");
  expect(c).toMatchObject({ source: "inbound", status: "replied", unread: 0 });
  expect(sent.at(-1)).toMatchObject({ to: "+15405550177", body: O.JOIN_REPLY });
});

test("a text from a number we never imported still gets a thread", async () => {
  await inbound("+15405550199", "My friend said you're hiring?");
  const c = await byPhone("+15405550199");
  expect(c).toMatchObject({ source: "inbound", status: "replied", unread: 1 });
});

test("delivery receipts update the message", async () => {
  const params = { MessageSid: "SMitest1", MessageStatus: "undelivered", ErrorCode: "30007" };
  const url = `${APP_URL}/api/sms/outreach-status`;
  const sig = twilio.getExpectedTwilioSignature(process.env.TWILIO_AUTH_TOKEN, url, params);
  const r = await h.request.post("/api/sms/outreach-status").set("X-Twilio-Signature", sig).type("form").send(params);
  expect(r.status).toBe(204);
  const m = await db.prepare("SELECT status, error FROM outreach_messages WHERE twilio_sid = 'SMitest1'").get();
  expect(m).toEqual({ status: "undelivered", error: "Twilio error 30007" });
});

test("someone who already has an account shows as on InPlace", async () => {
  const u = await h.createUser({ firstName: "Mary", lastName: "Roe" });
  await db.prepare("UPDATE users SET phone = ? WHERE id = ?").run("(540) 555-0102", u.user.id);
  expect((await byPhone("+15405550102")).status).toBe("joined");
});
