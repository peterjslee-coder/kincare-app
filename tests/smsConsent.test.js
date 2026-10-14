// v1.114.5 — text reminders need recorded consent for the CURRENT number.
const { CONSENT_TEXT, consentedSql, samePhone } = require("../src/utils/smsConsent");

test("the consent wording carries every carrier-required element", () => {
  for (const re of [/InPlace Care/, /Msg & data rates may apply/, /Msg frequency varies/, /STOP/, /HELP/, /yourinplace\.com\/sms/]) {
    expect(CONSENT_TEXT).toMatch(re);
  }
});

test("samePhone compares the last ten digits and refuses partial numbers", () => {
  expect(samePhone("(540) 555-0101", "+15405550101")).toBe(true);
  expect(samePhone("540-555-0101", "540-555-0102")).toBe(false);
  expect(samePhone("", "")).toBe(false);
  expect(samePhone("555-0101", "555-0101")).toBe(false);
});

test("consentedSql ties consent to the stored number", () => {
  const sql = consentedSql("cr");
  expect(sql).toMatch(/cr\.sms_consent_at IS NOT NULL/);
  expect(sql).toMatch(/cr\.sms_consent_phone/);
  expect(sql).toMatch(/cr\.sms_phone/);
});
