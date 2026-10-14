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

/**
 * v1.115.0 — account holders (caregivers, family) get visit texts only if they turned them on
 * in Account → Notifications. Pete, 10/14: "the default should be off ... require push
 * notifications." Push carries every one of these alerts already; text is an opt-in extra.
 * Consent, like the care recipient's, is tied to the number it was given for.
 */
const ACCOUNT_CONSENT_TEXT =
  "Text me visit alerts from InPlace Care (check-in reminders, a caregiver running late). " +
  "Msg & data rates may apply. Msg frequency varies. Reply STOP to opt out, HELP for help. " +
  "Terms: yourinplace.com/sms";

function accountConsentedSql(u) {
  return `(${u}.sms_alerts_consent_at IS NOT NULL AND ${digits10(`${u}.sms_alerts_phone`)} = ${digits10(`${u}.phone`)} AND ${digits10(`${u}.phone`)} <> '')`;
}

/** The number to text this account holder at, or null if they haven't turned text alerts on. */
async function accountSmsPhone(db, userId) {
  if (!userId) return null;
  const row = await db.prepare(`SELECT u.phone, ${accountConsentedSql("u")} AS ok FROM users u WHERE u.id = ?`).get(userId);
  return row && row.ok ? row.phone : null;
}

module.exports = { CONSENT_TEXT, consentedSql, samePhone, ACCOUNT_CONSENT_TEXT, accountConsentedSql, accountSmsPhone };
