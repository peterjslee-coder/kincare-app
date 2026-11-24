/**
 * v1.114.5 — text reminders need a recorded opt-in for the CURRENT number (carrier A2P rule).
 */
process.env.TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || "itest-twilio-token";
const sent = [];
jest.mock("../../src/utils/sms", () => {
  const actual = jest.requireActual("../../src/utils/sms");
  return { ...actual, sendSms: jest.fn(async (to, body) => { sent.push({ to, body }); return { success: true, sid: `SMc${sent.length}` }; }) };
});
const twilio = require("twilio");
const { startHarness, stopHarness } = require("./harness");
const { consentedSql } = require("../../src/utils/smsConsent");
const APP_URL = (process.env.APP_URL || "https://yourinplace.com").replace(/\/+$/, "");
jest.setTimeout(180000);
let h, db, leader, teamId, recipientId;

beforeAll(async () => {
  h = await startHarness({ routers: { "/api/care-teams": "../../src/routes/careTeams", "/api/sms": "../../src/routes/smsWebhooks" } });
  db = h.db;
  leader = await h.createUser({ firstName: "Lea", lastName: "Der", roles: ["family"] });
  ({ teamId, recipientId } = await h.createCareTeam({ familyUserId: leader.user.id }));
});
afterAll(async () => { await stopHarness(h); });

const put = (body) => h.request.put(`/api/care-teams/${teamId}/recipient-notifications`).set(h.auth(leader.token)).send(body);
const consented = async () =>
  (await db.prepare(`SELECT ${consentedSql("cr")} AS ok FROM care_recipients cr WHERE cr.id = ?`).get(recipientId)).ok;

test("Text without the consent box is refused and nothing is saved", async () => {
  const r = await put({ smsPhone: "540-555-0101", notificationChannel: "sms" });
  expect(r.status).toBe(400);
  const row = await db.prepare("SELECT notification_channel, sms_consent_at FROM care_recipients WHERE id = ?").get(recipientId);
  expect(row.sms_consent_at).toBeNull();
  expect(row.notification_channel).not.toBe("sms");
});

const inbound = (from, body) => {
  const params = { From: from, To: "+15402741412", Body: body, MessageSid: `SMin${Math.random()}` };
  const sig = twilio.getExpectedTwilioSignature(process.env.TWILIO_AUTH_TOKEN, `${APP_URL}/api/sms/reminders-inbound`, params);
  return h.request.post("/api/sms/reminders-inbound").set("X-Twilio-Signature", sig).type("form").send(params);
};
const teamView = async () => (await h.request.get(`/api/care-teams/${teamId}`).set(h.auth(leader.token))).body;

test("with the box, InPlace texts the recipient once, and nothing is sendable until she replies YES", async () => {
  const r = await put({ smsPhone: "540-555-0101", notificationChannel: "sms", smsConsent: true });
  expect(r.status).toBe(200);
  expect(r.body.awaitingYes).toBe(true);
  expect(sent).toHaveLength(1);
  expect(sent[0].to).toBe("540-555-0101");
  expect(sent[0].body).toMatch(/^InPlace Care: Hi .*, Lea asked us to text you reminders .*Reply YES/);
  expect(await consented()).toBe(false);
  const v = await teamView();
  const t = v.careTeam || v;
  expect(t.recipient_sms_awaiting_yes).toBe(true);
  // Saving again with the same number needs no new tick and sends no second text.
  expect((await put({ smsPhone: "(540) 555-0101", notificationChannel: "both" })).status).toBe(200);
  expect(sent).toHaveLength(1);
  // Resend inside 10 minutes is refused.
  expect((await h.request.post(`/api/care-teams/${teamId}/recipient-notifications/resend-confirm`).set(h.auth(leader.token))).status).toBe(429);
});

test("an unsigned reply is refused; a YES from another number confirms nothing", async () => {
  expect((await h.request.post("/api/sms/reminders-inbound").type("form").send({ From: "+15405550101", Body: "YES" })).status).toBe(403);
  await inbound("+15405550999", "YES");
  expect(await consented()).toBe(false);
});

test("her YES turns reminders on and gets a confirmation back", async () => {
  const r = await inbound("+15405550101", "Yes!");
  expect(r.status).toBe(200);
  expect(r.text).toMatch(/<Message>InPlace Care: You're all set/);
  expect(await consented()).toBe(true);
});

test("STOP clears her consent and an account holder's alerts on that number", async () => {
  const other = await h.createUser({ firstName: "Al", lastName: "Erts", roles: ["family"] });
  await db.prepare("UPDATE users SET phone = '5405550101', sms_alerts_consent_at = NOW(), sms_alerts_phone = '5405550101' WHERE id = ?").run(other.user.id);
  await inbound("+15405550101", "STOP");
  expect(await consented()).toBe(false);
  const u = await db.prepare("SELECT sms_alerts_consent_at FROM users WHERE id = ?").get(other.user.id);
  expect(u.sms_alerts_consent_at).toBeNull();
  // Re-ticking for the same number asks her again.
  const before = sent.length;
  expect((await put({ smsPhone: "540-555-0101", notificationChannel: "sms", smsConsent: true })).status).toBe(200);
  expect(sent.length).toBe(before + 1);
});

test("a different number needs consent again, and the send gate closes for it", async () => {
  expect((await put({ smsPhone: "540-555-0199", notificationChannel: "sms" })).status).toBe(400);
  // Someone changes the number elsewhere (care profile edit) — the gate must close.
  await db.prepare("UPDATE care_recipients SET sms_phone = '540-555-0199' WHERE id = ?").run(recipientId);
  expect(await consented()).toBe(false);
});

test("push-only needs no consent", async () => {
  expect((await put({ smsPhone: "", notificationChannel: "push" })).status).toBe(200);
});
