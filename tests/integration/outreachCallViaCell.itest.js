/**
 * v1.125.5 — outreach calls through the admin's own cell, so a locked screen doesn't end them.
 * Pete, 10/28: "The calls have to be able to continue while the phone screen is locked."
 *
 * Must hold: the call rings the ADMIN first, from the outreach number; nothing is dialed until a
 * person presses 1 (a voicemail box answers calls too); the caregiver is dialed from the outreach
 * number with the same recording as the browser call; an unanswered ring says so in the thread;
 * only an admin can start it, and only to a dialable US number.
 */
process.env.TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || "itest-twilio-token";
const mockCreated = [];
jest.mock("../../src/utils/sms", () => {
  const actual = jest.requireActual("../../src/utils/sms");
  return {
    ...actual,
    outreachNumber: () => "+15405550100",
    getTwilio: () => ({ calls: { create: async (o) => { mockCreated.push(o); return { sid: `CAbridge${mockCreated.length}` }; } } }),
  };
});
jest.mock("../../src/routes/push", () => ({ notifyAdmins: jest.fn(async () => {}), sendPushToAdmins: jest.fn(async () => {}) }));
const twilio = require("twilio");
const { v4: uuid } = require("uuid");
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
  admin = await h.createUser({ firstName: "Pete", isAdmin: true });
  await db.prepare("UPDATE users SET is_admin = 1, phone = '(540) 555-0177' WHERE id = ?").run(admin.user.id);
  stranger = await h.createUser({ firstName: "Not" });
  jest.spyOn(O, "introWindow").mockReturnValue({ open: true, reason: null });
});
afterAll(async () => { await stopHarness(h); });

const A = () => h.auth(admin.token);
const hook = (path, params) => {
  const sig = twilio.getExpectedTwilioSignature(process.env.TWILIO_AUTH_TOKEN, `${APP_URL}${path}`, params);
  return h.request.post(path).set("X-Twilio-Signature", sig).type("form").send(params);
};
async function person(phone) {
  const id = uuid();
  await db.prepare("INSERT INTO outreach_contacts (id, phone, first_name, status) VALUES (?, ?, 'Doris', 'new')").run(id, phone);
  return id;
}
const row = (id) => db.prepare("SELECT body, status, twilio_sid FROM outreach_messages WHERE id = ?").get(id);

test("only an admin can start one", async () => {
  const id = await person("+15405550501");
  expect([401, 403]).toContain((await h.request.post(`/api/admin/outreach/${id}/call-via-cell`).set(h.auth(stranger.token)).send({})).status);
  expect(mockCreated).toHaveLength(0);
});

test("it rings the admin's cell from the outreach number — not the caregiver", async () => {
  const id = await person("+15405550502");
  const r = await h.request.post(`/api/admin/outreach/${id}/call-via-cell`).set(A()).send({});
  expect(r.status).toBe(200);
  expect(r.body.ringing).toBe("…0177");
  const c = mockCreated[mockCreated.length - 1];
  expect(c).toMatchObject({ to: "+15405550177", from: "+15405550100" });
  expect(c.url).toBe(`${APP_URL}/api/sms/outreach-bridge/${r.body.messageId}`);
  expect(await row(r.body.messageId)).toMatchObject({ status: "calling_you", twilio_sid: `CAbridge${mockCreated.length}` });
});

test("answering asks for 1; only 1 dials the caregiver, from the outreach number, recorded", async () => {
  const id = await person("+15405550503");
  const { body } = await h.request.post(`/api/admin/outreach/${id}/call-via-cell`).set(A()).send({});
  const answer = await hook(`/api/sms/outreach-bridge/${body.messageId}`, { CallSid: "CAx", CallStatus: "in-progress" });
  expect(answer.text).toMatch(/<Gather numDigits="1"/);
  expect(answer.text).toMatch(/Press 1 to connect/);
  expect(answer.text).not.toMatch(/<Dial/);
  const wrong = await hook(`/api/sms/outreach-bridge/${body.messageId}/go`, { CallSid: "CAx", Digits: "2" });
  expect(wrong.text).not.toMatch(/<Dial/);
  expect((await row(body.messageId)).status).toBe("calling_you");
  const go = await hook(`/api/sms/outreach-bridge/${body.messageId}/go`, { CallSid: "CAx", Digits: "1" });
  expect(go.text).toMatch(/<Dial callerId="\+15405550100"/);
  expect(go.text).toMatch(/record="record-from-answer-dual"/);
  expect(go.text).toMatch(/<Number>\+15405550503<\/Number>/);
  expect((await row(body.messageId)).status).toBe("calling");
  // a second "1" (a replayed webhook) dials nothing
  const again = await hook(`/api/sms/outreach-bridge/${body.messageId}/go`, { CallSid: "CAx", Digits: "1" });
  expect(again.text).not.toMatch(/<Dial/);
});

test("an unforged signature is required", async () => {
  const id = await person("+15405550504");
  const { body } = await h.request.post(`/api/admin/outreach/${id}/call-via-cell`).set(A()).send({});
  const r = await h.request.post(`/api/sms/outreach-bridge/${body.messageId}/go`).type("form").send({ Digits: "1" });
  expect(r.status).toBe(403);
});

test("if the admin doesn't pick up, the thread says so", async () => {
  const id = await person("+15405550505");
  const { body } = await h.request.post(`/api/admin/outreach/${id}/call-via-cell`).set(A()).send({});
  await hook(`/api/sms/outreach-bridge-status/${body.messageId}`, { CallSid: "CAy", CallStatus: "no-answer" });
  expect((await row(body.messageId)).body).toBe("Call · you didn't pick up");
});

test("no cell on the admin's account: a clear error, nothing rings", async () => {
  await db.prepare("UPDATE users SET phone = NULL WHERE id = ?").run(admin.user.id);
  const before = mockCreated.length;
  const id = await person("+15405550506");
  const r = await h.request.post(`/api/admin/outreach/${id}/call-via-cell`).set(A()).send({});
  expect(r.status).toBe(400);
  expect(r.body.error).toMatch(/Add your cell number/);
  expect(mockCreated.length).toBe(before);
  await db.prepare("UPDATE users SET phone = '(540) 555-0177' WHERE id = ?").run(admin.user.id);
});

test("never a short code", async () => {
  const id = uuid();
  await db.prepare("INSERT INTO outreach_contacts (id, phone, first_name, status) VALUES (?, '911', 'X', 'new')").run(id);
  const r = await h.request.post(`/api/admin/outreach/${id}/call-via-cell`).set(A()).send({});
  expect(r.status).toBe(400);
});
