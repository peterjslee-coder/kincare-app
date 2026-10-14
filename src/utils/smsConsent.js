/**
 * Text-reminder consent for care recipients (v1.114.5).
 *
 * Carrier registration (A2P 10DLC) requires that a number receive texts only after an explicit,
 * recorded opt-in. Until now a leader could type the person's number and pick "Text" and that was
 * that. Now the Notifications screen asks for a checkbox with the wording below, the server
 * refuses to save "Text"/"Both" without it, and every send site checks the consent is on file
 * for THE CURRENT number — change the number and consent must be given again.
 *
 * Wording here is what was described to the carriers in the campaign registration. Change one,
 * change the other.
 */
const CONSENT_TEXT =
  "I agree to receive visit reminders and care notifications by text from InPlace Care. " +
  "Msg & data rates may apply. Msg frequency varies. Reply STOP to opt out, HELP for help. " +
  "Terms: yourinplace.com/sms";

const digits10 = (col) => `RIGHT(REGEXP_REPLACE(COALESCE(${col}, ''), '[^0-9]', '', 'g'), 10)`;

/** SQL boolean: consent is on file for the number currently stored. `a` = care_recipients alias. */
function consentedSql(a) {
  return `(${a}.sms_consent_at IS NOT NULL AND ${digits10(`${a}.sms_consent_phone`)} = ${digits10(`${a}.sms_phone`)} AND ${digits10(`${a}.sms_phone`)} <> '')`;
}

function samePhone(a, b) {
  const k = (s) => String(s || "").replace(/\D/g, "").slice(-10);
  return k(a).length === 10 && k(a) === k(b);
}

module.exports = { CONSENT_TEXT, consentedSql, samePhone };
