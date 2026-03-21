/**
 * InPlace — Email Utility
 * Centralized Resend email sending with proper error handling.
 *
 * IMPORTANT: The default "onboarding@resend.dev" sender can ONLY deliver
 * to the Resend account owner's email. To send to ANY address:
 *   1. Add & verify your domain in Resend dashboard (resend.com/domains)
 *   2. Set FROM_EMAIL=hellothere@yourdomain.com in Railway env vars
 *
 * For yourinplace.com: Add a TXT record in Cloudflare for Resend verification,
 * then set FROM_EMAIL=hellothere@yourinplace.com
 */

const { Resend } = require("resend");

let resendClient = null;

function getResend() {
  if (!resendClient && process.env.RESEND_API_KEY) {
    resendClient = new Resend(process.env.RESEND_API_KEY);
  }
  return resendClient;
}

/**
 * Get the configured from-address.
 * Falls back to onboarding@resend.dev (sandbox — only delivers to account owner).
 */
function getFromAddress() {
  const fromEmail = process.env.FROM_EMAIL || "onboarding@resend.dev";
  return `InPlace <${fromEmail}>`;
}

/**
 * Send an email via Resend.
 * Returns { success: true } or { success: false, error: string }
 */
/**
 * Strip plus-addressing tag from email (e.g. peter+nick@x.com → peter@x.com).
 * Our mail server doesn't support sub-addressing, so deliver to the base mailbox.
 */
function stripPlusTag(email) {
  return email.replace(/\+[^@]*@/, "@");
}

async function sendEmail({ to, subject, html, replyTo }) {
  to = stripPlusTag(to);
  const resend = getResend();

  if (!resend) {
    console.log(`  [email] RESEND_API_KEY not configured — skipping email to ${to}`);
    console.log(`  [email] Subject: ${subject}`);
    return { success: false, error: "RESEND_API_KEY not configured" };
  }

  const from = getFromAddress();
  const isSandbox = from.includes("resend.dev");

  if (isSandbox) {
    console.warn(`  [email] ⚠️  Using sandbox sender (onboarding@resend.dev) — can only deliver to Resend account owner`);
    console.warn(`  [email] To fix: set FROM_EMAIL=hellothere@yourinplace.com after verifying domain in Resend dashboard`);
  }

  try {
    const payload = { from, to, subject, html };
    if (replyTo) payload.reply_to = replyTo;
    const result = await resend.emails.send(payload);
    console.log(`  [email] ✅ Sent "${subject}" to ${to} (id: ${result.data?.id || "unknown"})`);
    return { success: true, id: result.data?.id };
  } catch (err) {
    const msg = err.message || JSON.stringify(err);
    console.error(`  [email] ❌ Failed to send "${subject}" to ${to}: ${msg}`);

    // Common Resend errors with human-readable explanations
    if (msg.includes("validation_error") || msg.includes("from")) {
      console.error(`  [email] ↳ Likely cause: "from" domain not verified. Verify your domain at resend.com/domains`);
    }
    if (msg.includes("not allowed") || msg.includes("sandbox")) {
      console.error(`  [email] ↳ Sandbox mode: onboarding@resend.dev can only send to the account owner's email`);
    }

    return { success: false, error: msg };
  }
}

/**
 * Branded email wrapper — adds InPlace header/footer
 */
function brandedHtml({ title, greeting, body, ctaUrl, ctaText, footnote }) {
  const sections = [
    `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto;">`,
    `<div style="background: #1b6b5a; padding: 24px; border-radius: 12px 12px 0 0; text-align: center;">`,
    `<h1 style="color: white; margin: 0; font-size: 24px;">${title || "InPlace"}</h1>`,
    `</div>`,
    `<div style="padding: 32px 24px; background: #ffffff; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 12px 12px;">`,
  ];

  if (greeting) sections.push(`<p style="color: #333; font-size: 16px;">${greeting}</p>`);
  if (body) sections.push(`<p style="color: #555; line-height: 1.6;">${body}</p>`);

  if (ctaUrl && ctaText) {
    sections.push(
      `<div style="text-align: center; margin: 28px 0;">`,
      `<a href="${ctaUrl}" style="background: #1b6b5a; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px; display: inline-block;">${ctaText}</a>`,
      `</div>`
    );
  }

  if (footnote) sections.push(`<p style="color: #888; font-size: 13px;">${footnote}</p>`);

  sections.push(
    `<hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />`,
    `<p style="color: #aaa; font-size: 12px; text-align: center;">InPlace — On-demand care for your loved ones</p>`,
    `</div>`,
    `</div>`
  );

  return sections.join("\n");
}

module.exports = { sendEmail, brandedHtml, getFromAddress };
