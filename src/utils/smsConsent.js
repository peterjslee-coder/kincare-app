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

/** SQL boolean: the leader's box is ticked for the number currently stored (step 1 of 2). */
function requestedSql(a) {
  return `(${a}.sms_consent_at IS NOT NULL AND ${digits10(`${a}.sms_consent_phone`)} = ${digits10(`${a}.sms_phone`)} AND ${digits10(`${a}.sms_phone`)} <> '')`;
}

/**
 * SQL boolean: texts may go to this care recipient. `a` = care_recipients alias.
 *
 * v1.120.2 — two steps, not one. Carriers rejected both A2P campaigns on 10/15 (error 30909)
 * for want of proof of the in-app opt-in, and the reminder campaign's opt-in was one person
 * (the family leader) ticking a box for another (the care recipient). So the box now only ASKS:
 * InPlace texts the recipient's own phone once (RECIPIENT_CONFIRM_TEXT) and nothing else is sent
 * until that phone replies YES. Both steps are tied to the number currently stored.
 */
function consentedSql(a) {
  return `(${requestedSql(a)} AND ${a}.sms_confirmed_at IS NOT NULL AND ${digits10(`${a}.sms_confirmed_phone`)} = ${digits10(`${a}.sms_phone`)})`;
}

/** The one text sent to a care recipient's phone before any reminder. Registered with carriers. */
const RECIPIENT_CONFIRM_TEXT = (recipientFirst, requesterFirst) =>
  `InPlace Care: Hi${recipientFirst ? " " + recipientFirst : ""}, ${requesterFirst || "your family"} asked us to text you reminders before each care visit. ` +
  "Reply YES to start. Msg & data rates may apply. Msg frequency varies. Reply STOP to opt out, HELP for help.";

/** Sent back when the recipient replies YES. */
const RECIPIENT_CONFIRMED_TEXT =
  "InPlace Care: You're all set. We'll text you reminders before each visit. Reply STOP to opt out, HELP for help.";

/** YES, Y, yes!, "Yes." — a reply that is only a yes. */
const isYes = (body) => /^\s*(yes|y|yes please|ok|okay)[\s.!]*$/i.test(String(body || ""));

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

module.exports = {
  CONSENT_TEXT, consentedSql, requestedSql, samePhone, ACCOUNT_CONSENT_TEXT, accountConsentedSql, accountSmsPhone,
  RECIPIENT_CONFIRM_TEXT, RECIPIENT_CONFIRMED_TEXT, isYes, digits10,
};
