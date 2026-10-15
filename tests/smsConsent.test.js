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

// v1.120.2 — the recipient's own YES is the second step.
const { RECIPIENT_CONFIRM_TEXT, RECIPIENT_CONFIRMED_TEXT, isYes } = require("../src/utils/smsConsent");

test("sending is gated on the recipient's YES for the current number", () => {
  const sql = consentedSql("cr");
  expect(sql).toMatch(/cr\.sms_confirmed_at IS NOT NULL/);
  expect(sql).toMatch(/cr\.sms_confirmed_phone/);
});

test("the confirmation text names InPlace, asks for YES, and carries STOP/HELP and rates", () => {
  const t = RECIPIENT_CONFIRM_TEXT("Jane", "Sam");
  expect(t).toMatch(/^InPlace Care: Hi Jane, Sam asked us to text you reminders/);
  for (const re of [/Reply YES/, /Msg & data rates may apply/, /Msg frequency varies/, /STOP/, /HELP/]) expect(t).toMatch(re);
  expect(t.length).toBeLessThanOrEqual(306); // two segments at most
  expect(RECIPIENT_CONFIRM_TEXT(null, null)).toMatch(/^InPlace Care: Hi, your family asked/);
  expect(RECIPIENT_CONFIRMED_TEXT).toMatch(/STOP/);
});

test.each(["YES", "yes", " Yes. ", "y", "Yes!", "ok", "Okay"])("%s is a yes", (b) => expect(isYes(b)).toBe(true));
test.each(["yes but call me", "no", "", "yesterday", "STOP"])("%s is not a yes", (b) => expect(isYes(b)).toBe(false));
