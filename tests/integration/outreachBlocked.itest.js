/**
 * v1.135.3 — Pete, 11/19: "i just got a reply with a buffalo wild wings thing to the outreach
 * number" … "block option?". A machine-sent text from an unknown number (a sign-in code) is filed
 * as blocked — no OK to text, no unread, no auto-reply; and Pete can block / unblock any number:
 * blocked = no texting, no calling, inbound kept silently, inbound calls get a busy signal.
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
const pushes = [];
jest.mock("../../src/routes/push", () => ({
  notifyAdmins: jest.fn(async (...a) => { pushes.push(a); }),
  sendPushToAdmins: jest.fn(async (...a) => { pushes.push(a); }),
}));

const twilio = require("twilio");
const O = require("../../src/utils/outreach");
const { startHarness, stopHarness } = require("./harness");
jest.setTimeout(180000);

let h, db, admin;
const APP_URL = (process.env.APP_URL || "https://yourinplace.com").replace(/\/+$/, "");

beforeAll(async () => {
  h = await startHarness({ routers: {
    "/api/admin/outreach": "../../src/routes/outreach",
    "/api/sms": "../../src/routes/smsWebhooks",
  } });
  db = h.db;
  admin = await h.createUser({ firstName: "Ad", lastName: "Min", isAdmin: true });
  await db.prepare("UPDATE users SET is_admin = 1 WHERE id = ?").run(admin.user.id);
  jest.spyOn(O, "introWindow").mockReturnValue({ open: true, reason: null });
});
afterAll(async () => { await stopHarness(h); });

const A = () => h.auth(admin.token);
const signedPost = (path, params) => {
  const sig = twilio.getExpectedTwilioSignature(process.env.TWILIO_AUTH_TOKEN, `${APP_URL}${path}`, params);
  return h.request.post(path).set("X-Twilio-Signature", sig).type("form").send(params);
};
const inbound = (from, body) => signedPost("/api/sms/outreach-inbound", { From: from, To: "+15405550100", Body: body, MessageSid: `SMin${Math.random()}` });
const row = (phone) => db.prepare("SELECT * FROM outreach_contacts WHERE phone = ?").get(phone);

test("a sign-in code from an unknown number is filed as blocked, not as a reply", async () => {
  pushes.length = 0; sent.length = 0;
  const r = await inbound("+15405550199", "Your verification code for Buffalo Wild Wings is 6884.");
  expect(r.status).toBe(200);
  const c = await row("+15405550199");
  expect(c.blocked_at).toBeTruthy();
  expect(c.blocked_reason).toBe("automated");
  expect(c.texts_ok_at).toBeNull();
  expect(Number(c.unread)).toBe(0);
  expect(pushes).toHaveLength(0);
  expect(sent).toHaveLength(0);
  const msgs = await db.prepare("SELECT body, status FROM outreach_messages WHERE contact_id = ?").all(c.id);
  expect(msgs).toEqual([{ body: "Your verification code for Buffalo Wild Wings is 6884.", status: "blocked" }]);
  // Out of the main list's counts, behind the Blocked chip — but still listed, with blocked_at.
  const list = (await h.request.get("/api/admin/outreach").set(A())).body.contacts;
  expect(list.find((x) => x.id === c.id).blocked_at).toBeTruthy();
});

test("an email inside a blocked number's text never mints an invite or a reply", async () => {
  sent.length = 0;
  await inbound("+15405550199", "Questions? write support@example.com. Reply STOP to unsubscribe");
  const c = await row("+15405550199");
  expect(c.email).toBeNull();
  expect(sent).toHaveLength(0);
});

test("a real person texting in is untouched", async () => {
  pushes.length = 0;
  await inbound("+15405550198", "Hi, I saw your number at the agency. I'm looking for work");
  const c = await row("+15405550198");
  expect(c.blocked_at).toBeNull();
  expect(c.texts_ok_at).toBeTruthy();
  expect(Number(c.unread)).toBe(1);
  expect(pushes.length).toBeGreaterThan(0);
});

test("Pete blocks a number: OK withdrawn, no texts, no calls, inbound kept silently, calls get busy", async () => {
  const c = await row("+15405550198");
  const b = await h.request.patch(`/api/admin/outreach/${c.id}`).set(A()).send({ blocked: true });
  expect(b.status).toBe(200);
  expect(b.body.contact.blocked_at).toBeTruthy();
  expect(b.body.contact.blocked_reason).toBe("admin");
  expect(b.body.contact.texts_ok_at).toBeNull();
  expect(Number(b.body.contact.unread)).toBe(0);

  const send = await h.request.post(`/api/admin/outreach/${c.id}/messages`).set(A()).send({ body: "hello" });
  expect(send.status).toBe(400);
  expect(send.body.error).toMatch(/blocked/i);
  const call = await h.request.post(`/api/admin/outreach/${c.id}/call-via-cell`).set(A()).send({});
  expect(call.status).toBe(400);

  pushes.length = 0; sent.length = 0;
  await inbound("+15405550198", "JOIN");
  const after = await row("+15405550198");
  expect(Number(after.unread)).toBe(0);
  expect(after.texts_ok_at).toBeNull();
  expect(pushes).toHaveLength(0);
  expect(sent).toHaveLength(0); // no JOIN auto-reply

  const v = await signedPost("/api/sms/outreach-voice", { From: "+15405550198", CallSid: "CAblocked1" });
  expect(v.status).toBe(200);
  expect(v.text).toMatch(/<Reject reason="busy"\/>/);
  const logged = await db.prepare("SELECT COUNT(*)::int AS n FROM outreach_messages WHERE twilio_sid = 'CAblocked1'").get();
  expect(logged.n).toBe(0);
});

test("STOP from a blocked number is still honoured", async () => {
  await inbound("+15405550199", "STOP");
  const c = await row("+15405550199");
  expect(c.status).toBe("opted_out");
  expect(c.opted_out_at).toBeTruthy();
});

test("unblock gives nothing back: texting needs a fresh OK", async () => {
  const c = await row("+15405550198");
  const u = await h.request.patch(`/api/admin/outreach/${c.id}`).set(A()).send({ blocked: false });
  expect(u.status).toBe(200);
  expect(u.body.contact.blocked_at).toBeNull();
  expect(u.body.contact.texts_ok_at).toBeNull();
  const send = await h.request.post(`/api/admin/outreach/${c.id}/messages`).set(A()).send({ body: "hello" });
  expect(send.status).toBe(400);
  expect(send.body.error).toMatch(/No OK to text/);
});
