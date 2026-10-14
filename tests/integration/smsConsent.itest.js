/**
 * v1.114.5 — text reminders need a recorded opt-in for the CURRENT number (carrier A2P rule).
 */
const { startHarness, stopHarness } = require("./harness");
const { consentedSql } = require("../../src/utils/smsConsent");
jest.setTimeout(180000);
let h, db, leader, teamId, recipientId;

beforeAll(async () => {
  h = await startHarness({ routers: { "/api/care-teams": "../../src/routes/careTeams" } });
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

test("with the box, consent is recorded for that number", async () => {
  expect((await put({ smsPhone: "540-555-0101", notificationChannel: "sms", smsConsent: true })).status).toBe(200);
  expect(await consented()).toBe(true);
  // Saving again with the same number needs no new tick.
  expect((await put({ smsPhone: "(540) 555-0101", notificationChannel: "both" })).status).toBe(200);
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
