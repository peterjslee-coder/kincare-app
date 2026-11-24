/**
 * v1.115.0 — account-holder visit texts are OFF by default and need consent for the current number.
 */
const { startHarness, stopHarness } = require("./harness");
const { accountSmsPhone } = require("../../src/utils/smsConsent");
jest.setTimeout(180000);
let h, db, cg;

beforeAll(async () => {
  h = await startHarness({ routers: { "/api/auth": "../../src/routes/auth" } });
  db = h.db;
  cg = await h.createUser({ firstName: "Cara", lastName: "Giver", roles: ["caregiver"] });
  await db.prepare("UPDATE users SET phone = '540-555-0111' WHERE id = ?").run(cg.user.id);
});
afterAll(async () => { await stopHarness(h); });

const put = (body) => h.request.put("/api/auth/me/sms-alerts").set(h.auth(cg.token)).send(body);

test("off by default — no number to text", async () => {
  expect(await accountSmsPhone(db, cg.user.id)).toBeNull();
  const me = await h.request.get("/api/auth/me").set(h.auth(cg.token));
  expect(me.body.user ? me.body.user.sms_alerts_on : me.body.sms_alerts_on).toBe(false);
});

test("turning on without consent is refused", async () => {
  expect((await put({ enabled: true })).status).toBe(400);
  expect(await accountSmsPhone(db, cg.user.id)).toBeNull();
});

test("with consent it's on, for that number only", async () => {
  const r = await put({ enabled: true, consent: true });
  expect(r.status).toBe(200);
  expect(r.body.smsAlertsOn).toBe(true);
  expect(await accountSmsPhone(db, cg.user.id)).toBe("540-555-0111");
  await db.prepare("UPDATE users SET phone = '540-555-0199' WHERE id = ?").run(cg.user.id);
  expect(await accountSmsPhone(db, cg.user.id)).toBeNull();
});

test("turning off clears it", async () => {
  await db.prepare("UPDATE users SET phone = '540-555-0111' WHERE id = ?").run(cg.user.id);
  await put({ enabled: true, consent: true });
  expect((await put({ enabled: false })).body.smsAlertsOn).toBe(false);
  expect(await accountSmsPhone(db, cg.user.id)).toBeNull();
});
