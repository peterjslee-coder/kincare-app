/**
 * v1.125.3 — Pete, 10/28: "I want the block off texting turned off. I have a transcript and a
 * recorded call saying 'yes, I would like more information' and that's good enough to defend.
 * … log it as an override … I'm not going to text anyone who doesn't say, like Doris, 'yeah, yeah
 * I would like more info' to the question 'is it ok if I text you some more info?'"
 *
 * What must hold: the OK needs their words; it is logged as an admin override with who and which
 * call; a call from another thread is refused; an opt-out is never overridden; after it, texting works.
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
const { v4: uuid } = require("uuid");
const { startHarness, stopHarness } = require("./harness");
jest.setTimeout(180000);

let h, db, admin;
beforeAll(async () => {
  h = await startHarness({ routers: { "/api/admin/outreach": "../../src/routes/outreach" } });
  db = h.db;
  admin = await h.createUser({ firstName: "Pete", isAdmin: true });
  await db.prepare("UPDATE users SET is_admin = 1 WHERE id = ?").run(admin.user.id);
});
afterAll(async () => { await stopHarness(h); });
const A = () => h.auth(admin.token);

async function personWithCall(phone) {
  const id = uuid();
  await db.prepare("INSERT INTO outreach_contacts (id, phone, first_name, status) VALUES (?, ?, 'Doris', 'new')").run(id, phone);
  const callId = uuid();
  await db.prepare("INSERT INTO outreach_messages (id, contact_id, direction, body, status, kind, created_at) VALUES (?, ?, 'out', 'Call', 'completed', 'call', NOW())").run(callId, id);
  return { id, callId };
}
const ok = (id, body) => h.request.patch(`/api/admin/outreach/${id}`).set(A()).send({ textsOk: true, ...body });

test("no words, no OK", async () => {
  const p = await personWithCall("+15405550401");
  expect((await ok(p.id, {})).status).toBe(400);
  expect((await ok(p.id, { evidence: "  " })).status).toBe(400);
  expect((await db.prepare("SELECT texts_ok_at FROM outreach_contacts WHERE id = ?").get(p.id)).texts_ok_at).toBeNull();
});

test("their words + the call = an OK logged as the admin's, and texting opens", async () => {
  const p = await personWithCall("+15405550402");
  const r = await ok(p.id, { evidence: "Yeah, yeah, I would like more info", callMessageId: p.callId });
  expect(r.status).toBe(200);
  const c = await db.prepare("SELECT texts_ok_at, texts_ok_source, texts_ok_by, texts_ok_evidence, texts_ok_message_id FROM outreach_contacts WHERE id = ?").get(p.id);
  expect(c.texts_ok_at).not.toBeNull();
  expect(c).toMatchObject({ texts_ok_source: "recorded_call", texts_ok_by: admin.user.id, texts_ok_message_id: p.callId });
  expect(c.texts_ok_evidence).toBe("Said on the recorded call: “Yeah, yeah, I would like more info”");
  const t = await h.request.post(`/api/admin/outreach/${p.id}/messages`).set(A()).send({ body: "Hi Doris, here's the info. Reply STOP to opt out." });
  expect(t.status).toBe(200);
  expect(sent.map((x) => x.to)).toContain("+15405550402");
});

test("a call from someone else's thread is refused", async () => {
  const a = await personWithCall("+15405550403");
  const b = await personWithCall("+15405550404");
  expect((await ok(a.id, { evidence: "sure, text me", callMessageId: b.callId })).status).toBe(400);
  expect((await db.prepare("SELECT texts_ok_at FROM outreach_contacts WHERE id = ?").get(a.id)).texts_ok_at).toBeNull();
});

test("without a call it is still allowed, and says so", async () => {
  const id = uuid();
  await db.prepare("INSERT INTO outreach_contacts (id, phone, first_name, status) VALUES (?, '+15405550405', 'Al', 'new')").run(id);
  expect((await ok(id, { evidence: "yes please" })).status).toBe(200);
  const c = await db.prepare("SELECT texts_ok_source, texts_ok_evidence FROM outreach_contacts WHERE id = ?").get(id);
  expect(c).toMatchObject({ texts_ok_source: "admin_override", texts_ok_evidence: "Recorded by admin: “yes please”" });
});

test("an opt-out is never overridden", async () => {
  const p = await personWithCall("+15405550406");
  await db.prepare("UPDATE outreach_contacts SET status = 'opted_out', opted_out_at = NOW() WHERE id = ?").run(p.id);
  expect((await ok(p.id, { evidence: "yes", callMessageId: p.callId })).status).toBe(400);
  expect((await db.prepare("SELECT texts_ok_at FROM outreach_contacts WHERE id = ?").get(p.id)).texts_ok_at).toBeNull();
});
