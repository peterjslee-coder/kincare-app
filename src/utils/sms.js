/**
 * InPlace — SMS Utility
 * Centralized Twilio SMS sending with graceful degradation.
 *
 * If TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER
 * are not set, SMS sending is silently skipped (logged as warning).
 * The app continues to work — SMS is an optional notification channel.
 *
 * Setup: Create a Twilio account at twilio.com, get a phone number,
 * and set the three env vars in Railway dashboard.
 */

let twilioClient = null;
let twilioConfigured = false;

function getTwilio() {
  if (twilioClient) return twilioClient;

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;

  if (!sid || !token || !from) {
    return null;
  }

  try {
    const twilio = require("twilio");
    twilioClient = twilio(sid, token);
    twilioConfigured = true;
    return twilioClient;
  } catch (err) {
    console.error("  [sms] Failed to initialize Twilio:", err.message);
    return null;
  }
}

/**
 * Format a US phone number to E.164 format (+1XXXXXXXXXX).
 * Accepts: (540) 555-1234, 540-555-1234, 5405551234, +15405551234
 * Returns null if the number can't be parsed.
 */
function formatPhoneE164(phone) {
  if (!phone) return null;
  // Strip everything except digits and leading +
  const cleaned = phone.replace(/[^\d+]/g, "");
  // Already E.164
  if (/^\+1\d{10}$/.test(cleaned)) return cleaned;
  // Has country code without +
  if (/^1\d{10}$/.test(cleaned)) return "+" + cleaned;
  // Just 10 digits
  if (/^\d{10}$/.test(cleaned)) return "+1" + cleaned;
  return null;
}

/**
 * Send an SMS via Twilio.
 * Returns { success: true, sid } or { success: false, error: string }
 * Never throws — SMS failure should not crash the caller.
 */
async function sendSms(to, body) {
  const client = getTwilio();

  if (!client) {
    console.log(`  [sms] Twilio not configured — skipping SMS to ${to}`);
    return { success: false, error: "SMS not configured" };
  }

  const formattedTo = formatPhoneE164(to);
  if (!formattedTo) {
    console.error(`  [sms] Invalid phone number: ${to}`);
    return { success: false, error: "Invalid phone number" };
  }

  try {
    const msg = await client.messages.create({
      body,
      from: process.env.TWILIO_FROM_NUMBER,
      to: formattedTo,
    });
    console.log(`  [sms] ✅ Sent to ${formattedTo} (sid: ${msg.sid})`);
    return { success: true, sid: msg.sid };
  } catch (err) {
    console.error(`  [sms] ❌ Failed to send to ${formattedTo}: ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * Check if Twilio SMS is configured.
 */
function isSmsConfigured() {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER);
}

module.exports = { sendSms, formatPhoneE164, isSmsConfigured };
